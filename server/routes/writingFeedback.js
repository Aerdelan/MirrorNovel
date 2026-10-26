const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const mongoose = require('mongoose')
const WritingFeedback = require('../models/WritingFeedback')
const Novel = require('../models/Novel')
const { runCreativeLease, assertCreativeLease } = require('../services/creativeLease')
const {
  validateFeedbackInput, isFeedbackFresh, buildDistillPrompt, parseModelJson,
  validateDistilledPreference, httpError, MAX_FEEDBACKS_PER_USER, MAX_PAGE_LIMIT,
} = require('../services/writingStyle')

/**
 * 写作反馈路由（A3）
 * - 记录一次人工修改及其用途；只读当前账号，跨账号 404。
 * - 记录本身不触发任何模型调用，正文保存与历史版本完全不依赖这里。
 * - 提炼候选偏好是显式操作（额外一次推理调用）；"仅纠错/仅本次"拒绝提炼；
 *   已过期（被再次编辑覆盖）的改动拒绝提炼；重复提炼幂等返回已有候选。
 */

function fail(res, error) {
  const status = error?.status || 500
  res.status(status).json({ message: status === 500 ? '操作失败，请稍后重试' : error.message })
}

function parseId(value) {
  if (!mongoose.isValidObjectId(value)) throw httpError(404, '未找到该写作反馈')
  return value
}

router.get('/', auth, async (req, res) => {
  try {
    const filter = { userId: req.user.id }
    if (mongoose.isValidObjectId(req.query.novelId)) filter.novelId = req.query.novelId
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), MAX_PAGE_LIMIT)
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const [items, total] = await Promise.all([
      WritingFeedback.find(filter).sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      WritingFeedback.countDocuments(filter),
    ])
    res.json({ items, total, page, limit })
  } catch (e) { fail(res, e) }
})

router.post('/', auth, async (req, res) => {
  try {
    const novelId = req.body?.novelId
    if (!mongoose.isValidObjectId(novelId)) throw httpError(404, '未找到来源作品')
    const novel = await Novel.findOne({ _id: novelId, userId: req.user.id }).select('title chapters.chapterNumber').lean()
    if (!novel) throw httpError(404, '未找到来源作品或它不属于当前账号')
    const chapterNumber = parseInt(req.body?.sourceChapterNumber, 10)
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) throw httpError(400, '章节号无效')
    if (!(novel.chapters || []).some(chapter => chapter.chapterNumber === chapterNumber)) throw httpError(400, '来源章节不存在')
    const input = validateFeedbackInput(req.body)
    const count = await WritingFeedback.countDocuments({ userId: req.user.id })
    if (count >= MAX_FEEDBACKS_PER_USER) throw httpError(400, `修改记录数量已达上限（${MAX_FEEDBACKS_PER_USER} 条），请先清理不再需要的记录`)
    // 幂等：同账号 + 同章节 + 同原文/修改稿 = 重复点击，返回已有记录。
    const existing = await WritingFeedback.findOne({
      userId: req.user.id, novelId, sourceChapterNumber: chapterNumber,
      originalHash: input.originalHash, revisedHash: input.revisedHash,
    })
    if (existing) return res.json({ duplicate: true, feedback: existing })
    const feedback = await WritingFeedback.create({
      userId: req.user.id,
      novelId, novelTitle: novel.title || '',
      sourceChapterNumber: chapterNumber,
      originalText: input.originalSlice,
      revisedText: input.revisedSlice,
      originalHash: input.originalHash,
      revisedHash: input.revisedHash,
      originalLength: input.originalLength,
      revisedLength: input.revisedLength,
      originalExcerptStart: input.originalExcerptStart,
      revisedExcerptStart: input.revisedExcerptStart,
      sceneType: input.sceneType,
      reason: input.reason,
      note: input.note,
    })
    res.status(201).json({ duplicate: false, feedback })
  } catch (e) { fail(res, e) }
})

