<template>
  <div class="novel-detail-page">
    <div class="detail-header">
      <button class="back-btn" @click="goBack">← {{ $t('common.close') }}</button>
      <h2 class="detail-title">{{ novel?.title || '小说详情' }}</h2>
    </div>
    <div class="detail-content">
      <div class="card summary-card">
        <div class="summary-row"><span class="summary-label">{{ $t('novelDetail.chapter') }}</span><span>{{ novel?.novelTypeName }}</span></div>
        <div class="summary-row"><span class="summary-label">{{ $t('generate.stepChar') }}</span><span>{{ novel?.protagonistName|| $t('novelDetail.unknown') }}</span></div>
        <div class="summary-row"><span class="summary-label">{{ $t('bookshelf.progress') }}</span><span>{{ $t('novelDetail.outOf', { current: novel?.currentWordCount, target: novel?.targetWordCount }) }}</span></div>
        <div class="summary-row"><span class="summary-label">{{ $t('bookshelf.chapter') }}</span><span>{{ novel?.currentChapterIndex||0 }} {{ $t('novelDetail.chapter') }}</span></div>
        <div class="summary-row"><span class="summary-label">状态</span><span class="status-badge" :class="novel?.status">{{ statusMap[novel?.status] }}</span></div>
      </div>

      <Teleport to="body">
        <div v-if="showGenSettings" class="gen-overlay" @click.self="showGenSettings=false">
          <div class="gen-modal">
            <h3>⚙️ 生成设置</h3>
            <div class="gf"><label>{{ $t('continue.wordCount') }}</label>
              <input v-model.number="genWordCount" class="input" type="number" min="500" max="8000" step="500" />
            </div>
            <div class="gf"><label>生成备注</label>
              <textarea v-model="genNotes" class="textarea" rows="3" placeholder="描述接下来要写的内容方向（选填）"></textarea>
            </div>
            <div class="gf-acts">
              <button class="btn btn-outline" @click="showGenSettings=false">{{ $t('common.cancel') }}</button>
              <button class="btn btn-primary" @click="confirmGenSettings">开始生成</button>
            </div>
          </div>
        </div>
      </Teleport>

      <Teleport to="body">
        <div v-if="showEditModal" class="gen-overlay" @click.self="showEditModal=false">
          <div class="gen-modal edit-modal">
            <h3>{{ $t('novelDetail.editChapter', { num: editingChapter?.chapterNumber }) }}</h3>
            <textarea v-model="editContent" class="textarea" rows="12"></textarea>
            <div class="gf-acts">
              <button class="btn btn-outline" @click="showEditModal=false">{{ $t('common.cancel') }}</button>
              <button class="btn btn-primary" @click="saveEdit">{{ $t('common.save') }}</button>
            </div>
          </div>
        </div>
      </Teleport>

      <div v-if="isLastChapterUnfinished" class="card action-card">
        <button class="btn btn-primary btn-block" @click="openGenSettings(lastChapterNum)">▶ 继续生成第{{ lastChapterNum }}章</button>
      </div>

      <div v-if="isContinuing" class="card streaming-card">
        <div class="streaming-header">
          <span class="section-title">📝 {{ $t('bookshelf.aiWriting') }}（第{{ continuingChapter }}章）</span>
          <span class="generating-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>
        </div>
        <div class="streaming-content" ref="streamingRef">
          <div class="content-text">{{ chapterStreamingText }}</div>
          <div class="cursor-blink">|</div>
        </div>
        <button class="btn btn-outline btn-sm" style="margin-top:8px;" @click="stopChapterGen">{{ $t('bookshelf.pause') }}</button>
      </div>

      <div class="card">
        <div class="section-title">📖 章节列表</div>
        <div v-if="!novel?.chapters?.length" class="empty-chapters">暂无章节内容</div>
        <div v-for="(chapter, index) in novel?.chapters" :key="chapter.chapterNumber" class="chapter-item">
          <div class="chapter-header" @click="toggleChapter(index)">
            <span class="chapter-num">第{{ chapter.chapterNumber }}章</span>
            <span class="chapter-words">{{ chapter.wordCount }}{{ $t('generate.wordShort') }}</span>
            <span class="expand-icon">{{ expandedChapter===index?'▼':'▶' }}</span>
          </div>
          <div v-show="expandedChapter===index" class="chapter-body">
            <div class="chapter-content">{{ chapter.content||'内容生成中...' }}</div>
            <div class="chapter-actions">
              <button class="btn-ch action-edit" @click="openEdit(chapter)">{{ $t('novelDetail.btnEdit') }}</button>
              <button class="btn-ch action-del" @click="confirmDeleteChapter(chapter)">🗑 {{ $t('common.delete') }}</button>
              <button class="btn-ch action-deslop" @click="deslopChapter(chapter)">✨ 去AI味</button>
              <button v-if="isLastUnfinished(index)" class="btn-ch action-gen" @click="openGenSettings(chapter.chapterNumber)">{{ $t('novelDetail.btnContinue') }}</button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="allChaptersComplete" class="card">
        <button class="btn btn-primary btn-block" @click="openGenSettings(nextChapterNum)">➕ 生成第{{ nextChapterNum }}章</button>
      </div>

      <div class="card" style="margin-top:8px;">
        <button class="btn btn-outline btn-block" :disabled="deslopAllBusy" @click="deslopAllChapters">
          {{ deslopAllBusy ? '⏳ 整本去AI味中...' : '✨ 整本去AI味' }}
        </button>
        <div v-if="deslopAllProgress" style="margin-top:6px;font-size:12px;color:var(--text-secondary);">
          {{ deslopAllProgress }}
        </div>
      </div>

      <div class="card" style="margin-top:8px;">
        <button class="btn btn-warning btn-block" :disabled="optimizeBusy" @click="optimizeNovel">
          {{ optimizeBusy ? '⏳ 全文调优中...' : '📝 全文调优（修复流水账/重复/伏笔 + 去AI味）' }}
        </button>
        <div v-if="optimizeProgress" style="margin-top:6px;font-size:12px;color:var(--text-secondary);">
          {{ optimizeProgress }}
        </div>
      </div>
    </div>
    <div style="height:20px;"></div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNovelStore } from '../stores/novel'
