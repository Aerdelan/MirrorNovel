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

// When otherwise valid phases omit these two arrays, request only the missing
// content. Never invent placeholders or copy a parent's plan into its children.
function planPhaseRepair(parsed, errors) {
  if (!errors.length || !errors.every(error => /缺少(?:foreshadowing|unresolvedQuestions)$/.test(error))) return null;
  const targets = [];
  for (const phase of parsed.phases) {
    for (const stage of [phase, ...phase.subphases]) {
      const fields = ['foreshadowing', 'unresolvedQuestions'].filter(field => !hasItems(stage[field]));
      if (fields.length) targets.push({ phaseStartChapter: Number(phase.startChapter),
        subphaseStartChapter: stage === phase ? null : Number(stage.startChapter),
        fields, stage, parentForeshadowing: phase.foreshadowing,
        parentUnresolvedQuestions: phase.unresolvedQuestions });
    }
  }
  return {
    instruction: `【仅补齐缺失字段，不重写篇章】
以下篇章和小阶段的其他内容已通过校验。只为每个目标补充fields列出的字段，必须符合原始大纲、目标阶段的事件和父篇章的伏笔安排。
目标清单（必须逐项完整覆盖）：${JSON.stringify(targets)}
返回一个完整JSON对象：{"repairs":[{"phaseStartChapter":1,"subphaseStartChapter":1,"foreshadowing":[{"name":"具体伏笔","setupChapter":1,"progressChapters":[],"payoffChapter":6,"plan":"本小阶段如何埋设、推进或回收这条伏笔"}],"unresolvedQuestions":["本阶段具体的未决问题"]}]}。
phaseStartChapter和subphaseStartChapter必须与目标清单一致；修复篇章本身时subphaseStartChapter为null。每个目标只输出一次，只输出其fields要求补充的字段。每个数组至少1项，不能用空数组或“无”“待补充”等占位；foreshadowing每项必须有非空name和plan。不得输出phases、改写标题、章节范围或其他已通过的内容。`,
    apply(payload) {
      if (!Array.isArray(payload.repairs) || payload.repairs.length !== targets.length) {
        return { parsed, errors: [`repairs必须逐项覆盖全部${targets.length}个修复目标`] };
      }
      const repaired = structuredClone(parsed);
      const key = item => JSON.stringify([Number(item.phaseStartChapter),
        item.subphaseStartChapter == null ? null : Number(item.subphaseStartChapter)]);
      const remaining = new Map(targets.map(target => [key(target), target]));
      for (const patch of payload.repairs) {
        const target = isRecord(patch) && remaining.get(key(patch));
        if (!target) return { parsed, errors: ['repairs包含未知或重复的修复目标'] };
        remaining.delete(key(patch));
        const phase = repaired.phases.find(item => Number(item.startChapter) === target.phaseStartChapter);
        const stage = target.subphaseStartChapter === null ? phase
          : phase.subphases.find(item => Number(item.startChapter) === target.subphaseStartChapter);
        for (const field of target.fields) stage[field] = patch[field];
      }
      return { parsed: repaired, errors: [] };
    },
  };
}

