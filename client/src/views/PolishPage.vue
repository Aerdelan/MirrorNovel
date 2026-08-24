<template>
 <div class="page-container polish-page">
 <div class="page-header" style="flex-direction:column;gap:2px;">
 <span>{{ $t('polish.title') }}</span>
 <span class="subtitle">{{ $t('polish.subtitle') }}</span>
 </div>

 <div class="card">
 <div class="section-title">① {{ $t('polish.stepInput') }}</div>
 <div class="mode-radio-group">
 <label class="mode-radio" :class="{ active: polishMode === 'text' }">
 <input type="radio" v-model="polishMode" value="text" />
 <span>{{ $t('polish.modeText') }}</span>
 </label>
 <label class="mode-radio" :class="{ active: polishMode === 'file' }">
 <input type="radio" v-model="polishMode" value="file" />
 <span>{{ $t('polish.modeFile') }}</span>
 </label>
 </div>
 </div>

 <div v-if="polishMode === 'text'" class="card">
 <div class="section-title">② {{ $t('polish.stepText') }}</div>
 <textarea v-model="polishText" class="textarea" rows="8" :placeholder="$t('polish.placeholderText')"></textarea>
 </div>

 <div v-if="polishMode === 'file'" class="card">
 <div class="section-title">② {{ $t('polish.stepFile') }}</div>
 <div class="upload-area" @click="$refs.polishFileInput.click()">
 <input ref="polishFileInput" type="file" accept=".txt" @change="handlePolishFile" style="display:none" />
 <div v-if="!polishFileName" class="upload-placeholder">
 <div class="upload-icon"></div>
 <div>{{ $t('polish.modeFile') }}</div>
 </div>
 <div v-else class="upload-file-info">
 <div class="file-icon"></div>
 <div class="file-name">{{ polishFileName }}</div>
 </div>
 </div>
 </div>

 <div class="card">
 <div class="section-title">③ {{ $t('polish.stepScheme') }}</div>
 <div class="polish-presets">
 <span v-for="p in polishPresets" :key="p.label" class="preset-btn" :class="{ active: polishPrompt === p.prompt }" @click="polishPrompt = p.prompt">{{ p.label }}</span>
 </div>
 <textarea v-model="polishPrompt" class="textarea" rows="4" :placeholder="$t('polish.placeholderCustom')"></textarea>
 </div>

 <div class="card">
 <div class="section-title">④ {{ $t('polish.genreLabel') }}</div>
 <div class="polish-presets">
 <span v-for="g in genreOptions" :key="g.value" class="preset-btn" :class="{ active: polishGenre === g.value }" @click="polishGenre = g.value">{{ g.label }}</span>
 </div>
 </div>

 <div class="card">
 <div class="section-title">⑤ {{ $t('polish.stepOption') }}</div>
 <label class="checkbox-row">
 <input type="checkbox" v-model="polishDoDeslop" />
 <span>{{ $t('polish.labelDoDeslop') }}</span>
 </label>
 <label class="checkbox-row" style="margin-top:8px;">
 <input type="checkbox" v-model="polishDiagnose" />
 <span>{{ $t('polish.diagnose') }}</span>
 </label>
 </div>

 <button class="btn btn-primary btn-block btn-lg" :disabled="polishing || !polishReady" @click="startPolish">
 {{ polishing ? $t('polish.btnPolishing') : $t('polish.btnPolish') }}
 </button>
 <div v-if="!polishReady && !polishing" class="polish-hint">
 {{ polishMode === 'text' ? $t('polish.hintText') : $t('polish.hintFile') }}
 </div>

 <div v-if="polishing || polishCompleted" class="card polish-stream-card">
 <div class="section-title">{{ polishing ? $t('polish.title') : $t('polish.resultTitle') }}</div>
 <div class="polish-status">{{ polishStatusText }}</div>
 <div class="polish-progress-bar" v-if="polishProgress > 0">
 <div class="progress-fill" :style="{ width: polishProgress + '%' }"></div>
 </div>
 <!-- 诊断摘要 -->
 <div v-if="diagnosis" class="diagnosis-card">
 <div class="diagnosis-title">{{ $t('polish.diagnosisTitle') }}</div>
 <div v-if="diagnosis.revisionFocus" class="diagnosis-row"><strong>{{ $t('polish.diagnosisFocus') }}：</strong>{{ diagnosis.revisionFocus }}</div>
 <div v-if="diagnosis.weaknesses?.length" class="diagnosis-row"><strong>{{ $t('polish.diagnosisWeakness') }}：</strong>
 <span v-for="(w, i) in diagnosis.weaknesses" :key="i" class="diagnosis-tag weakness">{{ w }}</span>
 </div>
 <div v-if="diagnosis.templatePhrases?.length" class="diagnosis-row"><strong>{{ $t('polish.diagnosisTemplate') }}：</strong>
 <span v-for="(p, i) in diagnosis.templatePhrases" :key="i" class="diagnosis-tag template">{{ p }}</span>
 </div>
 <div v-if="diagnosis.strengths?.length" class="diagnosis-row"><strong>{{ $t('polish.diagnosisStrength') }}：</strong>
 <span v-for="(s, i) in diagnosis.strengths" :key="i" class="diagnosis-tag strength">{{ s }}</span>
 </div>
 </div>
 <div class="polish-preview" v-if="polishedText">{{ showFullPreview ? polishedText : (polishedText.length > 500 ? polishedText.substring(0,500)+'…' : polishedText) }}</div>
 <button v-if="polishedText.length > 500 && !showFullPreview" class="btn btn-outline btn-sm" @click="showFullPreview = true" style="margin-top:8px;">{{ $t('polish.previewFull') }}（{{ polishedText.length }} 字）</button>
 </div>

 <!-- 导出与保存面板 -->
 <div v-if="polishCompleted" class="card">
 <div class="section-title">{{ $t('polish.statusDone', { count: polishedText.length }) }}</div>
 <div class="export-panel">
 <div class="export-row">
 <label>{{ $t('polish.exportTitle') }}</label>
 <input v-model="exportTitle" class="input" :placeholder="$t('polish.exportTitlePlaceholder')" />
 </div>
 <div class="export-row">
 <label>{{ $t('polish.exportFormat') }}</label>
 <div class="format-btns">
 <button class="format-btn" :class="{ active: exportFormat === 'txt' }" @click="exportFormat = 'txt'">{{ $t('polish.fmtTxt') }}</button>
 <button class="format-btn" :class="{ active: exportFormat === 'md' }" @click="exportFormat = 'md'">{{ $t('polish.fmtMd') }}</button>
 <button class="format-btn" :class="{ active: exportFormat === 'epub' }" @click="exportFormat = 'epub'">{{ $t('polish.fmtEpub') }}</button>
 </div>
 </div>
 <button class="btn btn-success btn-block" @click="exportPolish" :disabled="exporting">{{ exporting ? '...' : $t('polish.exportBtn') }}</button>
 </div>

 <div class="save-panel">
 <div class="section-title">{{ $t('polish.saveToNovel') }}</div>
 <div class="save-hint">{{ $t('polish.saveToNovelHint') }}</div>
 <select v-model="saveNovelId" class="input">
 <option value="">{{ $t('polish.saveSelectNovel') }}</option>
 <option v-for="n in bookshelf" :key="n._id" :value="n._id">{{ n.title }}（{{ n.currentWordCount || 0 }} 字）</option>
 </select>
 <button class="btn btn-primary btn-block" :disabled="!saveNovelId || saving" @click="saveToNovel">{{ saving ? '...' : $t('polish.saveBtn') }}</button>
 <div v-if="saveMessage" class="save-msg" :class="{ ok: saveOk }">{{ saveMessage }}</div>
 </div>
 </div>
 </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useNovelStore } from '../stores/novel'
