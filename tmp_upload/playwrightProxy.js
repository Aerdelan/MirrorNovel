/**
 * Playwright 浏览器代理服务
 * 
 * 维护一个持久化的无头浏览器，设置用户的 cookie，
 * 用于：
 * 1. 调用番茄小说 API（浏览器自动生成 a_bogus）
 * 2. 渲染 PUA 字体编码的章节内容
 */
let browser = null
let context = null
let mainPage = null

async function getBrowser() {
  if (browser && browser.isConnected()) return browser
  const { chromium } = require('playwright')
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  })
  console.log('[playwrightProxy] 浏览器已启动')
  return browser
}

/**
 * 确保页面已加载（带 cookie + 字体 JS 初始化）
 */
async function ensurePage(cookieStr) {
  const br = await getBrowser()

  // 如果上下文已存在且 cookie 相同，复用页面
  if (mainPage && !mainPage.isClosed()) {
    try { await mainPage.evaluate(() => 1) } catch {
      // 页面挂了，重建
      try { await context.close() } catch {}
      context = null
      mainPage = null
    }
    if (mainPage) return mainPage
  }

  // 关闭旧上下文
  if (context) { try { await context.close() } catch {} }

  context = await br.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    locale: 'zh-CN',
  })

  // 设置 cookie
  const cookies = cookieStr.split(';').map(pair => {
    const [name, ...val] = pair.trim().split('=')
    if (!name || val.length === 0) return null
    return { name: name.trim(), value: val.join('=').trim(), domain: '.fanqienovel.com', path: '/' }
  }).filter(Boolean)
  if (cookies.length > 0) await context.addCookies(cookies)

    mainPage = await context.newPage()

  // 加载番茄首页，初始化 a_bogus
  await mainPage.goto('https://fanqienovel.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await mainPage.waitForTimeout(2000)

  return mainPage
}

/**
 * 调用番茄小说 API
 */
async function fetchViaBrowser(action, params, cookieStr) {
  if (!cookieStr) throw new Error('未设置 cookie')

  const page = await ensurePage(cookieStr)

  let url = ''
  if (action === 'chapter') url = `https://fanqienovel.com/api/reader/full?itemId=${params.itemId}`
  else if (action === 'bookInfo') url = `https://fanqienovel.com/api/reader/directory/detail?bookId=${params.bookId}`
  else throw new Error('未知操作: ' + action)

  const result = await page.evaluate(async (fetchUrl) => {
    try {
      const resp = await fetch(fetchUrl, {
        credentials: 'include',
        headers: { 'accept': 'application/json, text/plain, */*', 'referer': 'https://fanqienovel.com/reader/' },
      })
      if (!resp.ok) throw new Error('HTTP ' + resp.status)
      const json = await resp.json()
      return { ok: true, data: json.data || json }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }, url)

  if (!result.ok) throw new Error('浏览器请求失败: ' + (result.error || '未知错误'))
  return result.data
}

// 字体缓存：是否已加载过这本书的字体
let fontLoaded = false

/**
 * 获取章节内容并让浏览器渲染 PUA 字体，返回纯文本
 * 每本书只需加载字体一次，后续共享
 */
async function fetchChapterContent(itemId, cookieStr, preloaded = false) {
  if (!cookieStr) throw new Error('未设置 cookie')

  // 1. 先调 API 获取 PUA 编码的 HTML 内容
  const data = await fetchViaBrowser('chapter', { itemId }, cookieStr)
  const rawHtml = data?.chapterData?.content || data?.content || ''
  if (!rawHtml || rawHtml.length < 50) return null

  // 2. 首次需要加载字体
  const page = await ensurePage(cookieStr)
  if (!fontLoaded) {
    await page.goto('https://fanqienovel.com/reader/' + itemId, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(4000)
    fontLoaded = true
  }

  // 3. 注入 API 内容并提取渲染后文本
  const text = await page.evaluate((html) => {
    const div = document.createElement('div')
    div.innerHTML = html
    div.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;font-family:inherit;font-size:16px;line-height:1.8;'
    document.body.appendChild(div)
    const result = div.innerText || div.textContent || ''
    document.body.removeChild(div)
    return result.trim()
  }, rawHtml)

  return text && text.length > 10 ? text : null
}

/** 重置字体缓存（换书时调用） */
function resetFontCache() { fontLoaded = false }

/**
 * 关闭浏览器
 */
async function closeBrowser() {
  try { if (mainPage && !mainPage.isClosed()) await mainPage.close() } catch {}
  try { if (context) await context.close() } catch {}
  try { if (browser) await browser.close() } catch {}
  context = null; browser = null; mainPage = null
  console.log('[playwrightProxy] 浏览器已关闭')
}

module.exports = { fetchViaBrowser, fetchChapterContent, resetFontCache, closeBrowser }
