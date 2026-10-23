import { API_BASE } from '../utils/apiUrl'
import { toUserFacingMessage } from '../utils/userFacing'
import { getActivePinia } from 'pinia'
import { useAuthStore } from '../stores/auth'

function getToken() {
  try { if (uni.getStorageSync) return uni.getStorageSync('token') || '' } catch {}
  try { return localStorage.getItem('token') || '' } catch { return '' }
}

function request(method, url, data, options = {}) {
  return new Promise((resolve, reject) => {
    const token = getToken()
    const header = { 'Content-Type': 'application/json', ...(options.headers || {}) }
    if (token && token !== 'undefined' && token !== 'null') header['Authorization'] = `Bearer ${token}`

    uni.request({
      url: API_BASE() + url,
      method: method.toUpperCase(),
      data: data || undefined,
      header,
      timeout: options.timeout || 60000,
      success: (res) => {
        if (res.statusCode === 401 || (res.statusCode === 403 && res.data?.disabled)) {
          if (token && token === getToken()) clearAuthAndRedirect()
          return reject(new Error(toUserFacingMessage(res.data?.message || '未登录')))
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const responseData = res.data && typeof res.data === 'object' && typeof res.data.message === 'string'
            ? { ...res.data, message: toUserFacingMessage(res.data.message) }
            : res.data
          resolve(responseData)
        } else {
          const error = new Error(toUserFacingMessage(res.data?.message || `请求失败(${res.statusCode})`))
          error.response = { status: res.statusCode, data: res.data, headers: res.header }
          reject(error)
        }
      },
      fail: (err) => reject(new Error(err.errMsg || '网络请求失败')),
    })
  })
}

function clearAuthAndRedirect() {
  if (getActivePinia()) useAuthStore().clearAuth()
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
