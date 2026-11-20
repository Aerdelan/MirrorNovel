// All offsets are UTF-16 positions, matching String.length on the server.
export function createChapterStream() {
 const chapters = new Map()
 let activeChapter = 0

 function entry(number) {
  if (!chapters.has(number)) chapters.set(number, { text: '', committed: false })
  return chapters.get(number)
 }

 return {
  apply(event) {
   const number = Number.isSafeInteger(event.chapterNumber) && event.chapterNumber > 0
    ? event.chapterNumber : activeChapter

   if (event.type === 'chapter_start') {
    if (number >= activeChapter) {
     activeChapter = number
     entry(number)
    }
    return false
   }
   if (event.type === 'chapter_end') {
    if (!chapters.has(number) && typeof event.content !== 'string') return false
    const chapter = entry(number)
    if (typeof event.content === 'string') chapter.text = event.content
    chapter.committed = true
    return typeof event.content === 'string'
   }
   if (number !== activeChapter) return false
   if (!['content', 'draft_restored', 'expert_revision', 'humanized'].includes(event.type)) return false
   const chapter = entry(number)
   if (chapter.committed || typeof event.content !== 'string') return false
   if (event.type !== 'content') {
    chapter.text = event.content
    return true
   }

   const offset = event.offset ?? chapter.text.length
   if (!Number.isSafeInteger(offset) || offset < 0 || offset > chapter.text.length) return false
   const overlap = Math.min(chapter.text.length - offset, event.content.length)
   if (chapter.text.slice(offset, offset + overlap) !== event.content.slice(0, overlap)) return false
   if (overlap === event.content.length) return false
   chapter.text += event.content.slice(overlap)
   return true
  },
  get text() {
   return Array.from(chapters.values(), chapter => chapter.text).filter(Boolean).join('\n\n')
  },
 }
}
