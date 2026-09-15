/** 临时：在页面里点「同步默认线路到账号」，并回读页面提示 */
const http = require('node:http')

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d))) }).on('error', reject)
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  let targets = []
  for (let i = 0; i < 15; i += 1) {
    try { targets = await getJson('http://127.0.0.1:9222/json/list'); if (targets.some((t) => t.type === 'page')) break } catch {}
    await sleep(1000)
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))

  const evaluate = (expression) => new Promise((resolve) => {
    const id = Math.floor(Math.random() * 100000)
    const onMessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === id) {
        ws.removeEventListener('message', onMessage)
        const r = msg.result?.result
        resolve(r?.value !== undefined ? r.value : r?.description)
      }
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })

  // 打开模型线路页
  await evaluate(`(localStorage.getItem('token') ? Promise.resolve('ok') : fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'test@xiaoshuo.com',password:'test888'})}).then(r=>r.json()).then(d=>{localStorage.setItem('token',d.token||'');localStorage.setItem('user',JSON.stringify(d.user||{}));return 'login'}))`)
  await evaluate(`(() => { const nav = [...document.querySelectorAll('a,button,div,span')].find((n) => (n.textContent || '').trim() === '模型线路'); if (nav) { nav.click(); return 'nav-clicked' } return 'nav-not-found' })()`)
  await sleep(3000)
  const hash = await evaluate('location.hash')
  console.log('当前路由:', hash)

  // 找到「同步默认线路到账号」按钮并点击
  const clicked = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /同步默认线路到账号|同步到账号/.test(b.textContent || ''))
    if (!btn) return 'BUTTON_NOT_FOUND，现有按钮: ' + [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 12).join(' | ')
    btn.click()
    return 'clicked: ' + (btn.textContent || '').trim()
  })()`)
  console.log('点击:', clicked)
  await sleep(4000)
  const message = await evaluate(`(() => { const m = [...document.querySelectorAll('.msg, .panel-desc, p, div')].map((n) => (n.textContent || '').trim()).find((t) => /同步|已把|失败/.test(t) && t.length < 160); return m || '(未读到提示)' })()`)
  console.log('页面提示:', message)
  ws.close()
}

main().catch((e) => console.log('失败:', e.message))
