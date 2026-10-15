import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import api from '../api'
import { useAuthStore } from './auth'

export const usePersonaStore = defineStore('persona', () => {
  const personas = ref([])
  const loaded = ref(false)
  const auth = useAuthStore()
  const account = () => auth.isLoggedIn ? String(auth.user?._id || auth.user?.id || '') : ''
  watch(account, () => { personas.value = []; loaded.value = false })

  async function fetchList() {
    const owner = account()
    const res = await api.get('/persona')
    if (owner !== account()) return []
    personas.value = res.data || []
    loaded.value = true
    return personas.value
  }

  async function create(data) {
    const owner = account()
    const res = await api.post('/persona', data)
    if (owner === account()) personas.value.push(res.data)
    return res.data
  }

  async function update(id, data) {
    const owner = account()
    const res = await api.put(`/persona/${id}`, data)
    const idx = personas.value.findIndex(p => p._id === id)
    if (owner === account() && idx > -1) personas.value[idx] = res.data
    return res.data
  }

  async function remove(id) {
    const owner = account()
    await api.delete(`/persona/${id}`)
    if (owner === account()) personas.value = personas.value.filter(p => p._id !== id)
  }

  async function clone(id) {
    const owner = account()
    const res = await api.post(`/persona/${id}/clone`)
    if (owner === account()) personas.value.push(res.data)
    return res.data
  }

  async function aiGenerate(novelType, hint) {
    const owner = account()
    const res = await api.post('/persona/ai-generate', { novelType, hint })
    if (owner === account()) personas.value.push(res.data)
    return res.data
  }
  async function fromReference(id, scope = 'all') {
    const owner = account()
    const res = await api.post(`/persona/from-reference/${id}`, { scope });
    if (owner === account()) personas.value.push(res.data);
    return res.data;
  }


  return {
    personas, loaded,
    fetchList, create, update, remove, clone, aiGenerate, fromReference,
  }
})
