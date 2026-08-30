<template>
 <div class="novel-detail-page">
 <div class="detail-header">
 <button class="back-btn" @click="goBack">← {{ $t('common.close') }}</button>
 <h2 class="detail-title">{{ novel?.title || '小说详情' }}</h2>
 </div>
 <div class="detail-content">
 <div class="card summary-card">
 <div class="summary-row"><span class="summary-label">{{ $t('novelDetail.type') }}</span><span>{{ novel?.novelTypeName }}</span></div>
 <div class="summary-row"><span class="summary-label">{{ $t('generate.stepChar') }}</span><span>{{ novel?.protagonistName|| $t('novelDetail.unknown') }}</span></div>
 <div class="summary-row"><span class="summary-label">{{ $t('novelDetail.wordCount') }}</span><span>{{ $t('novelDetail.outOf', { current: novel?.currentWordCount, target: novel?.targetWordCount }) }}</span></div>
 <div class="summary-row"><span class="summary-label">{{ $t('novelDetail.chapterCount') }}</span><span>{{ novel?.currentChapterIndex||0 }} {{ $t('novelDetail.chapter') }}</span></div>
 <div class="summary-row"><span class="summary-label">状态</span><span class="status-badge" :class="novel?.status">{{ statusMap[novel?.status] }}</span></div>
 <div v-if="bookTokenUsage" class="summary-row"><span class="summary-label">Token 消耗</span><span class="token-total">输入 {{ formatTokenCount(bookTokenUsage.inputTokens) }} / 输出 {{ formatTokenCount(bookTokenUsage.outputTokens) }}<span v-if="bookTokenUsage.cacheSavedTokens > 0" class="token-cache">（缓存命中 {{ formatTokenCount(bookTokenUsage.cacheSavedTokens) }}）</span><span v-if="novel?.outlineTokenUsage" class="token-sub">｜大纲：输入 {{ formatTokenCount(novel.outlineTokenUsage.inputTokens) }} / 输出 {{ formatTokenCount(novel.outlineTokenUsage.outputTokens) }}</span></span></div>
 </div>

 <div v-if="novel" class="card pipeline-card">
  <div class="section-title">内容处理链</div>
  <div class="pipeline-hint">正文每次被修订后，摘要、伏笔和续写上下文会同步刷新；各项 AI 操作按你选择的模型线路执行。</div>
  <div class="pipeline-steps">
   <div v-for="step in pipelineSteps" :key="step.id" class="pipeline-step" :class="step.state">
    <span class="pipeline-dot"></span><span class="pipeline-name">{{ step.name }}</span><span class="pipeline-state">{{ step.label }}</span>
   </div>
  </div>
 </div>

 <div v-if="novel" class="card blueprint-card">
 <div class="blueprint-header">
  <div>
   <div class="section-title" style="margin-bottom:4px;"> 动态故事蓝图</div>
   <div class="blueprint-hint">AI 只能提出修改，应用前不会改变后续剧情</div>
  </div>
  <span v-if="pendingBlueprintProposal" class="blueprint-badge">待确认</span>
 </div>
 <div class="blueprint-main"><span class="blueprint-label">当前主线</span>{{ blueprint?.mainArc || novel.outline || '按已确认大纲推进' }}</div>
 <div v-if="blueprint?.phases?.length" class="blueprint-phases">
  <div v-for="phase in blueprint.phases.slice(0, 3)" :key="`${phase.title}-${phase.startChapter}`" class="blueprint-phase">
   <span>第{{ phase.startChapter }}-{{ phase.endChapter }}章</span><strong>{{ phase.title }}</strong>
   <small v-if="phase.goal">{{ phase.goal }}</small>
  </div>
 </div>
 <div class="blueprint-actions">
  <button class="btn btn-outline btn-sm" :disabled="blueprintLoading || blueprintReviewing" @click="reviewBlueprint">{{ blueprintReviewing ? ' 正在分析剧情...' : ' 请求 AI 提出调整' }}</button>
  <label class="blueprint-toggle"><input type="checkbox" :checked="blueprint?.autoReviewEnabled" @change="toggleBlueprintReview" /> 每 6 章提醒我审核</label>
  <label class="blueprint-toggle"><input type="checkbox" :checked="blueprint?.emailReminderEnabled !== false" @change="toggleBlueprintEmail" /> 重要提案发邮件</label>
 </div>
 <div v-if="blueprintError" class="blueprint-error">{{ blueprintError }}</div>
 <div v-if="pendingBlueprintProposal" class="blueprint-proposal">
  <div class="proposal-title">{{ pendingBlueprintProposal.title || '剧情蓝图优化建议' }} <span v-if="pendingBlueprintProposal.significance === 'major'" class="proposal-major">重要变更</span></div>
  <p>{{ pendingBlueprintProposal.summary }}</p>
  <div v-if="pendingBlueprintProposal.rationale" class="proposal-reason">原因：{{ pendingBlueprintProposal.rationale }}</div>
  <div v-for="(change, index) in pendingBlueprintProposal.changes" :key="index" class="proposal-change">
   <div><strong>{{ change.field }}</strong><span v-if="change.impact"> · {{ change.impact }}</span></div>
   <div class="proposal-before">当前：{{ change.before }}</div>
   <div class="proposal-after">建议：{{ change.after }}</div>
  </div>
  <div v-if="pendingBlueprintProposal.affectedChapters?.length" class="proposal-impact">影响后续章节：第{{ pendingBlueprintProposal.affectedChapters.join('、') }}章</div>
  <div v-if="pendingBlueprintProposal.tokenUsage" class="proposal-token">本次蓝图分析消耗：输入 {{ formatTokenCount(pendingBlueprintProposal.tokenUsage.inputTokens) }} / 输出 {{ formatTokenCount(pendingBlueprintProposal.tokenUsage.outputTokens) }} token</div>
  <div class="blueprint-actions proposal-actions">
   <button class="btn btn-outline btn-sm" :disabled="blueprintDecisionBusy" @click="decideBlueprint('reject')">拒绝</button>
   <button class="btn btn-primary btn-sm" :disabled="blueprintDecisionBusy" @click="decideBlueprint('apply')">{{ blueprintDecisionBusy ? '处理中...' : '应用到后续生成' }}</button>
  </div>
 </div>
 </div>

 <Teleport to="body">
 <div v-if="showGenSettings" class="gen-overlay" @click.self="showGenSettings=false">
 <div class="gen-modal">
 <h3>️ 生成设置</h3>
 <div class="gf"><label>{{ $t('continue.wordCount') }}</label>
 <input v-model.number="genWordCount" class="input" type="number" min="500" max="8000" step="500" />
 </div>
 <div class="gf"><label>生成备注</label>
 <textarea v-model="genNotes" class="textarea" rows="3" placeholder="描述接下来要写的内容方向（选填）"></textarea>
 </div>
 <div class="gf-acts">
 <button class="btn btn-outline" @click="showGenSettings=false">{{ $t('common.cancel') }}</button>
 <button class="btn btn-primary" :disabled="isContinuing" :aria-busy="isContinuing" @click="confirmGenSettings">{{ isContinuing ? '正在启动...' : '开始生成' }}</button>
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
 <button class="btn btn-primary" :disabled="savingEdit || !editContent.trim()" :aria-busy="savingEdit" @click="saveEdit">{{ savingEdit ? $t('common.loading') : $t('common.save') }}</button>
 </div>
 </div>
 </div>
 </Teleport>

 <Teleport to="body">
 <div v-if="showKeywordsDialog" class="gen-overlay" @click.self="showKeywordsDialog=false">
 <div class="gen-modal kw-modal">
 <h3> 第{{ keywordsChapterNum }}章 — 生图关键字</h3>
 <div class="kw-section">
 <div class="kw-label"> 人物画风关键字</div>
 <div v-if="kwLoading" class="kw-loading">正在分析...</div>
 <div v-else class="kw-content">{{ keywordsData.characterKeywords || '无' }}</div>
 </div>
 <div class="kw-section">
 <div class="kw-label">️ 场景关键字</div>
 <div v-if="kwLoading" class="kw-loading">正在分析...</div>
 <div v-else class="kw-content">{{ keywordsData.sceneKeywords || '无' }}</div>
 </div>
 <div v-if="kwError" class="kw-error">{{ kwError }}</div>
 <div class="gf-acts">
 <button class="btn btn-outline" @click="showKeywordsDialog=false">关闭</button>
 <button class="btn btn-primary" :disabled="kwLoading" @click="copyKeywords"> 复制关键字</button>
 </div>
 </div>
 </div>
 </Teleport>

 <div v-if="isLastChapterUnfinished" class="card action-card">
 <button class="btn btn-primary btn-block" @click="openGenSettings(lastChapterNum)">▶ 继续生成第{{ lastChapterNum }}章</button>
 </div>

 <div v-if="isContinuing" class="card streaming-card">
 <div class="streaming-header">
 <span class="section-title"> {{ $t('bookshelf.aiWriting') }}（第{{ continuingChapter }}章）</span>
 <span class="generating-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>
 </div>
 <div class="streaming-content" ref="streamingRef">
 <div v-if="!chapterStreamingText && chapterThinkingLen > 0" style="color:#8a8f98;font-size:13px;margin-bottom:8px;">{{ $t('bookshelf.thinking', { words: chapterThinkingLen }) }}</div>
 <div class="content-text">{{ chapterStreamingText }}</div>
 <div class="cursor-blink">|</div>
 </div>
 <button class="btn btn-outline btn-sm" style="margin-top:8px;" @click="stopChapterGen">{{ $t('bookshelf.pause') }}</button>
 </div>

 <div class="card">
 <div class="section-title"> 章节列表</div>
 <div v-if="!novel?.chapters?.length" class="empty-chapters">暂无章节内容</div>
 <div v-for="(chapter, index) in novel?.chapters" :key="chapter.chapterNumber" class="chapter-item">
 <div class="chapter-header" @click="toggleChapter(index)">
 <span class="chapter-num">{{ chapter.title || `第${chapter.chapterNumber}章` }}</span>
 <span v-if="chapterTokens(chapter)" class="chapter-tokens" title="本章生成消耗（含审稿/修订时另计）">⚡{{ formatTokenCount(chapterTokens(chapter).inputTokens) }}↑ / {{ formatTokenCount(chapterTokens(chapter).outputTokens) }}↓</span>
 <span class="chapter-words">{{ chapter.wordCount }}{{ $t('generate.wordShort') }}</span>
 <span class="expand-icon">{{ expandedChapter===index?'▼':'▶' }}</span>
 </div>
 <div v-show="expandedChapter===index" class="chapter-body">
 <div class="chapter-content">{{ chapter.content||'内容生成中...' }}</div>
 <div v-if="chapterTokens(chapter)" class="chapter-token-detail">
 <span>本章 token：输入 {{ formatTokenCount(chapterTokens(chapter).inputTokens) }}</span>
 <span>输出 {{ formatTokenCount(chapterTokens(chapter).outputTokens) }}</span>
 <span v-if="chapterTokens(chapter).cacheSavedTokens > 0">缓存命中 {{ formatTokenCount(chapterTokens(chapter).cacheSavedTokens) }}</span>
 <span v-if="chapterTokenRoles(chapter).length" class="token-roles">{{ chapterTokenRoles(chapter) }}</span>
 </div>
 <div class="chapter-actions">
 <button class="btn-ch action-edit" :disabled="chapterActionBusy || isContinuing" @click="openEdit(chapter)">{{ $t('novelDetail.btnEdit') }}</button>
 <button class="btn-ch action-del" :disabled="chapterActionBusy || isContinuing" @click="confirmDeleteChapter(chapter)"> {{ chapterActionBusy === `delete:${chapter.chapterNumber}` ? $t('common.loading') : $t('common.delete') }}</button>
 <button class="btn-ch action-deslop" :disabled="chapterActionBusy || isContinuing" @click="deslopChapter(chapter)"> {{ chapterActionBusy === `deslop:${chapter.chapterNumber}` ? $t('common.loading') : '去AI味' }}</button>
 <button class="btn-ch action-keywords" :disabled="chapterActionBusy || isContinuing" @click="generateKeywords(chapter)"> {{ chapterActionBusy === `keywords:${chapter.chapterNumber}` ? '分析中...' : '总结关键字' }}</button>
 <button v-if="isLastUnfinished(index)" class="btn-ch action-gen" :disabled="chapterActionBusy || isContinuing" @click="openGenSettings(chapter.chapterNumber)">{{ $t('novelDetail.btnContinue') }}</button>
 </div>
 </div>
 </div>
 </div>

 <div v-if="allChaptersComplete" class="card">
 <button class="btn btn-primary btn-block" @click="openGenSettings(nextChapterNum)"> 生成第{{ nextChapterNum }}章</button>
 </div>

 <div class="card" style="margin-top:8px;">
 <button class="btn btn-outline btn-block" :disabled="deslopAllBusy" @click="deslopAllChapters">
 {{ deslopAllBusy ? '⏳ 整本去AI味中...' : ' 整本去AI味' }}
 </button>
 <div v-if="deslopAllProgress" style="margin-top:6px;font-size:12px;color:var(--text-secondary);">
 {{ deslopAllProgress }}
 </div>
 </div>

 <div class="card" style="margin-top:8px;">
 <button class="btn btn-warning btn-block" :disabled="optimizeBusy" @click="optimizeNovel">
 {{ optimizeBusy ? '⏳ 全文调优中...' : ' 全文调优（修复流水账/重复/伏笔 + 去AI味）' }}
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
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
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
const chapterThinkingLen = ref(0)
const streamingRef = ref(null)
const showGenSettings = ref(false)
const genWordCount = ref(2000)
const genNotes = ref('')
const genTargetChapter = ref(0)
const showEditModal = ref(false)
const editingChapter = ref(null)
const editContent = ref('')
const savingEdit = ref(false)
const chapterActionBusy = ref('')

