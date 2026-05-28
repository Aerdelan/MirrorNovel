<template>
  <view class="page-container polish-page">
    <view class="page-header">
      <text>润色</text>
    </view>

    <view class="card">
      <view class="section-title">① 输入模式</view>
      <view class="mode-radio-group">
        <label :class="['mode-radio', { active: polishMode === 'text' }]">
          <radio value="text" :checked="polishMode==='text'" @click="polishMode='text'" />
          <text>文本输入</text>
        </label>
        <label :class="['mode-radio', { active: polishMode === 'file' }]">
          <radio value="file" :checked="polishMode==='file'" @click="polishMode='file'" />
          <text>文件上传</text>
        </label>
      </view>
    </view>

    <view v-if="polishMode === 'text'" class="card">
      <view class="section-title">② 输入文本</view>
      <textarea v-model="polishText" class="textarea" rows="8" placeholder="粘贴需要润色的文本"></textarea>
    </view>

    <view v-if="polishMode === 'file'" class="card">
      <view class="section-title">② 选择文件</view>
      <view class="upload-area" @click="chooseFile">
        <view v-if="!polishFileName" class="upload-placeholder">
          <view class="upload-icon">📄</view>
          <text>点击选择 .txt 文件</text>
        </view>
        <view v-else class="upload-file-info">
          <text>📄 {{ polishFileName }}</text>
        </view>
      </view>
    </view>

    <view class="card">
      <view class="section-title">③ 润色方案</view>
      <view class="polish-presets">
        <text v-for="p in polishPresets" :key="p.label"
          :class="['preset-btn', { active: polishPrompt === p.prompt }]"
          @click="polishPrompt = p.prompt">{{ p.label }}</text>
      </view>
      <textarea v-model="polishPrompt" class="textarea" rows="4" placeholder="或自定义润色要求"></textarea>
    </view>

    <view class="card">
      <view class="section-title">④ 选项</view>
      <label class="checkbox-row">
        <checkbox :checked="polishDoDeslop" @click="polishDoDeslop=!polishDoDeslop" />
        <text>执行去AI味处理</text>
      </label>
    </view>

    <!-- Token 余额 -->
    <view v-if="polishing || polishCompleted" class="card token-indicator">
      <view class="token-row">
        <text class="token-label">Token 余额</text>
        <text class="token-value">
          <text style="color:var(--primary-color);font-size:15px;font-weight:700;">{{ tokenAvailable.toLocaleString() }}</text>
          <text v-if="polishing" style="color:var(--text-light);font-size:12px;"> ⟳ 消耗中</text>
        </text>
      </view>
    </view>

    <button class="btn btn-primary btn-block btn-lg" :disabled="polishing || !polishReady" @click="startPolish">
      {{ polishing ? '润色中...' : '开始润色' }}
    </button>
    <view v-if="!polishReady && !polishing" class="polish-hint">{{ polishMode === 'text' ? '请输入至少10个字符' : '请选择一个 .txt 文件' }}</view>

    <view v-if="polishing" class="card polish-stream-card">
      <view class="section-title">📝 润色中</view>
      <view class="polish-status">{{ polishStatusText }}</view>
      <view class="polish-progress-bar" v-if="polishProgress > 0">
        <view class="progress-fill" :style="{ width: polishProgress + '%' }"></view>
      </view>
      <scroll-view class="polish-preview" scroll-y v-if="polishedText">{{ polishedText.length > 300 ? polishedText.substring(0,300)+'...' : polishedText }}</scroll-view>
    </view>

    <view v-if="polishCompleted" class="card" style="text-align:center;">
      <view class="section-title">润色完成（{{ polishedText.length }}字）</view>
      <button class="btn btn-success btn-lg" @click="downloadPolish">下载结果</button>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { xhrUrl } from '../../utils/apiUrl'

const authStore = useAuthStore()

function getToken() {
  try { if (uni.getStorageSync) return uni.getStorageSync('token') || '' } catch {}
  try { return localStorage.getItem('token') || '' } catch { return '' }
}
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

const polishPresets = [
  { label: '默认', prompt: '请对以下小说文本进行润色优化：修正语病，优化用词，调整句式节奏，保留原文风格。直接输出润色后文本。' },
  { label: '精简', prompt: '请对以下文本进行精简润色：删除冗余描写，让句子更简洁有力，节奏更明快。保留核心剧情和人物对话。直接输出。' },
  { label: '华丽', prompt: '请对以下文本进行华丽风格润色：增加生动的细节描写和修辞手法，使用更丰富的词汇，提升文学性。直接输出。' },
  { label: '口语化', prompt: '请对以下文本进行口语化润色：让语言更自然、更像日常对话，减少书面化表达，增加接地气的用词。直接输出。' },
]

const polishReady = computed(() => {
  if (polishMode.value === 'text') return polishText.value.trim().length >= 1
  return polishFileContent.value.trim().length >= 1
})

function chooseFile() {
  uni.chooseFile({
    count: 1,
    extension: ['.txt'],
    success: (res) => {
      const file = res.tempFiles[0]
      polishFileName.value = file.name
      uni.getFileSystemManager().readFile({
        filePath: file.path,
        encoding: 'utf-8',
        success: (r) => { polishFileContent.value = r.data }
      })
    }
  })
}

