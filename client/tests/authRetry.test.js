import test from 'node:test'
import assert from 'node:assert/strict'
import { retryAfterSeconds } from '../../shared/authRetry.mjs'

test('uses remaining server seconds from body or case-insensitive headers', () => {
 assert.equal(retryAfterSeconds({ retryAfter: 7 }, { 'Retry-After': '30' }), 7)
 assert.equal(retryAfterSeconds(null, { 'Retry-After': '2' }), 2)
 assert.equal(retryAfterSeconds(null, new Headers({ 'Retry-After': '120' })), 120)
 assert.equal(retryAfterSeconds({ retryAfter: 0 }, { 'retry-after': '1.5' }), 2)
 assert.equal(retryAfterSeconds(null, { 'retry-after': '7200' }), 7200)
})
test('handles HTTP dates and malformed retry values without a stuck timer', () => {
 const now = Date.parse('2026-10-23T00:00:00Z')
 assert.equal(retryAfterSeconds(null, { 'Retry-After': 'Fri, 23 Oct 2026 00:00:05 GMT' }, 30, now), 5)
 assert.equal(retryAfterSeconds(null, { 'retry-after': 'invalid' }), 30)
 assert.equal(retryAfterSeconds({ retryAfter: -1 }), 30)
 assert.equal(retryAfterSeconds({ retryAfter: Infinity }), 30)
})
