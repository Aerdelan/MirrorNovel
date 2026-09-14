<template>
 <div class="page-container continue-page">
 <div class="card">
 <div class="section-title">{{ $t('continue.title') }}</div>
 <div class="upload-bar">
 <label class="upload-btn">
 <input type="file" accept=".txt" @change="handleFileUpload" />
 <span>{{ $t('continue.uploadFile') }}</span>
 </label>
 <span v-if="fileName" class="file-name">{{ fileName }}</span>
 </div>
 <div class="import-area">
 <textarea v-model="importedText" class="textarea" :placeholder="$t('continue.pasteText')" rows="8"></textarea>
 <div class="import-hint">
 <span>{{ $t('continue.charsInput', { count: importedText.length }) }}</span>
 <span v-if="importedText.length < 50" style="color:var(--error-color);">{{ $t('continue.minChars') }}</span>
 </div>
 </div>
 </div>

 <div class="card">
 <div class="section-title">{{ $t('continue.novelInfo') }}</div>
 <div class="form-group">
 <label>{{ $t('continue.novelName') }}</label>
 <input v-model="title" class="input" :placeholder="$t('continue.placeholderTitle')" maxlength="50" />
 </div>
 <div class="form-group">
 <label>{{ $t('continue.styleType') }}</label>
 <select v-model="novelTypeName" class="input select-input">
 <option value="">{{ $t('continue.selectStyle') }}</option>
 <!-- 题材名是数据里的中文，必须走 $tn 才会随语言切换（GeneratePage 已是这个写法） -->
 <option v-for="t in novelStore.novelTypes" :key="t.id" :value="t.name">{{ t.icon }} {{ $tn(t.name) }}</option>
 <option value="自定义">{{ $t('continue.otherStyle') }}</option>
 </select>
 </div>
 </div>

 <div class="card">
 <div class="section-title">{{ $t('continue.writeRequest') }}</div>
 <textarea v-model="continuationRequest" class="textarea" rows="5"></textarea>
 <div class="import-hint"><span>{{ $t('continue.requestHint') }}</span></div>
 </div>

 <div class="card">
 <div class="section-title">{{ $t('generate.stepMode') }}</div>
 <div class="mode-radio-group">
 <label class="mode-radio" :class="{ active: genMode === 'book' }">
 <input type="radio" v-model="genMode" value="book" />
 <span>{{ $t('continue.modeBook') }}</span>
 </label>
 <label class="mode-radio" :class="{ active: genMode === 'chapter' }">
 <input type="radio" v-model="genMode" value="chapter" />
 <span>{{ $t('continue.modeChapter') }}</span>
 </label>
 </div>
 <div class="mode-tip">{{ $t(genMode === 'book' ? 'continue.modeBookHint' : 'continue.modeChapterHint') }}</div>
 <div class="word-count-input" style="margin-top:12px;">
 <input v-model.number="targetWordCount" class="input" :disabled="isGenerating" type="number" :min="genMode === 'chapter' ? 500 : 1000" :max="genMode === 'chapter' ? 8000 : 1000000" step="500" />
 <span class="unit">{{ $t('generate.wordShort') }}</span>
 </div>
 <div class="word-count-presets">
 <span v-for="p in activePresets" :key="p.value" class="preset-btn" :class="{ active: targetWordCount === p.value, locked: isGenerating }" @click="!isGenerating && (targetWordCount = p.value)">{{ p.label }}</span>
 </div>
 </div>

 <div class="card action-card">
 <button v-if="!isGenerating" class="btn btn-primary btn-block btn-generate" :disabled="importedText.length < 50 || stopping" @click="startContinue">
 {{ $t('continue.btnWrite') }}
 </button>
 <div v-else class="generating-status">
 <div class="generating-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="indicator-text">{{ $t('continue.btnWriting') }}</span></div>
 <div class="word-count-progress">{{ $t('bookshelf.generated', { words: wordCount }) }}</div>
 <button class="btn btn-outline btn-sm" :disabled="stopping" :aria-busy="stopping" @click="stopContinue">{{ stopping ? $t('common.loading') : `⏸ ${$t('bookshelf.pause')}` }}</button>
 </div>
 </div>

 <div v-if="novelStore.streamingText" class="card streaming-card">
 <div class="streaming-header">
 <span class="section-title">{{ $t('continue.resultTitle') }}</span>
 <span v-if="isGenerating" class="generating-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>
 </div>
 <div class="streaming-content" ref="streamingRef">
 <div class="content-text">{{ novelStore.streamingText }}</div>
 <div v-if="isGenerating" class="cursor-blink">|</div>
 </div>
 </div>

 <div v-if="continueStatus" class="card" style="text-align:center;padding:16px;">
 <span style="color:var(--error-color);font-size:14px;">{{ continueStatus }}</span>
 </div>

 <div v-if="generationDone" class="card done-card">
 <div class="done-icon"></div>
 <div class="done-text">{{ $t('continue.completedMessage', { count: wordCount }) }}</div>
 <button class="btn btn-primary btn-block" @click="goToBookshelf">{{ $t('continue.backBookshelf') }}</button>
 </div>
 <div style="height:20px;"></div>
 </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useNovelStore } from '../stores/novel'
