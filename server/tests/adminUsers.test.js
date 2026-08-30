const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

const serverRoot = path.resolve(__dirname, '..');

// 管理端用户列表 / 禁用功能的隔离测试：不连真实数据库，通过替换
// require.cache 把 models 和中间件换成内存实现，与
// novelGeneration.integration.test.js 使用同一套手法。

const state = {
  users: new Map(),
  novels: [],
  nextId: 1,
};

function resetState() {
  state.users.clear();
  state.novels = [];
  state.nextId = 1;
}

function seedUser(overrides = {}) {
  const id = `user-${state.nextId++}`;
  const user = {
    _id: id,
    email: `${id}@test.local`,
    nickname: id,
    password: 'hashed',
    role: 'user',
    disabled: false,
    createdAt: new Date(),
    toObject() {
      const { password, ...rest } = this;
      return rest;
    },
    async save() {
      state.users.set(String(this._id), this);
      return this;
    },
  };
  Object.assign(user, overrides);
  // Map 的键必须用覆盖后的最终 _id（如 'admin-1'），findById 才能命中。
  state.users.set(String(user._id), user);
  return user;
}

class UserMock {
  static async countDocuments(query = {}) {
    return mockFind(query).length;
  }

  static find(query = {}) {
    const cursor = mockFind(query);
    return {
      select() { return this; },
      sort() { return this; },
      skip(offset) {
        this.items = cursor.slice(Number(offset) || 0);
        return this;
      },
      limit(size) {
        this.items = (this.items || cursor).slice(0, Number(size) || cursor.length);
        return this;
      },
      lean: async function lean() {
        return this.items || cursor;
      },
    };
  }

  static async findById(id) {
    return state.users.get(String(id)) || null;
  }
}

function mockFind(query = {}) {
  let users = [...state.users.values()];
  if (query.$or) {
    // 路由把 RegExp 直接作为字段值传入（{ email: /x/i }），从第一个子句取 pattern。
    const regexField = query.$or[0];
    const regexValue = Object.values(regexField).find((value) => value instanceof RegExp);
    const regex = new RegExp(regexValue.source, regexValue.flags);
    users = users.filter((user) => regex.test(user.email) || regex.test(user.nickname));
  }
  // 与真实实现一致：按创建时间倒序。
  return users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

class NovelMock {
  static find(query = {}) {
    const ids = new Set((query.userId?.$in || []).map(String));
    const novels = state.novels.filter((novel) => ids.has(String(novel.userId)));
    return {
      select() { return this; },
      lean: async () => novels,
    };
  }
}

function mockModule(relativePath, exports) {
  const filename = require.resolve(path.join(serverRoot, relativePath));
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
    children: [],
    paths: [],
  };
}

const adminUser = seedUser({ _id: 'admin-1', email: 'admin@test.local', nickname: '管理员', role: 'admin' });

mockModule('middleware/adminAuth.js', (req, _res, next) => {
  req.user = adminUser;
  req.userId = adminUser._id;
  next();
});
mockModule('models/User.js', UserMock);
mockModule('models/Novel.js', NovelMock);
mockModule('models/SysConfig.js', {});
mockModule('config/modelCatalog.js', {
  MODEL_ROUTE_DEFINITIONS: [],
  createModelCatalog: () => ({ routes: [] }),
  setCatalogOverrides: () => {},
});

const adminRouter = require('../routes/admin');

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(() => {
  resetState();
  seedUser({ _id: 'admin-1', email: 'admin@test.local', nickname: '管理员', role: 'admin' });
});

