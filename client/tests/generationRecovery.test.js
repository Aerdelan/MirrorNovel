import test from 'node:test'
import assert from 'node:assert/strict'
import { backendGenerationActive, createGenerationRecoveryMonitor, createGenerationSnapshotReader, generationAttemptUiMode, generationErrorMessage, readGenerationAttempt, saveGenerationAttempt } from '../src/utils/generationRecovery.js'

test('recovered expired queued jobs are idle only when the server explicitly confirms no active lease', () => {
 assert.equal(backendGenerationActive({ active: false, job: { status: 'queued' } }), false)
 assert.equal(backendGenerationActive({ active: true, job: null }), true)
 assert.equal(backendGenerationActive({ job: { status: 'running' } }), true)
 assert.equal(backendGenerationActive({ job: { status: 'pause_requested' } }), true)
 assert.equal(backendGenerationActive({ job: { status: 'queued' } }), true)
})

function recoveryFixture(fetchStatus, onStatus) {
 const timers = new Map(), states = [], errors = []
 let nextId = 0
 const monitor = createGenerationRecoveryMonitor({ fetchStatus,
  onStatus: value => { states.push(value); return onStatus?.(value) },
  onUnavailable: error => errors.push(error.message),
  schedule: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, delay }); return id },
  cancel: id => timers.delete(id),
 })
 return { monitor, timers, states, errors,
  async tick() {
   assert.equal(timers.size, 1, 'there is only one task-state polling loop')
   const [id, { fn, delay }] = timers.entries().next().value
   timers.delete(id); await fn(); return delay
  },
 }
}

test('a disconnected generation follows queued/running work through another chapter until explicit completion', async () => {
 const states = [
  { active: true, job: { status: 'queued', chapterNumber: 2 } },
  { active: true, job: { status: 'running', chapterNumber: 2 } },
  { active: true, job: { status: 'running', chapterNumber: 3 } },
  { active: false, novelStatus: 'completed' },
 ]
 let reads = 0
 const f = recoveryFixture(async () => states[reads++], backendGenerationActive)
 await f.monitor.start()
 assert.equal(await f.tick(), 2000)
 assert.equal(await f.tick(), 2000)
 assert.equal(f.states.at(-1).job.chapterNumber, 3)
 assert.equal(await f.tick(), 2000)
 assert.equal(f.timers.size, 0)
 assert.equal(reads, 4)
})

test('temporary task-status failures retry without synthesizing a pause or completion', async () => {
 let offline = true
 const f = recoveryFixture(async () => {
  if (offline) throw Error('brief disconnect')
  return { active: true, job: { status: 'running' } }
 }, backendGenerationActive)
 await f.monitor.start()
 assert.deepEqual(f.states, [])
 assert.deepEqual(f.errors, ['brief disconnect'])
 offline = false
 assert.equal(await f.tick(), 4000)
 assert.equal(f.states[0].job.status, 'running')
 assert.equal(f.timers.size, 1)
 f.monitor.stop()
 assert.equal(f.timers.size, 0)
})

test('responses for a stopped/replaced recovery cannot update state or create extra polling loops', async () => {
 let resolveOld
 const f = recoveryFixture(() => new Promise(resolve => { resolveOld = resolve }))
 const pending = f.monitor.start()
 f.monitor.stop()
 resolveOld({ active: false, novelStatus: 'completed' })
 await pending
 assert.deepEqual(f.states, [])
 assert.equal(f.timers.size, 0)
})

test('an in-flight query failure after leaving recovery cannot schedule more reads', async () => {
 let rejectOld
 const f = recoveryFixture(() => new Promise((resolve, reject) => { rejectOld = reject }))
 const pending = f.monitor.start()
 f.monitor.stop()
 rejectOld(Error('late network failure'))
 await pending
 assert.deepEqual(f.errors, [])
 assert.equal(f.timers.size, 0)
})
test('reload recovery keeps initial inputs account scoped and handles unavailable storage', () => {
 const data = new Map()
 const storage = { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) }
 const attempt = { requestId: 'request-123456789', novelId: 'book', input: { outline: '原稿', enableResearch: false } }
 assert.equal(saveGenerationAttempt('u1', attempt, storage), true)
 assert.equal(readGenerationAttempt('u2', storage), null)
 assert.deepEqual(readGenerationAttempt('u1', storage).input, attempt.input)
 assert.equal(saveGenerationAttempt('u1', null, storage), true)
 assert.equal(readGenerationAttempt('u1', storage), null)
 const broken = { getItem() { throw Error('blocked') }, setItem() { throw Error('full') } }
 assert.equal(readGenerationAttempt('u1', broken), null)
 assert.equal(saveGenerationAttempt('u1', attempt, broken), false)
 assert.equal(saveGenerationAttempt('', attempt, storage), false)
})

