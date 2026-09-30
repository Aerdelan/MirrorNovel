const test = require('node:test');
const assert = require('node:assert/strict');
const { describeGenerationFailure, redactError } = require('../services/generationError');

test('unexpected errors expose only phase and reference, not internal details', () => {
  const failure = describeGenerationFailure(new Error('private database details'), 'saving_novel', 'test-id');
  assert.equal(failure.status, 500);
  assert.match(failure.message, /保存新作品失败/);
  assert.match(failure.message, /test-id/);
  assert.doesNotMatch(failure.message, /private/);
});

test('database, validation and lease errors have distinct actionable responses', () => {
  const dbError = Object.assign(new Error('private host'), { name: 'MongooseServerSelectionError' });
  assert.match(describeGenerationFailure(dbError, 'saving_novel', 'id').message, /数据库暂时不可用/);
  assert.equal(describeGenerationFailure({ name: 'ValidationError' }, 'saving_novel', 'id').status, 400);
  assert.equal(describeGenerationFailure({ code: 'GENERATION_LEASE_BUSY' }, 'starting_job', 'id').status, 409);
});

test('API error messages and diagnostic logs redact credentials', () => {
  const privateText = 'sk_tr_fake-secret Bearer fake-token apiKey=fake-key mongodb://user:fake-pass@localhost/db';
  assert.doesNotMatch(redactError(privateText), /fake-/);
  assert.doesNotMatch(redactError('{"apiKey":"fake-secret","password": "fake-pass"}'), /fake-/);
  const failure = describeGenerationFailure({ isApiError: true, message: '额度不足 sk_tr_fake-secret' }, 'outline', 'id');
  assert.equal(failure.status, 503);
  assert.match(failure.message, /额度不足/);
  assert.doesNotMatch(failure.message, /fake-secret/);
});
