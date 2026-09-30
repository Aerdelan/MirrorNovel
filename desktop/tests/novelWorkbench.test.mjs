// Run after `npm run build` in desktop/. Uses the repository's server Playwright
// dependency and an installed Chrome. All API calls are mocked; no novels are generated.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../server/package.json', import.meta.url))
const { chromium } = require('playwright')
const dist = fileURLToPath(new URL('../dist/', import.meta.url))

test('workbench follows background progress, waits for pause, guards duplicate starts and refreshes on return', { timeout: 90000 }, async () => {
 const server = http.createServer(async (req, res) => {
  try {
   const file = path.resolve(dist, `.${new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname}`)
   if (!file.startsWith(dist)) throw new Error('outside dist')
   const data = await fs.readFile(file)
   res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html')
   res.end(data)
  } catch { res.writeHead(404); res.end() }
 })
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
 const origin = `http://127.0.0.1:${server.address().port}`
 let browser
 try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.addInitScript(() => {
   localStorage.setItem('token', 'mock-token')
   localStorage.setItem('user', JSON.stringify({ _id: 'mock-user', nickname: 'Test', role: 'user' }))
   localStorage.setItem('mn_disclaimer_agreed', '1')
  })
  const chapter = n => ({ chapterNumber: n, title: `第${n}章 测试章节`, wordCount: 1000, content: '测试正文。' })
  const novel = { _id: 'book-a', title: '后台生成测试', status: 'generating', targetWordCount: 1800000, currentWordCount: 4000, currentChapterIndex: 3, chapters: [1, 2, 3, 3].map(chapter) }
  const secondNovel = { ...novel, _id: 'book-b', title: '另一部作品', status: 'paused', chapters: [chapter(1)], currentChapterIndex: 1 }
  let job = { jobId: 'j1', status: 'running', chapterNumber: 4, lastCommittedChapter: 3, draftLength: 8032 }
  let offline = false
  let jobRequests = 0
  const mutations = []
  await page.route('**/*', async route => {
   const request = route.request()
   const url = new URL(request.url())
   if (url.origin !== origin) return route.abort()
   if (!url.pathname.startsWith('/api/')) return route.continue()
   if (request.method() !== 'GET') mutations.push(url.pathname)
   let body = {}
   if (url.pathname === '/api/novel/generation-job/book-a') {
    jobRequests++
    if (offline) return route.fulfill({ status: 503, json: { message: 'mock offline' } })
    body = { job }
   } else if (url.pathname === '/api/novel/generation-job/book-b') body = { job: null }
   else if (url.pathname === '/api/novel/book-a') body = novel
   else if (url.pathname === '/api/novel/book-b') body = secondNovel
   else if (url.pathname === '/api/novel/book-b/continue-chapter/2') {
    secondNovel.chapters.push(chapter(2)); secondNovel.currentChapterIndex = 2
    return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"chapter_continued","chapterNumber":2}\n\n' })
   }
   else if (url.pathname === '/api/novel/bookshelf') body = [novel]
   else if (url.pathname === '/api/novel/pause/book-a') {
    job = { ...job, status: 'pause_requested' }
    return route.fulfill({ status: 202, json: { job } })
   } else if (url.pathname.includes('/blueprint')) body = { blueprint: null, proposals: [] }
   else if (url.pathname === '/api/auth/profile') body = { user: { _id: 'mock-user', role: 'user' } }
   return route.fulfill({ json: body })
  })
  await page.goto(`${origin}/#/novel/book-a?chapter=3`)
  const footer = page.locator('.wb-foot')
  await footer.getByText('正在生成第 4 章 · 已生成 8032 字').waitFor()
  assert.equal(await footer.getByText('继续生成下一章').count(), 0)
  assert.equal(await page.locator('.wb-chapters .chapter-item').count(), 3, 'old-server exact duplicates must not appear in the chapter sidebar')
  assert.equal(await page.locator('.novel-detail-page .chapter-item').count(), 3, 'the main chapter list must use the same normalized response')
  assert.equal(await page.locator('.chapter-actions .action-edit:enabled').count(), 0)
  novel.chapters.push(chapter(4), chapter(4)); novel.currentChapterIndex = 4
  job = { ...job, chapterNumber: 5, lastCommittedChapter: 4, draftLength: 10 }
  await page.waitForFunction(() => document.querySelectorAll('.wb-chapters .chapter-item').length === 4)
  assert.equal(await page.locator('.novel-detail-page .chapter-item').count(), 4)
  await footer.getByRole('button', { name: /暂停/ }).click()
  await footer.getByText('正在暂停并保存草稿…').first().waitFor()
  assert.equal(await footer.locator('button').isDisabled(), true)
  assert.equal(await footer.getByText('继续生成下一章').count(), 0)
  novel.status = 'paused'; job = { ...job, status: 'paused' }
  await page.waitForFunction(() => document.querySelector('.wb-foot button')?.textContent.includes('继续生成下一章') && !document.querySelector('.wb-foot button').disabled)
  await footer.getByRole('button', { name: '继续生成下一章' }).click()
  await page.locator('.gen-modal').filter({ hasText: '生成设置' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.gen-modal .btn-primary') && !document.querySelector('.gen-modal .btn-primary').disabled)
  assert.match(page.url(), /#\/novel\/book-a/)
  // A second session begins between opening the dialog and confirming it.
  novel.status = 'generating'; job = { ...job, status: 'running' }
  await page.locator('.gen-modal .btn-primary').dispatchEvent('click')
  await page.locator('.gen-modal').waitFor({ state: 'hidden' })
  assert.deepEqual(mutations, ['/api/novel/pause/book-a'])
  novel.status = 'paused'; job = { ...job, status: 'paused' }; offline = true
  await page.getByText('暂时无法确认生成状态，正在重新连接…').first().waitFor()
  assert.equal(await footer.getByText('继续生成下一章').count(), 0)
  offline = false
  await page.waitForFunction(() => document.querySelector('.wb-foot button')?.textContent.includes('继续生成下一章') && !document.querySelector('.wb-foot button').disabled)
  await page.evaluate(() => { location.hash = '#/bookshelf' })
  await page.locator('.bookshelf-page').waitFor()
  const before = jobRequests
  await new Promise(resolve => setTimeout(resolve, 4500))
  assert.equal(jobRequests, before, 'hidden detail must stop polling')
  novel.status = 'generating'; job = { ...job, status: 'running', draftLength: 999 }
  await page.evaluate(() => { location.hash = '#/novel/book-a' })
  await footer.getByText('正在生成第 5 章 · 已生成 999 字').waitFor()
  await page.evaluate(() => { location.hash = '#/novel/book-b' })
  await page.getByRole('heading', { name: '另一部作品', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('.wb-foot button')?.textContent.includes('继续生成下一章') && !document.querySelector('.wb-foot button').disabled)
  assert.equal(await footer.locator('.generation-progress').count(), 0)
  await footer.getByRole('button', { name: '继续生成下一章' }).click()
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.wb-chapters .chapter-item').length === 2)
  await page.waitForFunction(() => !document.querySelector('.wb-foot button').disabled)
  assert.deepEqual(mutations, ['/api/novel/pause/book-a', '/api/novel/book-b/continue-chapter/2'])
  assert.match(page.url(), /#\/novel\/book-b/)
  assert.deepEqual(pageErrors, [])
 } finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
 }
})
