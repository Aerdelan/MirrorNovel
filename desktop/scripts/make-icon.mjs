/**
 * 生成桌面端图标（纯 Node 实现，不引入任何图像依赖）。
 *
 * 为什么需要它：
 * 1. electron-builder 默认在 build/ 目录找图标，缺失时会退回 Electron 默认图标
 *    （用户看到的是"electron 图标"，很不专业）。
 * 2. main.cjs 的托盘功能依赖 electron/tray.png，缺失时托盘会静默禁用。
 * 3. 写入 exe 资源用的 resedit 只识别 ICO 格式（给 PNG 会解析出 0 个图标，
 *    导致 exe 图标变空白），所以这里额外产出一份多尺寸 .ico。
 *
 * 用法：node scripts/make-icon.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(here, '..')

// ===== PNG 编码（zlib + CRC32，无第三方依赖）=====
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = -1
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * ICO 编码。每个尺寸写成 32 位 BGRA 的 DIB（不做 PNG 压缩），
 * 兼容性最好：Windows 资源管理器、NSIS、resedit 都能正确识别。
 */
function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  const entries = []
  const blobs = []
  let offset = 6 + images.length * 16

  for (const { size, rgba } of images) {
    const xorSize = size * size * 4
    const maskRowBytes = Math.ceil(size / 32) * 4 // 1bpp，按 4 字节对齐
    const andSize = maskRowBytes * size

    const dib = Buffer.alloc(40)
    dib.writeUInt32LE(40, 0) // biSize
    dib.writeInt32LE(size, 4) // biWidth
    dib.writeInt32LE(size * 2, 8) // biHeight = XOR + AND
    dib.writeUInt16LE(1, 12) // biPlanes
    dib.writeUInt16LE(32, 14) // biBitCount
    dib.writeUInt32LE(0, 16) // biCompression: BI_RGB
    dib.writeUInt32LE(xorSize + andSize, 20) // biSizeImage

    const xor = Buffer.alloc(xorSize)
    for (let y = 0; y < size; y += 1) {
      const srcRow = (size - 1 - y) * size * 4 // DIB 自下而上
      for (let x = 0; x < size; x += 1) {
        const s = srcRow + x * 4
        const d = (y * size + x) * 4
        xor[d] = rgba[s + 2]
        xor[d + 1] = rgba[s + 1]
        xor[d + 2] = rgba[s]
        xor[d + 3] = rgba[s + 3]
      }
    }
    const and = Buffer.alloc(andSize) // 全 0：透明度交给 alpha 通道
    const data = Buffer.concat([dib, xor, and])

    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0 // 调色板数
    entry[3] = 0 // reserved
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bitCount
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)

    entries.push(entry)
    blobs.push(data)
    offset += data.length
  }

  return Buffer.concat([header, ...entries, ...blobs])
}

// ===== 图形绘制（覆盖率抗锯齿）=====
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : clamp01(((px - x1) * dx + (py - y1) * dy) / lengthSq)
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

function roundedRectDistance(px, py, size, radius) {
  const half = size / 2
  const qx = Math.abs(px - half) - (half - radius)
  const qy = Math.abs(py - half) - (half - radius)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

/** 渲染图标像素：翡翠绿圆角方块 + 白色 M 字徽标。 */
function renderPixels(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const radius = size * 0.22
  const s = (v) => v * size
  const stroke = Math.max(1, size * 0.052)
  const strokes = [
    [s(0.34), s(0.68), s(0.34), s(0.35)],
    [s(0.34), s(0.35), s(0.5), s(0.52)],
    [s(0.5), s(0.52), s(0.66), s(0.35)],
    [s(0.66), s(0.35), s(0.66), s(0.68)],
  ]

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5
      const py = y + 0.5
      const bgAlpha = clamp01(0.5 - roundedRectDistance(px, py, size, radius))

      const t = y / size
      let r = Math.round(46 + (52 - 46) * t)
      let g = Math.round(125 + (150 - 125) * t)
      let b = Math.round(91 + (122 - 91) * t)

      let minDist = Infinity
      for (const [x1, y1, x2, y2] of strokes) {
        const d = distanceToSegment(px, py, x1, y1, x2, y2)
        if (d < minDist) minDist = d
      }
      const fgAlpha = clamp01(stroke + 0.5 - minDist)
      if (fgAlpha > 0) {
        r = Math.round(r * (1 - fgAlpha) + 255 * fgAlpha)
        g = Math.round(g * (1 - fgAlpha) + 255 * fgAlpha)
        b = Math.round(b * (1 - fgAlpha) + 255 * fgAlpha)
      }

      const offset = (y * size + x) * 4
      rgba[offset] = r
      rgba[offset + 1] = g
      rgba[offset + 2] = b
      rgba[offset + 3] = Math.round(bgAlpha * 255)
    }
  }
  return rgba
}

// ===== 产出 =====
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const targets = [
  { file: path.join(desktopDir, 'build', 'icon.png'), size: 512, encode: (size, rgba) => encodePng(size, size, rgba) },
  { file: path.join(desktopDir, 'electron', 'tray.png'), size: 256, encode: (size, rgba) => encodePng(size, size, rgba) },
]

for (const { file, size, encode } of targets) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, encode(size, renderPixels(size)))
  console.log(`icon written: ${path.relative(desktopDir, file)} (${size}x${size})`)
}

const icoPath = path.join(desktopDir, 'build', 'icon.ico')
fs.writeFileSync(
  icoPath,
  encodeIco(ICO_SIZES.map((size) => ({ size, rgba: renderPixels(size) })))
)
console.log(`icon written: ${path.relative(desktopDir, icoPath)} (${ICO_SIZES.join('/')})`)
