const { validChapterMemory } = require('./semanticMemory');

const CURRENT_SOURCE_LIMIT = 20000;
const HISTORY_SOURCE_LIMIT = 10000;
const MAX_HISTORY_CHAPTERS = 24;
const CONTINUITY_LOOKBACK = 3;
const EXCERPT_LIMIT = 360;

function splitExcerpts(source) {
  return String(source || '').split(/\r?\n+/).flatMap(paragraph => {
    const excerpts = [];
    let rest = paragraph.trim();
    while (rest.length > EXCERPT_LIMIT) {
      const window = rest.slice(0, EXCERPT_LIMIT);
      const boundary = Math.max(...['。', '！', '？', '.', '!', '?'].map(mark => window.lastIndexOf(mark)));
      const end = boundary >= 100 ? boundary + 1 : EXCERPT_LIMIT;
      excerpts.push(rest.slice(0, end));
      rest = rest.slice(end).trim();
    }
    if (rest) excerpts.push(rest);
    return excerpts;
  });
}

function currentExcerpts(content) {
  const source = String(content || '').trim();
  if (source.length <= CURRENT_SOURCE_LIMIT) return splitExcerpts(source);
  // Keep the opening, middle, and ending of overlong repaired drafts in view.
  const leading = Math.floor(CURRENT_SOURCE_LIMIT / 3);
  const middle = Math.floor((source.length - leading) / 2);
  return [source.slice(0, leading), source.slice(middle, middle + leading), source.slice(-leading)]
    .flatMap(splitExcerpts);
}

function continuityTerms(text) {
  const terms = new Set(text.toLowerCase().match(/[a-z0-9]+(?:[-_][a-z0-9]+)+/g) || []);
  for (const match of text.matchAll(/(?=(\p{Script=Han}{3}))/gu)) terms.add(match[1]);
  return terms;
}

function relevantHistoryExcerpts(source, queryTerms) {
  if (!queryTerms?.size) return [];
  const candidates = splitExcerpts(source).map(excerpt => {
    let score = 0;
    for (const term of continuityTerms(excerpt)) {
      if (queryTerms.has(term)) score += term.includes('-') || term.includes('_') ? 8 : 1;
    }
    return { excerpt, score };
  });
  return candidates.filter(candidate => candidate.score >= 2).sort((a, b) => b.score - a.score);
}

function historicalExcerpts(chapter, budget, queryTerms) {
  const source = String(chapter.content || '').trim();
  if (source.length <= budget) return splitExcerpts(source);
  const edge = Math.min(EXCERPT_LIMIT, Math.floor(budget / 4));
  const excerpts = new Set([...splitExcerpts(source.slice(0, edge)), ...splitExcerpts(source.slice(-edge))]);
  let remaining = budget - edge * 2;
  let continuityBudget = Math.floor(budget / 3);
  for (const { excerpt } of relevantHistoryExcerpts(source, queryTerms)) {
    if (excerpts.has(excerpt) || excerpt.length > Math.min(remaining, continuityBudget)) continue;
    excerpts.add(excerpt);
    remaining -= excerpt.length;
    continuityBudget -= excerpt.length;
    if (continuityBudget < 40) break;
  }
  const memory = validChapterMemory(chapter);
  const candidates = [memory?.events, memory?.facts, memory?.characters].flatMap(items => Array.isArray(items) ? items : [])
    .map(item => String(item?.evidence || '').trim())
    .filter(excerpt => excerpt && source.includes(excerpt));
  for (const excerpt of candidates) {
    if (excerpts.has(excerpt) || excerpt.length > remaining) continue;
    excerpts.add(excerpt);
    remaining -= excerpt.length;
  }
  // Older books can lack usable memories, or their quotes can exceed the
  // chapter's share of the budget. Give the reviewer raw middle context too.
  if (remaining >= 40) {
    const start = Math.floor((source.length - remaining) / 2);
    excerpts.add(source.slice(start, start + remaining));
  }
  return [...excerpts].sort((a, b) => source.indexOf(a) - source.indexOf(b)).flatMap(splitExcerpts);
}

