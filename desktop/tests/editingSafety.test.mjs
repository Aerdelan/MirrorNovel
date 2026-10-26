// Browser regression tests against the built desktop renderer, with mocked APIs.
// No real accounts, manuscripts, external model services or credentials are used.
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

test('chapter drafts, close guards, input validation and manual scene editing survive failures without triggering generation', { timeout: 120000 }, async () => {
 const server = http.createServer(async (req, res) => {
  try {
   const file = path.resolve(dist, '.' + (new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname))
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
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = [], writes = []
  let acceptConfirm = true, chapterFailure = true, sceneFailure = true
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.type() === 'confirm' && !acceptConfirm ? dialog.dismiss() : dialog.accept())
  await page.addInitScript(() => {
   localStorage.setItem('token', 'e30.' + btoa(JSON.stringify({ userId: 'edit-user', exp: Math.floor(Date.now() / 1000) + 3600 })) + '.mock')
   localStorage.setItem('user', JSON.stringify({ _id: 'edit-user', role: 'user', nickname: '编辑测试' }))
   localStorage.setItem('mn_disclaimer_agreed', '1')
   window.mnDesktop = { isDesktop: true }
  })
  const novel = { _id: 'edit-book', title: '编辑测试作品', status: 'paused', currentChapterIndex: 1, currentWordCount: 10, chapters: [{ chapterNumber: 1, title: '第一章', content: '原来保存的正文。', wordCount: 10 }] }
  const scene = { sceneNumber: 1, action: '旧动作描写', location: '旧城', dialogue: [{ character: '林舟', line: '旧台词', subtext: '旧潜台词', position: '门边' }], objective: '调查', shotPlan: '近景', imagePlan: { prompt: '保留图片提示' } }
  const project = { _id: 'edit-project', title: '场景编辑测试', sourceType: 'original', productionTarget: 'live_action', episodeCount: 1, status: 'developed', screenplayBible: { logline: '旧城来信' }, episodes: [{ episodeNumber: 1, title: '旧信', durationSeconds: 120, scenes: [scene], generationReport: { status: 'completed', sceneCount: 1, issues: [] } }] }
  await page.route('**/*', async route => {
   const request = route.request(), url = new URL(request.url())
   if (url.origin !== origin) return route.abort()
   if (!url.pathname.startsWith('/api/')) return route.continue()
   if (request.method() !== 'GET') writes.push(url.pathname)
   let data = {}
   if (url.pathname === '/api/novel/edit-book/chapter/1') {
    if (chapterFailure) return route.fulfill({ status: 500, json: { message: '模拟保存失败' } })
    novel.chapters[0].content = JSON.parse(request.postData()).content
   } else if (url.pathname === '/api/novel/edit-book') data = novel
   else if (url.pathname.includes('/generation-job/')) data = { job: null }
   else if (url.pathname === '/api/novel/bookshelf') data = [novel]
   else if (url.pathname === '/api/novel/types/sku') data = buildSkuCatalog()
   else if (url.pathname === '/api/novel/types' || url.pathname === '/api/persona' || url.pathname.startsWith('/api/reference/list')) data = []
   else if (url.pathname === '/api/screenplay/projects') data = [project]
   else if (url.pathname === '/api/screenplay/projects/edit-project') data = project
   else if (url.pathname.endsWith('/generation-task')) data = { task: null, batchTask: null }
   else if (url.pathname.endsWith('/image-config')) data = { models: [] }
   else if (url.pathname === '/api/screenplay/projects/edit-project/episodes/1/scenes/1') {
    if (sceneFailure) return route.fulfill({ status: 409, json: { message: '场景正文已被更新，未覆盖最新内容' } })
    const body = JSON.parse(request.postData())
    assert.equal(body.expectedScene.dialogue[0].subtext, '旧潜台词')
    Object.assign(scene, body.scene, { editedAt: new Date().toISOString() })
    data = { scene }
   }
   return route.fulfill({ json: data })
  })
  const openChapter = async () => {
   await page.locator('.chapter-actions .action-edit').waitFor({ state: 'visible' })
   await page.waitForFunction(() => !document.querySelector('.chapter-actions .action-edit')?.disabled)
   await page.locator('.chapter-actions .action-edit').click()
   await page.locator('.edit-modal').waitFor()
  }
  await page.goto(origin + '/#/novel/edit-book?chapter=1')
  await openChapter()
  await page.locator('.edit-modal textarea').fill('本机未提交的修改。')
  acceptConfirm = false
  await page.locator('.gen-overlay').click({ position: { x: 5, y: 5 } })
  assert.equal(await page.locator('.edit-modal').isVisible(), true)
  acceptConfirm = true
  await page.locator('.gen-overlay').click({ position: { x: 5, y: 5 } })
  await page.locator('.edit-modal').waitFor({ state: 'hidden' })
  await page.reload()
  await openChapter()
  assert.equal(await page.locator('.edit-modal textarea').inputValue(), '本机未提交的修改。')
  await page.locator('.edit-modal').getByRole('button', { name: '保存', exact: true }).click()
  assert.equal(await page.locator('.edit-modal').isVisible(), true, 'failed save retains the editor')
  assert.equal(novel.chapters[0].content, '原来保存的正文。')
  chapterFailure = false
  await page.locator('.edit-modal').getByRole('button', { name: '保存', exact: true }).click()
  await page.locator('.edit-modal').waitFor({ state: 'hidden' })
  assert.equal(novel.chapters[0].content, '本机未提交的修改。')
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('mn_edit_draft:')).length), 0)
  await openChapter()
  await page.locator('.edit-modal textarea').fill('离开页面时保留的草稿。')
  acceptConfirm = false
  await page.evaluate(() => { location.hash = '#/bookshelf' })
  await page.waitForURL(/#\/novel\/edit-book/)
  assert.equal(await page.locator('.edit-modal').isVisible(), true)
  acceptConfirm = true
  await page.evaluate(() => { location.hash = '#/bookshelf' })
  await page.locator('.bookshelf-page').waitFor()
  novel.chapters[0].content = '另一窗口保存的新正文。'
  await page.goto(origin + '/#/novel/edit-book?chapter=1')
  await openChapter()
  await page.locator('.edit-modal').getByText('作品正文已变化', { exact: false }).waitFor()
  assert.equal(await page.locator('.edit-modal textarea').isDisabled(), true)
  await page.locator('.edit-modal').getByRole('button', { name: '丢弃本机草稿' }).click()
  assert.equal(await page.locator('.edit-modal textarea').inputValue(), '另一窗口保存的新正文。')
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw Error('mock quota') } })
  await page.locator('.edit-modal textarea').fill('空间不足时仍保留编辑中的内容。')
  await page.getByText('本机草稿暂存失败', { exact: false }).waitFor()
  acceptConfirm = false
  await page.locator('.gen-overlay').click({ position: { x: 5, y: 5 } })
  assert.equal(await page.locator('.edit-modal').isVisible(), true)
  acceptConfirm = true
  await page.locator('.edit-modal').getByRole('button', { name: '保存', exact: true }).click()
  await page.locator('.edit-modal').waitFor({ state: 'hidden' })
  await page.reload() // reset the simulated storage failure
  await page.goto(origin + '/#/generate')
  const length = page.locator('.chapter-words-input input')
  await length.fill('')
  assert.equal(await length.inputValue(), '')
  await length.pressSequentially('10000', { delay: 35 })
  assert.equal(await length.inputValue(), '10000')
  await length.press('Tab')
  assert.equal(await length.inputValue(), '10000')
  await length.fill('100')
  assert.equal(await length.inputValue(), '100')
  await length.press('Tab')
  assert.equal(await length.inputValue(), '2000')
  await page.goto(origin + '/#/screenplay')
  await page.getByRole('button', { name: /场景编辑测试/ }).click()
  await page.getByRole('button', { name: '编辑本场', exact: true }).click()
  const editor = page.locator('.scene-editor')
  await editor.waitFor()
  await editor.getByLabel('动作与空间描写', { exact: true }).fill('她愣住了，随后推开门。')
  await editor.getByLabel('台词', { exact: true }).fill('手工修改的新台词。')
  await page.screenshot({ path: fileURLToPath(new URL('../../.tmp/ux-scene-editor.png', import.meta.url)) })
  assert.equal(scene.dialogue[0].line, '旧台词', 'editing a draft cannot mutate displayed content')
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await editor.getByText('场景正文已被更新', { exact: false }).waitFor()
  assert.equal(await editor.getByLabel('台词', { exact: true }).inputValue(), '手工修改的新台词。')
  sceneFailure = false
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  assert.equal(scene.action, '她愣住了，随后推开门。')
  assert.equal(scene.dialogue[0].subtext, '旧潜台词')
  assert.equal(scene.imagePlan.prompt, '保留图片提示')
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('mn_edit_draft:')).length), 0)
  await page.locator('.scene .dialogue-line').getByText('手工修改的新台词。', { exact: true }).waitFor()
  assert.equal(writes.some(url => /generate|develop|batch\/start/.test(url)), false, 'editing must never start generation')
  assert.deepEqual(errors, [])
 } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
})
