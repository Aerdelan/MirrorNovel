const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-local-model-config';

const { seal, open, hintOf, isSealed } = require('../services/secretBox');
const {
  HEADER_NAME,
  normalizeLocalModelConfig,
  parseOverrideHeader,
  mergeModelConfig,
  encodeOverrideHeader,
} = require('../services/localModelConfig');
const { toPublicModelConfig } = require('../config/modelCatalog');
const { resolveApiConfig } = require('../services/aiService');

test('模型密钥加密后不可读，解密可还原，历史明文原样兼容', () => {
  const plain = 'sk-abcdef1234567890';
  const sealed = seal(plain);
  assert.equal(isSealed(sealed), true);
  assert.ok(!sealed.includes(plain), '密文中不得出现明文');
  assert.equal(open(sealed), plain);
  // 未加密的历史数据（老账号）必须原样返回，否则升级后老用户会突然不可用
  assert.equal(open('legacy-plain-key'), 'legacy-plain-key');
  // 空值不加密，避免"看起来已配置"
  assert.equal(seal(''), '');
  assert.equal(open(''), '');
});

test('密钥提示只暴露尾部 4 位', () => {
  assert.equal(hintOf('sk-abcdef1234567890'), '****7890');
  assert.equal(hintOf('abc'), '****');
  assert.equal(hintOf(''), '');
});

test('本地模型配置校验：地址必须是 http(s)、至少有一个模型', () => {
  assert.equal(normalizeLocalModelConfig(null).ok, false);
  assert.equal(normalizeLocalModelConfig({ baseUrl: 'ftp://x', models: { writing: 'm' } }).ok, false);
  assert.equal(normalizeLocalModelConfig({ baseUrl: 'https://api.example.com/v1', models: {} }).ok, false);

  const ok = normalizeLocalModelConfig({
    baseUrl: 'https://api.example.com/v1/',
    apiKey: 'sk-1',
    models: { writing: 'glm-4.7', reasoning: 'deepseek-reasoner' },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.config.provider, 'cloud');
  assert.equal(ok.config.cloudWritingModel, 'glm-4.7');
  assert.equal(ok.config.cloudReasoningModel, 'deepseek-reasoner');
});

test('只填了大纲模型时用其兜底写作模型，避免请求落空', () => {
  const result = normalizeLocalModelConfig({ baseUrl: 'https://api.example.com/v1', models: { outline: 'glm-4.6' } });
  assert.equal(result.ok, true);
  assert.equal(result.config.cloudWritingModel, 'glm-4.6');
});

test('请求头解析：base64 往返可用，坏数据不抛异常', () => {
  const header = encodeOverrideHeader({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-header',
    models: { writing: '中文模型名' },
  });
  const parsed = parseOverrideHeader(header);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.config.cloudApiKey, 'sk-header');
  assert.equal(parsed.config.cloudWritingModel, '中文模型名');

  assert.equal(parseOverrideHeader(undefined).ok, false);
  assert.equal(parseOverrideHeader(Buffer.from('not-json').toString('base64')).ok, false);
  assert.equal(parseOverrideHeader('x'.repeat(13 * 1024)).ok, false, '超长头部必须拒绝');
});

test('合并配置：本地只覆盖模型字段，线路管理字段仍以账号为准', () => {
  const merged = mergeModelConfig(
    { provider: 'system', routeId: 'vip', roleRoutes: { writing: 'svip' } },
    { provider: 'cloud', cloudBaseUrl: 'https://own.example.com/v1', cloudApiKey: 'sk-own', cloudWritingModel: 'm' },
  );
  assert.equal(merged.provider, 'cloud');
  assert.equal(merged.routeId, 'vip');
  assert.deepEqual(merged.roleRoutes, { writing: 'svip' });
  assert.equal(merged.cloudBaseUrl, 'https://own.example.com/v1');
  assert.equal(merged.source, 'local');
});

