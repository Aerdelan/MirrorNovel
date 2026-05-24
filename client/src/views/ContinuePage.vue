<template>
  <div class="page-container continue-page">
    <!-- 导入小说区域 -->
    <div class="card">
      <div class="section-title">📄 导入小说</div>
      <div class="upload-bar">
        <label class="upload-btn">
          <input type="file" accept=".txt" @change="handleFileUpload" />
          <span>📂 上传 .txt 文件</span>
        </label>
        <span v-if="fileName" class="file-name">{{ fileName }}</span>
      </div>
      <div class="import-area">
        <textarea
          v-model="importedText"
          class="textarea"
          placeholder="或在此粘贴小说内容（至少50字）..."
          rows="8"
        ></textarea>
        <div class="import-hint">
          <span>已输入 {{ importedText.length }} 字</span>
          <span v-if="importedText.length < 50" style="color:var(--error-color);">（至少需要50字）</span>
        </div>
      </div>
    </div>

    <!-- 小说信息 -->
    <div class="card">
      <div class="section-title">📋 小说信息</div>
      <div class="form-group">
        <label>小说名称（可选）</label>
        <input v-model="title" class="input" placeholder="留空自动生成" maxlength="50" />
      </div>
      <div class="form-group">
        <label>小说风格类型</label>
        <select v-model="novelTypeName" class="input select-input">
          <option value="">请选择风格（选填）</option>
          <option v-for="t in novelStore.novelTypes" :key="t.id" :value="t.name">{{ t.icon }} {{ t.name }}</option>
          <option value="自定义">其他风格</option>
        </select>
      </div>
    </div>

    <!-- 续写要求 -->
    <div class="card">
      <div class="section-title">✍️ 续写要求</div>
      <textarea
        v-model="continuationRequest"
        class="textarea"
        placeholder="描述你希望续写的内容方向，例如：&#10;• 主角发现了新的线索，继续调查真相&#10;• 场景转换到异世界，展开新的冒险&#10;• 延续现在的风格自然发展剧情&#10;（选填，不填则由AI自由发挥）"
        rows="5"
      ></textarea>
    </div>

    <!-- 模式 + 字数设定 -->
    <div class="card">
      <div class="section-title">📏 续写模式 & 字数设定</div>
      <div class="mode-radio-group">
        <label class="mode-radio" :class="{ active: genMode === 'book' }">
          <input type="radio" v-model="genMode" value="book" />
          <span class="mode-icon">📚</span>
          <span class="mode-label">续写整本</span>
        </label>
        <label class="mode-radio" :class="{ active: genMode === 'chapter' }">
          <input type="radio" v-model="genMode" value="chapter" />
          <span class="mode-icon">📄</span>
          <span class="mode-label">续写一章</span>
        </label>
      </div>
      <div class="mode-tip">{{ genMode === 'book' ? '一次性续写整本的全部内容' : '本次只续写一个章节的内容' }}</div>
      <div class="word-count-input" style="margin-top:12px;">
        <input v-model.number="targetWordCount" class="input" type="number"
          :min="genMode === 'chapter' ? 500 : 1000"
          :max="genMode === 'chapter' ? 8000 : 1000000"
          step="500" />
        <span class="unit">字</span>
      </div>
      <div class="word-count-presets">
        <span v-for="p in activePresets" :key="p.value"
          class="preset-btn" :class="{ active: targetWordCount === p.value }"
          @click="targetWordCount = p.value">{{ p.label }}</span>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="card action-card">
      <button v-if="!isGenerating" class="btn btn-primary btn-block btn-generate"
        :disabled="importedText.length < 50" @click="startContinue">
        🚀 开始续写
      </button>
      <div v-else class="generating-status">
        <div class="generating-indicator">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          <span class="indicator-text">AI正在续写...</span>
        </div>
        <div class="word-count-progress">已生成 {{ wordCount }} 字</div>
        <button class="btn btn-outline btn-sm" @click="stopContinue">⏸ 暂停</button>
      </div>
    </div>

    <!-- 实时内容 -->
    <div v-if="novelStore.streamingText" class="card streaming-card">
      <div class="streaming-header">
        <span class="section-title">📖 续写内容</span>
        <span v-if="isGenerating" class="generating-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>
      </div>
      <div class="streaming-content" ref="streamingRef">
        <div class="content-text">{{ novelStore.streamingText }}</div>
        <div v-if="isGenerating" class="cursor-blink">|</div>
      </div>
    </div>

    <!-- 完成 -->
    <div v-if="generationDone" class="card done-card">
      <div class="done-icon">✅</div>
      <div class="done-text">续写完成！共 {{ wordCount }} 字</div>
      <button class="btn btn-primary btn-block" @click="goToBookshelf">📚 去书架查看</button>
    </div>

    <div style="height:20px;"></div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useNovelStore } from '../stores/novel'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const novelStore = useNovelStore()