const statusMap = { generating: $t('novelDetail.generating'), paused: $t('novelDetail.paused'), completed: $t('novelDetail.completed'), error: $t('bookshelf.statusError') }

// 章节关键字总结
const showKeywordsDialog = ref(false)
const keywordsChapterNum = ref(0)
const kwLoading = ref(false)
const kwError = ref('')
const keywordsData = ref({ characterKeywords: '', sceneKeywords: '' })

// 动态故事蓝图
const blueprint = ref(null)
const blueprintProposals = ref([])
const blueprintLoading = ref(false)
const blueprintReviewing = ref(false)
const blueprintDecisionBusy = ref(false)
const blueprintError = ref('')
const pendingBlueprintProposal = computed(() => blueprintProposals.value.find((proposal) => proposal.status === 'pending') || null)

const pipelineSteps = computed(() => {
 const chapters = novel.value?.chapters || []
 const revisionCount = chapters.reduce((sum, chapter) => sum + (Array.isArray(chapter.qualityReport?.revisions) ? chapter.qualityReport.revisions.length : 0), 0)
 const editorial = novel.value?.editorialTask
 const optimize = novel.value?.optimizeTask
 return [
  { id: 'generate', name: '正文生成', state: chapters.length ? 'done' : 'idle', label: chapters.length ? `${chapters.length} 章` : '未开始' },
  { id: 'context', name: '事实与上下文', state: novel.value?.contextMemory?.checkpointChapter ? 'done' : 'idle', label: novel.value?.contextMemory?.checkpointChapter ? '已同步' : '待同步' },
  { id: 'revision', name: '去 AI 味 / 手动修订', state: revisionCount ? 'done' : 'idle', label: revisionCount ? `${revisionCount} 次应用` : '可选' },
  { id: 'editorial', name: '编辑引擎', state: editorial?.status === 'running' ? 'running' : editorial?.status === 'completed' ? 'done' : editorial?.partial ? 'partial' : 'idle', label: editorial?.status === 'running' ? '处理中' : editorial?.status === 'completed' ? '已应用' : editorial?.partial ? '部分应用' : '可选' },
  { id: 'optimize', name: '全文调优', state: optimize?.status === 'analyzing' || optimize?.status === 'optimizing' ? 'running' : optimize?.status === 'completed' ? 'done' : optimize?.partial ? 'partial' : 'idle', label: optimize?.status === 'analyzing' || optimize?.status === 'optimizing' ? '处理中' : optimize?.status === 'completed' ? '已应用' : optimize?.partial ? '部分应用' : '可选' },
 ]
})

