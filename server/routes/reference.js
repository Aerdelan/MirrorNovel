const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const ReferenceNovel = require('../models/ReferenceNovel')
const { streamGenerate, resolveApiConfig, countTokens } = require('../services/aiService')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const fanqieScraper = require('../services/fanqieScraper')
const fanqieAuth = require('../services/fanqieAuth')

// admin 权限校验
const adminOnly = async (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: '仅管理员可访问' })
  }
  next()
}

// multer 内存存储 — 支持大文件（100MB）
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } })

/**
 * 全本蒸馏 — 分块分析 + AI 综合
 * 策略：
 *   1. 将全文按 20K 字分块
 *   2. 对首块做完整分析（含精选片段）
 *   3. 对后续每块提取"新增风格特征"（压缩格式）
 *   4. 最后让 AI 综合所有分析结果，生成最终风格档案
 */
const CHUNK_SIZE = 20000
const MAX_CHUNKS = 20 // 最多分析 20 块 ≈ 40 万字

async function extractStyleProfile(fileContent, mainCategory, subCategory, novelType = 'normal') {
  const isLightNovel = novelType === 'lightnovel'
  const typeLabel = isLightNovel ? '轻小说（日式ACGN风格）' : '小说'

  // 分块
  const totalLen = fileContent.length
  const chunkCount = Math.min(Math.ceil(totalLen / CHUNK_SIZE), MAX_CHUNKS)
  console.log(`[蒸馏] 全文 ${totalLen} 字，分 ${chunkCount} 块分析`)

  const chunkResults = []

  for (let i = 0; i < chunkCount; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, totalLen)
    const chunk = fileContent.slice(start, end)
    const isFirst = i === 0
    const positionLabel = isFirst ? '开头' : (i === chunkCount - 1 ? '结尾' : `第${i + 1}部分`)

    // 首块做完整分析，后续块只提取"新增特征"
    const prompt = isFirst
      ? (isLightNovel
        ? `你是一位专业的轻小说分析专家。请分析以下轻小说内容，提取它的风格特征。

轻小说类型：${mainCategory}${subCategory ? ' - ' + subCategory : ''}

请按以下格式输出（纯文本，不要用Markdown）：

【风格描述】
用 800-1000 字详细描述这部轻小说的整体风格。从以下几个维度展开：
1. 叙事视角：第一人称还是第三人称，主角视角的贴近程度
2. 角色塑造：角色萌属性（傲娇/天然呆/元气/冷酷等）的表现方式，角色间互动
3. 对话风格：对话占比、对话中是否包含角色个性
4. 描写风格：场景描写是否有动画感、萌系动作描写
5. 情感基调：整体氛围（温馨/热血/治愈/伤感）
6. 叙事节奏：日常/战斗/剧情的穿插比例
7. 用词倾向：是否使用拟声词、语气词

【精选片段】
从原文中挑选 8-10 个最能体现风格的片段，每个不超过 300 字，用 【片段1】...【片段10】 标记。

【写作特点】
用 200-300 字分析写作技法。

【特色词汇】
列出 15-25 个最有辨识度的特色词汇。

【章节结构】
用 80-150 字概括章节结构规律。

【质量评分】
根据内容与分类（${mainCategory}${subCategory ? ' - ' + subCategory : ''}）的匹配程度，给出 1-100 的整数分数。

以下是小说${positionLabel}内容：
${chunk}`
        : `你是一位专业的小说分析专家。请分析以下小说内容，提取它的风格特征。

小说类型：${mainCategory}${subCategory ? ' - ' + subCategory : ''}

请按以下格式输出（纯文本，不要用Markdown）：

【风格描述】
用 800-1000 字详细描述这部小说的整体风格。从以下几个维度展开：
1. 叙事节奏：整体快慢风格、张弛节奏变化规律、高潮分布密度
2. 对话比例与风格：对话/叙述比例、对话特色
3. 描写风格：场景描写是简笔勾勒还是细密铺陈
4. 情感基调：整体氛围（压抑/热血/轻松/沉重）
5. 开篇风格：如何快速引入世界观/人物/冲突
6. 用词倾向：文言/白话、用词华丽或朴实
7. 爽点/爽感设计：打脸节奏、升级反馈、情绪释放方式

【精选片段】
从原文中挑选 8-10 个最能体现风格的片段，每个不超过 300 字，用 【片段1】...【片段10】 标记。

【写作特点】
用 200-300 字分析写作技法。

【特色词汇】
列出 15-25 个最有辨识度的特色词汇。

【章节结构】
用 80-150 字概括章节结构规律。

【质量评分】
根据内容与分类（${mainCategory}${subCategory ? ' - ' + subCategory : ''}）的匹配程度，给出 1-100 的整数分数。

以下是小说${positionLabel}内容：
${chunk}`)
      : `以下是${typeLabel}《${mainCategory}》的${positionLabel}（第${start}~${end}字范围）。请提取这一段新增的风格特征，重点标注与开头部分不同的地方。

格式要求：
【新增风格特征】
用 200-300 字描述这一段与开头相比出现的新的风格特征（如有），包括但不限于：
- 节奏是否有变化
- 是否有新的写作手法
- 角色塑造是否有新的维度
- 是否有新的用词习惯

【新增特色词汇】
列出这一段中新出现的、前面没有的特色词汇，最多 10 个，用逗号分隔。

【补充片段】
从这一段中挑选 1-3 个最能代表风格或与前文不同的片段，每个不超过 200 字，用 【片段1】... 标记。

文本内容：
${chunk}`

    const result = await streamGenerate(
      `你是一位专业的${typeLabel}分析专家，擅长提取文本风格特征。`,
      prompt, null, null,
      resolveApiConfig(null, 'writing')
    )

    const raw = result.content || ''
    if (raw.length > 50) {
      chunkResults.push({ index: i, position: positionLabel, content: raw, isFirst })
    }
  }

  // 如果有多个分块，让 AI 综合成最终结果
  if (chunkResults.length > 1) {
    const synthesisInput = chunkResults.map((r, idx) => {
      return `===== 第${idx + 1}块分析（${r.position}）=====\n${r.content}`
    }).join('\n\n')

    const synthesisPrompt = `你是一位资深的小说编辑，请将以下对同一部小说的多份风格分析报告，综合成一份完整、一致的最终风格档案。

要求：
1. 合并所有分析中的风格描述，去重、补充
2. 精选片段从所有块中挑选最好的 8-10 个
3. 特色词汇去重合并为 15-30 个
4. 写作特点和章节结构综合所有块的信息
5. 质量评分取各块评分的平均值

请严格按照以下格式输出：

【风格描述】
（合并后的完整风格描述，1000-1500 字）

【精选片段】
（从全文范围挑选 8-10 个最佳片段）

【写作特点】
（综合后的写作特点分析，200-300 字）

【特色词汇】
（去重合并后的特色词汇列表，逗号分隔）

【章节结构】
（综合后的章节结构描述，80-150 字）

【质量评分】
（综合评分，1-100 的整数）

以下是各块分析结果：
${synthesisInput}`

    const result = await streamGenerate(
      '你是一位资深的小说编辑，擅长综合多份分析报告。',
      synthesisPrompt, null, null,
      resolveApiConfig(null, 'writing')
    )

    return result.content || chunkResults[0].content
  }

  return chunkResults[0]?.content || ''
}

