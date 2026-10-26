const mongoose = require('mongoose');
const { MAX_STYLE_EXAMPLES, MAX_STYLE_EXAMPLE_CHARS } = require('./referenceContext');
const {
  loadApprovedSamples, normalizeSampleContent, httpError,
  SAMPLE_PROMPT_RULES, SAMPLE_PROMPT_HEADING,
} = require('./writingSamples');
const {
  buildPreferenceBlock, freezePreferenceRow,
  MAX_PROMPT_PREFERENCES, MAX_PROMPT_STATEMENT_CHARS,
} = require('./writingStyle');

// A2 风格版本服务。设计约束（规划书 §4-A2 / §5）：
//  - 版本不可变：本文件只提供创建与读取，不提供任何更新函数。
//  - 生成链路只读 novel.styleRevisionSnapshot（作品上的冻结快照），
//    不回查 WritingStyleRevision 集合——任务期间版本固定。
//  - 逐章选择使用确定性轮换（章号驱动），同章恒定、跨章轮换、可解释、可回放。
//  - 输入预算沿用参考示例口径：每版本最多固定 9 段候选，每章注入最多 3 段 × 240 字。

const MAX_PINNED_SAMPLES = 9;

function pinSampleRow(row) {
  const content = normalizeSampleContent(row.content).slice(0, MAX_STYLE_EXAMPLE_CHARS);
  return {
    sampleId: String(row._id),
    title: String(row.title || '').slice(0, 80),
    sceneType: ['dialogue', 'action', 'observation', 'emotion', 'transition', 'other'].includes(row.sceneType) ? row.sceneType : 'other',
    notes: String(row.notes || '').slice(0, 200),
    content,
    sourceKind: ['own_text', 'human_edit', 'authorized_reference'].includes(row.sourceKind) ? row.sourceKind : 'own_text',
  };
}

// 把任意来源（lean 对象 / mongoose 文档 / 已有快照）统一成纯数组。
function snapshotSampleRows(samples) {
  return (Array.isArray(samples) ? samples : [])
    .filter(row => row && typeof row === 'object' && typeof row.content === 'string')
    .map(row => ({
      sampleId: String(row.sampleId || row._id || ''),
      title: String(row.title || ''),
      sceneType: row.sceneType,
      notes: String(row.notes || ''),
      content: row.content,
      sourceKind: row.sourceKind,
    }));
}

/**
 * 创建风格版本。人格（可选）与样稿在此时冻结：
 *  - 显式传入 sampleIds 时全部必须是当前账号“已认可且允许作为模型输入”的小说样稿；
 *  - 未传时自动取样稿池最新（updatedAt 倒序）最多 9 段。
 * 创建后编辑人格模板、增删样稿都不影响已创建版本。
 */
async function createStyleRevision({ userId, name, personaId, sampleIds, note, skipEmpty = false }, { WritingSampleModel, WritingPersonaModel, RevisionModel } = {}) {
  if (!WritingPersonaModel) WritingPersonaModel = require('../models/WritingPersona');
  if (!RevisionModel) RevisionModel = require('../models/WritingStyleRevision');
  let personaSnapshot = null;
  if (personaId) {
    if (!mongoose.isValidObjectId(personaId)) throw httpError(404, '未找到该写作人格');
    personaSnapshot = await WritingPersonaModel.findOne({ _id: personaId, userId }).lean();
    if (!personaSnapshot) throw httpError(404, '未找到该写作人格或它不属于当前账号');
  }
  let pool;
  if (Array.isArray(sampleIds) && sampleIds.length) {
    const ids = [...new Set(sampleIds.map(String))];
    if (ids.length > MAX_PINNED_SAMPLES) throw httpError(400, `一个版本最多固定 ${MAX_PINNED_SAMPLES} 段样稿`);
    if (ids.some(id => !mongoose.isValidObjectId(id))) throw httpError(400, '样稿 ID 无效');
    const rows = await loadApprovedSamples(userId, { scope: 'novel', sampleIds: ids, limit: MAX_PINNED_SAMPLES, Model: WritingSampleModel });
    pool = ids.map(id => rows.find(row => String(row._id) === id));
    if (pool.some(row => !row)) throw httpError(400, '所选样稿包含未认可、已撤销、剧本范围或不属于当前账号的内容');
  } else {
    pool = await loadApprovedSamples(userId, { scope: 'novel', limit: MAX_PINNED_SAMPLES, Model: WritingSampleModel });
  }
  const samples = pool.slice(0, MAX_PINNED_SAMPLES).map(pinSampleRow).filter(row => row.content.length >= 40);
  if (skipEmpty && !samples.length) return null;
  const last = await RevisionModel.findOne({ userId }).sort({ version: -1 }).lean();
  const version = (Number(last?.version) || 0) + 1;
  return RevisionModel.create({
    userId,
    name: String(name || '').trim().slice(0, 80) || `版本 ${version}`,
    version,
    scope: 'novel',
    personaId: personaSnapshot ? personaSnapshot._id : null,
    personaSnapshot,
    samples,
    sampleBudget: { maxCount: MAX_STYLE_EXAMPLES, maxCharsPerSample: MAX_STYLE_EXAMPLE_CHARS },
    note: String(note || '').trim().slice(0, 200),
  });
}

