import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '../api'
import { useAuthStore } from './auth'

// A3 写作反馈与偏好。记录/提炼/确认全部是显式操作；候选与停用偏好不参与生成。
export const useWritingStyleStore = defineStore('writingStyle', () => {
  const feedbacks = ref([])
  const feedbackTotal = ref(0)
  const preferences = ref([])
  const preferenceTotal = ref(0)
  const loading = ref(false)
  const auth = useAuthStore()

  async function fetchFeedbacks({ page = 1, limit = 20, novelId } = {}) {
    const owner = auth.isLoggedIn ? String(auth.user?._id || auth.user?.id || '') : ''
    loading.value = true
    try {
      const params = { page, limit }
      if (novelId) params.novelId = novelId
      const { data } = await api.get('/writing-feedback', { params, timeout: 15000 })
      if (owner !== (auth.isLoggedIn ? String(auth.user?._id || auth.user?.id || '') : '')) return []
      feedbacks.value = data.items || []
      feedbackTotal.value = data.total || 0
      return feedbacks.value
    } finally { loading.value = false }
  }

  async function fetchPreferences({ page = 1, limit = 50 } = {}) {
    const owner = auth.isLoggedIn ? String(auth.user?._id || auth.user?.id || '') : ''
    loading.value = true
    try {
      const { data } = await api.get('/writing-preferences', { params: { page, limit }, timeout: 15000 })
      if (owner !== (auth.isLoggedIn ? String(auth.user?._id || auth.user?.id || '') : '')) return []
      preferences.value = data.items || []
      preferenceTotal.value = data.total || 0
      return preferences.value
    } finally { loading.value = false }
  }

  async function recordFeedback(payload) {
    const { data } = await api.post('/writing-feedback', payload, { timeout: 15000 })
    return data
  }

  // 显式 AI 提炼：产生一次推理调用，由调用方确认后触发。
  async function distillFeedback(id) {
    const { data } = await api.post(`/writing-feedback/${id}/distill`, {}, { timeout: 180000 })
    return data
  }

  async function removeFeedback(id) {
    await api.delete(`/writing-feedback/${id}`, { timeout: 15000 })
  }

  async function createPreference(payload) {
    const { data } = await api.post('/writing-preferences', payload, { timeout: 15000 })
    return data
  }

  async function confirmPreference(id) {
    const { data } = await api.post(`/writing-preferences/${id}/confirm`, {}, { timeout: 15000 })
    return data.preference
  }

  async function dismissPreference(id) {
    await api.post(`/writing-preferences/${id}/dismiss`, {}, { timeout: 15000 })
  }

  async function pausePreference(id) {
    const { data } = await api.post(`/writing-preferences/${id}/pause`, {}, { timeout: 15000 })
    return data.preference
  }

  async function activatePreference(id) {
    const { data } = await api.post(`/writing-preferences/${id}/activate`, {}, { timeout: 15000 })
    return data.preference
  }

  async function removePreference(id) {
    await api.delete(`/writing-preferences/${id}`, { timeout: 15000 })
  }

  function applyPreferenceLocal(preference) {
    if (!preference?._id) return
    const idx = preferences.value.findIndex(item => item._id === preference._id)
    if (idx > -1) preferences.value.splice(idx, 1, preference)
  }

  return {
    feedbacks, feedbackTotal, preferences, preferenceTotal, loading,
    fetchFeedbacks, fetchPreferences, recordFeedback, distillFeedback, removeFeedback,
    createPreference, confirmPreference, dismissPreference, pausePreference, activatePreference, removePreference,
    applyPreferenceLocal,
  }
})
