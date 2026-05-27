import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../api'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(JSON.parse(localStorage.getItem('user') || 'null'))
  const token = ref(localStorage.getItem('token') || '')

  const isLoggedIn = computed(() => !!token.value)

  function setAuth(userData, authToken) {
    user.value = userData
    token.value = authToken
    localStorage.setItem('user', JSON.stringify(userData))
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
    user.value = res.data.user
    localStorage.setItem('user', JSON.stringify(res.data.user))
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

  async function fetchOllamaModels() {
    const res = await api.get('/auth/ollama/models')
    return res.data.models
  }

  async function getModelConfig() {
    const res = await api.get('/auth/model-config')
    return res.data.modelConfig
  }

  async function saveModelConfig(config) {
    const res = await api.put('/auth/model-config', config)
    if (user.value) {
      user.value.modelConfig = res.data.modelConfig
      localStorage.setItem('user', JSON.stringify(user.value))
    }
    return res.data
  }

  // Token 相关
  async function getTokenInfo() {
    const res = await api.get('/auth/tokens')
    if (user.value) {
      user.value.tokens = { total: res.data.total, used: res.data.used }
      user.value.availableTokens = res.data.available
      localStorage.setItem('user', JSON.stringify(user.value))
    }
    return res.data
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
    fetchOllamaModels,
    getModelConfig,
    saveModelConfig,
    getTokenInfo,
    getUserStats,
    purchaseTokens,
    checkin, getCheckinStatus,
    getInviteInfo,
    checkAnnouncement,
    dismissAnnouncement,
    logout,
    setAuth,
    clearAuth,
  }
})
