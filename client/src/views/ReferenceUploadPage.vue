<template>
  <div class="page-container ref-upload-page">
    <div class="page-header">
      <span>{{ $t('distill.title') }}</span>
      <button class="btn btn-sm btn-outline header-btn" @click="$router.push('/reference-list')">
        {{ $t('distill.myLib') }}
      </button>
    </div>

    <div class="upload-content">
      <!-- === 小说类型切换 === -->
      <div class="card ln-toggle-card">
        <div class="section-title">① {{ $t('distill.stepDistillType') }}</div>
        <div class="novel-type-toggle">
          <button class="toggle-btn" :class="{ active: novelType === 'normal' }" @click="novelType='normal'">
            {{ $t('distill.normalNovel') }}
          </button>
          <button class="toggle-btn" :class="{ active: novelType === 'lightnovel' }" @click="novelType='lightnovel'">
            {{ $t('distill.lightNovel') }}
          </button>
        </div>
        <div v-if="novelType === 'lightnovel'" class="ln-type-hint">
          {{ $t('distill.lnHint') }}
        </div>
      </div>

      <div class="card">
        <div class="section-title">② {{ $t('distill.stepCategory', { type: novelType === 'lightnovel' ? '轻小说' : '小说' }) }}</div>

        <template v-if="novelType === 'normal'">
          <div class="gender-tabs">
            <button :class="{ active: gender === 'male' }" @click="gender='male'">{{ $t('generate.maleFreq') }}</button>
            <button :class="{ active: gender === 'female' }" @click="gender='female'">{{ $t('generate.femaleFreq') }}</button>
          </div>
        </template>

        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input v-model="searchQuery" class="input" :placeholder="$t('distill.searchPlaceholder')" />
          <button v-if="searchQuery" class="search-clear" @click="searchQuery=''">✕</button>
        </div>

        <!-- 主分类 -->
        <div class="main-categories" ref="mainCatRef">
          <button
            v-for="cat in filteredMainCats"
            :key="cat.name"
            class="main-cat-btn"
            :class="{ active: mainCategory === cat.name }"
            @click="selectMain(cat)"
          >
            <span class="main-cat-icon">{{ cat.icon }}</span>
            <span class="main-cat-name">{{ $tn(cat.name) }}</span>
          </button>
        </div>

        <div v-if="currentChildren.length > 0" class="sub-categories">
          <div class="sub-label">{{ $t('distill.subCategory') }}</div>
          <div class="sub-chips">
            <span
              v-for="sub in currentChildren"
              :key="sub"
              class="chip"
            :class="{ active: subCategory === sub }"
            @click="subCategory = subCategory === sub ? '' : sub"
            >{{ $tn(sub) }}</span>
          </div>
        </div>

        <!-- 共用标签 -->
        <div v-if="commonTags.length > 0" class="tag-section">
          <div class="sub-label">{{ $t('distill.tags') }}</div>
          <div class="sub-chips">
            <span
              v-for="tag in filteredTags"
              :key="tag"
              class="chip tag-chip"
              :class="{ active: selectedTags.includes(tag) }"
              @click="toggleTag(tag)"
            >{{ $tt(tag) }}</span>
          </div>
        </div>

        <!-- 已选 -->
        <div v-if="selectedDisplay" class="selected-info">
          ✅ {{ selectedDisplay }}
        </div>
      </div>

      <!-- === Cookie 设置（用于解锁番茄 VIP/锁定章节） === -->
      <div class="card cookie-card">
        <div class="section-title">🔑 番茄小说 Cookie 设置</div>
        <div class="fanqie-desc">
          从 Chrome F12 复制 Cookie 填入，解锁锁定章节下载。
          <span class="cookie-help" @click="showCookieHelp = !showCookieHelp">❓如何获取</span>
        </div>
        <div v-if="showCookieHelp" class="cookie-tips">
          <div>1. Chrome 打开 <code>https://fanqienovel.com</code> 并登录</div>
          <div>2. 按 F12 → Application → Cookies → fanqienovel.com</div>
          <div>3. 右键任意 cookie → "显示以 URL 编码"</div>
          <div>4. 全选复制所有 cookie 文本，粘贴到下方输入框</div>
          <div>或：刷新页面 → 控制台输入 <code>document.cookie</code> → 复制结果</div>
        </div>
        <div class="fanqie-input-row">
          <input v-model="cookieInput" class="input" placeholder="粘贴 document.cookie 内容" />
          <button class="btn btn-cookie btn-sm" :disabled="!cookieInput || cookieSaving" @click="saveCookie">
            {{ cookieSaving ? '⏳' : '💾 保存' }}
          </button>
        </div>
        <div class="cookie-status-row">
          <span v-if="cookieStatusRef.configured" class="cookie-ok">✅ Cookie 已配置（{{ cookieStatusRef.length }} 字符）</span>
          <span v-else class="cookie-none">⚠️ 未配置 Cookie，锁定章节无法下载</span>
          <button v-if="cookieStatusRef.configured" class="btn btn-sm btn-text" @click="clearCookie">清除</button>
        </div>
      </div>

      <!-- === Step 2a: 从番茄小说导入 === -->
      <div class="card fanqie-card">
        <div class="section-title">② 从番茄小说导入</div>
        <div class="fanqie-desc">输入番茄小说的 Book ID，自动获取书名和类型</div>
        <div class="fanqie-input-row">
          <input v-model="fanqieBookId" class="input" placeholder="输入番茄小说 Book ID" @change="previewFanqieBook" />
          <button class="btn btn-primary btn-sm" :disabled="!fanqieBookId || fanqieImporting" @click="startFanqieImport">
            {{ fanqieImporting ? '⏳' : '📥 蒸馏导入' }}
          </button>
        </div>

        <!-- 预览信息 -->
        <div v-if="fanqiePreviewData" class="fanqie-preview">
          <div class="preview-row"><span class="preview-label">书名</span><span class="preview-val">{{ fanqiePreviewData.title }}</span></div>
          <div class="preview-row"><span class="preview-label">标签</span>
            <span v-if="fanqiePreviewData.labels?.length" class="preview-val">{{ fanqiePreviewData.labels.join('、') }}</span>
            <span v-else class="preview-hint">未获取到</span>
          </div>
          <div class="preview-row"><span class="preview-label">章节</span><span class="preview-val">{{ fanqiePreviewData.chapterCount }} 章</span></div>
        </div>
        <div v-if="fanqiePreviewLoading" class="fanqie-progress">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          <span class="fanqie-progress-text">正在获取书籍信息...</span>
        </div>

        <div v-if="fanqieImporting" class="fanqie-progress">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          <span class="fanqie-progress-text">{{ fanqieStatus }}</span>
        </div>
        <div v-if="fanqieMsg" class="status-msg" :class="{ ok: fanqieOk }">{{ fanqieMsg }}</div>
      </div>

      <!-- === Step 2b: 番茄小说下载 === -->
      <div class="card fanqie-card" style="border-color:#b7eb8f;">
        <div class="section-title">③ 下载番茄小说（纯下载，不蒸馏）</div>
        <div class="fanqie-desc">输入 Book ID 和章节数，下载为 .txt 文件</div>
        <div class="fanqie-input-row" style="margin-bottom:8px;">
          <input v-model="downloadBookId" class="input" placeholder="Book ID" />
          <input v-model.number="downloadChapterCount" class="input" type="number" min="0" placeholder="章数(0=全本)" style="max-width:100px;" />
          <button class="btn btn-success btn-sm" :disabled="!downloadBookId || downloading" @click="startDownload">
            {{ downloading ? '⏳' : '📥 下载' }}
          </button>
        </div>
        <div v-if="downloading" class="fanqie-progress">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          <span class="fanqie-progress-text">{{ downloadStatus }}</span>
        </div>
        <div v-if="downloadMsg" class="status-msg" :class="{ ok: downloadOk }">{{ downloadMsg }}</div>
      </div>

      <!-- === Step 2c: 上传文件（备用） === -->
      <div class="card">
        <div class="section-title">③ 或上传本地的 .txt 文件</div>
        <div class="upload-area" @click="$refs.fileInput.click()" @dragover.prevent @drop.prevent="handleDrop">
          <input ref="fileInput" type="file" accept=".txt" @change="handleFile" style="display:none" />
          <div v-if="!selectedFile" class="upload-placeholder">
            <div class="upload-icon">📄</div>
            <div>点击或拖拽 .txt 文件到此处</div>
            <div class="upload-hint">支持 UTF-8 编码，最大 10MB</div>
          </div>
          <div v-else class="upload-file-info">
            <div class="file-icon">📄</div>
            <div class="file-name">{{ selectedFile.name }}</div>
            <div class="file-size">{{ (selectedFile.size / 1024).toFixed(1) }} KB</div>
            <button class="btn btn-sm btn-outline" @click.stop="selectedFile=null">重新选择</button>
          </div>
        </div>

        <div class="form-group" style="margin-top:12px;">
          <label>小说名称</label>
          <input v-model="novelTitle" class="input" placeholder="输入小说名称" maxlength="50" />
        </div>

        <button
          class="btn btn-primary btn-block"
          :disabled="!canUpload || uploading"
          @click="startUpload"
        >
          {{ uploading ? '⏳ 分析中...' : '🚀 上传并提取风格' }}
        </button>

        <!-- 进度/状态 -->
        <div v-if="statusMsg" class="status-msg" :class="{ ok: statusOk }">{{ statusMsg }}</div>
      </div>
    </div>

    <div style="height:20px;"></div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useReferenceStore } from '../stores/reference'
