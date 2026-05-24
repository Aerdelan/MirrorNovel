<template>
  <div class="page-container generate-page">
    <!-- Tab 切换 -->
    <div class="tabs">
      <button class="tab" :class="{ active: activeTab === 'generate' }" @click="activeTab='generate'">✍️ 生成小说</button>
      <button class="tab" :class="{ active: activeTab === 'polish' }" @click="activeTab='polish'">✨ 润色文本</button>
    </div>

    <!-- ==================== 生成 Tab ==================== -->
    <template v-if="activeTab === 'generate'">
      <!-- 类型选择（带性别切换，对齐蒸馏页） -->
      <div class="card">
        <div class="section-title">① 选择小说类型</div>
        <div class="gender-tabs">
          <button :class="{ active: gender === 'male' }" @click="gender='male'">🚹 男频</button>
          <button :class="{ active: gender === 'female' }" @click="gender='female'">🚺 女频</button>
        </div>
        <div class="type-grid">
          <div v-for="cat in currentCats" :key="cat.name" class="type-card" :class="{ selected: selectedType === cat.name }" @click="selectedType = cat.name">
            <span class="type-icon">{{ cat.icon }}</span>
            <span class="type-name">{{ cat.name }}</span>
          </div>
        </div>
        <div v-if="selectedType" class="type-info">✅ 已选择：{{ selectedType }}</div>
      </div>

      <!-- 主角设定 -->
      <div class="card">
        <div class="section-title">② 主角设定</div>
        <input v-model="protagonistName" class="input" placeholder="故事主角名字" maxlength="20" />
      </div>

      <!-- 世界观设定 -->
      <div class="card">
        <div class="section-title">③ 世界观设定</div>
        <textarea v-model="worldSetting" class="textarea" placeholder="描述故事的世界观、背景设定、特殊规则等（可选）" rows="4"></textarea>
      </div>

      <!-- 大纲输入 -->
      <div v-if="genMode === 'book'" class="card">
        <div class="section-title">📋 创作大纲</div>
        <div v-if="generating && outlineStreamingText" class="outline-streaming">
          <div class="outline-loading">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
            <span>AI 正在生成大纲...</span>
          </div>
          <div class="outline-preview">{{ generatedOutline || outline }}</div>
        </div>
        <textarea v-model="outline" class="textarea" rows="4"
          placeholder="可选，不填则由AI自动生成大纲"></textarea>
      </div>

      <!-- 模式选择 -->
      <div class="card">
        <div class="section-title">④ 生成模式 & 字数设定</div>
        <div class="mode-radio-group">
          <label class="mode-radio" :class="{ active: genMode === 'book' }">
            <input type="radio" v-model="genMode" value="book" />
            <span class="mode-icon">📚</span><span class="mode-label">生成整本</span>
          </label>
          <label class="mode-radio" :class="{ active: genMode === 'chapter' }">
            <input type="radio" v-model="genMode" value="chapter" />
            <span class="mode-icon">📄</span><span class="mode-label">生成一章</span>
          </label>
        </div>
        <div class="word-count-input" style="margin-top:12px;">
          <input v-model.number="targetWordCount" class="input" type="number" :min="genMode==='chapter'?500:1000" :max="genMode==='chapter'?20000:10000000" step="500" />
          <span class="unit">字</span>
        </div>
        <div class="word-count-presets">
          <span v-for="p in activePresets" :key="p.value" class="preset-btn" :class="{ active: targetWordCount === p.value }" @click="targetWordCount = p.value">{{ p.label }}</span>
        </div>
      </div>

      <!-- 生成按钮 -->
      <button class="btn btn-primary btn-block btn-lg" :disabled="generating || !selectedType" @click="startGen">
        {{ generating ? '⏳ 生成中...' : '🚀 开始创作' }}
      </button>

      <!-- 大纲生成进度 -->
      <div v-if="generating && outlineStreamingText" class="card outline-stream-card">
        <div class="section-title">📋 大纲生成中...</div>
        <div class="outline-stream-text">{{ outlineStreamingText }}</div>
      </div>

      <!-- 生成状态 -->
      <div v-if="genStatus" class="gen-status" :class="{ ok: genOk }">{{ genStatus }}</div>

      <!-- 流式输出 -->
      <div v-if="streamingText" class="card stream-card">
        <div class="section-title">📝 生成内容</div>
        <div class="stream-content" ref="streamRef">{{ streamingText }}</div>
      </div>
    </template>

    <!-- ==================== 润色 Tab ==================== -->
    <template v-if="activeTab === 'polish'">
      <!-- 输入方式选择 -->
      <div class="card">
        <div class="section-title">① 选择输入方式（二选一）</div>
        <div class="mode-radio-group">
          <label class="mode-radio" :class="{ active: polishMode === 'text' }">
            <input type="radio" v-model="polishMode" value="text" />
            <span>⌨️ 输入文本</span>
          </label>
          <label class="mode-radio" :class="{ active: polishMode === 'file' }">
            <input type="radio" v-model="polishMode" value="file" />
            <span>📄 上传文件</span>
          </label>
        </div>
      </div>

      <!-- 文本输入 -->
      <div v-if="polishMode === 'text'" class="card">
        <div class="section-title">② 输入需要润色的文本</div>
        <textarea v-model="polishText" class="textarea" rows="8" placeholder="粘贴需要润色的小说文本..."></textarea>
      </div>

      <!-- 文件上传 -->
      <div v-if="polishMode === 'file'" class="card">
        <div class="section-title">② 上传需要润色的 .txt 文件</div>
        <div class="upload-area" @click="$refs.polishFileInput.click()">
          <input ref="polishFileInput" type="file" accept=".txt" @change="handlePolishFile" style="display:none" />
          <div v-if="!polishFileName" class="upload-placeholder">
            <div class="upload-icon">📄</div>
            <div>点击选择 .txt 文件</div>
          </div>
          <div v-else class="upload-file-info">
            <div class="file-icon">📄</div>
            <div class="file-name">{{ polishFileName }}</div>
          </div>
        </div>
      </div>

      <!-- 润色方案 -->
      <div class="card">
        <div class="section-title">③ 润色方案</div>
        <div class="polish-presets">
          <span v-for="p in polishPresets" :key="p.label" class="preset-btn" :class="{ active: polishPrompt === p.prompt }" @click="polishPrompt = p.prompt">{{ p.label }}</span>
        </div>
        <textarea v-model="polishPrompt" class="textarea" rows="4" placeholder="自定义润色要求..."></textarea>
      </div>

      <!-- 去AI味选项 -->
      <div class="card">
        <div class="section-title">④ 附加选项</div>
        <label class="checkbox-row">
          <input type="checkbox" v-model="polishDoDeslop" />
          <span>润色完成后同步执行去AI味处理</span>
        </label>
      </div>

      <!-- 润色按钮 -->
      <button class="btn btn-primary btn-block btn-lg" :disabled="polishing || !polishReady" @click="startPolish">
        {{ polishing ? '⏳ 润色中...' : '✨ 开始润色' }}
      </button>
      <div v-if="!polishReady && !polishing" class="polish-hint">
        {{ polishMode === 'text' ? '请在上方输入需要润色的文本' : '请上传一个 .txt 文件' }}
      </div>

      <!-- 润色进度 -->
      <div v-if="polishing" class="card polish-stream-card">
        <div class="section-title">📝 润色进度</div>
        <div class="polish-status">{{ polishStatusText }}</div>
        <div class="polish-progress-bar" v-if="polishProgress > 0">
          <div class="progress-fill" :style="{ width: polishProgress + '%' }"></div>
        </div>
        <div class="polish-preview" v-if="polishedText">{{ polishedText.length > 300 ? polishedText.substring(0,300)+'...' : polishedText }}</div>
      </div>

      <!-- 润色完成 -->
      <div v-if="polishCompleted" class="card" style="text-align:center;">
        <div class="section-title">✅ 润色完成！共 {{ polishedText.length }} 字</div>
        <button class="btn btn-success btn-lg" @click="downloadPolish">📥 下载为 .txt 文件</button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useNovelStore } from '../stores/novel'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const novelStore = useNovelStore()
