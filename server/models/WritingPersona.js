const mongoose = require('mongoose')

/**
 * 写作人格（Writing Persona）
 * 用于把原本硬编码在 buildSystemPrompt 里的"作者声线"提取出来，
 * 让用户在前端选择/管理/AI生成/从参考小说提取，实现风格多样化。
 */
const writingPersonaSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  name: { type: String, required: true, trim: true, maxlength: 40 },
  description: { type: String, default: '', maxlength: 200 },

  // 作者声线：叙述者声线、视角、叙事距离、人称、时态
  voice: { type: String, default: '', maxlength: 800 },

  // 语气与节奏：用词密度、句法节奏、轻重平衡、段落习惯
  tone: { type: String, default: '', maxlength: 800 },

  // 题材约束/人物声音/段落节奏规则
  rules: { type: String, default: '', maxlength: 1200 },

  // 推荐/禁用词表（自由文本，由用户或 AI 维护）
  vocab: { type: String, default: '', maxlength: 800 },

  // 是否覆盖默认 deslop（false=保留系统去AI化策略；true=用本模板的 rules 接管）
  overrideDeslop: { type: Boolean, default: false },

  // 来源：system 系统预设 / user 手动 / ai-generated AI生成 / reference-extracted 从参考提取
  source: { type: String, enum: ['system', 'user', 'ai-generated', 'reference-extracted'], default: 'user' },

  // 若来源为 reference-extracted，记录参考小说 ID（可选）
  sourceRefId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReferenceNovel', default: null },

  // 系统预设不可被用户删除/编辑核心字段
  isSystem: { type: Boolean, default: false, index: true },

  // 适配的题材类型（空=通用；可指定 'male'/'female'/'lightnovel' 或具体类型名）
  applicableTypes: [{ type: String }],
}, { timestamps: true })

// 同一用户下名称唯一（系统预设与用户模板分桶，靠 userId+name 区分）
writingPersonaSchema.index({ userId: 1, name: 1 })

module.exports = mongoose.model('WritingPersona', writingPersonaSchema)
