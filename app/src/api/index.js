import { API_BASE } from '../utils/apiUrl'

function getToken() {
  try { if (uni.getStorageSync) return uni.getStorageSync('token') || '' } catch {}
  try { return localStorage.getItem('token') || '' } catch { return '' }
}

function request(method, url, data, options = {}) {
  return new Promise((resolve, reject) => {
    const token = getToken()
    const header = { 'Content-Type': 'application/json', ...(options.headers || {}) }
    if (token) header['Authorization'] = `Bearer ${token}`

    uni.request({
      url: API_BASE + url,
      method: method.toUpperCase(),
      data: data || undefined,
      header,
      timeout: options.timeout || 60000,
      success: (res) => {
        if (res.statusCode === 401) {
          clearAuthAndRedirect()
          return reject(new Error('未登录'))
        }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data)
        else reject(new Error(res.data?.message || `请求失败(${res.statusCode})`))
      },
      fail: (err) => reject(new Error(err.errMsg || '网络请求失败')),
    })
  })
}

function clearAuthAndRedirect() {
  try { if (uni.removeStorageSync) { uni.removeStorageSync('token'); uni.removeStorageSync('user') } } catch {}
  try { localStorage.removeItem('token'); localStorage.removeItem('user') } catch {}
  try { uni.reLaunch({ url: '/pages/login/login' }) } catch {}
}

const api = {
  get: (url, options) => request('GET', url, null, options),
  post: (url, data, options) => request('POST', url, data, options),
  put: (url, data, options) => request('PUT', url, data, options),
  delete: (url, options) => request('DELETE', url, null, options),
}

export default api
