import { useI18n } from './useI18n'
import { buildModelOverrideHeader, HEADER_NAME } from '../utils/modelOverride'

/**
 * 统一的 SSE 流式请求封装：消除各页面重复的 XHR + onprogress + 缓冲解析逻辑。
 * 只负责"把 data: {...} 事件解析出来分发给回调"，业务逻辑仍由调用方在各回调里处理。
 * 复杂场景（如编辑引擎的阶段状态机）可直接用 onEvent 自行 switch 整个事件对象。
 *
 * 两类"静默失败"必须在这里兜住，否则用户看到的就是"生成莫名其妙停了、也不知道报没报错"：
 *  1) 后端返回的不是 SSE（4xx/5xx 的 JSON、或代理层的错误体）—— 以前整段被当没发生；
 *  2) 连接开着但长时间没有任何事件 —— 以前会永久卡在"正在生成…"。
 */
export function useSSE() {
  const { $t } = useI18n()
  let xhr = null

  // 无事件超时：服务端在思考阶段会定时下发心跳（thinking），正常不会有这么长的空档。
  // 超时判失败而不是无限等待，避免界面永久卡住；用户仍可手动重试。
  // 180s：思考型模型（GLM-4.7 等）首字节延迟可超 2 分钟，留出更宽裕的缓冲。
  const IDLE_TIMEOUT_MS = 180000

  /** 从非 SSE 的响应体里尽力取出可读原因 */
  function extractErrorDetail(text) {
    const raw = String(text || '').trim()
    if (!raw) return ''
    try {
      const parsed = JSON.parse(raw)
      const message = parsed?.message || parsed?.error?.message || parsed?.detail || parsed?.error
      if (typeof message === 'string' && message.trim()) return message.trim()
    } catch {}
    // 不是 JSON（例如网关的 HTML 错误页）：截一小段，避免把整页糊到界面上
    return raw.slice(0, 200)
  }

  function openSSE(url, body, handlers = {}) {
    // 关闭可能残留的上一次连接
    abort()
    const req = new XMLHttpRequest()
    xhr = req
    req.open('POST', url)
    req.setRequestHeader('Content-Type', 'application/json')
    if (handlers.token) req.setRequestHeader('Authorization', `Bearer ${handlers.token}`)
    // 与 axios 拦截器保持一致：把本机线路配置带给服务端。
    // 此前 SSE 生成请求漏带这个头，导致「模型线路」页配置的本机线路对
    // 大纲/蓝图/整本生成完全不生效（生成永远用账号配置）—— 严重坑。
    const overrideHeader = buildModelOverrideHeader()
    if (overrideHeader) req.setRequestHeader(HEADER_NAME, overrideHeader)

    let lastIndex = 0
    let sseBuffer = ''
    let receivedEvent = false
    let settled = false
    let abortedByUs = false

    const fail = (message) => {
      if (settled) return
      settled = true
      if (handlers.onError) handlers.onError(message || $t('common.requestFailed'))
    }

    let idleTimer = setTimeout(() => fail($t('common.requestTimeout')), IDLE_TIMEOUT_MS)
    const keepAlive = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => fail($t('common.requestTimeout')), IDLE_TIMEOUT_MS)
    }

    req.onprogress = () => {
      sseBuffer += req.responseText.substring(lastIndex)
      lastIndex = req.responseText.length
      const lines = sseBuffer.split('\n')
      sseBuffer = lines.pop() // 末尾可能是不完整的一行，留到下次
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6))
          receivedEvent = true
          keepAlive()
          if (handlers.onEvent) handlers.onEvent(event)
          if (event.type === 'reasoning' && handlers.onReasoning) handlers.onReasoning(event.content, event)
          else if (event.type === 'content' && handlers.onContent) handlers.onContent(event.content, event)
          else if (event.type === 'status' && handlers.onStatus) handlers.onStatus(event.message, event)
          // 思考进度心跳：服务商在思考阶段可能不下发任何分片，服务端定时上报
          // "已思考字数 + 已用时间"，让等待过程始终有可见反馈。
          else if (event.type === 'thinking' && handlers.onThinking) handlers.onThinking(event)
          else if (event.type === 'completed' && handlers.onCompleted) handlers.onCompleted(event)
          else if (event.type === 'error' && handlers.onError) handlers.onError(event.message, event)
        } catch {}
      }
    }

    req.onloadend = () => {
      clearTimeout(idleTimer)
      // 关键兜底：一个事件都没收到（或 HTTP 状态异常）时必须报错。
      // 过去的实现会把 4xx/5xx 的 JSON 体直接丢掉，界面上就成了"什么都没发生就停了"。
      if (!settled && !abortedByUs) {
        if (req.status >= 400) fail(extractErrorDetail(req.responseText) || `HTTP ${req.status}`)
        else if (!receivedEvent) fail(extractErrorDetail(req.responseText) || $t('common.requestFailed'))
      }
      settled = true
      if (handlers.onLoadend) handlers.onLoadend()
    }
    req.onerror = () => fail($t('common.requestFailed'))
    req.send(JSON.stringify(body || {}))

    return {
      abort: () => {
        abortedByUs = true
        settled = true
        clearTimeout(idleTimer)
        if (req) { try { req.abort() } catch {} }
        xhr = null
      },
    }
  }

  function abort() {
    if (xhr) { try { xhr.abort() } catch {} xhr = null }
  }

  return { openSSE, abort }
}
