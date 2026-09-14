/**
 * 桌面端"仅存本地"的模型线路配置（共享模块）
 *
 * 为什么放在 client 而不是 desktop：
 *  - 桌面端「模型线路」页要读写它；
 *  - client 的 axios 实例要在每个请求上把它序列化成 x-mn-model-config 请求头；
 * 两边必须用同一份结构与同一套序列化逻辑，否则会出现"保存了但请求没带上"这类问题。
 *
 * 结构（v2，多线路）：
 * {
 *   version: 2,
 *   routes: [{ id, name, baseUrl, apiKey, models: { outline, writing, reasoning, polish } }],
 *   defaultRouteId: '',                     // 默认线路（空则用第一条）
 *   taskRoutes: { outline:'', writing:'', reasoning:'', polish:'' }  // 空 = 跟随默认线路
 * }
 * 旧版 v1（单线路 { baseUrl, apiKey, models }）读取时自动迁移，用户无需重填。
 */

export const LOCAL_CONFIG_KEY = 'mn_model_config_local'
export const HEADER_NAME = 'x-mn-model-config'

/** 任务角色与界面文案（顺序即界面顺序） */
export const MODEL_ROLE_KEYS = ['writing', 'outline', 'reasoning', 'polish']

/** 服务端 localModelConfig 的体积校验（12KB，留出余量避免触发 431） */
const MAX_ROUTE_COUNT = 6

function safeParse(json) {
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function text(value, maxLength = 500) {
  const value2 = String(value ?? '').trim()
  return value2.length > maxLength ? '' : value2
}

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function createRoute(partial = {}) {
  const random = Math.random().toString(36).slice(2, 6)
  return {
    id: partial.id || `r${Date.now().toString(36)}${random}`,
    name: text(partial.name, 60),
    baseUrl: text(partial.baseUrl).replace(/\/+$/, ''),
    apiKey: String(partial.apiKey ?? '').trim(),
    models: {
      writing: text(partial.models?.writing, 200),
      outline: text(partial.models?.outline, 200),
      reasoning: text(partial.models?.reasoning, 200),
      polish: text(partial.models?.polish, 200),
    },
  }
}

/** 归一化整份配置；返回 null 表示没有可用配置 */
export function normalizeLocalConfig(input) {
  if (!input || typeof input !== 'object') return null

  // ===== v1 → v2 迁移（单线路）=====
  if (!Array.isArray(input.routes)) {
    const baseUrl = text(input.baseUrl)
    if (!baseUrl || !isHttpUrl(baseUrl)) return null
    const models = input.models || {}
    const route = createRoute({
      id: 'r-default',
      // 旧版没有线路名，用写作模型名作为默认名称，用户可自行改
      name: models.writing || '',
      baseUrl,
      apiKey: input.apiKey,
      models,
    })
    return { version: 2, routes: [route], defaultRouteId: route.id, taskRoutes: emptyTaskRoutes() }
  }

  const routes = input.routes
    .map((route) => createRoute(route))
    .filter((route) => route.baseUrl && isHttpUrl(route.baseUrl))
    .filter((route) => route.models.writing || route.models.outline || route.models.reasoning || route.models.polish)
    .slice(0, MAX_ROUTE_COUNT)
  if (!routes.length) return null

  const ids = new Set(routes.map((route) => route.id))
  const defaultRouteId = ids.has(input.defaultRouteId) ? input.defaultRouteId : routes[0].id
  const taskRoutes = emptyTaskRoutes()
  for (const role of MODEL_ROLE_KEYS) {
    const wanted = text(input.taskRoutes?.[role], 64)
    taskRoutes[role] = ids.has(wanted) ? wanted : ''
  }
  return { version: 2, routes, defaultRouteId, taskRoutes }
}

function emptyTaskRoutes() {
  return { outline: '', writing: '', reasoning: '', polish: '' }
}

export function readLocalModelConfig() {
  try {
    return normalizeLocalConfig(safeParse(localStorage.getItem(LOCAL_CONFIG_KEY) || ''))
  } catch {
    return null
  }
}

export function writeLocalModelConfig(config) {
  try {
    localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(config))
  } catch { /* 隐私模式下写入失败：退化为本次会话内存态 */ }
}

export function clearLocalModelConfig() {
  try { localStorage.removeItem(LOCAL_CONFIG_KEY) } catch { /* 忽略 */ }
}

/** 某任务实际生效的线路 id（未指定则跟随默认线路） */
export function resolveTaskRouteId(config, role) {
  if (!config?.routes?.length) return ''
  const wanted = config.taskRoutes?.[role]
  if (wanted && config.routes.some((route) => route.id === wanted)) return wanted
  return config.defaultRouteId || config.routes[0].id
}

/** 浏览器端 base64（兼容中文模型名） */
function toBase64(text2) {
  const bytes = new TextEncoder().encode(text2)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

/**
 * 组装请求头值（与服务端 localModelConfig.parseOverrideHeader 对应）。
 * 注意：这里下发全部线路与任务分配，由服务端解析出"每个任务用哪条线路"，
 * 这样服务端不必知道桌面端的界面细节，也不会落库任何密钥。
 */
export function buildModelOverrideHeader(config = readLocalModelConfig()) {
  if (!config?.routes?.length) return ''
  const payload = {
    version: 2,
    defaultRouteId: config.defaultRouteId || '',
    taskRoutes: config.taskRoutes || emptyTaskRoutes(),
    routes: config.routes.map((route) => ({
      id: route.id,
      name: route.name || '',
      baseUrl: route.baseUrl,
      apiKey: route.apiKey || '',
      models: {
        outline: route.models?.outline || '',
        writing: route.models?.writing || '',
        reasoning: route.models?.reasoning || '',
        polish: route.models?.polish || '',
      },
    })),
  }
  return toBase64(JSON.stringify(payload))
}