const lastChapterNum = computed(() => novel.value?.chapters?.length || 0)

// ====== token 用量展示 =====
// 账本有数据（calls>0）才显示；旧作品没有 tokenUsage 时保持原有界面。
const bookTokenUsage = computed(() => {
  const usage = novel.value?.tokenUsage
  if (!usage || !Number(usage.calls)) return null
  return usage
})
function chapterTokens(chapter) {
  const tokens = chapter?.qualityReport?.tokens
  if (!tokens || !Number(tokens.calls)) return null
  return tokens
}
const ROLE_LABELS = { writing: '正文', reasoning: '审稿', polish: '润色', outline: '大纲' }
function chapterTokenRoles(chapter) {
  const tokens = chapterTokens(chapter)
  if (!tokens?.byRole) return ''
  return Object.entries(tokens.byRole)
    .filter(([, value]) => value?.calls > 0)
    .map(([role, value]) => `${ROLE_LABELS[role] || role} ${formatTokenCount(value.inputTokens)}↓↑${formatTokenCount(value.outputTokens)}`)
    .join(' · ')
}
function formatTokenCount(value) {
  const number = Number(value) || 0
  if (number >= 1000000) return `${(number / 1000000).toFixed(2)}M`
  if (number >= 10000) return `${(number / 10000).toFixed(1)}万`
  if (number >= 1000) return `${(number / 1000).toFixed(1)}k`
  return String(number)
}
const nextChapterNum = computed(() => lastChapterNum.value + 1)
const isLastChapterUnfinished = computed(() => { if (!novel.value || novel.value.status !== 'paused') return false; return novel.value.chapters.length > 0 })
const allChaptersComplete = computed(() => { if (!novel.value) return false; return novel.value.status === 'completed' || novel.value.status === 'paused' })
function isLastUnfinished(index) { if (!novel.value || novel.value.status !== 'paused') return false; return index === novel.value.chapters.length - 1 }

