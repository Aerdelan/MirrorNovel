import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeNovelChapters } from '../src/utils/novelChapters.js'

test('exact repeated chapter records are collapsed without modifying the original response', () => {
  const chapter = n => ({ _id: `id-${n}`, chapterNumber: n, content: `正文${n}`, wordCount: 3, qualityReport: { tokens: { calls: 1 } } })
  const rows = [1, 2, 3, 4].map(chapter)
  const novel = { chapters: [...rows, structuredClone(rows[2]), structuredClone(rows[3]), chapter(5)], currentChapterIndex: 5, currentWordCount: 21 }
  const normalized = normalizeNovelChapters(novel)
  assert.deepEqual(normalized.chapters.map(row => row.chapterNumber), [1, 2, 3, 4, 5])
  assert.equal(normalized.currentWordCount, 15)
  assert.equal(normalized.currentChapterIndex, 5)
  assert.equal(novel.chapters.length, 7)
  assert.equal(normalizeNovelChapters(normalized), normalized)
})

test('different text, record IDs or metadata at the same chapter number must be preserved', () => {
  const chapter = { _id: 'id-1', chapterNumber: 3, content: '原文', wordCount: 2, qualityReport: { score: 80 } }
  const novel = { chapters: [chapter, { ...chapter, content: '新版正文' }, { ...chapter, _id: 'id-2' }, { ...chapter, qualityReport: { score: 95 } }, {}, {}] }
  assert.equal(normalizeNovelChapters(novel), novel)
  assert.equal(novel.chapters.length, 6)
})

test('missing chapter arrays and equivalent metadata key orders are supported', () => {
  assert.equal(normalizeNovelChapters(null), null)
  assert.deepEqual(normalizeNovelChapters({ title: '旧作品' }), { title: '旧作品' })
  const first = { chapterNumber: 1, content: '正文', wordCount: 2, qualityReport: { score: 80, issues: [] } }
  const second = { qualityReport: { issues: [], score: 80 }, wordCount: 2, content: '正文', chapterNumber: 1 }
  assert.equal(normalizeNovelChapters({ chapters: [first, second] }).chapters.length, 1)
})
