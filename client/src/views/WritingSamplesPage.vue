<template>
 <div class="page-container samples-page">
  <h2>{{ $t('writingSamples.title') }}</h2>
  <p>{{ $t('writingSamples.description') }}</p>
  <div class="samples-toolbar">
   <div class="samples-tabs" role="tablist">
    <button v-for="tab in statusTabs" :key="tab.value" class="btn btn-sm" :class="tab.value === store.status ? 'btn-primary' : 'btn-outline'"
     :disabled="store.loading" role="tab" :aria-selected="tab.value === store.status" @click="switchStatus(tab.value)">
     {{ tab.label }} ({{ tab.count }})
    </button>
   </div>
   <button class="btn btn-primary btn-sm" @click="openCreate">{{ $t('writingSamples.create') }}</button>
  </div>
  <p v-if="message" role="status">{{ message }}</p>
  <div v-if="store.loading && !store.items.length" class="samples-empty">{{ $t('common.loading') }}</div>
  <div v-else-if="!store.items.length" class="samples-empty">{{ $t('writingSamples.empty') }}</div>
  <div v-for="sample in store.items" :key="sample._id" class="card sample-card">
   <div class="sample-head">
    <strong class="sample-title">{{ sample.title || $t('writingSamples.untitled') }}</strong>
    <span class="badge" :class="statusClass(sample.status)">{{ $t(`writingSamples.status_${sample.status}`) }}</span>
    <span class="badge badge-blue">{{ $t(`writingSamples.scope_${sample.scope}`) }}</span>
    <span class="badge">{{ $t(`writingSamples.scene_${sample.sceneType}`) }}</span>
   </div>
   <p class="sample-source">{{ sourceLine(sample) }} · {{ $t('writingSamples.updated') }} {{ formatTime(sample.updatedAt) }}</p>
   <pre class="sample-content" :class="{ expanded: expandedId === sample._id }">{{ sample.content }}</pre>
   <button v-if="sample.content.length > 160 && expandedId !== sample._id" class="btn btn-ghost btn-sm" @click="expandedId = sample._id">{{ $t('writingSamples.expand') }}</button>
   <p v-if="sample.notes" class="sample-notes">{{ $t('writingSamples.notesLabel') }}{{ sample.notes }}</p>
   <div class="sample-actions">
    <button v-if="sample.status !== 'approved'" class="btn btn-primary btn-sm" :disabled="rowBusy" @click="approveSample(sample)">
     {{ sample.status === 'revoked' ? $t('writingSamples.reApprove') : $t('writingSamples.approve') }}
    </button>
    <button v-else class="btn btn-outline btn-sm" :disabled="rowBusy" @click="revokeSample(sample)">{{ $t('writingSamples.revoke') }}</button>
    <button class="btn btn-outline btn-sm" :disabled="rowBusy" @click="openEdit(sample)">{{ $t('writingSamples.edit') }}</button>
    <button class="btn btn-danger btn-sm" :disabled="rowBusy" @click="removeSample(sample)">{{ $t('common.delete') }}</button>
    <span class="sample-allow">{{ sample.allowedForModelInput ? $t('writingSamples.allowYes') : $t('writingSamples.allowNo') }}</span>
   </div>
  </div>
  <div v-if="totalPages > 1" class="samples-pager">
   <button class="btn btn-outline btn-sm" :disabled="store.page <= 1 || store.loading" @click="go(store.page - 1)">{{ $t('writingSamples.prevPage') }}</button>
   <span>{{ store.page }} / {{ totalPages }}</span>
   <button class="btn btn-outline btn-sm" :disabled="store.page >= totalPages || store.loading" @click="go(store.page + 1)">{{ $t('writingSamples.nextPage') }}</button>
  </div>
  <WritingSampleEditor :open="editorOpen" :sample="editingSample" :preset="editorPreset" @close="editorOpen = false" @saved="onSaved" />
  <StyleRevisionPanel />
  <WritingPreferencePanel />
 </div>
</template>

<script setup>
import { computed, ref, onMounted, onActivated } from 'vue'
import { useI18n } from '../composables/useI18n'
import { useWritingSamplesStore } from '../stores/writingSamples'
import WritingSampleEditor from '../components/WritingSampleEditor.vue'
import StyleRevisionPanel from '../components/StyleRevisionPanel.vue'
import WritingPreferencePanel from '../components/WritingPreferencePanel.vue'

const { $t } = useI18n()
const store = useWritingSamplesStore()
const message = ref('')
const rowBusy = ref(false)
const expandedId = ref('')
const editorOpen = ref(false)
const editingSample = ref(null)
const editorPreset = ref(null)

