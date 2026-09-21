<template>
 <div class="novel-detail-page">
 <div class="detail-header">
 <button class="back-btn" @click="goBack">← {{ $t('common.close') }}</button>
 <h2 class="detail-title">{{ novel?.title || $t('novelDetail.defaultTitle') }}</h2>
 </div>
 <div class="detail-content">
 <div v-if="loading" class="detail-loading">
 <div class="loading-spinner"></div>
 <div class="detail-loading-text">{{ $t('common.loading') }}</div>
 </div>
 <div v-if="novel" class="card summary-card">
 <div class="summary-row"><span class="summary-label">{{ $t('novelDetail.type') }}</span><span>{{ novel?.novelTypeName }}</span></div>
 <div class="summary-row"><span class="summary-label">{{ $t('generate.stepChar') }}</span><span>{{ novel?.protagonistName|| $t('novelDetail.unknown') }}</span></div>
 <div class="summary-row"><span class="summary-label">{{ $t('novelDetail.wordCount') }}</span><span>{{ $t('novelDetail.outOf', { current: novel?.currentWordCount, target: novel?.targetWordCount }) }}</span></div>
 <div class="summary-row"><span class="summary-label">{{ $t('novelDetail.chapterCount') }}</span><span>{{ novel?.currentChapterIndex||0 }} {{ $t('novelDetail.chapter') }}</span></div>
 <div class="summary-row"><span class="summary-label">{{ $t('novelDetail.status') }}</span><span class="status-badge" :class="novel?.status">{{ statusMap[novel?.status] }}</span></div>
 <div v-if="bookTokenUsage" class="summary-row"><span class="summary-label">{{ $t('novelDetail.tokenUsage') }}</span><span class="token-total">{{ $t('novelDetail.input') }} {{ formatTokenCount(bookTokenUsage.inputTokens) }} / {{ $t('novelDetail.output') }} {{ formatTokenCount(bookTokenUsage.outputTokens) }}<span v-if="bookTokenUsage.cacheSavedTokens > 0" class="token-cache">（{{ $t('novelDetail.cacheHit') }} {{ formatTokenCount(bookTokenUsage.cacheSavedTokens) }}）</span><span v-if="novel?.outlineTokenUsage" class="token-sub">｜{{ $t('novelDetail.outlineLabel') }}：{{ $t('novelDetail.input') }} {{ formatTokenCount(novel.outlineTokenUsage.inputTokens) }} / {{ $t('novelDetail.output') }} {{ formatTokenCount(novel.outlineTokenUsage.outputTokens) }}</span></span></div>
 </div>

 <div v-if="novel" class="card pipeline-card">
  <div class="section-title">{{ $t('novelDetail.pipelineTitle') }}</div>
  <div class="pipeline-hint">{{ $t('novelDetail.pipelineHint') }}</div>
  <div class="pipeline-steps">
   <div v-for="step in pipelineSteps" :key="step.id" class="pipeline-step" :class="step.state">
    <span class="pipeline-dot"></span><span class="pipeline-name">{{ step.name }}</span><span class="pipeline-state">{{ step.label }}</span>
   </div>
  </div>
 </div>

 <div v-if="novel" class="card blueprint-card">
 <div class="blueprint-header">
  <div>
   <div class="section-title" style="margin-bottom:4px;"> {{ $t('novelDetail.blueprintTitle') }}</div>
   <div class="blueprint-hint">{{ $t('novelDetail.blueprintHint') }}</div>
  </div>
  <span v-if="pendingBlueprintProposal" class="blueprint-badge">{{ $t('novelDetail.blueprintPending') }}</span>
 </div>
 <div class="blueprint-main"><span class="blueprint-label">{{ $t('novelDetail.blueprintMainArc') }}</span>{{ blueprint?.mainArc || novel.outline || $t('novelDetail.blueprintFollowOutline') }}</div>
 <div v-if="blueprint?.phases?.length" class="blueprint-phases">
  <div v-for="phase in blueprint.phases.slice(0, 3)" :key="`${phase.title}-${phase.startChapter}`" class="blueprint-phase">
   <span>{{ $t('novelDetail.chapterRange', { start: phase.startChapter, end: phase.endChapter }) }}</span><strong>{{ phase.title }}</strong>
   <small v-if="phase.goal">{{ phase.goal }}</small>
  </div>
 </div>
 <div class="blueprint-actions">
  <button class="btn btn-outline btn-sm" :disabled="blueprintLoading || blueprintReviewing" @click="reviewBlueprint">{{ blueprintReviewing ? $t('novelDetail.blueprintReviewing') : $t('novelDetail.blueprintAskAdjust') }}</button>
  <label class="blueprint-toggle"><input type="checkbox" :checked="blueprint?.autoReviewEnabled" @change="toggleBlueprintReview" /> {{ $t('novelDetail.blueprintRemindEvery6') }}</label>
  <label class="blueprint-toggle"><input type="checkbox" :checked="blueprint?.emailReminderEnabled !== false" @change="toggleBlueprintEmail" /> {{ $t('novelDetail.blueprintEmailMajor') }}</label>
 </div>
 <div v-if="blueprintError" class="blueprint-error">{{ blueprintError }}</div>
 <div v-if="pendingBlueprintProposal" class="blueprint-proposal">
  <div class="proposal-title">{{ pendingBlueprintProposal.title || $t('novelDetail.blueprintProposalTitle') }} <span v-if="pendingBlueprintProposal.significance === 'major'" class="proposal-major">{{ $t('novelDetail.blueprintMajorChange') }}</span></div>
  <p>{{ pendingBlueprintProposal.summary }}</p>
  <div v-if="pendingBlueprintProposal.rationale" class="proposal-reason">{{ $t('novelDetail.proposalReason') }}{{ pendingBlueprintProposal.rationale }}</div>
  <div v-for="(change, index) in pendingBlueprintProposal.changes" :key="index" class="proposal-change">
   <div><strong>{{ change.field }}</strong><span v-if="change.impact"> · {{ change.impact }}</span></div>
   <div class="proposal-before">{{ $t('novelDetail.proposalBefore') }}{{ change.before }}</div>
   <div class="proposal-after">{{ $t('novelDetail.proposalAfter') }}{{ change.after }}</div>
  </div>
  <div v-if="pendingBlueprintProposal.affectedChapters?.length" class="proposal-impact">{{ $t('novelDetail.impactChapters', { list: pendingBlueprintProposal.affectedChapters.join('、') }) }}</div>
  <div v-if="pendingBlueprintProposal.tokenUsage" class="proposal-token">{{ $t('novelDetail.proposalTokenLabel') }}{{ $t('novelDetail.input') }} {{ formatTokenCount(pendingBlueprintProposal.tokenUsage.inputTokens) }} / {{ $t('novelDetail.output') }} {{ formatTokenCount(pendingBlueprintProposal.tokenUsage.outputTokens) }} token</div>
  <div class="blueprint-actions proposal-actions">
   <button class="btn btn-outline btn-sm" :disabled="blueprintDecisionBusy" @click="decideBlueprint('reject')">{{ $t('novelDetail.blueprintReject') }}</button>
   <button class="btn btn-primary btn-sm" :disabled="blueprintDecisionBusy" @click="decideBlueprint('apply')">{{ blueprintDecisionBusy ? $t('generate.processing') : $t('novelDetail.blueprintApplyToNext') }}</button>
  </div>
 </div>
 </div>

 <Teleport to="body">
 <div v-if="showGenSettings" class="gen-overlay" @click.self="showGenSettings=false">
 <div class="gen-modal">
 <h3>️ {{ $t('novelDetail.genSettingsTitle') }}</h3>
 <div class="gf"><label>{{ $t('continue.wordCount') }}</label>
 <input v-model.number="genWordCount" class="input" type="number" min="500" max="8000" step="500" />
 </div>
 <div class="gf"><label>{{ $t('novelDetail.genNotesLabel') }}</label>
 <textarea v-model="genNotes" class="textarea" rows="3" :placeholder="$t('novelDetail.genNotesPlaceholder')"></textarea>
 </div>
 <div class="gf-acts">
 <button class="btn btn-outline" @click="showGenSettings=false">{{ $t('common.cancel') }}</button>
 <button class="btn btn-primary" :disabled="isContinuing" :aria-busy="isContinuing" @click="confirmGenSettings">{{ isContinuing ? $t('novelDetail.genStarting') : $t('novelDetail.genStart') }}</button>
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
 <h3> {{ $t('novelDetail.chapterKeywords', { n: keywordsChapterNum }) }}</h3>
 <div class="kw-section">
 <div class="kw-label"> {{ $t('novelDetail.keywordsCharLabel') }}</div>
 <div v-if="kwLoading" class="kw-loading">{{ $t('novelDetail.keywordsAnalyzing') }}</div>
 <div v-else class="kw-content">{{ keywordsData.characterKeywords || $t('novelDetail.keywordsNone') }}</div>
 </div>
 <div class="kw-section">
 <div class="kw-label">️ {{ $t('novelDetail.keywordsSceneLabel') }}</div>
 <div v-if="kwLoading" class="kw-loading">{{ $t('novelDetail.keywordsAnalyzing') }}</div>
 <div v-else class="kw-content">{{ keywordsData.sceneKeywords || $t('novelDetail.keywordsNone') }}</div>
 </div>
 <div v-if="kwError" class="kw-error">{{ kwError }}</div>
 <div class="gf-acts">
 <button class="btn btn-outline" @click="showKeywordsDialog=false">{{ $t('novelDetail.keywordsClose') }}</button>
 <button class="btn btn-primary" :disabled="kwLoading" @click="copyKeywords"> {{ $t('novelDetail.keywordsCopy') }}</button>
 </div>
 </div>
 </div>
 </Teleport>

 <div v-if="isLastChapterUnfinished" class="card action-card">
 <button class="btn btn-primary btn-block" @click="openGenSettings(lastChapterNum)">▶ {{ $t('novelDetail.continueChapter', { n: lastChapterNum }) }}</button>
 </div>

 <div v-if="isContinuing" class="card streaming-card">
 <div class="streaming-header">
 <span class="section-title"> {{ $t('bookshelf.aiWriting') }}{{ $t('novelDetail.inChapter', { n: continuingChapter }) }}</span>
 <span class="generating-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>
 </div>
 <div class="streaming-content" ref="streamingRef">
 <div v-if="!chapterStreamingText && isContinuing" style="color:#8a8f98;font-size:13px;margin-bottom:8px;">
  {{ chapterThinkingLen > 0
     ? $t('bookshelf.thinking', { words: chapterThinkingLen, seconds: chapterThinkingElapsed })
     : $t('bookshelf.thinkingWaiting', { seconds: chapterThinkingElapsed }) }}
 </div>
 <div class="content-text">{{ chapterStreamingText }}</div>
 <div class="cursor-blink">|</div>
 </div>
 <button class="btn btn-outline btn-sm" style="margin-top:8px;" @click="stopChapterGen">{{ $t('bookshelf.pause') }}</button>
 </div>

 <div v-if="novel" class="card">
 <div class="section-title"> {{ $t('novelDetail.chapterListTitle') }}</div>
 <div v-if="!novel?.chapters?.length" class="empty-chapters">{{ $t('novelDetail.chapterListEmpty') }}</div>
 <div v-for="(chapter, index) in novel?.chapters" :key="chapter.chapterNumber" class="chapter-item">
 <div class="chapter-header" @click="toggleChapter(index)">
 <span class="chapter-num">{{ chapter.title || $t('novelDetail.chapterTitle', { n: chapter.chapterNumber }) }}</span>
 <span v-if="chapterTokens(chapter)" class="chapter-tokens" :title="$t('novelDetail.chapterTokensTip')">⚡{{ formatTokenCount(chapterTokens(chapter).inputTokens) }}↑ / {{ formatTokenCount(chapterTokens(chapter).outputTokens) }}↓</span>
 <span class="chapter-words">{{ chapter.wordCount }}{{ $t('generate.wordShort') }}</span>
 <span class="expand-icon">{{ expandedChapter===index?'▼':'▶' }}</span>
 </div>
 <div v-show="expandedChapter===index" class="chapter-body">
 <div class="chapter-content">{{ chapter.content||$t('novelDetail.chapterContentGenerating') }}</div>
 <div v-if="chapterTokens(chapter)" class="chapter-token-detail">
 <span>{{ $t('novelDetail.chapterTokensLabel') }}{{ $t('novelDetail.input') }} {{ formatTokenCount(chapterTokens(chapter).inputTokens) }}</span>
 <span>{{ $t('novelDetail.output') }} {{ formatTokenCount(chapterTokens(chapter).outputTokens) }}</span>
 <span v-if="chapterTokens(chapter).cacheSavedTokens > 0">{{ $t('novelDetail.cacheHit') }} {{ formatTokenCount(chapterTokens(chapter).cacheSavedTokens) }}</span>
 <span v-if="chapterTokenRoles(chapter).length" class="token-roles">{{ chapterTokenRoles(chapter) }}</span>
 </div>
 <div class="chapter-actions">
 <button class="btn-ch action-edit" :disabled="chapterActionBusy || isContinuing" @click="openEdit(chapter)">{{ $t('novelDetail.btnEdit') }}</button>
 <button class="btn-ch action-del" :disabled="chapterActionBusy || isContinuing" @click="confirmDeleteChapter(chapter)"> {{ chapterActionBusy === `delete:${chapter.chapterNumber}` ? $t('common.loading') : $t('common.delete') }}</button>
 <button class="btn-ch action-deslop" :disabled="chapterActionBusy || isContinuing" @click="deslopChapter(chapter)"> {{ chapterActionBusy === `deslop:${chapter.chapterNumber}` ? $t('common.loading') : $t('novelDetail.chapterActionDeslop') }}</button>
 <button class="btn-ch action-keywords" :disabled="chapterActionBusy || isContinuing" @click="generateKeywords(chapter)"> {{ chapterActionBusy === `keywords:${chapter.chapterNumber}` ? $t('novelDetail.chapterActionAnalyzing') : $t('novelDetail.chapterActionKeywords') }}</button>
 <button v-if="isLastUnfinished(index)" class="btn-ch action-gen" :disabled="chapterActionBusy || isContinuing" @click="openGenSettings(chapter.chapterNumber)">{{ $t('novelDetail.btnContinue') }}</button>
 </div>
 </div>
 </div>
 </div>

 <div v-if="allChaptersComplete" class="card">
 <button class="btn btn-primary btn-block" @click="openGenSettings(nextChapterNum)"> {{ $t('novelDetail.generateChapter', { n: nextChapterNum }) }}</button>
 </div>

 <div v-if="novel" class="card" style="margin-top:8px;">
 <button class="btn btn-outline btn-block" :disabled="deslopAllBusy" @click="deslopAllChapters">
 {{ deslopAllBusy ? $t('novelDetail.deslopAllRunning') : $t('novelDetail.deslopAll') }}
 </button>
 <div v-if="deslopAllProgress" style="margin-top:6px;font-size:12px;color:var(--text-secondary);">
 {{ deslopAllProgress }}
 </div>
 </div>

 <div v-if="novel" class="card" style="margin-top:8px;">
 <button class="btn btn-warning btn-block" :disabled="optimizeBusy" @click="optimizeNovel">
 {{ optimizeBusy ? $t('novelDetail.optimizeAllRunning') : $t('novelDetail.optimizeAll') }}
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
import { ref, computed, onMounted, onUnmounted, onActivated, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNovelStore } from '../stores/novel'
import { useI18n } from '../composables/useI18n'
import { useSSE } from '../composables/useSSE'
import api from '../api'

