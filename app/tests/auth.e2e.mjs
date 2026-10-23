// npm run build:h5, then node --test tests/auth.e2e.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../server/package.json', import.meta.url))
const express = require('express')
const { chromium } = require('playwright')
test('mobile H5 registration, login and password recovery', { timeout: 60000 }, async t => {
 const app = express()
 app.use(express.static(fileURLToPath(new URL('../dist/build/h5/', import.meta.url))))
 const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)) })
 const browser = await chromium.launch({ channel: 'chrome', headless: true })
 const origin = `http://127.0.0.1:${server.address().port}`
 let context, page, calls, errors, mailFails, posted, limited, cooldown
 const field = label => page.locator('.form-group').filter({ has: page.locator('.label').filter({ hasText: new RegExp(`^${label}$`) }) }).locator('input')
 async function setup(route) {
  await context?.close()
  context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true })
  page = await context.newPage(); calls = []; errors = []; mailFails = false; posted = null; limited = false; cooldown = false
  page.setDefaultTimeout(7000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => {
   const request = route.request()
   const pathname = new URL(request.url()).pathname
   calls.push(pathname)
   if (pathname === '/api/auth/register') posted = request.postDataJSON()
   if (pathname.includes('send-') && limited) return route.fulfill({ status: 429, headers: { 'Retry-After': '7' }, json: { message: '请稍后重试', retryAfter: 7 } })
   const body = pathname.includes('send-') ? (cooldown ? { cooldown: true, retryAfter: 5 } : { emailSent: !mailFails, retryAfter: 30 })
    : ['/api/auth/login', '/api/auth/register'].includes(pathname) ? { user: { id: 'mobile-user', email: 'reader@example.com', nickname: '书友' }, token: 'mobile-token' }
    : { types: [], categories: [], templates: [], novels: [], routes: [], personas: [], references: [], modelConfig: {} }
   return route.fulfill({ json: body })
  })
  await page.goto(`${origin}/#/pages/${route}/${route}`, { waitUntil: 'domcontentloaded' })
 }
 try {
  await t.test('email blur never sends automatically; sent and failed codes both leave the field usable', async () => {
   await setup('register')
   await field('邮箱').fill('reader@example.com')
   const code = field('验证码')
   assert.ok((await code.boundingBox()).height >= 20)
   await code.click(); await code.fill('123456')
   assert.equal(calls.includes('/api/auth/send-code'), false)
   mailFails = true
   await page.getByText('获取验证码', { exact: true }).click()
   await page.getByText('邮件发送失败，请稍后重试', { exact: true }).waitFor()
   await code.click(); await code.fill('654321')
   mailFails = false
   await page.getByText('获取验证码', { exact: true }).click()
   await page.getByText('30s', { exact: true }).waitFor()
   await code.click(); await code.fill('123456')
   assert.equal(await code.inputValue(), '123456')
   assert.deepEqual(errors, [])
  })
  await t.test('429 and a normal cooldown use server timing without blocking the code field or another email', async () => {
   await setup('register')
   await field('邮箱').fill('reader@example.com')
   await field('验证码').fill('123456')
   limited = true
   await page.getByText('获取验证码', { exact: true }).click()
   await page.getByText('7s', { exact: true }).waitFor()
   assert.equal(await field('验证码').inputValue(), '123456')
   await field('验证码').fill('654321')
   await field('邮箱').fill('other@example.com')
   limited = false; cooldown = true
   await page.getByText('获取验证码', { exact: true }).click()
   await page.getByText('5s', { exact: true }).waitFor()
   await page.getByText('验证码正在发送或已发送，请稍候查收', { exact: true }).waitFor()
   await field('验证码').fill('123456')
   assert.deepEqual(errors, [])
  })
  await t.test('registration checks confirmation and permits an omitted nickname', async () => {
   await setup('register')
   await field('邮箱').fill('reader@example.com')
   await field('验证码').fill('123456')
   await field('密码').fill('secret-123')
   await field('确认密码').fill('different')
   await page.getByText('注册', { exact: true }).last().click()
   await page.getByText('两次密码输入不一致', { exact: true }).waitFor()
   assert.equal(posted, null)
   await field('确认密码').fill('secret-123')
   await page.getByText('注册', { exact: true }).last().click()
   await page.waitForURL(url => url.hash === '#/' || url.hash === '#/pages/index/index')
   assert.equal(posted.nickname, '')
   assert.deepEqual(errors, [])
  })
  await t.test('login exposes recovery; successful reset returns to login', async () => {
   await setup('login')
   await page.getByText('忘记密码？', { exact: true }).click()
   await field('邮箱').fill('reader@example.com')
   await page.getByText('获取验证码', { exact: true }).click()
   await page.getByText('如果该邮箱已注册，验证码将发送到您的邮箱', { exact: true }).waitFor()
   await field('验证码').fill('123456')
   await field('新密码').fill('reset-secret')
   await field('确认新密码').fill('reset-secret')
   await page.getByText('重置密码', { exact: true }).click()
   await page.waitForURL('**/#/pages/login/login')
   assert.ok(calls.includes('/api/auth/send-reset-code'))
   assert.ok(calls.includes('/api/auth/reset-password'))
   await field('邮箱').fill('reader@example.com')
   await field('密码').fill('reset-secret')
   await page.getByText('登录', { exact: true }).last().click()
   await page.waitForURL(url => url.hash === '#/' || url.hash === '#/pages/index/index')
   assert.deepEqual(errors, [])
  })
 } finally {
  await context?.close(); await browser.close()
  await new Promise(resolve => server.close(resolve))
 }
})