/**
 * 逐章确定性选择。规则：
 *  候选按版本内固定顺序排列；第 N 章从第 ((N-1) mod 总数) 段开始循环取
 *  min(预算, 总数) 段。同一章号永远得到同一组样稿；章号推进时起点后移，
 *  避免每章反复使用同一段示例。无候选时返回空选择（正常降级）。
 */
function selectRevisionSamples(snapshot, chapterNumber) {
  const budgetMax = Math.min(Number(snapshot?.sampleBudget?.maxCount) || MAX_STYLE_EXAMPLES, MAX_STYLE_EXAMPLES);
  const maxChars = Math.min(Number(snapshot?.sampleBudget?.maxCharsPerSample) || MAX_STYLE_EXAMPLE_CHARS, MAX_STYLE_EXAMPLE_CHARS);
  const rows = snapshotSampleRows(snapshot?.samples)
    .map(row => ({ ...row, content: row.content.slice(0, maxChars) }))
    .filter(row => row.content.length >= 40);
  if (!rows.length) {
    return {
      samples: [],
      reasons: ['该版本未固定可用样稿，本章不注入样稿（正常降级，不影响生成）'],
      revisionId: snapshot?.revisionId || null,
      version: snapshot?.version || null,
    };
  }
  const n = rows.length;
  const chapter = Math.max(1, Math.floor(Number(chapterNumber) || 1));
  const offset = (chapter - 1) % n;
  const count = Math.min(budgetMax, n);
  const picked = [];
  for (let i = 0; i < count; i++) picked.push(rows[(offset + i) % n]);
  return {
    samples: picked,
    reasons: [
      `按版本内固定顺序轮换：第${chapter}章从第${offset + 1}段开始取${count}段（版本共${n}段）`,
      '同一章号始终得到相同选择；章号推进时依次轮换，避免每章重复同一段示例',
    ],
    revisionId: snapshot?.revisionId || null,
    version: snapshot?.version || null,
  };
}

/**
 * 渲染单章的样稿提示词块。返回 { block, record }：
 *  block  —— 追加到系统提示词末尾的资料块（空选择返回空串）；
 *  record —— 写入 chapter.styleSamples 的抽样记录（样稿 ID、版本、选择原因）。
 * 不修改传入快照；无快照（旧作品）时 block 为空串，链路按旧路径继续。
 */
function buildRevisionSampleBlock(snapshot, chapterNumber) {
  if (!snapshot) return { block: '', record: null };
  // 偏好块（稳定规则）在轮换样稿块之前：同一任务内逐章逐字节一致，保住前缀缓存。
  const preferenceBlock = buildPreferenceBlock(snapshot.preferences);
  if (!Array.isArray(snapshot.samples) || !snapshot.samples.length) {
    return { block: preferenceBlock, record: null };
  }
  const selection = selectRevisionSamples(snapshot, chapterNumber);
  if (!selection.samples.length) return { block: preferenceBlock, record: null };
  const rows = selection.samples.map(row => ({
    title: String(row.title || '').slice(0, 80),
    sceneType: row.sceneType,
    notes: String(row.notes || '').slice(0, 200),
    content: row.content,
  }));
  const block = `${preferenceBlock}\n\n${SAMPLE_PROMPT_HEADING}\n${SAMPLE_PROMPT_RULES}\n${JSON.stringify({ samples: rows })}`;
  const record = {
    revisionId: selection.revisionId,
    version: selection.version,
    sampleIds: selection.samples.map(row => row.sampleId),
    titles: selection.samples.map(row => row.title || ''),
    reasons: selection.reasons,
    ...(Array.isArray(snapshot.preferences) && snapshot.preferences.length ? { preferenceIds: snapshot.preferences.map(row => row.preferenceId) } : {}),
  };
  return { block, record };
}