import { useI18n } from '../composables/useI18n'
import api from '../api'

const route = useRoute()
const router = useRouter()
const novelStore = useNovelStore()
const { $t } = useI18n()

const novel = ref(null)
const expandedChapter = ref(null)
const isContinuing = ref(false)
const continuingChapter = ref(0)
const chapterStreamingText = ref('')
const streamingRef = ref(null)
const showGenSettings = ref(false)
const genWordCount = ref(2000)
const genNotes = ref('')
const genTargetChapter = ref(0)
const showEditModal = ref(false)
const editingChapter = ref(null)
const editContent = ref('')

const statusMap = { generating: $t('novelDetail.generating'), paused: $t('novelDetail.paused'), completed: $t('novelDetail.completed'), error: $t('bookshelf.statusError') }

const lastChapterNum = computed(() => novel.value?.chapters?.length || 0)
const nextChapterNum = computed(() => lastChapterNum.value + 1)
const isLastChapterUnfinished = computed(() => { if (!novel.value || novel.value.status !== 'paused') return false; return novel.value.chapters.length > 0 })
const allChaptersComplete = computed(() => { if (!novel.value) return false; return novel.value.status === 'completed' || novel.value.status === 'paused' })
function isLastUnfinished(index) { if (!novel.value || novel.value.status !== 'paused') return false; return index === novel.value.chapters.length - 1 }

onMounted(async () => {
  try { novel.value = await novelStore.fetchNovelDetail(route.params.id) }
  catch { alert($t('error.unknown')); router.push('/bookshelf') }
})

watch(chapterStreamingText, async () => { await nextTick(); if (streamingRef.value) streamingRef.value.scrollTop = streamingRef.value.scrollHeight })

function toggleChapter(idx) { expandedChapter.value = expandedChapter.value === idx ? null : idx }
function openGenSettings(chapterNum) { genTargetChapter.value = chapterNum; genWordCount.value = 2000; genNotes.value = ''; showGenSettings.value = true }
async function confirmGenSettings() { showGenSettings.value = false; await startChapterGen(genTargetChapter.value, genWordCount.value, genNotes.value) }

