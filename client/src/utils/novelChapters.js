function sameChapter(left, right) {
  if (String(left?._id || '') !== String(right?._id || '') || left?.content !== right?.content) return false
  const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
  return stable(left) === stable(right)
}

// Old servers may still return chapters appended twice after a failed save.
// Collapse exact copies only; different drafts or metadata remain available.
export function normalizeNovelChapters(novel) {
  if (!Array.isArray(novel?.chapters)) return novel
  const seen = new Map()
  const chapters = []
  for (const chapter of novel.chapters) {
    const number = Number(chapter?.chapterNumber)
    if (!Number.isSafeInteger(number) || number < 1) { chapters.push(chapter); continue }
    const versions = seen.get(number) || []
    if (versions.some(value => sameChapter(value, chapter))) continue
    versions.push(chapter)
    seen.set(number, versions)
    chapters.push(chapter)
  }
  if (chapters.length === novel.chapters.length) return novel
  return { ...novel, chapters,
    currentChapterIndex: chapters.reduce((highest, chapter) => Math.max(highest, Number(chapter.chapterNumber || 0)), 0),
    currentWordCount: chapters.reduce((sum, chapter) => sum + Number(chapter.wordCount || 0), 0),
  }
}
