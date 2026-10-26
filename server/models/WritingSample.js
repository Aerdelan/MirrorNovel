const mongoose = require('mongoose')

/**
 * 写作样稿（Writing Sample）——规划书 A1 的"认可样稿库"。
 * 只保存作者明确认可的小段文字；正文无限量内容仍留在作品/参考集合里。
 *
 * 生命周期：draft（草稿）→ approved（作者认可）→ revoked（撤销，可重新认可）。
 * 只有 status='approved' 且 allowedForModelInput=true 的样稿才允许进入
 * 生成候选池（见 services/writingSamples.js 的 loadApprovedSamples）。
 * 删除样稿只移除本集合记录；来源作品/参考删除不影响已保存样稿
 * （来源标题为创建时的冗余字段）。未来引入作品快照后同样不回改旧快照。
 */
const writingSampleSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  // 适用范围：小说正文 / 剧本。互相独立，剧本样稿不会进入小说提示词。
  scope: { type: String, enum: ['novel', 'screenplay'], default: 'novel' },
  // 用途标签：对白 / 动作 / 观察 / 情绪 / 过渡 / 其他
  sceneType: { type: String, enum: ['dialogue', 'action', 'observation', 'emotion', 'transition', 'other'], default: 'other' },

  title: { type: String, default: '', trim: true, maxlength: 80 },
  content: { type: String, required: true, trim: true },
  notes: { type: String, default: '', trim: true, maxlength: 500 },

  // 来源：own_text 自己作品或手动粘贴 / human_edit 人工修改（A3 预留）/ authorized_reference 已蒸馏参考片段
  sourceKind: { type: String, enum: ['own_text', 'human_edit', 'authorized_reference'], default: 'own_text' },
  sourceNovelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', default: null },
  sourceNovelTitle: { type: String, default: '' },
  sourceChapterNumber: { type: Number, default: 0 },
  sourceReferenceId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReferenceNovel', default: null },
  sourceReferenceTitle: { type: String, default: '' },

  status: { type: String, enum: ['draft', 'approved', 'revoked'], default: 'draft' },
  allowedForModelInput: { type: Boolean, default: false },
  // 规范化正文的 sha256，用于重复提交的幂等判断；与来源身份共同查重。
  contentHash: { type: String, required: true },
}, { timestamps: true })

// 列表过滤 + 候选池查询
writingSampleSchema.index({ userId: 1, status: 1, updatedAt: -1 })
// 幂等查重（查重逻辑在服务层，索引只为加速；同一文本允许来自不同来源）
writingSampleSchema.index({ userId: 1, contentHash: 1 })

module.exports = mongoose.model('WritingSample', writingSampleSchema)
