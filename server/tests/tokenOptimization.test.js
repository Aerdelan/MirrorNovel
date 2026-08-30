const test = require('node:test');
const assert = require('node:assert/strict');

const { renderOutlineForContext } = require('../services/novelContext');
const { recordTokenUsage, usageSnapshot, extractCachedTokens, callUsageStats } = require('../services/tokenUsage');
const { streamGenerate } = require('../services/aiService');

function longOutline(totalChars) {
  const unit = '主角在旧城追查一起旧案，每个阶段都出现新的阻力和线索。';
  const repeats = Math.ceil(totalChars / unit.length);
  const text = unit.repeat(repeats).slice(0, totalChars);
  // 保证结尾有可辨识的终局标记，验证尾部保留。
  return `${text}终局：真相公开，主角承担代价。`;
}

test('short outlines pass through unchanged regardless of progress', () => {
  const outline = '第一幕起因。第二幕升级。第三幕终局。';
  assert.equal(renderOutlineForContext(outline, 1, 40), outline);
  assert.equal(renderOutlineForContext(outline, 40, 40), outline);
});

test('long outlines are tiered by writing progress and shrink monotonically', () => {
  const outline = longOutline(20000);
  const early = renderOutlineForContext(outline, 2, 100);
  const late = renderOutlineForContext(outline, 98, 100);

  assert.ok(early.length < outline.length);
  assert.ok(late.length <= early.length);
  // 头部设定与终局落点都必须保留。
  assert.match(early, /追查一起旧案/);
  assert.match(early, /终局：真相公开/);
  assert.match(late, /终局：真相公开/);
  assert.match(early, /已按当前进度分层省略/);
});

test('outline rendering is byte-stable inside one progress bucket (prefix-cache friendly)', () => {
  const outline = longOutline(20000);
  // 同一进度桶（0-20%）内的不同章节必须渲染出逐字节一致的结果。
  assert.equal(renderOutlineForContext(outline, 5, 100), renderOutlineForContext(outline, 18, 100));
  // 跨桶（20-40%）必须变化，说明分层真的随进度收紧。
  const bucketEarly = renderOutlineForContext(outline, 5, 100);
  const bucketNext = renderOutlineForContext(outline, 25, 100);
  assert.ok(bucketNext.length < bucketEarly.length);
});

test('recordTokenUsage prefers provider usage and extracts cache savings', () => {
  const novel = {};
  recordTokenUsage(novel, 'writing', {
    inputTokens: 5000, tokenCount: 900,
    usage: { prompt_tokens: 5200, completion_tokens: 950, prompt_cache_hit_tokens: 3800 },
  });

  assert.equal(novel.tokenUsage.inputTokens, 5200);
  assert.equal(novel.tokenUsage.outputTokens, 950);
  assert.equal(novel.tokenUsage.cacheSavedTokens, 3800);
  assert.equal(novel.tokenUsage.byRole.writing.calls, 1);
});

test('recordTokenUsage falls back to local estimates and accumulates per role', () => {
  const novel = {};
  recordTokenUsage(novel, 'writing', { inputTokens: 1000, tokenCount: 200 });
  recordTokenUsage(novel, 'reasoning', { inputTokens: 300, tokenCount: 50 });
  recordTokenUsage(novel, 'writing', { inputTokens: 1200, tokenCount: 240 });

  assert.equal(novel.tokenUsage.inputTokens, 2500);
  assert.equal(novel.tokenUsage.outputTokens, 490);
  assert.equal(novel.tokenUsage.byRole.writing.calls, 2);
  assert.equal(novel.tokenUsage.byRole.reasoning.calls, 1);
  // 无服务商数据时缓存节省记为 0，不虚构收益。
  assert.equal(novel.tokenUsage.cacheSavedTokens, 0);
});

test('recordTokenUsage recovers from corrupt ledger shapes and unknown roles', () => {
  const novel = { tokenUsage: [] };
  recordTokenUsage(novel, 'unknown-role', { inputTokens: 10, tokenCount: 5 });
  assert.equal(novel.tokenUsage.byRole.other.inputTokens, 10);

  const broken = { tokenUsage: { inputTokens: 'x', byRole: null } };
  recordTokenUsage(broken, 'polish', { inputTokens: 7, tokenCount: 3 });
  assert.equal(broken.tokenUsage.inputTokens, 7);
  assert.equal(broken.tokenUsage.byRole.polish.inputTokens, 7);
});

test('usageSnapshot exposes plain data without internals', () => {
  const novel = {};
  recordTokenUsage(novel, 'writing', { inputTokens: 100, tokenCount: 20, usage: { prompt_tokens: 110, completion_tokens: 22, prompt_cache_hit_tokens: 80 } });
  const snapshot = usageSnapshot(novel.tokenUsage);
  assert.deepEqual(Object.keys(snapshot).sort(), ['byRole', 'cacheSavedTokens', 'calls', 'inputTokens', 'outputTokens']);
  assert.equal(snapshot.byRole.writing.cacheSavedTokens, 80);
  assert.deepEqual(usageSnapshot(null).byRole, {});
});

