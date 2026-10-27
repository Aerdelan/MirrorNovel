import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const source = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')

function load({ primary = true, packaged = true, args = [] } = {}) {
 const events = new Map(), calls = { quit: 0, ready: 0, lock: [] }
 const app = {
  isPackaged: packaged,
  requestSingleInstanceLock(data) { calls.lock.push(data); return primary },
  quit() { calls.quit++ },
  whenReady() { calls.ready++; return { then() {} } },
  on(name, handler) { events.set(name, handler) },
  isReady() { return false },
 }
 const executable = 'D:\\App\\MirrorNovel.exe'
 const context = vm.createContext({ require: name => name === 'electron' ? { app } : name === 'node:http' ? { createServer() { throw Error('Must reuse the existing local server') } } : require(name),
  __dirname: 'D:\\App\\electron', process: { env: {}, argv: ['app', ...args], execPath: executable, platform: 'win32' }, console })
 vm.runInContext(source, context)
 return { calls, events, executable, context }
}

test('a second packaged launch quits without creating another tray or local server', () => {
 const { calls } = load({ primary: false })
 assert.equal(calls.quit, 1)
 assert.equal(calls.ready, 0)
 assert.equal(calls.lock.length, 1)
})
test('the installer can quit a tray-only instance only for the same executable path', () => {
 const { calls, events, executable } = load()
 assert.equal(calls.ready, 1)
 events.get('second-instance')(null, [], '', { quitForUpdate: true, executable: 'D:\\Other\\MirrorNovel.exe' })
 assert.equal(calls.quit, 0)
 events.get('second-instance')(null, [], '', { quitForUpdate: true, executable })
 assert.equal(calls.quit, 1)
})
test('update-exit invocation never opens a fresh application, and development remains multi-instance', () => {
 const update = load({ args: ['--quit-for-update'] })
 assert.equal(update.calls.quit, 1)
 assert.equal(update.calls.ready, 0)
 const dev = load({ packaged: false })
 assert.equal(dev.calls.lock.length, 0)
 assert.equal(dev.calls.ready, 1)
})
test('a cancelled window quit does not destroy the tray or local API server', () => {
 const { events, context } = load()
 context.cleanup = { tray: 0, connections: 0, server: 0 }
 vm.runInContext('tray = { destroy() { cleanup.tray++ } }; localServer = { closeAllConnections() { cleanup.connections++ }, close() { cleanup.server++ } }', context)
 events.get('before-quit')()
 assert.deepEqual(context.cleanup, { tray: 0, connections: 0, server: 0 })
 events.get('will-quit')()
 assert.deepEqual(context.cleanup, { tray: 1, connections: 1, server: 1 })
})
test('reopening the tray window reuses its existing local server and storage origin', async () => {
 const { context } = load()
 vm.runInContext('localServer = { listening: true, address() { return { port: 39741 } } }', context)
 assert.equal(await vm.runInContext('startLocalServer()', context), 39741)
})
