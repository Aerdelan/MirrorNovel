const {
  parseChapterPlan, isPlaceholderChapterTitle, buildFallbackChapterPlan,
  getClosingWindowStart, openStoryHooks, renderStoryBlueprintForContext, seedPlannedHooks, MODEL_ROLLING_PLAN,
} = require('./storyState');
const { getFixedChapterCount } = require('./bookChapterCount');
const { validChapterMemory } = require('./semanticMemory');

const BATCH_SIZE = 8;
const LOCAL_FALLBACK = '本地兜底计划';
const GENERIC_EVENT = /严格承接前章结果|^依据大纲完成主线收束|^承接上一章(?:结果|造成的新问题)|^推进主线$|^落实当前篇章与小阶段约束$/;

function needsDetailedPlan(chapter) {
  return !chapter || !String(chapter.coreEvent || '').trim()
    || (chapter.raw === LOCAL_FALLBACK && GENERIC_EVENT.test(chapter.coreEvent));
}

function constrainChapterPlan(novel, planData, targetChapterCount, { targetWords, chapterWordTarget } = {}) {
  const planned = new Map();
  for (const chapter of planData.chapters || []) {
    const number = Number(chapter.chapterNumber);
    if (!Number.isSafeInteger(number) || number < 1 || number > targetChapterCount || planned.has(number)) continue;
    planned.set(number, chapter);
  }
  const fallback = planned.size < targetChapterCount
    ? buildFallbackChapterPlan(novel, { targetWords, chapterWordTarget, totalChapters: targetChapterCount })
    : null;
  const written = new Set((novel.chapters || []).map(chapter => Number(chapter.chapterNumber)));
  const chapters = Array.from({ length: targetChapterCount }, (_, index) => {
    const number = index + 1;
    const chapter = planned.get(number) || fallback.chapters[index];
    return number === targetChapterCount && !written.has(number)
      ? { ...chapter, chapterRole: '收束', setHooks: [] }
      : chapter;
  });
  const phases = planData.phases?.length ? planData.phases : (fallback?.phases || []);
  return { ...planData, chapters, phases };
}

function planningWindow(novel, plan, chapterNumber, totalChapters) {
  if (!(Number(novel.targetWordCount) >= 100000 || getFixedChapterCount(novel) >= BATCH_SIZE * 2)) return [];
  const byNumber = new Map((plan.chapters || []).map(chapter => [Number(chapter.chapterNumber), chapter]));
  const activePhase = (novel.storyBlueprint?.phases || []).find(phase => chapterNumber >= Number(phase.startChapter) && chapterNumber <= Number(phase.endChapter));
  const activeSubphase = (activePhase?.subphases || []).find(phase => chapterNumber >= Number(phase.startChapter) && chapterNumber <= Number(phase.endChapter));
  const stageEnd = Number(activeSubphase?.endChapter || activePhase?.endChapter) || totalChapters;
  const numbers = [];
  for (let number = chapterNumber; number <= Math.min(totalChapters, stageEnd, chapterNumber + BATCH_SIZE - 1); number++) {
    if (!needsDetailedPlan(byNumber.get(number))) break;
    numbers.push(number);
  }
  return numbers;
}

function adoptConfirmedChapterPlans(novel, planData, chapterNumber) {
  const cards = new Map((novel.storyBlueprint?.rollingPlan?.chapters || []).map(card => [Number(card.chapterNumber), card]));
  const completed = Math.max(0, ...(novel.chapters || []).map(chapter => Number(chapter.chapterNumber) || 0));
  let changed = false;
  for (const chapter of planData.chapters || []) {
    if (chapter.chapterNumber < chapterNumber || chapter.chapterNumber <= completed || chapter.raw !== LOCAL_FALLBACK || !needsDetailedPlan(chapter)) continue;
    const card = cards.get(Number(chapter.chapterNumber));
    if (!card || isPlaceholderChapterTitle(card.title) || !String(card.purpose || '').trim() || GENERIC_EVENT.test(card.purpose)) continue;
    chapter.coreEvent = card.purpose;
    if (isPlaceholderChapterTitle(chapter.title)) chapter.title = card.title;
    changed = true;
  }
  if (changed) {
    novel.chapterPlanData = planData;
    novel.chapterPlan = JSON.stringify(planData);
    novel.markModified?.('chapterPlanData');
    novel.markModified?.('chapterPlan');
  }
  return changed;
}