function buildNumberedSource({ checkpoint, chapters, chapterNumber, content }) {
  const firstChapter = checkpoint.phaseGoal ? Number(checkpoint.startChapter) : chapterNumber - CONTINUITY_LOOKBACK;
  const arc = (chapters || [])
    .filter(chapter => Number(chapter.chapterNumber) >= firstChapter && Number(chapter.chapterNumber) < chapterNumber)
    .sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));
  const history = arc.length <= MAX_HISTORY_CHAPTERS ? arc : Array.from({ length: MAX_HISTORY_CHAPTERS },
    (_, index) => arc[Math.round(index * (arc.length - 1) / (MAX_HISTORY_CHAPTERS - 1))]);
  const historyBudget = Math.min(2000, Math.floor(HISTORY_SOURCE_LIMIT / Math.max(1, history.length)));
  const current = { chapterNumber, excerpts: currentExcerpts(content) };
  const queryTerms = history.length ? continuityTerms(current.excerpts.join('\n')) : null;
  const saved = history.map(chapter => ({
    chapterNumber: Number(chapter.chapterNumber),
    excerpts: historicalExcerpts(chapter, historyBudget,
      Number(chapter.chapterNumber) >= chapterNumber - CONTINUITY_LOOKBACK ? queryTerms : null),
  }));
  const sources = checkpoint.phaseGoal ? [...saved, current] : [current, ...saved];
  const evidenceRows = [];
  const text = sources.map(source => {
    const lines = source.excerpts.map(excerpt => {
      const row = evidenceRows.push({ chapterNumber: source.chapterNumber, excerpt });
      return `[${row}] ${excerpt}`;
    });
    return [`【第${source.chapterNumber}章${source.chapterNumber === chapterNumber ? '当前待提交' : '已保存'}】`, ...lines].join('\n');
  }).join('\n');
  return { evidenceRows, text };
}

function numberedEvidence(id, rows) {
  const number = /^(?:\[\s*(\d+)\s*\]|(\d+))$/.exec(id.trim());
  return number ? rows[Number(number[1] || number[2]) - 1] : undefined;
}

function parseCitationRows(source, goalKey, chapterNumber, rows) {
  const grouped = /^\[([^\[\]]+)\]$/.exec(source);
  const locators = (grouped?.[1] || source).replace(/\]\s*(?=\[)/g, '],').split(/[,，、]/);
  const cited = new Set();
  for (const locator of locators) {
    const text = locator.trim().replace(/^\[([^\[\]]+)\]$/, '$1')
      .replace(/^\[\s*(\d+)\s*\]\s*([-–—至])\s*\[\s*(\d+)\s*\]$/, '$1$2$3').trim();
    const range = /^(\d+)(?:\s*[-–—至]\s*(\d+))?$/.exec(text);
    if (!range) return null;
    const first = Number(range[1]);
    const last = Number(range[2] ?? first);
    if (first < 1 || last < first || last > rows.length) return null;
    for (let id = first; id <= last; id++) {
      const row = rows[id - 1];
      if (goalKey === 'CHAPTER' && row.chapterNumber !== chapterNumber) return null;
      cited.add(row);
    }
  }
  return cited;
}

function citedRows(verdict, goalKey, chapterNumber, rows) {
  const direct = parseCitationRows(verdict, goalKey, chapterNumber, rows);
  if (direct || goalKey !== 'CHAPTER') return direct;
  // Reviewers sometimes echo the chapter number as a label, even when using
  // a comma separator. Only remove that label if the remaining locators all
  // point to the current chapter and the direct interpretation was invalid.
  const prefixed = /^(\d+)\s*[|｜,，]\s*(.+)$/.exec(verdict);
  return prefixed && Number(prefixed[1]) === chapterNumber
    ? parseCitationRows(prefixed[2].trim(), goalKey, chapterNumber, rows) : null;
}