onMounted(async () => {
 try {
 novel.value = await novelStore.fetchNovelDetail(route.params.id)
 await loadBlueprint()
 // 检查是否有正在运行或刚完成的后台调优任务
 if (novel.value?.optimizeTask) {
 const task = novel.value.optimizeTask
 if (task.status === 'analyzing' || task.status === 'optimizing') {
 optimizeBusy.value = true
 optimizeProgress.value = task.progress || '后台任务运行中...'
 startPollingOptimize()
 } else if (task.status === 'completed' && task.optimizedCount > 0) {
 // 任务在用户离开时已完成，刷新章节内容并提示
 refreshNovel()
 setTimeout(() => {
 alert('全文调优已在后台完成！' + (task.progress || ''))
 }, 300)
 }
 }
 }
 catch { alert($t('error.unknown')); router.push('/bookshelf') }
})

onUnmounted(() => {
 stopPollingOptimize()
})

watch(chapterStreamingText, async () => { await nextTick(); if (streamingRef.value) streamingRef.value.scrollTop = streamingRef.value.scrollHeight })

function toggleChapter(idx) { expandedChapter.value = expandedChapter.value === idx ? null : idx }
function openGenSettings(chapterNum) { if (!isContinuing.value && !chapterActionBusy.value) { genTargetChapter.value = chapterNum; genWordCount.value = 2000; genNotes.value = ''; showGenSettings.value = true } }