import { useAuthStore } from '../stores/auth'
import { useI18n } from '../composables/useI18n'
import api from '../api'

const novelStore = useNovelStore()
const authStore = useAuthStore()
const { $t } = useI18n()

const polishMode = ref('text')
const polishText = ref('')
const polishFileName = ref('')
const polishFileContent = ref('')
const polishPrompt = ref('')
const polishGenre = ref('')
const polishDoDeslop = ref(false)
const polishDiagnose = ref(true)
const polishing = ref(false)
const polishedText = ref('')
const polishCompleted = ref(false)
const polishStatusText = ref('')
const polishProgress = ref(0)
const diagnosis = ref(null)
const showFullPreview = ref(false)

const bookshelf = ref([])
const exportTitle = ref('润色作品')
const exportFormat = ref('txt')
const exporting = ref(false)
const saveNovelId = ref('')
const saving = ref(false)
const saveMessage = ref('')
const saveOk = ref(false)

const genreOptions = [
 { label: $t('polish.genreAuto'), value: '' },
 { label: '都市', value: '都市' },
 { label: '玄幻', value: '玄幻' },
 { label: '仙侠', value: '仙侠' },
 { label: '历史', value: '历史' },
 { label: '武侠', value: '武侠' },
 { label: '科幻', value: '科幻' },
 { label: '悬疑', value: '悬疑灵异' },
 { label: '现代言情', value: '现代言情' },
 { label: '古代言情', value: '古代言情' },
]

