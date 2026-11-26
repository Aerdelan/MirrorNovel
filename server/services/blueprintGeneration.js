const { inspectStructuredPayload } = require('./blueprintPayload');
const { prosePrompt, parseBlueprintProse } = require('./blueprintProse');
const { getClosingWindowStart } = require('./storyState');

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

function stageErrors(stage, label = '阶段', tagOptional = false, terminal = false) {
  if (typeof stage?.planText === 'string') {
    if (stage.planText.trim().length < 40) return [`${label}剧情规划内容过短，需写出具体事件、人物选择和结果`];
    return requireText(stage.title) && requireText(stage.goal) ? [] : [`${label}缺少篇章标题或剧情内容`];
  }
  const errors = [];
  for (const field of ['title', 'goal', 'entryCondition', 'exitCondition']) {
    if (!requireText(stage?.[field])) errors.push(`${label}缺少${field}`);
  }
  for (const field of STAGE_ARRAYS) {
    if (terminal && field === 'unresolvedQuestions' && Array.isArray(stage?.[field]) && !stage[field].length) continue;
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

const validFacts = value => Array.isArray(value) && value.every(requireText);

function overviewPhaseErrors(phase, label = '概览篇章') {
  const errors = [];
  if (!requireText(phase?.title) || !requireText(phase?.goal)) errors.push(`${label}缺少title或goal`);
  return errors;
}

function overviewErrors(parsed, totalChapters, arcCount, requiredTags) {
  const errors = [];
  if (!requireText(parsed.mainArc)) errors.push('mainArc不能为空');
  if (!validFacts(parsed.lockedFacts)) errors.push('lockedFacts必须是事实字符串数组，可为空，不能编造原大纲没有的事实');
  if (!hasItems(parsed.phases) || parsed.phases.length !== arcCount) errors.push(`phases必须有${arcCount}个篇章`);
  if (Array.isArray(parsed.phases)) {
    errors.push(...rangeErrors(parsed.phases, 1, totalChapters, '概览篇章范围'));
    parsed.phases.forEach((phase, i) => errors.push(...overviewPhaseErrors(phase, `第${i + 1}个篇章`)));
    const commitments = parsed.phases.flatMap(phase => Array.isArray(phase?.tagCommitments) ? phase.tagCommitments : []).join('、');
    for (const tag of requiredTags) {
      if (!commitments.includes(tag)) errors.push(`所选标签“${tag}”没有分配到任何篇章（已写标签：${commitments || '无'}）`);
    }
  }
  return errors;
}

// When otherwise valid phases omit these two arrays, request only the missing
// content. Never invent placeholders or copy a parent's plan into its children.
function planPhaseRepair(parsed, errors, totalChapters) {
  if (!errors.length || !errors.every(error => /缺少(?:foreshadowing|unresolvedQuestions)$/.test(error))) return null;
  const targets = [];
  for (const phase of parsed.phases) {
    for (const stage of [phase, ...phase.subphases]) {
      const fields = ['foreshadowing', 'unresolvedQuestions'].filter(field => !hasItems(stage[field])
        && !(field === 'unresolvedQuestions' && Number(stage.endChapter) === totalChapters && Array.isArray(stage[field])));
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
phaseStartChapter和subphaseStartChapter必须与目标清单一致；修复篇章本身时subphaseStartChapter为null。每个目标只输出一次，只输出其fields要求补充的字段。每个数组至少1项；全书末章的unresolvedQuestions可用空数组。不能用“无”“待补充”等占位；foreshadowing每项必须有非空name和plan。不得输出phases、改写标题、章节范围或其他已通过的内容。`,
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
  request, onUsage, onStatus, onFailure, signal, outputStyle = 'json' }) {
  const tagOptional = requiredTags.length === 0;
  const closingStart = getClosingWindowStart(totalChapters);
  const planningContext = `${context}\n\n【全书收束安排】第${closingStart}至${totalChapters}章处理终局。将主线结果、人物选择的后果和重要伏笔回收分配到具体章号。所有重要问题须在第${totalChapters}章及以前给出答案，终章落在结果发生后的具体场景。`;
  const aborted = () => {
    if (signal?.aborted) { const error = new Error('aborted'); error.name = 'AbortError'; throw error; }
  };
  const task = async (step, name, field, instruction, validate, maxTokens, split, planRepair, recoverPartial) => {
    let failure = null;
    let repair = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      aborted();
      onStatus?.(`蓝图 ${step}/3：${name}${repair ? '（仅补齐缺失字段）' : attempt ? '（仅修复本块）' : ''}...`);
      const prompt = outputStyle === 'prose'
        ? prosePrompt({ context: planningContext, instruction, name, field, failure, requiredTags })
        : `${planningContext}\n\n【本次仅执行的分块任务】\n${repair ? repair.instruction : instruction}
本次只输出上面要求的一个JSON对象，不能输出整份三级蓝图、其他分块、解释或代码围栏。
${failure && !repair ? `【上次本块校验失败】${JSON.stringify(failure.errors)}\n从头返回本块完整的JSON对象，保留要求的顶层字段 ${field}。各字段只写必要细节，优先保证字段完整和JSON闭合。` : ''}`;
      const result = await request({ name, prompt, attempt, maxTokens });
      onUsage?.(result);
      aborted();
      const content = String(result?.content || '');
      const expectedField = repair ? 'repairs' : field;
      const inspection = outputStyle === 'prose' ? parseBlueprintProse(content, field, requiredTags) : inspectStructuredPayload(content, expectedField);
      const patch = outputStyle === 'prose' && repair ? inspectStructuredPayload(content, 'repairs').parsed : null;
      const { parsed: response, reason: parseReason, documentCount = 0, foundKeys = [] } = inspection;
      const applied = repair && (patch || (outputStyle !== 'prose' && response)) ? repair.apply(patch || response) : null;
      const parsed = applied ? applied.parsed : response;
      const truncatedText = inspection.prose && result?.finishReason === 'length';
      const reason = truncatedText ? 'output_truncated' : parsed ? 'part_invalid'
        : result?.finishReason === 'length' ? 'output_truncated'
          : !content.trim() ? 'empty_output' : parseReason;
      const errors = truncatedText ? ['剧情文本尚未生成完整，需要接续或拆分生成'] : applied?.errors.length ? applied.errors : parsed ? validate(parsed) : [{
        output_truncated: '模型输出达到上限，本块未完整返回（finishReason=length）',
        empty_output: '模型未返回蓝图内容（输出为空）',
        invalid_json: '未能从输出中提取到完整JSON文档（可能被截断，或字符串内有未转义换行）',
        invalid_text: '未识别到本次要求的篇章或章节标题，请返回完整的分段剧情文本',
        missing_field: `JSON中没有顶层字段“${expectedField}”；模型实际返回的顶层键：${foundKeys.join('、') || '无'}；完整JSON文档${documentCount}个`,
      }[reason] || `本块输出无法使用（${reason}）`];
      if (!errors.length) return parsed;
      failure = { part: name, attempt: attempt + 1, errors: errors.slice(0, 12),
        reason, expectedField, outputChars: content.length, finishReason: result?.finishReason || null,
        jsonModeRequested: result?.jsonModeRequested === true, malformedStreamFrames: result?.malformedStreamFrames || 0,
        stitchedRounds: result?.stitchedRounds || 0, documentCount, foundKeys };
      onFailure?.(failure);
      if (parsed && !truncatedText && recoverPartial) {
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

  // These are chapter boundaries only, not invented story content. A complete,
  // valid model plan keeps its own boundaries; scaffolding is used for examples
  // and to bound recovery when the overview is incomplete.
  const overviewSlots = Array.from({ length: arcCount }, (_, i) => ({
    startChapter: Math.floor(i * totalChapters / arcCount) + 1,
    endChapter: Math.floor((i + 1) * totalChapters / arcCount),
  }));
  const overviewExample = { mainArc: '主线因果与终局', lockedFacts: [],
    phases: overviewSlots.map(slot => ({ title: '填写该篇章的具体名称', ...slot, goal: '具体目标',
      obstacle: '阻力', reversal: '反转', threads: ['支线'], tagCommitments: requiredTags.map(tag => `${tag}：具体兑现动作`) })) };
  let lastOverview = null;
  const overviewAttempts = [];
  let outline;
  try {
    outline = await task(1, '全书概览', 'mainArc',
    `只设计全书主线、不可改写事实与${arcCount}个连续大篇章的简明概览，覆盖第1-${totalChapters}章。
返回包含全部${arcCount}个篇章的JSON，结构示例：${JSON.stringify(overviewExample)}。
phases必须恰好有${arcCount}项，不是只填示例的第一项。按大纲节奏自行划分连续范围，示例章号不是固定值。每个所选标签至少分配到一个篇章，使用标签原名。
lockedFacts必须显式返回字符串数组，只摘取用户大纲已明确的事实，不把新设计当作事实；没有明确事实时返回[]，不能省略、返回null、字符串或对象。
这一步不输出subphases或rollingPlan，每篇章概览控制在150字左右。所选标签：${requiredTags.join('、')}`, parsed => {
      lastOverview = parsed;
      overviewAttempts.push(parsed);
      return overviewErrors(parsed, totalChapters, arcCount, requiredTags);
    }, 16000);
  } catch (error) {
    // Recover only when an attempt produced a parsed, invalid overview.
    // Upstream errors, cancellations and timeouts retain their failure path.
    if (error.code !== 'BLUEPRINT_PART_INVALID' || !lastOverview) throw error;
    aborted();
    onStatus?.('蓝图 1/3：全书概览仍不完整，保留有效内容，分项补齐事实与篇章...');
    const knownMainArc = overviewAttempts.find(item => requireText(item.mainArc))?.mainArc;
    const knownFacts = overviewAttempts.find(item => validFacts(item.lockedFacts))?.lockedFacts;
    const mainArc = knownMainArc || (await task(1, '概览主线', 'mainArc',
      '只根据用户大纲返回{"mainArc":"全书主线因果与终局"}，不输出事实、篇章或其他字段。',
      parsed => requireText(parsed.mainArc) ? [] : ['mainArc不能为空'], 4000)).mainArc;
    const lockedFacts = knownFacts || (await task(1, '概览事实', 'lockedFacts',
      '只摘取用户大纲中明确给出的不可改写事实，返回{"lockedFacts":["事实原文或准确转述"]}。lockedFacts必须是字符串数组，没有明确事实则返回[]；禁止编造事实，禁止将新剧情设计或上次无效的lockedFacts作为事实，不输出其他字段。',
      parsed => validFacts(parsed.lockedFacts) ? [] : ['lockedFacts必须是事实字符串数组，可为空'], 4000)).lockedFacts;
    // If the returned chapter partition is already complete, keep it even if
    // titles or tags need repair. Otherwise use an explicit, continuous layout.
    const partition = overviewAttempts.find(item => Array.isArray(item.phases)
      && item.phases.length === arcCount && !rangeErrors(item.phases, 1, totalChapters).length);
    const candidates = partition?.phases || (Array.isArray(lastOverview.phases) ? lastOverview.phases : []);
    const slots = candidates.length === arcCount && !rangeErrors(candidates, 1, totalChapters).length
      ? candidates.map(({ startChapter, endChapter }) => ({ startChapter, endChapter })) : overviewSlots;
    const tagSlots = requiredTags.map((tag, i) => {
      const assigned = slots.findIndex(slot => candidates.some(phase =>
        Number(phase?.startChapter) === Number(slot.startChapter) && Number(phase?.endChapter) === Number(slot.endChapter)
        && Array.isArray(phase?.tagCommitments) && phase.tagCommitments.join('、').includes(tag)));
      return assigned < 0 ? i % arcCount : assigned;
    });
    const phases = [];
    for (const [index, slot] of slots.entries()) {
      aborted();
      // Assign each required tag to a recovery slot so omission cannot silently
      // drop the global tag contract. No tags or story facts are invented here.
      const assignedTags = requiredTags.filter((_, i) => tagSlots[i] === index);
      const validate = phase => {
        const errors = overviewPhaseErrors(phase);
        errors.push(...rangeErrors([phase], Number(slot.startChapter), Number(slot.endChapter), '概览篇章范围'));
        const commitments = Array.isArray(phase?.tagCommitments) ? phase.tagCommitments.join('、') : '';
        for (const tag of assignedTags) if (!commitments.includes(tag)) errors.push(`概览篇章缺少所选标签“${tag}”`);
        return errors;
      };
      const matches = candidates.filter(phase => Number(phase?.startChapter) === Number(slot.startChapter)
        && Number(phase?.endChapter) === Number(slot.endChapter));
      if (matches.length === 1 && !validate(matches[0]).length) { phases.push(matches[0]); continue; }
      const { phase } = await task(1, `概览篇章第${slot.startChapter}-${slot.endChapter}章`, 'phase',
        `只补齐一个概览篇章，固定覆盖第${slot.startChapter}-${slot.endChapter}章。全书主线：${mainArc}
不可改写事实：${JSON.stringify(lockedFacts)}
全书篇章范围：${JSON.stringify(slots)}
此前已确定的概览篇章：${JSON.stringify(phases)}
后续已有概览内容（仅供衔接，不能改写原始大纲）：${JSON.stringify(candidates.filter(item => Number(item?.startChapter) > Number(slot.endChapter)))}
本篇章必须兑现的标签：${assignedTags.join('、')}。约150字，尊重大纲在该范围的事件、转折和终局，不输出subphases或其他篇章。
返回{"phase":{"title":"具体篇章名","startChapter":${slot.startChapter},"endChapter":${slot.endChapter},"goal":"目标","obstacle":"阻力","reversal":"反转","threads":["支线"],"tagCommitments":["标签原名：兑现动作"]}}。`,
        parsed => validate(parsed.phase), 4000);
      phases.push(phase);
    }
    outline = { mainArc, lockedFacts, phases };
    const errors = overviewErrors(outline, totalChapters, arcCount, requiredTags);
    if (errors.length) {
      error.message = `全书概览分项补齐后仍未通过：${errors.join('；')}`;
      error.diagnostics = { ...error.diagnostics, errors };
      throw error;
    }
  }

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
      const errors = stageErrors(phase, label, tagOptional, Number(endChapter) === totalChapters);
      if (Number(phase?.startChapter) !== Number(startChapter) || Number(phase?.endChapter) !== Number(endChapter)) {
        errors.push(`${label}范围被改写（实际为第${phase?.startChapter ?? '?'}-${phase?.endChapter ?? '?'}章）`);
      }
      const subphases = Array.isArray(phase?.subphases) ? phase.subphases : [];
      if (!subphases.length) {
        if (!phase?.planText) errors.push(`${label}缺少subphases`);
      } else {
        if (subphases.length > 8) errors.push(`${label}的subphases不能超过8个`);
        errors.push(...rangeErrors(subphases, Number(startChapter), Number(endChapter), `${label}的小阶段范围`));
        subphases.forEach((subphase, i) => errors.push(...stageErrors(subphase, `${label}的小阶段${i + 1}`, tagOptional,
          Number(subphase?.endChapter) === totalChapters)));
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
${end === totalChapters ? '本批含终局篇章，分别写出主线冲突的结果、关键伏笔的答案和主要人物的归宿。' : ''}
phases数组必须恰好包含${anchors.length}个篇章，按以下范围逐项输出，不能合并或只输出第一个：${JSON.stringify(anchors.map(({ title, startChapter, endChapter }) => ({ title, startChapter, endChapter })))}。
返回结构示例（仅演示一个篇章元素的字段，实际数组必须填齐上述${anchors.length}个篇章）：${JSON.stringify({ phases: [{ ...stageExample, subphases: [stageExample] }] })}。
跨度较长的篇章，用现有reversal标明关键选择发生在第几章及其结果，用exitCondition写清阶段末章的新局面。伏笔用已有章号字段安排埋设与回收，优先沿用大纲已定的章号。
每个篇章的subphases连续覆盖本篇章，通常2个，章数不足时1个，最多8个。篇章及每一个subphase都必须逐一填写这些字段：${STAGE_ARRAYS.join('、')}、entryCondition、exitCondition。
每个小阶段分别填写foreshadowing数组（每项含name、plan及相应章号）和unresolvedQuestions字符串数组，说明它如何埋设、推进或回收伏笔。结束章号是全书末章时，篇章和小阶段的unresolvedQuestions均可用空数组，写清问题的答案和结果。
各数组优先写1-2项直接相关的内容，保留分配的全部标签及其原名。各条写简短具体的事件和约束，避免在篇章和小阶段重复描述。未选标签时tagCommitments可为空。不要写执行卡。`, parsed => {
        if (!Array.isArray(parsed.phases) || parsed.phases.length !== anchors.length) {
          return [`篇章数量不符：要求${anchors.length}个，实际${Array.isArray(parsed.phases) ? parsed.phases.length : 0}个`];
        }
        return parsed.phases.flatMap((phase, index) => validatePhase(phase, anchors[index]));
      }, 32000, split, (parsed, errors) => planPhaseRepair(parsed, errors, totalChapters), recoverPartial);
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
${end === totalChapters ? `第${totalChapters}章的章末局面要写明主线结果、人物归宿与具体后果。` : ''}
${previous.length ? `已完成执行卡的实际进展：${JSON.stringify(previous.map(card => ({ chapterNumber: card.chapterNumber, title: card.title, purpose: card.purpose, exitHook: card.exitHook })))}\n` : ''}返回{"chapters":[{"chapterNumber":${start},"title":"具体短标题","purpose":"本章新发生的状态变化","tagCommitments":["标签+兑现方式"],"characterBeats":[{"character":"角色","goal":"目标","conflict":"冲突","change":"变化","voiceGuard":"声线"}],"requiredScenes":["场景"],"relationshipChange":"关系变化","foreshadowingActions":["伏笔动作"],"exitHook":"新的章末局面"}]}。
chapterNumber必须连续，每张卡承接前一章的局面，标题和核心事件不能重复。篇章转折和伏笔按已定章号兑现。每个数组写1-2项最相关的内容，未选标签时tagCommitments可为空。`, parsed => {
        if (!Array.isArray(parsed.chapters) || parsed.chapters.length !== end - start + 1) {
          return [`执行卡数量不符：要求${end - start + 1}张，实际${Array.isArray(parsed.chapters) ? parsed.chapters.length : 0}张`];
        }
        const errors = [];
        parsed.chapters.forEach((card, index) => {
          const label = `第${Number(card?.chapterNumber) || start + index}章执行卡`;
          if (Number(card?.chapterNumber) !== start + index) errors.push(`${label}章节号缺失或顺序错位（应为第${start + index}章）`);
          if (requireText(card?.planText)) {
            if (!requireText(card.title) || !requireText(card.purpose) || card.planText.trim().length < 30) errors.push(`${label}剧情内容过短或缺少标题`);
            return;
          }
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