// 作品采用版本时写入 novel.styleRevisionSnapshot 的冻结内容。
// 生成链路只读这份快照；版本集合后续的任何变化都影响不到它。
// 冻结时即按预算裁剪每段正文，快照内容与提示词预算始终一致。
function freezeRevisionSnapshot(revision, adoptedAtChapter, preferences = []) {
  const maxCount = Math.min(Number(revision.sampleBudget?.maxCount) || MAX_STYLE_EXAMPLES, MAX_STYLE_EXAMPLES);
  const maxChars = Math.min(Number(revision.sampleBudget?.maxCharsPerSample) || MAX_STYLE_EXAMPLE_CHARS, MAX_STYLE_EXAMPLE_CHARS);
  return {
    revisionId: String(revision._id),
    name: String(revision.name || ''),
    version: Number(revision.version) || 1,
    personaSnapshot: revision.personaSnapshot || null,
    samples: snapshotSampleRows(revision.samples)
      .slice(0, MAX_PINNED_SAMPLES)
      .map(row => ({ ...row, content: String(row.content || '').slice(0, maxChars) })),
    sampleBudget: { maxCount, maxCharsPerSample: maxChars },
    // 作者确认的偏好（作品范围 + 账号范围）在采用时一并冻结；之后确认/停用偏好
    // 不影响已采用快照，需采用新版本才生效（版本固定语义不变）。
    preferences: (Array.isArray(preferences) ? preferences : [])
      .slice(0, MAX_PROMPT_PREFERENCES)
      .map(freezePreferenceRow)
      .filter(row => row.statement.length >= 10),
    adoptedAtChapter: Math.max(1, Math.floor(Number(adoptedAtChapter) || 1)),
    adoptedAt: new Date().toISOString(),
  };
}

// 版本对比：人格变化 + 样稿增删。供“创建新版/回退”决策参考。
function compareRevisions(a, b) {
  const rowsOf = rev => snapshotSampleRows(rev?.samples);
  const aRows = rowsOf(a), bRows = rowsOf(b);
  const keyOf = row => row.sampleId;
  const aMap = new Map(aRows.map(row => [keyOf(row), row]));
  const bMap = new Map(bRows.map(row => [keyOf(row), row]));
  const added = bRows.filter(row => !aMap.has(keyOf(row))).map(row => ({ sampleId: row.sampleId, title: row.title }));
  const removed = aRows.filter(row => !bMap.has(keyOf(row))).map(row => ({ sampleId: row.sampleId, title: row.title }));
  const changed = bRows.filter(row => {
    const old = aMap.get(keyOf(row));
    return old && old.content !== row.content;
  }).map(row => ({ sampleId: row.sampleId, title: row.title }));
  const unchanged = bRows.filter(row => {
    const old = aMap.get(keyOf(row));
    return old && old.content === row.content;
  }).length;
  const personaFields = ['name', 'voice', 'tone', 'rules', 'vocab', 'axes'];
  const personaChanged = personaFields.filter(field => JSON.stringify(a?.personaSnapshot?.[field] ?? null) !== JSON.stringify(b?.personaSnapshot?.[field] ?? null));
  const prefsOf = rev => (Array.isArray(rev?.preferences) ? rev.preferences : []);
  const aPrefs = prefsOf(a), bPrefs = prefsOf(b);
  const prefKey = row => row.preferenceId || row.statement;
  const aPrefMap = new Map(aPrefs.map(row => [prefKey(row), row]));
  const bPrefMap = new Map(bPrefs.map(row => [prefKey(row), row]));
  return {
    preferences: {
      added: bPrefs.filter(row => !aPrefMap.has(prefKey(row))).map(row => row.statement),
      removed: aPrefs.filter(row => !bPrefMap.has(prefKey(row))).map(row => row.statement),
      unchanged: bPrefs.filter(row => aPrefMap.has(prefKey(row))).length,
    },
    a: { revisionId: String(a?._id || a?.revisionId || ''), name: a?.name || '', version: a?.version || null },
    b: { revisionId: String(b?._id || b?.revisionId || ''), name: b?.name || '', version: b?.version || null },
    persona: {
      samePersona: String(a?.personaId || a?.personaSnapshot?._id || '') === String(b?.personaId || b?.personaSnapshot?._id || ''),
      personaChanged,
      aPersonaName: a?.personaSnapshot?.name || '',
      bPersonaName: b?.personaSnapshot?.name || '',
    },
    samples: { added, removed, changed, unchanged },
  };
}

module.exports = {
  createStyleRevision,
  selectRevisionSamples,
  buildRevisionSampleBlock,
  freezeRevisionSnapshot,
  compareRevisions,
  pinSampleRow,
  MAX_PINNED_SAMPLES,
};
