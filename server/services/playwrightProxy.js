/**
 * Playwright 浏览器代理服务
 */
const fs = require('fs')
const path = require('path')
const https = require('https')

let browser = null, context = null, mainPage = null, charMapping = null, mappingPromise = null

async function getBrowser() {
  if (browser && browser.isConnected()) return browser
  const { chromium } = require('playwright')
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  return browser
}

async function ensurePage(cs) {
  const br = await getBrowser()
  if (mainPage && !mainPage.isClosed()) { try { await mainPage.evaluate(() => 1); return mainPage } catch {} }
  if (context) { try { await context.close() } catch {} }
  context = await br.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', locale: 'zh-CN' })
  const cookies = cs.split(';').map(p => { const [n,...v]=p.trim().split('='); if(!n)return null; return {name:n.trim(),value:v.join('=').trim(),domain:'.fanqienovel.com',path:'/'} }).filter(Boolean)
  if (cookies.length > 0) await context.addCookies(cookies)
  mainPage = await context.newPage()
  await mainPage.goto('https://fanqienovel.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await mainPage.waitForTimeout(2000)
  return mainPage
}

async function fetchViaBrowser(action, params, cs) {
  if (!cs) throw new Error('no cookie')
  const page = await ensurePage(cs)
  const url = action === 'chapter' ? `https://fanqienovel.com/api/reader/full?itemId=${params.itemId}` : `https://fanqienovel.com/api/reader/directory/detail?bookId=${params.bookId}`
  const r = await page.evaluate(async u => { try { const a=await fetch(u,{credentials:'include',headers:{'accept':'application/json, text/plain, */*','referer':'https://fanqienovel.com/reader/'}}); if(!a.ok) throw Error('HTTP '+a.status); const b=await a.json(); return {ok:true,data:b.data||b} } catch(e){return {ok:false,error:e.message}} }, url)
  if (!r.ok) throw Error('fetch failed: '+(r.error||'?'))
  return r.data
}

/**
 * 从阅读页提取字体，构建 PUA→汉字 映射
 */
async function ensureMapping(itemId, cs) {
  if (charMapping) return charMapping
  if (mappingPromise) return mappingPromise

  mappingPromise = (async () => {
    const page = await ensurePage(cs)
    let fontUrl = ''

    page.on('response', r => { const u = r.url(); if (u.includes('awesome-font')) fontUrl = u })
    await page.goto('https://fanqienovel.com/reader/' + itemId, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(3000)

    if (!fontUrl) {
      fontUrl = await page.evaluate(() => {
        for (const s of document.styleSheets) {
          try { for (const r of s.cssRules) { const m = r.cssText.match(/url\(([^)]+woff2[^)]*)\)/); if (m) return m[1] } } catch {}
        }
        return null
      })
    }

    if (!fontUrl) throw new Error('找不到字体 URL')

    console.log('[playwrightProxy] downloading font:', fontUrl)
    const fontData = await new Promise((resolve, reject) => {
      https.get(fontUrl, r => { const c = []; r.on('data', d => c.push(d)); r.on('end', () => resolve(Buffer.concat(c))); r.on('error', reject) })
    })
    console.log('[playwrightProxy] font size:', fontData.length)

    // 用 fontkit 比对已知映射，构建当前字体的映射
    try {
      const fontkit = require('fontkit')
      const font = fontkit.create(fontData)
      const knownMapping = require('./font_mapping.json')
      const map = {}
      for (const [puaChar, chineseChar] of Object.entries(knownMapping)) {
        const code = puaChar.charCodeAt(0)
        const glyph = font.glyphForCodePoint(code)
        if (glyph) map[String.fromCodePoint(code)] = chineseChar
      }
      charMapping = map
      console.log('[playwrightProxy] built mapping:', Object.keys(charMapping).length, 'chars')
    } catch (e) { console.error('[playwrightProxy] mapping error:', e.message) }

    if (!charMapping || Object.keys(charMapping).length === 0) {
      try { charMapping = require('./font_mapping.json') } catch {}
    }
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