async function loadBlueprint() {
 blueprintLoading.value = true
 blueprintError.value = ''
 try {
  const res = await api.get(`/novel/${route.params.id}/blueprint`)
  blueprint.value = res.data.blueprint || null
  blueprintProposals.value = res.data.proposals || []
 } catch (e) {
  blueprintError.value = e.response?.data?.message || '动态故事蓝图加载失败'
 } finally { blueprintLoading.value = false }
}

async function reviewBlueprint() {
 blueprintReviewing.value = true; blueprintError.value = ''
 try {
  const res = await api.post(`/novel/${route.params.id}/blueprint/review`)
  if (res.data.proposal) {
   blueprintProposals.value = [res.data.proposal, ...blueprintProposals.value.filter((item) => item.id !== res.data.proposal.id)]
  } else if (res.data.message) alert(res.data.message)
 } catch (e) {
  blueprintError.value = e.response?.data?.message || '剧情审核失败，请稍后重试'
 } finally { blueprintReviewing.value = false }
}

async function toggleBlueprintReview(event) {
 blueprintError.value = ''
 try {
  const res = await api.put(`/novel/${route.params.id}/blueprint/settings`, { autoReviewEnabled: event.target.checked })
  blueprint.value = res.data.blueprint
 } catch (e) {
  event.target.checked = !event.target.checked
  blueprintError.value = e.response?.data?.message || '保存提醒设置失败'
 }
}

