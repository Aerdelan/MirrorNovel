<template>
 <div class="page-container bookshelf-page">
 <div class="page-header">
 <span>{{ $t('bookshelf.title') }}</span>
 <button v-if="novelStore.bookshelf.length > 0 && !batchMode" class="btn btn-sm btn-outline header-btn" @click="enterBatchMode">
 {{ $t('bookshelf.batchExport') }}
 </button>
 <button v-if="batchMode" class="btn btn-sm btn-outline header-btn" @click="exitBatchMode">
 {{ $t('bookshelf.cancel') }}
 </button>
 </div>

 <div v-if="batchMode && novelStore.bookshelf.length > 0" class="batch-bar">
 <label class="batch-check-label" @click.stop>
 <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
 <span>{{ $t('bookshelf.selectAll') }}</span>
 </label>
 <span class="batch-count">{{ $t('bookshelf.selected', { count: selectedIds.length }) }}</span>
 <div class="batch-actions">
 <button class="btn btn-sm btn-primary" :disabled="selectedIds.length === 0 || exporting" @click="exportSelected">
 {{ exporting ? $t('common.loading') : $t('bookshelf.exportSelected') }}
 </button>
 <button class="btn btn-sm btn-primary" :disabled="exporting" @click="exportAll">
 {{ exporting ? $t('common.loading') : $t('bookshelf.exportAll') }}
 </button>
 </div>
 </div>

 <div class="bookshelf-content">
 <div v-if="loading" class="empty-state">
 <div class="loading-spinner" style="width: 32px; height: 32px;"></div>
 <div class="text" style="margin-top: 12px;">{{ $t('common.loading') }}</div>
 </div>

 <div v-else-if="novelStore.bookshelf.length === 0" class="empty-state">
 <div class="icon"></div>
 <div class="text">{{ $t('bookshelf.empty') }}</div>
 <div class="text" style="font-size: 13px; margin-top: 4px;">{{ $t('bookshelf.emptyHint') }}</div>
 <button class="btn btn-primary btn-sm" style="margin-top: 16px;" @click="goToGenerate">
 {{ $t('bookshelf.goGenerate') }}
 </button>
 </div>

 <div v-else class="novel-list">
 <div v-for="novel in novelStore.bookshelf" :key="novel._id" class="novel-card card"
 :class="{ 'batch-mode': batchMode, selected: selectedIds.includes(novel._id) }"
 @click="batchMode ? toggleSelect(novel._id) : openNovel(novel)">
 <div class="novel-header">
 <div v-if="batchMode" class="batch-check" @click.stop>
 <input type="checkbox" :checked="selectedIds.includes(novel._id)" @change="toggleSelect(novel._id)" />
 </div>
 <div class="novel-icon">{{ getTypeIcon(novel.novelTypeId) }}</div>
 <div class="novel-info">
 <div class="novel-title">{{ novel.title || $t('bookshelf.defaultTitle') }}</div>
 <div class="novel-type">{{ novel.novelTypeName }}</div>
 </div>
 <span v-if="novel.editorialTask?.status === 'running'" class="status-badge optimizing">⏳ 编辑中</span>
 <span v-else-if="novel.optimizeTask?.status === 'analyzing' || novel.optimizeTask?.status === 'optimizing'" class="status-badge optimizing">⏳ 调优中</span>
 <span v-else class="status-badge" :class="novel.status">{{ statusMap[novel.status] || novel.status }}</span>
 </div>
 <div class="novel-meta">
 <span> {{ novel.currentWordCount }} / {{ novel.targetWordCount }} {{ $t('generate.wordShort') }}</span>
 <span> {{ novel.currentChapterIndex || 0 }} {{ $t('novelDetail.chapter') }}</span>
 <span> {{ formatTime(novel.updatedAt) }}</span>
 </div>
 <div class="novel-actions" @click.stop>
 <button v-if="novel.status === 'generating'" class="btn btn-sm btn-outline" @click="pauseNovel(novel)">{{ $t('bookshelf.pause') }}</button>
 <button v-if="novel.status === 'paused'" class="btn btn-sm btn-primary" @click="showContinueDialog(novel)">{{ $t('bookshelf.resume') }}</button>
 <button v-if="novel.status === 'completed' || novel.status === 'paused'" class="btn btn-sm btn-outline action-warm" @click="showContinueDialog(novel)">{{ $t('bookshelf.write') }}</button>
 <button class="btn btn-sm btn-outline action-info" @click.stop="editOutline(novel)">{{ $t('bookshelf.outline') }}</button>
 <button v-if="novel.status === 'completed' || novel.status === 'paused'" class="btn btn-sm btn-outline action-editorial" :disabled="editorialRunning" @click.stop="startEditorialBook(novel)">{{ editorialRunning ? $t('bookshelf.editorialRunning') : $t('bookshelf.editorial') }}</button>
 <button class="btn btn-sm btn-outline" style="color: var(--primary-color); border-color: var(--primary-color);" :disabled="exporting" @click="exportSingle(novel)">{{ $t('bookshelf.export') }}</button>
 <button class="btn btn-sm btn-outline" style="color: var(--error-color); border-color: var(--error-color);" @click="confirmDelete(novel)">{{ $t('common.delete') }}</button>
 </div>
 </div>
 </div>
 </div>

 <Teleport to="body">
 <div v-if="outlineModal" class="outline-overlay" @click.self="outlineModal=false">
 <div class="outline-modal">
 <h3>{{ $t('bookshelf.editOutline') }} {{ outlineNovel?.title }}</h3>
 <textarea v-model="outlineText" class="outline-textarea" rows="8" :placeholder="$t('bookshelf.placeholderOutline')"></textarea>
 <div class="outline-actions">
 <button class="btn btn-outline btn-sm" @click="outlineModal=false">{{ $t('common.cancel') }}</button>
 <button class="btn btn-primary btn-sm" :disabled="outlineSaving" @click="saveOutline">{{ outlineSaving ? $t('common.loading') : $t('bookshelf.saveOutline') }}</button>
 </div>
 </div>
 </div>
 </Teleport>

 <Teleport to="body">
 <div v-if="continueDialogNovel" class="continue-overlay" @click.self="continueDialogNovel=null">
 <div class="continue-modal">
 <h3>{{ $t('bookshelf.writeMode') }} {{ continueDialogNovel?.title }}</h3>
 <p class="continue-desc">{{ $t('bookshelf.progress', { current: continueDialogNovel?.currentWordCount || 0, target: continueDialogNovel?.targetWordCount || 0 }) }}</p>
 <div class="continue-options">
 <button class="continue-option primary" @click="startBookContinue(continueDialogNovel)" :disabled="isContinuing">
 <span class="option-icon"></span>
 <span class="option-text">{{ $t('bookshelf.continueBook') }}</span>
 <span class="option-desc">{{ $t('bookshelf.continueBookDesc', { count: continueDialogNovel?.targetWordCount || 0 }) }}</span>
 </button>
 <button class="continue-option" @click="startChapterContinue(continueDialogNovel)" :disabled="isContinuing">
 <span class="option-icon"></span>
 <span class="option-text">{{ $t('bookshelf.continueChapter') }}</span>
 <span class="option-desc">{{ $t('bookshelf.continueChapterDesc') }}</span>
 </button>
 </div>
 <button class="btn btn-outline btn-sm" style="margin-top:12px;" @click="continueDialogNovel=null">{{ $t('common.cancel') }}</button>
 </div>
 </div>
 </Teleport>

 <Teleport to="body">
 <div v-if="editorialRunning" class="editorial-progress-overlay">
 <div class="editorial-progress-card">
 <div class="progress-title">七阶段编辑引擎运行中</div>
 <div class="progress-novel-title">{{ editorialNovelTitle }}</div>
 <div class="progress-chapter">{{ editorialProgress }}</div>
 <div class="editorial-stages-display">
 <div v-for="s in editorialStageDisplay" :key="s.id" class="editorial-stage-item" :class="{ active: s.active, done: s.done, failed: s.error }">
 <span class="stage-num">{{ s.num }}</span>
 <span class="stage-name">{{ s.name }}{{ s.error ? '!' : '' }}</span>
 <span v-if="s.error" class="stage-error-msg">{{ s.errorMsg }}</span>
 </div>
 </div>
 <div class="progress-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
 </div>
 </div>