const authStore = useAuthStore()

const streamRef = ref(null)

// ---- Tab ----
const activeTab = ref('generate')

// ---- 生成 ----
const gender = ref('male')
const selectedType = ref('')

const fullTypes = ref({ male: [], female: [] })
const currentCats = computed(() => fullTypes.value[gender.value] || [])

const protagonistName = ref('')
const worldSetting = ref('')
const outline = ref('')
const genMode = ref('book')
const targetWordCount = ref(50000)

const generating = ref(false)
const genStatus = ref('')
const genOk = ref(false)
const streamingText = ref('')
const generatedOutline = ref('')
const outlineStreamingText = ref('')

const maxWordCount = computed(() => genMode.value === 'chapter' ? 20000 : 10000000)

const activePresets = computed(() => {
  if (genMode.value === 'book') return [{ label: '5万字', value: 50000 }, { label: '10万字', value: 100000 }, { label: '30万字', value: 300000 }, { label: '50万字', value: 500000 }]
  return [{ label: '1000字', value: 1000 }, { label: '2000字', value: 2000 }, { label: '3000字', value: 3000 }, { label: '5000字', value: 5000 }]
})

async function startGen() {
  if (!selectedType.value) return alert('请选择小说类型')
  generating.value = true; genStatus.value = ''; genOk.value = false
  streamingText.value = ''; outlineStreamingText.value = ''

  const params = {
    novelTypeId: selectedType.value,
    protagonistName: protagonistName.value,
    worldSetting: worldSetting.value,
    targetWordCount: targetWordCount.value,
    mode: genMode.value,
    outline: outline.value,
  }

  novelStore.startGeneration(params,
    (chunk) => { streamingText.value += chunk; scrollToBottom() },
    (event) => {
      if (event.type === 'outline') {
        outlineStreamingText.value = event.content
      } else if (event.type === 'novel_created') {
        genStatus.value = '大纲生成中...'
      } else if (event.type === 'status') {
        genStatus.value = event.message
      } else if (event.type === 'chapter_start') {
        genStatus.value = `正在生成 ${event.title || '第' + event.chapterNumber + '章'}...`
      } else if (event.type === 'completed') {
        genStatus.value = '✅ 生成完成！'; genOk.value = true; generating.value = false
      } else if (event.type === 'paused') {
        genStatus.value = '⏸️ 已暂停'; generating.value = false
      } else if (event.type === 'token_exhausted') {
        genStatus.value = '⚠️ Token 已用完，请充值'; generating.value = false
      }
    }
  )
}

