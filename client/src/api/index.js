import axios from 'axios'
import { toUserFacingMessage } from '../utils/userFacing'
import { buildModelOverrideHeader, HEADER_NAME } from '../utils/modelOverride'

function sanitizeMessage(payload) {
 if (!payload || typeof payload !== 'object' || typeof payload.message !== 'string') return payload
 const locale = localStorage.getItem('locale') === 'en' ? 'en' : 'zh'
 return { ...payload, message: toUserFacingMessage(payload.message, locale) }
}

const api = axios.create({
 baseURL: '/api',
 timeout: 300000,
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
 // 桌面端「仅存本地」的模型线路：随请求头带上，服务端只在本次调用使用、不落库。
 // 密钥留在用户电脑上，这里只做转发；Web 端没有 mnDesktop，直接跳过。
 // 多线路时下发全部线路与任务分配，由服务端解析"每个任务用哪条线路"
 // （见 server/services/localModelConfig.js）。
 if (typeof window !== 'undefined' && window.mnDesktop?.isDesktop) {
  try {
   const headerValue = buildModelOverrideHeader()
   if (headerValue) config.headers[HEADER_NAME] = headerValue
  } catch { /* 配置损坏时忽略，退化为账号配置 */ }
 }
 return config
 },
 (error) => Promise.reject(error)
)

// 响应拦截器：处理401 — 软导航替代硬跳转
let _authRedirecting = false
api.interceptors.response.use(
 (response) => {
 response.data = sanitizeMessage(response.data)
 return response
 },
 (error) => {
 if (error.response?.data) error.response.data = sanitizeMessage(error.response.data)
 if (error.response?.status === 401 && !_authRedirecting) {
 _authRedirecting = true
 localStorage.removeItem('token')
 localStorage.removeItem('user')
 // 桌面端走 hash 路由，直接改 hash 由已挂载的桌面路由处理。
 // 不能走下面的动态 import：'../router' 是 Web 版（createWebHistory）实例，
 // 在桌面端从未挂载，却会把地址栏改写成 /login，造成地址与真实路由不一致。
 if (typeof window !== 'undefined' && window.mnDesktop?.isDesktop) {
 window.location.hash = '#/login'
 _authRedirecting = false
 } else {
 // 使用动态 import 避免循环依赖
 import('../router').then(({ default: router }) => {
 router.push('/login')
 }).catch(() => {
 window.location.href = '/login'
 }).finally(() => {
 _authRedirecting = false
 })
 }
 }
 return Promise.reject(error)
 }
)

export default api
