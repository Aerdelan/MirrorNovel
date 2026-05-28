// 获取正确的 API URL（区分原生 App 和 H5）
let _isNative = false
try {
  const info = uni.getSystemInfoSync()
  _isNative = info.platform === 'android' || info.platform === 'ios'
} catch {}
try {
  if (typeof window !== 'undefined' && window.Capacitor) _isNative = true
} catch {}

const API_HOST = 'http://49.51.51.253:3001'
export const API_BASE = _isNative ? `${API_HOST}/api` : '/api'

// 获取 XHR 使用的完整 URL（SSE 流式请求）
export function xhrUrl(path) {
  return _isNative ? `${API_HOST}${path}` : path
}

export function isNativeApp() { return _isNative }
