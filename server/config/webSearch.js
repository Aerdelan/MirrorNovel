/**
 * 联网取材（Web Research）配置。
 *
 * 与 modelCatalog 同构：读取是同步的（每次取材都会用到），数据库/管理端覆盖
 * 存在进程内存里，改配置无需重启即生效。默认 provider='none' 表示不启用自动
 * 检索（但用户粘贴的链接仍会被抓取，见 webSearchService）。
 */

const PROVIDERS = Object.freeze(['tavily', 'serper', 'brave', 'none']);

const DEFAULTS = Object.freeze({
  provider: 'none',
  apiKey: '',
  maxQueries: 4,        // 单次取材最多派生几条检索词
  maxAutoUrls: 3,       // 检索结果里最多抓取几个页面正文
  maxUserUrls: 6,       // 用户粘贴链接最多抓取几个
  perPageChars: 4000,   // 单页正文截断
  blockTokenCap: 2500,  // 注入系统提示的资料块大致 token 上限（按 ~1.5 字/token 折算成字符）
  cacheTtlMs: 6 * 60 * 60 * 1000, // 检索/抓取缓存 6 小时
  stepTimeoutMs: 45000, // 整个取材步骤的软超时
});

// 数据库/管理端覆盖（进程内存）。
let runtimeOverrides = null;

function positiveNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function keyForProvider(provider, env) {
  if (provider === 'tavily') return env.TAVILY_API_KEY;
  if (provider === 'serper') return env.SERPER_API_KEY;
  if (provider === 'brave') return env.BRAVE_API_KEY;
  return '';
}

function fromEnv(env = process.env) {
  const provider = String(env.WEB_SEARCH_PROVIDER || '').trim().toLowerCase();
  const resolved = PROVIDERS.includes(provider) ? provider : 'none';
  return {
    provider: resolved,
    apiKey: String(keyForProvider(resolved, env) || '').trim(),
    maxQueries: positiveNum(env.WEB_SEARCH_MAX_QUERIES, DEFAULTS.maxQueries),
    maxAutoUrls: positiveNum(env.WEB_SEARCH_MAX_AUTO_URLS, DEFAULTS.maxAutoUrls),
    maxUserUrls: positiveNum(env.WEB_SEARCH_MAX_USER_URLS, DEFAULTS.maxUserUrls),
    perPageChars: positiveNum(env.WEB_SEARCH_PER_PAGE_CHARS, DEFAULTS.perPageChars),
    blockTokenCap: positiveNum(env.WEB_SEARCH_BLOCK_TOKEN_CAP, DEFAULTS.blockTokenCap),
    cacheTtlMs: positiveNum(env.WEB_SEARCH_CACHE_TTL_MS, DEFAULTS.cacheTtlMs),
    stepTimeoutMs: positiveNum(env.WEB_SEARCH_STEP_TIMEOUT_MS, DEFAULTS.stepTimeoutMs),
  };
}

function normalizeOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  const provider = String(value.provider || '').trim().toLowerCase();
  if (provider) out.provider = PROVIDERS.includes(provider) ? provider : 'none';
  if (value.apiKey != null) out.apiKey = String(value.apiKey).trim();
  for (const key of ['maxQueries', 'maxAutoUrls', 'maxUserUrls', 'perPageChars', 'blockTokenCap', 'cacheTtlMs', 'stepTimeoutMs']) {
    if (value[key] != null && Number.isFinite(Number(value[key]))) out[key] = Number(value[key]);
  }
  return out;
}

function setWebSearchOverrides(value) {
  runtimeOverrides = normalizeOverrides(value);
  return runtimeOverrides;
}

function getWebSearchConfig(env = process.env) {
  const base = fromEnv(env);
  return runtimeOverrides ? { ...base, ...runtimeOverrides } : base;
}

module.exports = {
  PROVIDERS,
  DEFAULTS,
  getWebSearchConfig,
  setWebSearchOverrides,
};