const authStore = useAuthStore()

const importedText = ref('')
const title = ref('')
const novelTypeName = ref('')
const continuationRequest = ref('')
const fileName = ref('')
const continueNovelId = ref('')

/** 上传 .txt 文件后读取内容填入文本框 */
function handleFileUpload(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext !== 'txt') { alert('仅支持 .txt 文件'); return }
  fileName.value = file.name
  const reader = new FileReader()
  reader.onload = (ev) => {
    importedText.value = ev.target?.result || ''
  }
  reader.readAsText(file, 'UTF-8')
  // 重置 input 以便重复上传同一文件
  e.target.value = ''
}
const genMode = ref('book')
const targetWordCount = ref(30000)
const isGenerating = ref(false)
const generationDone = ref(false)
const wordCount = ref(0)
const streamingRef = ref(null)

const bookPresets = [
  { label: '1万字', value: 10000 },
  { label: '3万字', value: 30000 },
  { label: '5万字', value: 50000 },
  { label: '10万字', value: 100000 },
  { label: '20万字', value: 200000 },
  { label: '50万字', value: 500000 },
  { label: '100万字', value: 1000000 },
]
const chapterPresets = [
  { label: '500字', value: 500 },
  { label: '1000字', value: 1000 },
  { label: '2000字', value: 2000 },
  { label: '3000字', value: 3000 },
  { label: '5000字', value: 5000 },
  { label: '8000字', value: 8000 },
]
const activePresets = computed(() => genMode.value === 'book' ? bookPresets : chapterPresets)

watch(genMode, (mode) => {
  if (mode === 'chapter' && targetWordCount.value > 8000) targetWordCount.value = 3000
  if (mode === 'book' && targetWordCount.value < 10000) targetWordCount.value = 30000
})

onMounted(async () => {
  if (!authStore.isLoggedIn) { router.push('/login'); return }
  if (novelStore.novelTypes.length === 0) await novelStore.fetchNovelTypes()

  // 从书架跳转过来时，读取预填数据
  const prefill = novelStore.prefillContinue
  if (prefill) {
    importedText.value = prefill.importedText || ''
    title.value = prefill.title || ''
    novelTypeName.value = prefill.novelTypeName || ''
    continueNovelId.value = prefill.novelId || ''
    novelStore.clearPrefillContinue()
  }
})

watch(
  () => novelStore.streamingText,
  async () => { await nextTick(); if (streamingRef.value) streamingRef.value.scrollTop = streamingRef.value.scrollHeight }
)

