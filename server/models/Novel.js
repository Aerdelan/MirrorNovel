const mongoose = require('mongoose');

const chapterSchema = new mongoose.Schema({
  chapterNumber: { type: Number, required: true },
  title: { type: String, default: '' },
  content: { type: String, default: '' },
  wordCount: { type: Number, default: 0 },
  generatedAt: { type: Date, default: Date.now },
});

const novelSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  title: {
    type: String,
    default: '未命名小说',
  },
  novelTypeId: {
    type: String,
    required: true,
  },
  novelTypeName: {
    type: String,
    required: true,
  },
  protagonistName: {
    type: String,
    default: '',
  },
  worldSetting: {
    type: String,
    default: '',
  },
  outline: {
    type: String,
    default: '',
  },
  targetWordCount: {
    type: Number,
    default: 50000,
  },
  currentWordCount: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['generating', 'paused', 'completed', 'error'],
    default: 'generating',
  },
  // 用于继续生成的上下文
  generationContext: {
    type: String,
    default: '',
  },
  lastPrompt: {
    type: String,
    default: '',
  },
  // 当前的批次序号（用于标记生成了多少轮）
  batchIndex: {
    type: Number,
    default: 0,
  },
  // 章节计划表（AI生成，每章事件/伏笔/字数分配）
  chapterPlan: {
    type: String,
    default: '',
  },
  chapters: [chapterSchema],
  currentChapterIndex: {
    type: Number,
    default: 0,
  },
  // 后台调优任务状态
  optimizeTask: {
    status: { type: String, enum: ['idle', 'analyzing', 'optimizing', 'completed', 'error'], default: 'idle' },
    progress: { type: String, default: '' },
    currentChapter: { type: Number, default: 0 },
    totalChapters: { type: Number, default: 0 },
    optimizedCount: { type: Number, default: 0 },
    polishedCount: { type: Number, default: 0 },
    error: { type: String, default: '' },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// 更新时自动修改 updatedAt
novelSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Novel', novelSchema);
