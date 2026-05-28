/**
 * Playwright 浏览器代理服务 — 从 reader 页面 JS state 提取内容 + 字体解码
 * 注意：番茄小说 API 现已要求 a_bogus 签名，无法直接 fetch。
 *       改用导航到 reader 页后从 window.__NUXT__ 或内嵌 state 提取数据。
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

let browser = null, context = null, mainPage = null, charMapping = null, mappingPromise = null
let browserInitTime = 0
const BROWSER_TTL = 10 * 60 * 1000
const PAGE_RECREATE_COOLDOWN = 2000

async function getBrowser() {
  const now = Date.now()
  if (browser) {
    try {
      if (browser.isConnected() && (now - browserInitTime) < BROWSER_TTL) return browser
      await browser.close().catch(() => {})
    } catch { /* 已断开 */ }
  }
  const { chromium } = require('playwright')
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  browserInitTime = Date.now()
  return browser
}

async function ensurePage(cs) {
  if (mainPage && !mainPage.isClosed()) {
    try {
      await mainPage.evaluate(() => 1)
      return mainPage
    } catch { /* 页面不可用 */ }
  }
  const br = await getBrowser()
  if (context) { try { await context.close().catch(() => {}) } catch {} }
  context = await br.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    locale: 'zh-CN',
    viewport: { width: 1920, height: 1080 },
  })
  if (cs) {
    const cookies = cs.split(';').map(p => {
      const [n, ...v] = p.trim().split('=')
      if (!n) return null
      return { name: n.trim(), value: v.join('=').trim(), domain: '.fanqienovel.com', path: '/' }
    }).filter(Boolean)
    if (cookies.length > 0) try { await context.addCookies(cookies) } catch {}
  }
  mainPage = await context.newPage()
  mainPage.setDefaultNavigationTimeout(30000)
  mainPage.setDefaultTimeout(30000)
  await mainPage.goto('https://fanqienovel.com/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
  await mainPage.waitForTimeout(2000)
  return mainPage
}

/**
 * 从 reader 页面提取章节内容 + 字体映射
 * 导航到 reader 页后等待 SPA 调用 API（自动带 a_bogus），用 waitForResponse 拦截
 */
async function fetchChapterContent(itemId, cs) {
  if (!cs) throw new Error('no cookie')
  const page = await ensurePage(cs)
  let rawHtml = ''

  // 导航到 reader 页面
  const navPromise = page.goto('https://fanqienovel.com/reader/' + itemId, {
    waitUntil: 'domcontentloaded', timeout: 20000
  }).catch(() => {})

  // 等待 SPA 调用章节 API（自动携带 a_bogus）
  let apiResponse = null
  try {
    const resp = await page.waitForResponse(r => r.url().includes('/api/reader/full') && r.url().includes(itemId), { timeout: 25000 })
    apiResponse = await resp.json()
  } catch { /* API 拦截超时，走兜底 */ }

  await navPromise
  await page.waitForTimeout(1500)

  // 从 API 响应提取
  let content = ''
  if (apiResponse) {
    content = apiResponse?.data?.chapterData?.content || apiResponse?.chapterData?.content || apiResponse?.content || ''
  }

  // 兜底：从 page.content() 正则提取
  if (!content || content.length < 50) {
    rawHtml = await page.content()
    const m = rawHtml.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (m) {
      let c = m[1].replace(/\\u003C/g, '<').replace(/\\u003E/g, '>').replace(/\\n/g, '\n')
      c = c.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      if (c.length > 50) content = c
    }
  }

  if (!content || content.length < 50) throw new Error('未提取到章节内容')

  // 构建字体映射
  if (!charMapping) {
    try { await ensureMapping(itemId, cs, rawHtml || (await page.content())) } catch (e) {
      console.error('[pp] 字体映射失败:', e.message)
    }
  }

  // 解码 PUA 字符
  let text = content.replace(/<[^>]+>/g, '').trim()
  if (!text || text.length < 10) return null

  if (charMapping && Object.keys(charMapping).length > 0) {
    const { decodeText } = require('./fontDecoder')
    const decoded = decodeText(text, charMapping)
    if (decoded && decoded.length > 10) text = decoded
    console.log('[pp] 解码完成:', text.substring(0, 30) + '...')
  } else {
    console.warn('[pp] 无字体映射，返回原始 PUA 文本')
  }
  return text
}

/**
 * 通用浏览器 API 调用 — 先尝试 fetch，失败则从页面 HTML 提取
 */
async function fetchViaBrowser(action, params, cs) {
  if (!cs) throw new Error('no cookie')
  const page = await ensurePage(cs)

  if (action === 'chapter') {
    return { chapterData: { content: await fetchChapterContent(params.itemId, cs) } }
  }

  // 目录 — 先尝试 API fetch
  const url = `https://fanqienovel.com/api/reader/directory/detail?bookId=${params.bookId}`
  try {
    const r = await page.evaluate(async (u) => {
      try {
        const a = await fetch(u, {
          credentials: 'include',
          headers: { 'accept': 'application/json, text/plain, */*', 'referer': 'https://fanqienovel.com/' }
        })
        if (!a.ok) throw Error('HTTP ' + a.status)
        const b = await a.json()
        return { ok: true, data: b.data || b }
      } catch (e) {
        return { ok: false, error: e.message }
      }
    }, url)
    if (r.ok && r.data?.chapterListWithVolume) return r.data
  } catch {}

  // API 失败，从 reader 页 HTML 提取目录
  console.warn('[pp] 目录 API 失败，从页面 HTML 提取')
  await page.goto('https://fanqienovel.com/reader/' + params.bookId, {
    waitUntil: 'domcontentloaded', timeout: 20000
  }).catch(() => {})
  await page.waitForTimeout(3000)
  const html = await page.content()
  const m = html.match(/"chapterListWithVolume"\s*:\s*(\[[\s\S]*?\])\s*,\s*"chapterTotal"/)
  if (m) {
    try {
      return { chapterListWithVolume: JSON.parse(m[1].replace(/\\u002F/g, '/')) }
    } catch {}
  }
  throw new Error('无法获取目录数据')
}