const polishPresets = [
 { label: $t('polish.presets.default'), prompt: '请对以下小说文本进行润色优化：修正语病，优化用词，调整句式节奏，保留原文风格。直接输出润色后文本。' },
 { label: $t('polish.presets.concise'), prompt: '请对以下文本进行精简润色：删除冗余描写，让句子更简洁有力，节奏更明快。保留核心剧情和人物对话。直接输出。' },
 { label: $t('polish.presets.ornate'), prompt: '请对以下文本进行华丽风格润色：增加生动的细节描写和修辞手法，使用更丰富的词汇，提升文学性。直接输出。' },
 { label: $t('polish.presets.colloquial'), prompt: '请对以下文本进行口语化润色：让语言更自然、更像日常对话，减少书面化表达，增加接地气的用词。直接输出。' },
]

const polishReady = computed(() => {
 if (polishMode.value === 'text') return polishText.value.trim().length >= 1
 return polishFileContent.value.trim().length >= 1
})

onMounted(async () => {
 try {
 await novelStore.fetchBookshelf()
 bookshelf.value = novelStore.bookshelf || []
 } catch {}
})

function handlePolishFile(e) {
 const file = e.target.files?.[0]
 if (!file || !file.name.endsWith('.txt')) return alert($t('polish.hintFile'))
 polishFileName.value = file.name
 // 用文件名去后缀作为默认导出标题
 exportTitle.value = file.name.replace(/\.txt$/i, '') || '润色作品'
 const reader = new FileReader()
 reader.onload = () => { polishFileContent.value = reader.result }
 reader.readAsText(file, 'UTF-8')
}

function startPolish() {
 const text = polishMode.value === 'text' ? polishText.value : polishFileContent.value
 if (!text || text.trim().length < 10) return alert($t('common.loading'))
 polishing.value = true; polishCompleted.value = false
 polishedText.value = ''; polishStatusText.value = $t('polish.statusPolishing')
 polishProgress.value = 0
 diagnosis.value = null; showFullPreview.value = false
 saveMessage.value = ''; saveOk.value = false
 let totalChunks = 0
 novelStore.startPolish(
 { text, polishPrompt: polishPrompt.value || undefined, doDeslop: polishDoDeslop.value, genre: polishGenre.value || undefined, diagnose: polishDiagnose.value },
 (chunk, isDeslop) => {
 polishedText.value += chunk; totalChunks++
 polishProgress.value = Math.min(95, Math.round(totalChunks / 10))
 if (isDeslop) { polishStatusText.value = $t('polish.statusDeslop'); polishProgress.value = 96 }
 else { polishStatusText.value = $t('polish.statusPolishing') }
 },
 (event) => {
 if (event.type === 'diagnosis') {
 diagnosis.value = event.diagnosis || null
 } else if (event.type === 'final_content') {
 // 用后处理过的完整内容替换流式拼接的结果
 if (event.content && event.content.length > 0) polishedText.value = event.content
 } else if (event.type === 'completed') {
 polishStatusText.value = $t('polish.statusDone', { count: polishedText.value.length })
 polishProgress.value = 100; polishCompleted.value = true; polishing.value = false
 } else if (event.type === 'status') {
 polishStatusText.value = event.message || ''
 } else if (event.type === 'error') {
 polishStatusText.value = ' ' + event.message; polishing.value = false
 }
 }
 )
}

