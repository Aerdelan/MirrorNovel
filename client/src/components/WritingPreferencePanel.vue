<template>
 <div class="card pref-panel">
  <div class="pref-head">
   <h3>{{ $t('writingStyle.panelTitle') }}</h3>
   <button class="btn btn-outline btn-sm" :disabled="store.loading" @click="refresh">{{ $t('reference.refresh') }}</button>
  </div>
  <p class="pref-desc">{{ $t('writingStyle.panelDesc') }}</p>

  <h4>{{ $t('writingStyle.feedbackSection') }}</h4>
  <div v-if="!store.feedbacks.length" class="pref-empty">{{ $t('writingStyle.feedbackEmpty') }}</div>
  <div v-for="feedback in store.feedbacks" :key="feedback._id" class="pref-row">
   <div class="pref-row-main">
    <span class="badge badge-blue">{{ $t(`writingStyle.reason_${feedback.reason}`) }}</span>
    <span class="badge">{{ $t(`writingStyle.scene_${feedback.sceneType}`) }}</span>
    <span class="pref-meta">{{ $t('writingStyle.feedbackSource', { title: feedback.novelTitle || '', n: feedback.sourceChapterNumber }) }} · {{ formatTime(feedback.updatedAt) }}</span>
   </div>
   <p class="pref-diff"><span class="pref-old">{{ excerpt(feedback.originalText) }}</span> → <span class="pref-new">{{ excerpt(feedback.revisedText) }}</span></p>
   <p v-if="feedback.note" class="pref-note">{{ $t('writingStyle.noteLabel') }}{{ feedback.note }}</p>
   <div class="pref-actions">
    <template v-if="feedback.distilledPreferenceId">
     <span class="pref-distilled">{{ $t('writingStyle.distilled') }}</span>
    </template>
    <button v-else class="btn btn-outline btn-sm" :disabled="distillBusy === feedback._id" :aria-busy="distillBusy === feedback._id" @click="distill(feedback)">
     {{ distillBusy === feedback._id ? $t('common.loading') : $t('writingStyle.distill') }}
    </button>
    <button class="btn btn-danger btn-sm" :disabled="distillBusy === feedback._id" @click="removeFeedback(feedback)">{{ $t('common.delete') }}</button>
   </div>
  </div>

  <h4>{{ $t('writingStyle.preferenceSection') }}</h4>
  <div v-if="!store.preferences.length" class="pref-empty">{{ $t('writingStyle.preferenceEmpty') }}</div>
  <div v-for="preference in store.preferences" :key="preference._id" class="pref-row">
   <div class="pref-row-main">
    <span class="badge" :class="{ 'badge-green': preference.status === 'active', 'badge-blue': preference.status === 'candidate' }">{{ $t(`writingStyle.status_${preference.status}`) }}</span>
    <span class="badge">{{ $t(preference.novelId ? 'writingStyle.scopeBook' : 'writingStyle.scopeAccount') }}</span>
    <span class="badge">{{ $t(`writingStyle.reason_${preference.reason}`) }}</span>
   </div>
   <p class="pref-statement">{{ preference.statement }}</p>
   <p v-if="preference.rationale" class="pref-note">{{ preference.rationale }}</p>
   <div v-if="preference.evidence && preference.evidence.length" class="pref-evidence">
    <p class="pref-evidence-label">{{ $t('writingStyle.evidenceLabel') }}</p>
    <p v-for="(item, index) in preference.evidence" :key="index" class="pref-note">· {{ item.excerpt }}</p>
   </div>
   <p v-if="preference.status === 'candidate'" class="pref-hint">{{ $t('writingStyle.candidateHint') }}</p>
   <div class="pref-actions">
    <button v-if="preference.status === 'candidate'" class="btn btn-primary btn-sm" :disabled="rowBusy" @click="confirmPreference(preference)">{{ $t('writingStyle.confirm') }}</button>
    <button v-if="preference.status === 'candidate'" class="btn btn-outline btn-sm" :disabled="rowBusy" @click="dismissPreference(preference)">{{ $t('writingStyle.dismiss') }}</button>
    <button v-if="preference.status === 'active'" class="btn btn-outline btn-sm" :disabled="rowBusy" @click="pausePreference(preference)">{{ $t('writingStyle.pause') }}</button>
    <button v-if="preference.status === 'paused'" class="btn btn-outline btn-sm" :disabled="rowBusy" @click="activatePreference(preference)">{{ $t('writingStyle.activate') }}</button>
    <button class="btn btn-danger btn-sm" :disabled="rowBusy" @click="removePreference(preference)">{{ $t('common.delete') }}</button>
   </div>
  </div>
  <p v-if="store.preferences.length" class="pref-hint">{{ $t('writingStyle.applyHint') }}</p>

  <details class="pref-create">
   <summary>{{ $t('writingStyle.manualCreate') }}</summary>
   <label class="pref-field">
    {{ $t('writingStyle.statementLabel') }}
    <textarea v-model="form.statement" class="textarea" rows="2" :maxlength="300" :disabled="createBusy" :placeholder="$t('writingStyle.statementPlaceholder')"></textarea>
   </label>
   <p class="pref-hint">{{ $t('writingStyle.manualScopeHint') }}</p>
   <button class="btn btn-primary btn-sm" :disabled="createBusy || form.statement.trim().length < 10" :aria-busy="createBusy" @click="createPreference">
    {{ createBusy ? $t('common.loading') : $t('writingStyle.manualCreate') }}
   </button>
  </details>

  <p v-if="message" role="status" class="pref-message">{{ message }}</p>
 </div>