function scrollToBottom() {
  nextTick(() => { if (streamRef.value) streamRef.value.scrollTop = streamRef.value.scrollHeight })
}

// ---- 润色 ----
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

const polishPresets = [
  { label: '默认润色', prompt: '请对以下小说文本进行润色优化：修正语病，优化用词，调整句式节奏，保留原文风格。直接输出润色后文本。' },
  { label: '精简文风', prompt: '请对以下文本进行精简润色：删除冗余描写，让句子更简洁有力，节奏更明快。保留核心剧情和人物对话。直接输出。' },
  { label: '华丽文风', prompt: '请对以下文本进行华丽风格润色：增加生动的细节描写和修辞手法，使用更丰富的词汇，提升文学性。直接输出。' },
  { label: '口语化', prompt: '请对以下文本进行口语化润色：让语言更自然、更像日常对话，减少书面化表达，增加接地气的用词。直接输出。' },
]

const polishReady = computed(() => {
  if (polishMode.value === 'text') return polishText.value.trim().length >= 1
  return polishFileContent.value.trim().length >= 1
})

function handlePolishFile(e) {
  const file = e.target.files?.[0]
  if (!file || !file.name.endsWith('.txt')) return alert('仅支持 .txt 文件')
  polishFileName.value = file.name
  const reader = new FileReader()
  reader.onload = () => { polishFileContent.value = reader.result }
  reader.readAsText(file, 'UTF-8')
}

function startPolish() {
  const text = polishMode.value === 'text' ? polishText.value : polishFileContent.value
  if (!text || text.trim().length < 10) return alert('请输入至少10个字符')

  polishing.value = true; polishCompleted.value = false
  polishedText.value = ''; polishStatusText.value = '正在润色...'
  polishProgress.value = 0

  let totalChunks = 0
  novelStore.startPolish(
    { text, polishPrompt: polishPrompt.value || undefined, doDeslop: polishDoDeslop.value },
    (chunk, isDeslop) => {
      polishedText.value += chunk
      totalChunks++
      polishProgress.value = Math.min(95, Math.round(totalChunks / 10))
      if (isDeslop) {
        polishStatusText.value = '正在执行去AI味处理...'
        polishProgress.value = 96
      } else {
        polishStatusText.value = '正在润色...'
      }
    },
    (event) => {
      if (event.type === 'completed') {
        polishStatusText.value = '✅ 润色完成！'
        polishProgress.value = 100
        polishCompleted.value = true
        polishing.value = false
      } else if (event.type === 'error') {
        polishStatusText.value = '❌ ' + event.message
        polishing.value = false
      }
    }
  )
}

