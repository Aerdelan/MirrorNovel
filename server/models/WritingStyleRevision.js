const mongoose = require('mongoose')

/**
 * 写作风格版本（Writing Style Revision）——规划书 A2。
 *
 * 不可变文档：创建后任何字段都不再修改（没有更新路由，服务层也不提供更新函数）。
 * 版本固化三样东西：
 *   1. personaSnapshot —— 创建时的人格快照，之后编辑人格模板不影响已创建版本；
 *   2. samples —— 从"已认可且允许作为模型输入"的样稿池固定下来的候选样稿
 *      （每段正文已裁剪到提示词预算 240 字）；
 *   3. sampleBudget —— 输入预算（最多 3 段 × 240 字），显式固化，防止后续静默膨胀。
 *
 * 作品（Novel）采用某版本时会把本文档内容复制进 novel.styleRevisionSnapshot；
 * 生成链路只读作品上的快照，不回查本集合——因此版本固定、任务期间不受
 * 任何后续操作影响。回退 = 作品改用旧版本，从不改写历史版本。
 */
const pinnedSampleSchema = new mongoose.Schema({
  sampleId: { type: mongoose.Schema.Types.ObjectId, ref: 'WritingSample', required: true },
  title: { type: String, default: '' },
  sceneType: { type: String, default: 'other' },
  notes: { type: String, default: '' },
  // 已按 240 字预算裁剪的正文；提示词只使用这里的固定内容。
  content: { type: String, required: true },
  sourceKind: { type: String, default: 'own_text' },
}, { _id: false })

const writingStyleRevisionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  name: { type: String, default: '', trim: true, maxlength: 80 },
  // 同一用户内递增的版本号（1, 2, 3…），创建时由服务层分配。
  version: { type: Number, required: true, min: 1 },
  parentRevisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WritingStyleRevision', default: null },

  scope: { type: String, enum: ['novel', 'screenplay'], default: 'novel' },

  personaId: { type: mongoose.Schema.Types.ObjectId, ref: 'WritingPersona', default: null },
  // 创建时冻结的人格快照（lean 对象原样复制）；人格后续编辑不会同步进来。
  personaSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },

  samples: { type: [pinnedSampleSchema], default: [] },

  sampleBudget: {
    maxCount: { type: Number, default: 3 },
    maxCharsPerSample: { type: Number, default: 240 },
  },

  // 谁创建的、何时创建；仅用于展示与审计，不含任何密钥。
  note: { type: String, default: '', trim: true, maxlength: 200 },
}, { timestamps: true })

writingStyleRevisionSchema.index({ userId: 1, version: -1 })

module.exports = mongoose.model('WritingStyleRevision', writingStyleRevisionSchema)