// 解析 AI 输出为结构化数据
function parseStyleOutput(text) {
  const styleProfile = (text.match(/【风格描述】\s*([\s\S]*?)(?=\n【精选片段】|$)/) || [])[1]?.trim() || ''

  const excerptsMatch = text.match(/【片段\d+】\s*([\s\S]*?)(?=\n【片段\d+】|\n【写作特点】|$)/g) || []
  const keyExcerpts = excerptsMatch.map(e => e.replace(/【片段\d+】\s*/, '').trim()).filter(Boolean)

  const writingMatch = (text.match(/【写作特点】\s*([\s\S]*?)(?=\n【特色词汇】|$)/) || [])[1]
  const writingCharacteristics = writingMatch ? writingMatch.trim() : ''

  const vocabMatch = (text.match(/【特色词汇】\s*([\s\S]*?)(?=\n【章节结构】|$)/) || [])[1]
  const vocabularyBank = vocabMatch ? vocabMatch.split(/[,，、]/).map(v => v.trim()).filter(Boolean) : []

  const chapterStructure = (text.match(/【章节结构】\s*([\s\S]*?)(?=\n【质量评分】|$)/) || [])[1]?.trim() || ''

  const qualityScore = parseInt((text.match(/【质量评分】\s*(\d+)/) || [])[1], 10) || 0

  return { styleProfile, keyExcerpts, writingCharacteristics, vocabularyBank, chapterStructure, qualityScore }
}