const totalPages = computed(() => Math.max(Math.ceil(store.total / store.limit), 1))
const statusTabs = computed(() => {
 const counts = store.statusCounts || {}
 const all = (counts.draft || 0) + (counts.approved || 0) + (counts.revoked || 0)
 return [
  { value: 'all', label: $t('writingSamples.tabAll'), count: all },
  { value: 'draft', label: $t('writingSamples.status_draft'), count: counts.draft || 0 },
  { value: 'approved', label: $t('writingSamples.status_approved'), count: counts.approved || 0 },
  { value: 'revoked', label: $t('writingSamples.status_revoked'), count: counts.revoked || 0 },
 ]
})

function statusClass(status) {
 return { draft: 'badge-blue', approved: 'badge-green', revoked: '' }[status] || ''
}

function sourceLine(sample) {
 if (sample.sourceKind === 'authorized_reference') return $t('writingSamples.sourceReference', { title: sample.sourceReferenceTitle || '' })
 if (sample.sourceNovelId) return sample.sourceChapterNumber
  ? $t('writingSamples.sourceChapter', { title: sample.sourceNovelTitle || '', n: sample.sourceChapterNumber })
  : $t('writingSamples.sourceNovel', { title: sample.sourceNovelTitle || '' })
 if (sample.sourceKind === 'human_edit') return $t('writingSamples.sourceHumanEdit')
 return $t('writingSamples.sourceManual')
}

function formatTime(value) {
 const time = new Date(value)
 return Number.isNaN(time.getTime()) ? '' : time.toLocaleString()
}

async function switchStatus(value) {
 if (store.status === value) return
 expandedId.value = ''
 try { await store.fetchList({ page: 1, status: value }) }
 catch (error) { message.value = error.response?.data?.message || $t('writingSamples.loadFailed') }
}

async function go(page) {
 try { await store.fetchList({ page }) }
 catch (error) { message.value = error.response?.data?.message || $t('writingSamples.loadFailed') }
}

function openCreate() {
 editingSample.value = null
 editorPreset.value = null
 editorOpen.value = true
}

function openEdit(sample) {
 editingSample.value = sample
 editorPreset.value = null
 editorOpen.value = true
}

async function refresh() {
 try { await store.fetchList() }
 catch { /* 列表刷新失败时保留现有内容，顶部消息已提示 */ }
}

function onSaved(sample, meta = {}) {
 message.value = meta.duplicate ? $t('writingSamples.duplicateSaved') : $t('writingSamples.saved')
 expandedId.value = ''
 refresh()
}

async function approveSample(sample) {
 if (rowBusy.value) return
 rowBusy.value = true
 message.value = ''
 try {
  const updated = await store.approve(sample._id, true)
  store.applyLocal(updated)
  message.value = $t('writingSamples.approvedNotice')
 } catch (error) { message.value = error.response?.data?.message || $t('writingSamples.saveFailed') }
 finally { rowBusy.value = false }
}

async function revokeSample(sample) {
 if (rowBusy.value) return
 rowBusy.value = true
 message.value = ''
 try {
  const updated = await store.revoke(sample._id)
  store.applyLocal(updated)
  message.value = $t('writingSamples.revokedNotice')
 } catch (error) { message.value = error.response?.data?.message || $t('writingSamples.saveFailed') }
 finally { rowBusy.value = false }
}

async function removeSample(sample) {
 if (rowBusy.value) return
 if (!confirm($t('writingSamples.deleteConfirm'))) return
 rowBusy.value = true
 message.value = ''
 try {
  await store.remove(sample._id)
  message.value = $t('writingSamples.deletedNotice')
  await refresh()
 } catch (error) { message.value = error.response?.data?.message || $t('writingSamples.saveFailed') }
 finally { rowBusy.value = false }
}

onMounted(refresh)
onActivated(refresh)
</script>

<style scoped>
.samples-page { overflow:auto; padding:24px; }
.samples-page > p { margin:8px 0; color:var(--text-secondary); }
.samples-toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between; margin:16px 0; }
.samples-tabs { display:flex; flex-wrap:wrap; gap:8px; }
.samples-empty { color:var(--text-secondary); padding:32px 0; text-align:center; }
.sample-card { margin-bottom:14px; }
.sample-head { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.sample-title { font-size:15px; }
.sample-source { color:var(--text-secondary); font-size:12px; margin:8px 0 4px; }
.sample-content { white-space:pre-wrap; word-break:break-word; max-height:96px; overflow:hidden; line-height:1.8; margin:8px 0; font-size:14px; font-family:inherit; }
.sample-content.expanded { max-height:none; }
.sample-notes { color:var(--text-secondary); font-size:13px; margin:6px 0; }
.sample-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:8px; }
.sample-allow { margin-left:auto; font-size:12px; color:var(--text-tertiary); }
.samples-pager { display:flex; gap:12px; align-items:center; justify-content:center; margin:18px 0; }
</style>
