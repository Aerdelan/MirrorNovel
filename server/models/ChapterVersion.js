const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  novelId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  chapterNumber: { type: Number, required: true },
  title: { type: String, default: '' },
  content: { type: String, required: true },
  source: { type: String, default: 'manual' },
}, { timestamps: true });
schema.index({ novelId: 1, chapterNumber: 1, createdAt: -1 });
module.exports = mongoose.model('ChapterVersion', schema);
