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
 * 替代旧的 fetchViaBrowser API 方式（a_bogus 已失效）
 */
async function fetchChapterContent(itemId, cs) {
  if (!cs) throw new Error('no cookie')
  const page = await ensurePage(cs)

  // 导航到 reader 页面（即使 404，JS state 仍在 HTML 中）
  await page.goto('https://fanqienovel.com/reader/' + itemId, {
    waitUntil: 'domcontentloaded', timeout: 30000
  }).catch(() => {})
  await page.waitForTimeout(4000)

  // 从 page state 中提取章节内容
  let chapterData = null
  let rawHtml = ''

  try {
    // 尝试从 window.__NUXT__ 提取
    chapterData = await page.evaluate(() => {
      try {
        const nuxt = window.__NUXT__ || window.__NUXT_DATA__ || window.__NEXT_DATA__
        if (nuxt) {
          const reader = nuxt.state?.reader || nuxt.reader || {}
          return reader.chapterData || reader.content || null
        }
        return null
      } catch { return null }
    })
  } catch {}

  // 兜底：从 page.content() 正则提取
  if (!chapterData) {
    rawHtml = await page.content()
    // 匹配 "content":"..." 字段（含转义字符）
    const m = rawHtml.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (m) {
      let c = m[1].replace(/\\u003C/g, '<').replace(/\\u003E/g, '>').replace(/\\n/g, '\n')
      c = c.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      if (c.length > 50) chapterData = { content: c }
    }
  }

  if (!chapterData) throw new Error('未提取到章节内容')

  // 构建字体映射
  if (!charMapping) {
    try { await ensureMapping(itemId, cs, rawHtml) } catch (e) {
      console.error('[pp] 字体映射失败:', e.message)
    }
  }

  // 解码 PUA 字符
  let text = (chapterData.content || chapterData || '').replace(/<[^>]+>/g, '').trim()
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

// 旧 fetchViaBrowser 保留供目录获取使用（目录 API 可能仍可用）
async function fetchViaBrowser(action, params, cs) {
  if (!cs) throw new Error('no cookie')
  const page = await ensurePage(cs)

  if (action === 'chapter') {
    // 章节内容改用 fetchChapterContent
    return { chapterData: { content: await fetchChapterContent(params.itemId, cs) } }
  }

  // 目录 API 使用页面内的 fetch（可能也需要 a_bogus，但先试试）
  const url = `https://fanqienovel.com/api/reader/directory/detail?bookId=${params.bookId}`
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
  if (!r.ok) throw Error('fetch failed: ' + (r.error || '?'))
  return r.data
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

    // 从 HTML 中提取 woff2 字体 URL（嵌入在 JS state 中）
    const woffMatches = html.match(/https?:[^"']+bytetos[^"']*woff2[^"']*/g)
    let fontUrl = ''
    if (woffMatches && woffMatches.length > 0) {
      fontUrl = woffMatches[0].replace(/\\u002F/g, '/')
      console.log('[ensureMapping] 字体 URL:', fontUrl.replace(/\?.*$/, ''))
    }

    if (!fontUrl) {
      console.warn('[ensureMapping] 无字体 URL')
      charMapping = {}
      mappingBuiltFor = itemId
      return charMapping
    }

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

    // 用 fontkit 解析 cmap
    try {
      const fontkit = require('fontkit')
      const font = fontkit.create(fontData)
      const cmap = font.characterSet
      const glyphToChars = new Map()
      for (const code of cmap || []) {
        try {
          const glyph = font.glyphForCodePoint(code)
          if (!glyph) continue
          const idx = glyph.id
          if (!glyphToChars.has(idx)) glyphToChars.set(idx, [])
          glyphToChars.get(idx).push(code)
        } catch {}
      }
      const map = {}
      let matchCount = 0
      for (const [, codes] of glyphToChars) {
        if (codes.length < 2) continue
        const puaChars = codes.filter(c => c >= 0xE000 && c <= 0xF8FF)
        const normalChars = codes.filter(c =>
          (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3000 && c <= 0x303F) || (c >= 0xFF00 && c <= 0xFFEF)
        )
        for (const pua of puaChars) {
          if (normalChars.length > 0) {
            map[String.fromCodePoint(pua)] = String.fromCodePoint(normalChars[0])
            matchCount++
          }
        }
      }
      charMapping = map
      console.log(`[ensureMapping] cmap 解析: ${matchCount} 个 PUA→汉字 映射`)
    } catch (e) {
      console.error('[ensureMapping] fontkit 解析失败:', e.message)
      charMapping = {}
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
