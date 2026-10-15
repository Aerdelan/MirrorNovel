<template>
 <div class="page-container reference-page">
  <h2>{{ $t('reference.title') }}</h2>
  <p>{{ $t('reference.description') }}</p>
  <div class="card">
   <h3>{{ $t('reference.upload') }}</h3>
   <input v-model.trim="form.title" class="input" :placeholder="$t('reference.name')" maxlength="120" />
   <div class="fields">
    <select v-model="form.novelType" class="input"><option value="normal">{{ $t('reference.normal') }}</option><option value="lightnovel">{{ $t('reference.light') }}</option></select>
    <input v-model.trim="form.mainCategory" class="input" :placeholder="$t('reference.category')" />
    <input v-model.trim="form.subCategory" class="input" :placeholder="$t('reference.subcategory')" />
   </div>
   <input type="file" accept=".txt,.md,.epub,.zip" :disabled="busy" @change="importFile" />
   <p v-if="fileName">{{ fileName }}</p>
   <textarea v-model="form.content" class="textarea" rows="5" :placeholder="$t('reference.paste')" :disabled="busy"></textarea>
   <p>{{ $t('reference.formats') }}</p>
   <button class="btn btn-primary" :disabled="busy || form.content.trim().length < 200" @click="uploadReference">{{ busy ? $t('common.loading') : $t('reference.start') }}</button>
  </div>
  <p v-if="message" role="status">{{ message }}</p>
  <div v-if="authStore.user?.role === 'admin'" class="card">
   <h3>{{ $t('reference.webImport') }}</h3>
   <input v-model.trim="webBookId" class="input" :placeholder="$t('reference.webId')" />
   <input v-model.number="webChapters" class="input" type="number" min="1" max="1000" :placeholder="$t('reference.webChapters')" />
   <div class="actions"><button class="btn btn-outline btn-sm" :disabled="busy" @click="previewWeb">{{ $t('reference.preview') }}</button><button class="btn btn-outline btn-sm" :disabled="busy" @click="downloadWeb">{{ $t('reference.download') }}</button><button class="btn btn-primary btn-sm" :disabled="busy" @click="importWeb">{{ $t('reference.webDistill') }}</button></div>
   <input v-model="webCookie" class="input" type="password" autocomplete="new-password" :placeholder="$t('reference.cookie')" />
   <button class="btn btn-outline btn-sm" :disabled="busy" @click="saveCookie">{{ $t('reference.saveCookie') }}</button>
  </div>
  <div class="library-header"><h3>{{ $t('reference.library') }}</h3><button class="btn btn-outline btn-sm" @click="loadList">{{ $t('reference.refresh') }}</button></div>
  <div v-for="reference in references" :key="reference._id" class="card">
   <h3>{{ reference.title }}</h3><p>{{ [reference.mainCategory, reference.subCategory].filter(Boolean).join(' / ') }}</p>
   <p>{{ reference.progress || (reference.aiProcessed ? $t('reference.ready') : $t('reference.pending')) }}</p>
   <p v-if="reference.error" class="error">{{ reference.error }}</p>
   <div class="actions">
    <button class="btn btn-outline btn-sm" @click="showDetail(reference._id)">{{ $t('reference.detail') }}</button>
    <button class="btn btn-outline btn-sm" :disabled="busy || reference.status === 'processing'" @click="retry(reference._id)">{{ $t('reference.redistill') }}</button>
    <button class="btn btn-primary btn-sm" :disabled="busy || !reference.aiProcessed" @click="extractPersona(reference._id)">{{ $t('reference.persona') }}</button>
    <button class="btn btn-danger btn-sm" :disabled="busy || reference.status === 'processing'" @click="remove(reference)">{{ $t('common.delete') }}</button>
   </div>
   <template v-if="detail?._id === reference._id"><pre>{{ detail.styleProfile }}</pre><h4>{{ $t('reference.characteristics') }}</h4><pre>{{ detail.writingCharacteristics }}</pre><h4>{{ $t('reference.structure') }}</h4><pre>{{ detail.chapterStructure }}</pre><p>{{ detail.vocabularyBank?.join('、') }}</p></template>
  </div>
  <p v-if="!references.length">{{ $t('reference.empty') }}</p>
 </div>
