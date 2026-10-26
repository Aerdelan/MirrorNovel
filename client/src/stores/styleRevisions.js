import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '../api'
import { useAuthStore } from './auth'

// A2 风格版本。版本不可变：这里只有创建与读取，没有更新。
export const useStyleRevisionsStore = defineStore('styleRevisions', () => {
  const items = ref([])
  const total = ref(0)
  const loading = ref(false)
  const auth = useAuthStore()

  async function fetchList() {
    const owner = auth.isLoggedIn ? String(auth.user?._id || auth.user?.id || '') : ''
    loading.value = true
    try {
      const { data } = await api.get('/style-revisions', { timeout: 15000 })
      if (owner !== (auth.isLoggedIn ? String(auth.user?._id || auth.user?.id || '') : '')) return []
      items.value = data.items || []
      total.value = data.total || 0
      return items.value
    } finally { loading.value = false }
  }

  async function create(payload) {
    const { data } = await api.post('/style-revisions', payload, { timeout: 15000 })
    return data.revision
  }

  async function compare(aId, bId) {
    const { data } = await api.get(`/style-revisions/compare/${aId}/${bId}`, { timeout: 15000 })
    return data.diff
  }

  return { items, total, loading, fetchList, create, compare }
})