function validateDetailedPlan(content, numbers, priorChapters = []) {
  const plan = parseChapterPlan(content);
  if (plan.chapters.length !== numbers.length) throw new Error('计划章节数量不完整');
  const byNumber = new Map(plan.chapters.map(chapter => [chapter.chapterNumber, chapter]));
  if (byNumber.size !== numbers.length || numbers.some(number => !byNumber.has(number))) {
    throw new Error('计划章节号重复、越界或缺失');
  }
  const eventKey = value => String(value || '').replace(/\s+/g, '').replace(/第\d+章/g, '');
  const events = new Set(priorChapters.map(chapter => eventKey(chapter.coreEvent)).filter(Boolean));
  const titles = new Set(priorChapters.map(chapter => chapter.title).filter(Boolean));
  return numbers.map(number => {
    const chapter = byNumber.get(number);
    const event = eventKey(chapter.coreEvent);
    const title = chapter.title;
    if (event.length < 8 || GENERIC_EVENT.test(event) || events.has(event)) throw new Error('核心事件空泛或重复');
    if (title.length < 2 || isPlaceholderChapterTitle(title) || titles.has(title)
      || /^(?:周[一二三四五六日天]|星期[一二三四五六日天])[,，\s]*(?:上午|下午|早上|晚上)[零一二三四五六七八九十百\d点时分半：:]*$/.test(title)) {
      throw new Error('章节标题缺失、重复或仅有时间信息');
    }
    events.add(event);
    titles.add(title);
    return { ...chapter, title };
  });
}