function startPolish() {
  const text = polishMode.value === 'text' ? polishText.value : polishFileContent.value
  if (!text || text.trim().length < 10) return uni.showToast({ title: '文本太短', icon: 'none' })
  polishing.value = true; polishCompleted.value = false
  polishedText.value = ''; polishStatusText.value = '正在润色...'
  polishProgress.value = 0; tokenAvailable.value = 0
  let totalChunks = 0

  const token = getToken()
  const xhr = new XMLHttpRequest()
  xhr.open('POST', xhrUrl('/api/novel/polish'))
  xhr.setRequestHeader('Authorization', `Bearer ${token}`)
  xhr.setRequestHeader('Content-Type', 'application/json')
  xhr.setRequestHeader('Accept', 'text/event-stream')
  let lastIdx = 0

  xhr.onprogress = () => {
    const newData = xhr.responseText.substring(lastIdx)
    lastIdx = xhr.responseText.length
    const lines = newData.split('\n').filter(l => l.startsWith('data: '))
    for (const line of lines) {
      try {
        const event = JSON.parse(line.substring(6))
        if (event.type === 'token_info') {
          tokenAvailable.value = event.available
        } else if (event.type === 'content') {
          polishedText.value += event.content; totalChunks++
          polishProgress.value = Math.min(95, Math.round(totalChunks / 10))
          polishStatusText.value = '正在润色...'
        } else if (event.type === 'deslop_content') {
          polishedText.value += event.content
          polishStatusText.value = '正在去AI味...'
          polishProgress.value = 96
        } else if (event.type === 'status') {
          polishStatusText.value = event.message
        } else if (event.type === 'completed') {
          polishStatusText.value = '润色完成（' + polishedText.length + '字）'
          polishProgress.value = 100; polishCompleted.value = true; polishing.value = false
          authStore.getTokenInfo().catch(() => {})
        } else if (event.type === 'token_exhausted') {
          if (polishedText.value.length > 0) {
            polishStatusText.value = '⚠️ Token 已用完，已保留当前结果'
            polishCompleted.value = true
          } else {
            polishStatusText.value = '⚠️ ' + (event.message || 'Token 余额不足')
          }
          polishProgress.value = 100; polishing.value = false
          authStore.getTokenInfo().catch(() => {})
        } else if (event.type === 'error') {
          polishStatusText.value = '❌ ' + event.message; polishing.value = false
        }
      } catch {}
    }
  }

  xhr.onerror = () => { polishing.value = false; polishStatusText.value = '❌ 网络请求失败' }
  xhr.send(JSON.stringify({ text, polishPrompt: polishPrompt.value || undefined, doDeslop: polishDoDeslop.value }))
}

function downloadPolish() {
  const blob = new Blob([polishedText.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `polish_${Date.now()}.txt`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.polish-page { padding-top: var(--header-height); }
.page-header { position:fixed;top:0;left:0;right:0;height:var(--header-height);background:var(--card-bg);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;border-bottom:1px solid var(--border-color);z-index:100; }
.mode-radio-group { display:flex;gap:10px; }
.mode-radio { flex:1;display:flex;align-items:center;gap:6px;padding:10px;border:2px solid var(--border-color);border-radius:10px;font-size:14px;background:#f8f8f8; }
.mode-radio.active { border-color:var(--primary-color);background:var(--primary-light); }
.upload-area { border:2px dashed var(--border-color);border-radius:12px;padding:30px;text-align:center;cursor:pointer; }
.upload-placeholder { color:var(--text-light); }
.upload-icon { font-size:36px;margin-bottom:8px; }
.polish-presets { display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px; }
.preset-btn { padding:6px 14px;border-radius:16px;font-size:12px;background:#f5f5f5;border:1px solid var(--border-color);color:var(--text-secondary); }
.preset-btn.active { background:var(--primary-light);border-color:var(--primary-color);color:var(--primary-color); }
.checkbox-row { display:flex;align-items:center;gap:8px;font-size:14px; }
.polish-stream-card { }
.polish-status { font-size:13px;color:var(--text-secondary);margin-bottom:8px; }
.polish-progress-bar { height:6px;background:#e8e8e8;border-radius:3px;margin-bottom:10px;overflow:hidden; }
.progress-fill { height:100%;background:linear-gradient(90deg,#1890ff,#40a9ff);border-radius:3px;transition:width 0.3s; }
.polish-preview { font-size:13px;line-height:1.6;color:var(--text-secondary);max-height:200px;background:#f8f8f8;padding:10px;border-radius:8px;white-space:pre-wrap; }
.polish-hint { text-align:center;font-size:13px;color:var(--text-light);margin-top:8px; }
.token-indicator { padding:10px 16px;background:#f6ffed;border:1px solid #b7eb8f; }
.token-row { display:flex;justify-content:space-between;align-items:center;font-size:13px; }
.btn-success { background:#52c41a;color:white;border:none;padding:14px 24px;border-radius:10px;font-size:16px; }
</style>
