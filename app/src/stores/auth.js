import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../api'

function safeGet(key) {
  try {
    const v = typeof uni !== 'undefined' && uni.getStorageSync
      ? uni.getStorageSync(key)
      : localStorage.getItem(key)
    if (!v || v === 'undefined' || v === 'null') return null
    try { return JSON.parse(v) } catch { return v }
  } catch { return null }
}

function safeSet(key, val) {
  const str = typeof val === 'string' ? val : JSON.stringify(val)
  if (typeof uni !== 'undefined' && uni.setStorageSync) {
    uni.setStorageSync(key, str)
  } else {
    localStorage.setItem(key, str)
  }
}

function safeRemove(key) {
  if (typeof uni !== 'undefined' && uni.removeStorageSync) {
    uni.removeStorageSync(key)
  } else {
    localStorage.removeItem(key)
  }
}

const PUBLIC_ROUTE_IDS = new Set(['normal_1', 'normal_2', 'advanced_1', 'vip', 'svip'])

function sanitizeUserData(userData) {
  if (!userData || typeof userData !== 'object') return userData
  const { modelConfig, tokens: _legacyTokens, availableTokens: _legacyAvailable, ...publicUser } = userData
  const routeId = PUBLIC_ROUTE_IDS.has(modelConfig?.routeId) ? modelConfig.routeId : 'normal_1'
  return { ...publicUser, modelConfig: { routeId } }
}

export const useAuthStore = defineStore('auth', () => {
  const cachedUser = sanitizeUserData(safeGet('user'))
  const user = ref(cachedUser)
  const token = ref(safeGet('token') || '')

  if (cachedUser) safeSet('user', cachedUser)

  const isLoggedIn = computed(() => !!token.value)

  function setAuth(userData, authToken) {
    const publicUser = sanitizeUserData(userData)
    user.value = publicUser
    token.value = authToken
    safeSet('user', publicUser)
    safeSet('token', authToken)
  }

  function clearAuth() {
    user.value = null
    token.value = ''
    safeRemove('user')
    safeRemove('token')
  }

  async function login(email, password) {
    const res = await api.post('/auth/login', { email, password })
    setAuth(res.user, res.token)
    return { ...res, user: user.value }
  }

  async function register(email, password, code, nickname, inviteCode) {
    const res = await api.post('/auth/register', { email, password, code, nickname, inviteCode })
    setAuth(res.user, res.token)
    return { ...res, user: user.value }
  }

  async function sendCode(email) {
    return api.post('/auth/send-code', { email })
  }

  async function getProfile() {
    const res = await api.get('/auth/profile')
    user.value = sanitizeUserData(res.user)
    safeSet('user', user.value)
    return { ...res, user: user.value }
  }

  async function updateNickname(nickname) {
    const res = await api.put('/auth/profile', { nickname })
    if (user.value) {
      user.value.nickname = nickname
      safeSet('user', user.value)
    }
    return res
  }

  async function getModelConfig() {
    const [config, billing] = await Promise.all([
      api.get('/auth/model-config'),
      api.get('/billing/routes').catch(() => ({ routes: [] })),
    ])
    const routeId = PUBLIC_ROUTE_IDS.has(config?.modelConfig?.routeId) ? config.modelConfig.routeId : 'normal_1'
    const sourceRoutes = Array.isArray(billing?.routes) && billing.routes.length
      ? billing.routes
      : (config?.routes || [])
    return {
      modelConfig: { routeId },
      routes: sourceRoutes
        .map(route => route?.id || route?.routeId)
        .filter(id => PUBLIC_ROUTE_IDS.has(id))
        .map(id => ({ id })),
    }
  }

  async function saveModelConfig(config) {
    const res = await api.put('/auth/model-config', { routeId: config?.routeId || 'normal_1' })
    const routeId = PUBLIC_ROUTE_IDS.has(res?.modelConfig?.routeId) ? res.modelConfig.routeId : 'normal_1'
    if (user.value) {
      user.value.modelConfig = { routeId }
      safeSet('user', user.value)
    }
    return { message: res?.message || '', modelConfig: { routeId } }
  }

  function normalizePoints(payload) {
    const account = payload?.account || payload?.points || payload || {}
    const total = Number(account.total || 0)
    const used = Number(account.used || 0)
    const available = Number(account.available ?? payload?.availablePoints ?? payload?.available ?? Math.max(0, total - used))
    return { total, used, available }
  }

  async function getPointsInfo() {
    let res
    try {
      res = await api.get('/billing/account')
    } catch {
      // 兼容尚未升级 billing 路由的旧服务端。
      res = await api.get('/auth/tokens')
    }
    const points = normalizePoints(res)
    if (user.value) {
      user.value.points = { total: points.total, used: points.used }
      user.value.availablePoints = points.available
      safeSet('user', user.value)
    }
    return { ...points, ledger: Array.isArray(res?.ledger) ? res.ledger : [] }
  }

  // 旧页面调用兼容；返回值已经统一为积分。
  async function getTokenInfo() {
    return getPointsInfo()
  }

  async function getUserStats() {
    return api.get('/auth/stats')
  }

  async function checkin() {
    const res = await api.post('/auth/checkin')
    if (user.value) {
      user.value.availablePoints = res.availablePoints ?? res.availableTokens ?? user.value.availablePoints
      safeSet('user', user.value)
    }
    return res
  }

  async function getCheckinStatus() {
    return api.get('/auth/checkin-status')
  }

  async function getInviteInfo() {
    return api.get('/auth/invite-info')
  }

  async function getActivities() {
    const res = await api.get('/activities')
    return Array.isArray(res?.activities) ? res.activities : []
  }

  async function claimActivity(activityId) {
    const res = await api.post(`/activities/${encodeURIComponent(activityId)}/claim`)
    if (user.value && res?.balance) {
      user.value.points = { total: res.balance.total || 0, used: res.balance.used || 0 }
      user.value.availablePoints = res.balance.available || 0
      safeSet('user', user.value)
    }
    return res
  }

  async function checkAnnouncement() {
    try {
      const res = await api.get('/auth/announcement')
      return res.show
    } catch { return false }
  }

  async function dismissAnnouncement() {
    await api.post('/auth/dismiss-announcement')
    if (user.value) {
      user.value.showAnnouncement = false
      safeSet('user', user.value)
    }
  }

  function logout() {
    clearAuth()
  }

  return {
    user, token, isLoggedIn,
    login, register, sendCode, getProfile, updateNickname,
    getModelConfig, saveModelConfig,
    getPointsInfo, getTokenInfo, getUserStats,
    checkin, getCheckinStatus, getInviteInfo,
    getActivities, claimActivity,
    checkAnnouncement, dismissAnnouncement,
    logout, setAuth, clearAuth,
  }
})
