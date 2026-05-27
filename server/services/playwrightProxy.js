/**
 * Playwright 浏览器代理服务
 */
const fs = require('fs')
const path = require('path')
const https = require('https')

let browser = null, context = null, mainPage = null, charMapping = null, mappingPromise = null
let browserInitTime = 0
const BROWSER_TTL = 10 * 60 * 1000 // 浏览器实例最长存活 10 分钟
const PAGE_RECREATE_COOLDOWN = 2000 // 页重建冷却时间

async function getBrowser() {
  const now = Date.now()
  // 如果浏览器已过期或断开，重新启动
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
  // 如果已有可用页面且未过期，直接返回
  if (mainPage && !mainPage.isClosed()) {
    try {
      await mainPage.evaluate(() => 1)
      return mainPage
    } catch {
      // 页面不可用，继续往下重建
    }
  }

  const br = await getBrowser()
  // 关闭旧 context
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
  // 设置更长的导航超时
  mainPage.setDefaultNavigationTimeout(30000)
  mainPage.setDefaultTimeout(30000)
  // 首页预加载，先用较短超时，失败不影响后续
  await mainPage.goto('https://fanqienovel.com/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {
    console.warn('[pp] 首页加载超时，继续')
  })
  await mainPage.waitForTimeout(2000)
  return mainPage
}

async function fetchViaBrowser(action, params, cs) {
  if (!cs) throw new Error('no cookie')
  const page = await ensurePage(cs)
  const url = action === 'chapter'
    ? `https://fanqienovel.com/api/reader/full?itemId=${params.itemId}`
    : `https://fanqienovel.com/api/reader/directory/detail?bookId=${params.bookId}`
  const r = await page.evaluate(async (u) => {
    try {
      const a = await fetch(u, {
        credentials: 'include',
        headers: { 'accept': 'application/json, text/plain, */*', 'referer': 'https://fanqienovel.com/reader/' }
      })
      if (!a.ok) throw Error('HTTP ' + a.status)
      const b = await a.json()
      return { ok: true, data: b.data || b }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }, url)
  if (!r.ok) throw Error('fetch failed: ' + (r.error || '?'))
  return r.data
}

/**
 * 从阅读页提取字体，构建 PUA→汉字 映射
 * 如果 alreadyBuiltFor 与当前 itemId 在同一本书中，可复用缓存加快速度
 */
let mappingBuiltFor = null // 记录映射是为哪个 itemId 构建的

async function ensureMapping(itemId, cs, forceRebuild = false) {
  // 如果已有映射且不强制重建，并且不是同一本书（同一批 chunk 可能 itemId 相近但需要不同字体），先尝试用
  if (charMapping && !forceRebuild && mappingBuiltFor && itemId) {
    // 如果两个 item_id 的差值不超过 100，认为同书，复用映射
    const diff = Math.abs(parseInt(itemId) - parseInt(mappingBuiltFor))
    if (diff < 200) return charMapping
  }
  if (mappingPromise && !forceRebuild) return mappingPromise

  mappingPromise = (async () => {
    const page = await ensurePage(cs)
    let fontUrl = ''

    // 拦截字体响应
    page.on('response', r => {
      const u = r.url()
      if (u.includes('awesome-font') && !fontUrl) fontUrl = u
    })

    // 导航到阅读页，等待字体加载
    await page.goto('https://fanqienovel.com/reader/' + itemId, {
      waitUntil: 'networkidle', timeout: 30000
    }).catch(() => {})
    await page.waitForTimeout(3000)

    // 如果路由拦截没抓到，从 CSS 中提取
    if (!fontUrl) {
      fontUrl = await page.evaluate(() => {
        for (const s of document.styleSheets) {
          try {
            for (const r of s.cssRules) {
              const m = r.cssText.match(/url\(([^)]+woff2[^)]*)\)/)
              if (m) return m[1]
            }
          } catch {}
        }
        return null
      })
    }

    if (!fontUrl) {
      console.warn('[ensureMapping] 找不到字体 URL，使用预置映射')
      try { charMapping = require('./font_mapping.json') } catch {}
      mappingBuiltFor = itemId
      return charMapping || {}
    }

    console.log('[ensureMapping] 下载字体:', fontUrl.replace(/\?.*$/, ''))
    let fontData = null
    // 下载字体文件（支持 HTTP 和 data: URI）
    if (fontUrl.startsWith('data:')) {
      const { parseDataUri } = require('./fontDecoder')
      fontData = parseDataUri(fontUrl)
    } else {
      fontData = await new Promise((resolve, reject) => {
        const mod = fontUrl.startsWith('https:') ? https : http
        mod.get(fontUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fanqienovel.com/' }
        }, r => {
          const c = []
          r.on('data', d => c.push(d))
          r.on('end', () => resolve(Buffer.concat(c)))
          r.on('error', reject)
        }).on('error', reject)
        // 10s 超时
        setTimeout(() => reject(new Error('font download timeout')), 10000)
      })
    }

    if (!fontData || fontData.length < 100) {
      console.warn('[ensureMapping] 字体数据无效，使用预置映射')
      try { charMapping = require('./font_mapping.json') } catch {}
      mappingBuiltFor = itemId
      return charMapping || {}
    }

    console.log('[ensureMapping] 字体大小:', fontData.length)

    // 用 fontkit 构建映射
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
      console.log(`[ensureMapping] 字体映射: ${matchCount}/${Object.keys(knownMapping).length} 个字符匹配`)
    } catch (e) {
      console.error('[ensureMapping] 字体解析失败:', e.message)
      try { charMapping = require('./font_mapping.json') } catch {}
    }

    if (!charMapping || Object.keys(charMapping).length === 0) {
      try { charMapping = require('./font_mapping.json') } catch {}
    }
    mappingBuiltFor = itemId
    return charMapping || {}
  })()

  return mappingPromise
}

async function fetchChapterContent(itemId, cs) {
  if (!cs) throw new Error('no cookie')
  const data = await fetchViaBrowser('chapter', { itemId }, cs)
  const rawHtml = data?.chapterData?.content || data?.content || ''
  if (!rawHtml || rawHtml.length < 50) return null
  let text = rawHtml.replace(/<[^>]+>/g, '').trim()
  if (!text || text.length < 10) return null

  if (!charMapping) {
    try { await ensureMapping(itemId, cs) } catch (e) { console.error('[pp] mapping:', e.message) }
  }
  if (charMapping && Object.keys(charMapping).length > 0) {
    const { decodeText } = require('./fontDecoder')
    const decoded = decodeText(text, charMapping)
    if (decoded && decoded.length > 10) text = decoded
  }
  return text
}

function resetFontCache() { charMapping = null; mappingPromise = null }

async function closeBrowser() {
  try { if (mainPage && !mainPage.isClosed()) await mainPage.close() } catch {}
  try { if (context) await context.close() } catch {}
  try { if (browser) await browser.close() } catch {}
  context = null; browser = null; mainPage = null; charMapping = null; mappingPromise = null
}

// 进程退出时清理浏览器进程
process.on('exit', () => { if (browser) { try { browser.process()?.kill(); } catch {} } })
process.on('SIGINT', () => { closeBrowser(); process.exit() })
process.on('SIGTERM', () => { closeBrowser(); process.exit() })

function getCharMapping() { return charMapping }

module.exports = { fetchViaBrowser, fetchChapterContent, ensureMapping, resetFontCache, getCharMapping, closeBrowser }
