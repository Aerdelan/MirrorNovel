import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { once } from 'node:events'

const require = createRequire(import.meta.url)
const source = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')

async function listen(server) {
 server.listen(0, '127.0.0.1')
 await once(server, 'listening')
 return `http://127.0.0.1:${server.address().port}`
}
async function close(server) {
 server.closeAllConnections()
 await new Promise(resolve => server.close(resolve))
}
function loadProxy(target) {
 const app = { isPackaged: false, quit() {}, on() {}, whenReady() { return { then() {} } } }
 const context = vm.createContext({ require: name => name === 'electron' ? { app } : require(name),
  __dirname: 'D:\\Test\\electron', process: { env: { MN_API_TARGET: target }, argv: [], platform: 'win32' }, console })
 vm.runInContext(source, context)
 return vm.runInContext('proxyApi', context)
}

test('a backend SSE reset fails promptly instead of leaving the desktop stream hanging', { timeout: 5000 }, async () => {
 const backend = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.write('data: {"type":"chapter_start","chapterNumber":2}\n\n')
  setTimeout(() => res.destroy(), 50)
 })
 const target = await listen(backend)
 const proxy = http.createServer(loadProxy(target))
 const origin = await listen(proxy)
 try {
  const response = await fetch(`${origin}/api/novel/continue/test`, { method: 'POST' })
  assert.equal(response.status, 200)
  const reader = response.body.getReader()
  const first = await reader.read()
  assert.match(new TextDecoder().decode(first.value), /chapter_start/)
  await assert.rejects(reader.read(), /terminated|aborted|reset|network/i)
 } finally { await close(proxy); await close(backend) }
})

test('closing the renderer stream detaches the upstream SSE without waiting for more data', { timeout: 5000 }, async () => {
 let closed
 const didClose = new Promise(resolve => { closed = resolve })
 const backend = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.write('data: {"type":"status","message":"thinking"}\n\n')
  res.on('close', closed)
 })
 const target = await listen(backend)
 const proxy = http.createServer(loadProxy(target))
 const origin = await listen(proxy)
 try {
  const response = await fetch(`${origin}/api/novel/generation-job/test/events`)
  const reader = response.body.getReader()
  assert.equal((await reader.read()).done, false)
  await reader.cancel()
  await didClose
 } finally { await close(proxy); await close(backend) }
})

test('a finished POST upload keeps streaming multiple chapters and a terminal event', { timeout: 5000 }, async () => {
 let received = ''
 const backend = http.createServer((req, res) => {
  req.setEncoding('utf8')
  req.on('data', chunk => { received += chunk })
  req.on('end', () => {
   res.writeHead(200, { 'content-type': 'text/event-stream' })
   res.write('data: {"type":"chapter_completed","chapterNumber":1}\n\n')
   setTimeout(() => {
    res.write('data: {"type":"chapter_completed","chapterNumber":2}\n\n')
    res.end('data: {"type":"completed"}\n\n')
   }, 30)
  })
 })
 const target = await listen(backend)
 const proxy = http.createServer(loadProxy(target))
 const origin = await listen(proxy)
 try {
  const response = await fetch(`${origin}/api/novel/generate`, { method: 'POST',
   headers: { 'content-type': 'application/json' }, body: '{"mode":"book"}' })
  const body = await response.text()
  assert.equal(received, '{"mode":"book"}')
  assert.match(body, /"chapterNumber":1/)
  assert.match(body, /"chapterNumber":2/)
  assert.match(body, /"type":"completed"/)
  assert.equal(response.headers.get('x-accel-buffering'), 'no')
 } finally { await close(proxy); await close(backend) }
})

test('failure before response headers remains a readable 502 JSON error', { timeout: 5000 }, async () => {
 const backend = http.createServer((_req, res) => res.destroy())
 const target = await listen(backend)
 const proxy = http.createServer(loadProxy(target))
 const origin = await listen(proxy)
 try {
  const response = await fetch(`${origin}/api/novel/generate`, { method: 'POST' })
  assert.equal(response.status, 502)
  assert.match((await response.json()).message, /无法连接后端/)
 } finally { await close(proxy); await close(backend) }
})