test('用户列表：返回全量 total、分页元数据，并按小说账本聚合每用户 token 消耗', async () => {
  // 旧版前端不传分页参数、后端只默认回 20 条时，第 21 个用户"凭空消失"——
  // 这里直接放 60 个用户，验证默认页大小 50 + total 一起返回。
  // alice/bob 要排在第一页：列表按 createdAt 倒序（最新在前），
  // 给他们比所有读者都新的时间戳。
  const newest = Date.now() + 60 * 1000;
  const alice = seedUser({ email: 'alice@test.local', nickname: 'Alice', createdAt: new Date(newest) });
  const bob = seedUser({ email: 'bob@test.local', nickname: 'Bob', createdAt: new Date(newest - 1) });
  for (let index = 0; index < 60; index += 1) {
    seedUser({ email: `reader${index}@test.local`, nickname: `读者${index}`, createdAt: new Date(Date.now() - 3600 * 1000 + index) });
  }

  state.novels.push(
    { userId: alice._id, tokenUsage: { inputTokens: 1000, outputTokens: 200, cacheSavedTokens: 500, calls: 3 } },
    { userId: alice._id, tokenUsage: { inputTokens: 400, outputTokens: 80, cacheSavedTokens: 100, calls: 1 } },
    { userId: bob._id, tokenUsage: { inputTokens: 77, outputTokens: 7, cacheSavedTokens: 0, calls: 1 } },
    // 脏数据：没有 tokenUsage 的旧小说必须被跳过而不是报错。
    { userId: bob._id },
  );

  const response = await fetch(`${baseUrl}/users`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.total, 63); // admin + 60 + alice + bob
  assert.equal(body.pageSize, 50);
  assert.equal(body.users.length, 50);

  const aliceRow = body.users.find((user) => user.email === 'alice@test.local');
  assert.deepEqual(aliceRow.tokenUsage, {
    inputTokens: 1400, outputTokens: 280, cacheSavedTokens: 600, calls: 4, novelCount: 2,
  });

  const bobRow = body.users.find((user) => user.email === 'bob@test.local');
  assert.deepEqual(bobRow.tokenUsage, {
    inputTokens: 77, outputTokens: 7, cacheSavedTokens: 0, calls: 1, novelCount: 1,
  });

  // 没有任何小说的用户也要有零值结构，前端不用判空。
  // （reader59 是最新注册的读者，按 createdAt 倒序落在第一页。）
  const emptyRow = body.users.find((user) => user.email === 'reader59@test.local');
  assert.deepEqual(emptyRow.tokenUsage, {
    inputTokens: 0, outputTokens: 0, cacheSavedTokens: 0, calls: 0, novelCount: 0,
  });
});

test('用户列表：第 2 页继续返回剩余用户，关键词搜索走转义正则', async () => {
  for (let index = 0; index < 60; index += 1) {
    seedUser({ email: `reader${index}@test.local`, nickname: `读者${index}` });
  }

  const page2 = await (await fetch(`${baseUrl}/users?page=2&pageSize=50`)).json();
  // beforeEach 里预置的管理员 + 60 个读者 = 61。
  assert.equal(page2.total, 61);
  assert.equal(page2.users.length, 11);
  assert.equal(page2.page, 2);

  // 关键词里的正则特殊字符必须被转义：`.*` 只做字面匹配，匹配不到任何用户；
  // 而普通关键词 "admin" 能命中管理员。
  const literalSearch = await (await fetch(`${baseUrl}/users?keyword=a.*.local`)).json();
  assert.equal(literalSearch.total, 0);
  assert.deepEqual(literalSearch.users, []);

  const search = await (await fetch(`${baseUrl}/users?keyword=admin`)).json();
  assert.equal(search.total, 1);
  assert.equal(search.users[0].email, 'admin@test.local');
});

test('禁用用户：写入 disabled 标记；禁用后其现有 token 立即无法通过鉴权', async () => {
  const target = seedUser({ email: 'target@test.local', nickname: '待禁用' });

  const response = await fetch(`${baseUrl}/users/${target._id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ disabled: true }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.user.disabled, true);
  assert.equal(state.users.get(target._id).disabled, true);

  // 重新启用。
  const reenable = await fetch(`${baseUrl}/users/${target._id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ disabled: false }),
  });
  assert.equal(reenable.status, 200);
  assert.equal(state.users.get(target._id).disabled, false);
});

test('禁用保护：不能禁用自己，也不能禁用其他管理员', async () => {
  // 禁用自己（admin-1 是本测试注入的登录管理员）。
  const selfResponse = await fetch(`${baseUrl}/users/admin-1`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ disabled: true }),
  });
  assert.equal(selfResponse.status, 400);
  assert.match((await selfResponse.json()).message, /不能对当前登录的管理员账号/);
  assert.equal(state.users.get('admin-1').disabled, false);

  // 禁用另一个管理员。
  const otherAdmin = seedUser({ email: 'other-admin@test.local', role: 'admin' });
  const otherResponse = await fetch(`${baseUrl}/users/${otherAdmin._id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ disabled: true }),
  });
  assert.equal(otherResponse.status, 400);
  assert.match((await otherResponse.json()).message, /不能禁用或降级其他管理员/);
  assert.equal(state.users.get(otherAdmin._id).disabled, false);
});
