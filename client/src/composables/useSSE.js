import { useI18n } from './useI18n'
import { buildModelOverrideHeader, HEADER_NAME } from '../utils/modelOverride'
import { classifySSEEnd, createSSEParser, isTerminalSSEEvent } from '../utils/sseParser'

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
    req._mnAbortedByUs = false
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
    let settled = false
    let abortedByUs = false

    const fail = (message) => {
      if (settled) return
      settled = true
      if (handlers.onError) handlers.onError(message || $t('common.requestFailed'))
    }

    const disconnected = () => {
      if (settled || abortedByUs || req._mnAbortedByUs) return
      settled = true
      const event = {
        type: 'disconnected',
        status: 'unknown',
        recoverable: true,
        message: $t('common.streamDisconnected'),
      }
      if (handlers.onEvent) handlers.onEvent(event)
      if (handlers.onDisconnected) handlers.onDisconnected(event)
      else if (handlers.onError) handlers.onError(event.message, event)
    }

    const onIdle = () => {
      disconnected()
      try { req.abort() } catch {}
    }
    let idleTimer = setTimeout(onIdle, IDLE_TIMEOUT_MS)
    const keepAlive = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(onIdle, IDLE_TIMEOUT_MS)
    }

    const parser = createSSEParser({
      onEvent(event) {
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
        if (isTerminalSSEEvent(event)) {
          settled = true
          clearTimeout(idleTimer)
        }
      },
    })

    req.onprogress = () => {
      parser.push(req.responseText.substring(lastIndex))
      lastIndex = req.responseText.length
    }

    req.onloadend = () => {
      clearTimeout(idleTimer)
      parser.push(req.responseText.substring(lastIndex))
      lastIndex = req.responseText.length
      parser.finish()
      if (!settled && !abortedByUs && !req._mnAbortedByUs) {
        const end = classifySSEEnd({ status: req.status, state: parser.getState() })
        if (end.kind === 'http_error' || end.kind === 'empty_response') {
          fail(extractErrorDetail(req.responseText) || (end.status ? `HTTP ${end.status}` : $t('common.requestFailed')))
        } else if (end.kind === 'disconnected') {
          disconnected()
        } else {
          settled = true
        }
      }
      if (handlers.onLoadend) handlers.onLoadend()
      if (xhr === req) xhr = null
    }
    req.onerror = () => disconnected()
    req.send(JSON.stringify(body || {}))

    return {
      abort: () => {
        abortedByUs = true
        req._mnAbortedByUs = true
        settled = true
        clearTimeout(idleTimer)
        if (req) { try { req.abort() } catch {} }
        xhr = null
      },
    }
  }

  function abort() {
    if (xhr) {
      xhr._mnAbortedByUs = true
      try { xhr.abort() } catch {}
      xhr = null
    }
  }

  return { openSSE, abort }
}
