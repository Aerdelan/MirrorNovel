<template>
  <WorkbenchLayout :title="novel?.title || $t('desktop.workbench.title')">
    <!-- 左栏：章节列表 -->
    <template #chapters="{ keyword }">
      <div class="chapter-list">
        <button
          v-for="chapter in filteredChapters(keyword)"
          :key="chapter.chapterNumber"
          class="chapter-item"
          :class="{ active: selectedChapter === chapter.chapterNumber }"
          @click="focusChapter(chapter)"
        >
          <span class="no">{{ chapter.chapterNumber }}</span>
          <span class="t">{{ chapter.title || $t('desktop.workbench.chapterTitle', { n: chapter.chapterNumber }) }}</span>
          <span class="meta">{{ formatCount(chapter.wordCount) }}</span>
        </button>
        <p v-if="!filteredChapters(keyword).length" class="empty">{{ $t('desktop.workbench.noChapters') }}</p>
      </div>
    </template>

    <template #chaptersFooter>
      <button class="btn-primary-block" @click="goContinue">{{ $t('desktop.workbench.nextChapter') }}</button>
    </template>

    <!-- 中栏：复用 Web 端的作品详情页（生成、编辑、去AI味、导出等能力原样保留） -->
    <NovelDetailPage />

    <!-- 右栏：上下文 / 用量 / 质量 -->
    <template #inspector="{ tab }">
      <!-- 上下文 -->
      <div v-if="tab === 'context'">
        <section class="block">
          <h4>{{ $t('desktop.workbench.novelStatus') }}</h4>
          <div class="row"><span>{{ $t('desktop.workbench.status') }}</span><span>{{ statusLabel }}</span></div>
          <div class="row"><span>{{ $t('desktop.workbench.progress') }}</span><span>{{ formatCount(novel?.currentWordCount) }} / {{ formatCount(novel?.targetWordCount) }}</span></div>
          <div class="row"><span>{{ $t('desktop.workbench.chapters') }}</span><span>{{ $t('desktop.workbench.chapterUnit', { n: chapters.length }) }}</span></div>
        </section>

        <section class="block">
          <h4>{{ $t('desktop.workbench.openHooks', { n: openHooks.length }) }}</h4>
          <div v-for="hook in openHooks" :key="hook.id || hook.content" class="hook">
            <span class="dot"></span>
            <span>{{ $t('desktop.workbench.hookItem', { n: hook.setChapter || '?', text: hook.content || hook.id }) }}</span>
          </div>
          <p v-if="!openHooks.length" class="empty">{{ $t('desktop.workbench.noHooks') }}</p>
        </section>

        <section class="block">
          <h4>{{ $t('desktop.workbench.characterStates') }}</h4>
          <div v-for="character in recentCharacters" :key="character.name" class="row">
            <span>{{ character.name }}</span>
            <span class="muted">{{ [character.location, character.emotionalState].filter(Boolean).join(' / ') || '—' }}</span>
          </div>
          <p v-if="!recentCharacters.length" class="empty">{{ $t('desktop.workbench.noCharacters') }}</p>
        </section>

        <section class="block">
          <h4>{{ $t('desktop.workbench.upcomingPlans') }}</h4>
          <div v-for="plan in upcomingPlans" :key="plan.chapterNumber" class="row">
            <span>{{ $t('desktop.workbench.chapterTitle', { n: plan.chapterNumber }) }}</span>
            <span class="muted">{{ plan.title || plan.coreEvent || '—' }}</span>
          </div>
          <p v-if="!upcomingPlans.length" class="empty">{{ $t('desktop.workbench.noPlans') }}</p>
        </section>
      </div>

      <!-- 用量 -->
      <div v-else-if="tab === 'usage'">
        <section class="block">
          <h4>{{ $t('desktop.workbench.usageTotal') }}</h4>
          <div class="row"><span>{{ $t('desktop.workbench.usageInput') }}</span><span>{{ formatToken(novel?.tokenUsage?.inputTokens) }}</span></div>
          <div class="row"><span>{{ $t('desktop.workbench.usageOutput') }}</span><span>{{ formatToken(novel?.tokenUsage?.outputTokens) }}</span></div>
          <div class="row"><span>{{ $t('desktop.workbench.usageCache') }}</span><span>{{ formatToken(novel?.tokenUsage?.cacheSavedTokens) }}</span></div>
          <div class="row"><span>{{ $t('desktop.workbench.usageCalls') }}</span><span>{{ novel?.tokenUsage?.calls || 0 }}</span></div>
        </section>
        <section class="block">
          <h4>{{ $t('desktop.workbench.usageByRole') }}</h4>
          <div v-for="(value, role) in (novel?.tokenUsage?.byRole || {})" :key="role" class="row">
            <span>{{ roleLabel(role) }}</span>
            <span>{{ formatToken(value?.inputTokens) }} / {{ formatToken(value?.outputTokens) }}</span>
          </div>
          <p v-if="!Object.keys(novel?.tokenUsage?.byRole || {}).length" class="empty">{{ $t('desktop.workbench.noUsage') }}</p>
        </section>
        <section class="block">
          <h4>{{ $t('desktop.workbench.thinkingCost') }}</h4>
          <div class="row"><span>{{ $t('desktop.workbench.thinkingChars') }}</span><span>{{ formatCount(totalReasoningChars) }}</span></div>
          <div class="row"><span>{{ $t('desktop.workbench.truncatedChapters') }}</span><span>{{ $t('desktop.workbench.chapterUnit', { n: truncatedChapters }) }}</span></div>
        </section>
      </div>

      <!-- 质量 -->
      <div v-else>
        <section class="block">
          <h4>{{ $t('desktop.workbench.qualityNotices') }}</h4>
          <div v-for="item in qualityNotices" :key="item.chapterNumber" class="notice">
            <strong>{{ $t('desktop.workbench.chapterTitle', { n: item.chapterNumber }) }}</strong>
            <span>{{ item.issues.join('；') || $t('desktop.workbench.noIssues') }}</span>
          </div>
          <p v-if="!qualityNotices.length" class="empty">{{ $t('desktop.workbench.noQualityNotices') }}</p>
        </section>
        <section class="block">
          <h4>{{ $t('desktop.workbench.qualityNote') }}</h4>
          <p class="empty">{{ $t('desktop.workbench.qualityNoteText') }}</p>
        </section>
      </div>
    </template>
  </WorkbenchLayout>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@client/api'
