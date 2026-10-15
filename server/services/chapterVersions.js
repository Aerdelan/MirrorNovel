const mongoose = require('mongoose');
const ChapterVersion = require('../models/ChapterVersion');
const pending = Symbol('chapterVersions');

function queueChapterVersion(novel, chapter, source = 'manual') {
  if (!chapter?.content) return;
  if (!novel[pending]) novel[pending] = [];
  novel[pending].push({ userId: novel.userId, novelId: novel._id, chapterNumber: chapter.chapterNumber, title: chapter.title || '', content: chapter.content, source: String(source).slice(0, 40) });
}
async function archiveChapterVersion(novel, chapter, source = 'manual') {
  if (!mongoose.isValidObjectId(novel?._id) || ChapterVersion.db.readyState !== 1 || !chapter?.content) return;
  const filter = { userId: novel.userId, novelId: novel._id, chapterNumber: chapter.chapterNumber };
  const latest = await ChapterVersion.findOne(filter).sort({ createdAt: -1 });
  if (latest?.content === chapter.content && latest?.title === chapter.title) return;
  await ChapterVersion.create({ ...filter, title: chapter.title || '', content: chapter.content, source: String(source).slice(0, 40) });
  const old = await ChapterVersion.find(filter).sort({ createdAt: -1 }).skip(8).select('_id');
  if (old.length) await ChapterVersion.deleteMany({ ...filter, _id: { $in: old.map(value => value._id) } });
}
async function persistPendingVersions(novel) {
  const queued = novel[pending] || [];
  for (const item of queued) await archiveChapterVersion(novel, item, item.source);
  delete novel[pending];
}
module.exports = { queueChapterVersion, archiveChapterVersion, persistPendingVersions };
