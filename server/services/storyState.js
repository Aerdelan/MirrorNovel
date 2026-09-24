/**
 * Structured story-state helpers for long-form generation.
 * They deliberately tolerate legacy novels that do not yet have these fields.
 */

const { TONES, ELEMENTS, CHARACTERS, CATEGORY_TREE } = require('../config/novelTypeSku');

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function splitItems(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(/[、,，；;]/).map((item) => item.trim()).filter(Boolean);
}

function normalizePlanChapter(chapter) {
  chapter = chapter || {};
  const rawTension = Number(chapter.tension);
  return {
    chapterNumber: Number(chapter.chapterNumber || chapter.number || chapter.chapter || 0),
    wordTarget: Number(chapter.wordTarget || chapter.targetWords || chapter.wordCount || 0),
    title: normalizeChapterTitle(chapter.title || chapter.chapterTitle || chapter.shortTitle || ''),
    coreEvent: String(chapter.coreEvent || chapter.event || chapter.theme || '').trim(),
    setHooks: splitItems(chapter.setHooks || chapter.foreshadowing || chapter.plantHooks),
    resolveHooks: splitItems(chapter.resolveHooks || chapter.revealHooks || chapter.collectHooks),
    characters: splitItems(chapter.characters || chapter.keyCharacters),
    chapterRole: String(chapter.chapterRole || '').trim(),
    subplotFocus: String(chapter.subplotFocus || chapter.subplot || '').trim(),
    relationshipBeat: String(chapter.relationshipBeat || chapter.relationship || '').trim(),
    breathingPurpose: String(chapter.breathingPurpose || '').trim(),
    tagCommitments: splitItems(chapter.tagCommitments || chapter.tags),
    characterBeat: String(chapter.characterBeat || chapter.characterVoice || '').trim(),
    requiredScenes: splitItems(chapter.requiredScenes || chapter.scenes),
    forbiddenDrift: splitItems(chapter.forbiddenDrift || chapter.driftGuards),
    // Keep an omitted tension as 0 so buildEmotionPlan can apply the story-level
    // rhythm instead of treating every incomplete legacy plan as low pressure.
    tension: Number.isFinite(rawTension) && rawTension > 0 ? Math.max(1, Math.min(10, rawTension)) : 0,
    phase: String(chapter.phase || '').trim(),
    raw: String(chapter.raw || ''),
  };
}

function normalizeChapterTitle(value) {
  return String(value || '')
    .replace(/^\s*第\s*\d+\s*章\s*[-:：·、.．]?\s*/i, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[。！？!?；;]+$/g, '')
    .replace(/[“”"'《》【】]/g, '')
    .trim()
    .slice(0, 24);
}

function deriveChapterTitle(planChapter) {
  const explicit = normalizeChapterTitle(planChapter?.title);
  if (explicit) return explicit;
  const event = String(planChapter?.coreEvent || '')
    .replace(/^(本章|主角|故事)?(?:需要|将|要)?/i, '')
    .replace(/（[^）]*）|\([^)]*\)/g, '')
    .trim();
  if (!event) return '故事未尽';
  const candidate = event.split(/[，。；：:！!?]/)[0].trim();
  return normalizeChapterTitle(candidate) || '故事未尽';
}

/** Parse both legacy one-line plans and a JSON-shaped plan object. */
function parseChapterPlan(rawPlan) {
  if (!rawPlan) return { version: 1, chapters: [], phases: [] };
  if (typeof rawPlan === 'object' && Array.isArray(rawPlan.chapters)) {
    return {
      version: rawPlan.version || 1,
      phases: toArray(rawPlan.phases),
      chapters: rawPlan.chapters.map((chapter) => Array.isArray(chapter)
        ? normalizePlanChapter({
          chapterNumber: chapter[0], wordTarget: chapter[1], coreEvent: chapter[2],
          setHooks: chapter[3], resolveHooks: chapter[4], characters: chapter[5],
          chapterRole: chapter[6], tension: chapter[7], title: chapter[8],
          phase: chapter[9], subplotFocus: chapter[10], relationshipBeat: chapter[11], breathingPurpose: chapter[12],
          tagCommitments: chapter[13], characterBeat: chapter[14], requiredScenes: chapter[15], forbiddenDrift: chapter[16],
        })
        : normalizePlanChapter(chapter)).filter((item) => item.chapterNumber > 0),
    };
  }

  // 新版计划要求 JSON；这里同时容忍模型把 JSON 包在 markdown 代码块中。
  const rawText = String(rawPlan).trim();
  const cleanText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const jsonCandidate = cleanText.match(/\{[\s\S]*\}/) || cleanText.match(/\[[\s\S]*\]/);
  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate[0]);
      const value = Array.isArray(parsed) ? { chapters: parsed } : parsed;
      if (value && Array.isArray(value.chapters)) {
        return {
          version: value.version || 1,
          phases: toArray(value.phases),
          chapters: value.chapters.map((chapter) => Array.isArray(chapter)
            ? normalizePlanChapter({
              chapterNumber: chapter[0], wordTarget: chapter[1], coreEvent: chapter[2],
              setHooks: chapter[3], resolveHooks: chapter[4], characters: chapter[5],
              chapterRole: chapter[6], tension: chapter[7], title: chapter[8],
              phase: chapter[9], subplotFocus: chapter[10], relationshipBeat: chapter[11], breathingPurpose: chapter[12],
              tagCommitments: chapter[13], characterBeat: chapter[14], requiredScenes: chapter[15], forbiddenDrift: chapter[16],
            })
            : normalizePlanChapter(chapter)).filter((item) => item.chapterNumber > 0),
        };
      }
    } catch (_) {
      // 计划文本不是合法 JSON 时继续使用兼容的逐行解析。
    }
  }

  const chapters = [];
  const phases = [];
  let phase = '';
  for (const rawLine of String(rawPlan).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^[*#\s]*(阶段\s*\d+|Phase\s*\d+)\s*[:：]?/i.test(line) && !/第\s*\d+\s*章/.test(line)) {
      phase = line;
      phases.push(line);
      continue;
    }
    // 兼容多种常见格式: `第1章`, `第1章：xxx`, `第1章(3000字) xxx`, `**第1章** xxx`, `## 第1章 xxx`
    // 先剥掉前导的 markdown 符号 (#, **, *) 方便后续匹配
    const stripped = line.replace(/^[#*\s]+/, '').replace(/^\*\*+|\*\*+$/g, '');
    const match = stripped.match(/第\s*(\d+)\s*章\s*(?:[（(]([^）)]*)[）)])?\s*[:：]?\s*(.*)$/);
    if (!match) continue;
    const fields = (match[3] || '').split('|').map((item) => item.trim()).filter(Boolean);
    const findField = (labels) => {
      const item = fields.find((value) => new RegExp('(?:' + labels + ')\\s*[:：]', 'i').test(value));
      return item ? item.replace(new RegExp('^.*?(?:' + labels + ')\\s*[:：]', 'i'), '').trim() : '';
    };
    chapters.push(normalizePlanChapter({
      chapterNumber: Number(match[1]),
      wordTarget: Number(((match[2] || '').match(/\d{3,6}/) || [])[0] || 0),
      title: findField('标题|章节名|章名'),
      coreEvent: (fields[0] || match[3] || '').replace(/^本章(?:核心事件|主题)?\s*[:：]?/i, ''),
      setHooks: splitItems(findField('埋伏笔|设置伏笔')),
      resolveHooks: splitItems(findField('回收伏笔|回收')),
      characters: splitItems(findField('关键角色|角色')),
      chapterRole: /喘息|缓冲|休整|日常/.test(line) ? '喘息推进' : (/大结局|收束/.test(line) ? '收束' : ''),
      phase,
      raw: line,
    }));
  }
  return { version: 1, chapters, phases };
}

/**
 * 为已有大纲但缺少可解析计划的作品建立保守的本地兜底计划。
 * 它不伪造具体剧情，正文仍以大纲和章节契约为准；作用是让长篇任务
 * 能安全恢复，并避免超长 JSON 计划被截断后把整本生成永久卡死。
 */