import { useI18n } from '@client/composables/useI18n'
import NovelDetailPage from '@client/views/NovelDetailPage.vue'
import WorkbenchLayout from '../layouts/WorkbenchLayout.vue'

const route = useRoute()
const router = useRouter()
const { $t } = useI18n()

const novel = ref(null)
const selectedChapter = ref(0)

const chapters = computed(() => {
  const list = Array.isArray(novel.value?.chapters) ? [...novel.value.chapters] : []
  return list.sort((a, b) => Number(a.chapterNumber || 0) - Number(b.chapterNumber || 0))
})

// 角色/状态用语言包 key，切换语言时自动跟随
const ROLE_KEYS = { writing: 'roleWriting', reasoning: 'roleReasoning', polish: 'rolePolish', outline: 'roleOutline', other: 'roleOther' }
const STATUS_KEYS = { generating: 'statusGenerating', paused: 'statusPaused', completed: 'statusCompleted', draft: 'statusDraft' }

const statusLabel = computed(() => {
  const key = STATUS_KEYS[novel.value?.status]
  if (key) return $t(`desktop.workbench.${key}`)
  return novel.value?.status || '—'
})

const openHooks = computed(() => (novel.value?.foreshadowingLedger || [])
  .filter((hook) => ['pending', 'planned'].includes(hook.status))
  .slice(0, 12))

const recentCharacters = computed(() => (novel.value?.characterStates || [])
  .slice()
  .sort((a, b) => Number(b.lastChapter || 0) - Number(a.lastChapter || 0))
  .slice(0, 8))

const upcomingPlans = computed(() => {
  const plans = novel.value?.chapterPlanData?.chapters || []
  const from = Number(novel.value?.currentChapterIndex || 0) + 1
  return plans.filter((plan) => Number(plan.chapterNumber || 0) >= from).slice(0, 6)
})

// 章节级思考/截断诊断
const totalReasoningChars = computed(() => chapters.value.reduce((sum, chapter) => sum + (chapter.qualityReport?.tokens?.reasoningChars || 0), 0))
const truncatedChapters = computed(() => chapters.value.filter((chapter) => (chapter.qualityReport?.tokens?.truncatedCalls || 0) > 0).length)