test('对外模型配置绝不回传密钥，只回"已配置 + 尾部提示"', () => {
  const publicConfig = toPublicModelConfig({
    provider: 'cloud',
    cloudBaseUrl: 'https://own.example.com/v1',
    cloudApiKey: seal('sk-secret-value-1234'),
    cloudWritingModel: 'glm-4.7',
  });
  assert.equal(publicConfig.provider, 'cloud');
  assert.equal(publicConfig.apiKeyConfigured, true);
  assert.equal(publicConfig.apiKeyHint, '****1234');
  assert.equal(publicConfig.models.writing, 'glm-4.7');
  assert.ok(!('cloudApiKey' in publicConfig), '对外结构里不允许出现密钥字段');
  assert.ok(!JSON.stringify(publicConfig).includes('sk-secret-value'), '序列化结果不得包含明文');
});

// ===== 多线路（v2）：桌面端"多个线路 + 任务分配" =====

function multiRouteHeader() {
  return encodeOverrideHeader({
    version: 2,
    defaultRouteId: 'r-strong',
    taskRoutes: { writing: 'r-cheap' },
    routes: [
      { id: 'r-cheap', name: '便宜线路', baseUrl: 'https://cheap.example.com/v1', apiKey: 'sk-cheap', models: { writing: 'glm-4.7' } },
      { id: 'r-strong', name: '强模型', baseUrl: 'https://strong.example.com/v1', apiKey: 'sk-strong', models: { outline: 'deepseek-reasoner', writing: 'deepseek-chat' } },
    ],
  });
}

test('多线路：每个任务按分配走各自线路，地址/密钥/模型互相独立', () => {
  const parsed = parseOverrideHeader(multiRouteHeader());
  assert.equal(parsed.ok, true);
  const merged = mergeModelConfig({ provider: 'system', routeId: 'vip' }, parsed.config);

  // 写作指定了便宜线路
  const writing = resolveApiConfig(merged, 'writing');
  assert.equal(writing.baseUrl, 'https://cheap.example.com/v1');
  assert.equal(writing.apiKey, 'sk-cheap');
  assert.equal(writing.model, 'glm-4.7');

  // 大纲未指定 → 跟随默认线路（强模型）
  const outline = resolveApiConfig(merged, 'outline');
  assert.equal(outline.baseUrl, 'https://strong.example.com/v1');
  assert.equal(outline.apiKey, 'sk-strong');
  assert.equal(outline.model, 'deepseek-reasoner');

  // 润色在默认线路里没填 → 跟随该线路的写作模型
  assert.equal(resolveApiConfig(merged, 'polish').model, 'deepseek-chat');

  // 账号的线路管理字段不被本地覆盖
  assert.equal(merged.routeId, 'vip');
  assert.equal(merged.source, 'local');
});

test('多线路：任务指向不存在的线路时回退默认线路，脏数据不会打到空配置', () => {
  const header = encodeOverrideHeader({
    version: 2,
    defaultRouteId: 'r-a',
    taskRoutes: { outline: '不存在的线路' },
    routes: [{ id: 'r-a', baseUrl: 'https://a.example.com/v1', apiKey: 'sk-a', models: { writing: 'm1' } }],
  });
  const parsed = parseOverrideHeader(header);
  assert.equal(parsed.ok, true);
  const merged = mergeModelConfig(null, parsed.config);
  const outline = resolveApiConfig(merged, 'outline');
  assert.equal(outline.baseUrl, 'https://a.example.com/v1');
  assert.equal(outline.model, 'm1');
});

test('多线路：条数与头部体积都有上限，超限整体拒绝（防止请求头撑爆 431）', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({
    id: `r${i}`,
    baseUrl: `https://a${i}.example.com/v1`,
    apiKey: 'sk',
    models: { writing: 'm' },
  }));
  assert.equal(parseOverrideHeader(encodeOverrideHeader({ version: 2, routes: many })).ok, false);
  assert.equal(parseOverrideHeader('x'.repeat(13 * 1024)).ok, false);
});