function buildFallbackChapterPlan(novel, options = {}) {
  const targetWords = Math.max(3000, Number(options.targetWords || novel?.targetWordCount || 50000));
  const startChapter = Math.max(1, Number(options.startChapter || 1));
  // 每章字数随作品设定（用户在生成页选择的每章字数，福尔摩斯式大章可到 1 万+）。
  const chapterWords = Math.max(1200, Math.min(20000, Number(options.chapterWordTarget || novel?.chapterWordTarget || 3000)));
  const totalChapters = Math.max(startChapter, Math.ceil(targetWords / chapterWords));
  const outline = String(novel?.outline || '').replace(/\s+/g, ' ').trim();
  const phases = [
    { until: 0.18, name: '开端', goal: '建立人物处境、核心目标与第一个明确阻力' },
    { until: 0.48, name: '发展', goal: '沿主线调查、行动或关系推进，逐步扩大代价' },
    { until: 0.72, name: '转折', goal: '揭示关键真相或迫使主角改变原有选择' },
    { until: 0.9, name: '高潮', goal: '让主角承担代价，集中推进主要冲突与伏笔' },
    { until: 1, name: '收束', goal: '回收主线与关键关系，给出具体后果和余波' },
  ];
  const chapters = [];
  for (let number = startChapter; number <= totalChapters; number++) {
    const ratio = number / totalChapters;
    const phase = phases.find((item) => ratio <= item.until) || phases.at(-1);
    const finalChapter = number === totalChapters;
    const breathing = !finalChapter && number > 3 && number % 7 === 0;
    chapters.push(normalizePlanChapter({
      chapterNumber: number,
      wordTarget: chapterWords,
      phase: phase.name,
      coreEvent: finalChapter
        ? `依据大纲完成主线收束：${outline.slice(0, 120) || '给出主角目标的具体结果'}`
        : `${phase.goal}（第${number}章，严格承接前章结果）`,
      title: finalChapter ? '尘埃落定' : `${phase.name}之变`,
      setHooks: [],
      resolveHooks: [],
      characters: [],
      chapterRole: finalChapter ? '收束' : (breathing ? '喘息推进' : '主线推进'),
      tension: finalChapter ? 8 : (breathing ? 4 : (ratio > 0.72 ? 8 : 6)),
      raw: '本地兜底计划',
    }));
  }
  return {
    version: 1,
    phases: phases.map((item) => `${item.name}：${item.goal}`),
    chapters,
    fallback: true,
  };
}

function renderPlanForContext(planData, currentChapter) {
  const plan = parseChapterPlan(planData);
  const current = Number(currentChapter || 1);
  return plan.chapters
    .filter((item) => item.chapterNumber >= current)
    .slice(0, 12)
    .map((item) => {
      const pieces = [
        '第' + item.chapterNumber + '章《' + deriveChapterTitle(item) + '》(' + (item.wordTarget || '按节奏') + '字): ' + (item.coreEvent || '推进主线'),
        item.setHooks.length ? '埋伏笔: ' + item.setHooks.join('、') : '',
        item.resolveHooks.length ? '回收伏笔: ' + item.resolveHooks.join('、') : '',
        item.characters.length ? '关键角色: ' + item.characters.join('、') : '',
        item.subplotFocus ? '支线焦点: ' + item.subplotFocus : '',
        item.relationshipBeat ? '关系变化: ' + item.relationshipBeat : '',
        item.breathingPurpose ? '缓冲功能: ' + item.breathingPurpose : '',
        item.tagCommitments.length ? '标签兑现: ' + item.tagCommitments.join('、') : '',
        item.characterBeat ? '人物/声线: ' + item.characterBeat : '',
        item.requiredScenes.length ? '必备场景: ' + item.requiredScenes.join('、') : '',
        item.forbiddenDrift.length ? '禁止漂移: ' + item.forbiddenDrift.join('、') : '',
      ].filter(Boolean);
      return pieces.join(' | ');
    })
    .join('\n');
}

function ensureCreativeState(novel) {
  if (!novel.storyBible) novel.storyBible = {};
  if (!Array.isArray(novel.characterStates)) novel.characterStates = [];
  if (!Array.isArray(novel.plotThreads)) novel.plotThreads = [];
  if (!Array.isArray(novel.foreshadowingLedger)) novel.foreshadowingLedger = [];
  if (!Array.isArray(novel.emotionCurve)) novel.emotionCurve = [];
  if (!Array.isArray(novel.recentEventSignatures)) novel.recentEventSignatures = [];
  return novel;
}

function initializeCreativeState(novel) {
  ensureCreativeState(novel);
  if (!novel.storyBible.theme) novel.storyBible.theme = String(novel.outline || '').slice(0, 160);
  if (!novel.storyBible.tone) novel.storyBible.tone = novel.novelTypeName || '由故事场景自然决定';
  if (!novel.storyBible.narrativeView) novel.storyBible.narrativeView = '与主角贴近的有限视角';
  if (!novel.plotThreads.length) {
    novel.plotThreads.push({
      id: 'main',
      title: '主线',
      type: 'main',
      status: 'active',
      nextMilestone: '按照大纲推进主角的核心目标',
      lastChapter: 0,
    });
  }
  return novel;
}

function textList(value, limit = 12) {
  return splitItems(value).slice(0, limit).map((item) => item.slice(0, 180));
}

function shortText(value, limit = 420) {
  return String(value || '').trim().slice(0, limit);
}

function normalizeCharacterBeat(beat) {
  if (typeof beat === 'string') {
    return { character: '', goal: shortText(beat, 240), conflict: '', change: '', voiceGuard: '' };
  }
  beat = beat || {};
  return {
    character: shortText(beat.character || beat.name, 80),
    goal: shortText(beat.goal || beat.objective, 240),
    conflict: shortText(beat.conflict, 240),
    change: shortText(beat.change || beat.arc, 240),
    voiceGuard: shortText(beat.voiceGuard || beat.voice || beat.speechConstraint, 300),
  };
}

function normalizeForeshadowing(item) {
  if (typeof item === 'string') {
    return { name: shortText(item, 160), setupChapter: 0, progressChapters: [], payoffChapter: 0, plan: '' };
  }
  item = item || {};
  return {
    name: shortText(item.name || item.thread || item.hook, 160),
    setupChapter: Math.max(0, Number(item.setupChapter || item.setChapter || 0)),
    progressChapters: toArray(item.progressChapters || item.developmentChapters)
      .map(Number).filter((chapter) => Number.isFinite(chapter) && chapter > 0).slice(0, 12),
    payoffChapter: Math.max(0, Number(item.payoffChapter || item.resolveChapter || item.targetChapter || 0)),
    plan: shortText(item.plan || item.progression || item.meaning, 360),
  };
}

function normalizeBlueprintStage(stage, fallbackStart, fallbackEnd, includeSubphases = false) {
  stage = stage || {};
  const start = Math.max(1, Math.round(Number(stage.startChapter || fallbackStart || 1)));
  const end = Math.max(start, Math.round(Number(stage.endChapter || fallbackEnd || start)));
  const normalized = {
    title: shortText(stage.title || '剧情阶段', 80),
    startChapter: start,
    endChapter: end,
    goal: shortText(stage.goal, 420),
    obstacle: shortText(stage.obstacle, 420),
    reversal: shortText(stage.reversal || stage.turningPoint, 420),
    threads: textList(stage.threads, 8),
    tagCommitments: textList(stage.tagCommitments, 16),
    characterBeats: toArray(stage.characterBeats).slice(0, 16).map(normalizeCharacterBeat)
      .filter((beat) => beat.character || beat.goal || beat.conflict || beat.change || beat.voiceGuard),
    requiredScenes: textList(stage.requiredScenes, 12),
    forbiddenDrift: textList(stage.forbiddenDrift, 12),
    entryCondition: shortText(stage.entryCondition, 360),
    exitCondition: shortText(stage.exitCondition, 360),
    foreshadowing: toArray(stage.foreshadowing).slice(0, 16).map(normalizeForeshadowing)
      .filter((item) => item.name || item.plan),
    unresolvedQuestions: textList(stage.unresolvedQuestions, 12),
  };
  if (includeSubphases) {
    const source = toArray(stage.subphases);
    normalized.subphases = source.slice(0, 8).map((subphase, index) => normalizeBlueprintStage(
      subphase,
      index ? Number(source[index - 1]?.endChapter || start) + 1 : start,
      end,
      false
    ));
  }
  return normalized;
}