const route = useRoute()
const router = useRouter()
const novelStore = useNovelStore()
const { $t } = useI18n()

const novel = ref(null)
const loading = ref(true)
// keep-alive 缓存下的加载防护：loadRunId 丢弃过期响应，inflightId 合并同一次的 watch+activated 重复触发
let loadRunId = 0
let inflightId = null
let firstActivated = false
const expandedChapter = ref(null)
const isContinuing = ref(false)
const continuingChapter = ref(0)
const chapterStreamingText = ref('')
const chapterThinkingLen = ref(0)
const chapterThinkingElapsed = ref(0)
// 深度思考模型可能在数分钟内只思考不输出：本地秒表保证"已用时间"持续变化，
// 服务端每 2 秒上报一次真实值进行校准。
let chapterThinkingTicker = null
function startChapterThinkingTicker() {
 stopChapterThinkingTicker()
 chapterThinkingTicker = setInterval(() => {
  if (!isContinuing.value) { stopChapterThinkingTicker(); return }
  chapterThinkingElapsed.value += 1
 }, 1000)
}
function stopChapterThinkingTicker() {
 if (chapterThinkingTicker) { clearInterval(chapterThinkingTicker); chapterThinkingTicker = null }
}
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
  { id: 'generate', name: $t('novelDetail.stageDraft'), state: chapters.length ? 'done' : 'idle', label: chapters.length ? $t('novelDetail.chaptersCount', { n: chapters.length }) : $t('novelDetail.labelNotStarted') },
  { id: 'context', name: $t('novelDetail.stageContext'), state: novel.value?.contextMemory?.checkpointChapter ? 'done' : 'idle', label: novel.value?.contextMemory?.checkpointChapter ? $t('novelDetail.labelSynced') : $t('novelDetail.labelPendingSync') },
  { id: 'revision', name: $t('novelDetail.stageRevision'), state: revisionCount ? 'done' : 'idle', label: revisionCount ? $t('novelDetail.appliedTimes', { n: revisionCount }) : $t('novelDetail.labelOptional') },
  { id: 'editorial', name: $t('novelDetail.stageEditorial'), state: editorial?.status === 'running' ? 'running' : editorial?.status === 'completed' ? 'done' : editorial?.partial ? 'partial' : 'idle', label: editorial?.status === 'running' ? $t('novelDetail.labelRunning') : editorial?.status === 'completed' ? $t('novelDetail.labelApplied') : editorial?.partial ? $t('novelDetail.labelPartial') : $t('novelDetail.labelOptional') },
  { id: 'optimize', name: $t('novelDetail.stageOptimize'), state: optimize?.status === 'analyzing' || optimize?.status === 'optimizing' ? 'running' : optimize?.status === 'completed' ? 'done' : optimize?.partial ? 'partial' : 'idle', label: optimize?.status === 'analyzing' || optimize?.status === 'optimizing' ? $t('novelDetail.labelRunning') : optimize?.status === 'completed' ? $t('novelDetail.labelApplied') : optimize?.partial ? $t('novelDetail.labelPartial') : $t('novelDetail.labelOptional') },
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
const ROLE_LABELS = { writing: $t('novelDetail.roleWriting'), reasoning: $t('novelDetail.roleReasoning'), polish: $t('novelDetail.rolePolish'), outline: $t('novelDetail.roleOutline') }
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
  if (number >= 10000) return $t('novelDetail.tenThousand', { n: (number / 10000).toFixed(1) })
  if (number >= 1000) return `${(number / 1000).toFixed(1)}k`
  return String(number)
}
const nextChapterNum = computed(() => lastChapterNum.value + 1)
const isLastChapterUnfinished = computed(() => { if (!novel.value || novel.value.status !== 'paused') return false; return novel.value.chapters.length > 0 })
const allChaptersComplete = computed(() => { if (!novel.value) return false; return novel.value.status === 'completed' || novel.value.status === 'paused' })
function isLastUnfinished(index) { if (!novel.value || novel.value.status !== 'paused') return false; return index === novel.value.chapters.length - 1 }

