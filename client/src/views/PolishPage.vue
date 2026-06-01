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
          <div class="upload-icon">📄</div>
          <div>{{ $t('polish.modeFile') }}</div>
        </div>
        <div v-else class="upload-file-info">
          <div class="file-icon">📄</div>
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
      <div class="section-title">④ {{ $t('polish.stepOption') }}</div>
      <label class="checkbox-row">
        <input type="checkbox" v-model="polishDoDeslop" />
        <span>{{ $t('polish.labelDoDeslop') }}</span>
      </label>
    </div>

    <!-- Token 余额显示 -->
    <div v-if="polishing || polishCompleted" class="card token-indicator">
      <div class="token-row">
        <span class="token-label">{{ $t('profile.tokenBalance') }}</span>
        <span class="token-value">
          <strong>{{ tokenAvailable.toLocaleString() }}</strong>
          <span v-if="polishing" class="token-consuming"> ⟳ {{ tokenConsumed }} 消耗中</span>
        </span>
      </div>
    </div>

    <button class="btn btn-primary btn-block btn-lg" :disabled="polishing || !polishReady" @click="startPolish">
      {{ polishing ? $t('polish.btnPolishing') : $t('polish.btnPolish') }}
    </button>
    <div v-if="!polishReady && !polishing" class="polish-hint">
      {{ polishMode === 'text' ? $t('polish.hintText') : $t('polish.hintFile') }}
    </div>

    <div v-if="polishing" class="card polish-stream-card">
      <div class="section-title">📝 {{ $t('polish.title') }}</div>
      <div class="polish-status">{{ polishStatusText }}</div>
      <div class="polish-progress-bar" v-if="polishProgress > 0">
        <div class="progress-fill" :style="{ width: polishProgress + '%' }"></div>
      </div>
      <div class="polish-preview" v-if="polishedText">{{ polishedText.length > 300 ? polishedText.substring(0,300)+'...' : polishedText }}</div>
    </div>

    <div v-if="polishCompleted" class="card" style="text-align:center;">
      <div class="section-title">{{ $t('polish.statusDone', { count: polishedText.length }) }}</div>
      <button class="btn btn-success btn-lg" @click="downloadPolish">{{ $t('polish.download') }}</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useNovelStore } from '../stores/novel'
import { useAuthStore } from '../stores/auth'
import { useI18n } from '../composables/useI18n'

const novelStore = useNovelStore()
const authStore = useAuthStore()
const { $t } = useI18n()

const polishMode = ref('text')
const polishText = ref('')
const polishFileName = ref('')
const polishFileContent = ref('')
const polishPrompt = ref('')
const polishDoDeslop = ref(false)
const polishing = ref(false)
const polishedText = ref('')
const polishCompleted = ref(false)
const polishStatusText = ref('')
const polishProgress = ref(0)
const tokenAvailable = ref(0)
const tokenConsumed = ref(0)

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

function handlePolishFile(e) {
  const file = e.target.files?.[0]
  if (!file || !file.name.endsWith('.txt')) return alert($t('polish.hintFile'))
  polishFileName.value = file.name
  const reader = new FileReader()
  reader.onload = () => { polishFileContent.value = reader.result }
  reader.readAsText(file, 'UTF-8')
}

function startPolish() {
  const text = polishMode.value === 'text' ? polishText.value : polishFileContent.value
  if (!text || text.trim().length < 10) return alert($t('common.loading'))
  polishing.value = true; polishCompleted.value = false
  polishedText.value = ''; polishStatusText.value = $t('polish.statusPolishing')
  polishProgress.value = 0; tokenConsumed.value = 0
  let totalChunks = 0
  novelStore.startPolish(
    { text, polishPrompt: polishPrompt.value || undefined, doDeslop: polishDoDeslop.value },
    (chunk, isDeslop) => {
      polishedText.value += chunk; totalChunks++
      polishProgress.value = Math.min(95, Math.round(totalChunks / 10))
      if (isDeslop) { polishStatusText.value = $t('polish.statusDeslop'); polishProgress.value = 96 }
      else { polishStatusText.value = $t('polish.statusPolishing') }
    },
    (event) => {
      if (event.type === 'token_info') {
        tokenAvailable.value = event.available
      } else if (event.type === 'completed') {
        polishStatusText.value = $t('polish.statusDone', { count: polishedText.length })
        polishProgress.value = 100; polishCompleted.value = true; polishing.value = false
        // 刷新 Token 信息
        authStore.getTokenInfo().catch(() => {})
      } else if (event.type === 'token_exhausted') {
        if (polishedText.value.length > 0) {
          polishStatusText.value = '⚠️ Token 已用完，已保留当前润色结果'
          polishCompleted.value = true
        } else {
          polishStatusText.value = '⚠️ ' + (event.message || 'Token 余额不足')
        }
        polishProgress.value = 100; polishing.value = false
        authStore.getTokenInfo().catch(() => {})
      } else if (event.type === 'error') {
        polishStatusText.value = '❌ ' + event.message; polishing.value = false
      }
    }
  )
}

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
.mode-radio.active { border-color: var(--primary-color); background: #fff5f0; }
.upload-area { border: 2px dashed var(--border-color); border-radius: 12px; padding: 24px; text-align: center; cursor: pointer; transition: all 0.2s; background: #fafafa; }
.upload-area:hover { border-color: var(--primary-color); background: #fff5f0; }
.upload-placeholder { color: var(--text-secondary); }
.upload-icon { font-size: 36px; margin-bottom: 8px; }
.upload-file-info { display: flex; align-items: center; gap: 8px; justify-content: center; }
.file-icon { font-size: 24px; }
.file-name { font-size: 14px; font-weight: 500; color: var(--text-primary); }
.polish-presets { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
.preset-btn { padding: 4px 12px; border: 1px solid var(--border-color); border-radius: 14px; font-size: 12px; cursor: pointer; transition: all 0.15s; color: var(--text-secondary); }
.preset-btn.active { border-color: var(--primary-color); background: #fff5f0; color: var(--primary-color); font-weight: 600; }
.preset-btn:hover { border-color: var(--primary-color); }
.btn-lg { padding: 14px; font-size: 16px; }
.polish-stream-card { background: #f0f8ff; border-color: #91d5ff; }
.polish-status { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
.polish-preview { font-size: 13px; line-height: 1.6; color: var(--text-secondary); max-height: 200px; overflow-y: auto; background: #f8f8f8; padding: 10px; border-radius: 8px; white-space: pre-wrap; }
.polish-progress-bar { height: 6px; background: #e8e8e8; border-radius: 3px; margin-bottom: 10px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #1890ff, #40a9ff); border-radius: 3px; transition: width 0.3s ease; }
.checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
.checkbox-row input { width: 16px; height: 16px; cursor: pointer; }
.btn-success { background: #52c41a; color: white; border: none; padding: 14px 24px; border-radius: 10px; font-size: 16px; cursor: pointer; font-family: inherit; }
.btn-success:hover { background: #73d13d; }
.polish-hint { text-align: center; font-size: 13px; color: var(--text-light); margin-top: 8px; }
.token-indicator { padding: 10px 16px; background: #f6ffed; border: 1px solid #b7eb8f; }
.token-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
.token-value strong { color: var(--primary-color); font-size: 15px; }
.token-consuming { color: var(--text-light); font-size: 12px; }
</style>
