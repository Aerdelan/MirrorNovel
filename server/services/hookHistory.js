const PASSAGE_STEP = 160;
const PASSAGE_LENGTH = 240;
const MAX_EXCERPT_LENGTH = 500;
const MAX_EXCERPTS = 4;
const RECENT_CHAPTER_COUNT = 12;
const MAX_EVIDENCE_LENGTH = 300;
const MAX_EVIDENCE_SENTENCES = 5;

function searchTerms(text) {
  const terms = new Set();
  for (const part of text.toLowerCase().match(/[\p{Script=Han}]+|[a-z][a-z0-9_-]{2,}|\d{2,}/gu) || []) {
    if (!/^\p{Script=Han}/u.test(part)) {
      terms.add(part);
      continue;
    }
    const characters = [...part];
    for (let i = 0; i < characters.length - 1; i++) {
      terms.add(characters.slice(i, i + 2).join(''));
      if (i + 2 < characters.length) terms.add(characters.slice(i, i + 3).join(''));
    }
  }
  return terms;
}

function characterBoundary(text, offset) {
  const code = text.charCodeAt(offset);
  return code >= 0xDC00 && code <= 0xDFFF ? offset - 1 : offset;
}

function excerptForPassage({ chapter, offset }) {
  const { text } = chapter;
  // Keep adjacent dialogue and narration around the search match. Clip only
  // at distant edges, keeping the selected interval verbatim.
  const left = Math.max(0, offset - 130);
  const right = Math.min(text.length, left + MAX_EXCERPT_LENGTH);
  const leftBoundary = left > 0 ? /[。！？!?\n]/u.exec(text.slice(left, left + 45)) : null;
  const rightBoundary = right < text.length ? /[。！？!?\n][^。！？!?\n]*$/u.exec(text.slice(right - 45, right)) : null;
  const start = characterBoundary(text, leftBoundary ? left + leftBoundary.index + 1 : left);
  const end = characterBoundary(text, rightBoundary ? right - 45 + rightBoundary.index + 1 : right);
  return { chapterNumber: chapter.chapterNumber, text: text.slice(start, end).trim() };
}

function packEvidenceWindows(text, queryTerms) {
  const sentences = [];
  for (const match of text.matchAll(/[^\r\n。！？!?]+[。！？!?]*|[。！？!?]+/gu)) {
    let start = match.index;
    for (const part of match[0].match(/[\s\S]{1,180}/gu) || []) {
      const end = start + part.length;
      if (part.trim()) sentences.push({ start, end, text: part.trim() });
      start = end;
    }
  }
  if (!sentences.length) return [];

  let anchor = 0;
  let highestScore = -1;
  for (const [index, sentence] of sentences.entries()) {
    let score = 0;
    for (const term of searchTerms(sentence.text)) {
      if (queryTerms.has(term)) score += [...term].length >= 3 ? 3 : 1;
    }
    if (score > highestScore) {
      anchor = index;
      highestScore = score;
    }
  }

  const range = (first, last) => text.slice(sentences[first].start, sentences[last].end).trim();
  // Answers can follow a short referent or span several adjacent sentences.
  // Keep the surrounding original text together as a selectable proof.
  let first = anchor;
  let last = anchor;
  while (last + 1 < sentences.length && last - first + 1 < MAX_EVIDENCE_SENTENCES
    && range(first, last + 1).length <= MAX_EVIDENCE_LENGTH) last++;
  while (first > 0 && last - first + 1 < MAX_EVIDENCE_SENTENCES
    && range(first - 1, last).length <= MAX_EVIDENCE_LENGTH) first--;

  return [...new Set([sentences[anchor].text, range(first, last)])].filter(evidence =>
    evidence.replace(/[\s。！？!?]/g, '').length >= 10);
}