import { useI18n } from '../composables/useI18n'

const router = useRouter()
const authStore = useAuthStore()
const refStore = useReferenceStore()
const { $t } = useI18n()

const fileInput = ref(null)
const novelType = ref('normal') // 'normal' | 'lightnovel'
const gender = ref('male')
const searchQuery = ref('')
const mainCategory = ref('')
const subCategory = ref('')
const selectedTags = ref([])

// 轻小说类型列表（当 novelType === 'lightnovel' 时使用）
const lnFullTypes = [
  { name: '异世界转生', icon: '🌍', children: ['穿越异世界 / 转生', '迷宫探索 / 冒险者', '魔王 / 勇者', '龙族 / 精灵'] },
  { name: '校园恋爱', icon: '🏫', children: ['青梅竹马 / 天降', '学生会 / 社团', '学园祭 / 修学旅行', '转校生 / 同桌'] },
  { name: '奇幻冒险', icon: '⚔️', children: ['剑与魔法', '魔法学院', '骑士 / 王国', '精灵 / 矮人 / 兽人'] },
  { name: '日常系', icon: '☕', children: ['治愈日常', '小镇生活', '美食 / 咖啡', '猫与书店'] },
  { name: '战斗异能', icon: '💥', children: ['能力觉醒', '学园战斗', '排名赛', '异能组织'] },
  { name: '科幻未来', icon: '🤖', children: ['未来都市 / 赛博', 'AI / 机器人', '星际 / 宇宙', '虚拟现实'] },
]
const selectedFile = ref(null)
const novelTitle = ref('')
const uploading = ref(false)
const statusMsg = ref('')
const statusOk = ref(false)
const fanqieBookId = ref('')
const fanqieImporting = ref(false)
const fanqieStatus = ref('')
const fanqieMsg = ref('')
const fanqieOk = ref(false)
const fanqiePreviewData = ref(null)
const fanqiePreviewLoading = ref(false)
const downloadBookId = ref('')
const downloadChapterCount = ref(10)
const downloading = ref(false)
const downloadStatus = ref('')
const downloadMsg = ref('')
const downloadOk = ref(false)

