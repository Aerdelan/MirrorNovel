const test = require('node:test');
const assert = require('node:assert/strict');
const { describeGenerationFailure, describeChapterFailure, redactError } = require('../services/generationError');

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

test('chapter validation failures expose blockers and explain draft preservation', () => {
  const message = describeChapterFailure({ code: 'CHAPTER_CONTRACT_BLOCKED', commitAudit: { blockers: ['正文长度不足'] } }, '通用错误');
  assert.match(message, /正文长度不足/);
  assert.match(message, /草稿已保留/);
  assert.equal(describeChapterFailure(new Error('private details'), '通用错误'), '通用错误');
});
