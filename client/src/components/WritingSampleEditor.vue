<template>
 <Teleport to="body">
  <div v-if="open" class="ws-overlay" @click.self="close">
   <section class="ws-modal" role="dialog" aria-modal="true" aria-labelledby="ws-editor-title">
    <h3 id="ws-editor-title">{{ draft.isEdit ? $t('writingSamples.editTitle') : $t('writingSamples.createTitle') }}</h3>
    <p v-if="sourceLine" class="ws-source">{{ sourceLine }}</p>
    <p v-if="draft.fromReference && !draft.isEdit" class="ws-hint">{{ $t('writingSamples.referenceDraftHint') }}</p>
    <label class="ws-field">
     {{ $t('writingSamples.contentLabel') }}
     <textarea v-model="draft.content" class="textarea" rows="8" :disabled="busy" :placeholder="$t('writingSamples.contentPlaceholder')"></textarea>
     <span class="ws-count" :class="countClass">{{ $t('writingSamples.charCount', { n: validation.length, min: SAMPLE_MIN_CHARS, max: SAMPLE_MAX_CHARS }) }}</span>
    </label>
    <label class="ws-field">
     {{ $t('writingSamples.titleLabel') }}
     <input v-model="draft.title" class="input" :maxlength="SAMPLE_MAX_TITLE_CHARS" :disabled="busy" :placeholder="$t('writingSamples.titlePlaceholder')" />
    </label>
    <div class="ws-row">
     <label>
      {{ $t('writingSamples.scopeLabel') }}
      <select v-model="draft.scope" class="input" :disabled="busy">
       <option value="novel">{{ $t('writingSamples.scope_novel') }}</option>
       <option value="screenplay">{{ $t('writingSamples.scope_screenplay') }}</option>
      </select>
     </label>
     <label>
      {{ $t('writingSamples.sceneTypeLabel') }}
      <select v-model="draft.sceneType" class="input" :disabled="busy">
       <option v-for="type in SAMPLE_SCENE_TYPES" :key="type" :value="type">{{ $t(`writingSamples.scene_${type}`) }}</option>
      </select>
     </label>
    </div>
    <label class="ws-field">
     {{ $t('writingSamples.notesLabel') }}
     <textarea v-model="draft.notes" class="textarea" rows="2" :maxlength="SAMPLE_MAX_NOTE_CHARS" :disabled="busy"></textarea>
    </label>
    <label v-if="!draft.isEdit && !draft.fromReference" class="ws-check">
     <input v-model="draft.approveNow" type="checkbox" :disabled="busy" />
     {{ $t('writingSamples.approveNow') }}
    </label>
    <p v-if="draft.isEdit && draft.status === 'approved'" class="ws-hint">{{ $t('writingSamples.editApprovedHint') }}</p>
    <p v-if="error" class="ws-error" role="alert">{{ error }}</p>
    <div class="ws-actions">
     <button class="btn btn-outline" :disabled="busy" @click="close">{{ $t('common.cancel') }}</button>
     <button class="btn btn-primary" :disabled="busy || !validation.ok" :aria-busy="busy" @click="save">{{ busy ? $t('common.loading') : $t('common.save') }}</button>
    </div>
   </section>
  </div>
 </Teleport>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from '../composables/useI18n'
import { useWritingSamplesStore } from '../stores/writingSamples'
import { buildSampleDraft, validateSampleContent, SAMPLE_MIN_CHARS, SAMPLE_MAX_CHARS, SAMPLE_MAX_TITLE_CHARS, SAMPLE_MAX_NOTE_CHARS, SAMPLE_SCENE_TYPES } from '../utils/writingSampleInput'

// 新建/编辑共用的样稿弹窗。preset 用于章节选区或参考片段的预填；
// 参考片段在服务端强制草稿，这里也不展示“立即认可”勾选。
const props = defineProps({ open: Boolean, sample: { type: Object, default: null }, preset: { type: Object, default: null } })
const emit = defineEmits(['close', 'saved'])
const { $t } = useI18n()
const store = useWritingSamplesStore()
const draft = reactive(buildSampleDraft())
const busy = ref(false)
const error = ref('')

watch(() => props.open, open => {
 if (!open) return
 Object.assign(draft, buildSampleDraft({ sample: props.sample, preset: props.preset }), { approveNow: false })
 error.value = ''
 busy.value = false
})

const validation = computed(() => validateSampleContent(draft.content))
const countClass = computed(() => validation.value.ok ? 'ok' : 'bad')
const sourceLine = computed(() => {
 if (draft.sourceReferenceId) return $t('writingSamples.sourceReference', { title: draft.sourceReferenceTitle })
 if (draft.sourceNovelId) return draft.sourceChapterNumber
  ? $t('writingSamples.sourceChapter', { title: draft.sourceNovelTitle, n: draft.sourceChapterNumber })
  : $t('writingSamples.sourceNovel', { title: draft.sourceNovelTitle })
 if (draft.isEdit) return $t('writingSamples.sourceManual')
 return ''
})

function close() { emit('close') }

async function save() {
 if (busy.value || !validation.value.ok) return
 busy.value = true
 error.value = ''
 try {
  const payload = {
   title: draft.title,
   content: draft.content,
   notes: draft.notes,
   scope: draft.scope,
   sceneType: draft.sceneType,
   sourceKind: draft.sourceKind,
  }
  if (draft.sourceNovelId) { payload.sourceNovelId = draft.sourceNovelId; payload.sourceChapterNumber = draft.sourceChapterNumber }
  if (draft.sourceReferenceId) { payload.sourceReferenceId = draft.sourceReferenceId }
  if (draft.isEdit) {
   const sample = await store.update(draft.id, payload)
   emit('saved', sample, { duplicate: false })
  } else {
   const result = await store.create({ ...payload, allowedForModelInput: draft.approveNow === true })
   emit('saved', result.sample, { duplicate: !!result.duplicate })
  }
  emit('close')
 } catch (cause) {
  error.value = cause.response?.data?.message || $t('writingSamples.saveFailed')
 } finally { busy.value = false }
}
</script>

<style scoped>
.ws-overlay { position:fixed; inset:0; z-index:3000; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; padding:16px; }
.ws-modal { display:flex; flex-direction:column; width:min(640px,100%); max-height:90vh; overflow:auto; padding:24px; border-radius:12px; background:var(--card-bg, var(--card)); color:var(--text-primary); box-sizing:border-box; }
.ws-modal h3 { margin-top:0; }
.ws-source { color:var(--text-secondary); font-size:13px; margin:4px 0; }
.ws-hint { color:var(--text-secondary); font-size:13px; background:var(--primary-subtle, rgba(47,101,70,.08)); border-radius:8px; padding:8px 10px; margin:8px 0; }
.ws-field { display:block; margin:12px 0; font-size:14px; }
.ws-field .input, .ws-field .textarea { display:block; width:100%; box-sizing:border-box; margin-top:6px; }
.ws-row { display:flex; flex-wrap:wrap; gap:12px; margin:12px 0; }
.ws-row > label { flex:1; min-width:160px; font-size:14px; }
.ws-row .input { display:block; width:100%; box-sizing:border-box; margin-top:6px; }
.ws-count { display:block; margin-top:4px; font-size:12px; color:var(--text-tertiary); }
.ws-count.ok { color:var(--success, #2f6546); }
.ws-count.bad { color:var(--danger-color, #c33); }
.ws-check { display:flex; align-items:center; gap:8px; margin:12px 0; font-size:14px; }
.ws-error { color:var(--danger-color, #c33); font-size:13px; }
.ws-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:10px; margin-top:16px; }
</style>
