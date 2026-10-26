<template>
 <Teleport to="body">
  <div v-if="open" class="wf-overlay" @click.self="close">
   <section class="wf-modal" role="dialog" aria-modal="true" aria-labelledby="wf-dialog-title">
    <h3 id="wf-dialog-title">{{ $t('writingStyle.recordTitle') }}</h3>
    <p class="wf-hint">{{ $t('writingStyle.recordHint') }}</p>
    <div class="wf-diff">
     <p class="wf-diff-label">{{ $t('writingStyle.originalLabel') }}</p>
     <p class="wf-diff-text">{{ shortOriginal }}</p>
     <p class="wf-diff-label">{{ $t('writingStyle.revisedLabel') }}</p>
     <p class="wf-diff-text wf-diff-new">{{ shortRevised }}</p>
    </div>
    <div class="wf-row">
     <label>
      {{ $t('writingStyle.reasonLabel') }}
      <select v-model="form.reason" class="input" :disabled="busy">
       <option v-for="reason in REASONS" :key="reason.value" :value="reason.value">{{ $t(`writingStyle.${reason.key}`) }}</option>
      </select>
     </label>
     <label>
      {{ $t('writingStyle.sceneTypeLabel') }}
      <select v-model="form.sceneType" class="input" :disabled="busy">
       <option v-for="type in SCENE_TYPES" :key="type.value" :value="type.value">{{ $t(`writingStyle.${type.key}`) }}</option>
      </select>
     </label>
    </div>
    <p v-if="form.reason === 'correction_only' || form.reason === 'one_off'" class="wf-warn">{{ $t('writingStyle.oneOffWarn') }}</p>
    <label class="wf-field">
     {{ $t('writingStyle.noteLabel') }}
     <input v-model="form.note" class="input" :maxlength="200" :disabled="busy" :placeholder="$t('writingStyle.notePlaceholder')" />
    </label>
    <p v-if="error" class="wf-error" role="alert">{{ error }}</p>
    <div class="wf-actions">
     <button class="btn btn-outline" :disabled="busy" @click="close">{{ $t('writingStyle.skip') }}</button>
     <button class="btn btn-primary" :disabled="busy" :aria-busy="busy" @click="save">{{ busy ? $t('common.loading') : $t('writingStyle.record') }}</button>
    </div>
   </section>
  </div>
 </Teleport>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from '../composables/useI18n'
import { useWritingStyleStore } from '../stores/writingStyle'

// 章节保存后的可选"记为写作偏好"弹窗（A3）。不记录就什么都不保存；
// 理由与用途标签帮助后续提炼与按场景选择。
const props = defineProps({
  open: Boolean,
  novelId: { type: String, default: '' },
  chapterNumber: { type: Number, default: 0 },
  originalText: { type: String, default: '' },
  revisedText: { type: String, default: '' },
})
const emit = defineEmits(['close', 'saved'])
const { $t } = useI18n()
const store = useWritingStyleStore()
const busy = ref(false)
const error = ref('')
const form = reactive({ reason: 'pacing', sceneType: 'other', note: '' })

const REASONS = [
  { value: 'repetition', key: 'reason_repetition' },
  { value: 'character_voice', key: 'reason_character_voice' },
  { value: 'perspective', key: 'reason_perspective' },
  { value: 'pacing', key: 'reason_pacing' },
  { value: 'emotion', key: 'reason_emotion' },
  { value: 'density', key: 'reason_density' },
  { value: 'correction_only', key: 'reason_correction_only' },
  { value: 'one_off', key: 'reason_one_off' },
]
const SCENE_TYPES = [
  { value: 'dialogue', key: 'scene_dialogue' },
  { value: 'action', key: 'scene_action' },
  { value: 'observation', key: 'scene_observation' },
  { value: 'emotion', key: 'scene_emotion' },
  { value: 'transition', key: 'scene_transition' },
  { value: 'other', key: 'scene_other' },
]

watch(() => props.open, open => {
  if (!open) return
  form.reason = 'pacing'
  form.sceneType = 'other'
  form.note = ''
  error.value = ''
  busy.value = false
})

const shortOriginal = computed(() => {
  const text = props.originalText || ''
  return text.length > 400 ? text.slice(0, 400) + '…' : text
})
const shortRevised = computed(() => {
  const text = props.revisedText || ''
  return text.length > 400 ? text.slice(0, 400) + '…' : text
})

function close() { emit('close') }

async function save() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await store.recordFeedback({
      novelId: props.novelId,
      sourceChapterNumber: props.chapterNumber,
      originalText: props.originalText,
      revisedText: props.revisedText,
      reason: form.reason,
      sceneType: form.sceneType,
      note: form.note,
    })
    emit('saved', result)
    emit('close')
  } catch (cause) {
    error.value = cause.response?.data?.message || $t('writingStyle.saveFailed')
  } finally { busy.value = false }
}
</script>

<style scoped>
.wf-overlay { position:fixed; inset:0; z-index:3000; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; padding:16px; }
.wf-modal { width:min(620px,100%); max-height:90vh; overflow:auto; padding:24px; border-radius:12px; background:var(--card-bg, var(--card)); color:var(--text-primary); box-sizing:border-box; }
.wf-modal h3 { margin-top:0; }
.wf-hint { color:var(--text-secondary); font-size:13px; margin:6px 0; }
.wf-diff { border:1px solid var(--card-border); border-radius:8px; padding:10px 12px; margin:10px 0; max-height:220px; overflow:auto; }
.wf-diff-label { font-size:12px; color:var(--text-tertiary); margin:6px 0 2px; }
.wf-diff-text { white-space:pre-wrap; word-break:break-word; font-size:13px; line-height:1.7; margin:0; }
.wf-diff-new { color:var(--primary); }
.wf-row { display:flex; flex-wrap:wrap; gap:12px; margin:12px 0; }
.wf-row > label { flex:1; min-width:160px; font-size:14px; }
.wf-row .input { display:block; width:100%; box-sizing:border-box; margin-top:6px; }
.wf-field { display:block; margin:12px 0; font-size:14px; }
.wf-field .input { display:block; width:100%; box-sizing:border-box; margin-top:6px; }
.wf-warn { color:#cf1322; font-size:12px; margin:4px 0; }
.wf-error { color:var(--danger-color, #c33); font-size:13px; }
.wf-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:10px; margin-top:14px; }
</style>
