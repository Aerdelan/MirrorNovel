import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '../api'

export const useNovelStore = defineStore('novel', () => {
  const novelTypes = ref([])
  const bookshelf = ref([])
  const streamingText = ref('')
  const generatedOutline = ref('')
  const prefillContinue = ref(null)

  async function fetchTypes() {
    const res = await api.get('/novel/types')
    novelTypes.value = res
    return res
  }
  async function fetchNovelTypes() { return fetchTypes() }

  async function fetchBookshelf() {
    const res = await api.get('/novel/bookshelf')
    bookshelf.value = res
    return res
  }

  async function fetchNovelDetail(novelId) {
    const token = typeof uni !== 'undefined' && uni.getStorageSync ? uni.getStorageSync('token') : (localStorage.getItem('token') || '')
    const res = await api.get(`/novel/${novelId}`, { headers: { Authorization: `Bearer ${token}` } })
    return res
  }

  async function pauseNovel(novelId) {
    await api.post(`/novel/pause/${novelId}`)
  }

  async function deleteNovel(novelId) {
    const token = typeof uni !== 'undefined' && uni.getStorageSync ? uni.getStorageSync('token') : (localStorage.getItem('token') || '')
    await api.delete(`/novel/${novelId}`, { headers: { Authorization: `Bearer ${token}` } })
  }

  function setPrefillContinue(data) { prefillContinue.value = data }
  function clearPrefillContinue() { prefillContinue.value = null }
  function stopGeneration() { streamingText.value = '' }

  return {
    novelTypes, bookshelf, streamingText, generatedOutline, prefillContinue,
    fetchTypes, fetchNovelTypes, fetchBookshelf, fetchNovelDetail,
    pauseNovel, deleteNovel,
    setPrefillContinue, clearPrefillContinue, stopGeneration,
  }
})