import { useAuthStore } from '../stores/auth'
import { useI18n } from '../composables/useI18n'
import { notifyModelError } from '../utils/notify'

const router = useRouter()
const novelStore = useNovelStore()
const authStore = useAuthStore()
const { $t } = useI18n()

const importedText = ref('')
const title = ref('')
const novelTypeName = ref('')
const continuationRequest = ref('')
const fileName = ref('')
const continueNovelId = ref('')
const genMode = ref('book')
const targetWordCount = ref(30000)
const isGenerating = ref(false)
const stopping = ref(false)
const generationDone = ref(false)
const wordCount = ref(0)
const continueStatus = ref('')
const streamingRef = ref(null)

function handleFileUpload(e) {
 const file = e.target.files?.[0]
 if (!file) return
 const ext = file.name.split('.').pop()?.toLowerCase()
 if (ext !== 'txt') { alert($t('continue.onlyTxt')); return }
 fileName.value = file.name
 const reader = new FileReader()
 reader.onload = (ev) => { importedText.value = ev.target?.result || '' }
 reader.readAsText(file, 'UTF-8')
 e.target.value = ''
}

// 字数预设的文案随语言切换：中文用"万字/字"，英文用 k/M words
function countLabel(value, unit) {
 if (unit === 'book') {
  return value >= 1000000
   ? $t('continue.wordPresetBookM', { n: value / 1000000 })
   : $t('continue.wordPresetBook', { n: value / 10000 })
 }
 return $t('continue.wordPresetUnit', { n: value })
}
const bookPresets = computed(() => [10000, 30000, 50000, 100000, 200000, 500000, 1000000]
 .map((value) => ({ label: countLabel(value, 'book'), value })))
const chapterPresets = computed(() => [500, 1000, 2000, 3000, 5000, 8000]
 .map((value) => ({ label: countLabel(value, 'chapter'), value })))
const activePresets = computed(() => (genMode.value === 'book' ? bookPresets.value : chapterPresets.value))

watch(genMode, (mode) => {
 if (mode === 'chapter' && targetWordCount.value > 8000) targetWordCount.value = 3000
 if (mode === 'book' && targetWordCount.value < 10000) targetWordCount.value = 30000
})

onMounted(async () => {
 novelStore.streamingText = ''
 generationDone.value = false
 continueStatus.value = ''
 wordCount.value = 0
 if (!authStore.isLoggedIn) { router.push('/login'); return }
 if (novelStore.novelTypes.length === 0) await novelStore.fetchNovelTypes()
 const prefill = novelStore.prefillContinue
 if (prefill) {
 importedText.value = prefill.importedText || ''
 title.value = prefill.title || ''
 novelTypeName.value = prefill.novelTypeName || ''
 continueNovelId.value = prefill.novelId || ''
 novelStore.clearPrefillContinue()
 }
})

watch(() => novelStore.streamingText, async () => { await nextTick(); if (streamingRef.value) streamingRef.value.scrollTop = streamingRef.value.scrollHeight })

function isTokenExhaustedError(message) {
 if (!message) return false
 return message === 'TOKEN_EXHAUSTED' ||
 message.includes('Token') ||
 message.includes('token') ||
 /(余额不足|insufficient)/i.test(message)
}

