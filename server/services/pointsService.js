const {
  DEFAULT_ROUTE_ID,
  createPriceCatalog,
  getServerRoute,
  resolveRouteId,
} = require('../config/modelPriceCatalog');

const LEDGER_LIMIT = 200;

class PointsInsufficientError extends Error {
  constructor(required, available) {
    super('TOKEN_EXHAUSTED');
    this.name = 'PointsInsufficientError';
    this.code = 'POINTS_INSUFFICIENT';
    this.required = required;
    this.available = available;
    this.userMessage = '积分余额不足，请充值后再生成';
  }
}

class PointsPriceConfigurationError extends Error {
  constructor(routeId) {
    super(`线路 ${routeId} 的服务端成本尚未配置`);
    this.name = 'PointsPriceConfigurationError';
    this.code = 'POINTS_PRICE_NOT_CONFIGURED';
    this.routeId = routeId;
  }
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function hasNativePointsAccount(user) {
  return Number(user?.points?.version || 0) >= 1;
}

function getPointsSnapshot(user) {
  const source = hasNativePointsAccount(user) ? user.points : (user?.tokens || {});
  const total = nonNegativeInteger(source?.total);
  const used = Math.min(total, nonNegativeInteger(source?.used));
  return { total, used, available: Math.max(0, total - used) };
}

function ensurePointsAccount(user) {
  if (!user) throw new TypeError('user is required');
  if (!hasNativePointsAccount(user)) {
    const legacy = getPointsSnapshot(user);
    user.points = { version: 1, total: legacy.total, used: legacy.used };
  }
  if (!user.tokens) user.tokens = { total: 0, used: 0 };
  if (!Array.isArray(user.pointsLedger)) user.pointsLedger = [];
  syncLegacyTokens(user);
  return getPointsSnapshot(user);
}

function syncLegacyTokens(user) {
  if (!user || !hasNativePointsAccount(user)) return;
  if (!user.tokens) user.tokens = {};
  user.tokens.total = nonNegativeInteger(user.points.total);
  user.tokens.used = Math.min(user.tokens.total, nonNegativeInteger(user.points.used));
}

function routeIdForModelConfig(modelConfig, catalog = createPriceCatalog()) {
  return resolveRouteId(modelConfig?.routeId || DEFAULT_ROUTE_ID, catalog);
}

function isPointsBillingRequired(modelConfig) {
  const provider = modelConfig?.provider || 'default';
  return provider === 'default' || provider === 'system';
}

function calculatePointsCharge({ routeId, inputTokens = 0, outputTokens = 0, catalog = createPriceCatalog() }) {
  const route = getServerRoute(routeId, catalog);
  const input = nonNegativeInteger(inputTokens);
  const output = nonNegativeInteger(outputTokens);
  const billableTokens = input + output;
  if (billableTokens === 0) {
    return { points: 0, inputTokens: input, outputTokens: output, billableTokens, routeId: route.id };
  }

  let rawPoints;
  if (route.pricingMode === 'fixed') {
    rawPoints = billableTokens * route.pointsPerBlock / route.tokensPerBlock;
  } else {
    if (route.inputRmbPerMillion === null || route.outputRmbPerMillion === null) {
      throw new PointsPriceConfigurationError(route.id);
    }
    const inputCostRmb = input * route.inputRmbPerMillion / 1_000_000;
    const outputCostRmb = output * route.outputRmbPerMillion / 1_000_000;
    rawPoints = (inputCostRmb + outputCostRmb) * route.costMarkupMultiplier * route.pointsPerRmb;
  }

  return {
    points: Math.ceil(rawPoints),
    inputTokens: input,
    outputTokens: output,
    billableTokens,
    routeId: route.id,
  };
}

function appendLedger(user, entry) {
  if (!Array.isArray(user.pointsLedger)) user.pointsLedger = [];
  user.pointsLedger.push({ ...entry, createdAt: entry.createdAt || new Date() });
  if (user.pointsLedger.length > LEDGER_LIMIT) {
    user.pointsLedger.splice(0, user.pointsLedger.length - LEDGER_LIMIT);
  }
}

async function saveUser(user, shouldSave) {
  if (shouldSave !== false && typeof user.save === 'function') await user.save();
}

async function creditPoints(user, amount, options = {}) {
  const points = nonNegativeInteger(amount);
  if (points <= 0) throw new RangeError('积分数量必须大于 0');
  ensurePointsAccount(user);
  user.points.total += points;
  syncLegacyTokens(user);
  const snapshot = getPointsSnapshot(user);
  appendLedger(user, {
    type: 'credit',
    points,
    balanceAfter: snapshot.available,
    reason: String(options.reason || 'manual_credit'),
    referenceId: String(options.referenceId || ''),
  });
  await saveUser(user, options.save);
  return { ...snapshot, points };
}

async function debitPoints(user, usage, options = {}) {
  ensurePointsAccount(user);
  const charge = calculatePointsCharge({
    ...usage,
    catalog: options.catalog || usage?.catalog || createPriceCatalog(),
  });
  const before = getPointsSnapshot(user);
  if (charge.points > before.available) {
    throw new PointsInsufficientError(charge.points, before.available);
  }
  if (charge.points === 0) return { ...before, charge };

  user.points.used += charge.points;
  syncLegacyTokens(user);
  const after = getPointsSnapshot(user);
  const route = getServerRoute(charge.routeId, options.catalog || usage?.catalog || createPriceCatalog());
  appendLedger(user, {
    type: 'debit',
    points: charge.points,
    balanceAfter: after.available,
    routeId: route.id,
    routeAlias: route.alias,
    inputTokens: charge.inputTokens,
    outputTokens: charge.outputTokens,
    billableTokens: charge.billableTokens,
    reason: String(options.reason || 'generation'),
    referenceId: String(options.referenceId || ''),
  });
  await saveUser(user, options.save);
  return { ...after, charge };
}

function sanitizeLedger(entries) {
  return (Array.isArray(entries) ? entries : []).slice(-50).map((entry) => ({
    type: entry.type,
    points: nonNegativeInteger(entry.points),
    balanceAfter: nonNegativeInteger(entry.balanceAfter),
    routeId: entry.routeId || '',
    routeAlias: entry.routeAlias || '',
    inputTokens: nonNegativeInteger(entry.inputTokens),
    outputTokens: nonNegativeInteger(entry.outputTokens),
    billableTokens: nonNegativeInteger(entry.billableTokens),
    reason: entry.reason || '',
    referenceId: entry.referenceId || '',
    createdAt: entry.createdAt,
  }));
}

module.exports = {
  LEDGER_LIMIT,
  PointsInsufficientError,
  PointsPriceConfigurationError,
  nonNegativeInteger,
  hasNativePointsAccount,
  getPointsSnapshot,
  ensurePointsAccount,
  syncLegacyTokens,
  routeIdForModelConfig,
  isPointsBillingRequired,
  calculatePointsCharge,
  creditPoints,
  debitPoints,
  sanitizeLedger,
};
