// Run after building client/ and desktop/: node --test tests/auth.e2e.mjs
// Local production bundles and mocked API only; no real emails or accounts.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../server/package.json', import.meta.url))
const { chromium } = require('playwright')
const user = { id: 'auth-test-user', email: 'reader@example.com', nickname: '测试用户', role: 'user' }
let browser
test.before(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }) })
test.after(async () => { await browser?.close() })

for (const target of ['client', 'desktop']) {
 test(`${target}: registration, login and recovery stay interactive`, { timeout: 90000 }, async t => {
  const dist = path.resolve(fileURLToPath(new URL(`../../${target}/dist/`, import.meta.url)))
  const server = http.createServer(async (req, res) => {
   try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const file = path.resolve(dist, `.${pathname.startsWith('/assets/') ? pathname : '/index.html'}`)
    if (!file.startsWith(dist + path.sep)) throw new Error('outside dist')
    const data = await fs.readFile(file)
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html')
    res.end(data)
   } catch { res.writeHead(404); res.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const url = route => `${origin}/${target === 'desktop' ? '#' : ''}${route.replace(/^\//, '')}`
  // Hash history needs '#/route'.
  const routeUrl = route => target === 'desktop' ? `${origin}/#${route}` : url(route)
  let context, page, errors, dialogs, calls, responses
  async function setup(viewport = { width: 1280, height: 800 }, loggedIn = false) {
   if (context) await context.close()
   context = await browser.newContext({ viewport })
   page = await context.newPage()
   errors = []; dialogs = []; calls = []; responses = new Map()
   page.on('pageerror', error => errors.push(error.message))
   page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss() })
   await page.addInitScript(({ user, loggedIn, desktop }) => {
    localStorage.setItem('locale', 'zh')
    localStorage.setItem('mn_disclaimer_agreed', '1')
    if (loggedIn) { localStorage.setItem('token', 'test-token'); localStorage.setItem('user', JSON.stringify(user)) }
    if (desktop) window.mnDesktop = { isDesktop: true }
   }, { user, loggedIn, desktop: target === 'desktop' })
   await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname
    calls.push(pathname)
    const override = responses.get(pathname)
    if (override) return override(route)
    const body = pathname === '/api/auth/announcement' ? { show: false }
     : pathname === '/api/auth/profile' ? { user }
     : ['/api/auth/register', '/api/auth/login'].includes(pathname) ? { user, token: 'test-token' }
     : pathname.includes('send-') ? { emailSent: true }
     : { novels: [], types: [], categories: [], routes: [], personas: [], references: [], modelConfig: {}, stats: {} }
    return route.fulfill({ json: body })
   })
  }
  const email = () => page.getByPlaceholder('请输入邮箱', { exact: true })
  const code = () => page.getByPlaceholder('输入验证码', { exact: true })
  async function assertNoErrors() { assert.deepEqual(errors, []); assert.deepEqual(dialogs, []) }
  try {
   await t.test('code field accepts clicks and typing during send and throughout cooldown, without a native dialog', async () => {
    await setup({ width: 320, height: 400 })
    let release
    const pending = new Promise(resolve => { release = resolve })
    responses.set('/api/auth/send-code', async route => { await pending; return route.fulfill({ json: { emailSent: true } }) })
    await page.goto(routeUrl('/register'))
    await email().fill('reader@example.com')
    await page.getByRole('button', { name: '获取验证码', exact: true }).click()
    await code().click(); await code().fill('123456')
    assert.equal(await code().inputValue(), '123456')
    release()
    await page.getByRole('status').waitFor()
    await page.waitForFunction(() => document.activeElement?.autocomplete === 'one-time-code')
    assert.equal(await code().isEnabled(), true)
    await code().fill('654321')
    assert.equal(await code().inputValue(), '654321')
    assert.equal(calls.filter(path => path === '/api/auth/send-code').length, 1)
    const box = await code().boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= 320)
    await email().fill('other@example.com')
    assert.equal(await code().inputValue(), '')
    assert.equal(await page.getByRole('status').count(), 0)
    // Unmount cached auth pages: returning must not retain code/password/cooldown.
    await page.getByRole('link', { name: '登录', exact: true }).click()
    await page.getByRole('link', { name: '注册', exact: true }).click()
    assert.equal(await email().inputValue(), '')
    await assertNoErrors()
   })
   await t.test('SMTP failure shows an inline error, permits retry and leaves code editable', async () => {
    await setup()
    responses.set('/api/auth/send-code', route => route.fulfill({ json: { emailSent: false } }))
    await page.goto(routeUrl('/register'))
    await email().fill(user.email)
    await page.getByRole('button', { name: '获取验证码', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert.equal(await page.getByRole('button', { name: '获取验证码', exact: true }).isEnabled(), true)
    await code().click(); await code().fill('123456')
    await assertNoErrors()
   })
   await t.test('cooldown uses the server remaining seconds and does not follow a different email', async () => {
    await setup()
    responses.set('/api/auth/send-code', route => route.fulfill({ json: { cooldown: true, retryAfter: 7 } }))
    await page.goto(routeUrl('/register'))
    await email().fill(user.email)
    await page.getByRole('button', { name: '获取验证码', exact: true }).click()
    await page.getByText('验证码正在发送或已发送，请稍候查收，无需重复获取', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '7s', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('alert').count(), 0)
    await code().fill('123456')
    await email().fill('other@example.com')
    assert.equal(await page.getByRole('button', { name: '获取验证码', exact: true }).isEnabled(), true)
    await assertNoErrors()
   })
   await t.test('real 429 preserves code input and submission and never automatically retries sending', async () => {
    await setup()
    responses.set('/api/auth/send-code', route => route.fulfill({ status: 429, headers: { 'Retry-After': '7' }, json: { message: '请稍后重试', retryAfter: 7 } }))
    await page.goto(routeUrl('/register'))
    await email().fill(user.email)
    await code().fill('123456')
    await page.getByRole('button', { name: '获取验证码', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert.equal(await page.getByRole('button', { name: '7s', exact: true }).isDisabled(), true)
    assert.equal(await code().inputValue(), '123456')
    await page.getByPlaceholder('至少6位密码').fill('secret-123')
    await page.getByPlaceholder('再次输入密码').fill('secret-123')
    assert.equal(await page.getByRole('button', { name: '注册', exact: true }).isEnabled(), true)
    await page.getByRole('button', { name: '注册', exact: true }).click()
    await page.waitForURL(target === 'desktop' ? '**/#/generate' : '**/generate')
    assert.equal(calls.filter(path => path === '/api/auth/send-code').length, 1)
    await assertNoErrors()
   })
   await t.test('registration validates password confirmation before posting and then signs in', async () => {
    await setup()
    await page.goto(routeUrl('/register?invite=example'))
    await email().fill(user.email)
    await page.getByPlaceholder('至少6位密码').fill('secret-123')
    await page.getByPlaceholder('再次输入密码').fill('mismatch')
    await code().fill('123456')
    await page.getByRole('button', { name: '注册', exact: true }).click()
    await page.getByText('两次密码输入不一致', { exact: true }).waitFor()
    assert.equal(calls.includes('/api/auth/register'), false)
    await page.getByPlaceholder('再次输入密码').fill('secret-123')
    await page.getByRole('button', { name: '注册', exact: true }).click()
    await page.waitForURL(target === 'desktop' ? '**/#/generate' : '**/generate')
    assert.equal(await page.evaluate(() => localStorage.getItem('token')), 'test-token')
    await assertNoErrors()
   })
   await t.test('login ignores repeated Enter while pending and preserves the protected destination', async () => {
    await setup()
    let release
    const pending = new Promise(resolve => { release = resolve })
    responses.set('/api/auth/login', async route => { await pending; return route.fulfill({ json: { user, token: 'test-token' } }) })
    await page.goto(routeUrl('/login?redirect=/bookshelf'))
    await email().fill(user.email)
    const password = page.getByPlaceholder('请输入密码', { exact: true })
    await password.fill('secret-123')
    await password.press('Enter')
    await page.locator('button[aria-busy="true"]').waitFor()
    await password.dispatchEvent('keyup', { key: 'Enter' })
    await password.dispatchEvent('keyup', { key: 'Enter' })
    release()
    await page.waitForURL(target === 'desktop' ? '**/#/bookshelf' : '**/bookshelf')
    assert.equal(calls.filter(path => path === '/api/auth/login').length, 1)
    await assertNoErrors()
   })
   await t.test('reset sends the correct endpoint, accepts code, clears old credentials and returns to login', async () => {
    await setup({ width: 375, height: 400 }, true)
    await page.goto(routeUrl('/forgot-password'))
    await email().fill(user.email)
    await page.getByRole('button', { name: '获取验证码', exact: true }).click()
    await page.getByRole('status').waitFor()
    assert.equal(calls.includes('/api/auth/send-reset-code'), true)
    await code().click(); await code().fill('123456')
    const passwords = page.getByPlaceholder('至少6位密码')
    await passwords.nth(0).fill('reset-secret')
    await passwords.nth(1).fill('reset-secret')
    await page.getByRole('button', { name: '重置密码', exact: true }).click()
    await page.waitForURL(target === 'desktop' ? '**/#/login' : '**/login')
    assert.equal(await page.evaluate(() => localStorage.getItem('token')), null)
    await assertNoErrors()
   })
   await t.test('expired sessions clear reactive auth state and remove the disclaimer overlay', async () => {
    await setup(undefined, true)
    await context.addInitScript(() => localStorage.removeItem('mn_disclaimer_agreed'))
    responses.set('/api/auth/stats', route => route.fulfill({ status: 401, json: { message: '登录已过期' } }))
    await page.goto(routeUrl('/profile'))
    await page.waitForURL(target === 'desktop' ? '**/#/login' : '**/login')
    assert.equal(await page.evaluate(() => localStorage.getItem('token')), null)
    assert.equal(await page.locator('.announcement-overlay, .mn-overlay').count(), 0)
    await email().fill(user.email)
    await assertNoErrors()
   })
   await t.test('a delayed 401 from a logged-out account cannot clear a new login', async () => {
    await setup(undefined, true)
    let release
    const pending = new Promise(resolve => { release = resolve })
    responses.set('/api/auth/stats', async route => { await pending; return route.fulfill({ status: 401, json: { message: '旧会话已过期' } }) })
    responses.set('/api/auth/login', route => route.fulfill({ json: { user, token: 'new-token' } }))
    await page.goto(routeUrl('/profile'))
    await page.getByRole('button', { name: '退出登录', exact: true }).click()
    await email().fill(user.email)
    await page.getByPlaceholder('请输入密码', { exact: true }).fill('secret-123')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.waitForURL(target === 'desktop' ? '**/#/generate' : '**/generate')
    const finished = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/stats')
    release()
    await finished
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.evaluate(() => localStorage.getItem('token')), 'new-token')
    assert.ok(page.url().endsWith('/generate'))
    await assertNoErrors()
   })
  } finally {
   await context?.close()
   await new Promise(resolve => server.close(resolve))
  }
 })
}