function normalizeBlueprintPhase(phase, fallbackStart, fallbackEnd) {
  return normalizeBlueprintStage(phase, fallbackStart, fallbackEnd, true);
}

function normalizeRollingChapter(chapter, fallbackNumber) {
  chapter = chapter || {};
  return {
    chapterNumber: Math.max(1, Math.round(Number(chapter.chapterNumber || fallbackNumber || 1))),
    title: shortText(chapter.title, 80),
    purpose: shortText(chapter.purpose || chapter.goal, 360),
    tagCommitments: textList(chapter.tagCommitments, 8),
    characterBeats: toArray(chapter.characterBeats).slice(0, 10).map(normalizeCharacterBeat)
      .filter((beat) => beat.character || beat.goal || beat.conflict || beat.change || beat.voiceGuard),
    requiredScenes: textList(chapter.requiredScenes || chapter.scenes, 8),
    relationshipChange: shortText(chapter.relationshipChange, 300),
    foreshadowingActions: textList(chapter.foreshadowingActions, 8),
    exitHook: shortText(chapter.exitHook || chapter.hook, 300),
  };
}

function normalizeRollingPlan(rawPlan, totalChapters) {
  rawPlan = rawPlan || {};
  const total = Math.max(1, Number(totalChapters || 1));
  const start = Math.max(1, Math.min(total, Math.round(Number(rawPlan.startChapter || 1))));
  const end = Math.max(start, Math.min(total, Math.round(Number(rawPlan.endChapter || Math.min(total, start + 19)))));
  return {
    startChapter: start,
    endChapter: end,
    calibratedAtChapter: Math.max(0, Math.round(Number(rawPlan.calibratedAtChapter || 0))),
    objective: shortText(rawPlan.objective || rawPlan.goal, 420),
    tagCommitments: textList(rawPlan.tagCommitments, 16),
    forbiddenDrift: textList(rawPlan.forbiddenDrift, 12),
    chapters: toArray(rawPlan.chapters).slice(0, 20).map((chapter, index) => normalizeRollingChapter(chapter, start + index))
      .filter((chapter) => chapter.chapterNumber >= start && chapter.chapterNumber <= end),
  };
}

function blueprintRequirements(totalChapters) {
  const total = Math.max(1, Number(totalChapters || 1));
  return {
    arcCount: Math.min(total, Math.max(10, Math.min(16, Math.ceil(total / 24)))),
    rollingChapterCount: Math.min(total, 20),
  };
}

function validateStoryBlueprint(blueprint, totalChapters, options = {}) {
  const total = Math.max(1, Number(totalChapters || 1));
  const requirements = blueprintRequirements(total);
  const errors = [];
  const warnings = [];
  const phases = toArray(blueprint?.phases);
  const expectedArcCount = Number(options.expectedArcCount || requirements.arcCount);
  if (!blueprint?.mainArc || !String(blueprint.mainArc).trim()) errors.push('缺少全书主线');
  if (phases.length !== expectedArcCount) errors.push(`全书级蓝图应包含 ${expectedArcCount} 个大篇章，当前为 ${phases.length} 个`);
  phases.forEach((phase, index) => {
    const label = `篇章${index + 1}`;
    const previous = phases[index - 1];
    if (index === 0 && Number(phase.startChapter) !== 1) errors.push(`${label}必须从第1章开始`);
    if (previous && Number(phase.startChapter) !== Number(previous.endChapter) + 1) errors.push(`${label}与上一篇章存在章节空档或重叠`);
    if (index === phases.length - 1 && Number(phase.endChapter) !== total) errors.push(`最后一个篇章必须覆盖到第${total}章`);
    for (const [field, name] of [['tagCommitments', '标签兑现'], ['characterBeats', '人物推进'], ['requiredScenes', '必备场景'], ['forbiddenDrift', '禁止漂移'], ['foreshadowing', '伏笔计划'], ['unresolvedQuestions', '未决问题'], ['subphases', '篇章级小阶段']]) {
      if (!Array.isArray(phase[field]) || !phase[field].length) errors.push(`${label}缺少${name}`);
    }
    if (!phase.entryCondition) errors.push(`${label}缺少进入条件`);
    if (!phase.exitCondition) errors.push(`${label}缺少离开条件`);
    const subphases = toArray(phase.subphases);
    subphases.forEach((subphase, subIndex) => {
      const subLabel = `${label}的小阶段${subIndex + 1}`;
      if (subIndex === 0 && Number(subphase.startChapter) !== Number(phase.startChapter)) errors.push(`${subLabel}没有从篇章起点开始`);
      if (subIndex > 0 && Number(subphase.startChapter) !== Number(subphases[subIndex - 1].endChapter) + 1) errors.push(`${subLabel}存在章节空档或重叠`);
      if (subIndex === subphases.length - 1 && Number(subphase.endChapter) !== Number(phase.endChapter)) errors.push(`${subLabel}没有覆盖到篇章终点`);
      if (!subphase.tagCommitments?.length) errors.push(`${subLabel}缺少标签兑现`);
      if (!subphase.characterBeats?.length) errors.push(`${subLabel}缺少人物推进`);
      if (!subphase.requiredScenes?.length) errors.push(`${subLabel}缺少必备场景`);
      if (!subphase.forbiddenDrift?.length) errors.push(`${subLabel}缺少禁止漂移`);
      if (!subphase.foreshadowing?.length) errors.push(`${subLabel}缺少伏笔计划`);
      if (!subphase.unresolvedQuestions?.length) errors.push(`${subLabel}缺少未决问题`);
      if (!subphase.entryCondition || !subphase.exitCondition) errors.push(`${subLabel}缺少进入/离开条件`);
    });
  });
  const rolling = blueprint?.rollingPlan;
  if (!rolling || typeof rolling !== 'object') errors.push('缺少滚动执行蓝图');
  else {
    const expectedRollingEnd = Math.min(total, requirements.rollingChapterCount);
    if (Number(rolling.startChapter) !== 1) errors.push('初始滚动执行蓝图必须从第1章开始');
    if (Number(rolling.endChapter) !== expectedRollingEnd) errors.push(`初始滚动执行蓝图必须覆盖第1-${expectedRollingEnd}章`);
    const chapters = toArray(rolling.chapters);
    if (chapters.length !== expectedRollingEnd) errors.push(`滚动执行蓝图应逐章规划 ${expectedRollingEnd} 章，当前为 ${chapters.length} 章`);
    chapters.forEach((chapter, index) => {
      if (Number(chapter.chapterNumber) !== index + 1) errors.push(`滚动执行蓝图缺少第${index + 1}章或章节顺序错误`);
      if (!chapter.purpose) errors.push(`滚动执行蓝图第${index + 1}章缺少章节目的`);
      if (!chapter.tagCommitments?.length) errors.push(`滚动执行蓝图第${index + 1}章缺少标签兑现`);
      if (!chapter.characterBeats?.length) errors.push(`滚动执行蓝图第${index + 1}章缺少人物推进`);
    });
  }
  const requiredTags = textList(options.requiredTags, 24);
  if (requiredTags.length) {
    const commitments = phases.flatMap((phase) => [
      ...toArray(phase.tagCommitments),
      ...toArray(phase.subphases).flatMap((subphase) => toArray(subphase.tagCommitments)),
    ]).join('、');
    for (const tag of requiredTags) {
      if (!commitments.includes(tag)) errors.push(`所选标签“${tag}”没有落实到任何篇章`);
    }
  }
  if (errors.length > 24) warnings.push(`另有 ${errors.length - 24} 项结构问题未展开`);
  return { valid: errors.length === 0, errors: errors.slice(0, 24), warnings, requirements };
}

