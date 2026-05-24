/**
 * 番茄小说 Cookie 存储模块
 * 用户从 Chrome 复制 cookie 填入即可，无需任何外部脚本
 */
const fs = require('fs')
const path = require('path')

const COOKIE_FILE = path.join(__dirname, '..', 'fanqie_cookie.txt')
let cachedCookie = null

function load() {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      cachedCookie = fs.readFileSync(COOKIE_FILE, 'utf-8').trim()
      console.log('[fanqieAuth] Cookie 已加载, 长度:', cachedCookie.length)
    }
  } catch (e) { console.error('[fanqieAuth] 加载失败:', e.message) }
}

load()

module.exports = {
  setCookie(cookieStr) {
    cachedCookie = cookieStr.trim()
    try { fs.writeFileSync(COOKIE_FILE, cachedCookie, 'utf-8') } catch {}
    console.log('[fanqieAuth] Cookie 已更新, 长度:', cachedCookie.length)
  },

  getCookie() { return cachedCookie || '' },
  isReady() { return !!cachedCookie },

  getStatus() {
    return {
      configured: !!cachedCookie,
      length: (cachedCookie || '').length,
      preview: cachedCookie ? cachedCookie.substring(0, 50) + '...' : null,
    }
  },
}
