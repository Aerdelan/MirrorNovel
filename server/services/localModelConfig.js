/**
 * 请求级模型配置覆盖（桌面端"仅存本地"模式）
 *
 * 背景：桌面端允许用户自己填 Base URL / API Key / 模型名。若走"账号存储"，
 * 密钥会进服务器数据库；若走"仅存本地"，则密钥留在用户电脑上，每次请求通过
 * 请求头带上，服务器只在本次调用里使用、**绝不落库**。
 *
 * 传输方式：请求头 `x-mn-model-config`，值为 base64(JSON)，避免中文模型名与
 * 特殊字符在头部传输时的编码问题。头长度有限制，因此这里也做严格体积校验。
 *
 * 协议有两个版本：
 *  v1（单线路）：{ baseUrl, apiKey, models: { writing, outline, reasoning, polish } }
 *  v2（多线路，新增）：{
 *    version: 2,
 *    routes: [{ id, name, baseUrl, apiKey, models: {…} }],
 *    defaultRouteId,                                  // 默认走哪条线路
 *    taskRoutes: { outline|writing|reasoning|polish }  // 各任务指定线路，空 = 跟随默认
 *  }
 * 两种版本都会被归一化成同一份内部结构，其中 `localRoleConfigs` 是"按任务解析好的
 * 线路"，供 aiService.resolveApiConfig 直接取用；兼容字段（cloudBaseUrl / cloudXxxModel）
 * 仍然保留，避免影响其它读取这些字段的既有代码。
 *
 * 安全边界：
 *  - 只接受 cloud 形态的字段（baseUrl / apiKey / 各任务模型名），不允许覆盖账号的
 *    routeId / roleRoutes，避免绕过服务端线路管理；
 *  - 不写日志、不回显；格式非法时静默忽略，退化为账号配置（不影响可用性）。
 */

const HEADER_NAME = 'x-mn-model-config';
// 多线路后体积上限提高；仍明显小于 Node 默认 16KB 请求头限制，避免触发 431。
const MAX_HEADER_BYTES = 12 * 1024;
const MAX_URL_LENGTH = 500;
const MAX_KEY_LENGTH = 512;
const MAX_MODEL_LENGTH = 200;
const MAX_ROUTE_NAME_LENGTH = 60;
/** 线路数量上限：既防头部超限，也避免用户在界面上堆出难以维护的配置 */
const MAX_ROUTES = 6;

/** 任务角色枚举（与 aiService.resolveApiConfig / thinkingPolicy 保持一致） */
const ROLE_KEYS = ['outline', 'writing', 'reasoning', 'polish'];

/** 角色 → userModelConfig 中的字段名（兼容字段，aiService 旧路径会读） */
const ROLE_MODEL_FIELDS = {
  outline: 'cloudOutlineModel',
  writing: 'cloudWritingModel',
  reasoning: 'cloudReasoningModel',
  polish: 'cloudPolishModel',
};

function sanitizeText(value, maxLength) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength) return '';
  return text;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 归一化单个线路；非法返回 null（调用方负责过滤） */
function normalizeRoute(input, index) {
  if (!input || typeof input !== 'object') return null;
  const baseUrl = sanitizeText(input.baseUrl, MAX_URL_LENGTH);
  if (!baseUrl || !isHttpUrl(baseUrl)) return null;

  const modelsInput = input.models && typeof input.models === 'object' ? input.models : {};
  const models = {};
  for (const role of ROLE_KEYS) models[role] = sanitizeText(modelsInput[role], MAX_MODEL_LENGTH);
  // 至少要有一个可用模型：写作缺失时用其它任务兜底，避免整条线路失效
  if (!models.writing) {
    const fallback = models.outline || models.reasoning || models.polish;
    if (!fallback) return null;
    models.writing = fallback;
  }

  const id = sanitizeText(input.id, 64) || `route-${index + 1}`;
  const name = sanitizeText(input.name, MAX_ROUTE_NAME_LENGTH) || models.writing;

  return {
    id,
    name,
    baseUrl,
    apiKey: sanitizeText(input.apiKey, MAX_KEY_LENGTH),
    models,
  };
}

/** 从已归一的线路列表计算"每个任务实际走的线路" */
function buildTaskPlan(routes, defaultRouteIdRaw, taskRoutesRaw) {
  const byId = new Map(routes.map((route) => [route.id, route]));
  const defaultRouteId = byId.has(sanitizeText(defaultRouteIdRaw, 64)) ? sanitizeText(defaultRouteIdRaw, 64) : routes[0].id;
  const taskRoutes = {};
  const taskRoutesInput = taskRoutesRaw && typeof taskRoutesRaw === 'object' ? taskRoutesRaw : {};
  for (const role of ROLE_KEYS) {
    const wanted = sanitizeText(taskRoutesInput[role], 64);
    // 指向不存在线路时视为"跟随默认"，不让脏数据把任务打到空配置上
    taskRoutes[role] = byId.has(wanted) ? wanted : '';
  }
  return { defaultRouteId, taskRoutes, byId };
}

/**
 * 校验并归一化一份"用户自带模型配置"。
 * @returns {{ok: true, config: object} | {ok: false, reason: string}}
 */
