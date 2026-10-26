import test from 'node:test'
import assert from 'node:assert/strict'
import { backendGenerationActive, readGenerationAttempt, saveGenerationAttempt } from '../src/utils/generationRecovery.js'

test('recovered expired queued jobs are idle only when the server explicitly confirms no active lease', () => {
 assert.equal(backendGenerationActive({ active: false, job: { status: 'queued' } }), false)
 assert.equal(backendGenerationActive({ active: true, job: null }), true)
 assert.equal(backendGenerationActive({ job: { status: 'running' } }), true)
 assert.equal(backendGenerationActive({ job: { status: 'pause_requested' } }), true)
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
