import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../server/package.json', import.meta.url))
const { chromium } = require('playwright')
const { buildSkuCatalog } = require('./config/novelTypeSku.js')
const dist = fileURLToPath(new URL('../dist/', import.meta.url))

test('stalled generation checks the server, survives offline reload, restores original controls and regenerates a new book', { timeout: 90000 }, async () => {
 const streams = new Set()
 const server = http.createServer(async (req, res) => {
  try {
   const pathname = new URL(req.url, 'http://localhost').pathname
   if (pathname === '/api/novel/continue/original-book') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    streams.add(res)
    res.on('close', () => streams.delete(res))
    res.write('data: {"type":"chapter_start","chapterNumber":2}\n\n')
    res.write('data: {"type":"thinking","length":639,"elapsedMs":33000}\n\n')
    return
   }
   const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname))
   if (!file.startsWith(dist)) throw Error('outside dist')
   res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html')
   res.end(await fs.readFile(file))
  } catch { res.writeHead(404); res.end() }
 })
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
 const origin = `http://127.0.0.1:${server.address().port}`
 let browser
 try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
  const errors = [], generated = [], writes = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
   localStorage.setItem('token', 'e30.' + btoa(JSON.stringify({ userId: 'recovery-user', exp: Math.floor(Date.now()/1000)+3600 })) + '.mock')
   localStorage.setItem('user', JSON.stringify({ _id: 'recovery-user', role: 'user' }))
   localStorage.setItem('mn_disclaimer_agreed', '1')
   window.mnDesktop = { isDesktop: true }
  })
  const catalog = buildSkuCatalog(), category = catalog.tree.female[0]
  const input = { novelTypeId: '原始选定类型', gender: 'female', typeSku: { channel: 'female', category: category.id, theme: category.themes?.[0]?.id || '', elements: [], personas: [], tones: [], cp: 'single' },
   protagonistName: '回填主角', worldSetting: '最初的世界设定', mode: 'book', targetWordCount: 900000, chapterWordTarget: 5000, expertMode: true,
   outline: '建书前确认的大纲。', storyBlueprint: { mainArc: '最初确认的主线', phases: [{ name: '开篇', startChapter: 1, endChapter: 180, goal: '找到信件' }] },
   personaId: '', referenceIds: [], referenceExamplesEnabled: false, structurePattern: '原始结构', enableResearch: true, researchLinks: ['https://example.test/original'] }
  const original = { _id: 'original-book', title: '待重新编辑的书', novelTypeId: 'test', novelTypeName: '测试', status: 'paused', targetWordCount: 900000, currentWordCount: 100, currentChapterIndex: 1, chapters: [{ chapterNumber: 1, content: '原书章节不能覆盖。' }], outline: '生成后改过的大纲' }
  let offline = false, active = true, disconnectNext = true
  const statusRequests = []
  await page.route('**/*', async route => {
   const request = route.request(), url = new URL(request.url())
   if (url.origin !== origin) return route.abort()
   if (!url.pathname.startsWith('/api/')) return route.continue()
   if (request.method() !== 'GET') writes.push(url.pathname)
   let data = {}
   if (url.pathname === '/api/novel/bookshelf') data = [original]
   else if (url.pathname === '/api/novel/continue/original-book') return route.continue()
   else if (url.pathname === '/api/novel/original-book/generation-input') data = { exact: true, input, title: original.title }
   else if (url.pathname === '/api/novel/types/sku') data = catalog
   else if (url.pathname === '/api/novel/types/full') data = { male: [], female: [] }
   else if (url.pathname === '/api/persona' || url.pathname.includes('/reference/list')) data = []
   else if (url.pathname.includes('/generation-job/') || url.pathname.includes('/generation-request/')) {
    statusRequests.push(url.pathname)
    if (offline) return route.fulfill({ status: 503, json: { message: 'mock server updating' } })
    data = { active, novelId: 'retry-book', job: { status: active ? 'running' : 'queued', draftLength: 120 } }
   } else if (url.pathname === '/api/novel/pause/retry-book') { active = false; data = { job: { status: 'paused' } } }
   else if (url.pathname === '/api/novel/generate') {
    generated.push(JSON.parse(request.postData()))
    // Closing without a terminal event reproduces a server restart / broken SSE.
    const events = disconnectNext
     ? [{ type: 'novel_created', novelId: 'retry-book' }, { type: 'thinking', length: 1910, elapsedMs: 33000 }]
     : [{ type: 'novel_created', novelId: 'new-book' }, { type: 'completed' }]
    disconnectNext = false
    return route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') })
   }
   return route.fulfill({ json: data })
  })
  await page.goto(origin + '/#/bookshelf')
  await page.getByRole('button', { name: '重新编辑', exact: true }).click()
  await page.getByText('已回填建书时的全部初始信息。编辑后将生成一本新书，原书及章节不会被覆盖。', { exact: true }).waitFor()
  assert.equal(await page.getByPlaceholder('故事主角名字').inputValue(), input.protagonistName)
  assert.equal(await page.getByPlaceholder('描述故事的世界观、背景设定、特殊规则等（可选）').inputValue(), input.worldSetting)
  assert.equal(await page.getByPlaceholder('可选，不填则由AI自动生成大纲').inputValue(), input.outline)
  assert.equal(await page.locator('.word-count-input input').inputValue(), '900000')
  assert.equal(await page.locator('.chapter-words-input input').inputValue(), '5000')
  assert.equal((await page.locator('.gender-tabs button.active').textContent()).trim(), '女频')
  assert.match(await page.locator('.blueprint-text-editor').inputValue(), /最初确认的主线/)
  const generate = page.locator('.generate-page > button.btn-lg')
  await generate.click()
  await page.locator('.gen-modal-header').getByRole('button', { name: '检测卡顿' }).click()
  await page.getByText(/后台任务仍在运行，长时间思考不代表卡死/).waitFor()
  assert.equal(await generate.isDisabled(), true)
  assert.equal(generated.length, 1)
  offline = true
  await page.locator('.recovery-panel').getByRole('button', { name: '检测卡顿', exact: true }).click()
  await page.getByRole('button', { name: '恢复页面（保留待核对任务）' }).click()
  assert.equal(await page.getByPlaceholder('故事主角名字').isDisabled(), false)
  assert.equal(await generate.isDisabled(), true, 'offline status must not permit a duplicate generation')
  await page.evaluate(() => {
   const key = 'mn_generation_attempt:recovery-user'
   const saved = JSON.parse(localStorage.getItem(key))
   saved.novelId = '' // Also exercise loss of the novel_created acknowledgement.
   localStorage.setItem(key, JSON.stringify(saved))
  })
  await page.reload()
  await page.getByText(/已找回上次生成时的填写内容/).waitFor()
  assert.equal(await page.getByPlaceholder('故事主角名字').inputValue(), input.protagonistName)
  assert.equal(await generate.isDisabled(), true)
  offline = false; active = false
  await page.locator('.recovery-panel').getByRole('button', { name: '检测卡顿', exact: true }).click()
  await page.getByText(/已恢复生成前的编辑状态/).waitFor()
  assert.ok(statusRequests.some(url => url.includes('/generation-request/')))
  assert.equal(await generate.isDisabled(), false)
  await page.getByPlaceholder('故事主角名字').fill('编辑后的主角')
  await generate.click()
  await page.getByText('生成完成！', { exact: true }).waitFor()
  assert.equal(generated.length, 2)
  assert.equal(generated[1].protagonistName, '编辑后的主角')
  assert.equal(generated[1].outline, input.outline)
  assert.equal(generated[1].chapterWordTarget, 5000)
  assert.equal(generated[1].expertMode, true)
  assert.deepEqual(generated[1].researchLinks, input.researchLinks)
  assert.notEqual(generated[0].clientRequestId, generated[1].clientRequestId)
  await page.locator('.gen-modal-close').click()
  disconnectNext = true; active = true
  await generate.click()
  await page.locator('.gen-modal-header').getByRole('button', { name: '检测卡顿' }).click()
  await page.getByRole('button', { name: '暂停任务并恢复页面' }).click()
  await page.getByText(/已恢复生成前的编辑状态/).waitFor()
  assert.equal(await generate.isDisabled(), false)
  assert.equal(writes.filter(url => url === '/api/novel/pause/retry-book').length, 1)
  assert.equal(writes.some(url => /chapter|delete/.test(url)), false)
  assert.equal(original.chapters[0].content, '原书章节不能覆盖。')
  await page.evaluate(() => { location.hash = '#/bookshelf' })
  await page.locator('.novel-card').getByRole('button', { name: /继续生成/, exact: true }).click()
  await page.locator('.continue-option.primary').click()
  await page.locator('.continue-progress-card .progress-word').filter({ hasText: '已思考 639 字 · 已用 33 秒' }).waitFor()
  assert.doesNotMatch(await page.locator('.continue-progress-card').textContent(), /\{seconds\}|\{words\}|NaN/)
  assert.deepEqual(errors, [])
 } finally { for (const stream of streams) stream.end(); if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
})
