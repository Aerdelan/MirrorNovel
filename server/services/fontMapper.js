const { chromium } = require('playwright')
const { buildCharMap, decodeText } = require('./fontDecoder')
const https = require('https')
const fs = require('fs')
const path = require('path')

let fontCache = null
const FONT_PATH = path.join(__dirname, '..', 'fanqie_font.woff2')

// 下载并保存字体
async function ensureFont() {
  if (fs.existsSync(FONT_PATH)) return
  const zhal = await getFontHeader()
  if (!zhal) throw new Error('无法获取字体配置')
  const parts = {}
  zhal.split(';').forEach(p => { const kv = p.split('='); if (kv.length === 2) parts[kv[0]] = kv[1] })
  const domain = parts.d1 || parts.d2
  const fname = parts.f
  if (!domain || !fname) throw new Error('字体配置不完整')
  const url = `https://${domain}/obj/awesome-font/c/${fname}.woff2`
  console.log('下载字体:', url)
  const buf = await new Promise((ok, no) => {
    https.get(url, (r) => { const c = []; r.on('data', d => c.push(d)); r.on('end', () => ok(Buffer.concat(c))); r.on('error', no) }).on('error', no)
  })
  fs.writeFileSync(FONT_PATH, buf)
  console.log('字体已保存:', buf.length, 'bytes')
}

async function getFontHeader() {
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
      for (const s of document.querySelectorAll('script')) {
        const m = s.textContent.match(/chapterListWithVolume\s*=\s*(\[[\s\S]*?\])\s*;/)
        if (m) { try { const raw = m[1].replace(/\\/g, ''); return JSON.parse(raw)[0] } catch (e) {} }
      }
      const l = document.querySelector('a[href*="/reader/"]')
      if (l) { const m = l.href.match(/\/reader\/(\d+)/); if (m) return { item_id: m[1] } }
      return null
    })
    if (fc && fc.item_id) {
      await page.goto('https://fanqienovel.com/reader/' + fc.item_id, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
      await page.waitForTimeout(3000)
    }
    return zhal
  } finally { await browser.close() }
}

// 通过浏览器渲染构建映射
async function buildMappingViaBrowser() {
  await ensureFont()
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage()
    const fontB64 = fs.readFileSync(FONT_PATH).toString('base64')

    // 读取所有 PUA 字符
    const fontkit = require('fontkit')
    const font = fontkit.create(fs.readFileSync(FONT_PATH))
    const puaChars = font.characterSet.filter(c => c >= 0xE000 && c <= 0xF8FF).sort((a, b) => a - b)
    console.log('PUA 字符数:', puaChars.length)

    const mapping = new Map()

    // 在页面中注入字体并渲染
    for (let i = 0; i < puaChars.length; i++) {
      const code = puaChars[i]
      const pua = String.fromCodePoint(code)
      // 用浏览器渲染 PUA 字符
      const result = await page.evaluate(async (b64, ch) => {
        const f = new FontFace('customFont', 'url(data:font/woff2;base64,' + b64 + ')')
        await f.load()
        document.fonts.add(f)
        await document.fonts.ready

        const canvas = document.createElement('canvas')
        canvas.width = 100
        canvas.height = 100
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, 100, 100)
        ctx.font = '80px customFont'
        ctx.fillStyle = '#000'
        ctx.textBaseline = 'top'
        ctx.fillText(ch, 5, 5)

        // 获取非透明像素范围
        const data = ctx.getImageData(0, 0, 100, 100).data
        let minX = 100, minY = 100, maxX = 0, maxY = 0
        let pixels = ''
        for (let y = 0; y < 100; y++) {
          for (let x = 0; x < 100; x++) {
            const idx = (y * 100 + x) * 4
            if (data[idx + 3] > 0) {
              if (x < minX) minX = x
              if (y < minY) minY = y
              if (x > maxX) maxX = x
              if (y > maxY) maxY = y
              pixels += '1'
            } else {
              pixels += '0'
            }
          }
        }
        return { minX, minY, maxX, maxY, pixels, w: maxX - minX + 1, h: maxY - minY + 1 }
      }, fontB64, pua)

      // 存储结果
      mapping.set(code, result)
      if ((i + 1) % 50 === 0) console.log(`  已渲染 ${i + 1}/${puaChars.length} 个字符`)
    }

    console.log('映射大小:', mapping.size)
    return mapping
  } finally { await browser.close() }
}

if (require.main === module) {
  buildMappingViaBrowser().then(m => {
    console.log('完成')
    process.exit(0)
  }).catch(e => {
    console.log('错误:', e.message)
    process.exit(1)
  })
}

module.exports = { buildMappingViaBrowser }