async function loadNovel() {
 const id = route.params.id
 if (!id) return
 if (inflightId === id) return
 const run = ++loadRunId
 inflightId = id
 loading.value = true
 // 切换书籍时清空上一本的残留视图状态，避免内容/流式/蓝图串台
 novel.value = null
 blueprint.value = null
 blueprintProposals.value = []
 blueprintError.value = ''
 expandedChapter.value = null
 isContinuing.value = false
 stopChapterThinkingTicker()
 chapterStreamingText.value = ''
 stopPollingOptimize()
 optimizeBusy.value = false
 optimizeProgress.value = ''
 try {
 const data = await novelStore.fetchNovelDetail(id)
 if (run !== loadRunId) return
 novel.value = data
 await loadBlueprint()
 // 检查是否有正在运行或刚完成的后台调优任务
 if (data?.optimizeTask) {
 const task = data.optimizeTask
 if (task.status === 'analyzing' || task.status === 'optimizing') {
 optimizeBusy.value = true
 optimizeProgress.value = task.progress || $t('novelDetail.optimizeBackground')
 startPollingOptimize()
 } else if (task.status === 'completed' && task.optimizedCount > 0) {
 // 任务在用户离开时已完成，刷新章节内容并提示
 refreshNovel()
 setTimeout(() => {
 alert($t('novelDetail.optimizeDoneBackground') + (task.progress || ''))
 }, 300)
 }
 }
 }
 catch { if (run === loadRunId) { alert($t('error.unknown')); router.push('/bookshelf') } }
 finally { if (inflightId === id) inflightId = null; if (run === loadRunId) loading.value = false }
}

