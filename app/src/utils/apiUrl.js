// 获取正确的 API URL（区分原生 App 和 H5）
// 注意：延迟初始化，避免在模块加载时调用 uni API
let _isNative = null
const API_HOST = 'http://43.159.149.223:3001'

function isNative() {
  if (_isNative !== null) return _isNative
  try {
    // uni-app 原生 App 模式下，platform 为 android / ios
    const platform = uni.getSystemInfoSync().platform
    _isNative = platform === 'android' || platform === 'ios'
  } catch {
    _isNative = false
  }
  return _isNative
}

export const API_BASE = () => isNative() ? `${API_HOST}/api` : '/api'

export function xhrUrl(path) {
  return isNative() ? `${API_HOST}${path}` : path
}
