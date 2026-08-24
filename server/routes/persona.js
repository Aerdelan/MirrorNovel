const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const WritingPersona = require('../models/WritingPersona')
const { streamGenerate, resolveApiConfig } = require('../services/aiService')
const { seedSystemPersonas } = require('../config/writingPersonas')

/**
 * 写作人格路由
 * - 每个用户独立存储
 * - 系统预设 isSystem=true 不可删除/改核心字段
 * - AI 生成：用户给题材，一次性产出 voice/tone/rules/vocab
 */

// 列表（首次访问自动播种系统预设）
router.get('/', auth, async (req, res) => {
  try {
    await seedSystemPersonas(req.user.id)
    const list = await WritingPersona.find({ userId: req.user.id }).sort({ isSystem: -1, createdAt: 1 })
    res.json(list)
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

// 详情
router.get('/:id', auth, async (req, res) => {
  try {
    const doc = await WritingPersona.findOne({ _id: req.params.id, userId: req.user.id })
    if (!doc) return res.status(404).json({ message: '未找到该写作人格' })
    res.json(doc)
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

// 新建（用户模板）
router.post('/', auth, async (req, res) => {
  try {
    const { name, description, voice, tone, rules, vocab, overrideDeslop, applicableTypes } = req.body || {}
    if (!name || !name.trim()) return res.status(400).json({ message: '名称不能为空' })
    const dup = await WritingPersona.findOne({ userId: req.user.id, name: name.trim() })
    if (dup) return res.status(409).json({ message: '已存在同名写作人格' })
    const doc = await WritingPersona.create({
      userId: req.user.id,
      name: name.trim(),
      description: description || '',
      voice: voice || '',
      tone: tone || '',
      rules: rules || '',
      vocab: vocab || '',
      overrideDeslop: !!overrideDeslop,
      applicableTypes: Array.isArray(applicableTypes) ? applicableTypes : [],
      source: 'user',
      isSystem: false,
    })
    res.json(doc)
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

// 更新（系统预设只允许改 description/applicableTypes，不改核心字段）
router.put('/:id', auth, async (req, res) => {
  try {
    const doc = await WritingPersona.findOne({ _id: req.params.id, userId: req.user.id })
    if (!doc) return res.status(404).json({ message: '未找到该写作人格' })

    const { name, description, voice, tone, rules, vocab, overrideDeslop, applicableTypes } = req.body || {}

    if (doc.isSystem) {
      // 系统预设：仅允许改描述与适用题材
      if (description !== undefined) doc.description = description
      if (Array.isArray(applicableTypes)) doc.applicableTypes = applicableTypes
    } else {
      if (name !== undefined) {
        const trimmed = String(name).trim()
        if (!trimmed) return res.status(400).json({ message: '名称不能为空' })
        const dup = await WritingPersona.findOne({ userId: req.user.id, name: trimmed, _id: { $ne: doc._id } })
        if (dup) return res.status(409).json({ message: '已存在同名写作人格' })
        doc.name = trimmed
      }
      if (description !== undefined) doc.description = description
      if (voice !== undefined) doc.voice = voice
      if (tone !== undefined) doc.tone = tone
      if (rules !== undefined) doc.rules = rules
      if (vocab !== undefined) doc.vocab = vocab
      if (overrideDeslop !== undefined) doc.overrideDeslop = !!overrideDeslop
      if (Array.isArray(applicableTypes)) doc.applicableTypes = applicableTypes
    }

    await doc.save()
    res.json(doc)
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

// 删除（系统预设不可删）
router.delete('/:id', auth, async (req, res) => {
  try {
    const doc = await WritingPersona.findOne({ _id: req.params.id, userId: req.user.id })
    if (!doc) return res.status(404).json({ message: '未找到该写作人格' })
    if (doc.isSystem) return res.status(403).json({ message: '系统预设不可删除，可复制后编辑' })
    await doc.deleteOne()
    res.json({ message: '已删除' })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

// 克隆（系统预设或他人模板 → 自己的副本）
router.post('/:id/clone', auth, async (req, res) => {
  try {
    const src = await WritingPersona.findOne({ _id: req.params.id, userId: req.user.id })
    if (!src) return res.status(404).json({ message: '未找到该写作人格' })
    const newName = `${src.name} 副本`
    const dup = await WritingPersona.findOne({ userId: req.user.id, name: newName })
    if (dup) return res.status(409).json({ message: '已存在同名副本' })
    const doc = await WritingPersona.create({
      userId: req.user.id,
      name: newName,
      description: src.description,
      voice: src.voice,
      tone: src.tone,
      rules: src.rules,
      vocab: src.vocab,
      overrideDeslop: src.overrideDeslop,
      applicableTypes: src.applicableTypes,
      source: 'user',
      isSystem: false,
    })
    res.json(doc)
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

// AI 生成：用户给题材，产出一套人格
router.post('/ai-generate', auth, async (req, res) => {
  try {
    const { novelType, hint } = req.body || {}
    if (!novelType || !String(novelType).trim()) {
      return res.status(400).json({ message: '请提供想写的小说类型' })
    }
    const apiConfig = resolveApiConfig(req.user.modelConfig, 'reasoning')

    const systemPrompt = '你是一位资深的小说写作风格设计师。你的任务是根据用户给出的小说类型，设计一套完整的"写作人格"模板，用于指导 AI 小说生成器的输出风格。只输出合法 JSON，不要 Markdown、不要解释、不要代码块。'

    const userPrompt = `请为以下小说类型设计一套写作人格。

小说类型：${novelType}
额外要求：${hint || '无'}

输出结构如下（所有字段都是字符串，不要省略）：
{
  "name": "模板名称（不超过10字）",
  "description": "一句话描述这套风格（不超过30字）",
  "voice": "作者声线：叙述者声线、视角、叙事距离、人称、叙述温度（80-150字）",
  "tone": "语气与节奏：用词密度、句法节奏、轻重平衡、段落习惯（80-150字）",
  "rules": "题材约束与人物声音规则，用编号列表，每条一行（300-500字）",
  "vocab": "推荐词与禁用词，用换行分隔（50-100字）",
  "overrideDeslop": false
}

要求：
1. 风格要鲜明，与该题材契合，不要写成通用模板
2. rules 要具体可执行，覆盖视角、节奏、人物声音、对话、描写、情绪处理
3. vocab 要给出该题材的推荐词和需要避免的 AI 化套词
4. overrideDeslop 默认 false，除非该题材需要完全自定义去AI化策略`

    const result = await streamGenerate(systemPrompt, userPrompt, null, null, apiConfig, 2, 0.8, 4096, 120000)
    let parsed
    try {
      // 容错：去掉可能的 ```json 包裹
      const text = result.content.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
      parsed = JSON.parse(text)
    } catch {
      return res.status(500).json({ message: 'AI 输出解析失败，请重试', raw: result.content.slice(0, 500) })
    }

    // 落库为 ai-generated
    const doc = await WritingPersona.create({
      userId: req.user.id,
      name: (parsed.name || 'AI生成模板').slice(0, 40),
      description: parsed.description || '',
      voice: parsed.voice || '',
      tone: parsed.tone || '',
      rules: parsed.rules || '',
      vocab: parsed.vocab || '',
      overrideDeslop: !!parsed.overrideDeslop,
      applicableTypes: [],
      source: 'ai-generated',
      isSystem: false,
    })
    res.json(doc)
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

module.exports = router
