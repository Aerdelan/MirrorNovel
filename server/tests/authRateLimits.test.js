const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { applyAuthRateLimits } = require('../middleware/authRateLimits');

async function withApp(run, options = {}) {
  const app = express();
  app.use(express.json());
  applyAuthRateLimits(app, { sendLimit: 2, loginLimit: 2, windowMs: 30000, ...options });
  app.post('/api/auth/login', (req, res) => res.status(req.body.success ? 200 : 400).json({ ok: Boolean(req.body.success) }));
  app.post('/api/auth/:action', (_req, res) => res.json({ ok: true }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  async function request(action, body = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  try { await run(request); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('send cap returns an actionable 429 but never blocks registration or password-reset submission', async () => {
  await withApp(async request => {
    assert.equal((await request('send-code')).status, 200);
    assert.equal((await request('send-reset-code')).status, 200);
    const limited = await request('send-code');
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'EMAIL_CODE_RATE_LIMITED');
    assert.ok(limited.body.retryAfter > 0 && limited.body.retryAfter <= 30);
    assert.equal(limited.headers.get('retry-after'), String(limited.body.retryAfter));
    for (let i = 0; i < 5; i++) {
      assert.equal((await request('reset-password')).status, 200);
      assert.equal((await request('register')).status, 200);
    }
    assert.equal((await request('login', { email: 'reader@example.com', success: true })).status, 200);
  });
});

test('login failures are isolated by normalized email and IP and do not consume the mail quota', async () => {
  await withApp(async request => {
    for (let i = 0; i < 2; i++) assert.equal((await request('login', { email: 'Reader@Example.com' })).status, 400);
    const limited = await request('login', { email: ' reader@example.COM ' });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'LOGIN_RATE_LIMITED');
    assert.equal((await request('login', { email: 'other@example.com' })).status, 400);
    assert.equal((await request('send-code')).status, 200);
    assert.equal((await request('register')).status, 200);
  });
});

test('successful logins do not accumulate toward the failure limit', async () => {
  await withApp(async request => {
    for (let i = 0; i < 5; i++) assert.equal((await request('login', { email: 'reader@example.com', success: true })).status, 200);
    assert.equal((await request('login', { email: 'reader@example.com' })).status, 400);
  });
});

test('the broad failed-login IP ceiling still protects against guessing across many accounts', async () => {
  await withApp(async request => {
    assert.equal((await request('login', { email: 'one@example.com' })).status, 400);
    assert.equal((await request('login', { email: 'two@example.com' })).status, 400);
    assert.equal((await request('login', { email: 'three@example.com' })).status, 429);
    assert.equal((await request('send-code')).status, 200);
    assert.equal((await request('register')).status, 200);
  }, { loginIpLimit: 2, loginLimit: 30 });
});