// keep-alive 会缓存本组件实例：路由 id 变化（watch）与从缓存返回（onActivated）都必须重新拉取，
// 否则会出现“永远显示第一次进入的那本书”、章节数停留在旧快照的问题。
watch(() => route.params.id, (id, oldId) => { if (id && id !== oldId) loadNovel() })

onMounted(() => { loadNovel() })

onActivated(() => {
 // 首次挂载后紧跟的 activated 与 onMounted 重复，跳过一次；此后从缓存返回时强制刷新，避免旧数据
 if (!firstActivated) { firstActivated = true; return }
 loadNovel()
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
  blueprintError.value = e.response?.data?.message || $t('novelDetail.errBlueprintLoad')
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
  blueprintError.value = e.response?.data?.message || $t('novelDetail.errBlueprintReview')
 } finally { blueprintReviewing.value = false }
}

async function toggleBlueprintReview(event) {
 blueprintError.value = ''
 try {
  const res = await api.put(`/novel/${route.params.id}/blueprint/settings`, { autoReviewEnabled: event.target.checked })
  blueprint.value = res.data.blueprint
 } catch (e) {
  event.target.checked = !event.target.checked
  blueprintError.value = e.response?.data?.message || $t('novelDetail.errSaveReminder')
 }
}

async function toggleBlueprintEmail(event) {
 blueprintError.value = ''
 try {
  const res = await api.put(`/novel/${route.params.id}/blueprint/settings`, { emailReminderEnabled: event.target.checked })
  blueprint.value = res.data.blueprint
 } catch (e) {
  event.target.checked = !event.target.checked
  blueprintError.value = e.response?.data?.message || $t('novelDetail.errSaveEmailReminder')
 }
}

