/**
 * Token 用量账本服务
 *
 * 目标：让"token 消耗过大"可度量、可归因（哪个环节花掉的）、可验证
 * （缓存命中省了多少）。不做任何请求体改动，只被动聚合：
 *   - 服务商返回的实际用量（streamGenerate 捕获的 usage，优先）；
 *   - 缺失时的本地估算（countTokens 口径：中文 ≈1.5 token/字）。
 *
 * 数据挂在 Novel.tokenUsage（Mixed 字段）上，随章节保存持久化，
 * 并通过 SSE token_usage 事件向前端披露。聚合维度按任务角色划分，
 * 与模型线路的 outline/writing/reasoning/polish 四个角色对齐。
 */

const ROLE_IDS = ['outline', 'writing', 'reasoning', 'polish'];

function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, cacheSavedTokens: 0, calls: 0, byRole: {} };
}

function normalizeRole(role) {
  return ROLE_IDS.includes(role) ? role : 'other';
}

/** 提取服务商前缀缓存命中 token（DeepSeek / OpenAI 两种口径）。 */
function extractCachedTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  const direct = Number(usage.prompt_cache_hit_tokens);
  if (Number.isFinite(direct) && direct >= 0) return Math.round(direct);
  const nested = Number(usage.prompt_tokens_details?.cached_tokens);
  if (Number.isFinite(nested) && nested >= 0) return Math.round(nested);
  return 0;
}

function toCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

/**
 * 把一次 streamGenerate 的结果记入账本。
 * @param {Object} target - 通常是一个 Novel 文档（也可用普通对象做测试）
 * @param {string} role - outline | writing | reasoning | polish
 * @param {Object} stats - streamGenerate 的返回值 { content, tokenCount, inputTokens, usage }
 * @returns {Object} 记账后的账本快照
 */
function recordTokenUsage(target, role, stats = {}) {
  if (!target || typeof target !== 'object') return null;

  const existing = target.tokenUsage;
  const ledger = (existing && typeof existing === 'object' && !Array.isArray(existing))
    ? existing
    : (target.tokenUsage = emptyUsage());
  if (typeof ledger.inputTokens !== 'number') ledger.inputTokens = 0;
  if (typeof ledger.outputTokens !== 'number') ledger.outputTokens = 0;
  if (typeof ledger.cacheSavedTokens !== 'number') ledger.cacheSavedTokens = 0;
  if (typeof ledger.calls !== 'number') ledger.calls = 0;
  if (!ledger.byRole || typeof ledger.byRole !== 'object') ledger.byRole = {};

  // 服务商实际用量优先，本地估算兜底。
  const usage = stats.usage && typeof stats.usage === 'object' ? stats.usage : null;
  const inputTokens = usage
    ? toCount(usage.prompt_tokens) || toCount(stats.inputTokens)
    : toCount(stats.inputTokens);
  const outputTokens = usage
    ? toCount(usage.completion_tokens) || toCount(stats.tokenCount)
    : toCount(stats.tokenCount);
  const cachedTokens = usage ? extractCachedTokens(usage) : 0;

  const roleKey = normalizeRole(role);
  const roleLedger = ledger.byRole[roleKey] || (ledger.byRole[roleKey] = {
    inputTokens: 0, outputTokens: 0, cacheSavedTokens: 0, calls: 0,
  });

  ledger.inputTokens += inputTokens;
  ledger.outputTokens += outputTokens;
  ledger.cacheSavedTokens += cachedTokens;
  ledger.calls += 1;
  ledger.updatedAt = new Date().toISOString();

  roleLedger.inputTokens += inputTokens;
  roleLedger.outputTokens += outputTokens;
  roleLedger.cacheSavedTokens += cachedTokens;
  roleLedger.calls += 1;

  // Mixed 字段必须显式标记修改，否则 mongoose 不会持久化。
  if (typeof target.markModified === 'function') {
    target.markModified('tokenUsage');
  }
  return usageSnapshot(ledger);
}

/** 输出纯数据快照（用于 SSE / API 响应，避免泄漏 mongoose 内部结构）。 */
function usageSnapshot(tokenUsage) {
  const ledger = (tokenUsage && typeof tokenUsage === 'object' && !Array.isArray(tokenUsage))
    ? tokenUsage
    : emptyUsage();
  const byRole = {};
  for (const [role, value] of Object.entries(ledger.byRole || {})) {
    byRole[role] = {
      inputTokens: value.inputTokens || 0,
      outputTokens: value.outputTokens || 0,
      cacheSavedTokens: value.cacheSavedTokens || 0,
      calls: value.calls || 0,
    };
  }
  return {
    inputTokens: ledger.inputTokens || 0,
    outputTokens: ledger.outputTokens || 0,
    cacheSavedTokens: ledger.cacheSavedTokens || 0,
    calls: ledger.calls || 0,
    byRole,
  };
}

/**
 * 单次调用的用量数据（存进章节 qualityReport / 蓝图提案，前端逐章展示用）。
 * 服务商实际用量优先，本地估算兜底。
 */
function callUsageStats(stats = {}) {
  const usage = stats.usage && typeof stats.usage === 'object' ? stats.usage : null;
  return {
    inputTokens: usage ? (toCount(usage.prompt_tokens) || toCount(stats.inputTokens)) : toCount(stats.inputTokens),
    outputTokens: usage ? (toCount(usage.completion_tokens) || toCount(stats.tokenCount)) : toCount(stats.tokenCount),
    cacheSavedTokens: usage ? extractCachedTokens(usage) : 0,
  };
}

module.exports = {
  recordTokenUsage,
  usageSnapshot,
  callUsageStats,
  extractCachedTokens,
  ROLE_IDS,
};
