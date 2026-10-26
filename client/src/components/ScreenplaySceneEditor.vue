<template>
 <Teleport to="body">
  <div v-if="visible" class="scene-editor-overlay" @click.self="editor.close()">
   <section class="scene-editor" role="dialog" aria-modal="true" aria-labelledby="scene-editor-title">
    <h3 id="scene-editor-title">{{ $t('screenplayEdit.title', { episode: episodeNumber, scene: scene.sceneNumber }) }}</h3>
    <p>{{ $t('screenplayEdit.hint') }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <div v-if="needsChoice" class="scene-editor-actions">
     <button class="btn btn-outline" @click="editor.restore()">{{ $t('editing.restoreDraft') }}</button>
     <button class="btn btn-outline" @click="editor.discard()">{{ $t('editing.discardDraft') }}</button>
    </div>
    <div class="scene-editor-body">
    <fieldset :disabled="saving || needsChoice">
     <label>{{ $t('screenplayEdit.action') }}<textarea v-model="form.action" class="textarea" rows="6" /></label>
     <h4>{{ $t('screenplayEdit.dialogue') }}</h4>
     <div v-for="(line, index) in form.dialogue" :key="index" class="scene-editor-dialogue">
      <label>{{ $t('screenplayEdit.character') }}<input v-model="line.character" class="input" /></label>
      <label>{{ $t('screenplayEdit.line') }}<textarea v-model="line.line" class="textarea" rows="3" /></label>
      <details>
       <summary>{{ $t('screenplayEdit.details') }}</summary>
       <label v-for="field in ['delivery', 'physicalAction', 'position', 'subtext']" :key="field">{{ $t(`screenplayEdit.${field}`) }}<input v-model="line[field]" class="input" /></label>
      </details>
      <button type="button" class="btn btn-outline" @click="removeLine(index)">{{ $t('screenplayEdit.removeLine') }}</button>
     </div>
     <button type="button" class="btn btn-outline" @click="addLine">{{ $t('screenplayEdit.addLine') }}</button>
     <details class="scene-editor-optional">
      <summary>{{ $t('screenplayEdit.planning') }}</summary>
      <label v-for="field in ['objective', 'obstacle', 'result', 'productionNotes', 'shotPlan', 'soundDesign']" :key="field">{{ $t(`screenplayEdit.${field}`) }}<textarea v-model="form[field]" class="textarea" rows="2" /></label>
     </details>
    </fieldset>
    </div>
    <p v-if="error" class="scene-editor-error" role="alert">{{ error }}</p>
    <p v-if="busy" role="status">{{ $t('screenplayEdit.busy') }}</p>
    <div class="scene-editor-actions">
     <button class="btn btn-outline" :disabled="saving" @click="editor.close()">{{ $t('common.cancel') }}</button>
     <button v-if="!needsChoice" class="btn btn-outline" :disabled="saving" @click="editor.discard()">{{ $t('editing.discardDraft') }}</button>
     <button class="btn btn-primary" :disabled="saving || needsChoice || busy || !hasContent" @click="save">{{ saving ? $t('common.loading') : $t('common.save') }}</button>
    </div>
   </section>
  </div>
 </Teleport>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import api from '../api'
import { useI18n } from '../composables/useI18n'
import { useEditDraft } from '../composables/useEditDraft'
import { createSceneEditValue } from '../utils/sceneEditValue'
const props = defineProps({ projectId: { type: String, required: true }, episodeNumber: { type: Number, required: true }, scene: { type: Object, required: true }, busy: Boolean })
const emit = defineEmits(['saved', 'close'])
const { $t } = useI18n()
const editor = useEditDraft()
const { visible, value: form, saving, message, needsChoice } = editor
const error = ref('')
const expectedScene = createSceneEditValue(props.scene)
editor.open({ resourceId: props.projectId, unit: `episode:${props.episodeNumber}:scene:${props.scene.sceneNumber}`, value: expectedScene, normalize: createSceneEditValue })
watch(visible, open => { if (!open) emit('close') })
const hasContent = computed(() => Boolean(form.value?.action?.trim() || form.value?.dialogue?.some(line => line.line?.trim())))
function addLine() { form.value.dialogue.push({ character: '', line: '', delivery: '', physicalAction: '', position: '', subtext: '' }) }
function removeLine(index) { if (window.confirm($t('screenplayEdit.removeConfirm'))) form.value.dialogue.splice(index, 1) }
async function save() {
 if (saving.value || needsChoice.value || props.busy || !hasContent.value) return
 saving.value = true; error.value = ''
 try {
  const response = await api.put(`/screenplay/projects/${props.projectId}/episodes/${props.episodeNumber}/scenes/${props.scene.sceneNumber}`, { scene: form.value, expectedScene })
  emit('saved', response.data.scene)
  editor.saved()
 } catch (cause) { error.value = cause.response?.data?.message || $t('screenplayEdit.saveFailed') }
 finally { saving.value = false }
}
</script>

<style scoped>
.scene-editor-overlay { position:fixed; inset:0; z-index:3000; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; padding:16px; }
.scene-editor { display:flex; flex-direction:column; width:min(780px,100%); max-height:90vh; overflow:hidden; padding:24px; border-radius:12px; background:var(--card-bg, var(--card)); color:var(--text-primary); box-sizing:border-box; }
.scene-editor-body { overflow:auto; min-height:0; padding-right:6px; }
.scene-editor > h3,.scene-editor > p,.scene-editor-actions { flex-shrink:0; }
.scene-editor-optional { margin-top:18px; }
.scene-editor summary { cursor:pointer; }
.scene-editor fieldset { border:0; padding:0; margin:0; min-width:0; }
.scene-editor label { display:block; margin:14px 0; font-size:14px; }
.scene-editor .input,.scene-editor .textarea { display:block; width:100%; box-sizing:border-box; margin-top:6px; }
.scene-editor-dialogue { border:1px solid var(--border-color); border-radius:8px; padding:12px; margin:12px 0; }
.scene-editor-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:10px; margin-top:18px; }
.scene-editor-error { color:var(--danger-color, #c33); }
</style>
