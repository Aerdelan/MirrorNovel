const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const serverRoot = path.resolve(__dirname, '..');
const webSearchService = require('../services/webSearchService');
const {
  deriveQueries, searchWeb, gatherResearch,
  normalizeLinks, extractReadableText, _clearCache,
} = webSearchService;

// 稳定、可控的取材配置（避免依赖环境变量/数据库覆盖）。
function researchCfg(over = {}) {
  return {
    provider: 'tavily', apiKey: 'test-key',
    maxQueries: 4, maxAutoUrls: 3, maxUserUrls: 6,
    perPageChars: 4000, blockTokenCap: 2500,
    cacheTtlMs: 6 * 60 * 60 * 1000, stepTimeoutMs: 45000, ...over,
  };
}

// 把 aiService 的 completeOnce 换成可控桩（gatherResearch 内部按需 require，缓存命中即生效）。
function mockCompleteOnce(fn) {
  const filename = require.resolve(path.join(serverRoot, 'services/aiService.js'));
  require.cache[filename] = {
    id: filename, filename, loaded: true,
    exports: { completeOnce: fn }, children: [], paths: [],
  };
}

function makeFetch(store) {
  return async (url, options = {}) => {
    store.calls.push({ url, body: options.body });
    if (String(url).includes('throw.test')) throw new Error('network down');
    if (String(url).includes('api.tavily.com/search')) {
      const body = JSON.parse(options.body || '{}');
      store.searchQueries.push(body.query);
      return {
        ok: true,
        json: async () => ({ results: [{ title: '检索页', url: 'http://search.test/r1', content: '检索摘要：坊市制夜间宵禁' }] }),
      };
    }
    if (String(url).startsWith('http://user.test/')) {
      return { ok: true, text: async () => '<html><head><title>用户页面</title></head><body><p>长安城采用里坊制，共有一百零八坊，坊墙环绕、门户宵禁，是唐代都城的典型格局。市场分为东市与西市，是商业贸易的中心，夜间实行严格的宵禁制度，坊门定时开闭。USERMARKER</p></body></html>' };
    }
    if (String(url).startsWith('http://search.test/')) {
      return { ok: true, text: async () => '<html><head><title>检索命中</title></head><body><p>这里是检索命中页面的正文内容，包含足量可抽取的文本以通过最小长度阈值校验，避免被判定为过短而丢弃，用于验证自动检索链路的来源采集与资料拼接是否正确工作。</p></body></html>' };
    }
    return { ok: true, text: async () => '<html><body>short</body></html>' };
  };
}

test.beforeEach(() => { _clearCache(); });

test('deriveQueries：从世界观与题材派生有界检索词', () => {
  const queries = deriveQueries({ typeName: '历史', protagonistName: '林舟', worldSetting: '盛唐，长安城，里坊制，宵禁森严' }, 4);
  assert.ok(Array.isArray(queries) && queries.length > 0 && queries.length <= 4);
  assert.ok(queries.some((q) => q.includes('历史')));
  // 去重
  assert.equal(new Set(queries).size, queries.length);
});

test('searchWeb：provider=none 或未配密钥直接返回空，不触网', async () => {
  const original = global.fetch;
  let touched = false;
  try {
    global.fetch = async () => { touched = true; return {}; };
    assert.deepEqual(await searchWeb('历史 考据', researchCfg({ provider: 'none', apiKey: '' })), []);
    assert.deepEqual(await searchWeb('历史 考据', researchCfg({ provider: 'tavily', apiKey: '' })), []);
    assert.equal(touched, false, '无密钥时不应发起搜索请求');
  } finally { global.fetch = original; }
});

test('normalizeLinks / extractReadableText 基础行为', () => {
  assert.deepEqual(normalizeLinks('http://a.test/x\nhttps://b.test/y，http://a.test/x'), ['http://a.test/x', 'https://b.test/y']);
  assert.deepEqual(normalizeLinks(['javascript:alert(1)', 'not-a-url', 'https://ok.test']), ['https://ok.test']);
  const text = extractReadableText('<script>var x=1;</script><style>p{}</style><h1>标题</h1><p>正文&nbsp;内容&amp;更多</p>');
  assert.ok(!text.includes('var x'));
  assert.match(text, /标题/);
  assert.match(text, /正文 内容&更多/);
});