test('多线路：缺少密钥的线路不会下发，交由账号/服务端配置兜底并给出明确报错', () => {
  const parsed = parseOverrideHeader(encodeOverrideHeader({
    version: 2,
    routes: [{ id: 'r1', baseUrl: 'https://a.example.com/v1', apiKey: '', models: { writing: 'm' } }],
  }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.config.localRoleConfigs, {});
  // 回退到账号的单线路配置 → 缺密钥时抛明确错误，而不是静默用空密钥请求上游
  const merged = mergeModelConfig(null, parsed.config);
  assert.throws(() => resolveApiConfig(merged, 'writing'), /配置不完整/);
});

test('单线路（v1 旧客户端）仍可用，并按任务生成等价线路', () => {
  const parsed = parseOverrideHeader(encodeOverrideHeader({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-1',
    models: { writing: 'w-model', reasoning: 'r-model' },
  }));
  assert.equal(parsed.ok, true);
  const merged = mergeModelConfig(null, parsed.config);
  assert.equal(resolveApiConfig(merged, 'writing').model, 'w-model');
  assert.equal(resolveApiConfig(merged, 'reasoning').model, 'r-model');
  assert.equal(resolveApiConfig(merged, 'reasoning').baseUrl, 'https://api.example.com/v1');
});

test('鉴权中间件：本地配置只在本次请求生效，绝不写回用户文档', async () => {
  const jwt = require('jsonwebtoken');
  const UserModule = require('../models/User');
  const authPath = require.resolve('../middleware/auth');

  const originalVerify = jwt.verify;
  const originalFindById = UserModule.findById;
  const accountConfig = { provider: 'system', routeId: 'vip', roleRoutes: { writing: 'svip' } };
  const fakeUser = { _id: 'user-1', disabled: false, role: 'user', modelConfig: accountConfig };

  try {
    jwt.verify = () => ({ userId: 'user-1' });
    UserModule.findById = () => ({ select: async () => fakeUser });

    const header = encodeOverrideHeader({
      baseUrl: 'https://own.example.com/v1',
      apiKey: 'sk-local-only',
      models: { writing: 'glm-4.7' },
    });
    const req = { headers: { authorization: 'Bearer token', [HEADER_NAME]: header } };
    const res = { status: () => res, json: () => res };

    let passed = false;
    await require('../middleware/auth')(req, res, () => { passed = true; });
    assert.equal(passed, true, '中间件应放行');

    // 本次请求用的是本地配置
    assert.equal(req.userModelConfig.provider, 'cloud');
    assert.equal(req.userModelConfig.cloudApiKey, 'sk-local-only');
    assert.equal(req.userModelConfig.routeId, 'vip');
    // 用户文档仍是账号里的配置，没有被本地密钥污染（后续 save() 不会把密钥写进数据库）
    assert.equal(req.user.modelConfig.provider, 'system');
    assert.equal(req.user.modelConfig.cloudApiKey, undefined);
  } finally {
    jwt.verify = originalVerify;
    UserModule.findById = originalFindById;
    delete require.cache[authPath];
    require('../middleware/auth');
  }
});

test('鉴权中间件：账号里的加密密钥会被解密后供本次调用使用', async () => {
  const jwt = require('jsonwebtoken');
  const UserModule = require('../models/User');
  const authPath = require.resolve('../middleware/auth');

  const originalVerify = jwt.verify;
  const originalFindById = UserModule.findById;
  const fakeUser = {
    _id: 'user-2',
    disabled: false,
    role: 'user',
    modelConfig: { provider: 'cloud', cloudBaseUrl: 'https://own.example.com/v1', cloudApiKey: seal('sk-from-account'), cloudWritingModel: 'm' },
  };

  try {
    jwt.verify = () => ({ userId: 'user-2' });
    UserModule.findById = () => ({ select: async () => fakeUser });
    const req = { headers: { authorization: 'Bearer token' } };
    const res = { status: () => res, json: () => res };
    await require('../middleware/auth')(req, res, () => {});
    assert.equal(req.userModelConfig.cloudApiKey, 'sk-from-account', '调用点应拿到明文密钥');
    assert.equal(req.modelConfigFromLocal, undefined);
  } finally {
    jwt.verify = originalVerify;
    UserModule.findById = originalFindById;
    delete require.cache[authPath];
    require('../middleware/auth');
  }
});