async function decideBlueprint(decision) {
 if (!pendingBlueprintProposal.value) return
 if (decision === 'apply' && !confirm($t('novelDetail.confirmApplyBlueprint'))) return
 blueprintDecisionBusy.value = true; blueprintError.value = ''
 try {
  const proposal = pendingBlueprintProposal.value
  const res = await api.post(`/novel/${route.params.id}/blueprint/proposals/${proposal.id}/decision`, { decision })
  blueprint.value = res.data.blueprint || blueprint.value
  blueprintProposals.value = blueprintProposals.value.map((item) => item.id === proposal.id ? res.data.proposal : item)
  alert(res.data.message)
 } catch (e) {
  blueprintError.value = e.response?.data?.message || $t('novelDetail.errBlueprintDecision')
 } finally { blueprintDecisionBusy.value = false }
}
async function confirmGenSettings() { if (isContinuing.value) return; showGenSettings.value = false; await startChapterGen(genTargetChapter.value, genWordCount.value, genNotes.value) }

async function startChapterGen(chapterNum, wc, notes) {
 isContinuing.value = true; continuingChapter.value = chapterNum; chapterStreamingText.value = ''; chapterThinkingLen.value = 0; chapterThinkingElapsed.value = 0
 startChapterThinkingTicker()
 const token = localStorage.getItem('token')
 const sse = useSSE()
 sse.openSSE(`/api/novel/${route.params.id}/continue-chapter/${chapterNum}`, { wordCount: wc, notes }, {
  token,
  onContent: (content) => { chapterStreamingText.value += content },
  onEvent: (d) => {
   if (d.type === 'thinking') {
    chapterThinkingLen.value = d.length || 0
    if (d.elapsedMs) chapterThinkingElapsed.value = Math.round(d.elapsedMs / 1000)
   }
   else if (d.type === 'completed' || d.type === 'chapter_continued' || d.type === 'paused') { isContinuing.value = false; refreshNovel() }
  },
  onError: (message) => { isContinuing.value = false; stopChapterThinkingTicker(); alert($t('novelDetail.errGenFailed') + message) },
  onLoadend: () => { isContinuing.value = false; stopChapterThinkingTicker(); refreshNovel() },
 })
 window.__chapterGenSSE = sse
}
function stopChapterGen() { if (window.__chapterGenSSE) { window.__chapterGenSSE.abort(); window.__chapterGenSSE = null }; isContinuing.value = false }