/**
 * Seed a conservative live blueprint from the user-approved outline. Detailed
 * reversals are added only by an explicit AI proposal that the user applies.
 */
function ensureStoryBlueprint(novel, totalChapters) {
  initializeCreativeState(novel);
  if (!novel.storyBlueprint) novel.storyBlueprint = {};
  const blueprint = novel.storyBlueprint;
  const total = Math.max(1, Number(totalChapters || Math.ceil(Number(novel.targetWordCount || 50000) / 3000)));
  blueprint.blueprintLevel = 3;
  if (!blueprint.version) blueprint.version = 1;
  if (!blueprint.mainArc) blueprint.mainArc = String(novel.outline || novel.storyBible.theme || '按既定主线推进').slice(0, 1200);
  if (!Array.isArray(blueprint.lockedFacts)) blueprint.lockedFacts = [];
  if (!Array.isArray(blueprint.tagChecklist)) blueprint.tagChecklist = [];
  if (!blueprint.lockedFacts.length) {
    blueprint.lockedFacts = textList([novel.protagonistName ? `主角：${novel.protagonistName}` : '', novel.worldSetting ? `世界观：${novel.worldSetting}` : ''].filter(Boolean), 8);
  }
  if (!Array.isArray(blueprint.phases) || !blueprint.phases.length) {
    blueprint.phases = [normalizeBlueprintPhase({
      title: '当前主线阶段', startChapter: 1, endChapter: total,
      goal: '依据用户确认的大纲推进主角目标，重要转折必须由用户确认后才可变更。',
      threads: novel.plotThreads.map((thread) => thread.title || thread.id).filter(Boolean),
    }, 1, total)];
  } else {
    blueprint.phases = blueprint.phases.map((phase) => normalizeBlueprintPhase(phase, 1, total));
  }
  blueprint.rollingPlan = normalizeRollingPlan(blueprint.rollingPlan, total);
  if (typeof blueprint.autoReviewEnabled !== 'boolean') blueprint.autoReviewEnabled = false;
  if (typeof blueprint.emailReminderEnabled !== 'boolean') blueprint.emailReminderEnabled = true;
  if (!Number.isFinite(Number(blueprint.lastReviewedChapter))) blueprint.lastReviewedChapter = 0;
  return blueprint;
}

function normalizeProposedBlueprint(rawBlueprint, novel, totalChapters) {
  const current = ensureStoryBlueprint(novel, totalChapters);
  rawBlueprint = rawBlueprint || {};
  const total = Math.max(1, Number(totalChapters || 1));
  const lockedFacts = Array.from(new Set([
    ...textList(current.lockedFacts, 16),
    ...textList(rawBlueprint.lockedFacts, 16),
  ])).slice(0, 16);
  const rawPhases = Array.isArray(rawBlueprint.phases) ? rawBlueprint.phases : current.phases;
  const phases = rawPhases.slice(0, 16).map((phase, index) => normalizeBlueprintPhase(
    phase,
    index ? Number(rawPhases[index - 1]?.endChapter || 1) + 1 : 1,
    total
  ));
  return {
    blueprintLevel: 3,
    version: Number(current.version || 1) + 1,
    mainArc: String(rawBlueprint.mainArc || current.mainArc || '').trim().slice(0, 1200),
    lockedFacts,
    tagChecklist: textList(rawBlueprint.tagChecklist?.length ? rawBlueprint.tagChecklist : current.tagChecklist, 24),
    phases: phases.length ? phases : current.phases,
    rollingPlan: normalizeRollingPlan(rawBlueprint.rollingPlan || current.rollingPlan, total),
    autoReviewEnabled: Boolean(current.autoReviewEnabled),
    emailReminderEnabled: current.emailReminderEnabled !== false,
    lastReviewedChapter: Number(current.lastReviewedChapter || 0),
  };
}

function applyStoryBlueprint(novel, rawBlueprint, totalChapters) {
  const blueprint = normalizeProposedBlueprint(rawBlueprint, novel, totalChapters);
  novel.storyBlueprint = blueprint;
  initializeCreativeState(novel);
  const existingTitles = new Set(novel.plotThreads.map((thread) => String(thread.title || '').trim()).filter(Boolean));
  for (const phase of blueprint.phases) {
    const threadTitles = [
      ...(phase.threads || []),
      ...(phase.subphases || []).flatMap((subphase) => subphase.threads || []),
    ];
    for (const title of threadTitles) {
      if (!title || existingTitles.has(title)) continue;
      novel.plotThreads.push({
        id: `blueprint_${String(title).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').slice(0, 24) || novel.plotThreads.length + 1}`,
        title,
        type: 'subplot',
        status: 'planned',
        nextMilestone: phase.goal || '在合适阶段与主线交叉推进',
        lastChapter: Math.max(0, Number(phase.startChapter || 1) - 1),
      });
      existingTitles.add(title);
    }
  }
  return blueprint;
}

function renderStoryBlueprintForContext(novel, chapterNumber, totalChapters) {
  const blueprint = ensureStoryBlueprint(novel, totalChapters);
  const chapter = Math.max(1, Number(chapterNumber || 1));
  const relevantPhases = blueprint.phases
    .filter((phase) => Number(phase.endChapter || 0) >= chapter)
    .slice(0, 2);
  const renderStage = (phase, prefix = '') => [
    `${prefix}第${phase.startChapter}-${phase.endChapter}章 ${phase.title}`,
    phase.goal ? `目标：${phase.goal}` : '',
    phase.obstacle ? `阻力：${phase.obstacle}` : '',
    phase.reversal ? `反转：${phase.reversal}` : '',
    phase.entryCondition ? `进入条件：${phase.entryCondition}` : '',
    phase.exitCondition ? `离开条件：${phase.exitCondition}` : '',
    phase.tagCommitments?.length ? `必须兑现标签：${phase.tagCommitments.join('、')}` : '',
    phase.characterBeats?.length ? `人物推进：${phase.characterBeats.map((beat) => `${beat.character || '相关人物'}[目标=${beat.goal || '未写'}；冲突=${beat.conflict || '未写'}；变化=${beat.change || '未写'}；声线=${beat.voiceGuard || '未写'}]`).join('；')}` : '',
    phase.requiredScenes?.length ? `必备场景：${phase.requiredScenes.join('、')}` : '',
    phase.forbiddenDrift?.length ? `禁止漂移：${phase.forbiddenDrift.join('、')}` : '',
    phase.foreshadowing?.length ? `伏笔：${phase.foreshadowing.map((item) => `${item.name || '未命名'}(埋设${item.setupChapter || '?'}→回收${item.payoffChapter || '?'})`).join('、')}` : '',
    phase.unresolvedQuestions?.length ? `阶段后保留问题：${phase.unresolvedQuestions.join('、')}` : '',
    phase.threads?.length ? `关联线：${phase.threads.join('、')}` : '',
  ].filter(Boolean).join('；');
  const phaseText = relevantPhases.map((phase) => {
    const activeSubphase = (phase.subphases || []).find((item) => chapter >= Number(item.startChapter) && chapter <= Number(item.endChapter));
    return [renderStage(phase, '全书篇章：'), activeSubphase ? renderStage(activeSubphase, '当前小阶段：') : ''].filter(Boolean).join('\n');
  }).join('\n');
  const rolling = blueprint.rollingPlan || {};
  const rollingChapter = toArray(rolling.chapters).find((item) => Number(item.chapterNumber) === chapter);
  const rollingText = chapter >= Number(rolling.startChapter || 0) && chapter <= Number(rolling.endChapter || 0)
    ? [
      `滚动执行窗口：第${rolling.startChapter}-${rolling.endChapter}章；目标：${rolling.objective || '落实当前小阶段'}`,
      rolling.tagCommitments?.length ? `窗口标签：${rolling.tagCommitments.join('、')}` : '',
      rolling.forbiddenDrift?.length ? `窗口禁止漂移：${rolling.forbiddenDrift.join('、')}` : '',
      rollingChapter ? `本章执行卡：${JSON.stringify(rollingChapter)}` : '',
    ].filter(Boolean).join('\n')
    : '';
  return [
    `【三级动态故事蓝图｜已确认版本 ${blueprint.version}】`,
    `主线：${blueprint.mainArc || '按已确认大纲推进'}`,
    blueprint.tagChecklist?.length ? `全书标签清单：${blueprint.tagChecklist.join('、')}` : '',
    blueprint.lockedFacts.length ? `不可改写事实：${blueprint.lockedFacts.join('；')}` : '',
    phaseText,
    rollingText,
    '只有用户应用剧情蓝图提案后，才能改变上述方向；不得自行改写终局、人物核心动机或已经发生的事实。',
  ].filter(Boolean).join('\n');
}

