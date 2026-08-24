import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '../api'

export const usePersonaStore = defineStore('persona', () => {
  const personas = ref([])
  const loaded = ref(false)

  async function fetchList() {
    const res = await api.get('/persona')
    personas.value = res.data || []
    loaded.value = true
    return personas.value
  }

  async function create(data) {
    const res = await api.post('/persona', data)
    personas.value.push(res.data)
    return res.data
  }

  async function update(id, data) {
    const res = await api.put(`/persona/${id}`, data)
    const idx = personas.value.findIndex(p => p._id === id)
    if (idx > -1) personas.value[idx] = res.data
    return res.data
  }

  async function remove(id) {
    await api.delete(`/persona/${id}`)
    personas.value = personas.value.filter(p => p._id !== id)
  }

  async function clone(id) {
    const res = await api.post(`/persona/${id}/clone`)
    personas.value.push(res.data)
    return res.data
  }

  async function aiGenerate(novelType, hint) {
    const res = await api.post('/persona/ai-generate', { novelType, hint })
    personas.value.push(res.data)
    return res.data
  }


  return {
    personas, loaded,
    fetchList, create, update, remove, clone, aiGenerate,
  }
})