</template>
<script setup>
import { ref, onMounted, onActivated, onDeactivated, onUnmounted } from 'vue'
import api from '../api'
import { readReferenceNovelFile } from '../utils/personaReference'
import { usePersonaStore } from '../stores/persona'
import { useAuthStore } from '../stores/auth'
import { saveBlob } from '../utils/download'
import { useI18n } from '../composables/useI18n'
const { $t } = useI18n()
const personaStore = usePersonaStore()
const authStore = useAuthStore()
const webBookId = ref(''), webChapters = ref(20), webCookie = ref('')
const form = ref({ title: '', mainCategory: '', subCategory: '', content: '', novelType: 'normal', gender: 'unisex' })
const references = ref([]), detail = ref(null), busy = ref(false), message = ref(''), fileName = ref('')
let active = true, timer = null
const errorMessage = error => error.response?.data?.message || $t('reference.failed')
async function loadList() {
 clearTimeout(timer)
 try {
  const list = (await api.get('/reference/list', { timeout: 15000 })).data
  if (!active) return
  references.value = list || []
  const processing = references.value.filter(item => item.status === 'processing')
  if (processing.length) {
   // Detail queries reconcile interrupted jobs, as well as revealing progress.
   await Promise.allSettled(processing.map(item => api.get(`/reference/${item._id}`, { timeout: 15000 })))
   if (active) timer = setTimeout(loadList, 3000)
  }
 } catch (error) { if (active) { message.value = errorMessage(error); timer = setTimeout(loadList, 5000) } }
}
async function importFile(event) {
 const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
 busy.value = true; message.value = ''
 try { const book = await readReferenceNovelFile(file, { maxChars: 5000000 }); form.value.content = book.text; fileName.value = book.name; if (!form.value.title) form.value.title = book.name.replace(/\.[^.]+$/, '').slice(0, 120) }
 catch { message.value = $t('reference.importFailed') } finally { busy.value = false }
}
async function uploadReference() {
 if (busy.value) return
 busy.value = true; message.value = ''
 try { await api.post('/reference/upload', { ...form.value, originalFileName: fileName.value }); form.value.content = ''; message.value = $t('reference.started'); await loadList() }
 catch (error) { message.value = errorMessage(error) } finally { busy.value = false }
}
async function showDetail(id) { try { detail.value = (await api.get(`/reference/${id}`)).data } catch (error) { message.value = errorMessage(error) } }
async function retry(id) { busy.value = true; try { await api.post(`/reference/${id}/distill`); await loadList() } catch (error) { message.value = errorMessage(error) } finally { busy.value = false } }
async function extractPersona(id) { busy.value = true; try { const persona = await personaStore.fromReference(id); message.value = $t('reference.personaCreated', { name: persona.name }) } catch (error) { message.value = errorMessage(error) } finally { busy.value = false } }
async function remove(reference) { if (!confirm($t('reference.deleteConfirm', { name: reference.title }))) return; try { await api.delete(`/reference/${reference._id}`); await loadList() } catch (error) { message.value = errorMessage(error) } }
async function previewWeb() { busy.value = true; try { const data = (await api.get('/reference/fanqie-preview', { params: { bookId: webBookId.value } })).data; form.value.title = data.title; message.value = `${data.title} · ${data.chapterCount}` } catch (error) { message.value = errorMessage(error) } finally { busy.value = false } }
async function downloadWeb() { busy.value = true; try { const response = await api.get('/reference/fanqie-download', { params: { bookId: webBookId.value, chapters: webChapters.value }, responseType: 'blob', timeout: 0 }); await saveBlob(response.data, (form.value.title || 'reference') + '.txt') } catch (error) { message.value = errorMessage(error) } finally { busy.value = false } }
async function importWeb() { busy.value = true; message.value = $t('reference.webDownloading'); try { await api.post('/reference/fanqie-import', { ...form.value, bookId: webBookId.value, chapters: webChapters.value }, { timeout: 0 }); await loadList(); message.value = $t('reference.started') } catch (error) { message.value = errorMessage(error) } finally { busy.value = false } }
async function saveCookie() { busy.value = true; try { await api.post('/reference/fanqie-cookie', { cookie: webCookie.value }); webCookie.value = ''; message.value = $t('reference.cookieSaved') } catch (error) { message.value = errorMessage(error) } finally { busy.value = false } }
onMounted(loadList)
onActivated(() => { active = true; loadList() })
onDeactivated(() => { active = false; clearTimeout(timer) })
onUnmounted(() => { active = false; clearTimeout(timer) })
</script>
<style scoped>
.reference-page { overflow:auto; padding:24px; }
.reference-page > p { margin:12px 0; color:var(--text-secondary); }
.fields, .actions, .library-header { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
.fields > * { flex:1; min-width:150px; }
.library-header { justify-content:space-between; margin:18px 0; }
.reference-page .input, .reference-page textarea { margin:6px 0; }
pre { white-space:pre-wrap; line-height:1.8; margin:12px 0; }
.error { color:var(--error); }
</style>