async function startChapterGen(chapterNum, wc, notes) {
  isContinuing.value = true; continuingChapter.value = chapterNum; chapterStreamingText.value = ''
  const token = localStorage.getItem('token')
  const xhr = new XMLHttpRequest()
  xhr.open('POST', `/api/novel/${route.params.id}/continue-chapter/${chapterNum}`)
  xhr.setRequestHeader('Authorization', `Bearer ${token}`)
  xhr.setRequestHeader('Content-Type', 'application/json')
  xhr.setRequestHeader('Accept', 'text/event-stream')
  let lastIdx = 0
  xhr.onprogress = () => {
    const newData = xhr.responseText.slice(lastIdx); lastIdx = xhr.responseText.length
    const lines = newData.split('\n').filter(l => l.startsWith('data: '))
    for (const line of lines) {
      try {
        const d = JSON.parse(line.slice(6))
        if (d.type === 'content') chapterStreamingText.value += d.content
        else if (d.type === 'completed' || d.type === 'chapter_continued' || d.type === 'paused') { isContinuing.value = false; refreshNovel() }
        else if (d.type === 'error') { isContinuing.value = false; alert('生成失败:'+d.message) }
      } catch {}
    }
  }
  xhr.onerror = () => { isContinuing.value = false }
  xhr.onabort = () => { isContinuing.value = false; refreshNovel() }
  xhr.send(JSON.stringify({ wordCount: wc, notes }))
  window.__chapterGenXHR = xhr
}
function stopChapterGen() { if (window.__chapterGenXHR) { window.__chapterGenXHR.abort(); window.__chapterGenXHR = null }; isContinuing.value = false }

function openEdit(chapter) { editingChapter.value = chapter; editContent.value = chapter.content || ''; showEditModal.value = true }
async function saveEdit() {
  try { await api.put(`/novel/${route.params.id}/chapter/${editingChapter.value.chapterNumber}`, { content: editContent.value }); showEditModal.value = false; refreshNovel() }
  catch (e) { alert('保存失败:'+(e.response?.data?.message||e.message)) }
}

async function confirmDeleteChapter(ch) {
  if (!confirm(`确定删除第${ch.chapterNumber}章吗？`)) return
  try {
    await api.delete(`/novel/${route.params.id}/chapter/${ch.chapterNumber}`)
    refreshNovel()
  } catch (e) {
    alert('删除失败: ' + (e.response?.data?.message || e.message))
  }
}

async function deslopChapter(chapter) {
  if (!confirm(`对第${chapter.chapterNumber}章进行去AI味处理？`)) return
  try {
    const res = await api.post('/novel/deslop', { text: chapter.content || '' })
    if (res.data.processed) { await api.put(`/novel/${route.params.id}/chapter/${chapter.chapterNumber}`, { content: res.data.processed }); refreshNovel(); alert('✅ 去AI味完成！') }
  } catch (e) { alert('处理失败:'+(e.response?.data?.message||e.message)) }
}

const deslopAllBusy = ref(false)
const deslopAllProgress = ref('')

const optimizeBusy = ref(false)
const optimizeProgress = ref('')