/**
 * 全书情绪权重（heavy/light/balanced）：决定喘息章与张力基线。
 *
 * 除了类型名/大纲/世界观文本，还要读用户在多选 SKU 里真正勾选的标签——
 * 风格基调（搞笑/甜宠/治愈/暗黑…）与题材名。此前只扫 novelTypeName 字符串，
 * 于是"选了搞笑/治愈"这类基调进不了情绪规划（tag 在节奏层面失效）。
 */
function inferStoryWeight(novel) {
  const skuText = skuSignalText(novel);
  const text = [novel.novelTypeName, novel.outline, novel.worldSetting, skuText].filter(Boolean).join(' ');
  if (/悲剧|虐|黑暗|悬疑|惊悚|末日|战争|犯罪|沉重|复仇|暗黑|致郁|压抑/.test(text)) return 'heavy';
  if (/轻松|喜剧|搞笑|甜|治愈|温情|日常|沙雕|谐趣|小确幸/.test(text)) return 'light';
  return 'balanced';
}

/** 把 novel.typeSku 里的标签翻成可判定的中文文本（基调名 + 大类/题材名 + 情节/人设标签名）。 */
function skuSignalText(novel) {
  const sku = novel && novel.typeSku;
  if (!sku || typeof sku !== 'object') return '';
  try {
    const parts = [];
    const cat = (CATEGORY_TREE[sku.channel] || []).find((c) => c.id === sku.category);
    if (cat) {
      parts.push(cat.name);
      const theme = (cat.themes || []).find((t) => t.id === sku.theme);
      if (theme) parts.push(theme.name);
    }
    for (const id of sku.tones || []) if (TONES[id]) parts.push(TONES[id].name);
    for (const id of sku.elements || []) if (ELEMENTS[id]) parts.push(ELEMENTS[id][0]);
    for (const id of sku.personas || []) if (CHARACTERS[id]) parts.push(CHARACTERS[id][0]);
    return parts.join(' ');
  } catch {
    return '';
  }
}

/**
 * Schedule a breathing chapter after sustained pressure.  The final 15% keeps
 * only a short emotional release instead of a full detour from the resolution.
 */
function buildEmotionPlan(novel, chapterNumber, totalChapters, planChapter) {
  initializeCreativeState(novel);
  planChapter = planChapter || {};
  const history = novel.emotionCurve.slice(-4);
  const highPressure = history.length >= 3 && history.slice(-3).every((item) => Number(item.tension) >= 7);
  const average = history.length ? history.reduce((sum, item) => sum + Number(item.tension || 5), 0) / history.length : 5;
  const nearEnding = chapterNumber > Math.ceil(totalChapters * 0.85);
  const requestedBreath = /喘息|缓冲|休整|日常|breath|relief/i.test(String(planChapter.chapterRole || ''));
  const isBreath = !nearEnding && (requestedBreath || highPressure || average >= 7.2);
  const baseTension = chapterNumber <= totalChapters * 0.2 ? 5 : chapterNumber <= totalChapters * 0.65 ? 6 : nearEnding ? 8 : 7;
  const plannedTension = Number(planChapter.tension) || (isBreath ? 4 : baseTension);
  const tension = isBreath
    ? Math.max(2, Math.min(5, plannedTension))
    : Math.max(2, Math.min(10, plannedTension));
  const weight = inferStoryWeight(novel);
  return {
    tension,
    isBreath,
    chapterRole: isBreath ? '喘息推进' : (planChapter.chapterRole || (nearEnding ? '收束' : '主线推进')),
    tone: isBreath
      ? (weight === 'heavy' ? '压抑中的短暂温情、生活细节或黑色幽默，不破坏题材重量' : '轻松，但必须带来关系、信息或伏笔推进')
      : (weight === 'heavy' ? '克制具体，避免连续高强度煽情' : '随场景自然变化，避免整章同一情绪'),
  };
}

/**
 * Rebalance the remaining manuscript budget for each planned chapter.  Plans
 * produced by a model often contain an inaccurate total, so the relative
 * chapter weights are preserved while the absolute target follows the book.
 */
function getAdaptiveChapterWordTarget(options) {
  options = options || {};
  const plan = options.planData && options.planData.chapters
    ? options.planData
    : parseChapterPlan(options.planData || '');
  const chapterNumber = Number(options.chapterNumber || 1);
  const targetWords = Math.max(1, Number(options.targetWords || 50000));
  const currentWords = Math.max(0, Number(options.currentWords || 0));
  const remainingPlan = plan.chapters.filter((item) => Number(item.chapterNumber) >= chapterNumber);
  const currentPlan = remainingPlan.find((item) => Number(item.chapterNumber) === chapterNumber) || {};
  const remainingChapters = Math.max(1, remainingPlan.length || Number(options.totalChapters || 1) - chapterNumber + 1);
  const remainingWords = targetWords - currentWords;

  // Once the requested length has been reached, still reserve enough room to
  // execute unvisited plan chapters and land the ending instead of stopping in
  // the middle of the plot.
  if (remainingWords <= 0) {
    return Math.max(1200, Math.min(2400, Number(currentPlan.wordTarget) || 1800));
  }

  // A legacy plan may contain only the active final chapter. In that case
  // there is no remaining distribution to rebalance, so honor its explicit
  // budget instead of inflating it against the whole-book target.
  if (remainingPlan.length <= 1 && Number(currentPlan.wordTarget) > 0) {
    return Number(currentPlan.wordTarget);
  }

  const fallbackWeight = Math.max(1200, Math.floor(remainingWords / remainingChapters));
  const weights = remainingPlan.map((item) => Number(item.wordTarget) || fallbackWeight);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || remainingChapters * fallbackWeight;
  const currentWeight = Number(currentPlan.wordTarget) || fallbackWeight;
  const weightedTarget = Math.round(remainingWords * currentWeight / totalWeight);
  // 字数带宽要尊重计划自身的尺度：大章计划（如每章 1 万字的长篇悬疑）
  // 不能被压回 5200 上限，否则每章都会被截短。默认计划维持旧口径。
  const plannedAverage = Math.round(totalWeight / Math.max(1, remainingPlan.length));
  const bandCeiling = Math.max(5200, Math.ceil(plannedAverage * 1.4));
  const minTarget = Math.max(500, Math.min(1800, Math.floor(remainingWords / remainingChapters * 0.6)));
  const maxTarget = Math.max(2600, Math.min(bandCeiling, Math.ceil(remainingWords / remainingChapters * 1.75)));
  return Math.max(minTarget, Math.min(maxTarget, weightedTarget));
}

function getChapterOutputTokenLimit(wordTarget) {
  // Chinese prose normally consumes more tokens than characters on the
  // configured providers. This cap prevents one abnormal chapter from using a
  // large share of a long-book budget while leaving reasonable headroom.
  // 大章（如每章 1 万+ 字的长篇悬疑）需要按比例抬高的输出预算，否则正文
  // 会在中途被 max_tokens 截断；24000 token 约对应 1.7 万字，覆盖上限。
  const target = Math.max(1, Number(wordTarget) || 1800);
  return Math.max(2200, Math.min(24000, Math.ceil(target * 1.35)));
}

