const PUBLIC_ROUTE_DEFINITIONS = Object.freeze([
  { id: 'normal_1', alias: '普通线路模型一', pricingMode: 'fixed', envPrefix: 'POINTS_NORMAL_1' },
  { id: 'normal_2', alias: '普通线路模型二', pricingMode: 'fixed', envPrefix: 'POINTS_NORMAL_2' },
  { id: 'advanced_1', alias: '高级线路模型一', pricingMode: 'fixed', envPrefix: 'POINTS_ADVANCED_1' },
  { id: 'vip', alias: 'VIP线路模型', pricingMode: 'cost', envPrefix: 'POINTS_VIP' },
  { id: 'svip', alias: 'SVIP线路模型', pricingMode: 'cost', envPrefix: 'POINTS_SVIP' },
]);

const DEFAULT_ROUTE_ID = 'normal_1';
const FIXED_POINTS_PER_TOKENS = Object.freeze({ points: 1000, tokens: 20000 });
const COST_MARKUP_MULTIPLIER = 8;
const POINTS_PER_RMB = 1000;

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseOverrides(env) {
  if (!env.POINTS_PRICE_CATALOG_JSON) return {};
  try {
    const parsed = JSON.parse(env.POINTS_PRICE_CATALOG_JSON);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.warn('[Points] POINTS_PRICE_CATALOG_JSON 不是合法 JSON，已忽略:', error.message);
    return {};
  }
}

function createPriceCatalog(env = process.env) {
  const overrides = parseOverrides(env);
  const fallback = {
    baseUrl: env.AI_API_BASE || '',
    apiKey: env.AI_API_KEY || '',
    model: env.AI_MODEL || '',
  };

  return PUBLIC_ROUTE_DEFINITIONS.map((definition) => {
    const override = overrides[definition.id] || {};
    const prefix = definition.envPrefix;
    const route = {
      id: definition.id,
      alias: definition.alias,
      pricingMode: definition.pricingMode,
      baseUrl: override.baseUrl || env[`${prefix}_BASE_URL`] || fallback.baseUrl,
      apiKey: override.apiKey || env[`${prefix}_API_KEY`] || fallback.apiKey,
      model: override.model || env[`${prefix}_MODEL`] || fallback.model,
    };

    if (definition.pricingMode === 'fixed') {
      route.pointsPerBlock = FIXED_POINTS_PER_TOKENS.points;
      route.tokensPerBlock = FIXED_POINTS_PER_TOKENS.tokens;
    } else {
      route.inputRmbPerMillion = optionalNumber(
        override.inputRmbPerMillion ?? env[`${prefix}_INPUT_RMB_PER_MILLION`]
      );
      route.outputRmbPerMillion = optionalNumber(
        override.outputRmbPerMillion ?? env[`${prefix}_OUTPUT_RMB_PER_MILLION`]
      );
      route.costMarkupMultiplier = COST_MARKUP_MULTIPLIER;
      route.pointsPerRmb = POINTS_PER_RMB;
    }

    return Object.freeze(route);
  });
}

function resolveRouteId(value, catalog = createPriceCatalog()) {
  const requested = String(value || '').trim();
  const match = catalog.find((route) => route.id === requested || route.alias === requested);
  return match ? match.id : DEFAULT_ROUTE_ID;
}

function getServerRoute(value, catalog = createPriceCatalog()) {
  const routeId = resolveRouteId(value, catalog);
  return catalog.find((route) => route.id === routeId) || catalog[0];
}

function getPublicRoutes(catalog = createPriceCatalog()) {
  return catalog.map((route) => ({ id: route.id, alias: route.alias }));
}

const MODEL_ROLE_KEYS = Object.freeze(['outline', 'writing', 'reasoning', 'polish']);

function toPublicRoleRoutes(roleRoutes, catalog = createPriceCatalog()) {
  const source = roleRoutes && typeof roleRoutes === 'object' ? roleRoutes : {};
  return MODEL_ROLE_KEYS.reduce((result, role) => {
    const value = String(source[role] || '').trim();
    if (!value) {
      result[role] = '';
      return result;
    }
    const route = catalog.find((candidate) => candidate.id === value || candidate.alias === value);
    result[role] = route ? route.id : '';
    return result;
  }, {});
}

function toPublicModelConfig(modelConfig, catalog = createPriceCatalog()) {
  const provider = modelConfig?.provider || 'default';
  if (provider === 'default' || provider === 'system') {
    const route = getServerRoute(modelConfig?.routeId, catalog);
    return {
      provider: 'system',
      routeId: route.id,
      routeAlias: route.alias,
      roleRoutes: toPublicRoleRoutes(modelConfig?.roleRoutes, catalog),
    };
  }
  // 自备模型的地址、密钥和真实模型名同样不通过通用账户 API 回传。
  return { provider, managed: false };
}

module.exports = {
  PUBLIC_ROUTE_DEFINITIONS,
  DEFAULT_ROUTE_ID,
  FIXED_POINTS_PER_TOKENS,
  COST_MARKUP_MULTIPLIER,
  POINTS_PER_RMB,
  createPriceCatalog,
  resolveRouteId,
  getServerRoute,
  getPublicRoutes,
  MODEL_ROLE_KEYS,
  toPublicRoleRoutes,
  toPublicModelConfig,
};
