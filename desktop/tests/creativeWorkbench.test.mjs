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

test('desktop connects reference upload, style selection, structure confirmation and screenplay generation with local model headers', { timeout: 90000 }, async () => {
 const server = http.createServer(async (req, res) => {
  try {
   const pathname = new URL(req.url, 'http://localhost').pathname
   const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname))
   if (!file.startsWith(dist)) throw Error('outside dist')
   res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html')
   res.end(await fs.readFile(file))
  } catch { res.writeHead(404); res.end() }
 })
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
 const origin = `http://127.0.0.1:${server.address().port}`
 const browser = await chromium.launch({ channel: 'chrome', headless: true })
 const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
 const errors = [], writes = []
 const screenshot = async name => {
  if (!process.env.MN_CREATIVE_SCREENSHOTS) return
  await fs.mkdir(process.env.MN_CREATIVE_SCREENSHOTS, { recursive: true })
  await page.screenshot({ path: path.join(process.env.MN_CREATIVE_SCREENSHOTS, name + '.png') })
 }
 page.on('pageerror', error => errors.push(error.message))
 await page.addInitScript(() => {
  localStorage.setItem('token', 'e30.' + btoa(JSON.stringify({ userId: 'mock-user', exp: Math.floor(Date.now() / 1000) + 3600 })) + '.mock')
  localStorage.setItem('user', JSON.stringify({ _id: 'mock-user', role: 'user', nickname: '测试' }))
  localStorage.setItem('mn_disclaimer_agreed', '1')
  localStorage.setItem('mn_model_config_local:user:mock-user', JSON.stringify({ version: 2, defaultRouteId: 'route-1', taskRoutes: {}, routes: [{ id: 'route-1', name: '测试线路', baseUrl: 'https://mock.example.test/v1', apiKey: 'fake-model-key', models: { writing: 'mock-writing', outline: 'mock-outline', reasoning: 'mock-reasoning' } }] }))
  window.mnDesktop = { isDesktop: true }
 })
 const reference = { _id: '0123456789abcdef01234567', title: '测试参考', status: 'ready', aiProcessed: true, styleProfile: '短句、克制、具体动作推进', mainCategory: '悬疑' }
 const persona = { _id: '1123456789abcdef01234567', name: '参考风格', voice: '近距离视角', tone: '短句', scope: 'all' }
 const project = { _id: '2123456789abcdef01234567', title: '桌面剧本测试', sourceType: 'original', productionTarget: 'video', concept: '旧城来信', status: 'draft', episodeCount: 1, episodeDurationSeconds: 30, screenplayBible: {}, episodes: [], imageGeneration: { enabled: false } }
 const samples = [
  { _id: 'sample-draft', title: '待认可草稿', status: 'draft', scope: 'novel', allowedForModelInput: false },
  { _id: 'sample-approved', title: '可用小说样稿', status: 'approved', scope: 'novel', allowedForModelInput: true },
  { _id: 'sample-script', title: '剧本专用样稿', status: 'approved', scope: 'screenplay', allowedForModelInput: true },
 ].map(sample => ({ ...sample, sceneType: 'other', content: '样稿正文。'.repeat(20), updatedAt: '2026-10-26T00:00:00Z' }))
 try {
  await page.route('**/*', async route => {
   const request = route.request(), url = new URL(request.url())
   if (url.origin !== origin) return route.abort()
   if (!url.pathname.startsWith('/api/')) return route.continue()
   const body = request.postData() ? JSON.parse(request.postData()) : null
   if (request.method() !== 'GET') writes.push({ path: url.pathname, body, headers: request.headers() })
   let data = {}
   if (url.pathname === '/api/writing-samples') {
    const items = samples.filter(sample => (!url.searchParams.get('status') || sample.status === url.searchParams.get('status')) && (!url.searchParams.get('scope') || sample.scope === url.searchParams.get('scope')))
    data = { items, total: items.length, page: 1, statusCounts: { draft: 1, approved: 2 } }
   }
   else if (url.pathname === '/api/reference/list' || url.pathname === '/api/reference/list-by-type') data = [reference]
   else if (url.pathname === '/api/reference/upload') data = { novel: reference, message: '已上传' }
   else if (url.pathname === '/api/reference/analyze-structure') data = { analysis: '【整体结构】困境、选择、代价' }
   else if (url.pathname.startsWith('/api/persona/from-reference/')) data = persona
   else if (url.pathname === '/api/persona') data = [persona]
   else if (url.pathname === '/api/novel/bookshelf') data = []
   else if (url.pathname === '/api/novel/types') data = []
   else if (url.pathname === '/api/novel/types/sku') data = buildSkuCatalog()
   else if (url.pathname === '/api/novel/generate') {
    return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"novel_created","novelId":"style-preview"}\n\ndata: {"type":"content","content":"试写正文"}\n\ndata: {"type":"completed","wordCount":4}\n\n' })
   }
   else if (url.pathname === '/api/screenplay/projects' && request.method() === 'GET') data = [project]
   else if (url.pathname === '/api/screenplay/projects') { Object.assign(project, body); data = project }
   else if (url.pathname.endsWith('/develop-stream')) {
    project.screenplayBible = { logline: '旧信引出失踪案', characters: [], locations: [] }
    project.episodes = [{ episodeNumber: 1, title: '第一封信', durationSeconds: 30, scenes: [] }]
    return route.fulfill({ contentType: 'text/event-stream', body: 'data: ' + JSON.stringify({ type: 'completed', project }) + '\n\n' })
   } else if (url.pathname.endsWith('/episodes/1/generate')) {
    project.episodes[0].scenes = [{ sceneNumber: 1, location: '旧城', action: '打开信箱', dialogue: [] }]
    project.episodes[0].generationReport = { status: 'completed', issues: [] }
    data = { episode: project.episodes[0], imageGeneration: { enabled: false } }
   } else if (url.pathname.endsWith('/generation-task')) data = { task: null, batchTask: null }
   else if (url.pathname.endsWith('/image-config')) data = { models: [] }
   return route.fulfill({ json: data })
  })
  await page.goto(origin + '/#/reference-upload')
  await page.getByRole('heading', { name: '参考上传与蒸馏', exact: true, level: 2 }).waitFor()
  await page.getByRole('heading', { name: '测试参考', exact: true }).waitFor()
  await screenshot('reference-library')
  await page.getByPlaceholder('参考名称', { exact: true }).fill('新参考')
  await page.getByPlaceholder('也可以直接粘贴参考正文（至少200字）').fill('门外响起脚步声，林舟回头望去。'.repeat(20))
  await page.getByRole('button', { name: '上传并开始蒸馏', exact: true }).click()
  await page.getByText('已上传，正在后台蒸馏。可以离开本页，稍后回来查看。').waitFor()
  assert.ok(writes.find(write => write.path === '/api/reference/upload')?.headers['x-mn-model-config'])
  await page.evaluate(() => { location.hash = '#/generate' })
  const selector = page.locator('.reference-selector').first()
  await selector.getByText('测试参考', { exact: false }).first().waitFor()
  await selector.locator('input[type=checkbox]').check()
  await selector.getByRole('button', { name: '分析结构', exact: true }).click()
  await selector.getByRole('button', { name: '确认使用此结构', exact: true }).click()
  await selector.getByText('已应用结构参考').waitFor()
  await selector.getByRole('button', { name: '提炼写作风格', exact: true }).click()
  await selector.getByText('写作风格已创建并选中').waitFor()
  const examples = selector.getByRole('checkbox', { name: '带入少量参考原文，辅助稳定文风（可选）' })
  assert.equal(await examples.isChecked(), false, 'reference excerpts are off by default')
  await examples.check()
  await page.locator('.sku-layer .sku-chip').first().click()
  await page.locator('.mode-radio:has(input[value="chapter"])').first().click()
  await page.locator('.generate-page > button.btn-lg').first().click()
  await page.waitForFunction(() => document.querySelector('.gen-modal .btn-editorial'))
  const generated = writes.find(write => write.path === '/api/novel/generate')
  assert.equal(generated.body.referenceExamplesEnabled, true)
  assert.deepEqual(generated.body.referenceIds, [reference._id])
  assert.ok(generated.headers['x-mn-model-config'])
  await page.locator('.gen-modal-close').click()
  await page.evaluate(() => { location.hash = '#/screenplay' })
  await page.getByRole('button', { name: '原创短剧', exact: true }).click()
  await page.locator('#screenplay-title').fill('桌面剧本测试')
  await page.locator('#screenplay-concept').fill('旧城来信')
  await page.getByRole('button', { name: '创建剧本项目', exact: true }).click()
  await page.getByRole('button', { name: '生成剧本圣经与分集大纲', exact: true }).click()
  await page.getByText('旧信引出失踪案', { exact: true }).waitFor()
  await screenshot('screenplay-workbench')
  const develop = writes.find(write => write.path.endsWith('/develop-stream'))
  assert.ok(develop.headers['x-mn-model-config'], 'native fetch SSE must carry the local model route')
  await page.evaluate(() => { location.hash = '#/writing-samples' })
  await page.locator('.revision-sample').first().waitFor()
  assert.equal(await page.locator('.samples-tabs [aria-selected="true"]').textContent().then(text => text.trim()), '全部 (3)')
  assert.equal(await page.locator('.sample-card').count(), 3)
  assert.equal(await page.locator('.revision-sample').count(), 1, 'only consented novel samples enter the picker')
  await page.getByRole('tab', { name: '草稿 (1)', exact: true }).click()
  await page.getByText('待认可草稿', { exact: true }).waitFor()
  const candidatesLoaded = page.waitForResponse(response => response.url().includes('/api/writing-samples') && response.url().includes('scope=novel'))
  await page.locator('.revision-head').getByRole('button').click()
  await candidatesLoaded
  assert.equal(await page.locator('.samples-tabs [aria-selected="true"]').textContent().then(text => text.trim()), '草稿 (1)')
  assert.equal(await page.locator('.sample-card').count(), 1, 'refreshing revision candidates must not replace the main sample list')
  assert.equal(writes.some(write => write.path.includes('/billing')), false)
  assert.deepEqual(errors, [])
 } finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
})