</Teleport>

<Teleport to="body">
 <div v-if="isContinuing" class="continue-progress-overlay">
 <div class="continue-progress-card">
 <div class="progress-title">{{ $t('bookshelf.aiWriting') }}</div>
 <div v-if="currentContinueChapter" class="progress-chapter">{{ $t('bookshelf.currentChapter', { num: currentContinueChapter }) }}</div>
 <div class="progress-word">{{ $t('bookshelf.generated', { words: continueWordCount }) }}</div>
 <div class="progress-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
 </div>
 </div>
 </Teleport>
 <div style="height: 20px;"></div>
 </div>
</template>

<script setup>
import { ref, computed, onMounted, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { useNovelStore } from '../stores/novel'
import { useAuthStore } from '../stores/auth'
import { useI18n } from '../composables/useI18n'
import api from '../api'

const router = useRouter()
const novelStore = useNovelStore()
const authStore = useAuthStore()
const { $t } = useI18n()
const loading = ref(true)

const batchMode = ref(false)
const selectedIds = ref([])
const exporting = ref(false)
const outlineModal = ref(false)
const outlineNovel = ref(null)
const outlineText = ref('')
const outlineSaving = ref(false)
const continueDialogNovel = ref(null)
const isContinuing = ref(false)
const currentContinueChapter = ref(0)
const continueWordCount = ref(0)

// ---- 编辑引擎 ----
const editorialRunning = ref(false)
const editorialNovelTitle = ref('')
const editorialProgress = ref('')
const editorialStageDisplay = ref([
 { id: 'persona', num: 0, name: '人格', active: false, done: false, error: false, errorMsg: '' },
 { id: 'structural', num: 1, name: '结构重构', active: false, done: false, error: false, errorMsg: '' },
 { id: 'polish', num: 2, name: '风格一致性', active: false, done: false, error: false, errorMsg: '' },
 { id: 'deAI', num: 3, name: '去AI化', active: false, done: false, error: false, errorMsg: '' },
])
let editorialPollTimer = null

const statusMap = {
 generating: $t('bookshelf.statusGenerating'),
 paused: $t('bookshelf.statusPaused'),
 completed: $t('bookshelf.statusCompleted'),
 error: $t('bookshelf.statusError'),
}

const allSelected = computed(() => novelStore.bookshelf.length > 0 && selectedIds.value.length === novelStore.bookshelf.length)

onMounted(async () => {
 if (!authStore.isLoggedIn) { router.push('/login'); return }
 try { await novelStore.fetchBookshelf() } catch (e) { console.error('获取书架失败:', e) }
 loading.value = false
})

// 从 keep-alive 缓存重新激活时刷新书架数据（切换 tab 回来时）
onActivated(async () => {
 if (!authStore.isLoggedIn) return
 loading.value = true
 try { await novelStore.fetchBookshelf() } catch (e) { console.error('书架刷新失败:', e) }
 loading.value = false
})

const typeIcons = { xianxia: '', urban: '️', scifi: '', wuxia: '️', mystery: '', romance: '', historical: '️' }
function getTypeIcon(typeId) { return typeIcons[typeId] || '' }

function formatTime(dateStr) {
 if (!dateStr) return ''
 const date = new Date(dateStr)
 const now = new Date()
 const diff = now - date
 if (diff < 60000) return $t('bookshelf.justNow')
 if (diff < 3600000) return $t('bookshelf.minAgo', { m: Math.floor(diff / 60000) })
 if (diff < 86400000) return $t('bookshelf.hourAgo', { h: Math.floor(diff / 3600000) })
 return `${date.getMonth() + 1}月${date.getDate()}日`
}

function openNovel(novel) { router.push(`/novel/${novel._id}`) }
function showContinueDialog(novel) { continueDialogNovel.value = novel }

function isTokenExhaustedError(message) {
 if (!message) return false
 return message === 'TOKEN_EXHAUSTED' ||
 message.includes('Token') ||
 message.includes('token') ||
 message.includes('余额不足')
}

async function startBookContinue(novel) {
 continueDialogNovel.value = null; isContinuing.value = true
 currentContinueChapter.value = 0; continueWordCount.value = 0
 try {
 await novelStore.continueGeneration(novel._id, (chunk, fullText) => { continueWordCount.value = fullText.length }, (status) => {
 if (status.type === 'chapter_start') currentContinueChapter.value = status.chapterNumber || 0
 if (status.type === 'token_exhausted') { isContinuing.value = false; novelStore.fetchBookshelf() }
 else if (status.type === 'completed' || status.type === 'paused' || status.type === 'error') { isContinuing.value = false; novelStore.fetchBookshelf() }
 }, 'book')
 } catch (e) {
 isContinuing.value = false
 if (isTokenExhaustedError(e.message)) alert('当前积分余额不足，请加 QQ 群 1019601998 联系群主补充积分')
 else if (e.message !== 'paused') alert('续写失败：' + e.message)
 novelStore.fetchBookshelf()
 }
}

async function startChapterContinue(novel) {
 continueDialogNovel.value = null
 try {
 const detail = await novelStore.fetchNovelDetail(novel._id)
 const fullText = (detail.chapters || []).map(ch => `第${ch.chapterNumber}章\n${ch.content}`).join('\n\n')
 novelStore.setPrefillContinue({ novelId: detail._id, importedText: fullText, title: detail.title, novelTypeName: detail.novelTypeName })
 router.push('/continue')
 } catch (e) { alert($t('error.unknown')) }
}

function goToGenerate() { router.push('/generate') }
function enterBatchMode() { batchMode.value = true; selectedIds.value = [] }
function exitBatchMode() { batchMode.value = false; selectedIds.value = [] }
function toggleSelect(id) { const idx = selectedIds.value.indexOf(id); idx > -1 ? selectedIds.value.splice(idx, 1) : selectedIds.value.push(id) }
function toggleSelectAll() { selectedIds.value = allSelected.value ? [] : novelStore.bookshelf.map(n => n._id) }

function downloadZip(novelIds, filename) {
 const token = localStorage.getItem('token')
 window.open(`/api/novel/export?token=${encodeURIComponent(token)}&ids=${novelIds.join(',')}`, '_blank')
}

function exportSingle(novel) { downloadZip([novel._id], `${(novel.title || $t('bookshelf.defaultTitle')).replace(/[<>:"/\\|?*]/g, '_').substring(0, 30)}.zip`) }
function exportSelected() { if (selectedIds.value.length) downloadZip(selectedIds.value, `批量导出_${selectedIds.value.length}本_${Date.now()}.zip`) }
function exportAll() { const allIds = novelStore.bookshelf.map(n => n._id); downloadZip(allIds, `批量导出_全部${allIds.length}本_${Date.now()}.zip`) }

async function pauseNovel(novel) { try { await novelStore.pauseNovel(novel._id); await novelStore.fetchBookshelf() } catch (e) { alert($t('bookshelf.pause') + '失败') } }
async function confirmDelete(novel) {
 if (!confirm($t('bookshelf.deleteConfirm', { title: novel.title }))) return
 try {
 await novelStore.deleteNovel(novel._id)
 await novelStore.fetchBookshelf()
 } catch (e) {
 alert('删除失败: ' + (e.response?.data?.message || e.message))
 }
}

function editOutline(novel) { outlineNovel.value = novel; outlineText.value = novel.outline || ''; outlineModal.value = true }

// ---- 编辑引擎 ----
async function startEditorialBook(novel) {
 if (!confirm(`确定要对《${novel.title}》执行七阶段编辑引擎吗？\n\n将对全部 ${novel.currentChapterIndex || 0} 章逐章执行：\n1. AI特征分析  2. 删除AI痕迹  3. 节奏重构\n4. 人物重塑  5. 风格润色  6. 字数压缩  7. 一致性检查\n\n处理时间较长，将在后台运行。`)) return

 try {
 const res = await api.post(`/novel/editorial-book/${novel._id}`)
 if (res.data) {
 editorialRunning.value = true
 editorialNovelTitle.value = novel.title || '未命名'
 editorialProgress.value = '已启动，正在处理...'
 editorialStageDisplay.value.forEach(s => { s.active = false; s.done = false; s.error = false; s.errorMsg = '' })
 // 开始轮询状态
 startEditorialPolling(novel._id)
 }
 } catch (e) {
 alert('启动编辑引擎失败: ' + (e.response?.data?.message || e.message))
 }
}

function startEditorialPolling(novelId) {
 if (editorialPollTimer) clearInterval(editorialPollTimer)
 editorialPollTimer = setInterval(async () => {
 try {
 const res = await api.post(`/novel/editorial-status/${novelId}`)
 const task = res.data?.task
 if (!task) return

 editorialProgress.value = task.progress || ''

 // 更新阶段显示
 if (task.currentStage) {
 const stage = editorialStageDisplay.value.find(s => s.id === task.currentStage)
 if (stage) {
 // 检测是否失败（progress 中包含“失败”）
 if (task.progress && task.progress.includes('失败')) {
 stage.error = true; stage.errorMsg = task.progress; stage.active = false
 } else {
 editorialStageDisplay.value.forEach(s => { if (!s.error) s.active = false })
 stage.active = true
 const idx = editorialStageDisplay.value.findIndex(s => s.id === task.currentStage)
 for (let i = 0; i < idx; i++) { if (!editorialStageDisplay.value[i].error) { editorialStageDisplay.value[i].done = true; editorialStageDisplay.value[i].active = false } }
 }
 }
 }

 if (task.status === 'completed' || task.status === 'error') {
 clearInterval(editorialPollTimer); editorialPollTimer = null
 editorialRunning.value = false
 editorialStageDisplay.value.forEach(s => { if (!s.error) { s.done = true; s.active = false } })
 await novelStore.fetchBookshelf()
 if (task.status === 'completed') {
 alert('编辑引擎完成！' + (task.progress || ''))
 } else {
 alert('编辑引擎出错: ' + (task.error || task.progress || ''))
 }
 }
 } catch (e) {
 console.error('轮询编辑引擎状态失败:', e)
 }
 }, 5000)
}
async function saveOutline() {
 outlineSaving.value = true
 try { await api.put(`/novel/${outlineNovel.value._id}/outline`, { outline: outlineText.value }); outlineNovel.value.outline = outlineText.value; outlineModal.value = false }
 catch (e) { alert($t('error.unknown') + ':' + (e.response?.data?.message || e.message)) }
 outlineSaving.value = false
}
</script>

<style scoped>
.bookshelf-page { padding-top: var(--header-height); }
.page-header { position: fixed; top: 0; left: 0; right: 0; height: var(--header-height); background: var(--card-bg); display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 600; border-bottom: 1px solid var(--border-color); z-index: 100; gap: 8px; }
.header-btn { position: absolute; right: 12px; font-size: 12px; }
.batch-bar { position: fixed; top: var(--header-height); left: 0; right: 0; height: 44px; background: var(--accent-light); border-bottom: 1px solid var(--warning-border); display: flex; align-items: center; padding: 0 12px; gap: 10px; z-index: 99; }
.batch-check-label { display: flex; align-items: center; gap: 4px; font-size: 13px; color: var(--text-secondary); cursor: pointer; user-select: none; }
.batch-check-label input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--primary-color); }
.batch-count { font-size: 12px; color: var(--text-light); flex-shrink: 0; }
.batch-actions { flex: 1; display: flex; justify-content: flex-end; gap: 6px; }
.novel-list { padding: 8px 0; }
.novel-card { cursor: pointer; transition: all 0.2s; position: relative; }
.novel-card:active { transform: scale(0.98); }
.novel-card.batch-mode { cursor: default; }
.novel-card.selected { border-color: var(--primary-color); background: var(--primary-light); }
.batch-check { display: flex; align-items: center; padding-right: 4px; }
.batch-check input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--primary-color); cursor: pointer; }
.novel-header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
.novel-icon { font-size: 32px; flex-shrink: 0; }
.novel-info { flex: 1; min-width: 0; }
.novel-title { font-size: 16px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.novel-type { font-size: 12px; color: var(--text-light); margin-top: 2px; }
.novel-meta { display: flex; gap: 12px; font-size: 12px; color: var(--text-light); flex-wrap: wrap; }
.novel-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.continue-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; animation: fadeIn 0.2s; }
.continue-modal { background: var(--card-bg); border-radius: 16px; padding: 24px; width: 90%; max-width: 380px; text-align: center; }
.continue-modal h3 { font-size: 17px; margin: 0 0 8px; color: var(--text-primary); }
.continue-desc { font-size: 13px; color: var(--text-light); margin: 0 0 20px; }
.continue-options { display: flex; flex-direction: column; gap: 12px; }
.continue-option { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 16px; border: 2px solid var(--border-color); border-radius: 12px; background: #f8f8f8; cursor: pointer; transition: all 0.2s; font-family: inherit; }
.continue-option:hover { border-color: var(--primary-color); background: var(--primary-light); }
.continue-option:active { transform: scale(0.97); }
.continue-option.primary { border-color: var(--primary-color); background: var(--primary-light); }
.continue-option .option-icon { font-size: 28px; }
.continue-option .option-text { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.continue-option .option-desc { font-size: 12px; color: var(--text-light); }
.continue-progress-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; }
.continue-progress-card { background: var(--card-bg); border-radius: 16px; padding: 32px; text-align: center; min-width: 260px; }
.progress-title { font-size: 16px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px; }
.progress-chapter { font-size: 15px; color: var(--primary-color); font-weight: 600; margin-bottom: 6px; }
.progress-word { font-size: 13px; color: var(--text-secondary); margin-bottom: 16px; }
.progress-indicator { display: flex; gap: 6px; justify-content: center; }
.progress-indicator .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--primary-color); animation: dotPulse 1.2s infinite ease-in-out; }
.progress-indicator .dot:nth-child(2) { animation-delay: 0.2s; }
.progress-indicator .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes dotPulse { 0%,80%,100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }
@keyframes editorialPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

