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

export const useAuthStore = defineStore('auth', () => {
  const user = ref(safeGet('user'))
  const token = ref(safeGet('token') || '')

  const isLoggedIn = computed(() => !!token.value)

  function setAuth(userData, authToken) {
    user.value = userData
    token.value = authToken
    safeSet('user', userData)
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
    return res
  }

  async function register(email, password, code, nickname, inviteCode) {
    const res = await api.post('/auth/register', { email, password, code, nickname, inviteCode })
    setAuth(res.user, res.token)
    return res
  }

  async function sendCode(email) {
    return api.post('/auth/send-code', { email })
  }

  async function getProfile() {
    const res = await api.get('/auth/profile')
    user.value = res.user
    safeSet('user', res.user)
    return res
  }

  async function updateNickname(nickname) {
    const res = await api.put('/auth/profile', { nickname })
    if (user.value) {
      user.value.nickname = nickname
      safeSet('user', user.value)
    }
    return res
  }

  async function fetchOllamaModels() {
    const res = await api.get('/auth/ollama/models')
    return res.models
  }

  async function getModelConfig() {
    const res = await api.get('/auth/model-config')
    return res
  }

  async function saveModelConfig(config) {
    const res = await api.put('/auth/model-config', config)
    if (user.value) {
      user.value.modelConfig = res.modelConfig
      safeSet('user', user.value)
    }
    return res
  }

  async function getTokenInfo() {
    const res = await api.get('/auth/tokens')
    if (user.value) {
      user.value.tokens = { total: res.total, used: res.used }
      user.value.availableTokens = res.available
      safeSet('user', user.value)
    }
    return res
  }

  async function getUserStats() {
    return api.get('/auth/stats')
  }

  async function checkin() {
    const res = await api.post('/auth/checkin')
    if (user.value) {
      user.value.availableTokens = res.availableTokens
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
    fetchOllamaModels, getModelConfig, saveModelConfig,
    getTokenInfo, getUserStats,
    checkin, getCheckinStatus, getInviteInfo,
    checkAnnouncement, dismissAnnouncement,
    logout, setAuth, clearAuth,
  }
})