async function toggleBlueprintEmail(event) {
 blueprintError.value = ''
 try {
  const res = await api.put(`/novel/${route.params.id}/blueprint/settings`, { emailReminderEnabled: event.target.checked })
  blueprint.value = res.data.blueprint
 } catch (e) {
  event.target.checked = !event.target.checked
  blueprintError.value = e.response?.data?.message || '保存邮件提醒设置失败'
 }
}

async function decideBlueprint(decision) {
 if (!pendingBlueprintProposal.value) return
 if (decision === 'apply' && !confirm('应用后，后续章节将按新的故事蓝图生成，已经写完的章节不会被修改。确定应用吗？')) return
 blueprintDecisionBusy.value = true; blueprintError.value = ''
 try {
  const proposal = pendingBlueprintProposal.value
  const res = await api.post(`/novel/${route.params.id}/blueprint/proposals/${proposal.id}/decision`, { decision })
  blueprint.value = res.data.blueprint || blueprint.value
  blueprintProposals.value = blueprintProposals.value.map((item) => item.id === proposal.id ? res.data.proposal : item)
  alert(res.data.message)
 } catch (e) {
  blueprintError.value = e.response?.data?.message || '处理剧情提案失败'
 } finally { blueprintDecisionBusy.value = false }
}
async function confirmGenSettings() { if (isContinuing.value) return; showGenSettings.value = false; await startChapterGen(genTargetChapter.value, genWordCount.value, genNotes.value) }