/** Return the concrete blockers that prevent a planned long-form work ending. */
function assessStoryCompletion(novel, planData, targetWords) {
  const plan = planData && planData.chapters ? planData : parseChapterPlan(planData || novel.chapterPlan || '');
  const plannedNumbers = plan.chapters.map((chapter) => Number(chapter.chapterNumber)).filter(Boolean);
  const writtenNumbers = new Set(toArray(novel.chapters).map((chapter) => Number(chapter.chapterNumber)).filter(Boolean));
  const missingChapters = plannedNumbers.filter((number) => !writtenNumbers.has(number));
  const finalPlannedChapter = plannedNumbers.length ? Math.max(...plannedNumbers) : 0;
  const unresolvedHooks = toArray(novel.foreshadowingLedger)
    .filter((hook) => {
      const targetChapter = Number(hook.targetChapter || 0);
      return targetChapter > 0 && targetChapter <= finalPlannedChapter && hook.status !== 'resolved' && hook.status !== 'abandoned';
    })
    .map((hook) => String(hook.content || hook.id || '未命名伏笔'));
  const currentWords = toArray(novel.chapters).reduce((sum, chapter) => sum + Number(chapter.wordCount || 0), 0);
  const wordTarget = Math.max(1, Number(targetWords || novel.targetWordCount || 50000));
  const wordTargetReached = currentWords >= wordTarget;

  return {
    complete: Boolean(plannedNumbers.length) && missingChapters.length === 0 && wordTargetReached && unresolvedHooks.length === 0,
    currentWords,
    wordTarget,
    wordTargetReached,
    missingChapters,
    unresolvedHooks,
  };
}

/**
 * Close planned hooks that reached the end of an approved chapter plan without
 * an explicit resolution. This is only for a completed work: unfinished
 * mid-story hooks must continue to block completion so the user can revise or
 * extend the plan.
 */
function closeUnresolvedHooksAtEnding(novel, planData, reason = '计划已执行完毕，正文未明确回收该伏笔') {
  const plan = planData && planData.chapters ? planData : parseChapterPlan(planData || novel.chapterPlan || '');
  const finalChapter = plan.chapters.reduce((max, chapter) => Math.max(max, Number(chapter.chapterNumber) || 0), 0);
  if (!finalChapter || !Array.isArray(novel.foreshadowingLedger)) return 0;
  let changed = 0;
  novel.foreshadowingLedger.forEach((hook) => {
    const targetChapter = Number(hook.targetChapter || 0);
    if (targetChapter > 0 && targetChapter <= finalChapter && ['planned', 'pending'].includes(hook.status)) {
      hook.status = 'abandoned';
      hook.resolvedChapter = finalChapter;
      hook.resolution = reason;
      changed++;
    }
  });
  if (changed && typeof novel.markModified === 'function') novel.markModified('foreshadowingLedger');
  return changed;
}

/**
 * 压缩上一章为"承接摘要"：开端 + 关键转折 + 章末，而不是只取末尾 260 字。
 * 上一章末尾可能是回忆/插叙，单看结尾容易错位；摘要把场景起点和转折也带上。
 */
function compressPreviousChapter(content) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= 620) return text;
  const head = text.slice(0, 170);
  const sentences = text.split(/[。！？]/).map((item) => item.trim()).filter((item) => item.length >= 12);
  const keyLine = (sentences.find((item) => /但是|然而|突然|没想到|竟然|终于|发现|原来|决定|答应|拒绝|失去/.test(item)) || '').slice(0, 130);
  const tail = text.slice(-300);
  return [
    '本章开端：' + head + '…',
    keyLine ? '关键转折：' + keyLine : '',
    '章末（必须无缝衔接）：…' + tail,
  ].filter(Boolean).join('\n');
}

// ===== 章末收尾形式库（源头防同构）=====
// 每章收尾指令如果逐字恒定，模型在几百章尺度上会收敛到同一种收尾模板；
// 把收尾形式按章轮换，并把近几章实际收尾作为负面清单注入，才是触及根源的改法。
const ENDING_STYLES = [
  { key: 'action-cut', label: '动作中断', hint: '在动作或危机推进到一半处收束，不写出这个动作的后果' },
  { key: 'reveal', label: '信息揭示', hint: '抛出一个改变局面认知的具体事实或线索，不解释它的全部含义' },
  { key: 'relation-shift', label: '关系反转', hint: '落在一次立场、态度或关系的变化上，用人物言行而非叙述总结呈现' },
  { key: 'object-closeup', label: '物件特写', hint: '收在一个具体物件、痕迹或感官细节上，让它携带本章的未解之处' },
  { key: 'dialogue', label: '对话收束', hint: '以一句有分量的人物台词收尾，话里带着未说尽的意图' },
  { key: 'emotion-after', label: '情绪余波', hint: '不写新事件，让本章后果落在某个具体人物的情绪反应上' },
];
const BREATH_ENDING_KEYS = ['object-closeup', 'emotion-after', 'relation-shift', 'dialogue'];

// 确定性轮换：章号为主轴、张力做偏移；喘息章限定温和形式。不引入随机，保证同章号重试时提示稳定（利前缀缓存）。
function pickEndingStyle(chapterNumber, tension, isBreath) {
  const pool = isBreath ? ENDING_STYLES.filter((style) => BREATH_ENDING_KEYS.includes(style.key)) : ENDING_STYLES;
  const index = (Number(chapterNumber || 1) + Math.round(Number(tension) || 0)) % pool.length;
  return pool[index] || pool[0];
}

function collectRecentEndings(novel, count = 3) {
  const chapters = Array.isArray(novel.chapters) ? novel.chapters : [];
  return chapters.slice(-count)
    .map((chapter) => ({
      chapterNumber: Number(chapter.chapterNumber) || 0,
      ending: String(chapter.content || '').replace(/\s+/g, ' ').trim().slice(-70),
    }))
    .filter((item) => item.ending.length >= 20);
}

function buildChapterContract(options) {
  options = options || {};
  const novel = initializeCreativeState(options.novel || {});
  const chapterNumber = Number(options.chapterNumber || 1);
  const totalChapters = Number(options.totalChapters || chapterNumber);
  const plan = options.planData && options.planData.chapters ? options.planData : parseChapterPlan(options.planData || novel.chapterPlan || '');
  const planChapter = plan.chapters.find((item) => item.chapterNumber === chapterNumber) || {};
  const emotion = buildEmotionPlan(novel, chapterNumber, totalChapters, planChapter);
  const previous = options.previousChapter;
  // Do not show future planned hooks as if they were already present in the
  // narrative. The current chapter receives its own setHooks separately.
  const pendingHooks = novel.foreshadowingLedger
    .filter((item) => item.status === 'pending' || (item.status === 'planned' && Number(item.setChapter || 0) < chapterNumber))
    .slice(0, 8);
  const mustAdvance = novel.plotThreads.filter((item) => ['active', 'planned'].includes(item.status) && item.nextMilestone).slice(0, 3);
  const mustNot = ['不要复述上一章已经完成的核心事件', '不要在一章内同时解决所有主线和伏笔'];
  novel.recentEventSignatures.slice(-5).forEach((event) => mustNot.push('不要重复事件：' + String(event).slice(0, 80)));
  if (emotion.isBreath) mustNot.push('不要用突兀搞笑抵消题材基调，也不要写成没有信息增量的纯日常');
  // 章末防同构（源头修复）：把近几章的实际收尾作为负面清单注入，
  // 否则模型在恒定的收尾指令下会收敛到同一种收尾模板。
  const recentEndings = collectRecentEndings(novel, 3);
  recentEndings.forEach((item) => mustNot.push(`第${item.chapterNumber}章已用「…${item.ending}」收尾，本章不得复用该句式或同构套路`));
  const endingStyle = pickEndingStyle(chapterNumber, emotion.tension, emotion.isBreath);
  const wordTarget = Number(options.wordTarget) || getAdaptiveChapterWordTarget({
    planData: plan,
    chapterNumber,
    totalChapters,
    currentWords: options.currentWords,
    targetWords: options.targetWords || novel.targetWordCount,
  });
  return {
    chapterNumber,
    totalChapters,
    wordTarget,
    title: deriveChapterTitle(planChapter),
    coreEvent: planChapter.coreEvent || '承接上一章造成的新问题，做出一个不可逆的选择并留下下一步行动',
    phase: planChapter.phase || '',
    characters: planChapter.characters || [],
    subplotFocus: planChapter.subplotFocus || '',
    relationshipBeat: planChapter.relationshipBeat || '',
    breathingPurpose: planChapter.breathingPurpose || '',
    tagCommitments: planChapter.tagCommitments || [],
    characterBeat: planChapter.characterBeat || '',
    requiredScenes: planChapter.requiredScenes || [],
    forbiddenDrift: planChapter.forbiddenDrift || [],
    setHooks: planChapter.setHooks || [],
    resolveHooks: planChapter.resolveHooks || [],
    pendingHooks,
    mustAdvance,
    previousEnd: previous ? compressPreviousChapter(previous.content) : '故事开场，建立人物的当下处境。',
    mustNot,
    endingStyle,
    recentEndings,
    emotion,
    progress: String(options.currentWords || 0) + '/' + String(options.targetWords || novel.targetWordCount || 50000),
  };
}