function normalizeLocalModelConfig(input) {
  if (!input || typeof input !== 'object') return { ok: false, reason: '配置为空' };

  // ===== v2：多线路 =====
  if (Array.isArray(input.routes) && input.routes.length) {
    if (input.routes.length > MAX_ROUTES) return { ok: false, reason: `线路数量不能超过 ${MAX_ROUTES} 条` };
    const routes = input.routes.map(normalizeRoute).filter(Boolean);
    if (!routes.length) return { ok: false, reason: '没有可用的线路（需包含 http(s) 地址与至少一个模型名）' };

    const { defaultRouteId, taskRoutes, byId } = buildTaskPlan(routes, input.defaultRouteId, input.taskRoutes);
    const defaultRoute = byId.get(defaultRouteId);

    // 按任务解析：任务指定线路 > 默认线路；模型取该任务模型，缺省跟随该线路的写作模型
    const localRoleConfigs = {};
    for (const role of ROLE_KEYS) {
      const route = byId.get(taskRoutes[role] || defaultRouteId);
      const model = route?.models?.[role] || route?.models?.writing || '';
      // 缺密钥时不下发该任务，让 aiService 回退到账号/服务端配置并给出明确报错
      if (route?.baseUrl && route.apiKey && model) {
        localRoleConfigs[role] = { baseUrl: route.baseUrl, apiKey: route.apiKey, model, routeName: route.name };
      }
    }

    return {
      ok: true,
      config: {
        provider: 'cloud',
        cloudBaseUrl: defaultRoute.baseUrl,
        cloudApiKey: defaultRoute.apiKey,
        cloudOutlineModel: defaultRoute.models.outline || defaultRoute.models.writing,
        cloudWritingModel: defaultRoute.models.writing,
        cloudReasoningModel: defaultRoute.models.reasoning || defaultRoute.models.writing,
        cloudPolishModel: defaultRoute.models.polish || defaultRoute.models.writing,
        localRoleConfigs,
        routeNames: Object.fromEntries(routes.map((route) => [route.id, route.name])),
      },
    };
  }

  // ===== v1：单线路（旧客户端）=====
  const baseUrl = sanitizeText(input.baseUrl, MAX_URL_LENGTH);
  if (!baseUrl) return { ok: false, reason: '缺少接口地址' };
  if (!isHttpUrl(baseUrl)) return { ok: false, reason: '接口地址必须是 http(s) URL' };

  const apiKey = sanitizeText(input.apiKey, MAX_KEY_LENGTH);
  const models = input.models && typeof input.models === 'object' ? input.models : {};
  const normalizedModels = {};
  for (const [role, field] of Object.entries(ROLE_MODEL_FIELDS)) {
    normalizedModels[field] = sanitizeText(models[role], MAX_MODEL_LENGTH);
  }
  // 至少要有一个可用模型：writing 缺失时用 outline/polish 兜底，全空则视为无效配置
  if (!normalizedModels.cloudWritingModel) {
    const fallback = normalizedModels.cloudOutlineModel || normalizedModels.cloudReasoningModel || normalizedModels.cloudPolishModel;
    if (!fallback) return { ok: false, reason: '至少需要填写一个模型名' };
    normalizedModels.cloudWritingModel = fallback;
  }

  const localRoleConfigs = {};
  if (apiKey) {
    for (const [role, field] of Object.entries(ROLE_MODEL_FIELDS)) {
      const model = normalizedModels[field] || normalizedModels.cloudWritingModel;
      if (model) localRoleConfigs[role] = { baseUrl, apiKey, model, routeName: model };
    }
  }

  return {
    ok: true,
    config: {
      provider: 'cloud',
      cloudBaseUrl: baseUrl,
      cloudApiKey: apiKey,
      cloudOutlineModel: normalizedModels.cloudOutlineModel,
      cloudWritingModel: normalizedModels.cloudWritingModel,
      cloudReasoningModel: normalizedModels.cloudReasoningModel,
      cloudPolishModel: normalizedModels.cloudPolishModel,
      localRoleConfigs,
    },
  };
}

/**
 * 解析请求头中的本地配置。
 * @param {string|undefined} rawHeader - x-mn-model-config 的值（base64 JSON）
 */
function parseOverrideHeader(rawHeader) {
  if (!rawHeader) return { ok: false, reason: '未提供本地配置' };
  const raw = String(rawHeader);
  if (raw.length > MAX_HEADER_BYTES) return { ok: false, reason: '配置体积超限' };
  let json;
  try {
    json = Buffer.from(raw, 'base64').toString('utf8');
  } catch {
    return { ok: false, reason: '配置编码无效' };
  }
  try {
    return normalizeLocalModelConfig(JSON.parse(json));
  } catch {
    return { ok: false, reason: '配置不是合法 JSON' };
  }
}

/**
 * 合并账号配置与本地覆盖：本地只覆盖模型相关字段，
 * routeId / roleRoutes 等线路管理字段始终以账号（服务端）配置为准。
 */
function mergeModelConfig(accountConfig, localConfig) {
  const base = accountConfig && typeof accountConfig === 'object' ? accountConfig : {};
  return {
    provider: 'cloud',
    routeId: base.routeId || '',
    roleRoutes: { ...(base.roleRoutes || {}) },
    cloudBaseUrl: localConfig.cloudBaseUrl,
    cloudApiKey: localConfig.cloudApiKey,
    cloudOutlineModel: localConfig.cloudOutlineModel,
    cloudWritingModel: localConfig.cloudWritingModel,
    cloudReasoningModel: localConfig.cloudReasoningModel,
    cloudPolishModel: localConfig.cloudPolishModel,
    // 本机多线路：按任务解析好的 baseUrl / key / 模型，优先级高于上面这些单线路字段
    localRoleConfigs: localConfig.localRoleConfigs || {},
    source: 'local',
  };
}

/** 供桌面端拼请求头用（前端也有一份等价实现，保持一致） */
function encodeOverrideHeader(config) {
  return Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
}

module.exports = {
  HEADER_NAME,
  ROLE_KEYS,
  ROLE_MODEL_FIELDS,
  MAX_HEADER_BYTES,
  MAX_ROUTES,
  normalizeLocalModelConfig,
  parseOverrideHeader,
  mergeModelConfig,
  encodeOverrideHeader,
};