async function startChapterGen(chapterNum, wc, notes) {
 isContinuing.value = true; continuingChapter.value = chapterNum; chapterStreamingText.value = ''; chapterThinkingLen.value = 0
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
 else if (d.type === 'thinking') chapterThinkingLen.value = d.length || 0
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

function openEdit(chapter) { if (!chapterActionBusy.value && !isContinuing.value) { editingChapter.value = chapter; editContent.value = chapter.content || ''; showEditModal.value = true } }
async function saveEdit() {
 if (savingEdit.value || !editingChapter.value || !editContent.value.trim()) return
 savingEdit.value = true
 try { await api.put(`/novel/${route.params.id}/chapter/${editingChapter.value.chapterNumber}`, { content: editContent.value }); showEditModal.value = false; await refreshNovel() }
 catch (e) { alert('保存失败:'+(e.response?.data?.message||e.message)) }
 finally { savingEdit.value = false }
}

async function confirmDeleteChapter(ch) {
 if (!confirm(`确定删除第${ch.chapterNumber}章吗？`)) return
 chapterActionBusy.value = `delete:${ch.chapterNumber}`
 try {
 await api.delete(`/novel/${route.params.id}/chapter/${ch.chapterNumber}`)
 await refreshNovel()
 } catch (e) {
 alert('删除失败: ' + (e.response?.data?.message || e.message))
 } finally { chapterActionBusy.value = '' }
}

async function deslopChapter(chapter) {
 if (!confirm(`对第${chapter.chapterNumber}章进行去AI味处理？`)) return
 chapterActionBusy.value = `deslop:${chapter.chapterNumber}`
 try {
 const res = await api.post('/novel/deslop', { text: chapter.content || '', novelId: route.params.id }, { timeout: 1200000 })
 if (res.data.processed) { await api.put(`/novel/${route.params.id}/chapter/${chapter.chapterNumber}`, { content: res.data.processed, source: 'deslop' }); await refreshNovel(); alert(' 去AI味完成，后续续写上下文已同步！') }
 } catch (e) { alert('处理失败:'+(e.response?.data?.message||e.message)) }
 finally { chapterActionBusy.value = '' }
}

async function generateKeywords(chapter) {
 keywordsChapterNum.value = chapter.chapterNumber
 keywordsData.value = { characterKeywords: '', sceneKeywords: '' }
 kwError.value = ''
 chapterActionBusy.value = `keywords:${chapter.chapterNumber}`
 kwLoading.value = true
 showKeywordsDialog.value = true
 try {
 const res = await api.post(`/novel/chapter-keywords/${route.params.id}/${chapter.chapterNumber}`, null, { timeout: 1200000 })
 keywordsData.value = res.data
 } catch (e) {
 kwError.value = e.response?.data?.message || e.message || '关键字生成失败'
 } finally {
 kwLoading.value = false
 chapterActionBusy.value = ''
 }
}

function copyKeywords() {
 const text = `【人物画风关键字】\n${keywordsData.value.characterKeywords}\n\n【场景关键字】\n${keywordsData.value.sceneKeywords}`
 navigator.clipboard.writeText(text).then(() => {
 alert(' 关键字已复制到剪贴板')
 }).catch(() => {
 // 降级：创建临时 textarea
 const ta = document.createElement('textarea')
 ta.value = text
 document.body.appendChild(ta)
 ta.select()
 document.execCommand('copy')
 document.body.removeChild(ta)
 alert(' 关键字已复制到剪贴板')
 })
}

const deslopAllBusy = ref(false)
const deslopAllProgress = ref('')

const optimizeBusy = ref(false)
const optimizeProgress = ref('')
let optimizePollTimer = null

async function optimizeNovel() {
 if (!novel.value?.chapters?.length) return alert('没有章节需要调优')
 if (!confirm(`对《${novel.value.title}》进行全文调优？\n\nAI 将：\n1️⃣ 分析全文问题（流水账/重复/伏笔未回收）\n2️⃣ 逐章优化重写\n3️⃣ 自动去AI味\n\n任务将在后台运行，即使关闭页面或断网也不中断。\n是否继续？`)) return
 optimizeBusy.value = true
 optimizeProgress.value = '正在启动调优任务...'
 try {
 const res = await api.post(`/novel/optimize/${route.params.id}`)
 optimizeProgress.value = '任务已启动，正在后台分析...'
 startPollingOptimize()
 } catch (e) {
 alert('启动失败: ' + (e.response?.data?.message || e.message))
 optimizeBusy.value = false
 optimizeProgress.value = ''
 }
}

function startPollingOptimize() {
 stopPollingOptimize()
 optimizePollTimer = setInterval(async () => {
 try {
 const res = await api.post(`/novel/optimize-status/${route.params.id}`)
 const task = res.data.task
 if (!task || task.status === 'idle') return
 optimizeProgress.value = task.progress || ''
 if (task.status === 'completed') {
 stopPollingOptimize()
 optimizeBusy.value = false
 optimizeProgress.value = ''
 refreshNovel()
 alert(task.progress || ' 全文调优完成！')
 } else if (task.status === 'error') {
 stopPollingOptimize()
 optimizeBusy.value = false
 optimizeProgress.value = ''
 alert('调优失败: ' + (task.error || task.progress))
 }
 // 'analyzing' 和 'optimizing' 状态继续轮询
 } catch (e) {
 // 轮询出错不弹窗，继续尝试
 console.error('轮询调优状态失败:', e)
 }
 }, 3000)
}

function stopPollingOptimize() {
 if (optimizePollTimer) {
 clearInterval(optimizePollTimer)
 optimizePollTimer = null
 }
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
 const res = await api.post('/novel/deslop', { text: ch.content || '', novelId: route.params.id }, { timeout: 1200000 })
 if (res.data.processed) {
 await api.put(`/novel/${route.params.id}/chapter/${ch.chapterNumber}`, { content: res.data.processed, source: 'deslop' })
 success++
 }
 } catch (e) {
 fail++
 console.error(`第${ch.chapterNumber}章去AI味失败:`, e)
 }
 }
 deslopAllBusy.value = false
 refreshNovel()
 alert(` 整本去AI味完成！成功 ${success} 章${fail ? '，失败 ' + fail + ' 章' : ''}`)
}

