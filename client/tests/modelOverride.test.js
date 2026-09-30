import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  LOCAL_CONFIG_KEY,
  readLocalModelConfig,
  writeLocalModelConfig,
  clearLocalModelConfig,
  clearLegacyLocalModelConfig,
  buildModelOverrideHeader,
} from '../src/utils/modelOverride.js'

let storage
let originalStorage
beforeEach(() => {
  originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  storage = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
  })
})
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else delete globalThis.localStorage
})

function login(id, extra = {}) {
  localStorage.setItem('user', JSON.stringify({ id, ...extra }))
  localStorage.setItem('token', `token-${id}`)
}

function config(owner) {
  return {
    version: 2,
    routes: [
      { id: 'main', name: `${owner} 主线`, baseUrl: `https://${owner}.example/v1`, apiKey: `${owner}-secret`, models: { writing: `${owner}-writing` } },
      { id: 'outline', name: `${owner} 大纲`, baseUrl: `https://${owner}.example/v1`, apiKey: `${owner}-outline-secret`, models: { writing: `${owner}-outline` } },
    ],
    defaultRouteId: 'main',
    taskRoutes: { writing: '', outline: 'outline', reasoning: '', polish: '' },
  }
}

function headerConfig() {
  const header = buildModelOverrideHeader()
  return header ? JSON.parse(Buffer.from(header, 'base64').toString('utf8')) : null
}

test('accounts independently save routes, keys, defaults and task assignments across login changes', () => {
  login('alice')
  assert.equal(writeLocalModelConfig(config('alice')), true)
  const alice = readLocalModelConfig()
  assert.deepEqual(headerConfig(), alice)

  login('bob')
  assert.equal(readLocalModelConfig(), null)
  assert.equal(buildModelOverrideHeader(), '')
  const bobConfig = config('bob')
  bobConfig.defaultRouteId = 'outline'
  bobConfig.taskRoutes.outline = 'main'
  assert.equal(writeLocalModelConfig(bobConfig), true)
  const bob = readLocalModelConfig()
  assert.deepEqual(headerConfig(), bob)
  assert.ok(headerConfig().routes.every(route => route.apiKey.startsWith('bob-')))

  localStorage.removeItem('token')
  localStorage.removeItem('user')
  assert.equal(readLocalModelConfig(), null)
  assert.equal(buildModelOverrideHeader(), '')
  login('alice', { email: 'renamed@example.com', nickname: 'New name' })
  assert.deepEqual(readLocalModelConfig(), alice)
  assert.deepEqual(headerConfig(), alice)
  login('bob')
  assert.deepEqual(readLocalModelConfig(), bob)
})

test('clearing one account keeps the other account configuration', () => {
  login('alice')
  writeLocalModelConfig(config('alice'))
  const alice = readLocalModelConfig()
  login('bob')
  writeLocalModelConfig(config('bob'))
  clearLocalModelConfig()
  assert.equal(readLocalModelConfig(), null)
  assert.equal(buildModelOverrideHeader(), '')
  login('alice')
  assert.deepEqual(readLocalModelConfig(), alice)
})

test('startup cleanup removes legacy keys without login and preserves every account configuration', () => {
  for (const id of ['alice', 'bob']) {
    login(id)
    writeLocalModelConfig(config(id))
  }
  localStorage.removeItem('user')
  localStorage.removeItem('token')
  const saved = new Map(storage)
  localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(config('legacy')))
  assert.equal(clearLegacyLocalModelConfig(), true)
  assert.equal(localStorage.getItem(LOCAL_CONFIG_KEY), null)
  assert.deepEqual(storage, saved)
  assert.equal(clearLegacyLocalModelConfig(), true)
  assert.deepEqual(storage, saved)
})

test('reading, writing and clearing remove legacy configuration even without a login', () => {
  for (const operation of [readLocalModelConfig, () => writeLocalModelConfig(config('alice')), clearLocalModelConfig, buildModelOverrideHeader]) {
    localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(config('legacy')))
    operation()
    assert.equal(localStorage.getItem(LOCAL_CONFIG_KEY), null)
    assert.equal(buildModelOverrideHeader(), '')
  }
  login('alice')
  localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(config('legacy')))
  assert.equal(writeLocalModelConfig(config('alice')), true)
  assert.equal(localStorage.getItem(LOCAL_CONFIG_KEY), null)
  assert.ok(headerConfig().routes.every(route => route.apiKey.startsWith('alice-')))
})

test('missing or invalid login identity cannot read, save or clear account keys', () => {
  login('alice')
  writeLocalModelConfig(config('alice'))
  const saved = new Map(storage)
  for (const token of ['', 'undefined', 'null']) {
    localStorage.setItem('token', token)
    assert.equal(readLocalModelConfig(), null)
    assert.equal(writeLocalModelConfig(config('bob')), false)
    clearLocalModelConfig()
  }
  localStorage.setItem('token', 'valid-token')
  for (const user of ['bad-json', 'null', '{}', '{"id":{}}', '{"id":" "}']) {
    localStorage.setItem('user', user)
    assert.equal(readLocalModelConfig(), null)
    assert.equal(writeLocalModelConfig(config('bob')), false)
    clearLocalModelConfig()
  }
  login('alice')
  assert.deepEqual(storage, saved)
})

test('MongoDB _id identity and account-scoped v1 configuration are supported', () => {
  localStorage.setItem('user', JSON.stringify({ _id: 'alice' }))
  localStorage.setItem('token', 'token-alice')
  writeLocalModelConfig({ baseUrl: 'https://alice.example/v1', apiKey: 'alice-secret', models: { writing: 'old-model' } })
  const saved = readLocalModelConfig()
  assert.equal(saved.version, 2)
  assert.equal(saved.routes[0].apiKey, 'alice-secret')
  assert.equal(saved.routes[0].models.writing, 'old-model')
  login('alice')
  assert.deepEqual(readLocalModelConfig(), saved)
})

test('storage failures never fall back to shared configuration or claim to save', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('storage unavailable') },
  })
  assert.equal(readLocalModelConfig(), null)
  assert.equal(clearLegacyLocalModelConfig(), false)
  assert.equal(writeLocalModelConfig(config('alice')), false)
  assert.equal(buildModelOverrideHeader(), '')
  assert.doesNotThrow(() => clearLocalModelConfig())
})
