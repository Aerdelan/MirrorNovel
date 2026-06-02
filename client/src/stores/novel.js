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
    novelTypes.value = res.data
    return res.data
  }
  async function fetchNovelTypes() { return fetchTypes() }

  async function fetchBookshelf() {
    const res = await api.get('/novel/bookshelf')
    bookshelf.value = res.data
    return res.data
  }

  async function fetchNovelDetail(novelId) {
    const token = localStorage.getItem('token')
    const res = await api.get(`/novel/${novelId}`, { headers: { Authorization: `Bearer ${token}` } })
    return res.data
  }

  async function fetchFullTypes() {
    const res = await api.get('/reference/categories')
    return res.data
  }

  async function pauseNovel(novelId) {
    await api.post(`/novel/pause/${novelId}`)
  }

  async function deleteNovel(novelId) {
    const token = localStorage.getItem('token')
    await api.delete(`/novel/${novelId}`, { headers: { Authorization: `Bearer ${token}` } })
  }

  function setPrefillContinue(data) { prefillContinue.value = data }
  function clearPrefillContinue() { prefillContinue.value = null }

  function stopGeneration() { streamingText.value = '' }

  // ---- 生成 ----
  function startGeneration(params, onChunk, onStatus) {
    streamingText.value = ''
    const token = localStorage.getItem('token')
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/novel/generate')
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr._aborted = false
    let lastIndex = 0
    xhr.onprogress = () => {
      const newData = xhr.responseText.substring(lastIndex)
      lastIndex = xhr.responseText.length
      const lines = newData.split('\n').filter(l => l.startsWith('data: '))
      for (const line of lines) {
        try {
          const event = JSON.parse(line.substring(6))
          if (event.type === 'content') { streamingText.value += event.content; if (onChunk) onChunk(event.content) }
          else if (event.type === 'outline') { generatedOutline.value = event.content; if (onStatus) onStatus({ type: 'outline', content: event.content }) }
          else if (event.type === 'status') { if (onStatus) onStatus(event) }
          else if (event.type === 'novel_created') { if (onStatus) onStatus(event) }
          else if (event.type === 'chapter_start') { if (onStatus) onStatus(event) }
          else if (event.type === 'chapter_end') { if (onStatus) onStatus(event) }
          else if (event.type === 'completed') { if (onStatus) onStatus(event) }
          else if (event.type === 'paused' || event.type === 'token_exhausted') { if (onStatus) onStatus(event) }
        } catch {}
      }
    }
    xhr.onloadend = () => {
      if (!xhr._aborted && onStatus) {
        try { const ls = xhr.responseText.split('\n').filter(l => l.startsWith('data: ')); if (ls.length) { const ev = JSON.parse(ls[ls.length - 1].substring(6)); const terminalTypes = ['completed','paused','token_exhausted','error']; if (!terminalTypes.includes(ev.type)) onStatus({ type: 'completed' }) } } catch {}
      }
    }
    xhr.send(JSON.stringify(params))
    return xhr
  }

  function continueGeneration(novelId, onChunk, onStatus, mode) {
    streamingText.value = ''
    const token = localStorage.getItem('token')
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/novel/continue/${novelId}`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr._aborted = false
    let lastIndex = 0
    xhr.onprogress = () => {
      const newData = xhr.responseText.substring(lastIndex)
      lastIndex = xhr.responseText.length
      const lines = newData.split('\n').filter(l => l.startsWith('data: '))
      for (const line of lines) {
        try {
          const event = JSON.parse(line.substring(6))
          if (event.type === 'content') { streamingText.value += event.content; if (onChunk) onChunk(event.content) }
          else if (event.type === 'status' || event.type === 'chapter_start' || event.type === 'chapter_end' || event.type === 'completed' || event.type === 'paused') { if (onStatus) onStatus(event) }
        } catch {}
      }
    }
    xhr.onloadend = () => { if (!xhr._aborted && onStatus) { try { const ls = xhr.responseText.split('\n').filter(l => l.startsWith('data: ')); if (ls.length) { const ev = JSON.parse(ls[ls.length - 1].substring(6)); const terminalTypes = ['completed','paused','token_exhausted','error']; if (!terminalTypes.includes(ev.type)) onStatus({ type: 'completed' }) } } catch {} } }
    xhr.send(JSON.stringify({ mode: mode || 'chapter' }))
    return xhr
  }

  function startImportContinue(params, onChunk, onStatus) {
    streamingText.value = ''
    const token = localStorage.getItem('token')
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/novel/continue-import')
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr._aborted = false
    let lastIndex = 0
    xhr.onprogress = () => {
      const newData = xhr.responseText.substring(lastIndex)
      lastIndex = xhr.responseText.length
      const lines = newData.split('\n').filter(l => l.startsWith('data: '))
      for (const line of lines) {
        try {
          const event = JSON.parse(line.substring(6))
          if (event.type === 'content') { streamingText.value += event.content; if (onChunk) onChunk(event.content) }
          else if (event.type === 'status' || event.type === 'chapter_start' || event.type === 'chapter_end' || event.type === 'completed' || event.type === 'paused') { if (onStatus) onStatus(event) }
        } catch {}
      }
    }
    xhr.onloadend = () => { if (!xhr._aborted && onStatus) { try { const ls = xhr.responseText.split('\n').filter(l => l.startsWith('data: ')); if (ls.length) { const ev = JSON.parse(ls[ls.length - 1].substring(6)); const terminalTypes = ['completed','paused','token_exhausted','error']; if (!terminalTypes.includes(ev.type)) onStatus({ type: 'completed' }) } } catch {} } }
    xhr.send(JSON.stringify(params))
    return xhr
  }

  // ---- 润色 ----
  function startPolish(params, onChunk, onStatus) {
    const token = localStorage.getItem('token')
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/novel/polish')
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr._aborted = false
    let lastIndex = 0
    xhr.onprogress = () => {
      const newData = xhr.responseText.substring(lastIndex)
      lastIndex = xhr.responseText.length
      const lines = newData.split('\n').filter(l => l.startsWith('data: '))
      for (const line of lines) {
        try {
          const event = JSON.parse(line.substring(6))
          if (event.type === 'content' || event.type === 'deslop_content') { if (onChunk) onChunk(event.content, event.type === 'deslop_content') }
          else if (event.type === 'status' || event.type === 'completed' || event.type === 'error') { if (onStatus) onStatus(event) }
        } catch {}
      }
    }
    xhr.onloadend = () => { if (!xhr._aborted && onStatus) { try { const ls = xhr.responseText.split('\n').filter(l => l.startsWith('data: ')); if (ls.length) { const ev = JSON.parse(ls[ls.length - 1].substring(6)); const terminalTypes = ['completed','paused','token_exhausted','error']; if (!terminalTypes.includes(ev.type)) onStatus({ type: 'completed' }) } } catch {} } }
    xhr.send(JSON.stringify(params))
    return xhr
  }

  return {
    novelTypes, bookshelf, streamingText, generatedOutline, prefillContinue,
    fetchTypes, fetchNovelTypes, fetchBookshelf, fetchNovelDetail, fetchFullTypes,
    pauseNovel, deleteNovel,
    setPrefillContinue, clearPrefillContinue,
    startGeneration, continueGeneration, startImportContinue, stopGeneration,
    startPolish,
  }
})
