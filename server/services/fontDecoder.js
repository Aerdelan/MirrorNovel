// 番茄小说字体反爬解码
// 原理：自定义字体中，PUA 编码字符与正常中文字符共享同一个 glyph
// 通过解析 cmap 表，找出这种映射关系

let fontkit = null
try { fontkit = require('fontkit') } catch {}

/**
 * 从 Buffer 解析 woff/woff2 字体，返回 PUA→正常字符 映射表
 */
function buildCharMap(fontBuffer) {
  if (!fontkit) return new Map()
  try {
    const font = fontkit.create(fontBuffer)
    const cmap = font.characterSet
    if (!cmap || cmap.length === 0) return new Map()

    const glyphToChars = new Map()
    for (const charCode of cmap) {
      try {
        const glyph = font.glyphForCodePoint(charCode)
        if (!glyph) continue
        const idx = glyph.id
        if (!glyphToChars.has(idx)) glyphToChars.set(idx, [])
        glyphToChars.get(idx).push(charCode)
      } catch {}
    }

    const result = new Map()
    for (const [, charCodes] of glyphToChars) {
      if (charCodes.length < 2) continue
      const puaChars = charCodes.filter(c => c >= 0xE000 && c <= 0xF8FF)
      const normalChars = charCodes.filter(c =>
        (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3000 && c <= 0x303F) || (c >= 0xFF00 && c <= 0xFFEF)
      )
      for (const pua of puaChars) {
        if (normalChars.length > 0) {
          result.set(pua, String.fromCodePoint(normalChars[0]))
        }
      }
    }
    return result
  } catch (e) {
    console.error('字体解析失败:', e.message)
    return new Map()
  }
}

/**
 * 解码被字体反爬混淆的文本
 */
function decodeText(text, charMap) {
  if (!charMap || !text) return text
  // 支持 Map 和普通对象两种格式
  const isMap = typeof charMap.has === 'function'
  const size = isMap ? charMap.size : Object.keys(charMap).length
  if (size === 0) return text
  return Array.from(text).map(ch => {
    const code = ch.codePointAt(0)
    if (code >= 0xE000 && code <= 0xF8FF) {
      if (isMap && charMap.has(code)) return charMap.get(code)
      if (!isMap && charMap[ch]) return charMap[ch]
    }
    return ch
  }).join('')
}

/**
 * 解析 base64 字体数据 data:font/woff;base64,XXXX
 */
function parseDataUri(src) {
  const m = src.match(/data:font\\/[^;]+;base64,([a-zA-Z0-9+/=]+)/)
  if (m) {
    try {
      return Buffer.from(m[1], 'base64')
    } catch {}
  }
  return null
}

/**
 * 从 Playwright 页面提取字体映射
 *
 * 支持：
 * 1. base64 内嵌字体（data: URI）
 * 2. HTTP 字体 URL（通过浏览器内 fetch 下载）
 * 3. Playwright 路由拦截（外部缓冲区）
 */
async function extractFontMap(page, externalBuffers = []) {
  if (!fontkit) {
    console.log('fontkit 未安装，跳过字体反爬解码')
    return new Map()
  }

  try {
    // 从页面提取所有 @font-face src
    const fontSources = await page.evaluate(() => {
      const sources = []

      // 从 document.styleSheets 提取
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules || []) {
            if (rule instanceof CSSFontFaceRule) {
              const src = rule.style.getPropertyValue('src')
              if (src) sources.push(src)
            }
          }
        } catch {}
      }

      // 从内联 <style> 标签提取
      document.querySelectorAll('style').forEach(s => {
        const text = s.textContent || ''
        const regex = /@font-face\\s*{[^}]*src:\\s*([^;]+);/gi
        let m
        while ((m = regex.exec(text)) !== null) {
          sources.push(m[1])
        }
      })

      return sources
    })

    if (fontSources.length === 0 && externalBuffers.length === 0) {
      // 兜底：从加载的 CSS 中查找 @font-face
      console.log('未在页面 styleSheets 中找到 @font-face，尝试从 CSS 响应中提取...')
    }

    const combined = new Map()

    // 优先处理外部缓冲区（路由拦截）
    for (const buf of externalBuffers) {
      const map = buildCharMap(buf)
      console.log(`外部字体缓冲区 → ${map.size} 个映射`)
      for (const [k, v] of map) combined.set(k, v)
    }

    // 处理 @font-face 中的 src
    for (const src of fontSources) {
      // 提取所有 url(...) 和 data:... 片段
      const urlMatches = src.matchAll(/url\\(["']?([^"')]+)["']?\\)/g)

      for (const m of urlMatches) {
        const url = m[1].replace(/^["']|["']$/g, '').trim()

        // 情况1: base64 data URI
        if (url.startsWith('data:')) {
          const buf = parseDataUri(url)
          if (buf) {
            const map = buildCharMap(buf)
            if (map.size > 0) {
              console.log(`base64 内嵌字体 → ${map.size} 个映射`)
              for (const [k, v] of map) combined.set(k, v)
            }
          }
          continue
        }

        // 情况2: HTTP URL（下载前先做绝对路径补齐）
        if (url.startsWith('http') || url.startsWith('//')) {
          const absUrl = url.startsWith('//') ? 'https:' + url : url
          try {
            const fontArray = await page.evaluate(async (fetchUrl) => {
              try {
                const resp = await fetch(fetchUrl)
                if (!resp.ok) return null
                const buf = await resp.arrayBuffer()
                return Array.from(new Uint8Array(buf))
              } catch { return null }
            }, absUrl)

            if (fontArray && fontArray.length > 0) {
              const map = buildCharMap(Buffer.from(fontArray))
              console.log(`${absUrl.split('/').pop()} (HTTP) → ${map.size} 个映射`)
              for (const [k, v] of map) combined.set(k, v)
            }
          } catch (e) {
            console.error(`字体下载失败 ${absUrl}:`, e.message)
          }
        }
      }
    }

    return combined
  } catch (e) {
    console.error('字体提取失败:', e.message)
    return new Map()
  }
}

module.exports = { buildCharMap, decodeText, extractFontMap }
