const { isDeepStrictEqual } = require('node:util');

function plainChapter(chapter) {
  // Normalize ObjectIds and dates from Mongoose and lean/plain responses.
  return JSON.parse(JSON.stringify(typeof chapter?.toObject === 'function' ? chapter.toObject() : chapter));
}

function distinctChapters(chapters) {
  const result = [];
  const seen = new Map();
  for (const chapter of Array.isArray(chapters) ? chapters : []) {
    const number = Number(chapter?.chapterNumber);
    // Invalid/unidentified rows must never disappear as a side effect of repair.
    if (!Number.isSafeInteger(number) || number < 1) { result.push(chapter); continue; }
    const versions = seen.get(number) || [];
    if (versions.some(value => String(value?._id || '') === String(chapter?._id || '')
      && value?.content === chapter?.content && isDeepStrictEqual(plainChapter(value), plainChapter(chapter)))) continue;
    versions.push(chapter);
    seen.set(number, versions);
    result.push(chapter);
  }
  return result;
}

function repairDuplicateChapters(novel) {
  if (!Array.isArray(novel?.chapters)) return false;
  const chapters = distinctChapters(novel.chapters);
  if (chapters.length === novel.chapters.length) return false;
  novel.chapters = chapters;
  novel.currentWordCount = chapters.reduce((sum, chapter) => sum + Number(chapter.wordCount || 0), 0);
  novel.currentChapterIndex = chapters.reduce((highest, chapter) => Math.max(highest, Number(chapter.chapterNumber || 0)), 0);
  novel.markModified?.('chapters');
  return true;
}

module.exports = { distinctChapters, repairDuplicateChapters };