// ---- 路由 ----

// 获取分类数据
router.get('/categories', (req, res) => {
  const data = require('../config/novelTypeData')
  res.json(data)
})

// 上传参考小说（TXT + 分类信息）—— 仅管理员（含去重）
router.post('/upload', auth, adminOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: '请上传 .txt 文件' })
    const ext = path.extname(req.file.originalname).toLowerCase()
    if (ext !== '.txt') return res.status(400).json({ message: '仅支持 .txt 文件' })

    const { title, gender, mainCategory, subCategory, tags, novelType } = req.body
    if (!title || !gender || !mainCategory) {
      return res.status(400).json({ message: '请填写小说名称和分类' })
    }

    // 去重检测：同标题 + 同分类视为重复
    const existing = await ReferenceNovel.findOne({ title, mainCategory })
    if (existing) {
      return res.status(409).json({
        message: `《${title}》已存在于蒸馏库中，如需重新蒸馏请先删除旧记录`,
        existingId: existing._id,
      })
    }

    const content = req.file.buffer.toString('utf-8')
    if (content.length < 100) return res.status(400).json({ message: '小说内容太少（至少100字）' })

    res.json({ message: '文件已接收，正在提取风格特征...', status: 'analyzing' })

    // AI 提取风格
    let styleProfile = '', keyExcerpts = [], writingCharacteristics = '', vocabularyBank = [], chapterStructure = '', qualityScore = 0
    try {
      const raw = await extractStyleProfile(content, mainCategory, subCategory, novelType || 'normal')
      const parsed = parseStyleOutput(raw)
      styleProfile = parsed.styleProfile
      keyExcerpts = parsed.keyExcerpts
      writingCharacteristics = parsed.writingCharacteristics
      vocabularyBank = parsed.vocabularyBank
      chapterStructure = parsed.chapterStructure
      qualityScore = parsed.qualityScore
    } catch (e) {
      console.error('AI 风格提取失败:', e.message)
    }

    // 存入数据库
    const doc = await ReferenceNovel.create({
      userId: req.userId,
      title,
      novelType: novelType || 'normal',
      gender, mainCategory, subCategory,
      tags: tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : [],
      styleProfile, keyExcerpts, writingCharacteristics, vocabularyBank, chapterStructure, qualityScore,
      originalFileName: req.file.originalname,
      originalLength: content.length,
      aiProcessed: !!styleProfile,
    })

    res.json({
      message: styleProfile ? '风格提取完成，已入库' : '文件已保存（风格提取失败）',
      novel: doc,
    })
  } catch (error) {
    console.error('上传参考小说失败:', error)
    res.status(500).json({ message: '上传失败', error: error.message })
  }
})

// 获取用户上传的参考小说列表 —— 仅管理员
router.get('/list', auth, adminOnly, async (req, res) => {
  try {
    const novels = await ReferenceNovel.find({ userId: req.userId })
      .select('-keyExcerpts -styleProfile -vocabularyBank -chapterStructure')
      .sort({ createdAt: -1 })
    res.json(novels)
  } catch (error) {
    res.status(500).json({ message: '获取列表失败', error: error.message })
  }
})

