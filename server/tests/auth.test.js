const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Exercise the real router and both auth middlewares without SMTP or a live DB.
const state = { users: [], codes: [], sent: [], mailReady: true, mailFails: false, nextId: 0 };
function matches(doc, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(part => matches(doc, part));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.entries(value).every(([operator, expected]) => {
        if (operator === '$gt') return doc[key] > expected;
        if (operator === '$lt') return doc[key] < expected;
        if (operator === '$lte') return doc[key] <= expected;
        if (operator === '$ne') return String(doc[key]) !== String(expected);
        if (operator === '$exists') return (doc[key] !== undefined) === expected;
        throw new Error(`Unsupported operator: ${operator}`);
      });
    }
    return String(doc[key]) === String(value);
  });
}
class User {
  constructor(data) { Object.assign(this, { _id: `user-${++state.nextId}`, authVersion: 0, role: 'user' }, data); }
  async save() {
    if (!String(this.password).startsWith('$2')) this.password = await bcrypt.hash(this.password, 4);
    if (!state.users.includes(this)) state.users.push(this);
    return this;
  }
  comparePassword(password) { return bcrypt.compare(password, this.password); }
  static async findOne(query) { return state.users.find(user => matches(user, query)) || null; }
  static findById(id) { return { select: async () => state.users.find(user => user._id === id) || null }; }
}
class VerificationCode {
  constructor(data) { Object.assign(this, { _id: `code-${++state.nextId}`, createdAt: new Date(), attempts: 0 }, data); }
  async save() { state.codes.push(this); return this; }
  static create(data) { return new VerificationCode(data).save(); }
  static async findOne(query) { return state.codes.find(doc => matches(doc, query)) || null; }
  static async findOneAndUpdate(query, update) {
    if (update.$set) {
      const existing = state.codes.find(doc => doc.deliveryKey === query.deliveryKey);
      if (existing && !matches(existing, query)) throw Object.assign(new Error('duplicate delivery slot'), { code: 11000 });
      const doc = existing || new VerificationCode({ deliveryKey: query.deliveryKey });
      Object.assign(doc, update.$set);
      if (!existing) state.codes.push(doc);
      return { ...doc };
    }
    const doc = state.codes.filter(doc => matches(doc, query)).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!doc) return null;
    doc.attempts = (doc.attempts || 0) + update.$inc.attempts;
    return { ...doc };
  }
  static async findOneAndDelete(query) {
    const index = state.codes.findIndex(doc => matches(doc, query));
    return index < 0 ? null : state.codes.splice(index, 1)[0];
  }
  static async deleteOne(query) { return { deletedCount: await this.findOneAndDelete(query) ? 1 : 0 }; }
  static async deleteMany(query) { state.codes = state.codes.filter(doc => !matches(doc, query)); }
}
function mock(modulePath, exports) {
  const filename = require.resolve(modulePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
mock('../models/User', User);
mock('../models/VerificationCode', VerificationCode);
mock('../services/aiService', { getFriendlyErrorMessage() {}, normalizeBaseUrl: value => value });
mock('../services/emailService', {
  startEmailHealthCheck() {},
  isEmailReady: () => state.mailReady,
  async sendVerificationCode(email, code, type) {
    if (state.mailFails) throw new Error('SMTP unavailable');
    state.sent.push({ email, code, type });
  },
});
process.env.JWT_SECRET = 'isolated-auth-regression-test-secret';
// A production misconfiguration must never expose reset codes.
process.env.NODE_ENV = 'production';
process.env.EMAIL_RETURN_CODE_ON_FAILURE = 'true';
delete process.env.JWT_EXPIRES_IN;

let server, base;
test.before(async () => {
  const app = express();
  app.use(express.json());
  require('../middleware/authRateLimits').applyAuthRateLimits(app);
  app.use('/auth', require('../routes/auth'));
  app.get('/admin', require('../middleware/adminAuth'), (_req, res) => res.json({ ok: true }));
  server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); });
test.beforeEach(() => {
  Object.assign(state, { users: [], codes: [], sent: [], mailReady: true, mailFails: false, nextId: 0 });
});
async function request(path, data, token) {
  const response = await fetch(base + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function seedUser(data = {}) { return new User({ email: 'reader@example.com', password: 'old-secret', ...data }).save(); }
async function seedCode(data = {}) {
  return VerificationCode.create({ email: 'reader@example.com', type: 'register', code: '123456', expiresAt: new Date(Date.now() + 600000), ...data });
}
const registration = { email: 'reader@example.com', password: 'new-secret', code: '123456' };

test('register → login → reset → new login; normalized emails, hash, expiry and session revocation', async () => {
  const sent = await request('/auth/send-code', { email: ' Reader@Example.COM ' });
  assert.equal(sent.body.emailSent, true);
  const code = state.sent[0].code;
  assert.match(code, /^\d{6}$/);
  assert.equal(state.sent[0].email, 'reader@example.com');
  const registered = await request('/auth/register', { ...registration, email: ' READER@EXAMPLE.com ', code });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.nickname, '书友');
  assert.equal(state.codes.length, 0);
  assert.notEqual(state.users[0].password, registration.password);
  const claims = jwt.verify(registered.body.token, process.env.JWT_SECRET);
  assert.ok(claims.exp > claims.iat);
  assert.equal((await request('/auth/profile', undefined, registered.body.token)).status, 200);
  const login = await request('/auth/login', { email: ' Reader@EXAMPLE.com ', password: registration.password });
  assert.equal(login.status, 200);
  await request('/auth/send-reset-code', { email: ' READER@example.COM ' });
  const resetCode = state.sent.at(-1).code;
  const reset = await request('/auth/reset-password', { email: 'reader@example.com', code: resetCode, password: 'reset-secret' });
  assert.equal(reset.status, 200);
  assert.equal(state.codes.length, 0);
  assert.equal((await request('/auth/profile', undefined, login.body.token)).status, 401);
  assert.equal((await request('/auth/login', { email: registration.email, password: registration.password })).status, 400);
  assert.equal((await request('/auth/login', { email: registration.email, password: 'reset-secret' })).status, 200);
  assert.equal((await request('/auth/reset-password', { email: registration.email, code: resetCode, password: 'replayed-secret' })).status, 400);
});

test('both middlewares accept legacy tokens until a password reset and reject them afterwards', async () => {
  const user = await seedUser({ role: 'admin' });
  const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
  assert.equal((await request('/auth/profile', undefined, token)).status, 200);
  assert.equal((await request('/admin', undefined, token)).status, 200);
  await seedCode({ type: 'reset' });
  assert.equal((await request('/auth/reset-password', { ...registration })).status, 200);
  assert.equal((await request('/auth/profile', undefined, token)).status, 401);
  assert.equal((await request('/admin', undefined, token)).status, 401);
});

test('invalid payloads never reach account creation or consume valid codes', async () => {
  await seedCode();
  for (const body of [
    { ...registration, email: { $ne: null } }, { ...registration, email: 'bad-address' },
    { ...registration, password: {} }, { ...registration, password: 'short' },
    { ...registration, password: '中'.repeat(25) }, { ...registration, code: { $ne: null } },
    { ...registration, code: 'abc123' }, { ...registration, nickname: 'x'.repeat(21) },
  ]) assert.equal((await request('/auth/register', body)).status, 400, JSON.stringify(body));
  assert.equal(state.users.length, 0);
  assert.equal(state.codes[0].attempts, 0);
  for (const endpoint of ['send-code', 'send-reset-code']) {
    assert.equal((await request(`/auth/${endpoint}`, { email: ['reader@example.com'] })).status, 400);
  }
  assert.equal((await request('/auth/login', { email: registration.email, password: {} })).status, 400);
});

test('ten wrong guesses lock out a code, including legacy records without an attempts field', async () => {
  const doc = await seedCode();
  delete doc.attempts;
  for (let i = 0; i < 10; i++) assert.equal((await request('/auth/register', { ...registration, code: '000000' })).status, 400);
  assert.equal(doc.attempts, 10);
  assert.equal((await request('/auth/register', registration)).status, 400);
  assert.equal(state.users.length, 0);
});

test('codes are bound to email and purpose, and expiry is checked before TTL cleanup', async () => {
  await seedUser();
  await seedCode({ expiresAt: new Date(Date.now() - 1), type: 'reset' });
  assert.equal((await request('/auth/reset-password', registration)).status, 400);
  state.codes = [];
  await seedCode();
  assert.equal((await request('/auth/reset-password', registration)).status, 400);
  assert.equal((await request('/auth/register', { ...registration, email: 'other@example.com' })).status, 400);
  assert.equal(state.codes[0].attempts, 0);
});

test('concurrent registrations consume a code only once', async () => {
  await seedCode();
  const replies = await Promise.all(Array.from({ length: 4 }, () => request('/auth/register', registration)));
  assert.equal(replies.filter(reply => reply.status === 201).length, 1);
  assert.equal(state.users.length, 1);
});

test('concurrent resets consume a code only once', async () => {
  await seedUser();
  await seedCode({ type: 'reset' });
  const replies = await Promise.all(Array.from({ length: 4 }, () => request('/auth/reset-password', registration)));
  assert.equal(replies.filter(reply => reply.status === 200).length, 1);
  assert.equal(state.users[0].authVersion, 1);
});

test('failed SMTP does not report success, disclose a code or block immediate retry', async () => {
  await seedUser();
  state.mailFails = true;
  for (const endpoint of ['send-code', 'send-reset-code']) {
    const email = endpoint === 'send-code' ? 'new@example.com' : registration.email;
    const result = await request(`/auth/${endpoint}`, { email });
    assert.equal(result.status, 200);
    assert.equal(result.body.emailSent, false);
    assert.equal(result.body.code, undefined);
    assert.equal(state.codes.length, 0);
  }
  state.mailFails = false;
  assert.equal((await request('/auth/send-code', { email: 'new@example.com' })).body.emailSent, true);
});

test('repeated sends return a normal cooldown response without invalidating the delivered code', async () => {
  const first = await request('/auth/send-code', { email: registration.email });
  assert.equal(first.body.emailSent, true);
  const originalCode = state.codes[0].code;
  const again = await request('/auth/send-code', { email: ' READER@EXAMPLE.COM ' });
  assert.equal(again.status, 200);
  assert.equal(again.body.cooldown, true);
  assert.ok(again.body.retryAfter > 0 && again.body.retryAfter <= 30);
  assert.equal(again.headers.get('retry-after'), String(again.body.retryAfter));
  assert.equal(state.sent.length, 1);
  assert.equal(state.codes[0].code, originalCode);
});

test('concurrent sends reserve one code and one email, and resend replaces an older slot', async () => {
  const replies = await Promise.all(Array.from({ length: 4 }, () => request('/auth/send-code', { email: registration.email })));
  assert.equal(replies.filter(reply => reply.status === 200).length, 4);
  assert.equal(replies.filter(reply => reply.body.emailSent === true).length, 1);
  assert.equal(replies.filter(reply => reply.body.cooldown).length, 3);
  assert.equal(state.sent.length, 1);
  assert.equal(state.codes.length, 1);
  const slot = state.codes[0];
  slot.createdAt = new Date(Date.now() - 31000);
  slot.attempts = 10;
  assert.equal((await request('/auth/send-code', { email: registration.email })).status, 200);
  assert.equal(state.codes.length, 1);
  assert.equal(state.sent.length, 2);
  assert.equal(slot.attempts, 0);
});

test('more than ten sends from one IP do not block another user or a delivered code submission', async () => {
  for (let i = 0; i < 12; i++) {
    const response = await request('/auth/send-code', { email: `reader${i}@example.com` });
    assert.equal(response.status, 200);
    assert.equal(response.body.emailSent, true);
    assert.equal(response.body.retryAfter, 30);
  }
  await seedCode();
  assert.equal((await request('/auth/register', registration)).status, 201);
});

test('a correct code remains usable after several typos', async () => {
  await seedCode();
  for (let i = 0; i < 6; i++) assert.equal((await request('/auth/register', { ...registration, code: '000000' })).status, 400);
  assert.equal((await request('/auth/register', registration)).status, 201);
});

test('cooldown reports only its remaining seconds rather than restarting the full wait', async () => {
  await seedCode({ createdAt: new Date(Date.now() - 24000) });
  const reply = await request('/auth/send-code', { email: registration.email });
  assert.equal(reply.status, 200);
  assert.ok(reply.body.retryAfter > 0 && reply.body.retryAfter <= 6);
  assert.equal(state.sent.length, 0);
});

test('duplicate account, wrong password, nonexistent account and disabled account are handled', async () => {
  const user = await seedUser({ disabled: true });
  assert.equal((await request('/auth/send-code', { email: user.email })).status, 400);
  assert.equal((await request('/auth/register', registration)).status, 400);
  assert.equal((await request('/auth/login', { email: user.email, password: 'wrong-password' })).status, 400);
  assert.equal((await request('/auth/login', { email: user.email, password: 'old-secret' })).status, 403);
  assert.equal((await request('/auth/send-reset-code', { email: 'unknown@example.com' })).status, 200);
  assert.equal(state.sent.length, 0);
});
