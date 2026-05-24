const { chromium } = require('playwright')
const { buildCharMap, decodeText } = require('./fontDecoder')
const https = require('https')

let fontCache = null

async function getFontCache() {
  if (fontCache) return fontCache
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  try {
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' })
    const page = await ctx.newPage()
    let zhal = null
    page.on('response', async (resp) => {
      if (!resp.url().includes('/api/reader/full')) return
      zhal = resp.headers()['x-tt-zhal']
    })
    await page.goto('https://fanqienovel.com/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(3000)
    const fc = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script')
      for (const s of scripts) {
        const m = s.textContent.match(/chapterListWithVolume\s*=\s*(\[[\s\S]*?\])\s*;/)
        if (m) { try { const raw = m[1].replace(/\\/g, ''); return JSON.parse(raw)[0] } catch (e) {} }
      }
      const l = document.querySelector('a[href*="/reader/"]')
      if (l) { const m = l.href.match(/\/reader\/(\d+)/); if (m) return { item_id: m[1] } }
      return null
    })
    if (!fc || !fc.item_id) { console.log('No chapter'); return null }
    console.log('Chapter:', fc.item_id)
    await page.goto('https://fanqienovel.com/reader/' + fc.item_id, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(3000)
    if (!zhal) { console.log('No header'); return null }
    console.log('Header:', zhal)
    // Parse: k=KEY;f=FILE;d1=DOMAIN1;d2=DOMAIN2
    const parts = {}
    zhal.split(';').forEach(p => { const kv = p.split('='); if (kv.length === 2) parts[kv[0]] = kv[1] })
    const domain = parts.d1 || parts.d2 || parts.domain
    const fname = parts.f || parts.filename
    if (!domain || !fname) { console.log('Incomplete config', JSON.stringify(parts)); return null }
    const url = 'https://' + domain + '/obj/awesome-font/c/' + fname + '.woff2'
    console.log('Downloading:', url)
    const buf = await new Promise((ok, no) => {
      https.get(url, (res) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => ok(Buffer.concat(c))); res.on('error', no) }).on('error', no)
    })
    console.log('Font size:', buf.length)
    fontCache = buildCharMap(buf)
    console.log('Map size:', fontCache.size)
    if (fontCache.size > 0) {
      const samples = [...fontCache.entries()].slice(0, 3)
      samples.forEach(([p, c]) => console.log('  U+' + p.toString(16) + ' -> ' + c))
      const test = '\u8bfe\ue526\u4f11\u606f\uf013\u94c3\ue488\u521a\u521a\u54cd\ue545'
      console.log('Decode test:', test, '->', decodeText(test, fontCache))
    }
    return fontCache
  } finally { await browser.close() }
}

if (require.main === module) {
  getFontCache().then(m => { console.log('Done, map:', m ? m.size : 0); process.exit(0) }).catch(e => { console.log('Error:', e.message); process.exit(1) })
}

module.exports = { getFontCache }
