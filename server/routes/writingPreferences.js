const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const mongoose = require('mongoose')
const WritingPreference = require('../models/WritingPreference')
const WritingFeedback = require('../models/WritingFeedback')
const { httpError, MAX_PREFERENCE_STATEMENT_CHARS, MAX_PREFERENCES_PER_USER, MAX_PAGE_LIMIT, FEEDBACK_REASONS } = require('../services/writingStyle')

/**
 * 写作偏好路由（A3）
 * - candidate（候选）→ confirm → active → pause/re-activate；删除随时可用。
 * - 只有 active 偏好会在作品采用风格版本时冻结进快照；candidate/paused 永不生效。
 * - 手动添加 = 作者亲笔规则，直接 active；提炼候选必须显式确认。
 * - 账号隔离：全部查询限定 userId；候选永不更新全局写作人格（无任何写人格的代码路径）。
 */

function fail(res, error) {
  const status = error?.status || 500
  res.status(status).json({ message: status === 500 ? '操作失败，请稍后重试' : error.message })
}

function parseId(value) {
  if (!mongoose.isValidObjectId(value)) throw httpError(404, '未找到该写作偏好')
  return value
}

router.get('/', auth, async (req, res) => {
  try {
    const filter = { userId: req.user.id }
    if (['candidate', 'active', 'paused'].includes(req.query.status)) filter.status = req.query.status
    if (mongoose.isValidObjectId(req.query.novelId)) filter.novelId = req.query.novelId
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), MAX_PAGE_LIMIT)
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const [items, total] = await Promise.all([
      WritingPreference.find(filter).sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      WritingPreference.countDocuments(filter),
    ])
    res.json({ items, total, page, limit })
  } catch (e) { fail(res, e) }
})

// 手动添加：作者亲笔规则即视为已确认（active）。novelId 省略 = 账号所有作品。
router.post('/', auth, async (req, res) => {
  try {
    const statement = String(req.body?.statement || '').trim()
    if (statement.length < 10 || statement.length > MAX_PREFERENCE_STATEMENT_CHARS) {
      return res.status(400).json({ message: `偏好规则需在 10–${MAX_PREFERENCE_STATEMENT_CHARS} 字之间（当前 ${statement.length} 字）` })
    }
    let novelId = null, novelTitle = ''
    if (req.body?.novelId) {
      if (!mongoose.isValidObjectId(req.body.novelId)) return res.status(404).json({ message: '未找到目标作品' })
      const Novel = require('../models/Novel')
      const novel = await Novel.findOne({ _id: req.body.novelId, userId: req.user.id }).select('title').lean()
      if (!novel) return res.status(404).json({ message: '未找到目标作品或它不属于当前账号' })
      novelId = novel._id
      novelTitle = novel.title || ''
    }
    const count = await WritingPreference.countDocuments({ userId: req.user.id })
    if (count >= MAX_PREFERENCES_PER_USER) return res.status(400).json({ message: `偏好数量已达上限（${MAX_PREFERENCES_PER_USER} 条），请先清理不再需要的偏好` })
    const duplicate = await WritingPreference.findOne({ userId: req.user.id, novelId, statement })
    if (duplicate) return res.json({ duplicate: true, preference: duplicate })
    const reason = FEEDBACK_REASONS.includes(req.body?.reason) ? req.body.reason : 'manual'
    const preference = await WritingPreference.create({
      userId: req.user.id, novelId, novelTitle,
      statement, rationale: String(req.body?.rationale || '').trim().slice(0, 300),
      reason, status: 'active', source: 'manual',
      evidence: [],
    })
    res.status(201).json({ duplicate: false, preference })
  } catch (e) { fail(res, e) }
})

// 候选 → 生效。确认是作者显式动作；模型提炼结果只有走到这里才开始影响生成。
router.post('/:id/confirm', auth, async (req, res) => {
  try {
    parseId(req.params.id)
    const doc = await WritingPreference.findOne({ _id: req.params.id, userId: req.user.id })
    if (!doc) return res.status(404).json({ message: '未找到该写作偏好' })
    if (doc.status !== 'candidate') return res.status(409).json({ message: '只有候选偏好需要确认' })
    doc.status = 'active'
    await doc.save()
    res.json({ preference: doc })
  } catch (e) { fail(res, e) }
})

// 放弃候选（与删除等价的软处理，保留证据供追溯）。
router.post('/:id/dismiss', auth, async (req, res) => {
  try {
    parseId(req.params.id)
    const doc = await WritingPreference.findOne({ _id: req.params.id, userId: req.user.id })
    if (!doc) return res.status(404).json({ message: '未找到该写作偏好' })
    if (doc.status !== 'candidate') return res.status(409).json({ message: '只有候选偏好可以放弃' })
    await WritingPreference.deleteOne({ _id: doc._id })
    await WritingFeedback.updateMany({ distilledPreferenceId: doc._id }, { $set: { distilledPreferenceId: null } })
    res.json({ ok: true })
  } catch (e) { fail(res, e) }
})

router.post('/:id/pause', auth, async (req, res) => {
  try {
    parseId(req.params.id)
    const doc = await WritingPreference.findOne({ _id: req.params.id, userId: req.user.id })
    if (!doc) return res.status(404).json({ message: '未找到该写作偏好' })
    if (doc.status !== 'active') return res.status(409).json({ message: '只有生效中的偏好可以停用' })
    doc.status = 'paused'
    await doc.save()
    res.json({ preference: doc })
  } catch (e) { fail(res, e) }
})

router.post('/:id/activate', auth, async (req, res) => {
  try {
    parseId(req.params.id)
    const doc = await WritingPreference.findOne({ _id: req.params.id, userId: req.user.id })
    if (!doc) return res.status(404).json({ message: '未找到该写作偏好' })
    if (doc.status !== 'paused') return res.status(409).json({ message: '只有已停用的偏好可以重新启用' })
    doc.status = 'active'
    await doc.save()
    res.json({ preference: doc })
  } catch (e) { fail(res, e) }
})

router.delete('/:id', auth, async (req, res) => {
  try {
    parseId(req.params.id)
    const result = await WritingPreference.deleteOne({ _id: req.params.id, userId: req.user.id })
    if (!result.deletedCount) return res.status(404).json({ message: '未找到该写作偏好' })
    await WritingFeedback.updateMany({ distilledPreferenceId: req.params.id }, { $set: { distilledPreferenceId: null } })
    res.json({ ok: true })
  } catch (e) { fail(res, e) }
})

module.exports = router