function openEdit(chapter) { if (!chapterActionBusy.value && !isContinuing.value) { editingChapter.value = chapter; editContent.value = chapter.content || ''; showEditModal.value = true } }
async function saveEdit() {
 if (savingEdit.value || !editingChapter.value || !editContent.value.trim()) return
 savingEdit.value = true
 try { await api.put(`/novel/${route.params.id}/chapter/${editingChapter.value.chapterNumber}`, { content: editContent.value }); showEditModal.value = false; await refreshNovel() }
 catch (e) { alert($t('novelDetail.errSaveFailed')+(e.response?.data?.message||e.message)) }
 finally { savingEdit.value = false }
}

async function confirmDeleteChapter(ch) {
 if (!confirm($t('novelDetail.confirmDeleteChapter', { n: ch.chapterNumber }))) return
 chapterActionBusy.value = `delete:${ch.chapterNumber}`
 try {
 await api.delete(`/novel/${route.params.id}/chapter/${ch.chapterNumber}`)
 await refreshNovel()
 } catch (e) {
 alert($t('novelDetail.errDeleteFailed') + (e.response?.data?.message || e.message))
 } finally { chapterActionBusy.value = '' }
}

async function deslopChapter(chapter) {
 if (!confirm($t('novelDetail.confirmDeslopChapter', { n: chapter.chapterNumber }))) return
 chapterActionBusy.value = `deslop:${chapter.chapterNumber}`
 try {
 const res = await api.post('/novel/deslop', { text: chapter.content || '', novelId: route.params.id }, { timeout: 2400000 })
 if (res.data.processed) { await api.put(`/novel/${route.params.id}/chapter/${chapter.chapterNumber}`, { content: res.data.processed, source: 'deslop' }); await refreshNovel(); alert($t('novelDetail.deslopDoneSynced')) }
 } catch (e) { alert($t('novelDetail.errProcessFailed')+(e.response?.data?.message||e.message)) }
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
 const res = await api.post(`/novel/chapter-keywords/${route.params.id}/${chapter.chapterNumber}`, null, { timeout: 2400000 })
 keywordsData.value = res.data
 } catch (e) {
 kwError.value = e.response?.data?.message || e.message || $t('novelDetail.errKeywords')
 } finally {
 kwLoading.value = false
 chapterActionBusy.value = ''
 }
}