// Validate each of the three stages before passing its results to the next.
// Parse failures split once; incomplete phase lists shrink recursively to a
// single phase, retaining only independently validated results at each step.
async function generateBlueprintParts({ context, totalChapters, arcCount, rollingEnd, requiredTags = [],
  request, onUsage, onStatus, onFailure, signal }) {
  const tagOptional = requiredTags.length === 0;
  const aborted = () => {
    if (signal?.aborted) { const error = new Error('aborted'); error.name = 'AbortError'; throw error; }
  };
  const task = async (step, name, field, instruction, validate, maxTokens, split, planRepair, recoverPartial) => {
    let failure = null;
    let repair = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      aborted();
      onStatus?.(`蓝图 ${step}/3：${name}${repair ? '（仅补齐缺失字段）' : attempt ? '（仅修复本块）' : ''}...`);
      const prompt = `${context}\n\n【本次仅执行的分块任务】\n${repair ? repair.instruction : instruction}
本次只输出上面要求的一个JSON对象，不能输出整份三级蓝图、其他分块、解释或代码围栏。
${failure && !repair ? `【上次本块校验失败】${JSON.stringify(failure.errors)}\n从头返回本块完整的JSON对象，保留要求的顶层字段 ${field}。各字段只写必要细节，优先保证字段完整和JSON闭合。` : ''}`;
      const result = await request({ name, prompt, attempt, maxTokens });
      onUsage?.(result);
      aborted();
      const content = String(result?.content || '');
      const expectedField = repair ? 'repairs' : field;
      const { parsed: response, reason: parseReason, documentCount = 0, foundKeys = [] } = inspectStructuredPayload(content, expectedField);
      const applied = response && repair ? repair.apply(response) : null;
      const parsed = applied ? applied.parsed : response;
      const reason = parsed ? 'part_invalid'
        : result?.finishReason === 'length' ? 'output_truncated'
          : !content.trim() ? 'empty_output' : parseReason;
      const errors = applied?.errors.length ? applied.errors : parsed ? validate(parsed) : [{
        output_truncated: '模型输出达到上限，本块未完整返回（finishReason=length）',
        empty_output: '模型未返回蓝图内容（输出为空）',
        invalid_json: '未能从输出中提取到完整JSON文档（可能被截断，或字符串内有未转义换行）',
        missing_field: `JSON中没有顶层字段“${expectedField}”；模型实际返回的顶层键：${foundKeys.join('、') || '无'}；完整JSON文档${documentCount}个`,
      }[reason] || `本块输出无法使用（${reason}）`];
      if (!errors.length) return parsed;
      failure = { part: name, attempt: attempt + 1, errors: errors.slice(0, 12),
        reason, expectedField, outputChars: content.length, finishReason: result?.finishReason || null,
        jsonModeRequested: result?.jsonModeRequested === true, malformedStreamFrames: result?.malformedStreamFrames || 0,
        stitchedRounds: result?.stitchedRounds || 0, documentCount, foundKeys };
      onFailure?.(failure);
      if (parsed && recoverPartial) {
        const recovered = await recoverPartial(parsed);
        if (recovered) return recovered;
      }
      if (split && (result?.finishReason === 'length' || reason === 'invalid_json')) {
        onStatus?.(`蓝图 ${step}/3：${name}输出不完整，拆成两批继续...`);
        return split();
      }
      if (!attempt && parsed && planRepair) repair = planRepair(parsed, errors);
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

  const generatePhases = async (anchors, previous = null, allowSplit = true, next = null) => {
    const start = Number(anchors[0].startChapter);
    const end = Number(anchors.at(-1).endChapter);
    const stageExample = { title: '篇章或小阶段名', startChapter: start, endChapter: Number(anchors[0].endChapter),
      goal: '具体目标', obstacle: '阻力', reversal: '反转', threads: ['支线'],
      tagCommitments: ['标签原名：兑现动作'],
      characterBeats: [{ character: '角色', goal: '目标', conflict: '冲突', change: '变化', voiceGuard: '声线' }],
      requiredScenes: ['具体场景'], forbiddenDrift: ['禁止偏移'], entryCondition: '进入条件', exitCondition: '离开条件',
      foreshadowing: [{ name: '伏笔', setupChapter: start, progressChapters: [], payoffChapter: Number(anchors[0].endChapter), plan: '铺设回收' }],
      unresolvedQuestions: ['未决问题'] };
    const split = allowSplit && anchors.length > 1 ? async () => {
      const middle = Math.ceil(anchors.length / 2);
      const { phases: first } = await generatePhases(anchors.slice(0, middle), previous, false);
      const { phases: second } = await generatePhases(anchors.slice(middle), first.at(-1), false, next);
      return { phases: [...first, ...second] };
    } : undefined;
    const validatePhase = (phase, anchor) => {
      const { startChapter, endChapter } = anchor;
      const label = `第${startChapter}-${endChapter}章篇章`;
      const errors = stageErrors(phase, label, tagOptional);
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
      return errors;
    };
    const recoverPartial = async parsed => {
      if (anchors.length <= 1 || !Array.isArray(parsed.phases) || parsed.phases.length === anchors.length) return null;
      // A row is reusable only if its range is unique and its complete contents
      // satisfy the same checks as a normal batch. Never stretch one row over
      // missing anchors, and never reuse duplicate or malformed candidates.
      const retained = anchors.map(anchor => {
        const matches = parsed.phases.filter(phase => Number(phase?.startChapter) === Number(anchor.startChapter)
          && Number(phase?.endChapter) === Number(anchor.endChapter));
        return matches.length === 1 && !validatePhase(matches[0], anchor).length ? matches[0] : null;
      });
      const count = retained.filter(Boolean).length;
      onStatus?.(`蓝图 2/3：篇章第${start}-${end}章数量不符，保留${count}个已校验篇章，拆分补齐其余篇章...`);
      if (!count) {
        const middle = Math.ceil(anchors.length / 2);
        const { phases: first } = await generatePhases(anchors.slice(0, middle), previous, allowSplit);
        const { phases: second } = await generatePhases(anchors.slice(middle), first.at(-1), allowSplit, next);
        return { phases: [...first, ...second] };
      }
      const phases = [];
      for (let i = 0; i < anchors.length;) {
        aborted();
        if (retained[i]) { phases.push(retained[i++]); continue; }
        let endIndex = i + 1;
        while (endIndex < anchors.length && !retained[endIndex]) endIndex++;
        const generated = await generatePhases(anchors.slice(i, endIndex), phases.at(-1) || previous,
          allowSplit, retained[endIndex] || next);
        phases.push(...generated.phases);
        i = endIndex;
      }
      return { phases };
    };
    return task(2, `篇章第${start}-${end}章`, 'phases',
      `按顺序细化第${start}-${end}章的以下${anchors.length}个篇章，逐一保持原有章节范围：${JSON.stringify(anchors)}。
全书主线：${outline.mainArc}
不可改写事实：${JSON.stringify(outline.lockedFacts)}
${previous ? `上一批最后一个篇章的衔接约束：${JSON.stringify({ title: previous.title, endChapter: previous.endChapter, exitCondition: previous.exitCondition, unresolvedQuestions: previous.unresolvedQuestions })}\n` : ''}相邻篇章的进入条件要承接前一篇章的离开条件。
${next ? `下一已确定篇章的衔接约束：${JSON.stringify({ title: next.title, startChapter: next.startChapter, entryCondition: next.entryCondition })}\n本批末尾必须衔接上述进入条件，不得改写已保留篇章。` : ''}
phases数组必须恰好包含${anchors.length}个篇章，按以下范围逐项输出，不能合并或只输出第一个：${JSON.stringify(anchors.map(({ title, startChapter, endChapter }) => ({ title, startChapter, endChapter })))}。
返回结构示例（仅演示一个篇章元素的字段，实际数组必须填齐上述${anchors.length}个篇章）：${JSON.stringify({ phases: [{ ...stageExample, subphases: [stageExample] }] })}。
跨度较长的篇章，用现有reversal标明关键选择发生在第几章及其结果，用exitCondition写清阶段末章的新局面。伏笔用已有章号字段安排埋设与回收，优先沿用大纲已定的章号。
每个篇章的subphases连续覆盖本篇章，通常2个，章数不足时1个，最多8个。篇章及每一个subphase都必须逐一填写这些字段：${STAGE_ARRAYS.join('、')}、entryCondition、exitCondition。
尤其注意：父篇章有foreshadowing和unresolvedQuestions不代表小阶段可以省略。每个小阶段必须单独填写非空foreshadowing数组（每项含name、plan及相应章号）和非空unresolvedQuestions字符串数组，具体说明它如何埋设、推进或回收伏笔，以及仍需解答的问题。
各数组优先写1-2项直接相关的内容，保留分配的全部标签及其原名。各条写简短具体的事件和约束，避免在篇章和小阶段重复描述。未选标签时tagCommitments可为空。不要写执行卡。`, parsed => {
        if (!Array.isArray(parsed.phases) || parsed.phases.length !== anchors.length) {
          return [`篇章数量不符：要求${anchors.length}个，实际${Array.isArray(parsed.phases) ? parsed.phases.length : 0}个`];
        }
        return parsed.phases.flatMap((phase, index) => validatePhase(phase, anchors[index]));
      }, 32000, split, planPhaseRepair, recoverPartial);
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
