const mongoose = require('mongoose')

/**
 * 写作反馈（Writing Feedback）——规划书 A3。
 * 记录一次人工修改及其用途（原文、修改稿、场景类型、理由），是候选偏好的证据来源。
 * 只在作者显式点击"记为写作偏好"时创建；正文保存与历史版本完全不依赖本集合。
 *
 * 幂等：同账号 + 同章节 + 同原文/修改稿哈希视为重复提交，返回已有记录。
 * 新鲜度：distilledPreferenceId 记录提炼去向；提炼候选偏好时校验修改稿仍是
 * 章节当前内容的一部分，已过期（被再次编辑/回退）的改动不得作为最新偏好。
 */
const writingFeedbackSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  novelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', required: true, index: true },
  novelTitle: { type: String, default: '' },
  sourceChapterNumber: { type: Number, required: true, min: 1 },

  // 修改前 / 修改后的文本（各最多保留改动附近 4000 字；哈希按完整文本计算）。
  originalText: { type: String, required: true },
  revisedText: { type: String, required: true },
  originalHash: { type: String, required: true },
  revisedHash: { type: String, required: true },
  originalLength: { type: Number, default: 0 },
  revisedLength: { type: Number, default: 0 },
  originalExcerptStart: { type: Number, default: 0, min: 0 },
  revisedExcerptStart: { type: Number, default: 0, min: 0 },

  sceneType: { type: String, enum: ['dialogue', 'action', 'observation', 'emotion', 'transition', 'other'], default: 'other' },
  // 重复信息 / 人物声音 / 视角 / 节奏 / 情绪表达 / 语言密度 / 仅纠错 / 仅本次修改。
  // "仅纠错"与"仅本次"不产生长期偏好（服务层拒绝提炼）。
  reason: { type: String, enum: ['repetition', 'character_voice', 'perspective', 'pacing', 'emotion', 'density', 'correction_only', 'one_off'], required: true },
  note: { type: String, default: '', trim: true, maxlength: 200 },

  distilledPreferenceId: { type: mongoose.Schema.Types.ObjectId, ref: 'WritingPreference', default: null },
}, { timestamps: true })

writingFeedbackSchema.index({ userId: 1, novelId: 1, sourceChapterNumber: 1, originalHash: 1, revisedHash: 1 })
writingFeedbackSchema.index({ userId: 1, updatedAt: -1 })

module.exports = mongoose.model('WritingFeedback', writingFeedbackSchema)
