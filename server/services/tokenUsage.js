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
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheSavedTokens: 0,
    calls: 0,
    logicalCalls: 0,
    failedCalls: 0,
    estimatedCalls: 0,
    discardedTokens: 0,
    byRole: {},
    attempts: [],
  };
}

function normalizeRole(role) {
  return ROLE_IDS.includes(role) ? role : 'other';
}

/** 提取服务商前缀缓存命中 token（DeepSeek / OpenAI 两种口径）。 */
function extractCachedTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  // Providers expose the same metric under different OpenAI-compatible
  // fields. Prefer the largest reported value so a present-but-zero direct
  // field cannot hide a non-zero nested value from another adapter.
  const candidates = [
    usage.prompt_cache_hit_tokens,
    usage.prompt_tokens_details?.cached_tokens,
    usage.input_tokens_details?.cached_tokens,
  ]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  return candidates.length ? Math.round(Math.max(...candidates)) : 0;
}

function toCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function extractReasoningTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  return toCount(usage.reasoning_tokens)
    || toCount(usage.completion_tokens_details?.reasoning_tokens)
    || toCount(usage.output_tokens_details?.reasoning_tokens);
}

const MAX_RETAINED_ATTEMPTS = 200;

function sanitizeAttempt(attempt, fallbackRole) {
  const value = attempt && typeof attempt === 'object' ? attempt : {};
  return {
    role: normalizeRole(value.role || fallbackRole),
    taskType: value.taskType ? String(value.taskType).slice(0, 80) : normalizeRole(value.role || fallbackRole),
    model: value.model ? String(value.model).slice(0, 160) : null,
    routeId: value.routeId ? String(value.routeId).slice(0, 120) : null,
    providerHost: value.providerHost ? String(value.providerHost).slice(0, 200) : null,
    attempt: Math.max(1, toCount(value.attempt) || 1),
    finishReason: value.finishReason ? String(value.finishReason).slice(0, 80) : null,
    accepted: value.accepted === true,
    discarded: value.discarded === true,
    inputTokens: toCount(value.inputTokens),
    outputTokens: toCount(value.outputTokens),
    reasoningTokens: toCount(value.reasoningTokens),
    cacheSavedTokens: toCount(value.cacheSavedTokens),
    error: value.error ? String(value.error).slice(0, 1000) : null,
    retryReason: value.retryReason ? String(value.retryReason).slice(0, 120) : null,
    estimated: value.estimated === true,
    startedAt: value.startedAt ? String(value.startedAt).slice(0, 40) : null,
    durationMs: toCount(value.durationMs),
    statusCode: toCount(value.statusCode) || null,
    recordedAt: value.recordedAt ? String(value.recordedAt).slice(0, 40) : new Date().toISOString(),
  };
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
  if (typeof ledger.reasoningTokens !== 'number') ledger.reasoningTokens = 0;
  if (typeof ledger.cacheSavedTokens !== 'number') ledger.cacheSavedTokens = 0;
  if (typeof ledger.calls !== 'number') ledger.calls = 0;
  if (typeof ledger.logicalCalls !== 'number') ledger.logicalCalls = ledger.calls;
  if (typeof ledger.failedCalls !== 'number') ledger.failedCalls = 0;
  if (typeof ledger.estimatedCalls !== 'number') ledger.estimatedCalls = 0;
  if (typeof ledger.discardedTokens !== 'number') ledger.discardedTokens = 0;
  if (!ledger.byRole || typeof ledger.byRole !== 'object') ledger.byRole = {};
  if (!Array.isArray(ledger.attempts)) ledger.attempts = [];

  // 服务商实际用量优先，本地估算兜底。
  const usage = stats.usage && typeof stats.usage === 'object' ? stats.usage : null;
  const inputTokens = usage
    ? toCount(usage.prompt_tokens) || toCount(stats.inputTokens)
    : toCount(stats.inputTokens);
  const outputTokens = usage
    ? toCount(usage.completion_tokens) || toCount(stats.tokenCount)
    : toCount(stats.tokenCount);
  const cachedTokens = usage ? extractCachedTokens(usage) : 0;
  const reasoningTokens = usage ? extractReasoningTokens(usage) : toCount(stats.reasoningTokens);
  const attempts = Array.isArray(stats.attempts) && stats.attempts.length
    ? stats.attempts.map(item => sanitizeAttempt(item, role))
    : [];
  const physicalCalls = attempts.length || 1;

  const roleKey = normalizeRole(role);
  const roleLedger = ledger.byRole[roleKey] || (ledger.byRole[roleKey] = {
    inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheSavedTokens: 0,
    calls: 0, logicalCalls: 0, failedCalls: 0, estimatedCalls: 0, discardedTokens: 0,
  });
  if (typeof roleLedger.inputTokens !== 'number') roleLedger.inputTokens = 0;
  if (typeof roleLedger.outputTokens !== 'number') roleLedger.outputTokens = 0;
  if (typeof roleLedger.reasoningTokens !== 'number') roleLedger.reasoningTokens = 0;
  if (typeof roleLedger.cacheSavedTokens !== 'number') roleLedger.cacheSavedTokens = 0;
  if (typeof roleLedger.calls !== 'number') roleLedger.calls = 0;
  if (typeof roleLedger.logicalCalls !== 'number') roleLedger.logicalCalls = roleLedger.calls || 0;
  if (typeof roleLedger.failedCalls !== 'number') roleLedger.failedCalls = 0;
  if (typeof roleLedger.estimatedCalls !== 'number') roleLedger.estimatedCalls = 0;
  if (typeof roleLedger.discardedTokens !== 'number') roleLedger.discardedTokens = 0;

  ledger.inputTokens += inputTokens;
  ledger.outputTokens += outputTokens;
  ledger.reasoningTokens += reasoningTokens;
  ledger.cacheSavedTokens += cachedTokens;
  ledger.calls += physicalCalls;
  ledger.logicalCalls += 1;
  ledger.updatedAt = new Date().toISOString();

  roleLedger.inputTokens += inputTokens;
  roleLedger.outputTokens += outputTokens;
  roleLedger.reasoningTokens += reasoningTokens;
  roleLedger.cacheSavedTokens += cachedTokens;
  roleLedger.calls += physicalCalls;
  roleLedger.logicalCalls += 1;

  if (attempts.length) {
    const failedCalls = attempts.filter(item => item.error || !item.accepted).length;
    const estimatedCalls = attempts.filter(item => item.estimated).length;
    // completion_tokens commonly already includes reasoning tokens, so do not
    // add reasoningTokens a second time when measuring discarded spend.
    const discardedTokens = attempts
      .filter(item => item.discarded)
      .reduce((sum, item) => sum + item.outputTokens, 0);
    ledger.failedCalls += failedCalls;
    ledger.estimatedCalls += estimatedCalls;
    ledger.discardedTokens += discardedTokens;
    roleLedger.failedCalls += failedCalls;
    roleLedger.estimatedCalls += estimatedCalls;
    roleLedger.discardedTokens += discardedTokens;
    ledger.attempts.push(...attempts);
    if (ledger.attempts.length > MAX_RETAINED_ATTEMPTS) {
      ledger.attempts.splice(0, ledger.attempts.length - MAX_RETAINED_ATTEMPTS);
    }
  }

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
      reasoningTokens: value.reasoningTokens || 0,
      cacheSavedTokens: value.cacheSavedTokens || 0,
      calls: value.calls || 0,
      logicalCalls: value.logicalCalls || 0,
      failedCalls: value.failedCalls || 0,
      estimatedCalls: value.estimatedCalls || 0,
      discardedTokens: value.discardedTokens || 0,
    };
  }
  return {
    inputTokens: ledger.inputTokens || 0,
    outputTokens: ledger.outputTokens || 0,
    reasoningTokens: ledger.reasoningTokens || 0,
    cacheSavedTokens: ledger.cacheSavedTokens || 0,
    calls: ledger.calls || 0,
    logicalCalls: ledger.logicalCalls || 0,
    failedCalls: ledger.failedCalls || 0,
    estimatedCalls: ledger.estimatedCalls || 0,
    discardedTokens: ledger.discardedTokens || 0,
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
    reasoningTokens: usage ? extractReasoningTokens(usage) : toCount(stats.reasoningTokens),
    cacheSavedTokens: usage ? extractCachedTokens(usage) : 0,
    attempts: Array.isArray(stats.attempts) ? stats.attempts.map((attempt) => sanitizeAttempt(attempt)) : [],
  };
}

module.exports = {
  recordTokenUsage,
  usageSnapshot,
  callUsageStats,
  extractCachedTokens,
  extractReasoningTokens,
  ROLE_IDS,
};
