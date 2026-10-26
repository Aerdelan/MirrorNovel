const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const mongoose = require('mongoose')
const WritingStyleRevision = require('../models/WritingStyleRevision')
const { createStyleRevision, compareRevisions, MAX_PINNED_SAMPLES } = require('../services/styleRevisions')

/**
 * 写作风格版本路由（A2）
 * - 版本不可变：只有创建与读取，没有更新和删除。
 * - 全部查询限定 userId；跨账号一律 404。
 * - 创建版本不触发任何模型调用；版本只是资料快照。
 */

function fail(res, error) {
  const status = error?.status || 500
  res.status(status).json({ message: status === 500 ? '操作失败，请稍后重试' : error.message })
}

function parseId(value) {
  if (!mongoose.isValidObjectId(value)) throw Object.assign(new Error('未找到该风格版本'), { status: 404 })
  return value
}

function summaryOf(doc) {
  return {
    _id: doc._id,
    name: doc.name,
    version: doc.version,
    scope: doc.scope,
    personaId: doc.personaId,
    personaName: doc.personaSnapshot?.name || '',
    sampleCount: (doc.samples || []).length,
    sampleTitles: (doc.samples || []).map(row => row.title || '').filter(Boolean),
    sampleBudget: doc.sampleBudget,
    note: doc.note,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

router.get('/', auth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50)
    const docs = await WritingStyleRevision.find({ userId: req.user.id }).sort({ version: -1 }).limit(limit).lean()
    res.json({ items: docs.map(summaryOf), total: await WritingStyleRevision.countDocuments({ userId: req.user.id }), limit })
  } catch (e) { fail(res, e) }
})

router.post('/', auth, async (req, res) => {
  try {
    const { name, personaId, sampleIds, note } = req.body || {}
    if (sampleIds !== undefined && !Array.isArray(sampleIds)) {
      return res.status(400).json({ message: '样稿选择必须是数组' })
    }
    const doc = await createStyleRevision({ userId: req.user.id, name, personaId, sampleIds, note })
    res.status(201).json({ revision: doc })
  } catch (e) { fail(res, e) }
})

router.get('/compare/:aId/:bId', auth, async (req, res) => {
  try {
    parseId(req.params.aId)
    parseId(req.params.bId)
    if (req.params.aId === req.params.bId) return res.status(400).json({ message: '请选择两个不同的版本' })
    const docs = await WritingStyleRevision.find({ _id: { $in: [req.params.aId, req.params.bId] }, userId: req.user.id }).lean()
    const a = docs.find(doc => String(doc._id) === req.params.aId)
    const b = docs.find(doc => String(doc._id) === req.params.bId)
    if (!a || !b) return res.status(404).json({ message: '未找到要对比的风格版本' })
    res.json({ diff: compareRevisions(a, b) })
  } catch (e) { fail(res, e) }
})

router.get('/:id', auth, async (req, res) => {
  try {
    parseId(req.params.id)
    const doc = await WritingStyleRevision.findOne({ _id: req.params.id, userId: req.user.id }).lean()
    if (!doc) return res.status(404).json({ message: '未找到该风格版本' })
    res.json(doc)
  } catch (e) { fail(res, e) }
})

module.exports = { router, MAX_PINNED_SAMPLES }
