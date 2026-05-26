const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const ReferenceNovel = require('../models/ReferenceNovel')
const { streamGenerate, resolveApiConfig, countTokens } = require('../services/aiService')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const fanqieScraper = require('../services/fanqieScraper')
const fanqieAuth = require('../services/fanqieAuth')

// admin 权限校验
const adminOnly = async (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: '仅管理员可访问' })
  }
  next()
}

// multer 内存存储（不上盘）
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }) // 10MB

// ---- AI 提取风格配置 ----
async function extractStyleProfile(fileContent, mainCategory, subCategory, novelType = 'normal') {
  const isLightNovel = novelType === 'lightnovel'
  const typeLabel = isLightNovel ? '轻小说（日式ACGN风格）' : '小说'

  const prompt = isLightNovel
    ? `你是一位专业的轻小说分析专家。请分析以下轻小说的内容，提取它的风格特征。

轻小说类型：${mainCategory}${subCategory ? ' - ' + subCategory : ''}

请按以下格式输出（纯文本，不要用Markdown）：

【风格描述】
用 800-1000 字详细描述这部轻小说的整体风格。从以下几个维度展开：
1. 叙事视角：第一人称还是第三人称，主角视角的贴近程度（内心独白的频率和风格）
2. 角色塑造：角色萌属性（傲娇/天然呆/元气/冷酷等）的表现方式，角色间互动（吐槽/暧昧/羁绊）
3. 对话风格：对话占比、对话中是否包含角色个性（口头禅、语气词、称呼方式）
4. 描写风格：场景描写是否有动画感（画面感强，类似分镜）、萌系动作描写（脸红/慌张/遮嘴笑等）
5. 情感基调：整体氛围（温馨/热血/治愈/伤感）、情感表达是直白还是含蓄
6. 叙事节奏：日常/战斗/剧情的穿插比例，节奏快慢变化
7. 用词倾向：是否使用拟声词、语气词（啊、呢、哟）、称呼后缀（さん、君、酱）

【精选片段】
从原文中挑选 8-10 个最能体现该轻小说风格的片段，每个片段不超过 300 字，用 【片段1】 【片段2】 ... 【片段10】 标记。要求覆盖以下类型（尽可能多覆盖）：
- 初次登场/自我介绍
- 角色间典型对话（含吐槽/斗嘴）
- 萌系互动场景
- 战斗/异能使用场景
- 情感高潮/告白场景
- 日常温馨场景
- 搞笑/欢乐桥段
- 世界观/设定说明
- 章末悬念/钩子
- 内心独白段落

【写作特点】
用 200-300 字从写作技法角度分析这部轻小说：句式特点、节奏把控、角色对话设计、伏笔与回收、段落布局（短段落快速切换）、情绪调动方式。

【特色词汇】
列出这部轻小说中最有辨识度的 15-25 个特色词汇/角色用语/设定术语，用逗号分隔。

【章节结构】
用 80-150 字概括该轻小说的章节结构规律，包括每章平均字数、开章方式（日常开头/直接进入事件）、结尾方式（悬念/温馨收尾/超展开）。

【质量评分】
根据该轻小说内容与所选分类（${mainCategory}${subCategory ? ' - ' + subCategory : ''}）的匹配程度，给出一个 1-100 的整数分数。只输出数字，不要额外文字。

以下是轻小说内容（只截取前半部分供分析）：

${fileContent.slice(0, 20000)}`

    : `你是一位专业的小说分析专家。请分析以下小说内容，提取它的风格特征。

小说类型：${mainCategory}${subCategory ? ' - ' + subCategory : ''}

请按以下格式输出（纯文本，不要用Markdown）：

【风格描述】
用 800-1000 字详细描述这部小说的整体风格。从以下几个维度展开：
1. 叙事节奏：整体快慢风格、张弛节奏变化规律、高潮分布密度
2. 对话比例与风格：对话/叙述比例、对话是否简洁有力还是长篇对白、对话特色
3. 描写风格：场景描写是简笔勾勒还是细密铺陈、人物外貌/心理/动作描写的侧重
4. 情感基调：整体氛围（压抑/热血/轻松/沉重）、情绪变化轨迹
5. 开篇风格：如何快速引入世界观/人物/冲突
6. 用词倾向：文言/白话、用词华丽或朴实、句子长短偏好
7. 爽点/爽感设计：打脸节奏、升级反馈、情绪释放方式

【精选片段】
从原文中挑选 8-10 个最能体现该小说风格的片段，每个片段不超过 300 字，用 【片段1】 【片段2】 ... 【片段10】 标记。要求覆盖以下类型（尽可能多覆盖）：
- 开篇引入方式
- 典型对话场景
- 高潮/爽点/打脸写法
- 章末钩子写法
- 情绪渲染段落
- 世界观展现场景
- 角色情感刻画
- 战斗/冲突场景描写
- 悬念布置方式
- 日常过渡段落

【写作特点】
用 200-300 字从写作技法角度分析这部小说：句式变化规律（长短句交替、排比、设问等）、比喻/意象使用的特点、悬念设置技巧、节奏控制手段、情绪调动方式、如果存在多线叙事则分析其交叉技巧。

【特色词汇】
列出这部小说中最有辨识度的 15-25 个特色词汇/术语，用逗号分隔。

【章节结构】
用 80-150 字概括该小说的章节结构规律，包括每章平均字数、开章方式、结尾方式、章节间过渡技巧。

【质量评分】
根据该小说内容与所选分类（${mainCategory}${subCategory ? ' - ' + subCategory : ''}）的匹配程度，给出一个 1-100 的整数分数。只输出数字，不要额外文字。

以下是小说内容（只截取前半部分供分析）：

${fileContent.slice(0, 20000)}`

  const result = await streamGenerate(
    `你是一位专业的${typeLabel}分析专家，擅长提取文本风格特征。`,
    prompt, null, null,
    resolveApiConfig(null, 'writing')
  )
  return result.content || ''
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

// 上传参考小说（TXT + 分类信息）—— 仅管理员
router.post('/upload', auth, adminOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: '请上传 .txt 文件' })
    const ext = path.extname(req.file.originalname).toLowerCase()
    if (ext !== '.txt') return res.status(400).json({ message: '仅支持 .txt 文件' })

    const { title, gender, mainCategory, subCategory, tags, novelType } = req.body
    if (!title || !gender || !mainCategory) {
      return res.status(400).json({ message: '请填写小说名称和分类' })
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
    try {
      contents = await fanqieScraper.getChapterContents(bookId, chapters, chapters.length)
    } catch (e) {
      console.error('[fanqie-import] 下载失败:', e.message)
    }

    if (contents.length === 0) {
      await ReferenceNovel.findByIdAndUpdate(doc._id, { $set: { styleProfile: '❌ 下载失败，检查 Cookie', aiProcessed: false } })
      return
    }

    const fullText = contents.map(c => `第${c.chapter_number}章 ${c.title || ''}\n${c.content}`).join('\n\n')
    if (fullText.length < 100) {
      await ReferenceNovel.findByIdAndUpdate(doc._id, { $set: { styleProfile: '❌ 内容太少', aiProcessed: false, originalLength: fullText.length } })
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
    }})
    console.log(`[fanqie-import] 《${realTitle}》蒸馏完成，${contents.length}/${chapters.length} 章`)
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
