const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const mongoose = require('mongoose')
const WritingSample = require('../models/WritingSample')
const Novel = require('../models/Novel')
const ReferenceNovel = require('../models/ReferenceNovel')
const {
  hashSampleContent, sampleIdentity, validateSampleInput, httpError,
  MAX_SAMPLES_PER_USER, MAX_PAGE_LIMIT,
} = require('../services/writingSamples')

/**
 * 写作样稿路由（A1 认可样稿库）
 * - 全部查询都限定 userId：跨账号一律 404，不暴露存在性。
 * - 参考库片段只能以草稿进入样稿库，认可必须由作者显式操作。
 * - 重复提交（同内容 + 同来源）幂等返回已有记录，不产生重复数据。
 * - 有数量、长度与分页上限；不触发任何模型调用。
 */

function fail(res, error) {
  const status = error?.status || 500
  res.status(status).json({ message: status === 500 ? '操作失败，请稍后重试' : error.message })
}

function parseId(value) {
  if (!mongoose.isValidObjectId(value)) throw httpError(404, '未找到该写作样稿')
  return value
}

// 按状态聚合计数（列表页签展示用）
async function statusCounts(userId) {
  const rows = await WritingSample.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(String(userId)) } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])
  return Object.fromEntries(rows.map(row => [row._id, row.count]))
}

router.get('/', auth, async (req, res) => {
  try {
    const filter = { userId: req.user.id }
    if (['draft', 'approved', 'revoked'].includes(req.query.status)) filter.status = req.query.status
    if (['novel', 'screenplay'].includes(req.query.scope)) filter.scope = req.query.scope
    if (['dialogue', 'action', 'observation', 'emotion', 'transition', 'other'].includes(req.query.sceneType)) filter.sceneType = req.query.sceneType
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), MAX_PAGE_LIMIT)
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const [items, total, counts] = await Promise.all([
      WritingSample.find(filter).sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      WritingSample.countDocuments(filter),
      statusCounts(req.user.id),
    ])
    res.json({ items, total, page, limit, statusCounts: counts })
  } catch (e) { fail(res, e) }
})

router.post('/', auth, async (req, res) => {
  try {
    const input = validateSampleInput(req.body)
    let sourceNovelId = null, sourceNovelTitle = '', sourceChapterNumber = 0
    let sourceReferenceId = null, sourceReferenceTitle = ''
    if (req.body.sourceNovelId) {
      if (!mongoose.isValidObjectId(req.body.sourceNovelId)) throw httpError(404, '未找到来源作品')
      const novel = await Novel.findOne({ _id: req.body.sourceNovelId, userId: req.user.id }).select('title chapters.chapterNumber chapters.title').lean()
      if (!novel) throw httpError(404, '未找到来源作品或它不属于当前账号')
      sourceNovelId = novel._id
      sourceNovelTitle = novel.title || ''
      const chapterNumber = parseInt(req.body.sourceChapterNumber, 10) || 0
      if (chapterNumber) {
        if (!(novel.chapters || []).some(chapter => chapter.chapterNumber === chapterNumber)) {
          throw httpError(400, '来源章节不存在，请刷新后重试')
        }
        sourceChapterNumber = chapterNumber
      }
    } else if (req.body.sourceReferenceId) {
      if (!mongoose.isValidObjectId(req.body.sourceReferenceId)) throw httpError(404, '未找到来源参考')
      const reference = await ReferenceNovel.findOne({ _id: req.body.sourceReferenceId, userId: req.user.id }).select('title').lean()
      if (!reference) throw httpError(404, '未找到来源参考或它不属于当前账号')
      sourceReferenceId = reference._id
      sourceReferenceTitle = reference.title || ''
    }
    // 幂等：同账号 + 同内容 + 同来源视为重复点击，返回已有记录且不改变其状态。
    // 查重必须在数量上限之前：先存成功的样稿，重复点击永远拿得到原记录。
    const identity = sampleIdentity(req.user.id, input.content, { sourceNovelId, sourceChapterNumber, sourceReferenceId })
    const existing = await WritingSample.findOne({
      userId: identity.userId, contentHash: identity.contentHash,
      sourceNovelId: identity.sourceNovelId, sourceChapterNumber: identity.sourceChapterNumber,
      sourceReferenceId: identity.sourceReferenceId,
    })
    if (existing) return res.json({ duplicate: true, sample: existing })
    const count = await WritingSample.countDocuments({ userId: req.user.id })
    if (count >= MAX_SAMPLES_PER_USER) {
      throw httpError(400, `样稿数量已达上限（${MAX_SAMPLES_PER_USER} 条），请先清理不再需要的样稿`)
    }
    // 参考片段必须先入草稿：只有作者后续显式认可才允许作为模型输入。
    const approveNow = input.sourceKind !== 'authorized_reference' && input.allowedForModelInput
    const sample = await WritingSample.create({
      userId: req.user.id,
      scope: input.scope,
      sceneType: input.sceneType,
      title: input.title,
      content: input.content,
      notes: input.notes,
      sourceKind: input.sourceKind,
      sourceNovelId, sourceNovelTitle, sourceChapterNumber,
      sourceReferenceId, sourceReferenceTitle,
      status: approveNow ? 'approved' : 'draft',
      allowedForModelInput: !!approveNow,
      contentHash: hashSampleContent(input.content),
    })
    res.status(201).json({ duplicate: false, sample })
  } catch (e) { fail(res, e) }
})