async function startContinue() {
 if (importedText.value.length < 50 || isGenerating.value || stopping.value) return
 isGenerating.value = true; generationDone.value = false; wordCount.value = 0; novelStore.streamingText = ''
 try {
 if (continueNovelId.value) {
 await novelStore.continueGeneration(continueNovelId.value, (chunk, fullText) => { wordCount.value = fullText.length }, (status) => {
 if (status.type === 'completed') { generationDone.value = true; isGenerating.value = false; continueStatus.value = '' }
 else if (status.type === 'quality_notice') { continueStatus.value = $t('generate.statusQualityNotice', { n: status.chapterNumber, issues: status.report?.issues?.join('；') || $t('continue.qualityRecorded') }) }
 else if (status.type === 'thinking') { continueStatus.value = $t('generate.statusThinkingUnits', { n: status.length || 0 }) }
 else if (status.type === 'plan_needs_extension') { isGenerating.value = false; continueStatus.value = status.message || $t('generate.statusPlanExtend') }
 else if (status.type === 'token_exhausted') { isGenerating.value = false; continueStatus.value = $t('generate.statusStopped') }
 else if (status.type === 'error') { isGenerating.value = false; continueStatus.value = status.message || $t('continue.errContinue'); notifyModelError(status.message) }
 else if (status.type === 'paused') { isGenerating.value = false }
 }, genMode.value)
 } else {
 await novelStore.startImportContinue({
 novelId: continueNovelId.value || undefined,
 importedText: importedText.value,
 continuationRequest: continuationRequest.value,
 novelTypeName: novelTypeName.value,
 title: title.value || undefined,
 targetWordCount: targetWordCount.value,
 }, (chunk, fullText) => { wordCount.value = fullText.length }, (status) => {
 if (status.type === 'completed') { generationDone.value = true; isGenerating.value = false; continueStatus.value = '' }
 else if (status.type === 'token_exhausted') { isGenerating.value = false; continueStatus.value = $t('generate.statusStopped') }
 else if (status.type === 'error') { isGenerating.value = false; continueStatus.value = status.message || $t('continue.errContinue'); notifyModelError(status.message) }
 else if (status.type === 'paused') { isGenerating.value = false }
 })
 }
 } catch (e) {
 isGenerating.value = false
 if (isTokenExhaustedError(e.message)) alert($t('continue.alertStopped'))
 else if (e.message !== 'paused') alert($t('continue.alertContinueFailed', { message: e.message }))
 }
}

async function stopContinue() {
 if (stopping.value) return
 stopping.value = true
 try {
  if (continueNovelId.value) await novelStore.pauseNovel(continueNovelId.value)
  novelStore.stopGeneration()
  isGenerating.value = false
  continueStatus.value = $t('generate.statusPaused')
 } finally { stopping.value = false }
}
function goToBookshelf() { router.push('/bookshelf') }
</script>

<style scoped>
.locked { opacity:0.55; pointer-events:none; cursor:not-allowed; }
.continue-page { padding: 12px 0; }
.section-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
.import-area .textarea { min-height: 140px; font-family: inherit; }
.import-hint { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-light); margin-top: 6px; }
.upload-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.upload-btn { display: inline-flex; align-items: center; gap: 4px; padding: 8px 16px; border: 2px dashed var(--primary-color); border-radius: 8px; cursor: pointer; font-size: 13px; color: var(--primary-color); background: var(--primary-light); transition: all 0.2s; }
.upload-btn:hover { background: var(--primary-subtle); }
.upload-btn input { display: none; }
.file-name { font-size: 12px; color: var(--text-secondary); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.form-group { margin-bottom: 14px; }
.form-group label { display: block; font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-bottom: 6px; }
.select-input { appearance: auto; cursor: pointer; }
.word-count-input { display: flex; align-items: center; gap: 8px; }
.word-count-input .input { flex: 1; max-width: 150px; }
.unit { font-size: 15px; color: var(--text-secondary); }
.word-count-presets { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.preset-btn { padding: 4px 12px; border: 1px solid var(--border-color); border-radius: 16px; font-size: 12px; color: var(--text-secondary); cursor: pointer; transition: all 0.2s; }
.preset-btn.active { border-color: var(--primary-color); color: var(--primary-color); background: var(--primary-light); }
.action-card { text-align: center; }
.btn-generate { font-size: 18px; padding: 14px; }
.generating-status { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.word-count-progress { font-size: 13px; color: var(--text-secondary); }
.streaming-card { max-height: 400px; display: flex; flex-direction: column; }
.streaming-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.streaming-content { flex: 1; overflow-y: auto; max-height: 320px; background: var(--bg); border-radius: 8px; padding: 16px; line-height: 1.8; font-size: 14px; white-space: pre-wrap; word-wrap: break-word; }
.content-text { display: inline; }
.cursor-blink { display: inline; animation: blink 0.8s step-end infinite; color: var(--primary-color); font-weight: bold; }
@keyframes blink { 50% { opacity: 0; } }
.done-card { text-align: center; background: linear-gradient(135deg, var(--success-bg), var(--accent-light)); }
.done-icon { font-size: 40px; margin-bottom: 8px; }
.done-text { font-size: 16px; font-weight: 600; color: var(--success-color); margin-bottom: 12px; }
.mode-radio-group { display: flex; gap: 10px; margin-bottom: 8px; }
.mode-radio { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 12px; border: 2px solid var(--border-color); border-radius: 10px; cursor: pointer; transition: all 0.2s; background: var(--bg); }
.mode-radio.active { border-color: var(--primary-color); background: var(--primary-light); }
.mode-radio input { display: none; }
.mode-tip { font-size: 12px; color: var(--text-light); }
</style>
