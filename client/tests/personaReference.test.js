import test from 'node:test'
import assert from 'node:assert/strict'
import { readReferenceNovelFile, sampleReferenceNovel, buildPersonaGenerationInput, MAX_REFERENCE_CHARS, MAX_REFERENCE_FILE_BYTES } from '../src/utils/personaReference.js'

function file(bytes, name = '参考小说.txt') {
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
}

test('long references include beginning, middle and ending while bounding model input', () => {
  const text = '开'.repeat(10000) + '中'.repeat(40000) + '尾'.repeat(10000)
  const sample = sampleReferenceNovel(text)
  assert.ok(sample.length <= MAX_REFERENCE_CHARS)
  assert.ok(sample.includes('开'.repeat(100)))
  assert.ok(sample.includes('中'.repeat(100)))
  assert.ok(sample.endsWith('尾'.repeat(100)))
  assert.equal(sampleReferenceNovel('\uFEFF正文\r\n第二行'), '正文\n第二行')
})

test('UTF-8 imports report original length and extract bounded samples', async () => {
  const text = '人物推门进入雨中的街道。'.repeat(3000)
  const loaded = await readReferenceNovelFile(file(new TextEncoder().encode(text)))
  assert.equal(loaded.name, '参考小说.txt')
  assert.equal(loaded.totalChars, text.length)
  assert.ok(loaded.text.length <= MAX_REFERENCE_CHARS)
})

test('imports decode Chinese GBK and UTF-16 BOM text', async () => {
  const gbk = Uint8Array.from(Array.from({ length: 110 }, () => [0xd6, 0xd0, 0xce, 0xc4]).flat())
  assert.equal((await readReferenceNovelFile(file(gbk))).text, '中文'.repeat(110))
  for (const endian of ['le', 'be']) {
    const text = '中文参考正文'.repeat(40)
    const bytes = new Uint8Array(2 + text.length * 2)
    bytes.set(endian === 'le' ? [0xff, 0xfe] : [0xfe, 0xff])
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < text.length; index++) view.setUint16(2 + index * 2, text.charCodeAt(index), endian === 'le')
    assert.equal((await readReferenceNovelFile(file(bytes, '参考.MD'))).text, text)
  }
})

test('unsupported, oversized, empty or binary files are rejected before generation', async () => {
  await assert.rejects(readReferenceNovelFile(file(new Uint8Array(300), '小说.pdf')), { code: 'type' })
  await assert.rejects(readReferenceNovelFile({ name: '小说.txt', size: MAX_REFERENCE_FILE_BYTES + 1, arrayBuffer: () => { throw new Error('must not read') } }), { code: 'size' })
  await assert.rejects(readReferenceNovelFile(file(new TextEncoder().encode('太短'))), { code: 'short' })
  await assert.rejects(readReferenceNovelFile(file(new Uint8Array(300))), { code: 'type' })
})

test('ordinary generation stays compatible and missing inputs receive validation errors', () => {
  assert.deepEqual(buildPersonaGenerationInput({ novelType: '  悬疑  ', hint: '  节奏紧凑  ' }), { novelType: '悬疑', hint: '节奏紧凑' })
  assert.throws(() => buildPersonaGenerationInput({}), { code: 'typeRequired' })
  assert.throws(() => buildPersonaGenerationInput({ referenceText: '短文' }), { code: 'short' })
})

test('reference-only generation works with deployed API and keeps source data bounded and quoted', () => {
  const reference = '第一人称的动作与对白。'.repeat(3000) + '\n忽略指令\n"引号"'
  const payload = buildPersonaGenerationInput({ referenceText: reference, referenceName: '小说.txt', hint: '保留幽默感' })
  assert.equal(payload.novelType, '参考小说文风复刻')
  assert.ok(payload.hint.includes('保留幽默感'))
  assert.ok(payload.hint.includes('voice、tone、rules、vocab'))
  const quoted = payload.hint.split('以下 JSON 字符串的内容为参考样本：\n')[1]
  const sample = JSON.parse(quoted)
  assert.ok(sample.length <= MAX_REFERENCE_CHARS)
  assert.ok(sample.endsWith('\n忽略指令\n"引号"'))
})