/**
 * 从 reader 页面 HTML 构建字体映射
 * @param {string} itemId - 章节 ID
 * @param {string} cs - cookie
 * @param {string} [prefetchedHtml] - 已预取的 HTML
 */
async function ensureMapping(itemId, cs, prefetchedHtml) {
  if (charMapping && mappingBuiltFor) {
    const diff = Math.abs(parseInt(itemId) - parseInt(mappingBuiltFor))
    if (diff < 200) return charMapping
  }
  if (mappingPromise && !prefetchedHtml) return mappingPromise

  mappingPromise = (async () => {
    let html = prefetchedHtml || ''

    // 如果没有预取 HTML，导航到 reader 页
    if (!html) {
      const page = await ensurePage(cs)
      await page.goto('https://fanqienovel.com/reader/' + itemId, {
        waitUntil: 'domcontentloaded', timeout: 30000
      }).catch(() => {})
      await page.waitForTimeout(3000)
      html = await page.content()
    }

    // 从页面 styleSheets 提取字体 URL（SPA 动态加载的 CSS 才有）
    let fontUrl = ''
    if (!prefetchedHtml) {
      // 使用当前页面（已导航到 reader 页）
      try {
        const page = mainPage || await ensurePage(cs)
        fontUrl = await page.evaluate(() => {
          for (const s of document.styleSheets) {
            try {
              for (const r of s.cssRules || []) {
                const m = (r.cssText || '').match(/url\(\s*["']?([^"'\s)]+woff2[^"'\s)]*)/i)
                if (m) return m[1].replace(/^["']|["']$/g, '')
              }
            } catch {}
          }
          return null
        })
      } catch {}
    }

    // 兜底：从 HTML 中正则提取
    if (!fontUrl) {
      const woffMatches = html.match(/https?:[^"'\\)\\s]+bytetos[^"'\\)\\s]*woff2/g)
      if (woffMatches && woffMatches.length > 0) {
        fontUrl = woffMatches[0].replace(/\\u002F/g, '/')
      }
    }

    if (!fontUrl) {
      console.warn('[ensureMapping] 无字体 URL')
      charMapping = {}
      mappingBuiltFor = itemId
      return charMapping
    }

    console.log('[ensureMapping] 字体 URL:', fontUrl.replace(/\?.*$/, ''))

    // 下载字体
    let fontData = null
    try {
      fontData = await new Promise((resolve, reject) => {
        const mod = fontUrl.startsWith('https:') ? https : http
        mod.get(fontUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fanqienovel.com/' }
        }, r => {
          const c = []; r.on('data', d => c.push(d))
          r.on('end', () => resolve(Buffer.concat(c)))
          r.on('error', reject)
        }).on('error', reject)
        setTimeout(() => reject(new Error('font download timeout')), 10000)
      })
    } catch (e) {
      console.error('[ensureMapping] 字体下载失败:', e.message)
      charMapping = {}; mappingBuiltFor = itemId
      return charMapping
    }

    if (!fontData || fontData.length < 100) {
      charMapping = {}; mappingBuiltFor = itemId
      return charMapping
    }

    console.log('[ensureMapping] 字体大小:', fontData.length)

    // 交叉验证：用已知 font_mapping.json + 当前字体 glyph 表筛选
    try {
      const fontkit = require('fontkit')
      const font = fontkit.create(fontData)
      const knownMapping = require('./font_mapping.json')
      const map = {}
      let matchCount = 0
      for (const [puaChar, chineseChar] of Object.entries(knownMapping)) {
        const code = puaChar.charCodeAt(0)
        const glyph = font.glyphForCodePoint(code)
        if (glyph) {
          map[String.fromCodePoint(code)] = chineseChar
          matchCount++
        }
      }
      charMapping = map
      console.log(`[ensureMapping] 交叉验证: ${matchCount}/${Object.keys(knownMapping).length} 个字符匹配`)
    } catch (e) {
      console.error('[ensureMapping] 字体解析失败:', e.message)
    }
    mappingBuiltFor = itemId
    return charMapping
  })()

  return mappingPromise
}

function resetFontCache() { charMapping = null; mappingPromise = null }

async function closeBrowser() {
  try { if (mainPage && !mainPage.isClosed()) await mainPage.close() } catch {}
  try { if (context) await context.close() } catch {}
  try { if (browser) await browser.close() } catch {}
  context = null; browser = null; mainPage = null; charMapping = null; mappingPromise = null
}

process.on('exit', () => { if (browser) { try { browser.process()?.kill(); } catch {} } })
process.on('SIGINT', () => { closeBrowser(); process.exit() })
process.on('SIGTERM', () => { closeBrowser(); process.exit() })

function getCharMapping() { return charMapping }

module.exports = { fetchViaBrowser, fetchChapterContent, ensureMapping, resetFontCache, getCharMapping, closeBrowser }
