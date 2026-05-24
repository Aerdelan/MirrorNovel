// 番茄小说抓取服务（使用 Node.js HTTP 直接请求，无需浏览器）
// 核心原理：直接请求 reader 页面 HTML，从 JSON 状态中提取内容
// 优点：绕过浏览器验证码，速度快，无需 Playwright
const { decodeText } = require('./fontDecoder')
const fanqieAuth = require('./fanqieAuth')
const playwrightProxy = require('./playwrightProxy')
const https = require('https')
const http = require('http')

const BOOK_PAGE = 'https://fanqienovel.com/page/'
const READER_PAGE = 'https://fanqienovel.com/reader/'

// 加载预构建的字体映射
let fontMapping = null
try {
  fontMapping = require('./font_mapping.json')
  console.log('字体映射已加载，', Object.keys(fontMapping).length, '个字符')
} catch (e) {}

/**
 * HTTP GET 请求
 */
function httpGet(url, cookie = '') {
  const u = new URL(url)
  const mod = u.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookie,
        'Referer': 'https://fanqienovel.com/',
      }
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve({ text: data, status: res.statusCode, setCookie: res.headers['set-cookie'] || '' }))
    }).on('error', reject)
  })
}

/**
 * 从 reader 页面 HTML 提取章节内容
 */
function extractContent(html) {
  // 寻找 "content":"..." 字段（JSON 中可能包含转义字符）
  const marker = '"content":"'
  const start = html.indexOf(marker)
  if (start < 0) return null

  let i = start + marker.length
  let raw = ''
  while (i < html.length) {
    const ch = html[i]
    if (ch === '\\' && html[i + 1] === '"') { raw += '"'; i += 2; continue }
    if (ch === '\\' && html[i + 1] === '\\') { raw += '\\'; i += 2; continue }
    if (ch === '\\' && html[i + 1] === 'n') { raw += '\n'; i += 2; continue }
    if (ch === '\\') { raw += html[i] + (html[i + 1] || ''); i += 2; continue }
    if (ch === '"') break
    raw += ch; i++
  }
  if (raw.length < 50) return null

  // 反转义 HTML 实体
  raw = raw.replace(/\\u003C/g, '<').replace(/\\u003E/g, '>').replace(/\\u002F/g, '/')
  raw = raw.replace(/\\u005C/g, '\\').replace(/\\n/g, '\n')

  // 去除 HTML 标签
  const text = raw.replace(/<[^>]+>/g, '').trim()
  return text.length > 50 ? text : null
}

/**
 * 获取书籍信息 + 章节列表（HTML 抓取方式）
 */