test('gatherResearch：整合用户链接与检索结果，产出带来源编号的资料块', async () => {
  const original = global.fetch;
  const store = { calls: [], searchQueries: [] };
  try {
    global.fetch = makeFetch(store);
    mockCompleteOnce(async () => '- 唐代长安城采用里坊制（来源1）\n- 坊市夜间实行宵禁（来源2）');
    const res = await gatherResearch({
      type: '历史', protagonistName: '林舟', worldSetting: '盛唐，长安城，里坊制',
      links: ['http://user.test/page'], apiConfig: { baseUrl: 'https://x.test/v1' },
      cfg: researchCfg(),
    });
    assert.equal(res.skipped, false);
    assert.match(res.block, /联网取材参考/);
    assert.match(res.block, /使用约束/);
    assert.match(res.block, /来源1/);
    assert.ok(res.sources.length >= 1);
    assert.ok(res.sources.some((s) => s.url === 'http://user.test/page'), '用户链接必须被收录为来源');
    // 用户链接与检索都发起过请求
    assert.ok(store.calls.some((c) => c.url.includes('api.tavily.com')));
    assert.ok(store.calls.some((c) => c.url.startsWith('http://user.test/')));
  } finally { global.fetch = original; }
});

test('gatherResearch：仅用户链接（无搜索密钥）也会抓取该链接', async () => {
  const original = global.fetch;
  const store = { calls: [], searchQueries: [] };
  try {
    global.fetch = makeFetch(store);
    mockCompleteOnce(async () => ''); // 浓缩失败 → 走兜底要点
    const res = await gatherResearch({
      type: '都市', links: ['http://user.test/page'], cfg: researchCfg({ provider: 'none', apiKey: '' }),
    });
    assert.equal(res.skipped, false);
    assert.ok(res.sources.some((s) => s.url === 'http://user.test/page'));
    assert.ok(store.calls.some((c) => c.url.startsWith('http://user.test/')));
    assert.ok(res.block.includes('来源'), '兜底要点仍带来源编号');
  } finally { global.fetch = original; }
});

test('gatherResearch：上限裁剪生效（maxUserUrls / blockTokenCap）', async () => {
  const original = global.fetch;
  const store = { calls: [], searchQueries: [] };
  try {
    global.fetch = makeFetch(store);
    mockCompleteOnce(async () => '- 事实要点（来源1）');
    const many = ['http://user.test/a', 'http://user.test/b', 'http://user.test/c', 'http://user.test/d'];
    const res = await gatherResearch({ type: '历史', links: many, cfg: researchCfg({ maxUserUrls: 2 }) });
    const userCalls = store.calls.filter((c) => c.url.startsWith('http://user.test/'));
    assert.equal(userCalls.length, 2, '只应抓取 maxUserUrls 个用户链接');
    // 资料块长度受限：cap=blockTokenCap*2
    const cap = researchCfg().blockTokenCap * 2;
    assert.ok(res.block.length <= cap + 32, `资料块应被截断到上限附近，实际 ${res.block.length}`);
  } finally { global.fetch = original; }
});

test('gatherResearch：缓存命中后不再重复抓取同一链接', async () => {
  const original = global.fetch;
  const store = { calls: [], searchQueries: [] };
  try {
    global.fetch = makeFetch(store);
    mockCompleteOnce(async () => '- 事实要点（来源1）');
    const params = { type: '历史', links: ['http://user.test/page'], cfg: researchCfg({ provider: 'none', apiKey: '' }) };
    await gatherResearch(params);
    const firstUserCalls = store.calls.filter((c) => c.url.startsWith('http://user.test/')).length;
    await gatherResearch(params);
    const secondUserCalls = store.calls.filter((c) => c.url.startsWith('http://user.test/')).length - firstUserCalls;
    assert.equal(firstUserCalls, 1);
    assert.equal(secondUserCalls, 0, '第二次应命中缓存，不再抓取');
  } finally { global.fetch = original; }
});

test('gatherResearch：任何异常都降级返回空块且不抛', async () => {
  const original = global.fetch;
  try {
    global.fetch = async (url) => {
      if (String(url).includes('throw.test')) throw new Error('boom');
      throw new Error('boom');
    };
    mockCompleteOnce(async () => { throw new Error('model down'); });
    const res = await gatherResearch({
      type: '历史', links: ['http://throw.test/page'], cfg: researchCfg(),
    });
    assert.equal(res.block, '');
    assert.equal(res.skipped, true);
    assert.deepEqual(res.sources, []);
  } finally { global.fetch = original; }
});
