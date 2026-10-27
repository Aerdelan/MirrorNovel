// Local, model-independent check. Compare endings separately: a copied 200-character
// ending in a 5,000-character chapter is almost invisible to whole-chapter scores.
const ENDING_CHARS = 1800;
const MIN_MATCH = 100;
const ANCHOR = 32;

function normalizeWithOffsets(value) {
  const source = String(value || '');
  let text = '';
  const offsets = [];
  for (let i = 0; i < source.length; i++) {
    if (/[\p{L}\p{N}]/u.test(source[i])) {
      text += source[i].toLowerCase();
      offsets.push(i);
    }
  }
  return { text, offsets };
}

function detectRepeatedEnding(content, chapters = [], chapterNumber = Infinity, minStart = 0) {
  const source = String(content || '');
  const tailStart = Math.max(0, source.length - ENDING_CHARS, minStart);
  const current = normalizeWithOffsets(source.slice(tailStart));
  if (current.text.length < MIN_MATCH) return null;
  let best = null;
  for (const chapter of chapters) {
    // Never compare a revision with itself or with chapters that follow it.
    if (Number(chapter.chapterNumber) >= chapterNumber) continue;
    const previous = normalizeWithOffsets(String(chapter.content || '').slice(-ENDING_CHARS)).text;
    if (previous.length < MIN_MATCH) continue;
    const anchors = new Map();
    const coveredUntil = new Map();
    for (let i = 0; i <= previous.length - ANCHOR; i++) {
      const key = previous.slice(i, i + ANCHOR);
      if (!anchors.has(key)) anchors.set(key, []);
      anchors.get(key).push(i);
    }
    // Sampling every 32 characters still guarantees an anchor inside a match
    // of >=100 characters. Extend both ways to recover the exact source span.
    for (let i = 0; i <= current.text.length - ANCHOR; i += ANCHOR) {
      const positions = anchors.get(current.text.slice(i, i + ANCHOR)) || [];
      for (const j of positions) {
        const diagonal = i - j;
        if (i < (coveredUntil.get(diagonal) || 0)) continue;
        let left = 0, right = ANCHOR;
        while (i - left > 0 && j - left > 0 && current.text[i - left - 1] === previous[j - left - 1]) left++;
        while (i + right < current.text.length && j + right < previous.length && current.text[i + right] === previous[j + right]) right++;
        const matchedChars = left + right;
        // A diagonal can have separate matches; skip anchors inside the
        // segment just visited, not later unrelated passages on that diagonal.
        coveredUntil.set(diagonal, i + right);
        if (matchedChars < MIN_MATCH || (best && best.matchedChars >= matchedChars)) continue;
        const start = tailStart + current.offsets[i - left];
        const end = tailStart + current.offsets[i + right - 1] + 1;
        best = { chapterNumber: Number(chapter.chapterNumber), matchedChars, start, end, excerpt: source.slice(start, end) };
        if (matchedChars === current.text.length) return best;
      }
    }
  }
  return best;
}

function repetitionError(match, cause) {
  const error = new Error(`章末与第${match.chapterNumber}章重复${match.matchedChars}字，已阻止写入正式章节`);
  error.code = 'CHAPTER_ENDING_REPEATED';
  error.repetition = match;
  if (cause) error.cause = cause;
  return error;
}

function assertDistinctEnding(content, chapters, chapterNumber, minStart = 0) {
  const match = detectRepeatedEnding(content, chapters, chapterNumber, minStart);
  if (match) throw repetitionError(match);
}

function buildEndingHistory(chapters = [], chapterNumber = Infinity) {
  const history = chapters.filter(chapter => Number(chapter.chapterNumber) < chapterNumber).slice(-3);
  if (!history.length) return '';
  return '\n【章末防重复】以下是已经发表的收尾，仅供核对事实，禁止复制进本章。'
    + '衔接是从其后果继续推进，不是重演这些段落；本章结尾须落在本章新发生的动作、信息或选择上。\n'
    + history.map(chapter => `第${chapter.chapterNumber}章已用收尾：\n${String(chapter.content || '').slice(-500)}`).join('\n');
}

async function repairRepeatedEnding({ content, chapters, chapterNumber, generate, onStatus, minRewriteStart = 0, signal }) {
  const original = String(content || '');
  const match = detectRepeatedEnding(original, chapters, chapterNumber, minRewriteStart);
  if (!match) return { content: original, report: null };
  // Rewrite from a sentence/paragraph boundary before the copied passage, keeping
  // the chapter's earlier prose byte-for-byte. Appending to a published chapter
  // may only change the newly generated addition.
  let start = Math.max(minRewriteStart, original.lastIndexOf('\n', match.start - 1) + 1);
  if (start < original.length - 2400) {
    const boundary = original.lastIndexOf('。', match.start - 1);
    start = Math.max(minRewriteStart, boundary >= 0 ? boundary + 1 : match.start);
  }
  const prefix = original.slice(0, start);
  const tail = original.slice(start);
  if (tail.length > 3600 || match.start < minRewriteStart) throw repetitionError(match);
  onStatus?.(`检测到第${chapterNumber}章结尾与第${match.chapterNumber}章重复，正在定点修订...`);
  const prompt = `本章末尾复制了已经发表的章节。请只修订下方“待修订结尾”，输出替换它的正文。
保留本章已经成立的人物、事实、线索、视角、声线和因果，不新增无依据的事件或设定。
依据本章实际进展重新组织结尾，删除旧章的重演和总结套话；不能只替换人名、标点或同义词。
保留必要信息和自然衔接，篇幅约${tail.length}字，不输出标题、解释或前部正文。
【本章前部末段（固定正文，只供衔接，禁止输出）】
${prefix.slice(-1200) || '（无）'}
【待修订结尾】
${tail}
【检测到的旧章重复片段（禁止复用）】
${match.excerpt.slice(0, 1800)}`;
  let result;
  try {
    result = await generate(prompt, tail.length);
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    throw repetitionError(match, error);
  }
  const replacement = String(result?.content || '').trim();
  if (signal?.aborted) { const error = new Error('aborted'); error.name = 'AbortError'; throw error; }
  // A failed/truncated repair must not erase the ending or replace it with a summary.
  if (replacement.length < Math.max(60, tail.length * 0.55) || replacement.length > tail.length * 1.6 + 100
      || result?.finishReason === 'length') throw repetitionError(match);
  const revised = prefix + replacement;
  assertDistinctEnding(revised, chapters, chapterNumber, minRewriteStart);
  return { content: revised, report: { repaired: true, sourceChapter: match.chapterNumber, matchedChars: match.matchedChars } };
}

module.exports = { detectRepeatedEnding, assertDistinctEnding, repairRepeatedEnding, buildEndingHistory };
