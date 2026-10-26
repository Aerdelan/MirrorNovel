import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '../api'
import { useAuthStore } from './auth'

// 认可样稿库（A1）。所有请求只读当前账号；草稿/撤销样稿由服务端把关，
// 这里不做本地白名单判断，避免两套规则不一致。
export const useWritingSamplesStore = defineStore('writingSamples', () => {
  const items = ref([])
  const total = ref(0)
  const page = ref(1)
  const limit = ref(20)
  const statusCounts = ref({})
  const loading = ref(false)
  const status = ref('all')
  const auth = useAuthStore()

  async function fetchList({ page: nextPage, status: nextStatus } = {}) {
    const owner = auth.isLoggedIn ? String(auth.user?._id || auth.user?.id || '') : ''
    loading.value = true
    try {
      if (nextStatus !== undefined) status.value = nextStatus
      const params = { page: nextPage || page.value, limit: limit.value }
      if (status.value && status.value !== 'all') params.status = status.value
      const { data } = await api.get('/writing-samples', { params, timeout: 15000 })
      if (owner !== (auth.isLoggedIn ? String(auth.user?._id || auth.user?.id || '') : '')) return []
      items.value = data.items || []
      total.value = data.total || 0
      page.value = data.page || 1
      statusCounts.value = data.statusCounts || {}
      return items.value
    } finally { loading.value = false }
  }

  async function create(payload) {
    const { data } = await api.post('/writing-samples', payload, { timeout: 15000 })
    return data
  }

  async function update(id, payload) {
    const { data } = await api.put(`/writing-samples/${id}`, payload, { timeout: 15000 })
    return data.sample
  }

  async function approve(id, allowedForModelInput = true) {
    const { data } = await api.post(`/writing-samples/${id}/approve`, { allowedForModelInput }, { timeout: 15000 })
    return data.sample
  }

  async function revoke(id) {
    const { data } = await api.post(`/writing-samples/${id}/revoke`, {}, { timeout: 15000 })
    return data.sample
  }

  async function remove(id) {
    await api.delete(`/writing-samples/${id}`, { timeout: 15000 })
  }

  function applyLocal(sample) {
    if (!sample?._id) return
    const idx = items.value.findIndex(item => item._id === sample._id)
    if (idx > -1) items.value.splice(idx, 1, sample)
  }

  return { items, total, page, limit, statusCounts, loading, status, fetchList, create, update, approve, revoke, remove, applyLocal }
})
