<template>
 <div class="card reference-selector">
  <h3>{{ $t('reference.useTitle') }}</h3><p>{{ $t('reference.useHint') }}</p>
  <button class="btn btn-outline btn-sm" @click="$router.push('/reference-upload')">{{ $t('reference.manage') }}</button>
  <button class="btn btn-outline btn-sm" @click="loadReferences">{{ $t('reference.refresh') }}</button>
  <p v-if="message" role="status">{{ message }}</p>
  <label v-for="reference in references" :key="reference._id" class="reference-option">
   <input type="checkbox" :checked="referenceIds.includes(reference._id)" :disabled="disabled || (!referenceIds.includes(reference._id) && referenceIds.length >= 3)" @change="toggle(reference._id)" /> {{ reference.title }}
   <button class="btn btn-outline btn-sm" :disabled="disabled || busy" @click.prevent="makePersona(reference._id)">{{ $t('reference.persona') }}</button>
   <button class="btn btn-outline btn-sm" :disabled="disabled || busy" @click.prevent="analyze({ referenceId: reference._id })">{{ $t('reference.analyze') }}</button>
  </label>
  <label v-if="showExamplesOption && referenceIds.length" class="reference-option">
   <input type="checkbox" :checked="useExamples" :disabled="disabled || busy" @change="$emit('update:useExamples', $event.target.checked)" /> {{ $t('reference.useExamples') }}
  </label>
  <p v-if="showExamplesOption && referenceIds.length">{{ $t('reference.examplesHint') }}</p>
  <p>{{ $t('reference.structureHint') }}</p>
  <input type="file" accept=".txt,.md,.epub,.zip" :disabled="disabled || busy" @change="analyzeFile" />
  <textarea v-if="analysis" v-model="analysis" class="textarea" rows="5"></textarea>
  <button v-if="analysis" class="btn btn-primary btn-sm" :disabled="disabled" @click="$emit('update:structurePattern', analysis)">{{ $t('reference.applyStructure') }}</button>
  <p v-if="structurePattern">{{ $t('reference.structureApplied') }} <button class="btn btn-outline btn-sm" :disabled="disabled" @click="$emit('update:structurePattern', '')">{{ $t('common.cancel') }}</button></p>
 </div>
</template>
<script setup>
import { ref, onMounted, onActivated } from 'vue'
import api from '../api'
import { readReferenceNovelFile } from '../utils/personaReference'
import { usePersonaStore } from '../stores/persona'
import { useI18n } from '../composables/useI18n'
const props = defineProps({ referenceIds: { type: Array, default: () => [] }, structurePattern: { type: String, default: '' }, useExamples: Boolean, showExamplesOption: Boolean, disabled: Boolean })
const emit = defineEmits(['update:referenceIds', 'update:structurePattern', 'update:useExamples', 'persona-created'])
const { $t } = useI18n()
const personaStore = usePersonaStore()
const references = ref([]), busy = ref(false), message = ref(''), analysis = ref('')
async function loadReferences() { try { references.value = (await api.get('/reference/list-by-type', { timeout: 15000 })).data || []; message.value = '' } catch (error) { message.value = error.response?.status === 404 ? $t('reference.needsBackend') : $t('reference.failed') } }
function toggle(id) { if (props.disabled) return; emit('update:referenceIds', props.referenceIds.includes(id) ? props.referenceIds.filter(value => value !== id) : [...props.referenceIds, id].slice(0, 3)) }
async function makePersona(id) { if (busy.value || props.disabled) return; busy.value = true; try { emit('persona-created', await personaStore.fromReference(id)); message.value = $t('reference.personaReady') } catch (error) { message.value = error.response?.data?.message || $t('reference.failed') } finally { busy.value = false } }
async function analyze(input) { if (busy.value || props.disabled) return; busy.value = true; message.value = $t('reference.analyzing'); try { analysis.value = (await api.post('/reference/analyze-structure', input, { timeout: 600000 })).data.analysis; message.value = '' } catch (error) { message.value = error.response?.data?.message || $t('reference.failed') } finally { busy.value = false } }
async function analyzeFile(event) { const file = event.target.files?.[0]; event.target.value = ''; if (!file || busy.value) return; try { const book = await readReferenceNovelFile(file, { maxChars: 5000000 }); await analyze({ content: book.text }) } catch { message.value = $t('reference.importFailed') } }
onMounted(loadReferences)
onActivated(loadReferences)
</script>
<style scoped>
.reference-option { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:10px 0; }
.reference-selector p { margin:8px 0; color:var(--text-secondary); }
.reference-selector > button { margin-right:8px; }
</style>
