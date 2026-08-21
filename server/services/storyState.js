/**
 * Structured story-state helpers for long-form generation.
 * They deliberately tolerate legacy novels that do not yet have these fields.
 */

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
    coreEvent: String(chapter.coreEvent || chapter.event || chapter.theme || '').trim(),
    setHooks: splitItems(chapter.setHooks || chapter.foreshadowing || chapter.plantHooks),
    resolveHooks: splitItems(chapter.resolveHooks || chapter.revealHooks || chapter.collectHooks),
    characters: splitItems(chapter.characters || chapter.keyCharacters),
    chapterRole: String(chapter.chapterRole || '').trim(),
    // Keep an omitted tension as 0 so buildEmotionPlan can apply the story-level
    // rhythm instead of treating every incomplete legacy plan as low pressure.
    tension: Number.isFinite(rawTension) && rawTension > 0 ? Math.max(1, Math.min(10, rawTension)) : 0,
    phase: String(chapter.phase || '').trim(),
    raw: String(chapter.raw || ''),
  };
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
          chapterRole: chapter[6], tension: chapter[7],
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
              chapterRole: chapter[6], tension: chapter[7],
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
  const totalChapters = Math.max(startChapter, Math.ceil(targetWords / 3000));
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
      wordTarget: 3000,
      phase: phase.name,
      coreEvent: finalChapter
        ? `依据大纲完成主线收束：${outline.slice(0, 120) || '给出主角目标的具体结果'}`
        : `${phase.goal}（第${number}章，严格承接前章结果）`,
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
        '第' + item.chapterNumber + '章(' + (item.wordTarget || '按节奏') + '字): ' + (item.coreEvent || '推进主线'),
        item.setHooks.length ? '埋伏笔: ' + item.setHooks.join('、') : '',
        item.resolveHooks.length ? '回收伏笔: ' + item.resolveHooks.join('、') : '',
        item.characters.length ? '关键角色: ' + item.characters.join('、') : '',
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

