/** 临时：从桌面端本地配置里取 AMD 线路，并调用应用自己的接口同步到账号（key 不落日志） */
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

  // 确保登录态
  const login = await evaluate(`(localStorage.getItem('token') ? Promise.resolve('has-token') : fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'test@xiaoshuo.com',password:'test888'})}).then(r=>r.json()).then(d=>{localStorage.setItem('token',d.token||'');return 'login-ok'}))`)
  console.log('登录态:', login)

  // 在页面上下文里：找到本地配置中的 AMD 线路 → 调用应用自己的接口同步到账号
  const result = await evaluate(`(async () => {
    let storageKey = '', parsed = null
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      const v = localStorage.getItem(k) || ''
      if (v.includes('developer.amd.com.cn')) { storageKey = k; try { parsed = JSON.parse(v) } catch {} }
    }
    if (!parsed) return 'LOCAL_CONFIG_NOT_FOUND（本地配置里没有 AMD 地址）'
    const routes = parsed.routes || (parsed.value && parsed.value.routes) || []
    const amd = routes.find((r) => /developer\\.amd\\.com\\.cn/.test(r.baseUrl || ''))
    if (!amd) return 'AMD_ROUTE_NOT_FOUND，storageKey=' + storageKey + '，routes=' + routes.length
    const token = localStorage.getItem('token')
    const resp = await fetch('/api/auth/model-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        provider: 'cloud',
        cloudBaseUrl: amd.baseUrl,
        cloudApiKey: amd.apiKey,
        cloudWritingModel: amd.models.writing || '',
        cloudOutlineModel: amd.models.outline || '',
        cloudReasoningModel: amd.models.reasoning || '',
        cloudPolishModel: amd.models.polish || '',
      }),
    })
    const data = await resp.json().catch(() => ({}))
    return JSON.stringify({ syncStatus: resp.status, syncResp: data, baseUrl: amd.baseUrl, writing: amd.models.writing, keyLen: (amd.apiKey || '').length })
  })()`)
  console.log('同步结果:', result)
  ws.close()
}

main().catch((e) => console.log('失败:', e.message))
