import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '../api'

export const useReferenceStore = defineStore('reference', () => {
  const categories = ref(null)
  const referenceList = ref([])

  async function fetchCategories() {
    const res = await api.get('/reference/categories')
    categories.value = res.data
    return res.data
  }

  async function fetchList() {
    const res = await api.get('/reference/list')
    referenceList.value = res.data
    return res.data
  }

  async function uploadFile(formData) {
    const token = localStorage.getItem('token')
    const res = await api.post('/reference/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data', Authorization: `Bearer ${token}` },
    })
    return res.data
  }

  async function deleteReference(id) {
    await api.delete(`/reference/${id}`)
    referenceList.value = referenceList.value.filter(r => r._id !== id)
  }

  async function getDetail(id) {
    const res = await api.get(`/reference/${id}`)
    return res.data
  }

  async function fanqieImport(params) {
    const token = localStorage.getItem('token')
    const res = await api.post('/reference/fanqie-import', params, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.data
  }

  // ---- 番茄 Cookie 管理 ----
  const cookieStatus = ref({ configured: false, length: 0, preview: null })

  async function setCookie(cookie) {
    const token = localStorage.getItem('token')
    const res = await api.post('/reference/fanqie-cookie', { cookie }, {
      headers: { Authorization: `Bearer ${token}` },
    })
    cookieStatus.value = res.data.status
    return res.data
  }

  async function fanqiePreview(bookId) {
    const token = localStorage.getItem('token')
    const res = await api.get(`/reference/fanqie-preview?bookId=${encodeURIComponent(bookId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.data
  }

  async function fetchCookieStatus() {
    const token = localStorage.getItem('token')
    try {
      const res = await api.get('/reference/fanqie-cookie-status', {
        headers: { Authorization: `Bearer ${token}` },
      })
      cookieStatus.value = res.data
    } catch {}
  }

  async function fetchByType(type) {
    const res = await api.get(`/reference/list-by-type?type=${type}`)
    return res.data
  }

  async function fetchLightNovelRefs() {
    return fetchByType('lightnovel')
  }

  async function deleteCookie() {
    const token = localStorage.getItem('token')
    const res = await api.delete('/reference/fanqie-cookie', {
      headers: { Authorization: `Bearer ${token}` },
    })
    cookieStatus.value = res.data.status
    return res.data
  }

  return {
    categories, referenceList, cookieStatus,
    fetchCategories, fetchList, uploadFile, deleteReference, getDetail,
    fanqieImport, fanqiePreview,
    fetchByType, fetchLightNovelRefs,
    setCookie, fetchCookieStatus, deleteCookie,
  }
})
