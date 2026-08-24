const MODEL_ROUTE_DEFINITIONS = Object.freeze([
  { id: 'normal_1', alias: '普通线路模型一', envPrefix: 'MODEL_NORMAL_1' },
  { id: 'normal_2', alias: '普通线路模型二', envPrefix: 'MODEL_NORMAL_2' },
  { id: 'advanced_1', alias: '高级线路模型一', envPrefix: 'MODEL_ADVANCED_1' },
  { id: 'vip', alias: 'VIP线路模型', envPrefix: 'MODEL_VIP' },
  { id: 'svip', alias: 'SVIP线路模型', envPrefix: 'MODEL_SVIP' },
]);

const DEFAULT_ROUTE_ID = 'normal_1';
const MODEL_ROLE_KEYS = Object.freeze(['outline', 'writing', 'reasoning', 'polish']);

function parseOverrides(env) {
  if (!env.MODEL_CATALOG_JSON) return {};
  try {
    const parsed = JSON.parse(env.MODEL_CATALOG_JSON);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.warn('[Model] MODEL_CATALOG_JSON 不是合法 JSON，已忽略:', error.message);
    return {};
  }
}

function createModelCatalog(env = process.env) {
  const overrides = parseOverrides(env);
  const fallback = {
    baseUrl: env.AI_API_BASE || '',
    apiKey: env.AI_API_KEY || '',
    model: env.AI_MODEL || '',
  };
  return MODEL_ROUTE_DEFINITIONS.map((definition) => {
    const override = overrides[definition.id] || {};
    const prefix = definition.envPrefix;
    return Object.freeze({
      id: definition.id,
      alias: definition.alias,
      baseUrl: override.baseUrl || env[`${prefix}_BASE_URL`] || fallback.baseUrl,
      apiKey: override.apiKey || env[`${prefix}_API_KEY`] || fallback.apiKey,
      model: override.model || env[`${prefix}_MODEL`] || fallback.model,
    });
  });
}

function resolveRouteId(value, catalog = createModelCatalog()) {
  const requested = String(value || '').trim();
  const match = catalog.find((route) => route.id === requested || route.alias === requested);
  return match ? match.id : DEFAULT_ROUTE_ID;
}

function getServerRoute(value, catalog = createModelCatalog()) {
  const routeId = resolveRouteId(value, catalog);
  return catalog.find((route) => route.id === routeId) || catalog[0];
}

function getPublicRoutes(catalog = createModelCatalog()) {
  return catalog.map((route) => ({ id: route.id, alias: route.alias }));
}

function toPublicRoleRoutes(roleRoutes, catalog = createModelCatalog()) {
  const source = roleRoutes && typeof roleRoutes === 'object' ? roleRoutes : {};
  return MODEL_ROLE_KEYS.reduce((result, role) => {
    const value = String(source[role] || '').trim();
    if (!value) { result[role] = ''; return result; }
    const route = catalog.find((candidate) => candidate.id === value || candidate.alias === value);
    result[role] = route ? route.id : '';
    return result;
  }, {});
}

function toPublicModelConfig(modelConfig, catalog = createModelCatalog()) {
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
  return { provider, managed: false };
}

module.exports = {
  MODEL_ROUTE_DEFINITIONS,
  DEFAULT_ROUTE_ID,
  createModelCatalog,
  resolveRouteId,
  getServerRoute,
  getPublicRoutes,
  MODEL_ROLE_KEYS,
  toPublicRoleRoutes,
  toPublicModelConfig,
};
