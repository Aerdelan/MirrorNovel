// 统一的 SSE 流式请求封装：消除各页面重复的 XHR + onprogress + 缓冲解析逻辑。
// 只负责"把 data: {...} 事件解析出来分发给回调"，业务逻辑仍由调用方在各回调里处理。
// 复杂场景（如编辑引擎的阶段状态机）可直接用 onEvent 自行 switch 整个事件对象。

export function useSSE() {
  let xhr = null

  function openSSE(url, body, handlers = {}) {
    // 关闭可能残留的上一次连接
    abort()
    const req = new XMLHttpRequest()
    xhr = req
    req.open('POST', url)
    req.setRequestHeader('Content-Type', 'application/json')
    if (handlers.token) req.setRequestHeader('Authorization', `Bearer ${handlers.token}`)

    let lastIndex = 0
    let sseBuffer = ''

    req.onprogress = () => {
      sseBuffer += req.responseText.substring(lastIndex)
      lastIndex = req.responseText.length
      const lines = sseBuffer.split('\n')
      sseBuffer = lines.pop() // 末尾可能是不完整的一行，留到下次
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6))
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

    req.onloadend = () => { if (handlers.onLoadend) handlers.onLoadend() }
    req.onerror = () => { if (handlers.onError) handlers.onError('请求失败，请稍后重试') }
    req.send(JSON.stringify(body || {}))

    return { abort }
  }

  function abort() {
    if (xhr) { try { xhr.abort() } catch {} xhr = null }
  }

  return { openSSE, abort }
}