function renderChapterContract(contract) {
  if (!contract) return '';
  const list = (items) => items && items.length ? items.join('；') : '无';
  const pending = (contract.pendingHooks || []).map((item) => (item.id || '伏笔') + '：' + item.content).join('；') || '无';
  const advance = (contract.mustAdvance || []).map((item) => (item.title || item.id) + ' → ' + item.nextMilestone).join('；') || '至少推进一条主线或关系线';
  return [
    '【本章契约｜第' + contract.chapterNumber + '章】',
    '章节短标题：' + (contract.title || '故事未尽') + '（仅用于目录，不要输出到正文）',
    '唯一核心事件：' + contract.coreEvent,
    '章节功能：' + contract.emotion.chapterRole + (contract.phase ? '（' + contract.phase + '）' : ''),
    '情绪目标：压力 ' + contract.emotion.tension + '/10；' + contract.emotion.tone,
    '必须承接的上一章状态：' + contract.previousEnd,
    '必须推进的剧情线：' + advance,
    '本章角色：' + list(contract.characters),
    '本章支线焦点：' + (contract.subplotFocus || '无；若有已建立关系线，选择一条自然带入'),
    '本章关系变化：' + (contract.relationshipBeat || '由场景中的选择和反应自然体现'),
    '本章缓冲功能：' + (contract.breathingPurpose || '无；不要为了凑字数插入无关日常'),
    '本章必须兑现的标签：' + list(contract.tagCommitments),
    '本章人物推进与声线：' + (contract.characterBeat || '依据人物声音表保持差异，不得全员冷静、完整、讲逻辑'),
    '本章必备场景：' + list(contract.requiredScenes),
    '本章埋设伏笔：' + list(contract.setHooks),
    '本章应回收伏笔：' + list(contract.resolveHooks),
    '已存在的待回收伏笔：' + pending,
    '明确禁止：' + [...contract.mustNot, ...(contract.forbiddenDrift || [])].join('；'),
    '本章目标字数：约' + contract.wordTarget + '字；全书进度：' + contract.progress,
    contract.emotion.isBreath
      ? '喘息章规则：让读者缓一口气，但必须通过对话、物件、关系变化或新信息推进故事。'
      : '节奏规则：保留情绪落差，收尾执行下方收尾要求，不用抽象总结。',
    renderEndingRequirement(contract),
  ].join('\n');
}

function renderEndingRequirement(contract) {
  const style = contract.endingStyle || { label: '信息揭示', hint: '抛出一个改变局面认知的具体事实' };
  const history = (contract.recentEndings || [])
    .map((item) => `第${item.chapterNumber}章「…${item.ending}」`)
    .join('；');
  return '收尾要求：本章以【' + style.label + '】收尾——' + style.hint
    + '。开头可衔接上一章末尾，但收尾不得与之一致。'
    + (history ? '已用过的收尾（禁止同构）：' + history : '');
}

function extractEventSignature(content) {
  const sentences = String(content || '').split(/[。！？!?\n]/).map((item) => item.trim()).filter((item) => item.length >= 12);
  const candidates = sentences.filter((item) => /决定|答应|拒绝|发现|进入|离开|追|救|杀|签|拿到|失去|冲突|秘密|选择|面对|返回|逃/.test(item));
  return (candidates[0] || sentences[0] || '').replace(/\s/g, '').slice(0, 120);
}

function similarityByChunks(leftText, rightText) {
  const makeSet = (value) => new Set(String(value || '').replace(/\s/g, '').match(/[\u4e00-\u9fffA-Za-z0-9]{4}/g) || []);
  const left = makeSet(leftText);
  const right = makeSet(rightText);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const chunk of left) if (right.has(chunk)) common++;
  return common / Math.max(left.size, right.size);
}

/**
 * 伏笔内容在正文中的"措辞无关覆盖率"：把伏笔内容切成 2-gram，
 * 统计有多少比例出现在正文里。模型回收伏笔时几乎必然改写措辞
 * （"铜钥匙的下落" → "那把黄铜钥匙终于有了着落"），字面 includes
 * 抓不到；2-gram 覆盖率对语序重排稳健。0.7 以上视为高置信命中。
 */
function hookMatchScore(hookContent, text) {
  const source = String(hookContent || '').replace(/\s/g, '');
  const grams = new Set();
  for (let i = 0; i < source.length - 1; i++) grams.add(source.slice(i, i + 2));
  if (!grams.size) return 0;
  let hit = 0;
  const target = String(text || '').replace(/\s/g, '');
  for (const gram of grams) if (target.includes(gram)) hit++;
  return hit / grams.size;
}

function checkChapterContinuity(content, previousChapter, contract) {
  const issues = [];
  const text = String(content || '').trim();
  if (text.length < Math.max(500, ((contract && contract.wordTarget) || 1600) * 0.35)) issues.push('章节明显短于目标，可能未完成契约');
  if (previousChapter && similarityByChunks(text, previousChapter.content) > 0.42) issues.push('与上一章存在较高事件或措辞重复风险');
  if (contract && contract.coreEvent) {
    const terms = contract.coreEvent.split(/[，。；、：:（）()\s]/).filter((item) => item.length >= 2).slice(0, 4);
    if (terms.length >= 2 && terms.every((term) => !text.includes(term))) issues.push('正文未明显执行本章核心事件');
  }
  if ((text.match(/仿佛|好像|不禁|微微|一丝|眼中闪过|嘴角勾起|心中一动/g) || []).length >= 6) issues.push('高频模板化修辞偏多');
  return { score: Math.max(0, 100 - issues.length * 20), issues, eventSignature: extractEventSignature(text) };
}