// Cookie 设置
const cookieInput = ref('')
const cookieSaving = ref(false)
const showCookieHelp = ref(false)
const cookieStatusRef = computed(() => refStore.cookieStatus)

// 切换小说类型时重置分类选择
watch(novelType, () => {
  mainCategory.value = ''
  subCategory.value = ''
  selectedTags.value = []
  searchQuery.value = ''
})

async function saveCookie() {
  if (!cookieInput.value.trim()) return
  cookieSaving.value = true
  try {
    await refStore.setCookie(cookieInput.value.trim())
    cookieInput.value = ''
    cookieSaving.value = false
  } catch (e) {
    alert('保存失败: ' + (e.response?.data?.message || e.message))
    cookieSaving.value = false
  }
}
async function clearCookie() {
  if (!confirm('确定清除 Cookie 吗？锁定章节将无法下载')) return
  try {
    await refStore.deleteCookie()
    cookieInput.value = ''
  } catch {}
}

// 分类数据
const allCategories = ref({ male: [], female: [], commonTags: [] })

const currentCats = computed(() => {
  if (novelType.value === 'lightnovel') return lnFullTypes
  return allCategories.value[gender.value] || []
})
const commonTags = computed(() => {
  if (novelType.value === 'lightnovel') return ['傲娇', '天然呆', '元气', '治愈', '腹黑', '热血', '异世界', '学园', '奇幻', '日常', '战斗']
  const q = searchQuery.value.toLowerCase()
  if (!q) return allCategories.value.commonTags || []
  return (allCategories.value.commonTags || []).filter(t => t.includes(q))
})

