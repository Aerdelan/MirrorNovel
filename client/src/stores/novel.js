import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '../api'

export const useNovelStore = defineStore('novel', () => {
 const novelTypes = ref([])
 const bookshelf = ref([])
 const streamingText = ref('')
 const generatedOutline = ref('')
 const prefillContinue = ref(null)
 const activeGenerationRequest = ref(null)

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

 function stopGeneration() {
 const request = activeGenerationRequest.value
 if (request && request.readyState !== XMLHttpRequest.DONE) {
 request._aborted = true
 request.abort()
 }
 activeGenerationRequest.value = null
 }

 // ---- 生成 ----
 function startGeneration(params, onChunk, onStatus) {
 streamingText.value = ''
 const token = localStorage.getItem('token')
 const xhr = new XMLHttpRequest()
 activeGenerationRequest.value = xhr
 xhr.open('POST', '/api/novel/generate')
 xhr.setRequestHeader('Authorization', `Bearer ${token}`)
 xhr.setRequestHeader('Content-Type', 'application/json')
 xhr._aborted = false
 let lastIndex = 0
 let humanizedReceived = false
 let humanizedContent = ''
 xhr.onprogress = () => {
 const newData = xhr.responseText.substring(lastIndex)
 lastIndex = xhr.responseText.length
 const lines = newData.split('\n').filter(l => l.startsWith('data: '))
 for (const line of lines) {
 try {
 const event = JSON.parse(line.substring(6))
 if (event.type === 'content') {
 if (!humanizedReceived) { streamingText.value += event.content; if (onChunk) onChunk(event.content, streamingText.value) }
 }
 else if (event.type === 'outline') { generatedOutline.value = event.content; if (onStatus) onStatus({ type: 'outline', content: event.content }) }
 else if (event.type === 'status') { if (onStatus) onStatus(event) }
 else if (event.type === 'thinking') { if (onStatus) onStatus(event) }
 else if (event.type === 'novel_created') { if (onStatus) onStatus(event) }
 else if (event.type === 'chapter_start') { humanizedReceived = false; if (onStatus) onStatus(event) }
 else if (event.type === 'chapter_end') { if (onStatus) onStatus(event) }
 else if (event.type === 'quality_notice') { if (onStatus) onStatus(event) }
 else if (event.type === 'blueprint_proposal') { if (onStatus) onStatus(event) }
 else if (event.type === 'completed') { if (onStatus) onStatus(event) }
 else if (event.type === 'paused' || event.type === 'token_exhausted' || event.type === 'plan_needs_extension') { if (onStatus) onStatus(event) }
 else if (event.type === 'humanized') { humanizedReceived = true; humanizedContent = event.content; if (onStatus) onStatus(event) }
 else if (event.type === 'error') { if (onStatus) onStatus(event) }
 } catch {}
 }
 // 如果已收到改写内容，用改写后的文本替换显示
 if (humanizedReceived) { streamingText.value = humanizedContent }
 }
 xhr.onloadend = () => {
 if (activeGenerationRequest.value === xhr) activeGenerationRequest.value = null
 if (!xhr._aborted && onStatus) {
 try { const ls = xhr.responseText.split('\n').filter(l => l.startsWith('data: ')); if (ls.length) { const ev = JSON.parse(ls[ls.length - 1].substring(6)); const terminalTypes = ['completed','paused','token_exhausted','plan_needs_extension','error']; if (!terminalTypes.includes(ev.type)) onStatus({ type: 'completed' }) } } catch {}
 }
 }
 xhr.send(JSON.stringify(params))
 return xhr
 }

 function continueGeneration(novelId, onChunk, onStatus, mode) {
 streamingText.value = ''
 const token = localStorage.getItem('token')
 const xhr = new XMLHttpRequest()
 activeGenerationRequest.value = xhr
 xhr.open('POST', `/api/novel/continue/${novelId}`)
 xhr.setRequestHeader('Authorization', `Bearer ${token}`)
 xhr.setRequestHeader('Content-Type', 'application/json')
 xhr._aborted = false
 xhr._receivedTerminal = false
 let lastIndex = 0
 xhr.onprogress = () => {
 const newData = xhr.responseText.substring(lastIndex)
 lastIndex = xhr.responseText.length
 const lines = newData.split('\n').filter(l => l.startsWith('data: '))
 for (const line of lines) {
 try {
 const event = JSON.parse(line.substring(6))
 if (event.type === 'content') { streamingText.value += event.content; if (onChunk) onChunk(event.content, streamingText.value) }
 else if (event.type === 'thinking') { if (onStatus) onStatus(event) }
 else if (event.type === 'status' || event.type === 'chapter_start' || event.type === 'chapter_end' || event.type === 'quality_notice' || event.type === 'blueprint_proposal' || event.type === 'completed' || event.type === 'paused' || event.type === 'token_exhausted' || event.type === 'plan_needs_extension' || event.type === 'error') {
 if (['completed','paused','token_exhausted','plan_needs_extension','error'].includes(event.type)) xhr._receivedTerminal = true
 if (onStatus) onStatus(event)
 }
 } catch {}
 }
 }
 xhr.send(JSON.stringify({ mode: mode || 'chapter' }))
 return new Promise((resolve, reject) => {
 xhr.onloadend = () => {
 if (activeGenerationRequest.value === xhr) activeGenerationRequest.value = null
 if (xhr._aborted) return resolve()
 if (xhr.status >= 400) {
 let message = `请求失败(${xhr.status})`
 try { const body = JSON.parse(xhr.responseText); message = body.error || body.message || message } catch {}
 if (onStatus) onStatus({ type: 'error', message })
 return reject(new Error(message))
 }
 if (onStatus && !xhr._receivedTerminal) onStatus({ type: 'completed' })
 resolve()
 }
 xhr.onerror = () => {
 const message = '网络请求失败'
 if (onStatus) onStatus({ type: 'error', message })
 reject(new Error(message))
 }
 })
 }

 function startImportContinue(params, onChunk, onStatus) {
 streamingText.value = ''
 const token = localStorage.getItem('token')
 const xhr = new XMLHttpRequest()
 activeGenerationRequest.value = xhr
 xhr.open('POST', '/api/novel/continue-import')
 xhr.setRequestHeader('Authorization', `Bearer ${token}`)
 xhr.setRequestHeader('Content-Type', 'application/json')
 xhr._aborted = false
 xhr._receivedTerminal = false
 let lastIndex = 0
 xhr.onprogress = () => {
 const newData = xhr.responseText.substring(lastIndex)
 lastIndex = xhr.responseText.length
 const lines = newData.split('\n').filter(l => l.startsWith('data: '))
 for (const line of lines) {
 try {
 const event = JSON.parse(line.substring(6))
 if (event.type === 'content') { streamingText.value += event.content; if (onChunk) onChunk(event.content, streamingText.value) }
 else if (event.type === 'thinking') { if (onStatus) onStatus(event) }
 else if (event.type === 'status' || event.type === 'chapter_start' || event.type === 'chapter_end' || event.type === 'completed' || event.type === 'paused' || event.type === 'token_exhausted' || event.type === 'error') {
 if (['completed','paused','token_exhausted','error'].includes(event.type)) xhr._receivedTerminal = true
 if (onStatus) onStatus(event)
 }
 } catch {}
 }
 }
 xhr.send(JSON.stringify(params))
 return new Promise((resolve, reject) => {
 xhr.onloadend = () => {
 if (activeGenerationRequest.value === xhr) activeGenerationRequest.value = null
 if (xhr._aborted) return resolve()
 if (xhr.status >= 400) {
 let message = `请求失败(${xhr.status})`
 try { const body = JSON.parse(xhr.responseText); message = body.error || body.message || message } catch {}
 if (onStatus) onStatus({ type: 'error', message })
 return reject(new Error(message))
 }
 if (onStatus && !xhr._receivedTerminal) onStatus({ type: 'completed' })
 resolve()
 }
 xhr.onerror = () => {
 const message = '网络请求失败'
 if (onStatus) onStatus({ type: 'error', message })
 reject(new Error(message))
 }
 })
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
 else if (event.type === 'final_content' || event.type === 'diagnosis' || event.type === 'status' || event.type === 'completed' || event.type === 'token_exhausted' || event.type === 'error') { if (onStatus) onStatus(event) }
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
