import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { readReferenceNovelFile, chapterHtmlToText, MAX_REFERENCE_CHARS, MAX_REFERENCE_ARCHIVE_BYTES } from '../src/utils/personaReference.js'

const text = marker => `${marker}。雨落在旧墙边，我推开门，听见屋里有人喊了一声。`.repeat(35)
function file(bytes, name) {
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
}
function epub(first = '第一章', second = '第二章', options = {}) {
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>'),
    'OEBPS/book.opf': strToU8(`<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest><opf:item id="second" href="Text/第二章.xhtml"/><opf:item id="nav" href="nav.xhtml" properties="nav"/><opf:item id="first" href="Text/%E7%AC%AC%E4%B8%80%E7%AB%A0.xhtml#start"/></opf:manifest><opf:spine><opf:itemref idref="first"/><opf:itemref idref="second"/><opf:itemref idref="nav"/></opf:spine></opf:package>`),
    'OEBPS/Text/第二章.xhtml': strToU8(`<html><head><title>不要采样标题</title><script>不要采样脚本</script></head><body><p>${text(second)}</p></body></html>`),
    'OEBPS/Text/第一章.xhtml': strToU8(`<html><body><p>${text(first)}</p></body></html>`),
    'OEBPS/nav.xhtml': strToU8(`<html><body><nav>不要采样目录</nav></body></html>`),
    'OEBPS/images/cover.jpg': new Uint8Array(500),
    ...options,
  })
}

test('EPUB reads the OPF spine order, resolves encoded paths and excludes navigation/scripts/images', async () => {
  const result = await readReferenceNovelFile(file(epub(), '参考.epub'))
  assert.ok(result.text.indexOf('第一章') < result.text.indexOf('第二章'))
  assert.ok(!result.text.includes('不要采样'))
  assert.deepEqual(result.files, ['参考.epub'])
  assert.ok(result.totalChars > 1000)
})

test('HTML extraction preserves paragraphs and entities without including hidden or active content', () => {
  const html = '<html><head><style>隐藏样式</style></head><body><p>甲&nbsp;乙&amp;丙<br/>换行</p><script>隐藏脚本</script><svg><text>隐藏图片</text></svg><p hidden>隐藏正文</p><p aria-hidden="true">隐藏注释</p><p>下一段</p></body></html>'
  assert.equal(chapterHtmlToText(html), '甲 乙&丙\n换行\n\n下一段')
})

test('ZIP imports EPUB and text novels from subfolders and ignores non-book entries', async () => {
  const archive = zipSync({
    '系列/第02卷.epub': epub('第二卷开篇', '第二卷结尾'),
    '系列/第01卷.epub': epub('第一卷开篇', '第一卷结尾'),
    '附录/参考.txt': strToU8(text('文本样本')),
    '说明.md': strToU8('很短的说明'),
    '__MACOSX/._第01卷.epub': new Uint8Array(300),
    'image.png': new Uint8Array(1000),
  })
  const result = await readReferenceNovelFile(file(archive, '系列.zip'))
  assert.equal(result.name, '系列.zip')
  assert.equal(result.files.length, 3)
  assert.ok(result.text.includes('第一卷开篇'))
  assert.ok(result.text.includes('第二卷开篇'))
  assert.ok(result.text.includes('文本样本'))
  assert.ok(result.text.indexOf('第01卷.epub') < result.text.indexOf('第02卷.epub'))
  assert.ok(result.text.length <= MAX_REFERENCE_CHARS)
})

test('every book in a 20-book ZIP gets samples within the combined model budget', async () => {
  const entries = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`第${index + 1}卷.txt`, strToU8(text(`卷号${index + 1}`) + '正文'.repeat(10000))]))
  const result = await readReferenceNovelFile(file(zipSync(entries), '多卷.zip'))
  assert.equal(result.files.length, 20)
  assert.ok(result.text.length <= MAX_REFERENCE_CHARS)
  for (let index = 1; index <= 20; index++) assert.ok(result.text.includes(`卷号${index}`))
})

test('empty, corrupt, incomplete and excessive archives report explicit errors', async () => {
  await assert.rejects(readReferenceNovelFile(file(zipSync({ '图片.png': new Uint8Array(10) }), '无正文.zip')), { code: 'emptyArchive' })
  await assert.rejects(readReferenceNovelFile(file(new Uint8Array(10), '损坏.zip')), { code: 'archive' })
  await assert.rejects(readReferenceNovelFile(file(zipSync({ 'mimetype': strToU8('application/epub+zip') }), '无章节.epub')), { code: 'epub' })
  const books = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`${index}.txt`, strToU8(text('正文'))]))
  await assert.rejects(readReferenceNovelFile(file(zipSync(books), '太多.zip')), { code: 'archiveLimit' })
  await assert.rejects(readReferenceNovelFile({ name: '大文件.epub', size: MAX_REFERENCE_ARCHIVE_BYTES + 1, arrayBuffer() { throw new Error('must not read') } }), { code: 'size' })
})

test('oversized ZIP entry metadata is rejected before decompression', async () => {
  const archive = zipSync({ '正文.txt': strToU8(text('正文')) })
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  for (let offset = 0; offset < archive.length - 46; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint32(offset + 24, 101 * 1024 * 1024, true)
      break
    }
  }
  await assert.rejects(readReferenceNovelFile(file(archive, '超限.zip')), { code: 'archiveLimit' })
})
