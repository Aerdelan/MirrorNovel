import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '../api'
import { buildModelOverrideHeader, HEADER_NAME } from '../utils/modelOverride'
import { classifySSEEnd, createSSEParser } from '../utils/sseParser'
import { normalizeNovelChapters } from '../utils/novelChapters'

const STREAM_DISCONNECTED_MESSAGE = '连接已中断，后台任务状态未知；请返回书架刷新状态'

function extractStreamError(xhr) {
 const fallback = xhr.status ? `请求失败(${xhr.status})` : '网络连接已中断'
 try {
  const body = JSON.parse(xhr.responseText)
  return body.error?.message || body.error || body.message || fallback
 } catch { return fallback }
}

function unexpectedStreamEnd(xhr, parser) {
 const result = classifySSEEnd({ status: xhr.status, state: parser.getState(), aborted: xhr._aborted })
 if (result.kind === 'terminal' || result.kind === 'aborted') return null
 if (result.kind === 'http_error' || result.kind === 'empty_response') {
  return { type: 'error', message: extractStreamError(xhr) }
 }
 return {
  type: 'disconnected',
  status: 'unknown',
  recoverable: true,
  message: STREAM_DISCONNECTED_MESSAGE,
 }
}

// 桌面端「模型线路」页配置的本机线路通过 x-mn-model-config 头下发。
// axios 实例与 useSSE 都已带上，但本文件里 /generate、/continue、/continue-import、
// /polish 走的是裸 XMLHttpRequest，历史上漏带这个头——导致「大纲/蓝图正常、
// 整本生成报‘AI 服务线路尚未配置’」（生成回落到了账号配置）。统一在此补上。
function applyModelOverrideHeader(xhr) {
 try {
  const headerValue = buildModelOverrideHeader()
  if (headerValue) xhr.setRequestHeader(HEADER_NAME, headerValue)
 } catch { /* 本机配置损坏时忽略，退化为账号配置 */ }
}