function downloadPolish() {
  const blob = new Blob([polishedText.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `润色结果_${Date.now()}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(async () => {
  if (!authStore.isLoggedIn) { router.push('/login'); return }
  try {
    const data = await novelStore.fetchFullTypes()
    fullTypes.value = data
  } catch {}
})
</script>

<style scoped>
.generate-page { padding-top: var(--header-height); }

/* Tabs */
.tabs { display: flex; gap: 0; margin-bottom: 12px; background: var(--card-bg); border-radius: 10px; overflow: hidden; border: 1px solid var(--border-color); }
.tab { flex: 1; padding: 12px; text-align: center; font-size: 14px; font-weight: 600; cursor: pointer; border: none; background: transparent; font-family: inherit; transition: all 0.2s; color: var(--text-secondary); }
.tab.active { background: var(--primary-color); color: white; }
.tab:hover:not(.active) { background: #f5f5f5; }

/* 类型 */
.gender-tabs { display: flex; gap: 10px; margin-bottom: 14px; }
.gender-tabs button { flex: 1; padding: 10px; border: 2px solid var(--border-color); border-radius: 10px; font-size: 14px; font-weight: 600; background: #f8f8f8; cursor: pointer; font-family: inherit; transition: all 0.2s; }
.gender-tabs button.active { border-color: var(--primary-color); background: #fff5f0; }
.type-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; }
.type-card { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px 8px; border: 2px solid var(--border-color); border-radius: 10px; background: #f8f8f8; cursor: pointer; transition: all 0.15s; }
.type-card:hover { border-color: var(--primary-light); }
.type-card.selected { border-color: var(--primary-color); background: #fff5f0; }
.type-icon { font-size: 24px; }
.type-name { font-size: 12px; font-weight: 500; color: var(--text-secondary); text-align: center; }
.type-info { margin-top: 8px; font-size: 13px; color: var(--success-color); font-weight: 500; text-align: center; }

/* 模式 */
.mode-radio-group { display: flex; gap: 10px; }
.mode-radio { flex: 1; padding: 10px; border: 2px solid var(--border-color); border-radius: 10px; cursor: pointer; text-align: center; transition: all 0.15s; font-size: 14px; font-weight: 500; }
.mode-radio input { display: none; }
.mode-radio.active { border-color: var(--primary-color); background: #fff5f0; }
.word-count-input { display: flex; align-items: center; gap: 8px; }
.word-count-input .input { flex: 1; }
.unit { font-size: 14px; color: var(--text-secondary); }
.word-count-presets { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.preset-btn { padding: 4px 12px; border: 1px solid var(--border-color); border-radius: 14px; font-size: 12px; cursor: pointer; transition: all 0.15s; color: var(--text-secondary); }
.preset-btn.active { border-color: var(--primary-color); background: #fff5f0; color: var(--primary-color); font-weight: 600; }
.preset-btn:hover { border-color: var(--primary-color); }

/* 生成状态 */
.btn-lg { padding: 14px; font-size: 16px; }
.gen-status { margin-top: 10px; text-align: center; font-size: 14px; font-weight: 500; color: var(--error-color); }
.gen-status.ok { color: var(--success-color); }

/* 流式输出 */
.stream-card { max-height: 60vh; overflow-y: auto; }
.stream-content { white-space: pre-wrap; font-size: 14px; line-height: 1.8; color: var(--text-primary); }

/* 大纲流式 */
.outline-stream-card { background: #fff8f0; border-color: #ffd591; }
.outline-stream-text { white-space: pre-wrap; font-size: 13px; line-height: 1.6; color: var(--text-secondary); }
.outline-loading { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 13px; color: var(--text-light); }
.outline-loading .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--primary-color); animation: dotPulse 1.2s infinite; }
.outline-loading .dot:nth-child(2) { animation-delay: 0.2s; }
.outline-loading .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes dotPulse { 0%,80%,100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }

/* 润色 */
.upload-area { border: 2px dashed var(--border-color); border-radius: 12px; padding: 24px; text-align: center; cursor: pointer; transition: all 0.2s; background: #fafafa; }
.upload-area:hover { border-color: var(--primary-color); background: #fff5f0; }
.upload-placeholder { color: var(--text-secondary); }
.upload-icon { font-size: 36px; margin-bottom: 8px; }
.upload-file-info { display: flex; align-items: center; gap: 8px; justify-content: center; }
.file-icon { font-size: 24px; }
.file-name { font-size: 14px; font-weight: 500; color: var(--text-primary); }
.polish-stream-card { background: #f0f8ff; border-color: #91d5ff; }
.polish-status { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
.polish-preview { font-size: 13px; line-height: 1.6; color: var(--text-secondary); max-height: 200px; overflow-y: auto; background: #f8f8f8; padding: 10px; border-radius: 8px; white-space: pre-wrap; }
.polish-progress-bar { height: 6px; background: #e8e8e8; border-radius: 3px; margin-bottom: 10px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #1890ff, #40a9ff); border-radius: 3px; transition: width 0.3s ease; }
.checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
.checkbox-row input { width: 16px; height: 16px; cursor: pointer; }
.polish-presets { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
.btn-success { background: #52c41a; color: white; border: none; padding: 14px 24px; border-radius: 10px; font-size: 16px; cursor: pointer; font-family: inherit; }
.btn-success:hover { background: #73d13d; }
.polish-hint { text-align: center; font-size: 13px; color: var(--text-light); margin-top: 8px; }
</style>