const filteredMainCats = computed(() => {
  const q = searchQuery.value.toLowerCase()
  if (!q) return currentCats.value
  return currentCats.value.filter(c =>
    c.name.includes(q) || c.children.some(ch => ch.includes(q))
  )
})

const currentChildren = computed(() => {
  const cat = currentCats.value.find(c => c.name === mainCategory.value)
  return cat ? cat.children : []
})

const filteredTags = computed(() => {
  const q = searchQuery.value.toLowerCase()
  if (!q) return commonTags.value
  return commonTags.value.filter(t => t.includes(q))
})

const selectedDisplay = computed(() => {
  const parts = [mainCategory.value]
  if (subCategory.value) parts.push(subCategory.value)
  if (selectedTags.value.length > 0) parts.push('[' + selectedTags.value.join(', ') + ']')
  return parts.filter(Boolean).join(' → ')
})

const canUpload = computed(() =>
  mainCategory.value && selectedFile.value && novelTitle.value.trim()
)

function selectMain(cat) {
  mainCategory.value = cat.name
  subCategory.value = ''
  searchQuery.value = ''
}

function toggleTag(tag) {
  const idx = selectedTags.value.indexOf(tag)
  if (idx > -1) selectedTags.value.splice(idx, 1)
  else selectedTags.value.push(tag)
}

function handleFile(e) {
  const file = e.target.files?.[0]
  if (!file) return
  if (!file.name.endsWith('.txt')) { alert('仅支持 .txt 文件'); return }
  if (file.size > 10 * 1024 * 1024) { alert('文件超过 10MB 限制'); return }
  selectedFile.value = file
}

function handleDrop(e) {
  const file = e.dataTransfer.files?.[0]
  if (!file) return
  if (!file.name.endsWith('.txt')) { alert('仅支持 .txt 文件'); return }
  if (file.size > 10 * 1024 * 1024) { alert('文件超过 10MB 限制'); return }
  selectedFile.value = file
}