function normalizeBlueprintPhase(phase, fallbackStart, fallbackEnd) {
  phase = phase || {};
  const start = Math.max(1, Number(phase.startChapter || fallbackStart || 1));
  const end = Math.max(start, Number(phase.endChapter || fallbackEnd || start));
  return {
    title: String(phase.title || '剧情阶段').trim().slice(0, 80),
    startChapter: start,
    endChapter: end,
    goal: String(phase.goal || '').trim().slice(0, 420),
    obstacle: String(phase.obstacle || '').trim().slice(0, 420),
    reversal: String(phase.reversal || '').trim().slice(0, 420),
    threads: textList(phase.threads, 8),
  };
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
  if (!blueprint.version) blueprint.version = 1;
  if (!blueprint.mainArc) blueprint.mainArc = String(novel.outline || novel.storyBible.theme || '按既定主线推进').slice(0, 1200);
  if (!Array.isArray(blueprint.lockedFacts)) blueprint.lockedFacts = [];
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
  const phases = rawPhases.slice(0, 8).map((phase, index) => normalizeBlueprintPhase(
    phase,
    index ? Number(rawPhases[index - 1]?.endChapter || 1) + 1 : 1,
    total
  ));
  return {
    version: Number(current.version || 1) + 1,
    mainArc: String(rawBlueprint.mainArc || current.mainArc || '').trim().slice(0, 1200),
    lockedFacts,
    phases: phases.length ? phases : current.phases,
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
    for (const title of phase.threads || []) {
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
  const relevantPhases = blueprint.phases.filter((phase) => Number(phase.endChapter || 0) >= chapter).slice(0, 3);
  const phaseText = relevantPhases.map((phase) => [
    `第${phase.startChapter}-${phase.endChapter}章 ${phase.title}`,
    phase.goal ? `目标：${phase.goal}` : '',
    phase.obstacle ? `阻力：${phase.obstacle}` : '',
    phase.reversal ? `反转：${phase.reversal}` : '',
    phase.threads?.length ? `关联线：${phase.threads.join('、')}` : '',
  ].filter(Boolean).join('；')).join('\n');
  return [
    `【动态故事蓝图｜已确认版本 ${blueprint.version}】`,
    `主线：${blueprint.mainArc || '按已确认大纲推进'}`,
    blueprint.lockedFacts.length ? `不可改写事实：${blueprint.lockedFacts.join('；')}` : '',
    phaseText,
    '只有用户应用剧情蓝图提案后，才能改变上述方向；不得自行改写终局、人物核心动机或已经发生的事实。',
  ].filter(Boolean).join('\n');
}

function inferStoryWeight(novel) {
  const text = [novel.novelTypeName, novel.outline, novel.worldSetting].filter(Boolean).join(' ');
  if (/悲剧|虐|黑暗|悬疑|惊悚|末日|战争|犯罪|沉重|复仇/.test(text)) return 'heavy';
  if (/轻松|喜剧|搞笑|甜|治愈|校园日常/.test(text)) return 'light';
  return 'balanced';
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
  const minTarget = Math.max(500, Math.min(1800, Math.floor(remainingWords / remainingChapters * 0.6)));
  const maxTarget = Math.max(2600, Math.min(5200, Math.ceil(remainingWords / remainingChapters * 1.75)));
  return Math.max(minTarget, Math.min(maxTarget, weightedTarget));
}

function getChapterOutputTokenLimit(wordTarget) {
  // Chinese prose normally consumes more tokens than characters on the
  // configured providers. This cap prevents one abnormal chapter from using a
  // large share of a long-book budget while leaving reasonable headroom.
  const target = Math.max(1, Number(wordTarget) || 1800);
  return Math.max(2200, Math.min(7600, Math.ceil(target * 1.35)));
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
    coreEvent: planChapter.coreEvent || '承接上一章造成的新问题，做出一个不可逆的选择并留下下一步行动',
    phase: planChapter.phase || '',
    characters: planChapter.characters || [],
    setHooks: planChapter.setHooks || [],
    resolveHooks: planChapter.resolveHooks || [],
    pendingHooks,
    mustAdvance,
    previousEnd: previous ? String(previous.content || '').slice(-260).replace(/\s+/g, ' ').trim() : '故事开场，建立人物的当下处境。',
    mustNot,
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
    '唯一核心事件：' + contract.coreEvent,
    '章节功能：' + contract.emotion.chapterRole + (contract.phase ? '（' + contract.phase + '）' : ''),
    '情绪目标：压力 ' + contract.emotion.tension + '/10；' + contract.emotion.tone,
    '必须承接的上一章状态：' + contract.previousEnd,
    '必须推进的剧情线：' + advance,
    '本章角色：' + list(contract.characters),
    '本章埋设伏笔：' + list(contract.setHooks),
    '本章应回收伏笔：' + list(contract.resolveHooks),
    '已存在的待回收伏笔：' + pending,
    '明确禁止：' + contract.mustNot.join('；'),
    '本章目标字数：约' + contract.wordTarget + '字；全书进度：' + contract.progress,
    contract.emotion.isBreath
      ? '喘息章规则：让读者缓一口气，但必须通过对话、物件、关系变化或新信息推进故事。'
      : '节奏规则：保留情绪落差，结尾留下具体的下一步，而不是抽象总结。',
  ].join('\n');
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
    if (key.length >= 6 && chapterNumber > Number(hook.setChapter || 0) && (compact.includes(key) || (scheduled && compact.includes(key.slice(0, 6))))) {
      hook.status = 'resolved';
      hook.resolvedChapter = chapterNumber;
      hook.resolution = extractEventSignature(content).slice(0, 120);
    }
  });
  return novel;
}

function seedPlannedHooks(novel, planData) {
  initializeCreativeState(novel);
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
  parseChapterPlan,
  buildFallbackChapterPlan,
  renderPlanForContext,
  ensureCreativeState,
  initializeCreativeState,
  ensureStoryBlueprint,
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
};