async function exportPolish() {
 if (!polishedText.value) return alert($t('polish.exportEmpty'))
 exporting.value = true
 try {
 const token = localStorage.getItem('token')
 const resp = await fetch('/api/novel/polish-export', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
 body: JSON.stringify({ text: polishedText.value, title: exportTitle.value, format: exportFormat.value })
 })
 if (!resp.ok) {
 const err = await resp.json().catch(() => ({}))
 throw new Error(err.message || `HTTP ${resp.status}`)
 }
 const blob = await resp.blob()
 const disposition = resp.headers.get('Content-Disposition') || ''
 // 优先用 filename*=UTF-8''xxx，否则用默认
 let suggested = `${exportTitle.value || 'polish'}.${exportFormat.value}`
 const m = disposition.match(/filename\*=UTF-8''([^;\s]+)/i) || disposition.match(/filename="?([^";\s]+)"?/i)
 if (m && m[1]) suggested = decodeURIComponent(m[1])
 const url = URL.createObjectURL(blob)
 const a = document.createElement('a')
 a.href = url; a.download = suggested; a.click()
 setTimeout(() => URL.revokeObjectURL(url), 1000)
 } catch (e) {
 alert('导出失败：' + e.message)
 } finally {
 exporting.value = false
 }
}

async function saveToNovel() {
 if (!saveNovelId.value || !polishedText.value) return
 saving.value = true; saveMessage.value = ''
 try {
 const resp = await api.post('/novel/polish-save', {
 novelId: saveNovelId.value,
 text: polishedText.value,
 mode: 'append'
 })
 saveOk.value = true
 const novel = bookshelf.value.find(n => n._id === saveNovelId.value)
 saveMessage.value = $t('polish.saveSuccess', { title: novel?.title || '' }) + `（累计 ${resp.data?.currentWordCount || 0} 字）`
 } catch (e) {
 saveOk.value = false
 saveMessage.value = e.response?.data?.message || e.message || '保存失败'
 } finally {
 saving.value = false
 }
}

// 保留旧版纯客户端 TXT 下载作为备用
function downloadPolish() {
 const blob = new Blob([polishedText.value], { type: 'text/plain;charset=utf-8' })
 const url = URL.createObjectURL(blob)
 const a = document.createElement('a')
 a.href = url
 a.download = `polish_${Date.now()}.txt`
 a.click()
 URL.revokeObjectURL(url)
}
</script>