async function getBookInfoViaHTML(bookId) {
  const res = await httpGet(BOOK_PAGE + bookId)
  const html = res.text

  // 提取 chapterListWithVolume JS 变量
  let items = []
  const scriptMatch = html.match(/chapterListWithVolume\s*=\s*(\[[\s\S]*?\])\s*;/)
  if (scriptMatch) {
    try {
      const cleaned = scriptMatch[1].replace(/\\(['"])/g, '$1').replace(/\\([^'"])/g, '$1')
      items = JSON.parse(cleaned)
    } catch (e) {}
  }

  // 兜底：HTML 扫描 itemId
  if (items.length === 0) {
    const ids = html.match(/"itemId":"(\d+)"/g) || []
    const seen = new Set()
    items = ids.map(id => {
      const realId = id.match(/"itemId":"(\d+)"/)[1]
      if (seen.has(realId)) return null
      seen.add(realId)
      return { item_id: realId }
    }).filter(Boolean)
  }

  const titleMatch = html.match(/<title>([^<]+)/)
  const title = titleMatch ? titleMatch[1].replace(/[_-].*$/, '').trim() : ('番茄_' + bookId)

  items = items.map((ch, i) => ({
    item_id: ch.item_id || ch.itemId,
    chapter_number: ch.chapter_number || (i + 1),
    title: ch.title || '',
  }))

  return { title, chapters: items }
}

const CONCURRENCY = 10 // 并发数比 Playwright 版更大

/**
 * 批量获取章节内容（HTML 抓取方式）
 */
async function getChapterContentsViaHTML(bookId, chapters, maxChapters = 9999, onChapter = null) {
  const results = []
  const toFetch = chapters.slice(0, maxChapters)

  for (let start = 0; start < toFetch.length; start += CONCURRENCY) {
    const batch = toFetch.slice(start, start + CONCURRENCY)

    const batchResults = await Promise.all(batch.map(async (ch) => {
      const itemId = ch.item_id || ch.itemId
      if (!itemId) return null

      try {
        const res = await httpGet(READER_PAGE + itemId)
        const html = res.text

        // 从 HTML 提取内容
        let text = extractContent(html)

        if (text && text.length > 50) {
          const decoded = decodeText(text, fontMapping)
          return {
            item_id: itemId,
            chapter_number: ch.chapter_number || 0,
            title: ch.title || '',
            content: decoded,
          }
        }
      } catch (e) {
        console.error('章节', itemId, '失败:', e.message)
      }
      return null
    }))

    for (const r of batchResults) {
      if (r) {
        results.push(r)
        if (onChapter) onChapter(r)
      }
    }

    if (start + CONCURRENCY < toFetch.length) await new Promise(r => setTimeout(r, 200))
  }

  results.sort((a, b) => (a.item_id || '').localeCompare(b.item_id || ''))
  return results
}

// ============================================================
// API 方式获取（通过服务器端 Playwright 无头浏览器代理）
// 浏览器自动处理 a_bogus，不需要任何外部脚本
// ============================================================

/**
 * 通过浏览器代理获取单个章节完整内容
 */
async function getChapterContentViaAPI(itemId) {
  const cookie = fanqieAuth.getCookie()
  if (!cookie) throw new Error('未设置 cookie，请先在管理后台填入')

  // 使用 playwrightProxy 渲染 PUA 字体（复用同一个浏览器）
  const content = await playwrightProxy.fetchChapterContent(itemId, cookie)
  if (!content || content.length < 10) return null

  return content
}

/**
 * 通过浏览器代理获取书籍章节列表（目录）
 */
async function getBookInfoViaAPI(bookId) {
  const cookie = fanqieAuth.getCookie()
  if (!cookie) throw new Error('未设置 cookie')

  const data = await playwrightProxy.fetchViaBrowser('bookInfo', { bookId }, cookie)
  if (!data) throw new Error('目录数据为空')

  const rawChapters = data.chapterListWithVolume || []
  const chapterList = (Array.isArray(rawChapters) && rawChapters.length > 0 && Array.isArray(rawChapters[0])) ? rawChapters[0] : []
  if (chapterList.length === 0) throw new Error('目录数据中无章节列表')

  // 从书籍 HTML 页面提取真实书名（API 返回的字段没有 bookName）
  let title = '番茄_' + bookId
  try {
    const page = await httpGet(BOOK_PAGE + bookId)
    const m = page.text.match(/<title>([^<]+)/)
    if (m) title = m[1].replace(/[_-].*$/, '').trim()
  } catch {}

  const chapters = chapterList.map((ch, i) => ({
    item_id: ch.item_id || ch.itemId,
    chapter_number: parseInt(ch.realChapterOrder) || ch.chapter_number || ch.chapterNumber || (i + 1),
    title: ch.title || '',
  }))

  return { title, chapters }
}

/**
 * 批量获取章节内容（纯 API 方式）
 * 先批量调 API 拿原始 HTML → 再统一构建字体映射 → 批量解码
 */
async function getChapterContentsViaAPI(bookId, chapters, maxChapters = 9999, onChapter = null) {
  const toFetch = chapters.slice(0, maxChapters)
  const API_CONCURRENCY = 3

  // 第一步：批量下载原始内容（PUA 编码的 HTML），不构建字体映射
  const rawResults = []
  for (let start = 0; start < toFetch.length; start += API_CONCURRENCY) {
    const batch = toFetch.slice(start, start + API_CONCURRENCY)
    const batchResults = await Promise.all(batch.map(async (ch) => {
      const itemId = ch.item_id || ch.itemId
      if (!itemId) return null
      try {
        const cookie = fanqieAuth.getCookie()
        const data = await playwrightProxy.fetchViaBrowser('chapter', { itemId }, cookie)
        const rawHtml = data?.chapterData?.content || data?.content || ''
        if (rawHtml && rawHtml.length > 50) {
          return { item_id: itemId, chapter_number: ch.chapter_number || 0, title: ch.title || '', content: rawHtml }
        }
      } catch (e) { console.error('[API] 章节', itemId, '失败:', e.message) }
      return null
    }))
    for (const r of batchResults) { if (r) rawResults.push(r) }
  }

  if (rawResults.length === 0) throw new Error('API 方式未获取到任何章节内容')

  // 第二步：只对第一个章节构建字体映射
  playwrightProxy.resetFontCache()
  const firstId = rawResults[0]?.item_id
  if (firstId) {
    try { await playwrightProxy.ensureMapping(firstId, fanqieAuth.getCookie()) } catch (e) { console.warn('[映射] 字体映射失败:', e.message) }
  }

  // 第三步：批量解码 PUA 字符
  const { decodeText } = require('./fontDecoder')
  const mapping = playwrightProxy.getCharMapping()
  const results = []
  for (const r of rawResults) {
    let text = r.content.replace(/<[^>]+>/g, '').trim()
    if (text && mapping && Object.keys(mapping).length > 0) {
      const decoded = decodeText(text, mapping)
      if (decoded && decoded.length > 10) text = decoded
    }
    if (text && text.length > 10) {
      const result = { item_id: r.item_id, chapter_number: r.chapter_number, title: r.title, content: text }
      results.push(result)
      if (onChapter) onChapter(result)
    }
  }

  if (results.length === 0) throw new Error('API 方式未获取到任何章节内容')
  return results
}

// ============================================================
// 导出 — 自动选择 API 或 HTML 方式
// ============================================================

/**
 * 获取书籍信息（优先 API，失败回退 HTML）
 */
async function getBookInfo(bookId) {
  if (fanqieAuth.isReady()) {
    try {
      return await getBookInfoViaAPI(bookId)
    } catch (e) {
      console.warn('[fanqieScraper] getBookInfo API 失败，回退到 HTML:', e.message)
    }
  }
  return getBookInfoViaHTML(bookId)
}

/**
 * 批量获取章节内容（优先 API，失败回退 HTML）
 */
async function getChapterContents(bookId, chapters, maxChapters = 9999, onChapter = null) {
  if (fanqieAuth.isReady()) {
    try {
      return await getChapterContentsViaAPI(bookId, chapters, maxChapters, onChapter)
    } catch (e) {
      console.warn('[fanqieScraper] API 方式失败，回退到 HTML 抓取:', e.message)
    }
  }
  return getChapterContentsViaHTML(bookId, chapters, maxChapters, onChapter)
}

/**
 * 快速获取章节元数据（书名、类型等，不下载字体不解码）
 */
async function getChapterMeta(itemId) {
  const cookie = fanqieAuth.getCookie()
  if (!cookie) return {}
  try {
    const data = await playwrightProxy.fetchViaBrowser('chapter', { itemId }, cookie)
    const cd = data?.chapterData || {}
    return {
      bookName: cd.bookName || '',
      genre: cd.genre || '',
      author: cd.author || '',
    }
  } catch { return {} }
}

/**
 * 从书籍页面 HTML 提取分类标签（都市脑洞、系统、穿越等）
 */
async function getBookCategory(bookId) {
  try {
    const res = await httpGet(BOOK_PAGE + bookId)
    const html = res.text
    const matches = [...html.matchAll(/info-label-grey\">([^<]+)</g)]
    const labels = matches.map(m => m[1])
    return labels
  } catch { return [] }
}

module.exports = { getBookInfo, getChapterContents, getBookInfoViaAPI, getChapterContentViaAPI, getChapterContentsViaAPI, getChapterMeta, getBookCategory }
