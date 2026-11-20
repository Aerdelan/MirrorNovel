import test from 'node:test'
import assert from 'node:assert/strict'
import { createChapterStream } from '../src/utils/chapterStream.js'
import { createSSEParser } from '../src/utils/sseParser.js'

test('a multi-chapter stream applies revisions, repeated chunks and committed snapshots to the addressed chapter', () => {
 const stream = createChapterStream()
 const parser = createSSEParser({ onEvent: event => stream.apply(event) })
 const events = [
  { type: 'chapter_start', chapterNumber: 1 },
  { type: 'content', chapterNumber: 1, offset: 0, content: '第一章草稿。' },
  { type: 'expert_revision', chapterNumber: 1, content: '第一章修订。' },
  { type: 'chapter_end', chapterNumber: 1, content: '第一章正文。' },
  { type: 'chapter_start', chapterNumber: 2 },
  { type: 'draft_restored', chapterNumber: 2, content: '第二章。' },
  { type: 'content', chapterNumber: 2, offset: 0, content: '第二章。' },
  { type: 'content', chapterNumber: 2, offset: 4, content: '新事件。' },
  { type: 'content', chapterNumber: 2, offset: 4, content: '新事件。' },
  { type: 'chapter_start', chapterNumber: 2 },
  { type: 'content', chapterNumber: 1, offset: 6, content: '旧文本迟到。' },
 ]
 const wire = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
 for (let i = 0; i < wire.length; i += 7) parser.push(wire.slice(i, i + 7))
 assert.equal(stream.text, '第一章正文。\n\n第二章。新事件。')
 stream.apply({ type: 'chapter_end', chapterNumber: 2, content: '第二章正式正文。' })
 assert.equal(stream.text, '第一章正文。\n\n第二章正式正文。')
})

test('chapter end reconciles a missing fragment without moving later text into its place', () => {
 const stream = createChapterStream()
 stream.apply({ type: 'chapter_start', chapterNumber: 3 })
 assert.equal(stream.apply({ type: 'content', chapterNumber: 3, offset: 8, content: '末段' }), false)
 stream.apply({ type: 'chapter_end', chapterNumber: 3, content: '正文已保存。' })
 assert.equal(stream.text, '正文已保存。')
})