</template>

<script setup>
import { reactive, ref, onMounted, onActivated } from 'vue'
import { useI18n } from '../composables/useI18n'
import { useWritingStyleStore } from '../stores/writingStyle'

// 写作偏好面板（A3）：修改记录 → 显式提炼候选 → 作者确认生效 → 采用新版本后进入生成。
const { $t } = useI18n()
const store = useWritingStyleStore()
const message = ref('')
const rowBusy = ref(false)
const distillBusy = ref('')
const createBusy = ref(false)
const form = reactive({ statement: '' })

function formatTime(value) {
 const time = new Date(value)
 return Number.isNaN(time.getTime()) ? '' : time.toLocaleString()
}

function excerpt(text) {
 const value = String(text || '').replace(/\s+/g, ' ').trim()
 return value.length > 80 ? value.slice(0, 80) + '…' : value
}

async function refresh() {
 message.value = ''
 try { await Promise.all([store.fetchFeedbacks(), store.fetchPreferences()]) }
 catch (error) { message.value = error.response?.data?.message || $t('writingStyle.loadFailed') }
}

async function distill(feedback) {
 if (distillBusy.value) return
 if (!confirm($t('writingStyle.distillConfirm'))) return
 distillBusy.value = feedback._id
 message.value = ''
 try {
  const result = await store.distillFeedback(feedback._id)
  message.value = $t(result.duplicate ? 'writingStyle.distillDuplicate' : 'writingStyle.distilledCandidate')
  await refresh()
 } catch (error) { message.value = error.response?.data?.message || $t('writingStyle.distillFailed') }
 finally { distillBusy.value = '' }
}

async function removeFeedback(feedback) {
 if (!confirm($t('writingStyle.feedbackDeleteConfirm'))) return
 rowBusy.value = true
 try { await store.removeFeedback(feedback._id); await refresh() }
 catch (error) { message.value = error.response?.data?.message || $t('writingStyle.saveFailed') }
 finally { rowBusy.value = false }
}

