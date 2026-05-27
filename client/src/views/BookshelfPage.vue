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
        <div class="icon">📖</div>
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
            <span class="status-badge" :class="novel.status">{{ statusMap[novel.status] || novel.status }}</span>
          </div>
          <div class="novel-meta">
            <span>📝 {{ novel.currentWordCount }} / {{ novel.targetWordCount }} {{ $t('bookshelf.chapter') }}</span>
            <span>📖 {{ novel.currentChapterIndex || 0 }} {{ $t('novelDetail.chapter') }}</span>
            <span>🕐 {{ formatTime(novel.updatedAt) }}</span>
          </div>
          <div class="novel-actions" @click.stop>
            <button v-if="novel.status === 'generating'" class="btn btn-sm btn-outline" @click="pauseNovel(novel)">{{ $t('bookshelf.pause') }}</button>
            <button v-if="novel.status === 'paused'" class="btn btn-sm btn-primary" @click="showContinueDialog(novel)">{{ $t('bookshelf.resume') }}</button>
            <button v-if="novel.status === 'completed' || novel.status === 'paused'" class="btn btn-sm btn-outline" style="color: #8B5CF6; border-color: #8B5CF6;" @click="showContinueDialog(novel)">{{ $t('bookshelf.write') }}</button>
            <button class="btn btn-sm btn-outline" style="color: #1890ff; border-color: #1890ff;" @click.stop="editOutline(novel)">{{ $t('bookshelf.outline') }}</button>
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
              <span class="option-icon">📚</span>
              <span class="option-text">{{ $t('bookshelf.continueBook') }}</span>
              <span class="option-desc">{{ $t('bookshelf.continueBookDesc', { count: continueDialogNovel?.targetWordCount || 0 }) }}</span>
            </button>
            <button class="continue-option" @click="startChapterContinue(continueDialogNovel)" :disabled="isContinuing">
              <span class="option-icon">📄</span>
              <span class="option-text">{{ $t('bookshelf.continueChapter') }}</span>
              <span class="option-desc">{{ $t('bookshelf.continueChapterDesc') }}</span>
            </button>
          </div>
          <button class="btn btn-outline btn-sm" style="margin-top:12px;" @click="continueDialogNovel=null">{{ $t('common.cancel') }}</button>
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
import { ref, computed, onMounted } from 'vue'
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

const typeIcons = { xianxia: '🔮', urban: '🏙️', scifi: '🚀', wuxia: '⚔️', mystery: '🔍', romance: '💕', historical: '🏛️' }
function getTypeIcon(typeId) { return typeIcons[typeId] || '📄' }

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

async function startBookContinue(novel) {
  continueDialogNovel.value = null; isContinuing.value = true
  currentContinueChapter.value = 0; continueWordCount.value = 0
  try {
    await novelStore.continueGeneration(novel._id, (chunk, fullText) => { continueWordCount.value = fullText.length }, (status) => {
      if (status.type === 'chapter_start') currentContinueChapter.value = status.chapterNumber || 0
      if (status.type === 'completed' || status.type === 'paused' || status.type === 'error') { isContinuing.value = false; novelStore.fetchBookshelf() }
    }, 'book')
  } catch (e) {
    isContinuing.value = false
    if (e.message === 'TOKEN_EXHAUSTED' || (e.message && e.message.includes('Token'))) alert('当前token已消耗完毕，请加q群1019601998联系群主购买token')
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
function confirmDelete(novel) { if (confirm($t('bookshelf.deleteConfirm', { title: novel.title }))) novelStore.deleteNovel(novel._id) }

function editOutline(novel) { outlineNovel.value = novel; outlineText.value = novel.outline || ''; outlineModal.value = true }
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
.batch-bar { position: fixed; top: var(--header-height); left: 0; right: 0; height: 44px; background: #fff5f0; border-bottom: 1px solid #ffe8d6; display: flex; align-items: center; padding: 0 12px; gap: 10px; z-index: 99; }
.batch-check-label { display: flex; align-items: center; gap: 4px; font-size: 13px; color: var(--text-secondary); cursor: pointer; user-select: none; }
.batch-check-label input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--primary-color); }
.batch-count { font-size: 12px; color: var(--text-light); flex-shrink: 0; }
.batch-actions { flex: 1; display: flex; justify-content: flex-end; gap: 6px; }
.novel-list { padding: 8px 0; }
.novel-card { cursor: pointer; transition: all 0.2s; position: relative; }
.novel-card:active { transform: scale(0.98); }
.novel-card.batch-mode { cursor: default; }
.novel-card.selected { border-color: var(--primary-color); background: #fff5f0; }
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
.continue-option:hover { border-color: var(--primary-color); background: #fff5f0; }
.continue-option:active { transform: scale(0.97); }
.continue-option.primary { border-color: var(--primary-color); background: #fff5f0; }
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
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

/* 大纲编辑弹窗 */
.outline-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; animation: fadeIn 0.2s; }
.outline-modal { background: var(--card-bg); border-radius: 16px; padding: 24px; width: 90%; max-width: 500px; }
.outline-modal h3 { font-size: 17px; font-weight: 700; color: var(--text-primary); margin-bottom: 14px; }
.outline-textarea { width: 100%; min-height: 200px; padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 13px; line-height: 1.6; resize: vertical; font-family: inherit; box-sizing: border-box; }
.outline-actions { display: flex; gap: 10px; margin-top: 14px; justify-content: flex-end; }
</style>