async function refreshNovel() { try { novel.value = await novelStore.fetchNovelDetail(route.params.id); await loadBlueprint() } catch {} }
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
.chapter-num { flex:1; min-width:0; font-size:14px; font-weight:500; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.chapter-words { font-size:12px; color:var(--text-light); }
.chapter-tokens { font-size:12px; color:var(--text-light); background:var(--bg); padding:2px 8px; border-radius:10px; white-space:nowrap; }
.chapter-token-detail { display:flex; flex-wrap:wrap; gap:10px; margin-top:8px; padding:6px 10px; background:var(--bg); border-radius:6px; font-size:12px; color:var(--text-light); }
.chapter-token-detail .token-roles { color:var(--text-secondary); }
.token-total { font-size:13px; }
.token-cache { color:var(--success); }
.token-sub { color:var(--text-light); font-size:12px; }
.proposal-token { margin-top:8px; font-size:12px; color:var(--text-light); }
.expand-icon { font-size:10px; color:var(--text-light); }
.chapter-body { padding:0 0 12px; }
.chapter-content { line-height:1.8; font-size:14px; color:var(--text-secondary); white-space:pre-wrap; max-height:300px; overflow-y:auto; padding:8px; background:var(--bg); border-radius:6px; }
.chapter-actions { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
.btn-ch { padding:4px 10px; border-radius:5px; font-size:12px; cursor:pointer; border:1px solid var(--card-border); background:var(--card); }
.action-edit { color:var(--info); border-color:var(--info); }
.action-del { color:#ff4d4f; border-color:#ff4d4f; }
.action-gen { color:var(--success); border-color:var(--success); }
.action-deslop { color:var(--accent-hover); border-color:var(--accent); }
.action-keywords { color:var(--primary); border-color:var(--primary); }
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
.kw-modal { max-width:520px; }
.kw-section { margin-bottom:16px; }
.kw-label { font-size:14px; font-weight:600; margin-bottom:6px; color:var(--text-primary); }
.kw-content { font-size:13px; line-height:1.8; color:var(--text-secondary); background:var(--primary-light); border-radius:8px; padding:12px; white-space:pre-wrap; word-break:break-all; border:1px solid var(--primary-subtle); }
.kw-loading { font-size:13px; color:#999; padding:12px; text-align:center; }
.kw-error { font-size:13px; color:#ff4d4f; padding:8px 12px; background:#fff2f0; border-radius:6px; margin-bottom:12px; }
.blueprint-card { margin-top: 8px; }
.pipeline-card { margin-top: 8px; }
.pipeline-hint { color: var(--text-light); font-size: 12px; line-height: 1.6; margin: -4px 0 10px; }
.pipeline-steps { display: grid; gap: 7px; }
.pipeline-step { display: grid; grid-template-columns: 9px 1fr auto; align-items: center; gap: 8px; font-size: 12px; }
.pipeline-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border-color); }
.pipeline-step.done .pipeline-dot { background: var(--success); }
.pipeline-step.running .pipeline-dot { background: var(--warning); }
.pipeline-step.partial .pipeline-dot { background: var(--accent); }
.pipeline-name { color: var(--text-primary); }
.pipeline-state { color: var(--text-light); }
.blueprint-header { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
.blueprint-hint { color:var(--text-light); font-size:12px; }
.blueprint-badge, .proposal-major { color:#ad6800; background:#fff7e6; border:1px solid #ffd591; border-radius:10px; padding:2px 8px; font-size:11px; white-space:nowrap; }
.blueprint-main { margin-top:10px; color:var(--text-secondary); line-height:1.7; font-size:13px; }
.blueprint-label { color:var(--text-light); margin-right:8px; }
.blueprint-phases { display:flex; gap:8px; margin-top:10px; overflow-x:auto; }
.blueprint-phase { min-width:160px; padding:8px 10px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg); display:flex; flex-direction:column; gap:3px; }
.blueprint-phase span, .blueprint-phase small { color:var(--text-light); font-size:11px; }
.blueprint-phase strong { font-size:13px; color:var(--text-primary); }
.blueprint-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:12px; }
.blueprint-toggle { font-size:12px; color:var(--text-secondary); display:flex; align-items:center; gap:5px; }
.blueprint-error { margin-top:8px; color:#cf1322; background:#fff1f0; border-radius:6px; padding:7px 9px; font-size:12px; }
.blueprint-proposal { margin-top:12px; padding:12px; border:1px solid #91caff; border-radius:10px; background:#f0f7ff; }
.proposal-title { font-weight:600; color:var(--text-primary); }
.proposal-title .proposal-major { margin-left:6px; font-weight:400; }
.blueprint-proposal p { margin:7px 0; color:var(--text-secondary); font-size:13px; line-height:1.6; }
.proposal-reason, .proposal-impact { color:var(--text-light); font-size:12px; line-height:1.5; }
.proposal-change { margin-top:8px; padding:8px; border-radius:7px; background:var(--card-bg); font-size:12px; line-height:1.55; }
.proposal-before { color:var(--text-light); }
.proposal-after { color:#0958d9; }
.proposal-actions { justify-content:flex-end; }
</style>