// ---- 番茄小说预检（获取书名和类型，无需蒸馏） ----
router.get('/fanqie-preview', auth, adminOnly, async (req, res) => {
  try {
    const { bookId } = req.query
    if (!bookId) return res.status(400).json({ message: '请输入 Book ID' })

    const { title, chapters } = await fanqieScraper.getBookInfo(bookId)
    if (chapters.length === 0) throw new Error('未获取到章节信息')

    // 尝试获取元数据（书名、分类标签）
    let bookName = title, labels = []
    try {
      const meta = await fanqieScraper.getChapterMeta(chapters[0]?.item_id)
      if (meta.bookName) bookName = meta.bookName
    } catch (e) {}
    // 从 HTML 页面提取分类标签（都市脑洞、系统、穿越等）
    try { labels = await fanqieScraper.getBookCategory(bookId) } catch (e) {}

    res.json({ title: bookName, genre: labels[0] || '', labels, chapterCount: chapters.length })
  } catch (error) {
    res.status(500).json({ message: '获取失败: ' + error.message })
  }
})

// ---- 番茄小说 Cookie 管理（管理后台使用） ----

// 接收用户填入的 cookie（需要 admin 权限）
router.post('/fanqie-cookie', auth, adminOnly, (req, res) => {
  const { cookie } = req.body
  if (!cookie) return res.status(400).json({ message: '请填入 cookie' })
  // 去掉 cookie 字段名等非内容部分，取 document.cookie 格式
  let clean = cookie
  // 如果用户从 F12 复制了整个 Cookie 请求头，去掉 "Cookie: " 前缀
  clean = clean.replace(/^Cookie:\s*/i, '').replace(/^cookie:\s*/i, '')
  fanqieAuth.setCookie(clean)
  res.json({ message: 'Cookie 已保存', status: fanqieAuth.getStatus() })
})

// 查询认证状态（前端显示）
router.get('/fanqie-cookie-status', auth, adminOnly, (req, res) => {
  res.json(fanqieAuth.getStatus())
})

// 清除 Cookie
router.delete('/fanqie-cookie', auth, adminOnly, (req, res) => {
  fanqieAuth.setCookie('')
  res.json({ message: 'Cookie 已清除', status: fanqieAuth.getStatus() })
})

// ---- 从番茄小说下载为 TXT（放在 /:id 前面，避免被通配路由匹配） ----
router.get('/fanqie-download', auth, adminOnly, async (req, res) => {
  try {
    const { bookId, chapters } = req.query
    if (!bookId) return res.status(400).json({ message: '请输入 Book ID' })

    // 提示认证状态
    const authStatus = fanqieAuth.getStatus()
    if (authStatus.authenticated) {
      console.log('[fanqie-download] 使用 API 方式下载（已认证）')
    } else {
      console.log('[fanqie-download] 未检测到认证信息，使用 HTML 抓取方式（锁定章节无法获取）')
    }

    const maxChapters = parseInt(chapters) || 0
    const { title, chapters: chapterList } = await fanqieScraper.getBookInfo(bookId)
    if (chapterList.length === 0) throw new Error('未获取到章节列表')

    const limit = maxChapters > 0 ? maxChapters : chapterList.length
    const toFetch = chapterList.slice(0, limit)

    const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50)
    const filename = encodeURIComponent(`${safeTitle}_${bookId}.txt`)

    // 用并发 scraper 下载（5 章并发，速度提升约 5 倍）
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.write(`【${safeTitle}】\n下载来源：番茄小说\nBook ID：${bookId}\n总章节：${chapterList.length}  本次下载：${limit} 章\n${'='.repeat(50)}\n\n`)

    // 边爬边写，避免长时间无数据导致超时
    await fanqieScraper.getChapterContents(bookId, toFetch, limit, (c) => {
      try {
        res.write(`第${c.chapter_number}章 ${c.title || ''}\n${'='.repeat(30)}\n${c.content}\n\n`)
      } catch (e) {
        // 连接可能已断开
      }
    })

    res.end()
  } catch (error) {
    console.error('番茄下载失败:', error)
    // 如果 header 已发，不能再 json 响应
    try { res.end() } catch {}
  }
})

