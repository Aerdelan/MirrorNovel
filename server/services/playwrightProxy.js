/**
 * Playwright 浏览器代理服务
 * 从 reader 页 SPA 拦截 API 响应（含 a_bogus）+ x-tt-zhal 响应头构建字体
 */
const https = require('https')
const http = require('http')

let browser = null, context = null, mainPage = null, charMapping = null, mappingPromise = null
let browserInitTime = 0
const BROWSER_TTL = 10 * 60 * 1000

async function getBrowser() {
  const now = Date.now()
  if (browser) {
    try {
      if (browser.isConnected() && (now - browserInitTime) < BROWSER_TTL) return browser
      await browser.close().catch(() => {})
    } catch { }
  }
  const { chromium } = require('playwright')
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  browserInitTime = Date.now()
  return browser
}

async function ensurePage(cs) {
  if (mainPage && !mainPage.isClosed()) {
    try { await mainPage.evaluate(() => 1); return mainPage } catch { }
  }
  const br = await getBrowser()
  if (context) { try { await context.close().catch(() => {}) } catch {} }
  context = await br.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    locale: 'zh-CN', viewport: { width: 1920, height: 1080 },
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

/** 下载并解析字体，直接构建映射 */
async function downloadAndMap(fontUrl) {
  return new Promise((resolve) => {
    const mod = fontUrl.startsWith('https:') ? https : http
    mod.get(fontUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fanqienovel.com/' } },
      r => { const c = []; r.on('data', d => c.push(d)); r.on('end', () => resolve(Buffer.concat(c))); r.on('error', () => resolve(null)) }
    ).on('error', () => resolve(null))
    setTimeout(() => resolve(null), 10000)
  }).then(buf => {
    if (!buf || buf.length < 1000) { console.warn('[font] 字体太小'); return {} }
    try {
      const fontkit = require('fontkit')
      const font = fontkit.create(buf)
      const knownMapping = require('./font_mapping.json')
      const map = {}
      let cnt = 0
      for (const [puaChar, chineseChar] of Object.entries(knownMapping)) {
        const code = puaChar.charCodeAt(0)
        if (font.glyphForCodePoint(code)) { map[String.fromCodePoint(code)] = chineseChar; cnt++ }
      }
      console.log(`[font] 交叉验证: ${cnt}/${Object.keys(knownMapping).length}`)
      return map
    } catch (e) { console.error('[font] 解析失败:', e.message); return {} }
  })
}

async function fetchChapterContent(itemId, cs) {
  if (!cs) throw new Error('no cookie')
  const page = await ensurePage(cs)

  const navPromise = page.goto('https://fanqienovel.com/reader/' + itemId, {
    waitUntil: 'domcontentloaded', timeout: 20000
  }).catch(() => {})

  // 拦截 API 响应 + x-tt-zhal 响应头
  let apiResponse = null, fontUrl = ''
  try {
    const resp = await page.waitForResponse(r => r.url().includes('/api/reader/full') && r.url().includes(itemId), { timeout: 25000 })
    apiResponse = await resp.json()
    const zhal = resp.headers()['x-tt-zhal'] || ''
    if (zhal) {
      const parts = {}; zhal.split(';').forEach(p => { const kv = p.trim().split('='); if (kv.length === 2) parts[kv[0]] = kv[1] })
      const domain = parts.d1 || parts.d2; const fname = parts.f
      if (domain && fname) fontUrl = `https://${domain}/obj/awesome-font/c/${fname}.woff2`
    }
  } catch {}

  await navPromise
  await page.waitForTimeout(1500)

  // 提取内容
  let content = apiResponse?.data?.chapterData?.content || apiResponse?.chapterData?.content || apiResponse?.content || ''
  if (!content || content.length < 50) {
    const html = await page.content()
    const m = html.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (m) {
      let c = m[1].replace(/\\u003C/g, '<').replace(/\\u003E/g, '>').replace(/\\n/g, '\n')
      c = c.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      if (c.length > 50) content = c
    }
  }
  if (!content || content.length < 50) throw new Error('未提取到章节内容')

  // 构建字体映射（从 x-tt-zhal 响应头获取字体 URL）
  console.log('[dbg] fontUrl=' + fontUrl + ' charMapping=' + (charMapping ? Object.keys(charMapping).length : 'null'))
  if (!charMapping && fontUrl) {
    console.log('[font] 从响应头构建字体:', fontUrl.replace(/\?.*$/, '').split('/').pop())
    charMapping = await downloadAndMap(fontUrl)
    console.log('[dbg] after downloadAndMap cnt=' + (charMapping ? Object.keys(charMapping).length : 0))
  }

  // 解码
  let text = content.replace(/<[^>]+>/g, '').trim()
  if (!text || text.length < 10) return null
  if (charMapping && Object.keys(charMapping).length > 0) {
    const { decodeText } = require('./fontDecoder')
    const decoded = decodeText(text, charMapping)
    if (decoded && decoded.length > 10) text = decoded
    console.log('[pp] 解码:', text.substring(0, 40) + '...')
  } else {
    console.warn('[pp] 无字体映射')
  }
  return text
}

async function fetchViaBrowser(action, params, cs) {
  if (!cs) throw new Error('no cookie')
  if (action === 'chapter') return { chapterData: { content: await fetchChapterContent(params.itemId, cs) } }
  
  const page = await ensurePage(cs)
  const url = `https://fanqienovel.com/api/reader/directory/detail?bookId=${params.bookId}`
  try {
    const r = await page.evaluate(async (u) => {
      try {
        const a = await fetch(u, { credentials: 'include', headers: { 'accept': 'application/json', 'referer': 'https://fanqienovel.com/' } })
        if (!a.ok) throw Error('HTTP ' + a.status)
        const b = await a.json()
        return { ok: true, data: b.data || b }
      } catch (e) { return { ok: false, error: e.message } }
    }, url)
    if (r.ok && r.data?.chapterListWithVolume) return r.data
  } catch {}

  console.warn('[pp] 目录 API 失败，从页面 HTML 提取')
  await page.goto('https://fanqienovel.com/reader/' + params.bookId, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(3000)
  const html = await page.content()
  const m = html.match(/"chapterListWithVolume"\s*:\s*(\[[\s\S]*?\])\s*,\s*"chapterTotal"/)
  if (m) { try { return { chapterListWithVolume: JSON.parse(m[1].replace(/\\u002F/g, '/')) } } catch {} }
  throw new Error('无法获取目录数据')
}

function resetFontCache() { charMapping = null; mappingPromise = null }
function getCharMapping() { return charMapping }

async function closeBrowser() {
  try { if (mainPage && !mainPage.isClosed()) await mainPage.close() } catch {}
  try { if (context) await context.close() } catch {}
  try { if (browser) await browser.close() } catch {}
  context = null; browser = null; mainPage = null; charMapping = null; mappingPromise = null
}

process.on('exit', () => { if (browser) { try { browser.process()?.kill(); } catch {} } })
process.on('SIGINT', () => { closeBrowser(); process.exit() })
process.on('SIGTERM', () => { closeBrowser(); process.exit() })

module.exports = { fetchViaBrowser, fetchChapterContent, resetFontCache, getCharMapping, closeBrowser }
