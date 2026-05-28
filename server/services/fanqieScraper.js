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
 * HTTP GET 请求（带超时）
 */
function httpGet(url, cookie = '', timeout = 15000) {
  const u = new URL(url)
  const mod = u.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookie,
        'Referer': 'https://fanqienovel.com/',
      }
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve({ text: data, status: res.statusCode, setCookie: res.headers['set-cookie'] || '' }))
    })
    req.on('error', reject)
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error(`HTTP timeout ${timeout}ms: ${url}`)) })
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
    chapter_number: ch.realChapterOrder || ch.chapter_number || ch.chapterNumber || (i + 1),
    title: ch.title || '',
  }))
  // 按章节序号排序
  items.sort((a, b) => a.chapter_number - b.chapter_number)

  return { title, chapters: items }
}

const CONCURRENCY = 12 // HTML 抓取并发数
const API_CONCURRENCY = 5 // API 方式并发数
const CHAPTER_TIMEOUT = 25000 // 单章超时（毫秒）
const MAX_RETRIES = 2 // 失败重试次数

/**
 * 带重试和超时的通用抓取包装
 */
async function fetchWithRetry(fn, label, options = {}) {
  const { maxRetries = MAX_RETRIES, baseDelay = 1500, timeout = CHAPTER_TIMEOUT } = options
  let lastError
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout ${timeout}ms`)), timeout)),
      ])
      if (result) return result
      throw new Error('empty result')
    } catch (e) {
      lastError = e
      if (i < maxRetries) {
        console.warn(`[retry] ${label} 第${i+1}/${maxRetries+1}次失败: ${e.message}，${baseDelay * (i + 1)}ms 后重试`)
        await new Promise(r => setTimeout(r, baseDelay * (i + 1)))
      }
    }
  }
  throw lastError
}

/**
 * HTML 方式：从 reader 页面提取章节内容（增强版）
 * 支持多种 content 出现模式，提高提取成功率
 */
function extractContentEnhanced(html) {
  // 尝试方法1: 标准 "content":"..."（转义 JSON）
  let text = extractContent(html)
  if (text && text.length > 50) return text

  // 尝试方法2: 搜索 data.content 或 content = "..."
  const patterns = [
    /content\s*[:=]\s*"((?:[^"\\]|\\.)*)"/,
    /"content"\s*:\s*"((?:[^"\\]|\\.)*)"/,
    /chapterData\.content\s*=\s*"((?:[^"\\]|\\.)*)"/,
  ]
  for (const pat of patterns) {
    const m = html.match(pat)
    if (m) {
      let raw = m[1]
        .replace(/\\u003C/g, '<').replace(/\\u003E/g, '>').replace(/\\u002F/g, '/')
        .replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      const clean = raw.replace(/<[^>]+>/g, '').trim()
      if (clean.length > 50) return clean
    }
  }

  // 尝试方法3: 直接找大量中文文本区域
  const bodyStart = html.indexOf('<div class="page-text"')
  if (bodyStart >= 0) {
    let end = html.indexOf('</div>', bodyStart)
    if (end < 0) end = bodyStart + 30000
    const section = html.substring(bodyStart, end)
      .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    if (section.length > 50) return section
  }

  return null
}

/**
 * 批量获取章节内容（HTML 抓取方式）— 带重试
 */
async function getChapterContentsViaHTML(bookId, chapters, maxChapters = 9999, onChapter = null) {
  const results = []
  const toFetch = chapters.slice(0, maxChapters)
  let failCount = 0

  for (let start = 0; start < toFetch.length; start += CONCURRENCY) {
    const batch = toFetch.slice(start, start + CONCURRENCY)

    const batchResults = await Promise.all(batch.map(async (ch) => {
      const itemId = ch.item_id || ch.itemId
      if (!itemId) return { error: 'no itemId' }

      try {
        const text = await fetchWithRetry(async () => {
          const res = await httpGet(READER_PAGE + itemId)
          const html = res.text
          const content = extractContentEnhanced(html)
          if (!content || content.length <= 50) return null
          const decoded = decodeText(content, fontMapping)
          return decoded && decoded.length > 50 ? decoded : content
        }, `HTML 章节 ${itemId}`, { maxRetries: 1, timeout: 20000 })

        if (text) {
          return {
            item_id: itemId,
            chapter_number: ch.chapter_number || 0,
            title: ch.title || '',
            content: text,
          }
        }
        return { error: 'empty content after retry' }
      } catch (e) {
        return { error: e.message }
      }
    }))

    for (const r of batchResults) {
      if (r && r.content) {
        results.push(r)
        if (onChapter) onChapter(r)
      } else if (r && r.error) {
        failCount++
      }
    }

    if (start + CONCURRENCY < toFetch.length) await new Promise(r => setTimeout(r, 300))
  }

  results.sort((a, b) => a.chapter_number - b.chapter_number)
  if (failCount > 0) console.warn(`[HTML] 共 ${toFetch.length} 章，成功 ${results.length}，失败 ${failCount}`)
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
  // chapterListWithVolume 是二维数组 [卷1章节, 卷2章节, ...]，需要展开
  const chapterList = (Array.isArray(rawChapters) && rawChapters.length > 0)
    ? [].concat(...rawChapters)
    : []
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
 * 批量获取章节内容（通过 reader 页面提取 + 自动字体解码）
 * playwrightProxy.fetchChapterContent 已内置字体映射和解码
 */
async function getChapterContentsViaAPI(bookId, chapters, maxChapters = 9999, onChapter = null) {
  const toFetch = chapters.slice(0, maxChapters)
  let failCount = 0
  const results = []

  for (let start = 0; start < toFetch.length; start += API_CONCURRENCY) {
    const batch = toFetch.slice(start, start + API_CONCURRENCY)
    const batchResults = await Promise.all(batch.map(async (ch) => {
      const itemId = ch.item_id || ch.itemId
      if (!itemId) return null
      try {
        const text = await fetchWithRetry(async () => {
          const cookie = fanqieAuth.getCookie()
          const decoded = await playwrightProxy.fetchChapterContent(itemId, cookie)
          return decoded && decoded.length > 50 ? decoded : null
        }, `章节 ${itemId}`, { maxRetries: MAX_RETRIES, timeout: 45000 })
        if (text) {
          const result = { item_id: itemId, chapter_number: ch.chapter_number || 0, title: ch.title || '', content: text }
          if (onChapter) onChapter(result)
          return result
        }
      } catch (e) {
        failCount++
        console.warn(`[API] 章节 ${itemId} 失败:`, e.message)
      }
      return null
    }))
    for (const r of batchResults) { if (r) results.push(r) }
    if (start + API_CONCURRENCY < toFetch.length) await new Promise(r => setTimeout(r, 500))
  }

  results.sort((a, b) => a.chapter_number - b.chapter_number)
  if (results.length === 0) throw new Error('未获取到任何章节内容')
  console.log(`[API] 共 ${toFetch.length} 章，成功 ${results.length}，失败 ${failCount}`)
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
