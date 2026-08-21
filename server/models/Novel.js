const mongoose = require('mongoose');

const chapterSchema = new mongoose.Schema({
  chapterNumber: { type: Number, required: true },
  title: { type: String, default: '' },
  content: { type: String, default: '' },
  wordCount: { type: Number, default: 0 },
  qualityReport: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
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
  // 可选的专家团模式：写作后增加推理审稿和必要的润色修订。
  expertMode: {
    type: Boolean,
    default: false,
  },
  // 锁定生成时的人格，避免用户后来编辑模板导致旧作品文风漂移。
  writingPersonaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WritingPersona',
    default: null,
  },
  writingPersonaSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
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
  // 章节计划的可机读版本；chapterPlan 仍保留原始文本，保证旧客户端和旧数据兼容。
  chapterPlanData: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({ version: 1, chapters: [] }),
  },
  // ====== 持久化的章节上下文文档（替代 on-the-fly 压缩） ======
  // 伏笔追踪文档：记录每个伏笔的设章、状态、回收章
  foreshadowingDoc: {
    type: String,
    default: '',
  },
  // 章节浓缩文档：每章生成后浓缩成一段文字，追加存储
  chapterSummaryDoc: {
    type: String,
    default: '',
  },
  // 分阶段压缩后的故事记忆索引；正文和旧摘要仍是事实来源。
  contextMemory: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({ version: 1, checkpointChapter: 0, checkpointSummary: '', facts: [], openLoops: [] }),
  },
  // 结构化创作状态。旧作品没有这些字段时，生成服务会从已有章节和文本文档渐进补全。
  storyBible: {
    theme: { type: String, default: '' },
    narrativeView: { type: String, default: '' },
    tone: { type: String, default: '' },
    taboos: { type: [String], default: [] },
    worldRules: { type: [String], default: [] },
  },
  // 可滚动细化的故事蓝图。outline 是用户确认的故事骨架；蓝图承载
  // 后续章节可执行的阶段、支线和节奏安排，不能被 AI 静默改写。
  storyBlueprint: {
    version: { type: Number, default: 1 },
    mainArc: { type: String, default: '' },
    lockedFacts: { type: [String], default: [] },
    phases: [{
      title: { type: String, default: '' },
      startChapter: { type: Number, default: 1 },
      endChapter: { type: Number, default: 0 },
      goal: { type: String, default: '' },
      obstacle: { type: String, default: '' },
      reversal: { type: String, default: '' },
      threads: { type: [String], default: [] },
    }],
    autoReviewEnabled: { type: Boolean, default: false },
    emailReminderEnabled: { type: Boolean, default: true },
    lastReviewedChapter: { type: Number, default: 0 },
    lastAppliedAt: { type: Date },
  },
  // AI 只能创建提案；用户应用后才会影响后续章节。
  storyBlueprintProposals: [{
    id: { type: String, required: true },
    status: { type: String, enum: ['pending', 'applied', 'rejected'], default: 'pending' },
    significance: { type: String, enum: ['minor', 'major'], default: 'minor' },
    title: { type: String, default: '' },
    summary: { type: String, default: '' },
    rationale: { type: String, default: '' },
    reviewChapter: { type: Number, default: 0 },
    affectedChapters: { type: [Number], default: [] },
    changes: [{
      field: { type: String, default: '' },
      before: { type: String, default: '' },
      after: { type: String, default: '' },
      impact: { type: String, default: '' },
    }],
    proposedBlueprint: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    createdAt: { type: Date, default: Date.now },
    decidedAt: { type: Date },
  }],
  characterStates: [{
    name: { type: String, default: '' },
    goal: { type: String, default: '' },
    relationships: { type: [String], default: [] },
    knownFacts: { type: [String], default: [] },
    location: { type: String, default: '' },
    emotionalState: { type: String, default: '' },
    lastChapter: { type: Number, default: 0 },
  }],
  plotThreads: [{
    id: { type: String, default: '' },
    title: { type: String, default: '' },
    type: { type: String, enum: ['main', 'subplot', 'relationship', 'mystery'], default: 'main' },
    status: { type: String, enum: ['planned', 'active', 'paused', 'resolved'], default: 'planned' },
    nextMilestone: { type: String, default: '' },
    lastChapter: { type: Number, default: 0 },
  }],
  foreshadowingLedger: [{
    id: { type: String, default: '' },
    content: { type: String, default: '' },
    setChapter: { type: Number, default: 0 },
    targetChapter: { type: Number, default: 0 },
    status: { type: String, enum: ['planned', 'pending', 'resolved', 'abandoned'], default: 'pending' },
    resolvedChapter: { type: Number, default: 0 },
    resolution: { type: String, default: '' },
  }],
  emotionCurve: [{
    chapterNumber: { type: Number, required: true },
    tension: { type: Number, min: 1, max: 10, default: 5 },
    tone: { type: String, default: 'neutral' },
    chapterRole: { type: String, default: '推进' },
  }],
  recentEventSignatures: { type: [String], default: [] },
  chapters: [chapterSchema],
  currentChapterIndex: {
    type: Number,
    default: 0,
  },
  // 后台编辑引擎任务状态（七阶段编辑）
  editorialTask: {
    status: { type: String, enum: ['idle', 'running', 'completed', 'error'], default: 'idle' },
    progress: { type: String, default: '' },
    currentChapter: { type: Number, default: 0 },
    totalChapters: { type: Number, default: 0 },
    currentStage: { type: String, default: '' },
    stageName: { type: String, default: '' },
    processedCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    partial: { type: Boolean, default: false },
    error: { type: String, default: '' },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  // 后台调优任务状态
  optimizeTask: {
    status: { type: String, enum: ['idle', 'analyzing', 'optimizing', 'completed', 'error'], default: 'idle' },
    progress: { type: String, default: '' },
    currentChapter: { type: Number, default: 0 },
    totalChapters: { type: Number, default: 0 },
    optimizedCount: { type: Number, default: 0 },
    polishedCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    partial: { type: Boolean, default: false },
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
