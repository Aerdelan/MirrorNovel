const {
  parseChapterPlan, isPlaceholderChapterTitle,
  renderStoryBlueprintForContext,
} = require('./storyState');

const BATCH_SIZE = 8;
const LOCAL_FALLBACK = '本地兜底计划';
const GENERIC_EVENT = /严格承接前章结果|^依据大纲完成主线收束|^承接上一章(?:结果|造成的新问题)|^推进主线$|^落实当前篇章与小阶段约束$/;

function needsDetailedPlan(chapter) {
  return !chapter || !String(chapter.coreEvent || '').trim()
    || (chapter.raw === LOCAL_FALLBACK && GENERIC_EVENT.test(chapter.coreEvent));
}

function planningWindow(novel, plan, chapterNumber, totalChapters) {
  if (!(Number(novel.targetWordCount) >= 100000)) return [];
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
  const previous = (novel.chapters || []).filter(chapter => Number(chapter.chapterNumber) < start).slice(-3);
  const outline = String(novel.outline || '');
  const outlineContext = outline.length <= 14000 ? outline : `${outline.slice(0, 10000)}\n（大纲中段由已确认篇章约束承载）\n${outline.slice(-4000)}`;
  const prompt = `细化未来第${start}-${end}章的执行计划，只输出这${numbers.length}章的 JSON。
你是在执行已确认大纲，不是在提出新的故事蓝图。不得改写已发生事实、终局、人物动机或用户已定章节。
每章必须有不同的具体核心事件，写清谁采取什么行动、遇到什么阻力、造成什么新结果。后一章承接前章结果，不能用天气、上班日期或通用的“推进主线”凑章节。
每章给出2-16字短标题，标题概括该章独有冲突或结果，不能摘取正文首句。不要输出正文。
【原始大纲】
${outlineContext}
${renderStoryBlueprintForContext(novel, start, totalChapters)}
【已完成字数/目标字数】${novel.currentWordCount || 0}/${novel.targetWordCount}
【已存剧情摘要】
${String(novel.chapterSummaryDoc || '').slice(-6000)}
【最近已完成章节】
${previous.map(chapter => `第${chapter.chapterNumber}章 ${chapter.title || ''}\n${String(chapter.content || '').slice(-900)}`).join('\n')}
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
    const merged = { ...existing, ...chapter, raw: '模型分批细化计划' };
    for (const field of ['tagCommitments', 'requiredScenes', 'forbiddenDrift', 'setHooks', 'resolveHooks', 'characters']) {
      merged[field] = [...new Set([...(existing[field] || []), ...(chapter[field] || [])])];
    }
    merged.characterBeat = [existing.characterBeat, chapter.characterBeat].filter(Boolean).join('；');
    merged.wordTarget = Number(existing.wordTarget) || Number(chapter.wordTarget) || Number(novel.chapterWordTarget) || 3000;
    planned.set(number, merged);
  }
  planData.chapters = [...planned.values()].sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));
  novel.chapterPlanData = planData;
  novel.chapterPlan = JSON.stringify(planData);
  // The rolling window may contain synthetic placeholders. Keep its concrete
  // execution event in agreement with the newly detailed durable plan.
  for (const card of novel.storyBlueprint?.rollingPlan?.chapters || []) {
    if (!replacements.has(Number(card.chapterNumber))) continue;
    const chapter = planned.get(Number(card.chapterNumber));
    card.title = chapter.title;
    card.purpose = chapter.coreEvent;
  }
  for (const field of ['chapterPlanData', 'chapterPlan', 'storyBlueprint']) novel.markModified?.(field);
  return true;
}

module.exports = { needsDetailedPlan, planningWindow, adoptConfirmedChapterPlans, validateDetailedPlan, ensureDetailedLongFormPlan };