async function previewFanqieBook() {
  if (!fanqieBookId.value.trim()) return
  fanqiePreviewLoading.value = true
  fanqiePreviewData.value = null
  try {
    const data = await refStore.fanqiePreview(fanqieBookId.value.trim())
    fanqiePreviewData.value = data
    if (data.title) {
      // 自动填入类型（用第一个标签匹配）
      const mainGenre = data.genre || (data.labels || [])[0] || ''
      const maleNames = (allCategories.value.male || []).map(c => c.name)
      const femaleNames = (allCategories.value.female || []).map(c => c.name)
      const allNames = [...maleNames, ...femaleNames]
      // 先精确匹配，再子串匹配
      let matched = allNames.find(n => n === mainGenre)
      if (!matched) matched = allNames.find(n => mainGenre.includes(n) || n.includes(mainGenre))
      if (matched) {
        mainCategory.value = matched
        gender.value = maleNames.includes(matched) ? 'male' : 'female'
      }
    }
  } catch (e) {
    fanqiePreviewData.value = null
  }
  fanqiePreviewLoading.value = false
}

async function startFanqieImport() {
  if (!fanqieBookId.value.trim()) return
  fanqieImporting.value = true
  fanqieStatus.value = '正在获取书籍信息...'
  fanqieMsg.value = ''
  fanqieOk.value = false

  try {
    const res = await refStore.fanqieImport({
      bookId: fanqieBookId.value.trim(),
      novelType: novelType.value,
      gender: gender.value,
      mainCategory: mainCategory.value,
      subCategory: subCategory.value,
      tags: selectedTags.value,
    })
    fanqieMsg.value = res.message || '导入成功！'
    fanqieOk.value = true

    if (res.novel) {
      setTimeout(() => {
        fanqieBookId.value = ''
        fanqieMsg.value = ''
        fanqieImporting.value = false
      }, 3000)
      return
    }
  } catch (e) {
    fanqieMsg.value = '❌ ' + (e.response?.data?.message || e.message)
    fanqieOk.value = false
  }
  fanqieImporting.value = false
}

async function startDownload() {
  if (!downloadBookId.value.trim()) return
  downloading.value = true
  downloadStatus.value = '下载开始后浏览器会自动保存文件...'
  downloadMsg.value = ''
  downloadOk.value = false

  const token = localStorage.getItem('token')
  const chapterCount = downloadChapterCount.value || 0
  const url = `/api/reference/fanqie-download?bookId=${encodeURIComponent(downloadBookId.value.trim())}&chapters=${chapterCount}&token=${encodeURIComponent(token)}`

  // 用 window.open 让浏览器原生处理下载，避免 fetch+blob 的 0KB 问题
  window.open(url, '_blank')

  downloadMsg.value = '✅ 下载已在后台启动，请稍候...'
  downloadOk.value = true
  setTimeout(() => { downloadMsg.value = ''; downloading.value = false; downloadBookId.value = '' }, 2000)
}

async function startUpload() {
  if (!canUpload.value) return
  uploading.value = true
  statusMsg.value = '正在上传文件...'
  statusOk.value = false

  try {
    const formData = new FormData()
    formData.append('file', selectedFile.value)
    formData.append('title', novelTitle.value.trim())
    formData.append('gender', gender.value)
    formData.append('mainCategory', mainCategory.value)
    formData.append('subCategory', subCategory.value)
    formData.append('tags', JSON.stringify(selectedTags.value))
    formData.append('novelType', novelType.value)

    const res = await refStore.uploadFile(formData)
    statusMsg.value = res.message || '上传成功！'
    statusOk.value = true
    uploading.value = false

    // 重置表单
    setTimeout(() => {
      selectedFile.value = null
      novelTitle.value = ''
      mainCategory.value = ''
      subCategory.value = ''
      selectedTags.value = []
      statusMsg.value = ''
    }, 2000)
  } catch (e) {
    statusMsg.value = '❌ ' + (e.response?.data?.message || e.message)
    statusOk.value = false
    uploading.value = false
  }
}

onMounted(async () => {
  if (!authStore.isLoggedIn) { router.push('/login'); return }
  try {
    const data = await refStore.fetchCategories()
    allCategories.value = data
  } catch (e) {
    console.error('获取分类失败:', e)
  }
  // 获取番茄 cookie 状态
  try { await refStore.fetchCookieStatus() } catch {}
})
</script>