function outlineForPlanning(outline, start, end) {
  if (outline.length <= 14000) return outline;

  // Numbered headings can mark one chapter or a range such as 第301–308章.
  const headings = [...outline.matchAll(/^[ \t#>*-]*第[ \t]*(\d+)[ \t]*(?:章?[ \t]*[-–—~～至到][ \t]*第?[ \t]*(\d+)[ \t]*)?章/gm)];
  const sections = [];
  for (const [index, heading] of headings.entries()) {
    const first = Number(heading[1]);
    const last = Number(heading[2] || heading[1]);
    if (first > last || first > end || last < start) continue;
    sections.push({ from: heading.index, to: headings[index + 1]?.index ?? outline.length });
    if (sections.length === 16) break;
  }
  if (!sections.length) {
    return `${outline.slice(0, 10000)}\n（大纲中段由已确认篇章约束承载）\n${outline.slice(-4000)}`;
  }

  const sectionLimit = Math.floor(7900 / sections.length) - 1;
  const excerpts = sections.map(({ from, to }) => outline.slice(from, Math.min(to, from + sectionLimit)).trim());
  return `${outline.slice(0, 4000)}\n【第${start}-${end}章对应的大纲原文】\n${excerpts.join('\n')}\n【大纲末段】\n${outline.slice(-2000)}`;
}

function renderRecentEventEvidence(chapters) {
  return chapters.flatMap(chapter => {
    const memory = validChapterMemory(chapter);
    if (!memory) return [];
    const source = String(chapter.content || '');
    const excerpts = [];
    for (const event of memory.events) {
      const evidence = String(event?.evidence || '').trim();
      if (!evidence || evidence.length > 180 || excerpts.some(excerpt => excerpt.includes(evidence))) continue;
      const offset = source.indexOf(evidence);
      if (offset < 0) continue;
      // Keep the action following the extract as well. An object is often
      // identified in one sentence and changes hands in the next paragraph.
      const excerpt = source.slice(Math.max(0, offset - 40), offset + evidence.length + 160).trim();
      excerpts.push(excerpt);
      if (excerpts.length === 2) break;
    }
    return excerpts.map(excerpt => `第${chapter.chapterNumber}章：${excerpt}`);
  }).join('\n\n');
}

/** Refine only future placeholder cards. This never approves blueprint changes
 * or changes authored plans/committed chapters. No model call is needed when
 * a concrete plan already exists, including at a resumed batch boundary. */
async function ensureDetailedLongFormPlan({ novel, planData, chapterNumber, totalChapters, requestPlan, onUsage, draft = '' }) {
  adoptConfirmedChapterPlans(novel, planData, chapterNumber);
  const numbers = planningWindow(novel, planData, chapterNumber, totalChapters);
  if (!numbers.length) return false;
  const completed = Math.max(0, ...(novel.chapters || []).map(chapter => Number(chapter.chapterNumber) || 0));
  if (numbers.some(number => number <= completed)) throw new Error('禁止覆盖已完成章节的计划');
  const start = numbers[0];
  const end = numbers.at(-1);
  const closingStart = getClosingWindowStart(totalChapters);
  const hookKey = content => String(content || '').replace(/\s/g, '');
  const scheduledPayoffs = new Map(openStoryHooks(novel.foreshadowingLedger, totalChapters + 1)
    .filter(hook => hookKey(hook.content) && Number.isSafeInteger(Number(hook.targetChapter))
      && Number(hook.targetChapter) >= Math.max(start, Number(hook.setChapter) || 0))
    .map(hook => [hookKey(hook.content), hook]));
  const batchPayoffs = [...scheduledPayoffs.values()].filter(hook => Number(hook.targetChapter) <= end);
  const describePayoff = hook => `- ${String(hook.content || '').slice(0, 200)}${hook.targetChapter ? `（原定第${hook.targetChapter}章）` : ''}`;
  const scheduledPlan = batchPayoffs.length
    ? `【本批须按章兑现的伏笔】\n将回收动作纳入指定章的 coreEvent 或 requiredScenes，resolveHooks 保留原名。\n${batchPayoffs.map(hook => `${describePayoff(hook)}${hook.payoffPlan ? `：${String(hook.payoffPlan).slice(0, 200)}` : ''}`).join('\n')}`
    : '';
  const closingHooks = end >= closingStart
    ? openStoryHooks(novel.foreshadowingLedger, start)
      .filter(hook => !batchPayoffs.includes(hook)).slice(0, 32).map(describePayoff)
      .join('\n')
    : '';
  const closingPlan = end >= closingStart
    ? `第${closingStart}至${totalChapters}章是终局，按因果顺序把仍待回收的线索、主要关系和人物选择分配到多章。终局章的 setHooks 为空；为第${totalChapters}章预留核心冲突的具体结果与结果发生后的场景。${end === totalChapters ? `本批包含终章，必须在第${totalChapters}章明确全书结局。` : ''}${closingHooks ? `\n【其他待回收伏笔】\n${closingHooks}` : ''}`
    : `第${closingStart}至${totalChapters}章负责全书终局。此批只完成所在阶段的目标，明确后续仍需兑现的线索。`;
  const previous = (novel.chapters || []).filter(chapter => Number(chapter.chapterNumber) < start).slice(-3);
  const recentEventEvidence = renderRecentEventEvidence(previous);
  const outlineContext = outlineForPlanning(String(novel.outline || ''), start, end);
  const prompt = `细化未来第${start}-${end}章的执行计划，只输出这${numbers.length}章的 JSON。
你是在执行已确认大纲，不是在提出新的故事蓝图。不得改写已发生事实、终局、人物动机或用户已定章节。
每章必须有不同的具体核心事件，写清谁采取什么行动、遇到什么阻力、造成什么新结果。后一章承接前章结果，不能用天气、上班日期或通用的“推进主线”凑章节。
按指定章号落实本批次内的转折和伏笔。后续节点留待对应章节，阶段末章须达到已确认的离开条件。
setHooks 只写本章要埋下、以后需要给出答案的疑问。行动、线索推进和已说明的事实写入 coreEvent，不单独登记；同一伏笔前后的登记名称保持一致。
${scheduledPlan}
${closingPlan}
每章给出2-16字短标题，标题概括该章独有冲突或结果，不能摘取正文首句。不要输出正文。
【原始大纲】
${outlineContext}
${renderStoryBlueprintForContext(novel, start, totalChapters)}
【已完成字数/目标字数】${novel.currentWordCount || 0}/${novel.targetWordCount}
【已存剧情摘要】
${String(novel.chapterSummaryDoc || '').slice(-6000)}
【最近已完成章节】
${previous.map(chapter => `第${chapter.chapterNumber}章 ${chapter.title || ''}\n${String(chapter.content || '').slice(-900)}`).join('\n')}
${recentEventEvidence ? `【已完成章节的关键动作原文】\n下面的原文来自已保存正文。涉及交接、位置或已发生结果时按正文决定当前状态；如本批需要再次改变，须安排对应的交接或变化原因。\n${recentEventEvidence}\n` : ''}
${draft ? `【第${start}章已有待恢复草稿】\n${String(draft).slice(0, 600)}\n${String(draft).slice(-1400)}\n本章计划必须遵循上述草稿已经展开的事件，不得另起情节或推翻草稿。` : ''}
【阶段记忆】
${String(novel.contextMemory?.checkpointSummary || '').slice(0, 3000)}
【已存事实与未决问题】
${[...(novel.contextMemory?.facts || []), ...(novel.contextMemory?.openLoops || [])].slice(0, 24).map(value => String(value).slice(0, 160)).join('\n')}
只返回 {"chapters":[{"chapterNumber":${start},"title":"短标题","coreEvent":"具体行动、冲突与结果","wordTarget":${novel.chapterWordTarget || 3000},"setHooks":[],"resolveHooks":[],"characters":[],"relationshipBeat":"关系变化","requiredScenes":[],"forbiddenDrift":[]}]}。
必须逐章覆盖第${start}-${end}章，章节号不得重复或越界；不要重新生成已完成章节。`;
  let chapters;
  let validationError = '';
  const priorChapters = (planData.chapters || []).filter(chapter => chapter.chapterNumber < start).slice(-12);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await requestPlan(prompt + (validationError ? `\n上次结构校验失败：${validationError}。请重做完整 JSON。` : ''));
    if (onUsage) onUsage(result);
    try {
      chapters = validateDetailedPlan(result?.content || '', numbers, priorChapters);
      break;
    } catch (error) {
      validationError = error.message;
    }
  }
  if (!chapters) throw new Error(`第${start}-${end}章详细计划校验失败：${validationError}`);
  const replacements = new Map(chapters.map(chapter => [chapter.chapterNumber, chapter]));
  const planned = new Map((planData.chapters || []).map(chapter => [Number(chapter.chapterNumber), chapter]));
  // Merge inherited constraints before model additions, rather than letting a
  // sparse model response erase the approved stage's voice/tags/drift guards.
  for (const [number, chapter] of replacements) {
    const existing = planned.get(number) || {};
    const merged = { ...existing, ...chapter, raw: MODEL_ROLLING_PLAN };
    for (const field of ['tagCommitments', 'requiredScenes', 'forbiddenDrift', 'setHooks', 'characters']) {
      const additions = field === 'setHooks' && number >= closingStart ? [] : (chapter[field] || []);
      merged[field] = [...new Set([...(existing[field] || []), ...additions])];
    }
    merged.resolveHooks = [...new Set([
      ...(existing.resolveHooks || []),
      ...batchPayoffs.filter(hook => Number(hook.targetChapter) === number).map(hook => hook.content),
      ...(chapter.resolveHooks || []).filter(content => !scheduledPayoffs.has(hookKey(content))),
    ])];
    const inheritedHooks = new Set(existing.setHooks || []);
    const previousProposals = existing.modelHookProposals || (existing.raw === MODEL_ROLLING_PLAN ? [...inheritedHooks] : []);
    merged.modelHookProposals = [...new Set([...previousProposals, ...merged.setHooks.filter(hook => !inheritedHooks.has(hook))])];
    if (number === totalChapters) {
      merged.chapterRole = '收束';
      merged.setHooks = [];
      merged.modelHookProposals = [];
    }
    merged.characterBeat = [existing.characterBeat, chapter.characterBeat].filter(Boolean).join('；');
    merged.wordTarget = Number(existing.wordTarget) || Number(chapter.wordTarget) || Number(novel.chapterWordTarget) || 3000;
    planned.set(number, merged);
  }
  planData.chapters = [...planned.values()].sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));
  novel.chapterPlanData = planData;
  novel.chapterPlan = JSON.stringify(planData);
  seedPlannedHooks(novel, planData);
  // The rolling window may contain synthetic placeholders. Keep its concrete
  // execution event in agreement with the newly detailed durable plan.
  for (const card of novel.storyBlueprint?.rollingPlan?.chapters || []) {
    if (!replacements.has(Number(card.chapterNumber))) continue;
    const chapter = planned.get(Number(card.chapterNumber));
    card.title = chapter.title;
    card.purpose = chapter.coreEvent;
  }
  for (const field of ['chapterPlanData', 'chapterPlan', 'storyBlueprint', 'foreshadowingLedger']) novel.markModified?.(field);
  return true;
}

module.exports = { constrainChapterPlan, needsDetailedPlan, planningWindow, adoptConfirmedChapterPlans, validateDetailedPlan, ensureDetailedLongFormPlan };