async function confirmPreference(preference) {
 if (rowBusy.value) return
 rowBusy.value = true
 try {
  const updated = await store.confirmPreference(preference._id)
  store.applyPreferenceLocal(updated)
  message.value = $t('writingStyle.confirmed')
 } catch (error) { message.value = error.response?.data?.message || $t('writingStyle.saveFailed') }
 finally { rowBusy.value = false }
}

async function dismissPreference(preference) {
 if (rowBusy.value) return
 rowBusy.value = true
 try { await store.dismissPreference(preference._id); await refresh() }
 catch (error) { message.value = error.response?.data?.message || $t('writingStyle.saveFailed') }
 finally { rowBusy.value = false }
}

async function pausePreference(preference) {
 if (rowBusy.value) return
 rowBusy.value = true
 try {
  const updated = await store.pausePreference(preference._id)
  store.applyPreferenceLocal(updated)
  message.value = $t('writingStyle.pausedNotice')
 } catch (error) { message.value = error.response?.data?.message || $t('writingStyle.saveFailed') }
 finally { rowBusy.value = false }
}

async function activatePreference(preference) {
 if (rowBusy.value) return
 rowBusy.value = true
 try {
  const updated = await store.activatePreference(preference._id)
  store.applyPreferenceLocal(updated)
  message.value = $t('writingStyle.activatedNotice')
 } catch (error) { message.value = error.response?.data?.message || $t('writingStyle.saveFailed') }
 finally { rowBusy.value = false }
}

async function removePreference(preference) {
 if (rowBusy.value) return
 if (!confirm($t('writingStyle.preferenceDeleteConfirm'))) return
 rowBusy.value = true
 try { await store.removePreference(preference._id); await refresh() }
 catch (error) { message.value = error.response?.data?.message || $t('writingStyle.saveFailed') }
 finally { rowBusy.value = false }
}

async function createPreference() {
 if (createBusy.value) return
 createBusy.value = true
 message.value = ''
 try {
  const result = await store.createPreference({ statement: form.statement.trim() })
  message.value = $t(result.duplicate ? 'writingStyle.manualDuplicate' : 'writingStyle.manualCreated')
  form.statement = ''
  await refresh()
 } catch (error) { message.value = error.response?.data?.message || $t('writingStyle.saveFailed') }
 finally { createBusy.value = false }
}

onMounted(refresh)
onActivated(refresh)
</script>

<style scoped>
.pref-panel { margin-top:18px; }
.pref-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.pref-head h3 { margin:0; }
.pref-desc { color:var(--text-secondary); font-size:13px; margin:8px 0; }
.pref-panel h4 { margin:16px 0 6px; font-size:14px; }
.pref-empty { color:var(--text-secondary); font-size:13px; padding:8px 0; }
.pref-row { padding:12px 0; border-bottom:1px solid var(--card-border); }
.pref-row-main { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.pref-meta { color:var(--text-tertiary); font-size:12px; }
.pref-diff { font-size:13px; line-height:1.7; margin:8px 0; word-break:break-word; }
.pref-old { color:var(--text-tertiary); }
.pref-new { color:var(--primary); }
.pref-statement { font-size:14px; line-height:1.7; margin:8px 0; }
.pref-note { color:var(--text-secondary); font-size:12px; margin:4px 0; word-break:break-word; }
.pref-evidence { border-left:2px solid var(--card-border); padding-left:10px; margin:6px 0; }
.pref-evidence-label { font-size:12px; color:var(--text-tertiary); margin:2px 0; }
.pref-hint { color:var(--text-secondary); font-size:12px; margin:6px 0; }
.pref-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:6px; }
.pref-distilled { color:var(--success, #2f6546); font-size:12px; }
.pref-create { margin-top:14px; }
.pref-create summary { cursor:pointer; font-size:14px; font-weight:600; }
.pref-field { display:block; margin:12px 0; font-size:14px; }
.pref-field .textarea { display:block; width:100%; box-sizing:border-box; margin-top:6px; }
.pref-message { color:var(--success, #2f6546); font-size:13px; margin-top:8px; }
</style>
