import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../api'

function safeParse(key) {
 try { const v = localStorage.getItem(key); if (!v || v === 'undefined') return null; return JSON.parse(v) }
 catch { return null }
}

// 安全获取 token，处理 "undefined"/"null" 字符串
function safeToken() {
 try {
 const t = localStorage.getItem('token')
 if (!t || t === 'undefined' || t === 'null') return ''
 return t
 } catch { return '' }
}

function sanitizeUserData(userData) {
 if (!userData || typeof userData !== 'object') return userData
 const sanitized = { ...userData }
 const routeId = userData.modelConfig?.routeId || 'normal_1'
 sanitized.modelConfig = {
  provider: 'system',
  routeId,
  routeAlias: userData.modelConfig?.routeAlias || '',
  roleRoutes: { ...(userData.modelConfig?.roleRoutes || {}) },
 }
 return sanitized
}

export const useAuthStore = defineStore('auth', () => {
 const user = ref(sanitizeUserData(safeParse('user')))
 const token = ref(safeToken())

 const isLoggedIn = computed(() => !!token.value)

 function setAuth(userData, authToken) {
 user.value = sanitizeUserData(userData)
 token.value = authToken
 localStorage.setItem('user', JSON.stringify(user.value))
 localStorage.setItem('token', authToken)
 }

 function clearAuth() {
 user.value = null
 token.value = ''
 localStorage.removeItem('user')
 localStorage.removeItem('token')
 }

 async function login(email, password) {
 const res = await api.post('/auth/login', { email, password })
 setAuth(res.data.user, res.data.token)
 return res.data
 }

 async function register(email, password, code, nickname, inviteCode) {
 const res = await api.post('/auth/register', { email, password, code, nickname, inviteCode })
 setAuth(res.data.user, res.data.token)
 return res.data
 }

 async function sendCode(email) {
 return api.post('/auth/send-code', { email })
 }

 async function getProfile() {
 const res = await api.get('/auth/profile')
 user.value = sanitizeUserData(res.data.user)
 localStorage.setItem('user', JSON.stringify(user.value))
 return res.data
 }

 async function updateProfile(nickname) {
 const res = await api.put('/auth/profile', { nickname })
 if (user.value) {
 user.value.nickname = nickname
 localStorage.setItem('user', JSON.stringify(user.value))
 }
 return res.data
 }

 async function getModelConfig() {
 const res = await api.get('/auth/model-config')
 return res.data
 }

 async function saveModelConfig(config) {
 const res = await api.put('/auth/model-config', config)
 if (user.value) {
 user.value.modelConfig = res.data.modelConfig
 localStorage.setItem('user', JSON.stringify(user.value))
 }
 return res.data
 }

 // 积分账户优先使用新接口，失败时兼容旧服务端。
 async function getTokenInfo() {
 let data
 try {
  const res = await api.get('/billing/account')
  data = res.data.account
 } catch {
  const res = await api.get('/auth/tokens')
  data = res.data.points || res.data
 }
 if (user.value) {
 user.value.points = { version: 1, total: data.total, used: data.used }
 user.value.availablePoints = data.available
 user.value.tokens = { total: data.total, used: data.used }
 user.value.availableTokens = data.available
 localStorage.setItem('user', JSON.stringify(user.value))
 }
 return data
 }

 // 用户统计
 async function getUserStats() {
 const res = await api.get('/auth/stats')
 return res.data
 }

 async function purchaseTokens(amount) {
 const res = await api.post('/auth/purchase', { amount, method: 'alipay' })
 if (user.value) {
 user.value.tokens = { total: res.data.total, used: user.value.tokens?.used || 0 }
 user.value.availableTokens = res.data.available
 localStorage.setItem('user', JSON.stringify(user.value))
 }
 return res.data
 }

 // 签到
 async function checkin() {
 const res = await api.post('/auth/checkin')
 if (user.value) {
 user.value.tokens = { total: res.data.availableTokens + (user.value.tokens?.used || 0), used: user.value.tokens?.used || 0 }
 user.value.availableTokens = res.data.availableTokens
 localStorage.setItem('user', JSON.stringify(user.value))
 }
 return res.data
 }

 async function getCheckinStatus() {
 const res = await api.get('/auth/checkin-status')
 return res.data
 }

 // 邀请
 async function getInviteInfo() {
 const res = await api.get('/auth/invite-info')
 return res.data
 }

 async function getActivities() {
 const res = await api.get('/activities')
 return res.data.activities || []
 }

 async function claimActivity(activityId) {
 const res = await api.post(`/activities/${activityId}/claim`)
 if (user.value && res.data.balance) {
  user.value.points = { version: 1, total: res.data.balance.total, used: res.data.balance.used }
  user.value.availablePoints = res.data.balance.available
  user.value.tokens = { total: res.data.balance.total, used: res.data.balance.used }
  user.value.availableTokens = res.data.balance.available
  localStorage.setItem('user', JSON.stringify(user.value))
 }
 return res.data
 }

 // 公告
 async function checkAnnouncement() {
 try {
 const res = await api.get('/auth/announcement')
 return res.data.show
 } catch { return false }
 }

 async function dismissAnnouncement() {
 await api.post('/auth/dismiss-announcement')
 if (user.value) {
 user.value.showAnnouncement = false
 localStorage.setItem('user', JSON.stringify(user.value))
 }
 }

 function logout() {
 clearAuth()
 }

 return {
 user,
 token,
 isLoggedIn,
 login,
 register,
 sendCode,
 getProfile,
 updateProfile,
 getModelConfig,
 saveModelConfig,
 getTokenInfo,
 getUserStats,
 purchaseTokens,
 checkin, getCheckinStatus,
 getInviteInfo,
 getActivities, claimActivity,
 checkAnnouncement,
 dismissAnnouncement,
 logout,
 setAuth,
 clearAuth,
 }
})