// 显式 AI 提炼候选偏好。说明：这会产生一次推理调用（reasoning 线路）。
router.post('/:id/distill', auth, async (req, res) => {
  try {
    parseId(req.params.id)
    await runCreativeLease({ userId: req.user.id, key: `writing-feedback:${req.params.id}`, kind: 'writing_preference_distill' }, async () => {
    const feedback = await WritingFeedback.findOne({ _id: req.params.id, userId: req.user.id })
    if (!feedback) return res.status(404).json({ message: '未找到该写作反馈' })
    const { GENERALIZABLE_REASONS } = require('../services/writingStyle')
    if (!GENERALIZABLE_REASONS.includes(feedback.reason)) {
      return res.status(400).json({ message: '「仅纠错」和「仅本次修改」不产生长期偏好；请重新记录并选择其他理由，或手动添加偏好' })
    }
    if (feedback.distilledPreferenceId) {
      const Preference = require('../models/WritingPreference')
      const existing = await Preference.findOne({ _id: feedback.distilledPreferenceId, userId: req.user.id }).lean()
      if (existing) return res.json({ duplicate: true, preference: existing })
      // 指向的偏好已被删除：清空指针，允许重新提炼。
      feedback.distilledPreferenceId = null
      await feedback.save()
    }
    const novel = await Novel.findOne({ _id: feedback.novelId, userId: req.user.id }).select('chapters.chapterNumber chapters.content').lean()
    if (!novel) return res.status(404).json({ message: '来源作品不存在，无法校验修改是否仍然有效' })
    const chapter = (novel.chapters || []).find(item => item.chapterNumber === feedback.sourceChapterNumber)
    if (!isFeedbackFresh(feedback, chapter?.content)) {
      return res.status(409).json({ message: '这条修改已不是该章节的当前内容（可能已被再次编辑或回退）；请基于最新内容重新记录后再提炼' })
    }
    const { streamGenerate, resolveApiConfig } = require('../services/aiService')
    const { system, prompt } = buildDistillPrompt(feedback)
    const result = await streamGenerate(system, prompt, null, null, resolveApiConfig(req.userModelConfig, 'reasoning'), 1, 0.4, 1024, 120000, null, { taskType: 'preference_distill' })
    const parsed = validateDistilledPreference(parseModelJson(result?.content), feedback)
    await assertCreativeLease()
    const latest = await Novel.findOne({ _id: feedback.novelId, userId: req.user.id }).select('chapters.chapterNumber chapters.content').lean()
    const latestChapter = latest?.chapters?.find(item => item.chapterNumber === feedback.sourceChapterNumber)
    if (!isFeedbackFresh(feedback, latestChapter?.content)) {
      return res.status(409).json({ message: '提炼期间章节内容已更新，请基于最新修改重新记录；本次结果未保存' })
    }
    const Preference = require('../models/WritingPreference')
    let preference = await Preference.findOne({
      userId: req.user.id, novelId: feedback.novelId, statement: parsed.statement, status: { $in: ['candidate', 'active', 'paused'] },
    })
    let duplicate = true
    if (!preference) {
      preference = await Preference.create({
        userId: req.user.id,
        novelId: feedback.novelId,
        novelTitle: feedback.novelTitle || '',
        statement: parsed.statement,
        rationale: parsed.rationale,
        reason: feedback.reason,
        status: 'candidate',
        source: 'distilled',
        evidence: [{ feedbackId: feedback._id, excerpt: String(feedback.revisedText || '').slice(0, 160), chapterNumber: feedback.sourceChapterNumber }],
        distilledFromFeedback: feedback._id,
      })
      duplicate = false
    }
    feedback.distilledPreferenceId = preference._id
    await feedback.save()
    res.json({ duplicate, preference })
    })
  } catch (e) {
    if (res.headersSent) return
    if (e.code === 'GENERATION_LEASE_BUSY') return res.status(409).json({ message: '这条反馈正在提炼，请等待当前请求完成' })
    fail(res, e)
  }
})

router.delete('/:id', auth, async (req, res) => {
  try {
    parseId(req.params.id)
    const result = await WritingFeedback.deleteOne({ _id: req.params.id, userId: req.user.id })
    if (!result.deletedCount) return res.status(404).json({ message: '未找到该写作反馈' })
    res.json({ ok: true })
  } catch (e) { fail(res, e) }
})

module.exports = router
