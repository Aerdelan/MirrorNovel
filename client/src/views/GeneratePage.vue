<template>
  <div class="page-container generate-page">
    <!-- Tab 切换 -->
    <div class="tabs">
      <button class="tab" :class="{ active: activeTab === 'generate' }" @click="activeTab='generate'">{{ $t('generate.tabGen') }}</button>
      <button class="tab" :class="{ active: activeTab === 'lightnovel' }" @click="activeTab='lightnovel'">{{ $t('generate.tabLN') }}</button>
    </div>

    <!-- ==================== 生成 Tab ==================== -->
    <template v-if="activeTab === 'generate'">
      <div class="card">
        <div class="section-title">① {{ $t('generate.stepType') }}</div>
        <div class="gender-tabs">
          <button :class="{ active: gender === 'male' }" @click="gender='male'">{{ $t('generate.maleFreq') }}</button>
          <button :class="{ active: gender === 'female' }" @click="gender='female'">{{ $t('generate.femaleFreq') }}</button>
        </div>
        <div class="type-grid">
          <div v-for="cat in currentCats" :key="cat.name" class="type-card" :class="{ selected: selectedType === cat.name }" @click="selectedType = cat.name">
            <span class="type-icon">{{ cat.icon }}</span>
            <span class="type-name">{{ $tn(cat.name) }}</span>
          </div>
        </div>
        <div v-if="selectedType" class="type-info">{{ $t('generate.selectedType', { name: $tn(selectedType) }) }}</div>
      </div>

      <div class="card">
        <div class="section-title">② {{ $t('generate.stepChar') }}</div>
        <input v-model="protagonistName" class="input" :placeholder="$t('generate.placeholderName')" maxlength="20" />
      </div>

      <div class="card">
        <div class="section-title">③ {{ $t('generate.stepWorld') }}</div>
        <textarea v-model="worldSetting" class="textarea" :placeholder="$t('generate.placeholderWorld')" rows="4" @input="debounceMatchTemplates"></textarea>
        <!-- 类型模板匹配提示 -->
        <div v-if="matchedTemplates.length > 0" class="tmpl-match-card">
          <div class="tmpl-match-title">{{ $t('generate.tmplMatched') }}</div>
          <div class="tmpl-match-list">
            <div v-for="tmpl in matchedTemplates" :key="tmpl.name" class="tmpl-match-item">
              <span class="tmpl-name">{{ $tn(tmpl.name) || tmpl.name }}</span>
              <span class="tmpl-score" :class="scoreClass(tmpl.score)">{{ tmpl.score }}% {{ $t('generate.tmplMatch') }}</span>
            </div>
          </div>
          <div class="tmpl-match-hint">{{ $t('generate.tmplHint') }}</div>
        </div>
      </div>

      <!-- 上传参考小说 → 提取结构 -->
      <div class="card ref-struct-card">
        <div class="section-title">📄 上传参考小说（结构克隆）</div>
        <div class="ref-struct-desc">上传一本小说，AI 将提取其剧情结构、伏笔和世界观，用新名称重新生成</div>
        <div class="upload-bar">
          <input ref="structFileInput" type="file" accept=".txt" @change="handleStructFile" style="display:none" />
          <button class="btn btn-sm btn-outline" @click="$refs.structFileInput.click()">📁 选择文件</button>
          <span v-if="structFileName" class="file-name">{{ structFileName }}</span>
        </div>
        <button v-if="structRawText && !structAnalyzing && !structResult" class="btn btn-primary btn-sm btn-block" style="margin-top:8px;" @click="analyzeStructure">
          🔍 分析结构
        </button>
        <div v-if="structAnalyzing" class="struct-analyzing">
          <span class="loading-spinner" style="width:20px;height:20px;display:inline-block;"></span>
          <span style="margin-left:8px;">AI 正在分析剧情结构...</span>
        </div>
        <div v-if="structResult" class="struct-result">
          <div class="struct-preview">
            <div v-for="(section, idx) in structSections" :key="idx" class="struct-section">
              <div class="struct-section-title">{{ section.title }}</div>
              <div class="struct-section-body">{{ section.body.substring(0, 200) }}{{ section.body.length > 200 ? '...' : '' }}</div>
            </div>
          </div>
          <label class="checkbox-row" style="margin-top:8px;">
            <input type="checkbox" v-model="useStructureRef" />
            <span>✅ 在生成中使用此结构（名称已替换）</span>
          </label>
          <button class="btn btn-sm btn-outline" style="margin-top:4px;" @click="structResult='';structRawText=''">清除重新上传</button>
        </div>
      </div>

      <div v-if="genMode === 'book'" class="card">
        <div class="section-title">📋 {{ $t('generate.stepOutline') }}</div>
        <div v-if="generating && outlineStreamingText" class="outline-streaming">
          <div class="outline-loading">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
            <span>AI {{ $t('generate.statusGenerating') }}</span>
          </div>
          <div class="outline-preview">{{ generatedOutline || outline }}</div>
        </div>
        <textarea v-model="outline" class="textarea" rows="4" :placeholder="$t('generate.placeholderOutline')"></textarea>
      </div>

      <div v-if="genRefsLoaded" class="card gen-ref-card">
        <div class="section-title">{{ $t('generate.refMatch') }}</div>
        <div v-if="genFilteredRefs.length === 0" class="ln-ref-empty">
          <template v-if="selectedType">{{ $t('generate.refEmpty', { type: selectedType }) }}</template>
          <template v-else>{{ $t('generate.refSelectType') }}</template>
        </div>
        <div v-else>
          <div class="ln-ref-desc">{{ $t('generate.refAutoMatched', { count: genFilteredRefs.length, type: $tn(selectedType) }) }}</div>
          <div class="ln-ref-list">
            <div v-for="ref in genFilteredRefs" :key="ref._id" class="ln-ref-item" :class="{ selected: genSelectedRefs.includes(ref._id) }" @click="toggleGenRef(ref._id)">
              <div class="ref-check">{{ genSelectedRefs.includes(ref._id) ? '☑️' : '⬜' }}</div>
              <div class="ref-info">
                <div class="ref-title">{{ ref.title }}</div>
                <div class="ref-meta">{{ ref.mainCategory }} · {{ $t('refList.qualityScore') }} {{ ref.qualityScore || '-' }}</div>
              </div>
            </div>
          </div>
          <div v-if="genSelectedRefs.length > 0" class="ref-count">{{ $t('generate.refSelected', { count: genSelectedRefs.length }) }}</div>
        </div>
      </div>

      <div class="card">
        <div class="section-title">④ {{ $t('generate.stepMode') }}</div>
        <div class="mode-radio-group">
          <label class="mode-radio" :class="{ active: genMode === 'book' }">
            <input type="radio" v-model="genMode" value="book" />
            <span class="mode-icon">📚</span><span class="mode-label">{{ $t('generate.modeBook') }}</span>
          </label>
          <label class="mode-radio" :class="{ active: genMode === 'chapter' }">
            <input type="radio" v-model="genMode" value="chapter" />
            <span class="mode-icon">📄</span><span class="mode-label">{{ $t('generate.modeChapter') }}</span>
          </label>
        </div>
        <div class="word-count-input" style="margin-top:12px;">
          <input v-model.number="targetWordCount" class="input" type="number" :min="genMode==='chapter'?500:1000" :max="genMode==='chapter'?20000:10000000" step="500" />
          <span class="unit">{{ $t('generate.wordShort') }}</span>
        </div>
        <div class="word-count-presets">
          <span v-for="p in activePresets" :key="p.value" class="preset-btn" :class="{ active: targetWordCount === p.value }" @click="targetWordCount = p.value">{{ p.label }}</span>
        </div>
      </div>

      <button class="btn btn-primary btn-block btn-lg" :disabled="generating || !selectedType" @click="startGen">
        {{ generating ? $t('generate.btnGenerating') : $t('generate.btnGenerate') }}
      </button>

      <div v-if="generating && outlineStreamingText" class="card outline-stream-card">
        <div class="section-title">📋 {{ $t('generate.statusGenerating') }}</div>
        <div class="outline-stream-text">{{ outlineStreamingText }}</div>
      </div>

      <div v-if="genStatus" class="gen-status" :class="{ ok: genOk }">{{ genStatus }}</div>

      <div v-if="streamingText" class="card stream-card">
        <div class="section-title">📝 {{ $t('generate.modeBook') }}</div>
        <div class="stream-content" ref="streamRef">{{ streamingText }}</div>
      </div>
    </template>

    <!-- ==================== 轻小说 Tab ==================== -->
    <template v-if="activeTab === 'lightnovel'">
      <div class="card">
        <div class="section-title">① {{ $t('generate.lnStepType') }}</div>
        <div class="type-grid ln-grid">
          <div v-for="t in lnTypes" :key="t.id" class="type-card" :class="{ selected: lnSelectedType === t.id }" @click="lnSelectedType = t.id">
            <span class="type-icon">{{ t.icon }}</span>
            <span class="type-name">{{ $tn(t.name) }}</span>
          </div>
        </div>
        <div v-if="lnSelectedType" class="type-info">{{ $t('generate.selectedType', { name: $tn(lnTypes.find(t=>t.id===lnSelectedType)?.name) }) }}</div>
      </div>

      <div class="card">
        <div class="section-title">② {{ $t('generate.lnStepChar') }}</div>
        <input v-model="lnCharName" class="input" :placeholder="$t('generate.lnPlaceholderName')" maxlength="20" />
        <div class="ln-trait-section" style="margin-top:10px;">
          <div class="label-sm">{{ $t('generate.lnCharTrait') }}</div>
          <div class="ln-traits">
            <span v-for="trait in lnTraits" :key="trait" class="preset-btn" :class="{ active: lnCharTrait === trait }" @click="lnCharTrait = (lnCharTrait === trait ? '' : trait)">{{ $tt(trait) }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="section-title">③ {{ $t('generate.lnStepWorld') }}</div>
        <textarea v-model="lnWorldSetting" class="textarea" rows="4" :placeholder="$t('generate.lnPlaceholderWorld')"></textarea>
      </div>

      <div v-if="lnRefsLoaded" class="card ln-ref-card">
        <div class="section-title">{{ $t('generate.refMatch') }}</div>
        <div v-if="lnFilteredRefs.length === 0" class="ln-ref-empty">
          <template v-if="lnSelectedType">{{ $t('generate.refEmpty', { type: $tn(lnTypes.find(t=>t.id===lnSelectedType)?.name) }) }}</template>
          <template v-else>{{ $t('generate.refSelectType') }}</template>
        </div>
        <div v-else>
          <div class="ln-ref-desc">{{ $t('generate.refAutoMatched', { count: lnFilteredRefs.length, type: $tn(lnTypes.find(t=>t.id===lnSelectedType)?.name) }) }}</div>
          <div class="ln-ref-list">
            <div v-for="ref in lnFilteredRefs" :key="ref._id" class="ln-ref-item" :class="{ selected: lnSelectedRefs.includes(ref._id) }" @click="toggleRef(ref._id)">
              <div class="ref-check">{{ lnSelectedRefs.includes(ref._id) ? '☑️' : '⬜' }}</div>
              <div class="ref-info">
                <div class="ref-title">{{ ref.title }}</div>
                <div class="ref-meta">{{ ref.mainCategory }} · {{ $t('refList.qualityScore') }} {{ ref.qualityScore || '-' }}</div>
              </div>
            </div>
          </div>
          <div v-if="lnSelectedRefs.length > 0" class="ref-count">{{ $t('generate.refSelected', { count: lnSelectedRefs.length }) }}</div>
        </div>
      </div>

      <div class="card">
        <div class="section-title">④ {{ $t('generate.lnStepMode') }}</div>
        <div class="mode-radio-group">
          <label class="mode-radio" :class="{ active: lnGenMode === 'book' }">
            <input type="radio" v-model="lnGenMode" value="book" />
            <span>{{ $t('generate.modeBook') }}</span>
          </label>
          <label class="mode-radio" :class="{ active: lnGenMode === 'chapter' }">
            <input type="radio" v-model="lnGenMode" value="chapter" />
            <span>{{ $t('generate.modeChapter') }}</span>
          </label>
        </div>
        <div class="word-count-input" style="margin-top:12px;">
          <input v-model.number="lnTargetWordCount" class="input" type="number" :min="lnGenMode==='chapter'?500:1000" :max="lnGenMode==='chapter'?20000:10000000" step="500" />
          <span class="unit">{{ $t('generate.wordShort') }}</span>
        </div>
        <div class="word-count-presets">
          <span v-for="p in lnActivePresets" :key="p.value" class="preset-btn" :class="{ active: lnTargetWordCount === p.value }" @click="lnTargetWordCount = p.value">{{ p.label }}</span>
        </div>
      </div>

      <button class="btn btn-primary btn-block btn-lg" :disabled="lnGenerating || !lnSelectedType" @click="startLNGen">
        {{ lnGenerating ? $t('generate.btnGenerating') : $t('generate.lnBtnGenerate') }}
      </button>

      <div v-if="lnStatus" class="gen-status" :class="{ ok: lnOk }">{{ lnStatus }}</div>

      <div v-if="lnStreamingText" class="card stream-card">
        <div class="section-title">📝 {{ $t('generate.lnBtnGenerate') }}</div>
        <div class="stream-content" ref="lnStreamRef">{{ lnStreamingText }}</div>
      </div>
    </template>

    <!-- ==================== 大纲预览/编辑弹窗 ==================== -->
    <Teleport to="body">
      <div v-if="outlineModal" class="modal-overlay" @click.self="outlineModal=false">
        <div class="outline-modal-card">
          <h3 class="outline-modal-title">{{ $t('generate.outlinePreview') }}</h3>
          <p class="outline-modal-desc">{{ $t('generate.outlineDesc') }}</p>
          <textarea v-model="outlineModalText" class="outline-modal-textarea" rows="12"></textarea>
          <div class="outline-modal-actions">
            <button class="btn btn-outline" @click="outlineModal=false; outlineReject()">{{ $t('common.cancel') }}</button>
            <button class="btn btn-primary" @click="outlineConfirm()">{{ $t('generate.outlineConfirm') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useNovelStore } from '../stores/novel'
import { useAuthStore } from '../stores/auth'
import { useReferenceStore } from '../stores/reference'
import { useI18n } from '../composables/useI18n'
import api from '../api'

const router = useRouter()
const novelStore = useNovelStore()
const authStore = useAuthStore()
const refStore = useReferenceStore()
const { $t } = useI18n()

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

// ---- 参考小说结构克隆 ----
const structFileInput = ref(null)
const structFileName = ref('')
const structRawText = ref('')
const structAnalyzing = ref(false)
const structResult = ref('')
const useStructureRef = ref(false)
const structSections = computed(() => {
  if (!structResult.value) return []
  const lines = structResult.value.split('\n')
  const sections = []
  let current = null
  for (const line of lines) {
    const m = line.match(/^【(.+?)】/)
    if (m) {
      if (current) sections.push(current)
      current = { title: m[1], body: '' }
    } else if (current) {
      current.body += line + '\n'
    }
  }
  if (current) sections.push(current)
  return sections
})

const generating = ref(false)
const genStatus = ref('')
const genOk = ref(false)
const streamingText = ref('')
const generatedOutline = ref('')
const outlineStreamingText = ref('')

// 类型模板匹配
const matchedTemplates = ref([])
const tmplMatching = ref(false)
let tmplTimer = null

async function matchTemplates() {
  const ws = worldSetting.value?.trim()
  const st = selectedType.value
  if (!ws || ws.length < 5) { matchedTemplates.value = []; return }
  tmplMatching.value = true
  try {
    const res = await api.post('/novel/match-templates', { worldSetting: ws, novelTypeId: st })
    matchedTemplates.value = res.data.matched || []
  } catch {
    matchedTemplates.value = []
  }
  tmplMatching.value = false
}
function debounceMatchTemplates() {
  clearTimeout(tmplTimer)
  tmplTimer = setTimeout(matchTemplates, 800)
}
function scoreClass(s) { if (!s) return ''; if (s >= 60) return 'high'; if (s >= 35) return 'mid'; return 'low' }

// ---- 参考小说结构克隆 ----
function handleStructFile(e) {
  const file = e.target.files?.[0]
  if (!file || !file.name.endsWith('.txt')) return alert('请选择 .txt 文件')
  structFileName.value = file.name
  structRawText.value = ''
  structResult.value = ''
  useStructureRef.value = false
  const reader = new FileReader()
  reader.onload = () => { structRawText.value = reader.result }
  reader.readAsText(file, 'UTF-8')
}

async function analyzeStructure() {
  if (!structRawText.value || structRawText.value.length < 100) return alert('小说内容太短（至少100字）')
  structAnalyzing.value = true
  const token = localStorage.getItem('token')
  try {
    const formData = new FormData()
    formData.append('file', new Blob([structRawText.value], { type: 'text/plain' }), structFileName.value || 'ref.txt')
    const res = await fetch('/api/novel/analyze-structure', {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || '分析失败')
    structResult.value = data.structure
  } catch (e) {
    alert('结构分析失败: ' + e.message)
  }
  structAnalyzing.value = false
}

// 监听类型切换时重新匹配
watch(selectedType, () => { matchTemplates() })

// 大纲预览弹窗
const outlineModal = ref(false)
const outlineModalText = ref('')
let outlineConfirmCallback = null
let outlineRejectCallback = null

async function generateOutline(selectedTypeId, charName, worldSetting, wordCount) {
  try {
    const res = await api.post('/novel/generate-outline', {
      novelTypeId: selectedTypeId,
      protagonistName: charName,
      worldSetting: worldSetting,
      targetWordCount: wordCount,
    })
    return res.data.outline || ''
  } catch (e) {
    console.error('大纲生成失败:', e)
    return ''
  }
}

async function showOutlineModal(selectedTypeId, charName, worldSetting, wordCount) {
  genStatus.value = $t('generate.outlineGenerating')
  const outline = await generateOutline(selectedTypeId, charName, worldSetting, wordCount)
  if (!outline) {
    genStatus.value = ''
    return null
  }
  return new Promise((resolve) => {
    outlineModalText.value = outline
    outlineConfirmCallback = () => { outlineModal.value = false; resolve(outlineModalText.value) }
    outlineRejectCallback = () => { outlineModal.value = false; genStatus.value = ''; resolve(null) }
    outlineModal.value = true
  })
}

function outlineConfirm() {
  if (outlineConfirmCallback) outlineConfirmCallback()
}
function outlineReject() {
  if (outlineRejectCallback) outlineRejectCallback()
}

const maxWordCount = computed(() => genMode.value === 'chapter' ? 20000 : 10000000)

const activePresets = computed(() => {
  if (genMode.value === 'book') return [{ label: '5万字', value: 50000 }, { label: '10万字', value: 100000 }, { label: '30万字', value: 300000 }, { label: '50万字', value: 500000 }]
  return [{ label: '1000字', value: 1000 }, { label: '2000字', value: 2000 }, { label: '3000字', value: 3000 }, { label: '5000字', value: 5000 }]
})

async function startGen() {
  if (!selectedType.value) return alert('请选择小说类型')

  // 如果没有填写大纲且是整本模式，先生成大纲让用户确认
  if (!outline.value.trim() && genMode.value === 'book') {
    const confirmedOutline = await showOutlineModal(selectedType.value, protagonistName.value, worldSetting.value, targetWordCount.value)
    if (!confirmedOutline) return // 用户取消或生成失败
    outline.value = confirmedOutline
  }

  generating.value = true; genStatus.value = ''; genOk.value = false
  streamingText.value = ''; outlineStreamingText.value = ''

  const params = {
    novelTypeId: selectedType.value,
    protagonistName: protagonistName.value,
    worldSetting: worldSetting.value,
    targetWordCount: targetWordCount.value,
    mode: genMode.value,
    outline: outline.value,
    referenceIds: genSelectedRefs.value.length > 0 ? genSelectedRefs.value : undefined,
    structureRef: useStructureRef.value && structResult.value ? structResult.value : undefined,
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

// ---- 轻小说 ----
const lnTypes = ref([
  { id: 'lightnovel_isekai', name: '异世界转生', icon: '🌍' },
  { id: 'lightnovel_school', name: '校园恋爱', icon: '🏫' },
  { id: 'lightnovel_fantasy', name: '奇幻冒险', icon: '⚔️' },
  { id: 'lightnovel_slice', name: '日常系', icon: '☕' },
  { id: 'lightnovel_battle', name: '战斗异能', icon: '💥' },
  { id: 'lightnovel_scifi', name: '科幻未来', icon: '🤖' },
])
const lnSelectedType = ref('')
const lnCharName = ref('')
const lnCharTrait = ref('')
const lnWorldSetting = ref('')
const lnGenMode = ref('book')
const lnTargetWordCount = ref(50000)
const lnGenerating = ref(false)
const lnStatus = ref('')
const lnOk = ref(false)
const lnStreamingText = ref('')
const lnStreamRef = ref(null)

// ---- 生成小说 - 参考库匹配 ----
const genRefs = ref([])
const genRefsLoaded = ref(false)
const genSelectedRefs = ref([])

const genFilteredRefs = computed(() => {
  if (!selectedType.value) return []
  return genRefs.value.filter(r => r.mainCategory === selectedType.value)
})

watch(selectedType, () => {
  genSelectedRefs.value = genFilteredRefs.value.map(r => r._id)
})

function toggleGenRef(id) {
  const idx = genSelectedRefs.value.indexOf(id)
  if (idx > -1) genSelectedRefs.value.splice(idx, 1)
  else genSelectedRefs.value.push(id)
}

// ---- 轻小说 ----
// 轻小说类型ID → 蒸馏库 mainCategory 名称映射
const lnTypeToCat = {
  lightnovel_isekai: '异世界转生',
  lightnovel_school: '校园恋爱',
  lightnovel_fantasy: '奇幻冒险',
  lightnovel_slice: '日常系',
  lightnovel_battle: '战斗异能',
  lightnovel_scifi: '科幻未来',
}

// 参考库匹配
const lnRefs = ref([])
const lnRefsLoaded = ref(false)
const lnSelectedRefs = ref([])

// 根据已选轻小说类型自动过滤匹配的参考
const lnFilteredRefs = computed(() => {
  if (!lnSelectedType.value) return []
  const catName = lnTypeToCat[lnSelectedType.value]
  if (!catName) return []
  return lnRefs.value.filter(r => r.mainCategory === catName)
})

// 切换类型时自动选中匹配的参考
watch(lnSelectedType, () => {
  lnSelectedRefs.value = lnFilteredRefs.value.map(r => r._id)
})

function toggleRef(id) {
  const idx = lnSelectedRefs.value.indexOf(id)
  if (idx > -1) lnSelectedRefs.value.splice(idx, 1)
  else lnSelectedRefs.value.push(id)
}

const lnTraits = ['元气', '冷酷', '温柔', '傲娇', '天然呆', '腹黑', '高冷', '治愈', '热血', '神秘', '活泼', '冷静']

const lnActivePresets = computed(() => {
  if (lnGenMode.value === 'book') return [{ label: '5万字', value: 50000 }, { label: '10万字', value: 100000 }, { label: '30万字', value: 300000 }, { label: '50万字', value: 500000 }]
  return [{ label: '1000字', value: 1000 }, { label: '2000字', value: 2000 }, { label: '3000字', value: 3000 }, { label: '5000字', value: 5000 }]
})

async function startLNGen() {
  if (!lnSelectedType.value) return alert('请选择轻小说类型')

  // 轻小说整本模式：先生成大纲
  let lnOutline = ''
  if (lnGenMode.value === 'book') {
    const lnTypeObj = lnTypes.find(t => t.id === lnSelectedType.value)
    const lnName = lnTypeObj?.name || ''
    const lnChar = (lnCharName.value + (lnCharTrait.value ? `（${lnCharTrait.value}属性）` : '')).trim() || '未命名'
    const lnWorld = lnWorldSetting.value || `${lnName}题材的日式轻小说世界`
    const confirmedOutline = await showOutlineModal(lnSelectedType.value, lnChar, lnWorld, lnTargetWordCount.value)
    if (!confirmedOutline) return
    lnOutline = confirmedOutline
  }

  lnGenerating.value = true; lnStatus.value = ''; lnOk.value = false
  lnStreamingText.value = ''

  const traitDesc = lnCharTrait.value ? `（${lnCharTrait.value}属性）` : ''
  const params = {
    novelTypeId: lnSelectedType.value,
    protagonistName: (lnCharName.value + traitDesc).trim() || '未命名',
    worldSetting: lnWorldSetting.value || (() => {
      const type = lnTypes.find(t => t.id === lnSelectedType.value)
      return type ? `${type.name}题材的日式轻小说世界` : '日式轻小说世界'
    })(),
    targetWordCount: lnTargetWordCount.value,
    mode: lnGenMode.value,
    outline: lnOutline,
    referenceIds: lnSelectedRefs.value.length > 0 ? lnSelectedRefs.value : undefined,
    structureRef: useStructureRef.value && structResult.value ? structResult.value : undefined,
  }

  novelStore.startGeneration(params,
    (chunk) => { lnStreamingText.value += chunk; lnScrollToBottom() },
    (event) => {
      if (event.type === 'outline') {
        lnStatus.value = '大纲生成中...'
      } else if (event.type === 'novel_created') {
        lnStatus.value = '大纲生成中...'
      } else if (event.type === 'status') {
        lnStatus.value = event.message
      } else if (event.type === 'chapter_start') {
        lnStatus.value = `正在生成 ${event.title || '第' + event.chapterNumber + '章'}...`
      } else if (event.type === 'completed') {
        lnStatus.value = '✅ 生成完成！'; lnOk.value = true; lnGenerating.value = false
      } else if (event.type === 'paused') {
        lnStatus.value = '⏸️ 已暂停'; lnGenerating.value = false
      } else if (event.type === 'token_exhausted') {
        lnStatus.value = '⚠️ Token 已用完，请充值'; lnGenerating.value = false
      }
    }
  )
}

function lnScrollToBottom() {
  nextTick(() => { if (lnStreamRef.value) lnStreamRef.value.scrollTop = lnStreamRef.value.scrollHeight })
}

onMounted(async () => {
  if (!authStore.isLoggedIn) { router.push('/login'); return }
  try {
    const data = await novelStore.fetchFullTypes()
    fullTypes.value = data
  } catch {}
  // 加载普通小说参考库
  try {
    const refs = await refStore.fetchByType('normal')
    genRefs.value = refs.filter(r => r.aiProcessed && r.styleProfile && r.styleProfile !== '风格提取中...')
  } catch {}
  genRefsLoaded.value = true
  // 加载轻小说参考库
  try {
    const refs = await refStore.fetchLightNovelRefs()
    lnRefs.value = refs.filter(r => r.aiProcessed && r.styleProfile && r.styleProfile !== '风格提取中...')
  } catch {}
  lnRefsLoaded.value = true
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

/* 生成小说参考 */
.gen-ref-card { border-color: #91d5ff; background: #f0f8ff; }

/* 轻小说 */
.ln-grid { grid-template-columns: repeat(3,1fr) !important; }
.ln-trait-section .label-sm { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; font-weight: 500; }
.ln-traits { display: flex; gap: 6px; flex-wrap: wrap; }
.ln-traits .preset-btn { font-size: 13px; }

/* 参考风格匹配 */
.ln-ref-card { border-color: #b7eb8f; background: #f6ffed; }
.ln-ref-desc { font-size: 12px; color: var(--text-light); margin-bottom: 10px; }
.ln-ref-empty { font-size: 13px; color: var(--text-light); text-align: center; padding: 16px; }
.ln-ref-list { display: flex; flex-direction: column; gap: 6px; max-height: 240px; overflow-y: auto; }
.ln-ref-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 8px; cursor: pointer; transition: all 0.15s; background: #fff; }
.ln-ref-item:hover { border-color: var(--primary-color); }
.ln-ref-item.selected { border-color: #52c41a; background: #f6ffed; }
.ref-check { font-size: 16px; flex-shrink: 0; }
.ref-info { min-width: 0; }
.ref-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.ref-meta { font-size: 11px; color: var(--text-light); margin-top: 1px; }
.ref-count { margin-top: 8px; font-size: 12px; color: var(--success-color); font-weight: 500; text-align: center; }

/* 模板匹配 */
.tmpl-match-card { margin-top: 10px; padding: 10px 12px; background: #f0f8ff; border: 1px solid #91d5ff; border-radius: 8px; }
.tmpl-match-title { font-size: 12px; font-weight: 600; color: #1890ff; margin-bottom: 6px; }
.tmpl-match-list { display: flex; flex-direction: column; gap: 4px; }
.tmpl-match-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.tmpl-name { font-weight: 500; color: var(--text-primary); }
.tmpl-score { font-size: 11px; padding: 1px 6px; border-radius: 4px; font-weight: 600; }
.tmpl-score.high { background: #f6ffed; color: #52c41a; }
.tmpl-score.mid { background: #fff7e6; color: #fa8c16; }
.tmpl-score.low { background: #fff1f0; color: #ff4d4f; }
.tmpl-match-hint { font-size: 11px; color: var(--text-light); margin-top: 6px; }

/* 大纲预览弹窗 */
.modal-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; animation: fadeIn 0.2s; }
.outline-modal-card { background: var(--card-bg); border-radius: 16px; padding: 24px; width: 90%; max-width: 600px; }
.outline-modal-title { font-size: 17px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px; }
.outline-modal-desc { font-size: 13px; color: var(--text-light); margin-bottom: 14px; }
.outline-modal-textarea { width: 100%; min-height: 300px; padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 13px; line-height: 1.6; resize: vertical; font-family: inherit; box-sizing: border-box; }
.outline-modal-actions { display: flex; gap: 10px; margin-top: 16px; justify-content: flex-end; }
.outline-modal-actions .btn { min-width: 100px; text-align: center; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

/* 参考小说结构克隆 */
.ref-struct-card { border: 1px solid #b7eb8f; background: #f6ffed; }
.ref-struct-desc { font-size: 12px; color: var(--text-light); margin-bottom: 10px; line-height: 1.5; }
.ref-struct-card .upload-bar { display: flex; align-items: center; gap: 8px; }
.ref-struct-card .file-name { font-size: 12px; color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.struct-analyzing { display: flex; align-items: center; margin-top: 8px; font-size: 13px; color: var(--text-secondary); }
.struct-result { margin-top: 8px; }
.struct-preview { max-height: 300px; overflow-y: auto; background: #fafafa; border-radius: 8px; padding: 10px; }
.struct-section { margin-bottom: 10px; }
.struct-section:last-child { margin-bottom: 0; }
.struct-section-title { font-size: 13px; font-weight: 600; color: var(--primary-color); margin-bottom: 4px; }
.struct-section-body { font-size: 12px; color: var(--text-secondary); line-height: 1.6; white-space: pre-wrap; }
</style>