function copyKeywords() {
 const text = `${$t('novelDetail.keywordsCharHeading')}\n${keywordsData.value.characterKeywords}\n\n${$t('novelDetail.keywordsSceneHeading')}\n${keywordsData.value.sceneKeywords}`
 navigator.clipboard.writeText(text).then(() => {
 alert($t('novelDetail.keywordsCopied'))
 }).catch(() => {
 // 降级：创建临时 textarea
 const ta = document.createElement('textarea')
 ta.value = text
 document.body.appendChild(ta)
 ta.select()
 document.execCommand('copy')
 document.body.removeChild(ta)
 alert($t('novelDetail.keywordsCopied'))
 })
}

const deslopAllBusy = ref(false)
const deslopAllProgress = ref('')

const optimizeBusy = ref(false)
const optimizeProgress = ref('')
let optimizePollTimer = null

async function optimizeNovel() {
 if (!novel.value?.chapters?.length) return alert($t('novelDetail.errNoChaptersToOptimize'))
 if (!confirm($t('novelDetail.confirmOptimize', { title: novel.value.title }))) return
 optimizeBusy.value = true
 optimizeProgress.value = $t('novelDetail.optimizeStarting')
 try {
 const res = await api.post(`/novel/optimize/${route.params.id}`)
 optimizeProgress.value = $t('novelDetail.optimizeStarted')
 startPollingOptimize()
 } catch (e) {
 alert($t('novelDetail.errOptimizeStart') + (e.response?.data?.message || e.message))
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
 alert(task.progress || $t('novelDetail.optimizeDone'))
 } else if (task.status === 'error') {
 stopPollingOptimize()
 optimizeBusy.value = false
 optimizeProgress.value = ''
 alert($t('novelDetail.optimizeFailed') + (task.error || task.progress))
 }
 // 'analyzing' 和 'optimizing' 状态继续轮询
 } catch (e) {
 // 轮询出错不弹窗，继续尝试
 console.error($t('novelDetail.optimizePollFailed'), e)
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
 if (!chapters || chapters.length === 0) return alert($t('novelDetail.errNoChaptersToProcess'))
 if (!confirm($t('novelDetail.confirmDeslopAll', { n: chapters.length }))) return
 deslopAllBusy.value = true
 deslopAllProgress.value = ''
 let success = 0, fail = 0
 for (let i = 0; i < chapters.length; i++) {
 const ch = chapters[i]
 deslopAllProgress.value = $t('novelDetail.deslopAllProgress', { current: i + 1, total: chapters.length })
 try {
 const res = await api.post('/novel/deslop', { text: ch.content || '', novelId: route.params.id }, { timeout: 2400000 })
 if (res.data.processed) {
 await api.put(`/novel/${route.params.id}/chapter/${ch.chapterNumber}`, { content: res.data.processed, source: 'deslop' })
 success++
 }
 } catch (e) {
 fail++
 console.error($t('novelDetail.deslopChapterFailed', { n: ch.chapterNumber }), e)
 }
 }
 deslopAllBusy.value = false
 refreshNovel()
 alert($t('novelDetail.deslopAllDone', { success, extra: fail ? $t('novelDetail.deslopAllDoneFail', { n: fail }) : '' }))
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
.detail-loading { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:80px 0; color:var(--text-light); font-size:14px; }
.detail-loading .loading-spinner { width:32px; height:32px; border:3px solid var(--border-color); border-top-color:var(--primary-color); border-radius:50%; animation:detailSpin 0.8s linear infinite; }
@keyframes detailSpin { to { transform:rotate(360deg) } }
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
