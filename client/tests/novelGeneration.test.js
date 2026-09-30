import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { isGenerationActive, useNovelGeneration } from '../src/composables/useNovelGeneration.js'

function fixture({ status = 'paused', fetchJob, fetchNovel } = {}) {
 const novel = ref({ _id: 'book-a', status, currentChapterIndex: 3 })
 const localRunning = ref(false)
 const updates = []
 const monitor = useNovelGeneration({ novel, localRunning,
  fetchJob: fetchJob || (async () => ({ job: null })),
  fetchNovel: fetchNovel || (async id => ({ ...novel.value, _id: id })),
  onNovel: value => updates.push(value),
 })
 return { novel, localRunning, updates, monitor }
}

test('background status, active job and local stream each block duplicate generation', () => {
 for (const status of ['queued', 'running', 'pause_requested']) assert.equal(isGenerationActive({ status: 'paused' }, { status }), true)
 assert.equal(isGenerationActive({ status: 'generating' }, null), true)
 assert.equal(isGenerationActive({ status: 'paused' }, null, true), true)
 for (const status of ['paused', 'completed', 'failed', 'cancelled']) assert.equal(isGenerationActive({ status: 'paused' }, { status }), false)
})

test('ready stays false until first status succeeds; draft updates avoid reloading the full novel', async () => {
 let state = { jobId: 'j1', status: 'running', chapterNumber: 4, lastCommittedChapter: 3, draftLength: 100 }
 let fetches = 0
 const f = fixture({ status: 'generating', fetchJob: async () => ({ job: state }), fetchNovel: async id => { fetches++; return { _id: id, status: 'generating', currentChapterIndex: state.lastCommittedChapter } } })
 try {
  assert.equal(f.monitor.ready.value, false)
  f.monitor.start(); await f.monitor.check()
  assert.equal(f.monitor.ready.value, true)
  assert.equal(f.monitor.busy.value, true)
  assert.equal(fetches, 1)
  state = { ...state, draftLength: 500 }
  await f.monitor.check()
  assert.equal(f.monitor.job.value.draftLength, 500)
  assert.equal(fetches, 1)
  state = { ...state, lastCommittedChapter: 4, chapterNumber: 5 }
  await f.monitor.check()
  assert.equal(f.novel.value.currentChapterIndex, 4)
  assert.equal(fetches, 2)
 } finally { f.monitor.stop() }
})

test('pause request remains busy until server job and novel confirm pause', async () => {
 let status = 'pause_requested'
 const f = fixture({ status: 'generating', fetchJob: async () => ({ job: { jobId: 'j1', status } }), fetchNovel: async id => ({ _id: id, status: status === 'paused' ? 'paused' : 'generating' }) })
 try {
  f.monitor.start(); await f.monitor.check()
  assert.equal(f.monitor.busy.value, true)
  status = 'paused'; await f.monitor.check()
  assert.equal(f.monitor.busy.value, false)
  assert.equal(f.novel.value.status, 'paused')
  assert.equal(f.monitor.ready.value, true)
 } finally { f.monitor.stop() }
})

test('a connection failure never unlocks generation and polling can recover', async () => {
 let failed = false
 const f = fixture({ status: 'generating', fetchJob: async () => { if (failed) throw new Error('offline'); return { job: { jobId: 'j1', status: 'running' } } } })
 try {
  f.monitor.start(); await f.monitor.check()
  failed = true; await f.monitor.check()
  assert.equal(f.monitor.ready.value, false)
  assert.equal(f.monitor.unavailable.value, true)
  assert.equal(f.monitor.busy.value, true)
  failed = false; await f.monitor.check()
  assert.equal(f.monitor.ready.value, true)
  assert.equal(f.monitor.unavailable.value, false)
 } finally { f.monitor.stop() }
})

test('late responses from a deactivated or previous book cannot overwrite the new book', async () => {
 let resolveJob
 const f = fixture({ fetchJob: () => new Promise(resolve => { resolveJob = resolve }) })
 try {
  f.monitor.start()
  const pending = f.monitor.check()
  f.monitor.reset()
  f.novel.value = { _id: 'book-b', status: 'paused' }
  resolveJob({ job: { jobId: 'old-job', status: 'running' } })
  await pending
  assert.equal(f.novel.value._id, 'book-b')
  assert.equal(f.monitor.job.value, null)
  assert.equal(f.monitor.ready.value, false)
  assert.equal(f.updates.length, 0)
 } finally { f.monitor.stop() }
})

test('force refresh checks an idle snapshot again before opening or submitting generation', async () => {
 let status = 'paused'
 const f = fixture({ fetchJob: async () => ({ job: { jobId: 'j1', status } }), fetchNovel: async id => ({ _id: id, status: status === 'running' ? 'generating' : 'paused' }) })
 try {
  f.monitor.start(); await f.monitor.check()
  assert.equal(f.monitor.busy.value, false)
  status = 'running'; await f.monitor.check(true)
  assert.equal(f.monitor.busy.value, true)
 } finally { f.monitor.stop() }
})