function updateCreativeState(novel, chapterNumber, content, contract, continuity) {
  initializeCreativeState(novel);
  continuity = continuity || {};
  const signature = continuity.eventSignature || extractEventSignature(content);
  novel.recentEventSignatures = novel.recentEventSignatures.filter((item) => item !== signature).concat(signature).filter(Boolean).slice(-8);
  const emotion = (contract && contract.emotion) || buildEmotionPlan(novel, chapterNumber, (contract && contract.totalChapters) || chapterNumber, {});
  const record = novel.emotionCurve.find((item) => item.chapterNumber === chapterNumber);
  if (record) Object.assign(record, { tension: emotion.tension, tone: emotion.tone, chapterRole: emotion.chapterRole });
  else novel.emotionCurve.push({ chapterNumber, tension: emotion.tension, tone: emotion.tone, chapterRole: emotion.chapterRole });
  const addHook = (hook) => {
    const value = String(hook || '').trim();
    if (!value) return;
    const id = 'FH_' + chapterNumber + '_' + value.slice(0, 18).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '');
    const existing = novel.foreshadowingLedger.find((item) => item.id === id || (item.content && item.content.slice(0, 12) === value.slice(0, 12)));
    if (existing) {
      // A hook planned from the outline becomes pending only when its setup chapter is written.
      if (existing.status === 'planned' && Number(existing.setChapter) === Number(chapterNumber)) existing.status = 'pending';
    } else {
      novel.foreshadowingLedger.push({ id, content: value, setChapter: chapterNumber, targetChapter: 0, status: 'pending' });
    }
  };
  ((contract && contract.setHooks) || []).forEach(addHook);
  const compact = String(content || '').replace(/\s/g, '');
  const resolvedByContract = ((contract && contract.resolveHooks) || []).map((item) => String(item || '').replace(/\s/g, '')).filter(Boolean);
  novel.foreshadowingLedger.forEach((hook) => {
    if (!['pending', 'planned'].includes(hook.status)) return;
    const targetChapter = Number(hook.targetChapter || 0);
    if (targetChapter > 0 && Number(chapterNumber) < targetChapter) return;
    const key = String(hook.content || '').replace(/\s/g, '').slice(0, 12);
    const scheduled = resolvedByContract.some((item) => item.includes(key) || key.includes(item.slice(0, 12)));
    // 命中：字面包含（快速路径），或 2-gram 覆盖率达标（措辞被改写也能识别）；
    // 计划回收的条目降低门槛（6 字覆盖率），因为契约已声明本章应收。
    const coverage = hookMatchScore(hook.content, compact);
    const literalHit = key.length >= 6 && compact.includes(key);
    const scheduledHit = scheduled && coverage >= 0.6;
    const looseHit = coverage >= 0.7;
    if (chapterNumber > Number(hook.setChapter || 0) && (literalHit || scheduledHit || looseHit)) {
      hook.status = 'resolved';
      hook.resolvedChapter = chapterNumber;
      hook.resolution = extractEventSignature(content).slice(0, 120);
    }
  });
  return novel;
}

/**
 * 把模型章末自评（结构化 JSON）回填到账本与角色状态。
 * 自评失败时调用方直接跳过，本章保留启发式判定结果——这里只做"修正与补漏"：
 * - hooksResolved：模型识别出的回收。启发式漏掉的（措辞改写、隐式回收）在这里补标；
 *   启发式已标 resolved 的不动（双通道不冲突）。
 * - hooksSet：模型发现本章实际埋了但契约没计划的伏笔 → 补录 pending。
 * - characterUpdates：按名字 upsert 角色状态（位置/情绪/目标），供下一章契约与记忆检查点使用。
 */
function applyHookAudit(novel, chapterNumber, audit) {
  if (!novel || !audit || typeof audit !== 'object') return { resolved: 0, added: 0, characters: 0 };
  initializeCreativeState(novel);
  let resolvedCount = 0;
  let addedCount = 0;
  let characterCount = 0;

  const findHook = (raw) => {
    const id = String(raw && raw.id || '').trim();
    const text = String(raw && (raw.content || raw.text || raw) || '').replace(/\s/g, '');
    return novel.foreshadowingLedger.find((item) => {
      if (id && item.id === id) return true;
      const content = String(item.content || '').replace(/\s/g, '');
      if (!text || !content) return false;
      return text.includes(content.slice(0, 8)) || content.includes(text.slice(0, 8));
    });
  };

  for (const raw of (Array.isArray(audit.hooksResolved) ? audit.hooksResolved : [])) {
    const hook = findHook(raw);
    if (!hook || !['pending', 'planned'].includes(hook.status)) continue;
    hook.status = 'resolved';
    hook.resolvedChapter = Number(chapterNumber) || hook.resolvedChapter;
    hook.resolution = compactAuditText(String(raw && raw.evidence || raw && raw.reason || hook.content)).slice(0, 120);
    resolvedCount++;
  }

  for (const raw of (Array.isArray(audit.hooksSet) ? audit.hooksSet : [])) {
    const value = compactAuditText(typeof raw === 'string' ? raw : (raw && (raw.content || raw.text) || ''));
    if (!value) continue;
    const existing = novel.foreshadowingLedger.find((item) => {
      const content = String(item.content || '').replace(/\s/g, '');
      return content && (value.includes(content.slice(0, 8)) || content.includes(value.slice(0, 8)));
    });
    if (existing) continue;
    const id = 'FH_' + chapterNumber + '_' + value.slice(0, 18).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '');
    novel.foreshadowingLedger.push({ id, content: value, setChapter: Number(chapterNumber) || 0, targetChapter: 0, status: 'pending' });
    addedCount++;
  }

  if (Array.isArray(novel.characterStates)) {
    for (const raw of (Array.isArray(audit.characterUpdates) ? audit.characterUpdates : [])) {
      const name = compactAuditText(raw && raw.name, 20);
      if (!name) continue;
      let state = novel.characterStates.find((item) => item.name === name);
      if (!state) { state = { name, location: '', emotionalState: '', goal: '', lastChapter: 0 }; novel.characterStates.push(state); }
      if (raw.location) state.location = compactAuditText(raw.location, 50);
      if (raw.emotionalState) state.emotionalState = compactAuditText(raw.emotionalState, 70);
      if (raw.goal) state.goal = compactAuditText(raw.goal, 90);
      state.lastChapter = Number(chapterNumber) || state.lastChapter;
      characterCount++;
    }
  }

  if (resolvedCount || addedCount) {
    if (typeof novel.markModified === 'function') {
      novel.markModified('foreshadowingLedger');
      if (characterCount) novel.markModified('characterStates');
    }
  }
  return { resolved: resolvedCount, added: addedCount, characters: characterCount };
}

function compactAuditText(value, maxLength = 200) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function seedPlannedHooks(novel, planData) {  initializeCreativeState(novel);
  const chapters = planData && Array.isArray(planData.chapters) ? planData.chapters : [];
  for (const plan of chapters) {
    for (const hook of plan.setHooks || []) {
      const value = String(hook || '').trim();
      if (!value) continue;
      const id = 'PLAN_' + plan.chapterNumber + '_' + value.slice(0, 18).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '');
      const laterResolution = chapters.find((candidate) => Number(candidate.chapterNumber) > Number(plan.chapterNumber) && (candidate.resolveHooks || []).some((item) => {
        const resolved = String(item || '').replace(/\s/g, '');
        const hook = value.replace(/\s/g, '');
        return resolved && (resolved.includes(hook.slice(0, 8)) || hook.includes(resolved.slice(0, 8)));
      }));
      if (!novel.foreshadowingLedger.some((item) => item.id === id || (item.content && item.content.slice(0, 12) === value.slice(0, 12)))) {
        novel.foreshadowingLedger.push({ id, content: value, setChapter: plan.chapterNumber, targetChapter: laterResolution ? laterResolution.chapterNumber : 0, status: 'planned' });
      }
    }
  }
  return novel;
}

module.exports = {
  normalizePlanChapter,
  normalizeChapterTitle,
  deriveChapterTitle,
  parseChapterPlan,
  buildFallbackChapterPlan,
  renderPlanForContext,
  ensureCreativeState,
  initializeCreativeState,
  ensureStoryBlueprint,
  blueprintRequirements,
  validateStoryBlueprint,
  normalizeProposedBlueprint,
  applyStoryBlueprint,
  renderStoryBlueprintForContext,
  buildEmotionPlan,
  getAdaptiveChapterWordTarget,
  getChapterOutputTokenLimit,
  assessStoryCompletion,
  closeUnresolvedHooksAtEnding,
  buildChapterContract,
  renderChapterContract,
  extractEventSignature,
  checkChapterContinuity,
  updateCreativeState,
  seedPlannedHooks,
  compressPreviousChapter,
  hookMatchScore,
  applyHookAudit,
};
