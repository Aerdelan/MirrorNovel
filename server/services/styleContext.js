const { buildRevisionSampleBlock } = require('./styleRevisions');
const { MAX_STYLE_EXAMPLES, MAX_STYLE_EXAMPLE_CHARS } = require('./referenceContext');
const { buildSamplesPrompt } = require('./writingSamples');
const { buildPreferenceBlock } = require('./writingStyle');
const { httpError } = require('./writingSamples');

// A4：无网络副作用的风格上下文构建器。
// 所有"写新正文 / 修订现有文本"入口都从作品冻结快照（novel.styleRevisionSnapshot）
// 取同一份资料，按用途给出不同边界；规划类入口（大纲、蓝图、连续性审稿）不注入，
// 维持 §2.2 以来"规划只用分析摘要"的决策。
//
// purpose:
//   'prose'  —— 写新正文（整本/续写/单章）：偏好块 + 逐章轮换样稿块（A2/A3 行为）
//   'revise' —— 修订现有文本（去AI味/润色/专家修订/编辑引擎/全文调优）：
//               偏好块 + 修订边界样稿块（原文是唯一事实基准；只修复指出的问题）
//   'plan'   —— 规划结构：不注入任何样稿/偏好
//
// 快照为空（旧作品、未采用版本）时三种用途都返回空块，调用方按旧路径继续。

const REVISE_PURPOSE_NOTE = '本次任务是修订现有文本：只修复指出的问题，已自然成立的句子保持原样；不得把本书改成你的固定文风。';

function clampSampleRows(snapshot) {
  const maxChars = Math.min(Number(snapshot?.sampleBudget?.maxCharsPerSample) || MAX_STYLE_EXAMPLE_CHARS, MAX_STYLE_EXAMPLE_CHARS);
  return (Array.isArray(snapshot?.samples) ? snapshot.samples : [])
    .slice(0, MAX_STYLE_EXAMPLES)
    .map(row => ({
      sampleId: String(row.sampleId || ''),
      title: String(row.title || ''),
      sceneType: row.sceneType,
      notes: String(row.notes || ''),
      content: String(row.content || '').slice(0, maxChars),
    }))
    .filter(row => row.content.length >= 40);
}

function buildStyleContext(snapshot, purpose, { chapterNumber } = {}) {
  if (!snapshot) return { block: '', record: null };
  if (purpose === 'plan') return { block: '', record: null };
  if (purpose === 'prose') return buildRevisionSampleBlock(snapshot, chapterNumber);
  if (purpose !== 'revise') throw httpError(400, '未知的风格上下文用途');
  const preferenceBlock = buildPreferenceBlock(snapshot.preferences);
  const rows = clampSampleRows(snapshot);
  const samplesBlock = rows.length ? buildSamplesPrompt(rows, { purpose: 'revise' }) : '';
  const block = `${preferenceBlock}${samplesBlock}${preferenceBlock || samplesBlock ? `\n\n【修订纪律】\n${REVISE_PURPOSE_NOTE}` : ''}`;
  const record = (preferenceBlock || samplesBlock) ? {
    revisionId: snapshot.revisionId || null,
    version: snapshot.version || null,
    purpose: 'revise',
    sampleIds: rows.map(row => row.sampleId),
    preferenceIds: (Array.isArray(snapshot.preferences) ? snapshot.preferences : []).map(row => row.preferenceId),
  } : null;
  return { block, record };
}

module.exports = { buildStyleContext, REVISE_PURPOSE_NOTE };