<style scoped>
.ref-upload-page {
  padding-top: var(--header-height);
}
.page-header {
  position: fixed; top: 0; left: 0; right: 0; height: var(--header-height);
  background: var(--card-bg);
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 600;
  border-bottom: 1px solid var(--border-color); z-index: 100; gap: 8px;
}
.header-btn { position: absolute; right: 12px; font-size: 12px; }
.upload-content { padding: 8px 0; }
.section-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; }

/* 小说类型切换 */
.ln-toggle-card { border: 2px solid #ffd591; background: linear-gradient(135deg, #fff7e6, #fffbe6); }
.novel-type-toggle { display: flex; gap: 10px; }
.toggle-btn { flex: 1; padding: 12px; border: 2px solid var(--border-color); border-radius: 10px; font-size: 14px; font-weight: 600; background: #f8f8f8; cursor: pointer; font-family: inherit; transition: all 0.2s; }
.toggle-btn.active { border-color: var(--primary-color); background: #fff5f0; }
.toggle-btn:first-child.active { border-color: #52c41a; background: #f6ffed; }
.toggle-btn:last-child.active { border-color: #fa8c16; background: #fff7e6; }
.ln-type-hint { margin-top: 8px; font-size: 12px; color: var(--text-light); text-align: center; }

/* 性别切换 */
.gender-tabs {
  display: flex; gap: 10px; margin-bottom: 14px;
}
.gender-tabs button {
  flex: 1; padding: 10px; border: 2px solid var(--border-color);
  border-radius: 10px; font-size: 14px; font-weight: 600;
  background: #f8f8f8; cursor: pointer; transition: all 0.2s;
  font-family: inherit;
}
.gender-tabs button.active {
  border-color: var(--primary-color); background: #fff5f0;
}

/* 搜索框 */
.search-box {
  position: relative; margin-bottom: 12px;
}
.search-box .input {
  padding-left: 36px; padding-right: 32px;
}
.search-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  font-size: 14px; opacity: 0.5;
}
.search-clear {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  background: none; border: none; font-size: 16px; cursor: pointer;
  color: var(--text-light); padding: 4px;
}

/* 主分类（水平滚动） */
.main-categories {
  display: flex; gap: 8px; overflow-x: auto;
  padding-bottom: 8px; margin-bottom: 8px;
  scrollbar-width: thin;
}
.main-cat-btn {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 14px; border: 2px solid var(--border-color);
  border-radius: 10px; background: #f8f8f8; cursor: pointer;
  transition: all 0.2s; flex-shrink: 0; font-family: inherit;
}
.main-cat-btn:hover { border-color: var(--primary-light); }
.main-cat-btn.active {
  border-color: var(--primary-color); background: #fff5f0;
}
.main-cat-icon { font-size: 22px; }
.main-cat-name { font-size: 12px; font-weight: 500; color: var(--text-secondary); white-space: nowrap; }

/* 二级题材 */
.sub-categories, .tag-section { margin-bottom: 12px; }
.sub-label { font-size: 12px; color: var(--text-light); margin-bottom: 6px; }
.sub-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  padding: 4px 12px; border: 1px solid var(--border-color);
  border-radius: 14px; font-size: 12px; color: var(--text-secondary);
  cursor: pointer; transition: all 0.15s; user-select: none;
}
.chip:hover { border-color: var(--primary-color); color: var(--primary-color); }
.chip.active { border-color: var(--primary-color); background: #fff5f0; color: var(--primary-color); font-weight: 600; }
.tag-chip { background: #f0f5ff; border-color: #d6e4ff; }
.tag-chip.active { background: #e6f7ff; border-color: #1890ff; color: #1890ff; }

/* 已选 */
.selected-info {
  font-size: 13px; color: var(--primary-color); font-weight: 500;
  padding: 8px; background: #fff5f0; border-radius: 6px; text-align: center;
}

/* 上传区域 */
.upload-area {
  border: 2px dashed var(--border-color); border-radius: 12px;
  padding: 24px; text-align: center; cursor: pointer;
  transition: all 0.2s; background: #fafafa;
}
.upload-area:hover { border-color: var(--primary-color); background: #fff5f0; }
.upload-placeholder { color: var(--text-secondary); }
.upload-icon { font-size: 36px; margin-bottom: 8px; }
.upload-hint { font-size: 12px; color: var(--text-light); margin-top: 4px; }
.upload-file-info { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.file-icon { font-size: 32px; }
.file-name { font-size: 14px; font-weight: 600; color: var(--text-primary); max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.file-size { font-size: 12px; color: var(--text-light); }
.form-group { margin-bottom: 14px; }
.form-group label { display: block; font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-bottom: 6px; }

.status-msg { margin-top: 10px; text-align: center; font-size: 14px; font-weight: 500; color: var(--error-color); }
.status-msg.ok { color: var(--success-color); }

/* Cookie 设置 */
.cookie-card {
  border: 2px solid #bae0ff; background: linear-gradient(135deg, #f0f8ff, #e6f2ff);
}
.cookie-help {
  color: var(--primary-color); cursor: pointer; font-size: 12px; margin-left: 6px;
  text-decoration: underline;
}
.cookie-tips {
  font-size: 12px; color: var(--text-secondary); background: #f8f8f8;
  border-radius: 6px; padding: 10px 14px; margin-bottom: 10px; line-height: 1.8;
}
.cookie-tips code {
  background: #e8e8e8; padding: 1px 5px; border-radius: 3px; font-size: 11px;
}
.cookie-status-row {
  display: flex; align-items: center; gap: 10px; margin-top: 8px; font-size: 13px;
}
.cookie-ok { color: var(--success-color); font-weight: 500; }
.cookie-none { color: var(--error-color); font-weight: 500; }
.btn-cookie {
  background: #1890ff; color: white; border: none;
  padding: 8px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; font-family: inherit;
  white-space: nowrap;
}
.btn-cookie:disabled { background: #ccc; cursor: default; }
.btn-cookie:hover:not(:disabled) { background: #40a9ff; }
.btn-text { background: none; border: none; color: var(--text-light); cursor: pointer; font-size: 12px; text-decoration: underline; }
.btn-text:hover { color: var(--error-color); }

/* 番茄预览 */
.fanqie-preview {
  margin-top: 10px; padding: 10px 14px; background: #fff; border-radius: 8px;
  border: 1px solid #ffe0d0; font-size: 13px;
}
.preview-row { display: flex; gap: 8px; margin-bottom: 4px; }
.preview-row:last-child { margin-bottom: 0; }
.preview-label { color: var(--text-light); min-width: 50px; flex-shrink: 0; }
.preview-val { color: var(--text-primary); font-weight: 500; }
.preview-hint { color: var(--warning-color); font-size: 12px; }

/* 番茄导入 */
.fanqie-card {
  border: 2px solid #ffe0d0; background: linear-gradient(135deg, #fff8f5, #fff0e8);
}
.fanqie-desc { font-size: 12px; color: var(--text-light); margin-bottom: 12px; }
.fanqie-input-row { display: flex; gap: 8px; }
.fanqie-input-row .input { flex: 1; }
.fanqie-progress {
  display: flex; align-items: center; gap: 6px; margin-top: 10px;
  justify-content: center;
}
.fanqie-progress .dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--primary-color);
  animation: dotPulse 1.2s infinite ease-in-out;
}
.fanqie-progress .dot:nth-child(2) { animation-delay: 0.2s; }
.fanqie-progress .dot:nth-child(3) { animation-delay: 0.4s; }
.fanqie-progress-text { font-size: 13px; color: var(--text-secondary); }
.btn-success { background: #52c41a; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; font-family: inherit; }
.btn-success:disabled { background: #ccc; cursor: default; }
.btn-success:hover:not(:disabled) { background: #73d13d; }
@keyframes dotPulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}
</style>