async function startContinue() {
  if (importedText.value.length < 50) return
  isGenerating.value = true
  generationDone.value = false
  wordCount.value = 0
  novelStore.streamingText = ''

  try {
    if (continueNovelId.value) {
      // 从书架续写：使用 /continue/:novelId 接口，支持整本/单章模式
      await novelStore.continueGeneration(
        continueNovelId.value,
        (chunk, fullText) => { wordCount.value = fullText.length },
        (status) => {
          if (status.type === 'completed') { generationDone.value = true; isGenerating.value = false }
          else if (status.type === 'paused') { isGenerating.value = false }
          else if (status.type === 'error') { isGenerating.value = false }
        },
        genMode.value
      )
    } else {
      // 全新导入续写
      await novelStore.startImportContinue(
        {
          novelId: continueNovelId.value || undefined,
          importedText: importedText.value,
          continuationRequest: continuationRequest.value,
          novelTypeName: novelTypeName.value,
          title: title.value || undefined,
          targetWordCount: targetWordCount.value,
        },
        (chunk, fullText) => { wordCount.value = fullText.length },
        (status) => {
          if (status.type === 'completed') { generationDone.value = true; isGenerating.value = false }
          else if (status.type === 'paused') { isGenerating.value = false }
          else if (status.type === 'error') { isGenerating.value = false }
        }
      )
    }
  } catch (e) {
    isGenerating.value = false
    if (e.message === 'TOKEN_EXHAUSTED' || (e.message && e.message.includes('Token'))) {
      alert('当前token已消耗完毕，请加q群1019601998联系群主购买token')
    } else if (e.message !== 'paused') {
      alert('续写失败：' + e.message)
    }
  }
}

function stopContinue() {
  novelStore.stopGeneration()
  isGenerating.value = false
}

function goToBookshelf() { router.push('/bookshelf') }
</script>

<style scoped>
.continue-page { padding: 12px 0; }
.section-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; }

.import-area .textarea { min-height: 140px; font-family: inherit; }
.import-hint { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-light); margin-top: 6px; }

/* 文件上传 */
.upload-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.upload-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 8px 16px; border: 2px dashed var(--primary-color);
  border-radius: 8px; cursor: pointer; font-size: 13px; color: var(--primary-color);
  background: #fff5f0; transition: all 0.2s;
}
.upload-btn:hover { background: #ffe8d6; }
.upload-btn input { display: none; }
.file-name { font-size: 12px; color: var(--text-secondary); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.form-group { margin-bottom: 14px; }
.form-group label { display: block; font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-bottom: 6px; }
.select-input { appearance: auto; cursor: pointer; }

.word-count-input { display: flex; align-items: center; gap: 8px; }
.word-count-input .input { flex: 1; max-width: 150px; }
.unit { font-size: 15px; color: var(--text-secondary); }
.word-count-presets { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.preset-btn {
  padding: 4px 12px; border: 1px solid var(--border-color); border-radius: 16px;
  font-size: 12px; color: var(--text-secondary); cursor: pointer; transition: all 0.2s;
}
.preset-btn.active { border-color: var(--primary-color); color: var(--primary-color); background: #fff5f0; }

.action-card { text-align: center; }
.btn-generate { font-size: 18px; padding: 14px; }

.generating-status { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.word-count-progress { font-size: 13px; color: var(--text-secondary); }

.streaming-card { max-height: 400px; display: flex; flex-direction: column; }
.streaming-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.streaming-content {
  flex: 1; overflow-y: auto; max-height: 320px;
  background: #fafafa; border-radius: 8px; padding: 16px;
  line-height: 1.8; font-size: 14px; white-space: pre-wrap; word-wrap: break-word;
}
.content-text { display: inline; }
.cursor-blink { display: inline; animation: blink 0.8s step-end infinite; color: var(--primary-color); font-weight: bold; }
@keyframes blink { 50% { opacity: 0; } }

.done-card { text-align: center; background: linear-gradient(135deg, #f6ffed, #fff7e6); }
.done-icon { font-size: 40px; margin-bottom: 8px; }
.done-text { font-size: 16px; font-weight: 600; color: var(--success-color); margin-bottom: 12px; }

/* 模式选择 */
.mode-radio-group { display: flex; gap: 10px; margin-bottom: 8px; }
.mode-radio {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 12px; border: 2px solid var(--border-color); border-radius: 10px;
  cursor: pointer; transition: all 0.2s; background: #f8f8f8;
}
.mode-radio.active { border-color: var(--primary-color); background: #fff5f0; }
.mode-radio input { display: none; }
.mode-icon { font-size: 22px; }
.mode-label { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.mode-tip { font-size: 12px; color: var(--text-light); }
</style>