/* 编辑引擎进度 */
.editorial-progress-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; }
.editorial-progress-card { background: var(--card-bg, #fff); border-radius: 16px; padding: 28px 24px; text-align: center; min-width: 320px; max-width: 400px; }
.editorial-progress-card .progress-title { font-size: 16px; font-weight: 700; color: var(--accent-hover); margin-bottom: 8px; }
.editorial-progress-card .progress-novel-title { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; }
.editorial-stages-display { display: flex; flex-direction: column; gap: 6px; margin: 16px 0; }
.editorial-stage-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; background: #f5f5f5; font-size: 13px; transition: all 0.3s; }
.editorial-stage-item.active { background: var(--accent-light); border: 1px solid #f0c58d; animation: editorialPulse 1.5s infinite; }
.editorial-stage-item.done { background: #f0f7f0; border: 1px solid #c0e0c0; }
.editorial-stage-item.failed { background: #fff5f5; border: 1px solid #ffc0c0; }
.editorial-stage-item.failed .stage-num { background: #e74c3c; color: #fff; }
.editorial-stage-item.failed .stage-name { color: #e74c3c; font-weight: 600; }
.stage-error-msg { font-size: 11px; color: #c0392b; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
.editorial-stage-item .stage-num { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: #ddd; color: #666; font-size: 11px; font-weight: 700; flex-shrink: 0; }
.editorial-stage-item.active .stage-num { background: var(--accent); color: #fff; }
.editorial-stage-item.done .stage-num { background: #27ae60; color: #fff; }
.editorial-stage-item .stage-name { color: #666; }
.editorial-stage-item.active .stage-name { color: var(--accent-hover); font-weight: 600; }
.editorial-stage-item.done .stage-name { color: #27ae60; }
.action-warm { color: var(--accent-hover); border-color: var(--accent); }
.action-warm:hover:not(:disabled) { color: var(--accent-hover); border-color: var(--accent); background: var(--accent-light); }
.action-info { color: var(--info); border-color: var(--info); }
.action-info:hover:not(:disabled) { color: var(--info); border-color: var(--info); background: var(--info-bg); }
.action-editorial { color: var(--accent-hover); border-color: var(--accent); }
.action-editorial:hover:not(:disabled) { color: var(--accent-hover); border-color: var(--accent); background: var(--accent-light); }

/* 大纲编辑弹窗 */
.outline-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; animation: fadeIn 0.2s; }
.outline-modal { background: var(--card-bg); border-radius: 16px; padding: 24px; width: 90%; max-width: 500px; }
.outline-modal h3 { font-size: 17px; font-weight: 700; color: var(--text-primary); margin-bottom: 14px; }
.outline-textarea { width: 100%; min-height: 200px; padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 13px; line-height: 1.6; resize: vertical; font-family: inherit; box-sizing: border-box; }
.outline-actions { display: flex; gap: 10px; margin-top: 14px; justify-content: flex-end; }
</style>
