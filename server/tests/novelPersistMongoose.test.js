const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Novel = require('../models/Novel');
const { saveNovelDoc } = require('../services/novelPersist');

const clone = value => JSON.parse(JSON.stringify(value));
function setPath(target, key, value) {
  const parts = key.split('.');
  const last = parts.pop();
  let node = target;
  for (const part of parts) node = node[part] ??= {};
  node[last] = clone(value);
}

test('real Mongoose VersionError fallback clears pending array pushes before the next save', async () => {
  const connection = mongoose.createConnection();
  const Model = connection.model('Novel', Novel.schema.clone());
  const chapter = number => ({ _id: new mongoose.Types.ObjectId(), chapterNumber: number, title: `第${number}章`, content: `正文${number}`, wordCount: 3 });
  let stored = clone({ _id: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(), novelTypeId: 'test', novelTypeName: '测试', chapters: [chapter(1), chapter(2)], __v: 0 });
  const doc = Model.hydrate(stored);
  const writes = [];
  Model.collection.updateOne = async (filter, update) => {
    writes.push(clone(update));
    if (filter.__v != null && filter.__v !== stored.__v) return { matchedCount: 0 };
    for (const [key, value] of Object.entries(update.$set || {})) setPath(stored, key, value);
    for (const [key, value] of Object.entries(update.$push || {})) stored[key] = [...(stored[key] || []), ...clone(value.$each || [value])];
    for (const [key, value] of Object.entries(update.$inc || {})) stored[key] = (stored[key] || 0) + value;
    return { matchedCount: 1, modifiedCount: 1 };
  };
  Model.collection.findOne = async () => clone(stored);
  try {
    doc.chapters.push(chapter(3), chapter(4));
    doc.increment();
    stored.__v = 1; // Another request saved the book after this worker loaded it.
    await saveNovelDoc(doc, { NovelModel: Model });
    assert.deepEqual(stored.chapters.map(row => row.chapterNumber), [1, 2, 3, 4]);
    const chaptersStillDirty = doc.isModified('chapters');
    doc.status = 'paused';
    await saveNovelDoc(doc, { NovelModel: Model });
    assert.deepEqual(stored.chapters.map(row => row.chapterNumber), [1, 2, 3, 4], 'saving status must not append old chapters again');
    assert.equal(chaptersStillDirty, false, 'fallback must acknowledge the successful chapter write');
    doc.chapters.push(chapter(5));
    await saveNovelDoc(doc, { NovelModel: Model });
    assert.deepEqual(stored.chapters.map(row => row.chapterNumber), [1, 2, 3, 4, 5]);
    assert.deepEqual(writes.at(-1).$push.chapters.$each.map(row => row.chapterNumber), [5], 'only the newly generated chapter may be appended');
  } finally { await connection.close(); }
});