test('light-novel attempts retain their original form and legacy attempts infer their tab from type', () => {
 const data = new Map()
 const storage = { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) }
 const input = { novelTypeId: 'lightnovel_school', protagonistName: '悠真（冷酷）', worldSetting: '默认世界', mode: 'book' }
 const attempt = { requestId: 'lightnovel-request-123', input, uiMode: 'lightnovel', uiForm: { charName: '悠真', charTrait: '冷酷', worldSetting: '' } }
 saveGenerationAttempt('u1', attempt, storage)
 const saved = readGenerationAttempt('u1', storage)
 assert.equal(generationAttemptUiMode(saved), 'lightnovel')
 assert.deepEqual(saved.uiForm, attempt.uiForm, 'empty raw fields and separate traits survive; rendered API inputs are not used to reconstruct them')
 assert.equal(generationAttemptUiMode({ input }), 'lightnovel', 'version-1 records without UI metadata remain usable')
 assert.equal(generationAttemptUiMode({ input: { novelTypeId: 'urban' } }), 'generate')
 assert.equal(generationAttemptUiMode({ input, uiMode: 'generate' }), 'generate', 'explicit user view takes precedence')
})

test('job errors render a readable message, never an object string', () => {
 assert.equal(generationErrorMessage(' upstream offline ', 'paused'), 'upstream offline')
 assert.equal(generationErrorMessage({ code: 'NETWORK_ERROR', message: ' 网络异常 ' }, 'paused'), '网络异常')
 assert.equal(generationErrorMessage({ code: 'UNKNOWN' }, 'paused'), 'paused')
 assert.equal(generationErrorMessage(null, 'paused'), 'paused')
})

test('recovery reloads committed progress only when it advances and throttles full-book reads', async () => {
 let clock = 1000, chapter = 1, reads = 0
 const updates = []
 const reader = createGenerationSnapshotReader({
  now: () => clock,
  fetchNovel: async () => { reads++; return { currentChapterIndex: chapter, chapters: [] } },
  onNovel: novel => updates.push(novel.currentChapterIndex),
 })
 assert.equal(await reader.refresh('book', 1), true)
 clock += 2000; chapter = 2
 assert.equal(await reader.refresh('book', 2), false, 'another commit inside the read interval waits')
 clock += 3000
 assert.equal(await reader.refresh('book', 2), true)
 clock += 10000
 assert.equal(await reader.refresh('book', 2), false, 'unchanged drafts never reload the full book')
 chapter = 3
 assert.equal(await reader.refresh('book', 3, { force: true }), true, 'completion can bypass the interval')
 assert.equal(reads, 3)
 assert.deepEqual(updates, [1,2,3])
})

test('a recovery snapshot cannot overwrite a live SSE stream or a previous view', async () => {
 let live = true, valid = true, reads = 0, resolveNovel
 const updates = []
 const reader = createGenerationSnapshotReader({ current: () => valid, canApply: () => !live,
  fetchNovel: () => { reads++; return new Promise(resolve => { resolveNovel = resolve }) }, onNovel: novel => updates.push(novel) })
 assert.equal(await reader.refresh('book', 1), false)
 assert.equal(reads, 0)
 live = false
 const pending = reader.refresh('book', 1)
 valid = false
 resolveNovel({ currentChapterIndex: 1, chapters: [] })
 assert.equal(await pending, false)
 assert.deepEqual(updates, [])
 valid = true
 const pendingLive = reader.refresh('book', 2, { force: true })
 live = true
 resolveNovel({ currentChapterIndex: 2, chapters: [] })
 assert.equal(await pendingLive, false)
 assert.deepEqual(updates, [])
})
