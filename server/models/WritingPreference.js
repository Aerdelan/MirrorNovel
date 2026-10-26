const mongoose = require('mongoose')

/**
 * 写作偏好（Writing Preference）——规划书 A3。
 * 经作者确认的长期写作规则。只有 status='active' 的偏好会在作品采用风格版本时
 * 冻结进 novel.styleRevisionSnapshot，从而进入生成上下文；candidate/paused 永不生效。
 *
 * 适用范围：novelId=null 表示账号所有作品；带 novelId 只影响该书，
 * 绝不泄漏到其他书。模型提炼只产出 candidate，确认必须由作者显式操作；
 * 提炼结果永远不能直接更新全局写作人格。
 */
const evidenceSchema = new mongoose.Schema({
  feedbackId: { type: mongoose.Schema.Types.ObjectId, ref: 'WritingFeedback', default: null },
  excerpt: { type: String, default: '', maxlength: 400 },
  chapterNumber: { type: Number, default: 0 },
}, { _id: false })

const writingPreferenceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  novelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', default: null },
  novelTitle: { type: String, default: '' },

  // 规则正文：可执行、可迁移的表达倾向，不照搬修改稿原文。
  statement: { type: String, required: true, trim: true, maxlength: 300 },
  rationale: { type: String, default: '', trim: true, maxlength: 300 },
  reason: { type: String, enum: ['repetition', 'character_voice', 'perspective', 'pacing', 'emotion', 'density', 'correction_only', 'one_off', 'manual'], default: 'manual' },

  status: { type: String, enum: ['candidate', 'active', 'paused'], default: 'candidate' },
  source: { type: String, enum: ['manual', 'distilled'], default: 'manual' },
  evidence: { type: [evidenceSchema], default: [] },
  distilledFromFeedback: { type: mongoose.Schema.Types.ObjectId, ref: 'WritingFeedback', default: null },
}, { timestamps: true })

writingPreferenceSchema.index({ userId: 1, status: 1, updatedAt: -1 })

module.exports = mongoose.model('WritingPreference', writingPreferenceSchema)
