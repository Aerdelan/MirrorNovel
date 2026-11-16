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

test('generation survives an SSE disconnect, queued work, temporary offline status and reload without another POST', { timeout: 60000 }, async () => {
 const server = http.createServer(async (req, res) => {
  try {
   const pathname = new URL(req.url, 'http://localhost').pathname
   const asset = pathname.startsWith('/assets/') ? pathname : '/index.html'
   const file = path.resolve(dist, '.' + asset)
   if (!file.startsWith(dist)) throw Error('outside dist')
   res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html')
   res.end(await fs.readFile(file))
  } catch { res.writeHead(404); res.end() }
 })
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
 const origin = `http://127.0.0.1:${server.address().port}`
 const catalog = buildSkuCatalog(), category = catalog.tree.female[0]
 const input = { novelTypeId: '测试类型', gender: 'female', typeSku: { channel: 'female', category: category.id, theme: category.themes?.[0]?.id || '', elements: [], personas: [], tones: [], cp: 'single' },
  protagonistName: '续写测试', worldSetting: '仅用于本地模拟的世界设定', mode: 'book', targetWordCount: 50000, chapterWordTarget: 3000,
  outline: '已经确认的大纲', storyBlueprint: { mainArc: '确认的故事主线', phases: [{ name: '开篇', startChapter: 1, endChapter: 17, goal: '找到书信' }] }, enableResearch: false }
 let state = { active: true, novelId: 'reconnect-book', novelStatus: 'generating', job: { status: 'queued', chapterNumber: 2, lastCommittedChapter: 1 } }
 let offline = false, detailReads = 0
 const writes = [], generated = [], errors = [], statuses = []
 let browser
 try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
   localStorage.setItem('token', 'local-test-token')
   localStorage.setItem('user', JSON.stringify({ _id: 'reconnect-user', role: 'user' }))
   localStorage.setItem('mn_disclaimer_agreed', '1')
  })
  await page.route('**/*', async route => {
   const req = route.request(), url = new URL(req.url())
   if (url.origin !== origin) return route.abort()
   if (!url.pathname.startsWith('/api/')) return route.continue()
   if (req.method() !== 'GET') writes.push(url.pathname)
   let data = {}
   if (url.pathname === '/api/novel/types/sku') data = catalog
   else if (url.pathname === '/api/novel/types/full') data = { male: [], female: [] }
   else if (url.pathname === '/api/persona' || url.pathname.includes('/reference/list')) data = []
   else if (url.pathname === '/api/novel/original-book/generation-input') data = { exact: true, input }
   else if (url.pathname === '/api/novel/generate') {
    generated.push(JSON.parse(req.postData()))
    return route.fulfill({ contentType: 'text/event-stream', body: [
     { type: 'novel_created', novelId: 'reconnect-book' },
     { type: 'chapter_start', chapterNumber: 1 },
     { type: 'content', content: '第一章的旧流式草稿' },
     { type: 'chapter_end', chapterNumber: 1 },
    ].map(e => `data: ${JSON.stringify(e)}\n\n`).join('') })
   } else if (url.pathname.startsWith('/api/novel/generation-job/') || url.pathname.startsWith('/api/novel/generation-request/')) {
    statuses.push(url.pathname)
    if (offline) return route.fulfill({ status: 503, json: { message: 'temporary offline' } })
    data = state
   } else if (url.pathname === '/api/novel/reconnect-book') {
    detailReads++
    const committed = state.active ? state.job?.lastCommittedChapter || 0 : 3
    data = { _id: 'reconnect-book', status: state.novelStatus, currentChapterIndex: committed,
     chapters: Array.from({ length: committed }, (_, i) => i+1).map(n => ({ chapterNumber: n, title: `第${n}章`, content: `最终保存的第${n}章正文` })) }
   }
   return route.fulfill({ json: data })
  })
  await page.goto(origin + '/generate?editNovel=original-book')
  await page.getByText(/已回填建书时的全部初始信息/).waitFor()
  const generate = page.locator('.generate-page > button.btn-lg')
  await generate.click()
  await page.locator('.recovery-panel').getByText(/后台任务仍在运行/).waitFor()
  assert.equal(await generate.isDisabled(), true, 'queued next chapter is still guarded')
  assert.equal(generated.length, 1)
  assert.equal(generated[0].mode, 'book')
  await page.locator('.gen-modal .gen-text-content').filter({ hasText: '最终保存的第1章正文' }).waitFor()
  offline = true
  await page.locator('.recovery-panel').getByText(/暂时无法连接后端/).waitFor()
  assert.equal(await generate.isDisabled(), true, 'a failed status read cannot unlock another generation')
  state = { ...state, job: { status: 'running', chapterNumber: 3, lastCommittedChapter: 2 } }
  offline = false
  await page.locator('.recovery-panel').getByText(/后台任务仍在运行/).waitFor()
  assert.equal(await generate.isDisabled(), true)
  await page.locator('.gen-modal .gen-text-content').filter({ hasText: '最终保存的第2章正文' }).waitFor()
  assert.equal(detailReads, 2, 'committed chapters refresh during recovery before the book finishes')
  state = { active: false, novelId: 'reconnect-book', novelStatus: 'completed', job: null }
  await page.locator('.gen-status.ok').waitFor()
  assert.match(await page.locator('.gen-modal .gen-text-content').textContent(), /最终保存的第3章正文/)
  assert.equal(detailReads, 3, 'completion reloads committed text rather than exposing a stale stream draft')
  assert.equal(await generate.isDisabled(), false)
  assert.equal(await page.evaluate(() => localStorage.getItem('mn_generation_attempt:reconnect-user')), null)
  // A reload of an in-flight attempt resumes only GET monitoring.
  state = { active: true, novelId: 'reconnect-book', novelStatus: 'generating', job: { status: 'running', chapterNumber: 4 } }
  await page.evaluate(attempt => localStorage.setItem('mn_generation_attempt:reconnect-user', JSON.stringify(attempt)), {
   version: 1, requestId: generated[0].clientRequestId, novelId: 'reconnect-book', input: generated[0], startedAt: Date.now(),
  })
  await page.reload()
  await page.locator('.recovery-panel').getByText(/后台任务仍在运行/).waitFor()
  assert.equal(await generate.isDisabled(), true)
  assert.equal(generated.length, 1)
  assert.equal(writes.some(p => /pause|continue/.test(p)), false)
  assert.ok(statuses.length >= 4)
  // Start a light-novel attempt, then reload while it is still active. Its
  // raw character name and trait must not be fused into the ordinary form.
  await page.evaluate(() => localStorage.removeItem('mn_generation_attempt:reconnect-user'))
  await page.reload()
  await page.getByText(/已回填建书时的全部初始信息/).waitFor()
  await page.locator('.tabs button').filter({ hasText: '轻小说' }).click()
  await page.locator('.ln-grid .type-card').first().click()
  await page.getByPlaceholder('主角名字（日式风格，如：佐藤悠真）').fill('悠真')
  await page.locator('.ln-traits .preset-btn').filter({ hasText: '冷酷' }).click()
  await page.getByPlaceholder('描述故事发生的世界背景（可选）').fill('轻小说原始世界设定')
  await page.locator('.mode-radio').filter({ hasText: '生成一章' }).click()
  state = { active: true, novelId: 'reconnect-book', novelStatus: 'generating', job: { status: 'running', chapterNumber: 1, lastCommittedChapter: 0 } }
  await generate.click()
  await page.locator('.recovery-panel').getByText(/后台任务仍在运行/).waitFor()
  const savedLightNovel = await page.evaluate(() => JSON.parse(localStorage.getItem('mn_generation_attempt:reconnect-user')))
  assert.equal(savedLightNovel.uiMode, 'lightnovel')
  assert.equal(savedLightNovel.uiForm.charName, '悠真')
  assert.equal(savedLightNovel.uiForm.charTrait, '冷酷')
  await page.reload()
  await page.locator('.recovery-panel').getByText(/后台任务仍在运行/).waitFor()
  assert.match(await page.locator('.tabs button.active').textContent(), /轻小说/)
  assert.equal(await page.getByPlaceholder('主角名字（日式风格，如：佐藤悠真）').inputValue(), '悠真')
  assert.equal(await page.getByPlaceholder('描述故事发生的世界背景（可选）').inputValue(), '轻小说原始世界设定')
  assert.match(await page.locator('.ln-traits .preset-btn.active').textContent(), /冷酷/)
  assert.equal(await generate.isDisabled(), true)
  assert.equal(generated.length, 2, 'reload did not resubmit the light-novel generation')
  state = { active: false, novelId: 'reconnect-book', novelStatus: 'paused', job: { status: 'failed', error: { code: 'NETWORK_ERROR', message: '上游网络异常，请稍后继续' } } }
  await page.locator('.gen-status').filter({ hasText: '上游网络异常，请稍后继续' }).waitFor()
  assert.doesNotMatch(await page.locator('.gen-status').textContent(), /\[object Object\]/)
  assert.equal(await generate.isDisabled(), false)
  assert.equal(writes.some(p => /pause|continue/.test(p)), false)
  assert.deepEqual(errors, [])
 } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
})