// ---- 从番茄小说导入并蒸馏（放在 /:id 前面） ----
router.post('/fanqie-import', auth, adminOnly, async (req, res) => {
  try {
    let { bookId, gender, mainCategory, subCategory, tags, novelType } = req.body
    if (!bookId) return res.status(400).json({ message: '请输入番茄小说 Book ID' })

    // 先获取书名、章节列表和分类标签
    const { title: rawTitle, chapters } = await fanqieScraper.getBookInfo(bookId)
    if (chapters.length === 0) throw new Error('未获取到章节列表')

    // 自动获取真实书名
    let realTitle = rawTitle
    try {
      const meta = await fanqieScraper.getChapterMeta(chapters[0]?.item_id)
      if (meta.bookName) realTitle = meta.bookName
    } catch {}

    // 如果未传 mainCategory，从 HTML 页面自动检测
    if (!mainCategory) {
      try {
        const labels = await fanqieScraper.getBookCategory(bookId)
        if (labels.length > 0) {
          const typeData = require('../config/novelTypeData')
          const allCats = [...typeData.male, ...typeData.female]
          // 尝试匹配已有类型
          const matched = allCats.find(c => c.name === labels[0] || c.name.includes(labels[0]) || labels[0].includes(c.name))
          if (matched) {
            mainCategory = matched.name
            gender = typeData.male.includes(matched) ? 'male' : 'female'
          } else {
            // 类型不存在，自动加入系统
            mainCategory = labels[0]
            gender = gender || 'male'
            subCategory = subCategory || ''
            // 将新类型加入 novelTypeData.male
            if (!allCats.find(c => c.name === labels[0])) {
              typeData.male.push({ name: labels[0], icon: '📄', children: [] })
              typeData.commonTags = typeData.commonTags || []
              labels.slice(1).forEach(l => { if (!typeData.commonTags.includes(l)) typeData.commonTags.push(l) })
              try { require('fs').writeFileSync(require('path').join(__dirname, '../config/novelTypeData.js'),
                'const novelTypeData = ' + JSON.stringify(typeData, null, 2) + '\n\nmodule.exports = novelTypeData\n') } catch {}
            }
          }
        }
      } catch {}
    }

    if (!mainCategory) return res.status(400).json({ message: '无法自动检测小说类型，请手动选择' })

    // 根据 mainCategory 自动推断 gender（如果用户未明确指定）
    if (novelType === 'lightnovel') {
      gender = 'unisex';  // 轻小说不分男频/女频
    } else if (!gender || gender === 'male') {
      // 检查是否为女频分类
      try {
        const typeData = require('../config/novelTypeData');
        const isFemale = (typeData.female || []).some(c => c.name === mainCategory);
        if (isFemale) gender = 'female';
      } catch {}
    }

    // 去重检测：同书名 + 同分类视为重复
    const existing = await ReferenceNovel.findOne({ title: realTitle, mainCategory })
    if (existing) {
      return res.status(409).json({
        message: `《${realTitle}》已存在于蒸馏库中，如需重新蒸馏请先删除旧记录`,
        existingId: existing._id,
      })
    }

    // 创建参考小说记录（异步后台处理）
    const doc = await ReferenceNovel.create({
      userId: req.userId,
      title: realTitle,
      novelType: novelType || 'normal',
      gender: gender || 'male',
      mainCategory, subCategory: subCategory || '',
      tags: tags || [],
      styleProfile: '风格提取中...',
      originalFileName: `fanqie_${bookId}.txt`,
      originalLength: 0,
      aiProcessed: false,
    })

    res.json({
      message: `✅ 《${realTitle}》正在后台提取风格中（共 ${chapters.length} 章），请稍后查看参考库`,
      novel: doc,
      status: 'processing',
    })

    // ---- 后台异步下载+蒸馏 ----
    let contents = []
    let downloadAttempted = false
    try {
      contents = await fanqieScraper.getChapterContents(bookId, chapters, chapters.length)
      downloadAttempted = true
    } catch (e) {
      console.error('[fanqie-import] 下载失败:', e.message)
    }

    const totalChapters = chapters.length
    const downloadedChapters = contents.length
    const failedChapters = totalChapters - downloadedChapters
    const avgChapterLength = downloadedChapters > 0
      ? Math.round(contents.reduce((s, c) => s + (c.content?.length || 0), 0) / downloadedChapters)
      : 0

    if (contents.length === 0) {
      await ReferenceNovel.findByIdAndUpdate(doc._id, {
        $set: {
          styleProfile: '❌ 下载失败，检查 Cookie',
          aiProcessed: false,
          downloadStats: { totalChapters, downloadedChapters: 0, failedChapters: totalChapters, avgChapterLength: 0 },
        },
      })
      return
    }

    // 检查下载成功率，如果过低则记录警告
    const successRate = (downloadedChapters / totalChapters * 100).toFixed(1)
    if (successRate < 50) {
      console.warn(`[fanqie-import] 《${realTitle}》下载成功率仅 ${successRate}%（${downloadedChapters}/${totalChapters}），内容可能不完整`)
    }

    const fullText = contents.map(c => `第${c.chapter_number}章 ${c.title || ''}\n${c.content}`).join('\n\n')
    if (fullText.length < 100) {
      await ReferenceNovel.findByIdAndUpdate(doc._id, {
        $set: {
          styleProfile: '❌ 内容太少',
          aiProcessed: false,
          originalLength: fullText.length,
          downloadStats: { totalChapters, downloadedChapters, failedChapters, avgChapterLength },
        },
      })
      return
    }

    let styleProfile = '', keyExcerpts = [], writingCharacteristics = '',
        vocabularyBank = [], chapterStructure = '', qualityScore = 0
    try {
      const raw = await extractStyleProfile(fullText, mainCategory, subCategory, novelType || 'normal')
      const parsed = parseStyleOutput(raw)
      styleProfile = parsed.styleProfile; keyExcerpts = parsed.keyExcerpts
      writingCharacteristics = parsed.writingCharacteristics; vocabularyBank = parsed.vocabularyBank
      chapterStructure = parsed.chapterStructure; qualityScore = parsed.qualityScore
    } catch (e) { console.error('[fanqie-import] AI 风格提取失败:', e.message) }

    await ReferenceNovel.findByIdAndUpdate(doc._id, { $set: {
      originalLength: fullText.length, originalFileName: `fanqie_${bookId}.txt`,
      styleProfile: styleProfile || '风格提取暂不可用',
      keyExcerpts, writingCharacteristics, vocabularyBank, chapterStructure, qualityScore,
      aiProcessed: !!styleProfile, title: realTitle,
      downloadStats: { totalChapters, downloadedChapters, failedChapters, avgChapterLength },
    }})
    console.log(`[fanqie-import] 《${realTitle}》蒸馏完成，${contents.length}/${chapters.length} 章，成功率 ${successRate}%`)
  } catch (error) {
    console.error('番茄导入失败:', error)
    if (!res.headersSent) res.status(500).json({ message: '导入失败: ' + error.message })
  }
})

