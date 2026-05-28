import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器：添加token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截器：处理401 — 软导航替代硬跳转
let _authRedirecting = false
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !_authRedirecting) {
      _authRedirecting = true
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      // 使用动态 import 避免循环依赖
      import('../router').then(({ default: router }) => {
        router.push('/login')
      }).catch(() => {
        window.location.href = '/login'
      }).finally(() => {
        _authRedirecting = false
      })
    }
    return Promise.reject(error)
  }
)

export default api
