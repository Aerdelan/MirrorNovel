// Local, model-independent check. Compare endings separately: a copied 200-character
// ending in a 5,000-character chapter is almost invisible to whole-chapter scores.
const ENDING_CHARS = 1800;
const MIN_MATCH = 55;
const ANCHOR = 24;

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

function edgeSentences(text, opening) {
  const sentences = Array.from(text.matchAll(/[^。！？!?\r\n]+[。！？!?]?/g));
  return (opening ? sentences.slice(0, 4) : sentences.slice(-5))
    .map(match => ({ start: match.index, raw: match[0], normalized: normalizeWithOffsets(match[0]).text }))
    .filter(sentence => sentence.normalized.length >= 64);
}

function trigrams(text) {
  return new Set(Array.from({ length: text.length - 2 }, (_, index) => text.slice(index, index + 3)));
}

function detectNearRepeatedEdge(source, chapters, chapterNumber, minStart, opening) {
  const offset = opening ? 0 : Math.max(minStart, source.length - 650);
  const candidates = edgeSentences(opening ? source.slice(0, 650) : source.slice(offset), opening);
  if (!candidates.length) return null;
  const recent = chapters.filter(chapter => Number(chapter.chapterNumber) < chapterNumber).slice(-5);
  for (const candidate of candidates) {
    const grams = trigrams(candidate.normalized);
    if (grams.size < 42) continue;
    for (const chapter of recent) {
      const old = String(chapter.content || '');
      const samples = edgeSentences(old.slice(-650), false);
      if (opening) samples.push(...edgeSentences(old.slice(0, 650), true));
      for (const sample of samples) {
        if (Math.abs(candidate.normalized.length - sample.normalized.length) > candidate.normalized.length * 0.2) continue;
        const other = trigrams(sample.normalized);
        const shared = Array.from(grams).filter(gram => other.has(gram)).length;
        if (2 * shared / (grams.size + other.size) < 0.75) continue;
        const start = offset + candidate.start;
        return { chapterNumber: Number(chapter.chapterNumber), matchedChars: candidate.normalized.length,
          start, end: start + candidate.raw.length, excerpt: sample.raw, approximate: true };
      }
    }
  }
  return null;
}

function detectRepeatedEdge(content, chapters, chapterNumber, minStart, opening) {
  const source = String(content || '');
  const offset = opening ? 0 : Math.max(0, source.length - ENDING_CHARS, minStart);
  const current = normalizeWithOffsets(opening ? source.slice(0, 650) : source.slice(offset));
  const minimum = MIN_MATCH;
  if (current.text.length < minimum) return null;
  let best = null;
  for (const chapter of chapters) {
    // Never compare a revision with itself or with chapters that follow it.
    if (Number(chapter.chapterNumber) >= chapterNumber) continue;
    const oldText = String(chapter.content || '');
    const samples = opening ? [oldText.slice(0, 650), oldText.slice(-ENDING_CHARS)] : [oldText.slice(-ENDING_CHARS)];
    for (const sample of samples) {
      const previous = normalizeWithOffsets(sample).text;
      if (previous.length < minimum) continue;
      const anchors = new Map();
      const coveredUntil = new Map();
      for (let i = 0; i <= previous.length - ANCHOR; i++) {
        const key = previous.slice(i, i + ANCHOR);
        if (!anchors.has(key)) anchors.set(key, []);
        anchors.get(key).push(i);
      }
      // Sampling every 24 characters still leaves an anchor within a match.
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
          if (matchedChars < minimum || (best && best.matchedChars >= matchedChars)) continue;
          const start = offset + current.offsets[i - left];
          const end = offset + current.offsets[i + right - 1] + 1;
          best = { chapterNumber: Number(chapter.chapterNumber), matchedChars, start, end, excerpt: source.slice(start, end) };
          if (matchedChars === current.text.length) return best;
        }
      }
    }
  }
  return best || detectNearRepeatedEdge(source, chapters, chapterNumber, minStart, opening);
}

function detectRepeatedEnding(content, chapters = [], chapterNumber = Infinity, minStart = 0) {
  return detectRepeatedEdge(content, chapters, chapterNumber, minStart, false);
}

function detectRepeatedOpening(content, chapters = [], chapterNumber = Infinity) {
  return detectRepeatedEdge(content, chapters.filter(chapter => Number(chapter.chapterNumber) < chapterNumber).slice(-5), chapterNumber, 0, true);
}

function repetitionError(match, cause, opening = false) {
  const error = new Error(`${opening ? '开头' : '章末'}与第${match.chapterNumber}章重复${match.matchedChars}字，已阻止写入正式章节`);
  error.code = opening ? 'CHAPTER_OPENING_REPEATED' : 'CHAPTER_ENDING_REPEATED';
  error.repetition = match;
  if (cause) error.cause = cause;
  return error;
}

function assertDistinctOpening(content, chapters, chapterNumber) {
  const match = detectRepeatedOpening(content, chapters, chapterNumber);
  if (match) throw repetitionError(match, null, true);
}

async function repairRepeatedOpening({ content, chapters, chapterNumber, generate, onStatus, signal }) {
  const match = detectRepeatedOpening(content, chapters, chapterNumber);
  if (!match) return { content, report: null };
  const boundary = content.slice(match.end).search(/[。！？\n]/);
  const end = /[。！？!?\n]/.test(content[match.end - 1]) ? match.end
    : boundary < 0 ? content.length : match.end + boundary + 1;
  if (end > 1500) throw repetitionError(match, null, true);
  onStatus?.(`检测到第${chapterNumber}章开头与第${match.chapterNumber}章重复，正在修订衔接...`);
  const prompt = `只替换本章开头，从前一章结尾发生后的第一个新动作写起。保留本章已经出现的事实和因果，不复演上一章，不输出标题。
【待替换开头】
${content.slice(0, end)}
【本章后文，仅供衔接】
${content.slice(end, end + 900)}
【旧章重复片段，禁止复用】
${match.excerpt}`;
  let result;
  try {
    result = await generate(prompt, end);
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    throw repetitionError(match, error, true);
  }
  signal?.throwIfAborted();
  const replacement = String(result?.content || '').trim();
  if (result?.finishReason === 'length' || replacement.length < 30 || replacement.length > end * 2 + 100) {
    throw repetitionError(match, null, true);
  }
  const suffix = content.slice(end);
  const revised = replacement + (suffix && !/^\s/.test(suffix) ? '\n\n' : '') + suffix;
  assertDistinctOpening(revised, chapters, chapterNumber);
  return { content: revised, report: { repaired: true, sourceChapter: match.chapterNumber, matchedChars: match.matchedChars } };
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
    + history.map(chapter => `第${chapter.chapterNumber}章已用收尾：\n${String(chapter.content || '').slice(-160)}`).join('\n');
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

module.exports = { detectRepeatedOpening, assertDistinctOpening, repairRepeatedOpening,
  detectRepeatedEnding, assertDistinctEnding, repairRepeatedEnding, buildEndingHistory };
