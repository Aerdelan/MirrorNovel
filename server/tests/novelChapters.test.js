const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { distinctChapters, repairDuplicateChapters } = require('../services/novelChapters');

test('repair removes only exact copies and recalculates chapter progress idempotently', () => {
  const chapter = n => ({ _id: `id-${n}`, chapterNumber: n, title: `第${n}章`, content: `正文${n}`, wordCount: 3 });
  const rows = [1, 2, 3, 4].map(chapter);
  const novel = { chapters: [...rows, { ...rows[2] }, { ...rows[3] }, chapter(5)], currentWordCount: 21, currentChapterIndex: 7 };
  assert.equal(repairDuplicateChapters(novel), true);
  assert.deepEqual(novel.chapters.map(row => row.chapterNumber), [1, 2, 3, 4, 5]);
  assert.equal(novel.currentWordCount, 15);
  assert.equal(novel.currentChapterIndex, 5);
  assert.equal(repairDuplicateChapters(novel), false);
});

test('chapter variants, different IDs and metadata remain untouched', () => {
  const chapter = { _id: 'id-1', chapterNumber: 3, content: '原文', wordCount: 2, qualityReport: { score: 80 } };
  const chapters = [chapter, { ...chapter, content: '修订后的内容' }, { ...chapter, _id: 'id-2' }, { ...chapter, qualityReport: { score: 95 } }, {}, {}];
  assert.deepEqual(distinctChapters(chapters), chapters);
});

test('Mongoose documents normalize ObjectIds and generatedAt without discarding metadata', () => {
  const schema = new mongoose.Schema({ chapters: [{ chapterNumber: Number, content: String, wordCount: Number, generatedAt: Date, qualityReport: mongoose.Schema.Types.Mixed }] });
  const Model = mongoose.model('DuplicateChapterRepairTest', schema);
  const chapter = { _id: new mongoose.Types.ObjectId(), chapterNumber: 3, content: '正文', wordCount: 2, generatedAt: new Date(), qualityReport: { tokens: { calls: 4 } } };
  const novel = Model.hydrate({ _id: new mongoose.Types.ObjectId(), chapters: [chapter, chapter] });
  assert.equal(repairDuplicateChapters(novel), true);
  assert.equal(novel.chapters.length, 1);
  assert.equal(novel.isModified('chapters'), true);
  assert.equal(novel.chapters[0].qualityReport.tokens.calls, 4);
});