// Build a local index once per review. A selected passage is a candidate for
// semantic and exact-source verification against its saved chapter.
function createHookHistorySearch(chapters, beforeChapter, { evidenceWindows = false } = {}) {
  const indexedChapters = new Set();
  const passages = [];
  const index = new Map();
  for (const saved of Array.isArray(chapters) ? chapters : []) {
    const chapterNumber = Number(saved?.chapterNumber);
    const text = String(saved?.content || '');
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1 || !(chapterNumber < beforeChapter)
      || !text.trim() || indexedChapters.has(chapterNumber)) continue;
    indexedChapters.add(chapterNumber);
    const chapter = { chapterNumber, text };
    for (let start = 0; start < text.length; start += PASSAGE_STEP) {
      const offset = characterBoundary(text, start);
      const end = characterBoundary(text, offset + PASSAGE_LENGTH);
      const passageNumber = passages.push({ chapter, offset }) - 1;
      for (const term of searchTerms(text.slice(offset, end))) {
        const posting = index.get(term);
        // Store singleton terms directly. Long manuscripts have many phrases
        // that appear in only one indexed passage.
        if (posting === undefined) index.set(term, passageNumber);
        else if (typeof posting === 'number') index.set(term, [posting, passageNumber]);
        else posting.push(passageNumber);
      }
      if (end >= text.length) break;
    }
  }

  const recentChapters = new Set([...indexedChapters].sort((a, b) => b - a).slice(0, RECENT_CHAPTER_COUNT));
  return hook => {
    const afterChapter = Number(hook?.setChapter);
    if (!Number.isSafeInteger(afterChapter) || afterChapter < 1 || afterChapter >= beforeChapter) return [];

    const candidates = new Map();
    const chapterCount = [...indexedChapters].filter(number => number > afterChapter).length;
    const terms = searchTerms(String(hook?.content || '').slice(0, 500));
    for (const term of terms) {
      const posting = index.get(term);
      if (posting === undefined) continue;
      const occurrences = typeof posting === 'number' ? [posting] : posting;
      let matchingChapters = 0;
      let lastChapter = 0;
      for (const passageNumber of occurrences) {
        const number = passages[passageNumber].chapter.chapterNumber;
        if (number > afterChapter && number !== lastChapter) {
          matchingChapters++;
          lastChapter = number;
        }
      }
      if (!matchingChapters) continue;
      const phrase = [...term].length >= 3;
      const distinctive = matchingChapters <= Math.max(1, Math.ceil(chapterCount * (phrase ? 0.4 : 0.25)));
      const weight = (phrase ? 2 : 1) * Math.log1p(chapterCount / matchingChapters);
      for (const passageNumber of occurrences) {
        if (passages[passageNumber].chapter.chapterNumber <= afterChapter) continue;
        let candidate = candidates.get(passageNumber);
        if (!candidate) {
          candidate = { ...passages[passageNumber], score: 0, distinctivePhrases: 0, distinctivePairs: 0 };
          candidates.set(passageNumber, candidate);
        }
        candidate.score += weight;
        if (distinctive && phrase) candidate.distinctivePhrases++;
        if (distinctive && !phrase) candidate.distinctivePairs++;
      }
    }

    const bestPerChapter = new Map();
    for (const candidate of candidates.values()) {
      if (!candidate.distinctivePhrases && candidate.distinctivePairs < 2) continue;
      const chapterNumber = candidate.chapter.chapterNumber;
      const best = bestPerChapter.get(chapterNumber);
      if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.offset < best.offset)) {
        bestPerChapter.set(chapterNumber, candidate);
      }
    }
    const ranked = [...bestPerChapter.values()]
      .sort((a, b) => b.score - a.score || b.chapter.chapterNumber - a.chapter.chapterNumber);
    const selected = new Set(ranked.slice(0, 2));
    // Strong old matches can be repeated setups. Leave two places for recent
    // matches that may contain answers in a shorter or differently worded scene.
    const recent = ranked.filter(candidate => !selected.has(candidate) && recentChapters.has(candidate.chapter.chapterNumber));
    for (const candidate of recent.slice(0, 2)) selected.add(candidate);
    for (const candidate of ranked) {
      if (selected.size >= MAX_EXCERPTS) break;
      selected.add(candidate);
    }
    const sources = ranked.filter(candidate => selected.has(candidate)).map(excerptForPassage);
    if (!evidenceWindows) return sources;
    return sources.map(({ chapterNumber, text }) => ({ chapterNumber, excerpts: packEvidenceWindows(text, terms) }))
      .filter(source => source.excerpts.length > 0);
  };
}

module.exports = { createHookHistorySearch };
