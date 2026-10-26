<template>
 <div class="card revision-panel">
  <div class="revision-head">
   <h3>{{ $t('styleRevisions.title') }}</h3>
   <button class="btn btn-outline btn-sm" :disabled="store.loading" @click="refresh">{{ $t('reference.refresh') }}</button>
  </div>
  <p class="revision-desc">{{ $t('styleRevisions.description') }}</p>

  <div v-if="!store.items.length" class="revision-empty">{{ $t('styleRevisions.empty') }}</div>
  <div v-for="revision in store.items" :key="revision._id" class="revision-row">
   <div class="revision-info">
    <strong>{{ revision.name }}</strong>
    <span class="badge badge-blue">{{ $t('styleRevisions.versionTag', { n: revision.version }) }}</span>
    <span v-if="revision.personaName" class="badge">{{ revision.personaName }}</span>
    <span class="revision-meta">{{ $t('styleRevisions.sampleCount', { n: revision.sampleCount }) }} · {{ formatTime(revision.createdAt) }}</span>
   </div>
   <div class="revision-actions">
    <label class="revision-check">
     <input v-model="compareSelection" type="checkbox" :value="revision._id" :disabled="compareSelection.length >= 2 && !compareSelection.includes(revision._id)" />
     {{ $t('styleRevisions.pickForCompare') }}
    </label>
   </div>
  </div>
  <div v-if="compareSelection.length === 2" class="revision-compare">
   <button class="btn btn-outline btn-sm" :disabled="compareBusy" @click="runCompare">{{ $t('styleRevisions.compare') }}</button>
  </div>
  <pre v-if="diffText" class="revision-diff">{{ diffText }}</pre>

  <details class="revision-create" :open="!store.items.length">
   <summary>{{ $t('styleRevisions.createTitle') }}</summary>
   <label class="revision-field">
    {{ $t('styleRevisions.nameLabel') }}
    <input v-model="form.name" class="input" :maxlength="80" :placeholder="$t('styleRevisions.namePlaceholder')" />
   </label>
   <p class="revision-hint">{{ $t('styleRevisions.personaHint') }}</p>
   <p class="revision-hint">{{ $t('styleRevisions.pickHint', { max: 9 }) }}</p>
   <div v-if="!approvedSamples.length" class="revision-hint revision-warn">{{ $t('styleRevisions.noSamples') }}</div>
   <div v-for="sample in approvedSamples" :key="sample._id" class="revision-sample">
    <label class="revision-check">
     <input v-model="form.sampleIds" type="checkbox" :value="sample._id" :disabled="form.sampleIds.length >= 9 && !form.sampleIds.includes(sample._id)" />
     <span>{{ sample.title || $t('writingSamples.untitled') }}</span>
     <span class="revision-sample-preview">{{ sample.content.slice(0, 60) }}…</span>
    </label>
   </div>
   <label class="revision-field">
    {{ $t('styleRevisions.noteLabel') }}
    <input v-model="form.note" class="input" :maxlength="200" :placeholder="$t('styleRevisions.notePlaceholder')" />
   </label>
   <button class="btn btn-primary btn-sm" :disabled="createBusy || !form.sampleIds.length" :aria-busy="createBusy" @click="createRevision">
    {{ createBusy ? $t('common.loading') : $t('styleRevisions.create') }}
   </button>
  </details>

  <p v-if="message" role="status" class="revision-message">{{ message }}</p>
 </div>
</template>

<script setup>
import { reactive, ref, onMounted, onActivated } from 'vue'
import { useI18n } from '../composables/useI18n'
import { useStyleRevisionsStore } from '../stores/styleRevisions'
import api from '../api'

// 风格版本面板（A2）：版本不可变，只能创建与对比；作品采用/停用入口在小说详情页。
const { $t } = useI18n()
const store = useStyleRevisionsStore()
const approvedSamples = ref([])
const message = ref('')
const createBusy = ref(false)
const compareBusy = ref(false)
const compareSelection = ref([])
const diffText = ref('')
const form = reactive({ name: '', sampleIds: [], note: '' })