async function optimizeNovel() {
  if (!novel.value?.chapters?.length) return alert('没有章节需要调优')
  if (!confirm(`对《${novel.value.title}》进行全文调优？\n\nAI 将：\n1️⃣ 分析全文问题（流水账/重复/伏笔未回收）\n2️⃣ 逐章优化重写\n3️⃣ 自动去AI味\n\n预计耗时较长（每章约30秒），是否继续？`)) return
  optimizeBusy.value = true
  optimizeProgress.value = '正在分析全文问题...'
  const token = localStorage.getItem('token')
  try {
    const response = await fetch(`/api/novel/optimize/${route.params.id}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      // 按行解析 SSE 事件
      const lines = buf.split('\n')
      buf = lines.pop() || '' // 保留未完成的行
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'progress') {
              optimizeProgress.value = ev.message
            } else if (ev.type === 'completed') {
              alert(ev.message)
              refreshNovel()
              optimizeBusy.value = false
              optimizeProgress.value = ''
            } else if (ev.type === 'error') {
              alert('调优失败: ' + ev.message)
              optimizeBusy.value = false
              optimizeProgress.value = ''
            }
          } catch {}
        }
      }
    }
  } catch (e) {
    alert('全文调优请求失败: ' + e.message)
  }
  optimizeBusy.value = false
  optimizeProgress.value = ''
}

async function deslopAllChapters() {
  const chapters = novel.value?.chapters
  if (!chapters || chapters.length === 0) return alert('没有章节需要处理')
  if (!confirm(`对全部 ${chapters.length} 章进行整本去AI味处理？（每章单独调用AI处理，预计耗时较长）`)) return
  deslopAllBusy.value = true
  deslopAllProgress.value = ''
  let success = 0, fail = 0
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]
    deslopAllProgress.value = `正在处理第 ${i + 1}/${chapters.length} 章...`
    try {
      const res = await api.post('/novel/deslop', { text: ch.content || '' })
      if (res.data.processed) {
        await api.put(`/novel/${route.params.id}/chapter/${ch.chapterNumber}`, { content: res.data.processed })
        success++
      }
    } catch (e) {
      fail++
      console.error(`第${ch.chapterNumber}章去AI味失败:`, e)
    }
  }
  deslopAllBusy.value = false
  refreshNovel()
  alert(`✅ 整本去AI味完成！成功 ${success} 章${fail ? '，失败 ' + fail + ' 章' : ''}`)
}

async function refreshNovel() { try { novel.value = await novelStore.fetchNovelDetail(route.params.id) } catch {} }
function goBack() { router.push('/bookshelf') }
</script>

<style scoped>
.novel-detail-page { height:100%; display:flex; flex-direction:column; }
.detail-header { display:flex; align-items:center; gap:12px; padding:12px 16px; background:var(--card-bg); border-bottom:1px solid var(--border-color); flex-shrink:0; }
.back-btn { background:none; border:none; font-size:16px; color:var(--primary-color); cursor:pointer; padding:4px 8px; }
.detail-title { font-size:16px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.detail-content { flex:1; overflow-y:auto; }
.summary-card { display:flex; flex-direction:column; gap:8px; }
.summary-row { display:flex; justify-content:space-between; align-items:center; }
.summary-label { font-size:13px; color:var(--text-light); }
.section-title { font-size:15px; font-weight:600; margin-bottom:12px; }
.empty-chapters { text-align:center; padding:20px; color:var(--text-light); font-size:14px; }
.chapter-item { border-bottom:1px solid var(--border-color); }
.chapter-header { display:flex; align-items:center; gap:8px; padding:12px 0; cursor:pointer; user-select:none; }
.chapter-num { flex:1; font-size:14px; font-weight:500; color:var(--text-primary); }
.chapter-words { font-size:12px; color:var(--text-light); }
.expand-icon { font-size:10px; color:var(--text-light); }
.chapter-body { padding:0 0 12px; }
.chapter-content { line-height:1.8; font-size:14px; color:var(--text-secondary); white-space:pre-wrap; max-height:300px; overflow-y:auto; padding:8px; background:#fafafa; border-radius:6px; }
.chapter-actions { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
.btn-ch { padding:4px 10px; border-radius:5px; font-size:12px; cursor:pointer; border:1px solid #ddd; background:white; }
.action-edit { color:#1890ff; border-color:#1890ff; }
.action-del { color:#ff4d4f; border-color:#ff4d4f; }
.action-gen { color:#52c41a; border-color:#52c41a; }
.action-deslop { color:#FF6B35; border-color:#FF6B35; }
:global(.gen-overlay) { position:fixed; top:0;left:0;right:0;bottom:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px; }
:global(.gen-modal) { background:white; border-radius:12px; padding:24px; max-width:420px; width:100%; }
:global(.gen-modal h3) { margin-bottom:16px; }
:global(.edit-modal) { max-width:600px; }
.gf { margin-bottom:14px; }
.gf label { display:block; font-size:12px; color:#666; margin-bottom:4px; }
.gf .input, .gf .textarea { width:100%; padding:8px 12px; border:1px solid #ddd; border-radius:6px; font-size:13px; outline:none; }
.gf .textarea { min-height:60px; font-family:inherit; }
.gf-acts { display:flex; gap:8px; margin-top:12px; }
.gf-acts button { flex:1; padding:10px; border:none; border-radius:8px; font-size:14px; cursor:pointer; }
.streaming-card { max-height:350px; display:flex; flex-direction:column; }
.streaming-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
.streaming-content { flex:1; overflow-y:auto; max-height:260px; background:#f9f9f9; border-radius:8px; padding:12px; line-height:1.8; font-size:14px; white-space:pre-wrap; word-wrap:break-word; }
.content-text { display:inline; }
.cursor-blink { display:inline; animation:blink .8s step-end infinite; color:var(--primary-color); font-weight:bold; }
@keyframes blink { 50%{opacity:0} }
.action-card { text-align:center; }
</style>