export const useNovelStore = defineStore('novel', () => {
 const novelTypes = ref([])
 const bookshelf = ref([])
 const streamingText = ref('')
 const generatedOutline = ref('')
 const prefillContinue = ref(null)
 const activeGenerationRequest = ref(null)
 const skuCatalog = ref(null)

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

 async function fetchNovelDetail(novelId, options = {}) {
 const token = localStorage.getItem('token')
 const res = await api.get(`/novel/${novelId}`, { ...options, headers: { Authorization: `Bearer ${token}` } })
 return normalizeNovelChapters(res.data)
 }

async function fetchFullTypes() {
 const res = await api.get('/novel/types/full')
 return res.data
 }

 // 番茄式多选类型 SKU 目录（频道→大类→题材 + 情节/人设/风格基调标签库）。
 // 结构与大类基本稳定，缓存一次即可；失败时返回 null 由调用方兜底。
 async function fetchSkuCatalog(force) {
 if (skuCatalog.value && !force) return skuCatalog.value
 const res = await api.get('/novel/types/sku')
 skuCatalog.value = res.data || null
 return skuCatalog.value
 }

 async function pauseNovel(novelId) {
 await api.post(`/novel/pause/${novelId}`)
 }

 async function fetchGenerationJob(novelId, afterSeq) {
 const suffix = afterSeq == null ? '' : `/events?after=${encodeURIComponent(afterSeq)}`
 const res = await api.get(`/novel/generation-job/${novelId}${suffix}`, { timeout: 15000 })
 return res.data
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
 applyModelOverrideHeader(xhr)
 xhr._aborted = false
 let lastIndex = 0
 let humanizedReceived = false
 let humanizedContent = ''
 const parser = createSSEParser({ onEvent(event) {
 if (event.type === 'content') {
 if (!humanizedReceived) { streamingText.value += event.content; if (onChunk) onChunk(event.content, streamingText.value) }
 }
 else if (event.type === 'draft_restored') {
 streamingText.value = String(event.content || '')
 humanizedReceived = false
 if (onStatus) onStatus(event)
 }
 else if (event.type === 'outline') { generatedOutline.value = event.content; if (onStatus) onStatus({ type: 'outline', content: event.content }) }
 else if (event.type === 'chapter_start') { humanizedReceived = false; if (onStatus) onStatus(event) }
 else if (event.type === 'humanized') { humanizedReceived = true; humanizedContent = event.content; if (onStatus) onStatus(event) }
 else if (onStatus) onStatus(event)
 } })
 xhr.onprogress = () => {
 parser.push(xhr.responseText.substring(lastIndex))
 lastIndex = xhr.responseText.length
 // 如果已收到改写内容，用改写后的文本替换显示
 if (humanizedReceived) { streamingText.value = humanizedContent }
 }
 xhr.onloadend = () => {
 parser.push(xhr.responseText.substring(lastIndex)); lastIndex = xhr.responseText.length; parser.finish()
 if (activeGenerationRequest.value === xhr) activeGenerationRequest.value = null
 const endEvent = unexpectedStreamEnd(xhr, parser)
 if (endEvent && onStatus) onStatus(endEvent)
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
 applyModelOverrideHeader(xhr)
 xhr._aborted = false
 let lastIndex = 0
 const parser = createSSEParser({ onEvent(event) {
 if (event.type === 'content') { streamingText.value += event.content; if (onChunk) onChunk(event.content, streamingText.value) }
 else if (event.type === 'draft_restored') {
 streamingText.value = String(event.content || '')
 if (onChunk) onChunk('', streamingText.value)
 if (onStatus) onStatus(event)
 }
 else if (onStatus) onStatus(event)
 } })
 xhr.onprogress = () => {
 parser.push(xhr.responseText.substring(lastIndex))
 lastIndex = xhr.responseText.length
 }
 xhr.send(JSON.stringify({ mode: mode || 'chapter' }))
 return new Promise((resolve, reject) => {
 xhr.onloadend = () => {
 parser.push(xhr.responseText.substring(lastIndex)); lastIndex = xhr.responseText.length; parser.finish()
 if (activeGenerationRequest.value === xhr) activeGenerationRequest.value = null
 if (xhr._aborted) return resolve()
 const endEvent = unexpectedStreamEnd(xhr, parser)
 if (endEvent) {
  if (onStatus) onStatus(endEvent)
  if (endEvent.type === 'error') return reject(new Error(endEvent.message))
 }
 resolve()
 }
 // XHR guarantees loadend after error; final classification happens there so
 // onerror + onloadend cannot report the same disconnect twice.
 xhr.onerror = () => {}
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
 applyModelOverrideHeader(xhr)
 xhr._aborted = false
 let lastIndex = 0
 const parser = createSSEParser({ onEvent(event) {
 if (event.type === 'content') { streamingText.value += event.content; if (onChunk) onChunk(event.content, streamingText.value) }
 else if (event.type === 'draft_restored') {
 streamingText.value = String(event.content || '')
 if (onChunk) onChunk('', streamingText.value)
 if (onStatus) onStatus(event)
 }
 else if (onStatus) onStatus(event)
 } })
 xhr.onprogress = () => {
 parser.push(xhr.responseText.substring(lastIndex))
 lastIndex = xhr.responseText.length
 }
 xhr.send(JSON.stringify(params))
 return new Promise((resolve, reject) => {
 xhr.onloadend = () => {
 parser.push(xhr.responseText.substring(lastIndex)); lastIndex = xhr.responseText.length; parser.finish()
 if (activeGenerationRequest.value === xhr) activeGenerationRequest.value = null
 if (xhr._aborted) return resolve()
 const endEvent = unexpectedStreamEnd(xhr, parser)
 if (endEvent) {
  if (onStatus) onStatus(endEvent)
  if (endEvent.type === 'error') return reject(new Error(endEvent.message))
 }
 resolve()
 }
 xhr.onerror = () => {}
 })
 }

 // ---- 润色 ----
 function startPolish(params, onChunk, onStatus) {
 const token = localStorage.getItem('token')
 const xhr = new XMLHttpRequest()
 xhr.open('POST', '/api/novel/polish')
 xhr.setRequestHeader('Authorization', `Bearer ${token}`)
 xhr.setRequestHeader('Content-Type', 'application/json')
 applyModelOverrideHeader(xhr)
 xhr._aborted = false
 let lastIndex = 0
 const parser = createSSEParser({ onEvent(event) {
 if (event.type === 'content' || event.type === 'deslop_content') { if (onChunk) onChunk(event.content, event.type === 'deslop_content') }
 else if (onStatus) onStatus(event)
 } })
 xhr.onprogress = () => {
 parser.push(xhr.responseText.substring(lastIndex))
 lastIndex = xhr.responseText.length
 }
 xhr.onloadend = () => {
  parser.push(xhr.responseText.substring(lastIndex)); lastIndex = xhr.responseText.length; parser.finish()
  const endEvent = unexpectedStreamEnd(xhr, parser)
  if (endEvent && onStatus) onStatus(endEvent)
 }
 xhr.send(JSON.stringify(params))
 return xhr
 }

 return {
 novelTypes, bookshelf, streamingText, generatedOutline, prefillContinue, skuCatalog,
 fetchTypes, fetchNovelTypes, fetchBookshelf, fetchNovelDetail, fetchFullTypes, fetchSkuCatalog,
 pauseNovel, fetchGenerationJob, deleteNovel,
 setPrefillContinue, clearPrefillContinue,
 startGeneration, continueGeneration, startImportContinue, stopGeneration,
 startPolish,
 }
})