function parseContinuityConflict(line, rows, chapterNumber) {
  const match = /^CONTINUITY\s*[=＝:：]\s*([^|｜]+)[|｜]([^|｜]+)[|｜]([^|｜]{1,200})$/i.exec(line);
  if (!match) return null;
  const past = numberedEvidence(match[1], rows);
  const current = numberedEvidence(match[2], rows);
  const issue = match[3].trim();
  return past?.chapterNumber < chapterNumber && current?.chapterNumber === chapterNumber && issue
    ? { past, current, issue } : null;
}

function parseProgressReview(output, goals, rows, chapterNumber) {
  const lines = String(output || '').trim().replace(/^```(?:text)?\s*\n/i, '').replace(/\n```\s*$/, '')
    .split(/\r?\n/).map(line => line.trim().replace(/^[-*]\s+/, '').replace(/^(\*\*|`)(.+)\1$/, '$2')).filter(Boolean);
  const isContinuityLine = line => /^CONTINUITY\s*[=＝:：]/i.test(line);
  const goalLines = lines.filter(line => !isContinuityLine(line));
  if (goalLines.length !== goals.length) return null;
  const evidence = new Set();
  const repairAnchors = new Map();
  const missing = [];
  const unchecked = new Map(goals.map(goal => [goal.key, goal]));
  for (const line of goalLines) {
    const match = /^(CHAPTER|PHASE)\s*[=＝:：]\s*(.+)$/i.exec(line);
    const goal = match && unchecked.get(match[1].toUpperCase());
    if (!goal) return null;
    unchecked.delete(goal.key);
    const verdict = match[2].trim();
    const failure = /^NONE\s*[|｜]\s*([^|｜]{1,200})(?:[|｜](.*))?$/i.exec(verdict);
    if (failure) {
      const issue = failure[1].trim();
      if (!issue) return null;
      missing.push(`${goal.label}未达成（${issue}）`);
      const replacement = /^REPLACE\s*[:：]\s*(.+)$/i.exec(failure[2]?.trim() || '');
      const locator = replacement ? replacement[1] : failure[2];
      const anchor = locator && numberedEvidence(locator, rows);
      if (anchor?.chapterNumber === chapterNumber) repairAnchors.set(anchor, Boolean(replacement || repairAnchors.get(anchor)));
      continue;
    }
    const cited = citedRows(verdict, goal.key, chapterNumber, rows);
    if (!cited) return null;
    for (const row of cited) evidence.add(row);
  }
  const continuityConflict = lines.filter(isContinuityLine)
    .map(line => parseContinuityConflict(line, rows, chapterNumber)).find(Boolean);
  if (continuityConflict) {
    const { past, current, issue } = continuityConflict;
    missing.unshift(`第${past.chapterNumber}章已发生事实与本章冲突（${issue}）`);
    evidence.delete(current);
    repairAnchors.delete(current);
  }
  if (!missing.length) return { passed: true, evidence: [...evidence] };
  const anchors = [...repairAnchors].map(([row, replace]) => replace ? { ...row, replace } : row);
  if (continuityConflict) anchors.unshift({ ...continuityConflict.current, replace: true });
  return { passed: false, issue: missing.join('；'), ...(evidence.size ? { evidence: [...evidence] } : {}),
    ...(anchors.length ? { repairAnchors: anchors } : {}),
    ...(continuityConflict ? { continuityConflict } : {}) };
}

function renderRepairContext(context) {
  if (typeof context?.revised !== 'string' || !context.revised.trim()) return '';
  const before = String(context.before || '').trim().slice(-420);
  const after = String(context.after || '').trim().slice(0, 420);
  const revised = context.revised.trim();
  const boundary = revised.length > 1000 ? `${revised.slice(0, 500)}\n[…中间正文见下方原文…]\n${revised.slice(-500)}` : revised;
  return `\n【本次修订相邻原文】
前文末尾：${before || '（章首）'}
修订内容：${boundary}
后文开头：${after || '（章末）'}
仅当修订接缝重复发生同一个关键动作，或与相邻场景的已发生事实产生实质冲突，并影响目标准确性与剧情连贯时，指出该处缺口。允许自然承接、明确标出的回忆及叙事风格变化。引用证据时仍使用下方有编号的正文。\n`;
}

async function reviewChapterProgress({ checkpoint, chapters, chapterNumber, content, request, repairContext }) {
  const chapter = Number(chapterNumber);
  const goals = [
    { key: 'CHAPTER', label: '本章目标', target: checkpoint?.chapterGoal },
    { key: 'PHASE', label: '篇章目标', target: checkpoint?.phaseGoal },
  ].filter(goal => String(goal.target || '').trim());
  if (!goals.length) return { passed: true, evidence: [] };
  const { evidenceRows, text } = buildNumberedSource({ checkpoint, chapters, chapterNumber: chapter, content });
  if (!evidenceRows.some(row => row.chapterNumber === chapter)) return { passed: false, invalid: true, issue: '本章没有可核对的正文' };
  const scope = {
    CHAPTER: `CHAPTER 只核对第${chapter}章最主要的一项预定进展。实际行动、人物选择、关系或认知发生的实质变化、计划中的回忆场景都可以证明进展。只要达成计划中的主要结果，场景安排、顺序、视角和措辞都可以调整。仅有猜测、未来打算或复述已知事实时，仍需确认计划要求的变化是否实际发生。`,
    PHASE: 'PHASE 只核对截至本章应兑现的篇章结果。可以引用本篇章任一章的正文，前文已经达成的结果无需在本章重演。阶段局面以后文确立的事实为准。保留后续篇章才需解释的问题、转折和伏笔。用最少的原文证据核对结果。',
  };
  const prompt = `核对篇章“${checkpoint.title || '当前篇章'}”（第${checkpoint.startChapter}–${checkpoint.endChapter}章）的实际进展。
${goals.map(goal => `${goal.key} ${goal.label}：${goal.target}`).join('\n')}
${goals.map(goal => scope[goal.key]).join('\n')}
每项目标一行，格式为 ${goals.map(goal => `${goal.key}=编号`).join(' 或 ')}，选择最能说明结果的实际证据编号，多个编号用逗号连接。目标确实缺失时用 ${goals.map(goal => `${goal.key}=NONE|具体缺口`).join(' 或 ')}。可以追加 |编号，表示在这段之后补写。只有原段已经写出了与目标直接冲突的事实、补写无法衔接时，才追加 |REPLACE:编号 建议替换该段。
如有实质连续性冲突，另写一行 CONTINUITY=已保存正文编号|本章正文编号|具体冲突。两处原文都必须明确描述同一人物、物件或事件在时间、持有、位置、存亡或已确立结果上的矛盾，且前后正文没有解释变化。允许自然接续、明确的回忆或转述、重复使用的意象、新出现的信息、效果消退和已写出的交接。没有直接冲突证据就不输出此行。不要输出其他内容。${renderRepairContext(repairContext)}
【正文证据】
${text}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const retry = attempt ? `\n\n上次未返回能定位的编号。每个目标严格一行，共 ${goals.length} 行。等号后只写下方方括号里的证据号，省略当前章号。没有证据时，写该目标=NONE|具体缺口。只有能够引用两处原文时，才另写一行 CONTINUITY。不要附加说明。` : '';
    const result = await request(prompt + retry);
    if (!result || result.finishReason === 'content_filter') break;
    const review = result.finishReason === 'length' ? null : parseProgressReview(result.content, goals, evidenceRows, chapter);
    if (review) return review;
  }
  return { passed: false, invalid: true, issue: '篇章复核没有返回可定位的正文证据' };
}

module.exports = { reviewChapterProgress };
