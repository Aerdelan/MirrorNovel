const { inspectStructuredPayload } = require('./blueprintPayload');

const requireText = value => typeof value === 'string' && value.trim();
const hasItems = value => Array.isArray(value) && value.length > 0;
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const STAGE_ARRAYS = ['tagCommitments', 'characterBeats', 'requiredScenes', 'forbiddenDrift', 'foreshadowing', 'unresolvedQuestions'];

// Validation strength is unchanged; only the message names the failing item
// and key so "missing field" can be traced to a concrete card or subphase.
function arrayErrors(value, field, label = '') {
  const owner = label ? `${label}的` : '';
  if (!hasItems(value)) return [`${label}缺少${field}`];
  if (field === 'characterBeats' || field === 'foreshadowing') {
    const keys = field === 'characterBeats'
      ? ['character', 'goal', 'conflict', 'change', 'voiceGuard']
      : ['name', 'plan'];
    const problems = [];
    value.forEach((item, index) => {
      if (!isRecord(item)) { problems.push(`第${index + 1}项不是对象`); return; }
      const missing = keys.filter(key => !requireText(item[key]));
      if (missing.length) problems.push(`第${index + 1}项缺少${missing.join('/')}`);
    });
    return problems.length ? [`${owner}${field}不完整：${problems.slice(0, 6).join('；')}`] : [];
  }
  const empty = value.map((item, index) => (requireText(item) ? 0 : index + 1)).filter(Boolean);
  return empty.length ? [`${owner}${field}第${empty.slice(0, 6).join('/')}项为空`] : [];
}

function rangeErrors(rows, start, end, label = '') {
  const errors = [];
  const prefix = label ? `${label}：` : '';
  let next = start;
  for (const row of rows) {
    if (!isRecord(row)) { errors.push(`${prefix}章节范围条目必须是对象`); continue; }
    if (!Number.isSafeInteger(Number(row.startChapter)) || Number(row.startChapter) !== next || !Number.isSafeInteger(Number(row.endChapter))
      || Number(row.endChapter) < next || Number(row.endChapter) > end) errors.push(`${prefix}章节范围应从第${next}章连续覆盖，不得重叠或越界`);
    next = Number(row.endChapter) + 1;
  }
  if (next !== end + 1) errors.push(`${prefix}必须完整覆盖到第${end}章`);
  return errors;
}

function stageErrors(stage, label = '阶段') {
  const errors = [];
  for (const field of ['title', 'goal', 'entryCondition', 'exitCondition']) {
    if (!requireText(stage?.[field])) errors.push(`${label}缺少${field}`);
  }
  for (const field of STAGE_ARRAYS) errors.push(...arrayErrors(stage?.[field], field, label));
  return errors;
}