// 按 novelType 筛选参考小说列表（用于轻小说生成匹配，所有登录用户可访问）
router.get('/list-by-type', auth, async (req, res) => {
  try {
    const { type } = req.query
    const filter = type ? { novelType: type } : {}
    const novels = await ReferenceNovel.find(filter)
      .select('title novelType mainCategory subCategory styleProfile qualityScore aiProcessed')
      .sort({ qualityScore: -1, createdAt: -1 })
      .limit(50)
    res.json(novels)
  } catch (error) {
    res.status(500).json({ message: '获取列表失败', error: error.message })
  }
})

// 获取参考小说详情（含精选片段）
router.get('/:id', auth, adminOnly, async (req, res) => {
  try {
    const novel = await ReferenceNovel.findOne({ _id: req.params.id, userId: req.userId })
    if (!novel) return res.status(404).json({ message: '参考小说不存在' })
    res.json(novel)
  } catch (error) {
    res.status(500).json({ message: '获取详情失败', error: error.message })
  }
})

// 删除参考小说
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const result = await ReferenceNovel.deleteOne({ _id: req.params.id, userId: req.userId })
    if (result.deletedCount === 0) return res.status(404).json({ message: '参考小说不存在' })
    res.json({ message: '已删除' })
  } catch (error) {
    res.status(500).json({ message: '删除失败', error: error.message })
  }
})

module.exports = router
