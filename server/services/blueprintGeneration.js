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

function stageErrors(stage, label = '阶段', tagOptional = false) {
  const errors = [];
  for (const field of ['title', 'goal', 'entryCondition', 'exitCondition']) {
    if (!requireText(stage?.[field])) errors.push(`${label}缺少${field}`);
  }
  for (const field of STAGE_ARRAYS) {
    // 未选任何标签时没有可兑现的标签，模型省略 tagCommitments 是合理的；
    // 若仍然写了，就按字符串数组照常校验，不放宽内容标准。
    if (field === 'tagCommitments' && tagOptional) {
      if (Array.isArray(stage?.tagCommitments) && stage.tagCommitments.length) {
        errors.push(...arrayErrors(stage.tagCommitments, field, label));
      }
      continue;
    }
    errors.push(...arrayErrors(stage?.[field], field, label));
  }
  return errors;
}

// Validate each of the three stages before passing its results to the next.
// If a large response cannot be parsed, split that batch once at a chapter boundary.
async function generateBlueprintParts({ context, totalChapters, arcCount, rollingEnd, requiredTags = [],
  request, onUsage, onStatus, onFailure, signal }) {
  const tagOptional = requiredTags.length === 0;
  const aborted = () => {
    if (signal?.aborted) { const error = new Error('aborted'); error.name = 'AbortError'; throw error; }
  };
  const task = async (step, name, field, instruction, validate, maxTokens, split) => {
    let failure = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      aborted();
      onStatus?.(`蓝图 ${step}/3：${name}${attempt ? '（仅修复本块）' : ''}...`);
      const prompt = `${context}\n\n【本次仅执行的分块任务】\n${instruction}
本次只输出上面要求的一个JSON对象，不能输出整份三级蓝图、其他分块、解释或代码围栏。
${failure ? `【上次本块校验失败】${JSON.stringify(failure.errors)}\n从头返回本块完整的JSON对象，保留要求的顶层字段 ${field}。各字段只写必要细节，优先保证字段完整和JSON闭合。` : ''}`;
      const result = await request({ name, prompt, attempt, maxTokens });
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
        stitchedRounds: result?.stitchedRounds || 0, documentCount, foundKeys };
      onFailure?.(failure);
      if (split && (result?.finishReason === 'length' || reason === 'invalid_json')) {
        onStatus?.(`蓝图 ${step}/3：${name}输出不完整，拆成两批继续...`);
        return split();
      }
    }
    const error = new Error(`蓝图分块“${name}”未通过：${failure.errors.join('；')}。仅重试本块后仍失败（原因：${failure.reason}）`);
    error.code = 'BLUEPRINT_PART_INVALID';
    error.diagnostics = failure;
    throw error;
  };

  const outline = await task(1, '全书概览', 'mainArc',
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
    }, 16000);

  const generatePhases = async (anchors, previous = null, allowSplit = true) => {
    const start = Number(anchors[0].startChapter);
    const end = Number(anchors.at(-1).endChapter);
    const stageExample = { title: '篇章或小阶段名', startChapter: start, endChapter: end,
      goal: '具体目标', obstacle: '阻力', reversal: '反转', threads: ['支线'],
      tagCommitments: ['标签原名：兑现动作'],
      characterBeats: [{ character: '角色', goal: '目标', conflict: '冲突', change: '变化', voiceGuard: '声线' }],
      requiredScenes: ['具体场景'], forbiddenDrift: ['禁止偏移'], entryCondition: '进入条件', exitCondition: '离开条件',
      foreshadowing: [{ name: '伏笔', setupChapter: start, progressChapters: [], payoffChapter: end, plan: '铺设回收' }],
      unresolvedQuestions: ['未决问题'] };
    const split = allowSplit && anchors.length > 1 ? async () => {
      const middle = Math.ceil(anchors.length / 2);
      const { phases: first } = await generatePhases(anchors.slice(0, middle), previous, false);
      const { phases: second } = await generatePhases(anchors.slice(middle), first.at(-1), false);
      return { phases: [...first, ...second] };
    } : undefined;
    return task(2, `篇章第${start}-${end}章`, 'phases',
      `按顺序细化第${start}-${end}章的以下${anchors.length}个篇章，逐一保持原有章节范围：${JSON.stringify(anchors)}。
全书主线：${outline.mainArc}
不可改写事实：${JSON.stringify(outline.lockedFacts)}
${previous ? `上一批最后一个篇章的衔接约束：${JSON.stringify({ title: previous.title, endChapter: previous.endChapter, exitCondition: previous.exitCondition, unresolvedQuestions: previous.unresolvedQuestions })}\n` : ''}相邻篇章的进入条件要承接前一篇章的离开条件。
返回结构示例（按要求填齐所有篇章）：${JSON.stringify({ phases: [{ ...stageExample, subphases: [stageExample] }] })}。
跨度较长的篇章，用现有reversal标明关键选择发生在第几章及其结果，用exitCondition写清阶段末章的新局面。伏笔用已有章号字段安排埋设与回收，优先沿用大纲已定的章号。
每个篇章的subphases连续覆盖本篇章，通常2个，章数不足时1个，最多8个。篇章及小阶段都要填齐六个数组和进入/离开条件，各数组优先写1-2项直接相关的内容，保留分配的全部标签及其原名。各条写简短具体的事件和约束，避免在篇章和小阶段重复描述。未选标签时tagCommitments可为空。不要写执行卡。`, parsed => {
        if (!Array.isArray(parsed.phases) || parsed.phases.length !== anchors.length) {
          return [`篇章数量不符：要求${anchors.length}个，实际${Array.isArray(parsed.phases) ? parsed.phases.length : 0}个`];
        }
        const errors = [];
        parsed.phases.forEach((phase, index) => {
          const anchor = anchors[index];
          const { startChapter, endChapter } = anchor;
          const label = `第${startChapter}-${endChapter}章篇章`;
          errors.push(...stageErrors(phase, label, tagOptional));
          if (Number(phase?.startChapter) !== Number(startChapter) || Number(phase?.endChapter) !== Number(endChapter)) {
            errors.push(`${label}范围被改写（实际为第${phase?.startChapter ?? '?'}-${phase?.endChapter ?? '?'}章）`);
          }
          const subphases = Array.isArray(phase?.subphases) ? phase.subphases : [];
          if (!subphases.length) errors.push(`${label}缺少subphases`);
          else {
            if (subphases.length > 8) errors.push(`${label}的subphases不能超过8个`);
            errors.push(...rangeErrors(subphases, Number(startChapter), Number(endChapter), `${label}的小阶段范围`));
            subphases.forEach((subphase, i) => errors.push(...stageErrors(subphase, `${label}的小阶段${i + 1}`, tagOptional)));
          }
          const commitments = [phase?.tagCommitments, ...subphases.map(item => item?.tagCommitments)].flat().join('、');
          const assignedTags = Array.isArray(anchor.tagCommitments) ? anchor.tagCommitments.join('、') : '';
          for (const tag of requiredTags) {
            if (assignedTags.includes(tag) && !commitments.includes(tag)) errors.push(`${label}遗漏已分配标签“${tag}”`);
          }
        });
        return errors;
      }, 32000, split);
  };
  const { phases } = await generatePhases(outline.phases);

  const generateCards = async (start, end, previous = [], allowSplit = true) => {
    const relevant = phases.filter(phase => Number(phase.startChapter) <= end && Number(phase.endChapter) >= start);
    const split = allowSplit && start < end ? async () => {
      const middle = Math.floor((start + end) / 2);
      const { chapters: first } = await generateCards(start, middle, previous, false);
      const { chapters: second } = await generateCards(middle + 1, end, first, false);
      return { chapters: [...first, ...second] };
    } : undefined;
    return task(3, `执行卡第${start}-${end}章`, 'chapters',
      `只编写第${start}-${end}章，共${end - start + 1}张执行卡，不写其他章节。已确定主线：${outline.mainArc}
必须遵守的相关篇章：${JSON.stringify(relevant)}
${previous.length ? `已完成执行卡的实际进展：${JSON.stringify(previous.map(card => ({ chapterNumber: card.chapterNumber, title: card.title, purpose: card.purpose, exitHook: card.exitHook })))}\n` : ''}返回{"chapters":[{"chapterNumber":${start},"title":"具体短标题","purpose":"本章新发生的状态变化","tagCommitments":["标签+兑现方式"],"characterBeats":[{"character":"角色","goal":"目标","conflict":"冲突","change":"变化","voiceGuard":"声线"}],"requiredScenes":["场景"],"relationshipChange":"关系变化","foreshadowingActions":["伏笔动作"],"exitHook":"新的章末局面"}]}。
chapterNumber必须连续，每张卡承接前一章的局面，标题和核心事件不能重复。篇章转折和伏笔按已定章号兑现。每个数组写1-2项最相关的内容，未选标签时tagCommitments可为空。`, parsed => {
        if (!Array.isArray(parsed.chapters) || parsed.chapters.length !== end - start + 1) {
          return [`执行卡数量不符：要求${end - start + 1}张，实际${Array.isArray(parsed.chapters) ? parsed.chapters.length : 0}张`];
        }
        const errors = [];
        parsed.chapters.forEach((card, index) => {
          const label = `第${Number(card?.chapterNumber) || start + index}章执行卡`;
          if (Number(card?.chapterNumber) !== start + index) errors.push(`${label}章节号缺失或顺序错位（应为第${start + index}章）`);
          for (const field of ['title', 'purpose', 'relationshipChange', 'exitHook']) if (!requireText(card?.[field])) errors.push(`${label}缺少${field}`);
          for (const field of ['tagCommitments', 'characterBeats', 'requiredScenes', 'foreshadowingActions']) {
            if (field === 'tagCommitments' && tagOptional
                && (!Array.isArray(card?.tagCommitments) || !card.tagCommitments.length)) continue;
            errors.push(...arrayErrors(card?.[field], field, label));
          }
        });
        return errors;
      }, 24000, split);
  };
  const { chapters } = await generateCards(1, rollingEnd);
  const windowPhases = phases.filter(phase => Number(phase.startChapter) <= rollingEnd);
  return { blueprintLevel: 3, mainArc: outline.mainArc,
    lockedFacts: Array.isArray(outline.lockedFacts) ? outline.lockedFacts : [], phases,
    rollingPlan: { startChapter: 1, endChapter: rollingEnd, calibratedAtChapter: 0,
      objective: windowPhases.map(phase => phase.goal).join('；'),
      tagCommitments: [...new Set(windowPhases.flatMap(phase => phase.tagCommitments))],
      forbiddenDrift: [...new Set(windowPhases.flatMap(phase => phase.forbiddenDrift))], chapters } };
}

module.exports = { generateBlueprintParts };