test('extractCachedTokens understands both provider conventions', () => {
  assert.equal(extractCachedTokens({ prompt_cache_hit_tokens: 1200 }), 1200);
  assert.equal(extractCachedTokens({ prompt_tokens_details: { cached_tokens: 340 } }), 340);
  assert.equal(extractCachedTokens({ prompt_tokens: 500 }), 0);
  assert.equal(extractCachedTokens(null), 0);
});

test('streamGenerate surfaces provider usage and estimated input tokens', async () => {
  const originalFetch = global.fetch;
  const chunk = `data: ${JSON.stringify({ choices: [{ delta: { content: '他推门进来。' } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 4321, completion_tokens: 12, prompt_cache_hit_tokens: 3000 } })}\n\n`;
  const encoded = new TextEncoder().encode(chunk);
  let reads = 0;
  try {
    global.fetch = async () => ({
      ok: true,
      body: {
        getReader: () => ({
          // 一帧数据后立即 done，模拟服务商在流末尾附带 usage 的行为。
          read: async () => (reads++ === 0 ? { done: false, value: encoded } : { done: true }),
        }),
      },
    });
    const result = await streamGenerate('系统提示', '用户提示', null, null, { baseUrl: 'https://example.test/v1', model: 'test' }, 0);
    assert.equal(result.content, '他推门进来。');
    assert.equal(result.usage.prompt_tokens, 4321);
    assert.equal(result.usage.prompt_cache_hit_tokens, 3000);
    assert.ok(result.inputTokens > 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('callUsageStats exposes single-call numbers for chapter/proposal display', () => {
  // 服务商口径优先
  assert.deepEqual(callUsageStats({
    inputTokens: 5000, tokenCount: 900,
    usage: { prompt_tokens: 5200, completion_tokens: 950, prompt_cache_hit_tokens: 3800 },
  }), { inputTokens: 5200, outputTokens: 950, cacheSavedTokens: 3800 });
  // 无服务商数据时用本地估算，缓存节省为 0（不虚构收益）
  assert.deepEqual(callUsageStats({ inputTokens: 5000, tokenCount: 900 }), {
    inputTokens: 5000, outputTokens: 900, cacheSavedTokens: 0,
  });
  assert.deepEqual(callUsageStats({}), { inputTokens: 0, outputTokens: 0, cacheSavedTokens: 0 });
});

test('auth middleware rejects disabled users with 403 on every protected request', async () => {
  // 禁用拦截必须在每次鉴权时生效，否则已签发的 token 在有效期内
  // 仍能调用所有受保护接口，禁用形同虚设。
  const jwt = require('jsonwebtoken');
  const { Types } = require('mongoose');
  const originalVerify = jwt.verify;
  const authPath = require.resolve('../middleware/auth');

  const fakeUsers = {
    disabled: { _id: new Types.ObjectId(), disabled: true, role: 'user', nickname: '被封' },
    active: { _id: new Types.ObjectId(), disabled: false, role: 'user', nickname: '正常' },
  };
  const UserModule = require('../models/User');
  const originalFindById = UserModule.findById;

  const auth = require('../middleware/auth');
  try {
    // jwt.verify 返回真实 userId；用户记录由 findById 替身提供。
    jwt.verify = () => ({ userId: String(fakeUsers.disabled._id) });
    UserModule.findById = (id) => ({
      select: async () => (String(id) === String(fakeUsers.disabled._id) ? fakeUsers.disabled : fakeUsers.active),
    });

    const makeRes = () => {
      const res = { statusCode: 0, body: null };
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (data) => { res.body = data; return res; };
      return res;
    };
    const req = { headers: { authorization: 'Bearer fake-token' } };

    // 禁用用户：403 + disabled 标记，绝不进入路由处理器
    let reached = false;
    const res1 = makeRes();
    await auth(req, res1, () => { reached = true; });
    assert.equal(reached, false, 'disabled user must not reach the route handler');
    assert.equal(res1.statusCode, 403);
    assert.equal(res1.body.disabled, true);
    assert.match(res1.body.message, /禁用/);

    // 正常用户：放行
    jwt.verify = () => ({ userId: String(fakeUsers.active._id) });
    const res2 = makeRes();
    await auth(req, res2, () => { reached = 'passed'; });
    assert.equal(reached, 'passed');
    assert.equal(res2.statusCode, 0);
  } finally {
    jwt.verify = originalVerify;
    UserModule.findById = originalFindById;
    // 还原被本测试删除的模块缓存（auth 中间件持有 User 模型引用），
    // 但删除 models/User 缓存会导致 mongoose 重复编译模型报错，因此
    // 只重载 auth 中间件本身。
    delete require.cache[authPath];
    require('../middleware/auth');
  }
});