const qualityNotices = computed(() => chapters.value
  .filter((chapter) => Array.isArray(chapter.qualityReport?.issues) && chapter.qualityReport.issues.length)
  .slice(-6)
  .reverse()
  .map((chapter) => ({ chapterNumber: chapter.chapterNumber, issues: chapter.qualityReport.issues })))

function filteredChapters(keyword) {
  const text = String(keyword || '').trim()
  if (!text) return chapters.value
  return chapters.value.filter((chapter) => String(chapter.title || '').includes(text) || String(chapter.chapterNumber).includes(text))
}

function roleLabel(role) {
  const key = ROLE_KEYS[role]
  return key ? $t(`desktop.workbench.${key}`) : role
}

function formatCount(value) {
  const number = Number(value) || 0
  if (number >= 10000) return $t('desktop.workbench.tenThousand', { n: (number / 10000).toFixed(1) })
  return number.toLocaleString()
}

function formatToken(value) {
  const number = Number(value) || 0
  if (number >= 1000000) return `${(number / 1000000).toFixed(2)}M`
  if (number >= 1000) return `${(number / 1000).toFixed(1)}k`
  return String(number)
}

function focusChapter(chapter) {
  selectedChapter.value = chapter.chapterNumber
  // 把选中章节写进 URL：便于刷新后保持位置，也不影响 Web 端（桌面端独有查询参数）
  router.replace({ query: { ...route.query, chapter: String(chapter.chapterNumber) } }).catch(() => {})
}

function goContinue() {
  router.push('/continue')
}

async function loadNovel() {
  try {
    const response = await api.get(`/novel/${route.params.id}`)
    novel.value = response.data
    const queryChapter = Number(route.query.chapter)
    selectedChapter.value = Number.isFinite(queryChapter) && queryChapter > 0
      ? queryChapter
      : (chapters.value[chapters.value.length - 1]?.chapterNumber || 0)
  } catch {
    novel.value = null
  }
}

onMounted(loadNovel)
watch(() => route.params.id, loadNovel)
</script>

<style scoped>
.chapter-list { display: flex; flex-direction: column; gap: 2px; }
.chapter-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 8px;
  border: 0; border-radius: var(--radius);
  background: transparent; color: var(--text-secondary);
  font-family: inherit; font-size: 12.5px; text-align: left; cursor: pointer;
}
.chapter-item:hover { background: var(--bg-alt); color: var(--text); }
.chapter-item.active { background: var(--primary-light); color: var(--primary); font-weight: 600; }
.chapter-item .no { width: 22px; flex: 0 0 22px; font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary); }
.chapter-item.active .no { color: var(--primary); }
.chapter-item .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chapter-item .meta { color: var(--text-tertiary); font-size: 11px; }

.btn-primary-block {
  width: 100%; padding: 8px;
  border: 1px solid var(--primary); border-radius: var(--radius);
  background: var(--primary); color: #fff; font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
}
.btn-primary-block:hover { background: var(--primary-hover); }

.block { margin-bottom: 16px; }
.block h4 { font-size: 11.5px; color: var(--text-tertiary); letter-spacing: 0.04em; margin-bottom: 8px; }
.row {
  display: flex; align-items: baseline; gap: 10px; justify-content: space-between;
  padding: 5px 0; font-size: 12px; border-bottom: 1px dashed var(--bg-alt);
}
.row > span:first-child { color: var(--text-tertiary); flex: 0 0 auto; }
.row > span:last-child { color: var(--text-secondary); text-align: right; }
.muted { color: var(--text-tertiary); }
.hook { display: flex; gap: 7px; padding: 5px 0; font-size: 12px; color: var(--text-secondary); }
.hook .dot { width: 6px; height: 6px; flex: 0 0 6px; margin-top: 6px; border-radius: 50%; background: var(--accent); }
.notice { padding: 7px 0; border-bottom: 1px dashed var(--bg-alt); font-size: 12px; }
.notice strong { display: block; margin-bottom: 3px; }
.notice span { color: var(--text-secondary); }
.empty { color: var(--text-tertiary); font-size: 12px; line-height: 1.7; }
</style>