router.get('/:id', auth, async (req, res) => {
  try {
    parseId(req.params.id)
    const doc = await WritingSample.findOne({ _id: req.params.id, userId: req.user.id }).lean()
    if (!doc) return res.status(404).json({ message: '未找到该写作样稿' })
    res.json(doc)
  } catch (e) { fail(res, e) }
})

router.put('/:id', auth, async (req, res) => {
  try {
    parseId(req.params.id)
    const doc = await WritingSample.findOne({ _id: req.params.id, userId: req.user.id })
    if (!doc) return res.status(404).json({ message: '未找到该写作样稿' })
    const input = validateSampleInput({
      content: req.body.content !== undefined ? req.body.content : doc.content,
      title: req.body.title !== undefined ? req.body.title : doc.title,
      notes: req.body.notes !== undefined ? req.body.notes : doc.notes,
      scope: req.body.scope !== undefined ? req.body.scope : doc.scope,
      sceneType: req.body.sceneType !== undefined ? req.body.sceneType : doc.sceneType,
      sourceKind: doc.sourceKind,
    })
    const contentChanged = input.content !== doc.content
    doc.content = input.content
    doc.title = input.title
    doc.notes = input.notes
    doc.scope = input.scope
    doc.sceneType = input.sceneType
    if (contentChanged) {
      // 认可只对“这段文字”成立：内容被修改后回到草稿，需要作者重新认可。
      doc.contentHash = hashSampleContent(input.content)
      if (doc.status === 'approved') doc.status = 'draft'
      doc.allowedForModelInput = false
    }
    await doc.save()
    res.json({ sample: doc })
  } catch (e) { fail(res, e) }
})

// 认可。默认同时允许作为模型输入；body.allowedForModelInput=false 表示仅认可存档。
router.post('/:id/approve', auth, async (req, res) => {
  try {
    parseId(req.params.id)
    const doc = await WritingSample.findOne({ _id: req.params.id, userId: req.user.id })
    if (!doc) return res.status(404).json({ message: '未找到该写作样稿' })
    doc.status = 'approved'
    doc.allowedForModelInput = req.body?.allowedForModelInput !== false
    await doc.save()
    res.json({ sample: doc })
  } catch (e) { fail(res, e) }
})

router.post('/:id/revoke', auth, async (req, res) => {
  try {
    parseId(req.params.id)
    const doc = await WritingSample.findOne({ _id: req.params.id, userId: req.user.id })
    if (!doc) return res.status(404).json({ message: '未找到该写作样稿' })
    doc.status = 'revoked'
    doc.allowedForModelInput = false
    await doc.save()
    res.json({ sample: doc })
  } catch (e) { fail(res, e) }
})

router.delete('/:id', auth, async (req, res) => {
  try {
    parseId(req.params.id)
    const result = await WritingSample.deleteOne({ _id: req.params.id, userId: req.user.id })
    if (!result.deletedCount) return res.status(404).json({ message: '未找到该写作样稿' })
    res.json({ ok: true })
  } catch (e) { fail(res, e) }
})

module.exports = router