<style scoped>
.polish-page { padding-top: var(--header-height); }
.page-header { margin-bottom: 16px; }
.page-header h2 { margin: 0 0 4px; font-size: 18px; }
.subtitle { margin: 0; font-size: 13px; color: var(--text-light); }
.mode-radio-group { display: flex; gap: 10px; }
.mode-radio { flex: 1; padding: 10px; border: 2px solid var(--border-color); border-radius: 10px; cursor: pointer; text-align: center; transition: all 0.15s; font-size: 14px; font-weight: 500; }
.mode-radio input { display: none; }
.mode-radio.active { border-color: var(--primary-color); background: var(--primary-light); }
.upload-area { border: 2px dashed var(--border-color); border-radius: 12px; padding: 24px; text-align: center; cursor: pointer; transition: all 0.2s; background: var(--bg); }
.upload-area:hover { border-color: var(--primary-color); background: var(--primary-light); }
.upload-placeholder { color: var(--text-secondary); }
.upload-icon { font-size: 36px; margin-bottom: 8px; }
.upload-file-info { display: flex; align-items: center; gap: 8px; justify-content: center; }
.file-icon { font-size: 24px; }
.file-name { font-size: 14px; font-weight: 500; color: var(--text-primary); }
.polish-presets { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
.preset-btn { padding: 4px 12px; border: 1px solid var(--border-color); border-radius: 14px; font-size: 12px; cursor: pointer; transition: all 0.15s; color: var(--text-secondary); }
.preset-btn.active { border-color: var(--primary-color); background: var(--primary-light); color: var(--primary-color); font-weight: 600; }
.preset-btn:hover { border-color: var(--primary-color); }
.btn-lg { padding: 14px; font-size: 16px; }
.polish-stream-card { background: var(--info-bg); border-color: var(--info-border); }
.polish-status { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
.polish-preview { font-size: 13px; line-height: 1.6; color: var(--text-secondary); max-height: 200px; overflow-y: auto; background: var(--bg); padding: 10px; border-radius: 8px; white-space: pre-wrap; }
.polish-progress-bar { height: 6px; background: var(--bg-alt); border-radius: 3px; margin-bottom: 10px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--primary), var(--accent)); border-radius: 3px; transition: width 0.3s ease; }
.checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
.checkbox-row input { width: 16px; height: 16px; cursor: pointer; }
.btn-success { background: var(--success); color: white; border: none; padding: 14px 24px; border-radius: 10px; font-size: 16px; cursor: pointer; font-family: inherit; }
.btn-success:hover { background: var(--primary-hover); }
.polish-hint { text-align: center; font-size: 13px; color: var(--text-light); margin-top: 8px; }
.diagnosis-card { background: var(--warning-bg, #fff7e6); border: 1px solid var(--warning-border, #ffd591); border-radius: 8px; padding: 12px; margin: 10px 0; font-size: 13px; line-height: 1.6; }
.diagnosis-title { font-weight: 600; color: var(--warning-color, #d48806); margin-bottom: 6px; }
.diagnosis-row { margin-bottom: 6px; }
.diagnosis-tag { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; margin: 2px 4px 2px 0; }
.diagnosis-tag.weakness { background: #ffe7e7; color: #c53030; border: 1px solid #feb2b2; }
.diagnosis-tag.template { background: #fef3cd; color: #856404; border: 1px solid #f9d77a; }
.diagnosis-tag.strength { background: #d4edda; color: #155724; border: 1px solid #b7e4c7; }
.export-panel { display: flex; flex-direction: column; gap: 12px; padding: 4px 0; }
.export-row { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.export-row label { color: var(--text-secondary); font-size: 12px; }
.export-row .input { padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 14px; background: var(--bg); color: var(--text-primary); }
.format-btns { display: flex; gap: 6px; flex-wrap: wrap; }
.format-btn { flex: 1; min-width: 100px; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg); font-size: 13px; cursor: pointer; color: var(--text-secondary); transition: all 0.15s; }
.format-btn.active { border-color: var(--primary-color); background: var(--primary-light); color: var(--primary-color); font-weight: 600; }
.format-btn:hover { border-color: var(--primary-color); }
.save-panel { margin-top: 16px; padding-top: 14px; border-top: 1px dashed var(--border-color); }
.save-hint { font-size: 12px; color: var(--text-light); margin-bottom: 8px; }
.save-panel select.input, .save-panel .input { padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 14px; background: var(--bg); color: var(--text-primary); width: 100%; box-sizing: border-box; margin-bottom: 8px; }
.save-msg { margin-top: 8px; padding: 8px 12px; border-radius: 8px; font-size: 13px; background: #ffe7e7; color: #c53030; border: 1px solid #feb2b2; }
.save-msg.ok { background: #d4edda; color: #155724; border-color: #b7e4c7; }
</style>