// Keep each model response small and validate it before retaining it. The server
// owns the final root structure: rollingPlan can no longer disappear in a full
// document rewrite. Existing successful parts are never sent for regeneration.
async function generateBlueprintParts({ context, totalChapters, arcCount, rollingEnd, requiredTags = [],
  request, onUsage, onStatus, onFailure, signal }) {
  let step = 0;
  const stepCount = 1 + arcCount + Math.ceil(rollingEnd / 5);
  const aborted = () => {
    if (signal?.aborted) { const error = new Error('aborted'); error.name = 'AbortError'; throw error; }
  };
  const task = async (name, field, instruction, validate) => {
    aborted();
    step++;
    let failure = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      aborted();
      onStatus?.(`蓝图 ${step}/${stepCount}：${name}${attempt ? '（仅修复本块）' : ''}...`);
      const prompt = `${context}\n\n【本次仅执行的分块任务】\n${instruction}
本次只输出上面要求的一个JSON对象，不能输出整份三级蓝图、其他分块、解释或代码围栏。
${failure ? `【上次本块校验失败】${JSON.stringify(failure.errors)}\n从头返回本块完整的JSON对象，保留要求的顶层字段 ${field}。各字段只写必要细节，优先保证字段完整和JSON闭合。` : ''}`;
      const result = await request({ name, prompt, attempt, maxTokens: name === '全书概览' ? 12000 : 16000 });
      onUsage?.(result);
      aborted();
      const content = String(result?.content || '');
      const { parsed, reason: parseReason, documentCount = 0, foundKeys = [] } = inspectStructuredPayload(content, field);
      const reason = parsed ? 'part_invalid'
        : result?.finishReason === 'length' ? 'output_truncated'
          : !content.trim() ? 'empty_output' : parseReason;
      const errors = parsed ? validate(parsed) : [{
        output_truncated: '模型输出达到上限，本块未完整返回（finishReason=length）',
        empty_output: '模型未返回蓝图内容（输出为空）',
        invalid_json: '未能从输出中提取到完整JSON文档（可能被截断，或字符串内有未转义换行）',
        missing_field: `JSON中没有顶层字段“${field}”；模型实际返回的顶层键：${foundKeys.join('、') || '无'}；完整JSON文档${documentCount}个`,
      }[reason] || `本块输出无法使用（${reason}）`];
      if (!errors.length) return parsed;
      failure = { part: name, attempt: attempt + 1, errors: errors.slice(0, 12),
        reason, expectedField: field, outputChars: content.length, finishReason: result?.finishReason || null,
        jsonModeRequested: result?.jsonModeRequested === true, malformedStreamFrames: result?.malformedStreamFrames || 0,
        documentCount, foundKeys };
      onFailure?.(failure);
    }
    const error = new Error(`蓝图分块“${name}”未通过：${failure.errors.join('；')}。仅重试本块后仍失败（原因：${failure.reason}）`);
    error.code = 'BLUEPRINT_PART_INVALID';
    error.diagnostics = failure;
    throw error;
  };

  const outline = await task('全书概览', 'mainArc',
    `只设计全书主线、不可改写事实与${arcCount}个连续大篇章的简明概览，覆盖第1-${totalChapters}章。
返回{"mainArc":"主线因果与终局","lockedFacts":["设定"],"phases":[{"title":"篇章名","startChapter":1,"endChapter":6,"goal":"目标","obstacle":"阻力","reversal":"反转","threads":["支线"],"tagCommitments":["所选标签原名：具体兑现动作"]}]}。
按全书章数自行划分范围，示例中的1-6不是固定值。每个所选标签至少分配到一个篇章，使用标签原名。
这一步不输出subphases或rollingPlan，每篇章概览控制在150字左右。所选标签：${requiredTags.join('、')}`, parsed => {
      const errors = [];
      if (!requireText(parsed.mainArc)) errors.push('mainArc不能为空');
      if (!Array.isArray(parsed.lockedFacts) || !parsed.lockedFacts.every(requireText)) errors.push('lockedFacts必须是事实字符串数组，可为空，不能编造原大纲没有的事实');
      if (!hasItems(parsed.phases) || parsed.phases.length !== arcCount) errors.push(`phases必须有${arcCount}个篇章`);
      if (Array.isArray(parsed.phases)) {
        errors.push(...rangeErrors(parsed.phases, 1, totalChapters, '概览篇章范围'));
        parsed.phases.forEach((phase, index) => {
          if (!requireText(phase?.title) || !requireText(phase?.goal)) errors.push(`第${index + 1}个篇章缺少title或goal`);
        });
        const commitments = parsed.phases.flatMap(phase => Array.isArray(phase?.tagCommitments) ? phase.tagCommitments : []).join('、');
        for (const tag of requiredTags) {
          if (!commitments.includes(tag)) errors.push(`所选标签“${tag}”没有分配到任何篇章（已写标签：${commitments || '无'}）`);
        }
      }
      return errors;
    });

  const phases = [];
  for (const anchor of outline.phases) {
    const { startChapter, endChapter } = anchor;
    const stageExample = { title: anchor.title, startChapter: Number(startChapter), endChapter: Number(endChapter),
      goal: '具体目标', obstacle: '阻力', reversal: '反转', threads: ['支线'],
      tagCommitments: ['标签原名：兑现动作'],
      characterBeats: [{ character: '角色', goal: '目标', conflict: '冲突', change: '变化', voiceGuard: '声线' }],
      requiredScenes: ['具体场景'], forbiddenDrift: ['禁止偏移'], entryCondition: '进入条件', exitCondition: '离开条件',
      foreshadowing: [{ name: '伏笔', setupChapter: Number(startChapter), progressChapters: [], payoffChapter: Number(endChapter), plan: '铺设回收' }],
      unresolvedQuestions: ['未决问题'] };
    const payload = await task(`篇章第${startChapter}-${endChapter}章`, 'phase',
      `只细化以下这一个篇章，其章节范围不得改变：${JSON.stringify(anchor)}。
全书概览（供连贯性核对，不得改写）：${JSON.stringify(outline)}
已完成篇章的衔接约束：${JSON.stringify(phases.map(phase => ({ title: phase.title, endChapter: phase.endChapter, exitCondition: phase.exitCondition, unresolvedQuestions: phase.unresolvedQuestions })))}
返回结构示例（内容必须依据本书重新填写）：${JSON.stringify({ phase: { ...stageExample, subphases: [stageExample] } })}。
subphases必须连续覆盖第${startChapter}-${endChapter}章，通常2-4个、最多8个，章数不足时1个。每个小阶段也必须有上述六个数组和进入/离开条件。每项只写必要的剧情信息，人物推进和伏笔聚焦本阶段直接相关的条目。保持本篇章概览分配的标签原名及兑现责任。只填本篇章及其小阶段，不写执行卡或其他篇章。`, parsed => {
        const phase = parsed.phase;
        const errors = stageErrors(phase, '篇章本体');
        if (Number(phase?.startChapter) !== Number(startChapter) || Number(phase?.endChapter) !== Number(endChapter)) {
          errors.push(`篇章范围被改写（应为第${startChapter}-${endChapter}章，实际为第${phase?.startChapter ?? '?'}-${phase?.endChapter ?? '?'}章）`);
        }
        if (!hasItems(phase?.subphases)) errors.push('篇章本体缺少subphases');
        else {
          if (phase.subphases.length > 8) errors.push('subphases不能超过8个');
          errors.push(...rangeErrors(phase.subphases, Number(startChapter), Number(endChapter), '小阶段范围'));
          phase.subphases.forEach((subphase, index) => errors.push(...stageErrors(subphase, `小阶段${index + 1}`)));
        }
        const commitments = [phase?.tagCommitments, ...(Array.isArray(phase?.subphases) ? phase.subphases.map(item => item?.tagCommitments) : [])].flat().join('、');
        for (const tag of requiredTags.filter(tag => (Array.isArray(anchor.tagCommitments) ? anchor.tagCommitments : []).join('、').includes(tag))) {
          if (!commitments.includes(tag)) errors.push(`篇章遗漏已分配标签“${tag}”`);
        }
        return errors;
      });
    phases.push(payload.phase);
  }

  const chapters = [];
  for (let start = 1; start <= rollingEnd; start += 5) {
    const end = Math.min(rollingEnd, start + 4);
    const relevant = phases.filter(phase => Number(phase.startChapter) <= end && Number(phase.endChapter) >= start);
    const payload = await task(`执行卡第${start}-${end}章`, 'chapters',
      `只编写第${start}-${end}章，共${end - start + 1}张执行卡，不写其他章节。已确定主线：${outline.mainArc}
必须遵守的相关篇章：${JSON.stringify(relevant)}
已完成执行卡的实际进展：${JSON.stringify(chapters.map(card => ({ chapterNumber: card.chapterNumber, title: card.title, purpose: card.purpose, exitHook: card.exitHook })))}
返回{"chapters":[{"chapterNumber":${start},"title":"具体短标题","purpose":"本章新发生的状态变化","tagCommitments":["标签+兑现方式"],"characterBeats":[{"character":"角色","goal":"目标","conflict":"冲突","change":"变化","voiceGuard":"声线"}],"requiredScenes":["场景"],"relationshipChange":"关系变化","foreshadowingActions":["伏笔动作"],"exitHook":"新的章末局面"}]}。
chapterNumber必须连续，标题和核心事件不能复刻前面的执行卡。`, parsed => {
        if (!Array.isArray(parsed.chapters) || parsed.chapters.length !== end - start + 1) {
          return [`执行卡数量不符：要求${end - start + 1}张，实际${Array.isArray(parsed.chapters) ? parsed.chapters.length : 0}张`];
        }
        const errors = [];
        parsed.chapters.forEach((card, index) => {
          const label = `第${Number(card?.chapterNumber) || start + index}章执行卡`;
          if (Number(card?.chapterNumber) !== start + index) errors.push(`${label}章节号缺失或顺序错位（应为第${start + index}章）`);
          for (const field of ['title', 'purpose', 'relationshipChange', 'exitHook']) if (!requireText(card?.[field])) errors.push(`${label}缺少${field}`);
          for (const field of ['tagCommitments', 'characterBeats', 'requiredScenes', 'foreshadowingActions']) errors.push(...arrayErrors(card?.[field], field, label));
        });
        return errors;
      });
    chapters.push(...payload.chapters);
  }
  const windowPhases = phases.filter(phase => Number(phase.startChapter) <= rollingEnd);
  return { blueprintLevel: 3, mainArc: outline.mainArc,
    lockedFacts: Array.isArray(outline.lockedFacts) ? outline.lockedFacts : [], phases,
    rollingPlan: { startChapter: 1, endChapter: rollingEnd, calibratedAtChapter: 0,
      objective: windowPhases.map(phase => phase.goal).join('；'),
      tagCommitments: [...new Set(windowPhases.flatMap(phase => phase.tagCommitments))],
      forbiddenDrift: [...new Set(windowPhases.flatMap(phase => phase.forbiddenDrift))], chapters } };
}

module.exports = { generateBlueprintParts };