// The candidate picker owns its list. Sharing the page's paginated store here
// used to switch the main list to "approved" on mount and on every refresh.
async function loadCandidates() {
 const rows = []
 for (let page = 1; page <= 4; page++) {
  const { data } = await api.get('/writing-samples', { params: { status: 'approved', scope: 'novel', page, limit: 50 }, timeout: 15000 })
  rows.push(...(data.items || []))
  if (rows.length >= data.total || !data.items?.length) break
 }
 approvedSamples.value = rows.filter(sample => sample.status === 'approved' && sample.allowedForModelInput === true && sample.scope === 'novel')
}

function formatTime(value) {
 const time = new Date(value)
 return Number.isNaN(time.getTime()) ? '' : time.toLocaleString()
}

async function refresh() {
 message.value = ''
 try {
  await Promise.all([store.fetchList(), loadCandidates()])
  const approvedIds = new Set(approvedSamples.value.map(sample => sample._id))
  form.sampleIds = form.sampleIds.filter(id => approvedIds.has(id))
 } catch (error) { message.value = error.response?.data?.message || $t('styleRevisions.loadFailed') }
}

async function createRevision() {
 if (createBusy.value) return
 createBusy.value = true
 message.value = ''
 try {
  const revision = await store.create({ name: form.name, sampleIds: [...form.sampleIds], note: form.note })
  message.value = $t('styleRevisions.created', { name: revision.name, n: revision.version })
  form.name = ''
  form.note = ''
  await refresh()
 } catch (error) { message.value = error.response?.data?.message || $t('styleRevisions.saveFailed') }
 finally { createBusy.value = false }
}

async function runCompare() {
 if (compareBusy.value || compareSelection.value.length !== 2) return
 compareBusy.value = true
 message.value = ''
 try {
  const [a, b] = compareSelection.value
  const diff = await store.compare(a, b)
  const lines = [
   $t('styleRevisions.diffTitle', { a: `${diff.a.name} v${diff.a.version}`, b: `${diff.b.name} v${diff.b.version}` }),
   $t('styleRevisions.diffPersona', {
    a: diff.persona.aPersonaName || '-', b: diff.persona.bPersonaName || '-',
    fields: diff.persona.personaChanged.length ? diff.persona.personaChanged.join(', ') : $t('styleRevisions.diffSame'),
   }),
   $t('styleRevisions.diffAdded', { n: diff.samples.added.length }) + (diff.samples.added.length ? '：' + diff.samples.added.map(row => row.title || row.sampleId).join('、') : ''),
   $t('styleRevisions.diffRemoved', { n: diff.samples.removed.length }) + (diff.samples.removed.length ? '：' + diff.samples.removed.map(row => row.title || row.sampleId).join('、') : ''),
   $t('styleRevisions.diffUnchanged', { n: diff.samples.unchanged }),
  ]
  diffText.value = lines.join('\n')
 } catch (error) { message.value = error.response?.data?.message || $t('styleRevisions.loadFailed') }
 finally { compareBusy.value = false }
}

onMounted(refresh)
onActivated(refresh)
</script>

<style scoped>
.revision-panel { margin-top:18px; }
.revision-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.revision-head h3 { margin:0; }
.revision-desc { color:var(--text-secondary); font-size:13px; margin:8px 0; }
.revision-empty { color:var(--text-secondary); font-size:13px; padding:10px 0; }
.revision-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--card-border); }
.revision-info { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.revision-meta { color:var(--text-tertiary); font-size:12px; }
.revision-check { display:flex; align-items:center; gap:6px; font-size:13px; }
.revision-sample-preview { color:var(--text-tertiary); font-size:12px; }
.revision-compare { margin:10px 0; }
.revision-diff { white-space:pre-wrap; font-size:13px; line-height:1.7; background:var(--card-bg); border:1px solid var(--card-border); border-radius:8px; padding:10px; margin:8px 0; font-family:inherit; }
.revision-create { margin-top:14px; }
.revision-create summary { cursor:pointer; font-size:14px; font-weight:600; }
.revision-field { display:block; margin:12px 0; font-size:14px; }
.revision-field .input { display:block; width:100%; box-sizing:border-box; margin-top:6px; }
.revision-sample { margin:6px 0; }
.revision-hint { color:var(--text-secondary); font-size:12px; margin:6px 0; }
.revision-warn { color:#cf1322; }
.revision-message { color:var(--success, #2f6546); font-size:13px; margin-top:8px; }
</style>
