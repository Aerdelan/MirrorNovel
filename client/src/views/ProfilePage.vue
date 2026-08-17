<template>
 <div class="page-container profile-page">
 <div class="page-header">
 <span>{{ $t('profile.title') }}</span>
 </div>

 <div class="profile-content">
 <!-- 未登录 -->
 <div v-if="!authStore.isLoggedIn" class="card not-logged-in">
 <div class="avatar-placeholder"></div>
 <div class="text" style="margin:12px 0;font-size:16px;">{{ $t('profile.loginFirst') }}</div>
 <button class="btn btn-primary btn-block" @click="goToLogin">{{ $t('auth.login') }}</button>
 <button class="btn btn-outline btn-block" style="margin-top:8px;" @click="goToRegister">{{ $t('auth.register') }}</button>
 </div>

 <!-- 已登录 -->
 <div v-else>
 <!-- 用户信息 -->
 <div class="card user-card">
 <div class="avatar">{{ authStore.user?.email?.charAt(0).toUpperCase() || 'U' }}</div>
 <div class="user-info">
 <div class="user-name">{{ authStore.user?.nickname || '书友' }}</div>
 <div class="user-email">{{ authStore.user?.email }}</div>
 </div>
 </div>

 <!-- 积分水球 -->
 <div class="card token-card">
 <div class="token-title">{{ $t('profile.tokenBalance') }}</div>
 <div class="token-ball-wrapper">
 <div class="token-ball">
 <div class="water-wave" :style="{ height: (100 - tokenPercent) + '%' }">
 <div class="wave wave1"></div>
 <div class="wave wave2"></div>
 </div>
 <div class="token-ball-text">
 <div class="token-num">{{ availableTokens.toLocaleString() }}</div>
 <div class="token-label">{{ $t('profile.available') }}</div>
 </div>
 </div>
 </div>
 <div class="token-info-row">
 <span>{{ $t('profile.total') }} {{ totalTokens.toLocaleString() }}</span>
 <span>{{ $t('profile.used') }} {{ usedTokens.toLocaleString() }}</span>
 </div>
 <button class="btn btn-primary btn-block" @click="showGroupInfo = !showGroupInfo" style="margin-top:10px;">
 {{ $t('profile.getToken') }}
 </button>
  <div v-if="showGroupInfo" class="group-info-card">
 <div class="group-info-text">{{ $t('profile.tokenDesc') }}</div>
 <div class="group-qq">{{ $t('profile.groupNum') }}</div>
 <div class="group-hint">{{ $t('profile.groupNote') }}</div>
  </div>
  </div>

  <div class="card ledger-card">
  <div class="ledger-heading"><div class="section-title" style="margin:0;">积分流水</div><button class="btn btn-sm btn-outline" :disabled="ledgerLoading" @click="loadTokenInfo">刷新</button></div>
  <div v-if="ledger.length === 0" class="ledger-empty">暂无积分记录</div>
  <div v-else class="ledger-list">
  <div v-for="(entry, index) in ledger" :key="`${entry.createdAt}-${index}`" class="ledger-row">
  <div><strong :class="entry.type === 'credit' ? 'ledger-credit' : 'ledger-debit'">{{ entry.type === 'credit' ? '+' : '-' }}{{ Number(entry.points || 0).toLocaleString() }}</strong><span class="ledger-reason">{{ ledgerReason(entry.reason) }}</span></div>
  <span>{{ new Date(entry.createdAt).toLocaleString() }}</span>
  </div>
  </div>
  </div>

 <!-- 统计 -->
 <div class="card stats-card">
 <div class="section-title">{{ $t('profile.stats') }}</div>
 <div class="stats-grid">
 <div class="stat-item"><div class="stat-number">{{ stats.totalNovels }}</div><div class="stat-label">{{ $t('profile.totalWorks') }}</div></div>
 <div class="stat-item"><div class="stat-number">{{ stats.totalWords }}</div><div class="stat-label">{{ $t('profile.totalWords') }}</div></div>
 <div class="stat-item"><div class="stat-number">{{ stats.completedNovels }}</div><div class="stat-label">{{ $t('profile.completed') }}</div></div>
 <div class="stat-item"><div class="stat-number">{{ stats.inProgressNovels }}</div><div class="stat-label">{{ $t('profile.inProgress') }}</div></div>
 </div>
 </div>

 <!-- 签到 -->
 <div class="card checkin-card">
 <div class="checkin-header">
 <div class="section-title" style="margin:0;"> 签到</div>
 <span class="checkin-total">已签到 {{ checkinTotal }} 天</span>
 </div>
 <div class="checkin-streak">
 <div v-for="d in 7" :key="d" class="checkin-day" :class="{ active: d <= checkinDayIndex, today: d === checkinDayIndex && !checkinDone, done: d <= checkinDayIndex && (d < checkinDayIndex || checkinDone) }">
 <div class="day-icon">{{ d === 7 ? '' : '' }}</div>
 <div class="day-label">Day {{ d }}</div>
 <div class="day-reward">{{ d === 7 ? '200' : '100' }}</div>
 </div>
 </div>
 <button class="btn btn-primary btn-block" :disabled="checkinDone || checkining" @click="doCheckin">
 {{ checkining ? '⏳' : checkinDone ? ' 已签到' : ' 今日签到' }}
 </button>
 <div v-if="checkinMsg" class="checkin-msg" :class="{ ok: checkinOk }">{{ checkinMsg }}</div>
 </div>

 <!-- 积分活动 -->
 <div class="card activity-center">
 <div class="activity-heading">
 <div class="section-title" style="margin:0;">{{ activityText.title }}</div>
 <button class="btn btn-sm btn-outline" :disabled="activitiesLoading" @click="loadActivities">{{ activityText.refresh }}</button>
 </div>
 <div v-if="activitiesLoading && activities.length === 0" class="activity-empty">{{ activityText.loading }}</div>
 <div v-else-if="activities.length === 0" class="activity-empty">{{ activityText.empty }}</div>
 <div v-else class="activity-list">
 <div v-for="activity in activities" :key="activity.id || activity._id" class="activity-row">
 <div class="activity-title-row">
 <strong>{{ activity.name }}</strong>
 <span class="activity-badge">{{ difficultyLabel(activity.difficulty) }}</span>
 </div>
 <div v-if="activity.description" class="activity-description">{{ activity.description }}</div>
 <div class="activity-meta">
 <span>{{ activityText.reward }} {{ rewardLabel(activity) }}</span>
 <span>{{ activityText.probability }} {{ Number(activity.probability ?? 100) }}%</span>
 <span>{{ requirementLabel(activity) }}</span>
 </div>
 <div class="activity-actions">
 <span class="activity-state" :class="{ ready: activity.canClaim }">
 {{ activity.canClaim ? activityText.ready : (activity.eligibility?.reason || activityText.unavailable) }}
 </span>
 <button
  class="btn btn-primary btn-sm"
  :disabled="!activity.canClaim || claimingActivityId === (activity.id || activity._id)"
  @click="claimPointsActivity(activity)"
 >
 {{ claimingActivityId === (activity.id || activity._id) ? activityText.claiming : activityText.claim }}
 </button>
 </div>
 </div>
 </div>
 <div v-if="activityMessage" class="activity-message" :class="{ ok: activityMessageOk }">{{ activityMessage }}</div>
 </div>

 <!-- 邀请 -->
 <div class="card invite-card">
 <div class="section-title"> 邀请好友</div>
 <div class="invite-stats">
 <div class="invite-stat"><span class="stat-num">{{ inviteInfo.inviteCount }}</span><span>已邀请</span></div>
 <div class="invite-stat"><span class="stat-num">{{ inviteInfo.inviteRewards }}</span><span>获得积分</span></div>
 </div>
 <div class="invite-code-row">
 <span class="invite-label">邀请码</span>
 <span class="invite-code" @click="copyInviteCode">{{ inviteInfo.inviteCode }}</span>
 <button class="btn btn-sm btn-outline" @click="copyInviteLink">复制链接</button>
 </div>
 <div class="invite-qr" v-if="inviteInfo.inviteLink">
 <img :src="'https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=' + encodeURIComponent(inviteInfo.inviteLink)" alt="QR" />
 </div>
 <div class="invite-hint">每邀请一位新用户注册，您可获得 <strong>2000 积分</strong></div>
 </div>

 <!-- 昵称 -->
 <div class="card">
 <div class="section-title">{{ $t('profile.editNick') }}</div>
 <div class="nickname-edit">
 <input v-model="newNickname" class="input" :placeholder="$t('profile.placeholderNick')" maxlength="20" />
 <button class="btn btn-primary btn-sm" @click="updateNickname" :disabled="!newNickname.trim()">{{ $t('common.save') }}</button>
 </div>
 </div>

 <!-- 语言切换 -->
 <div class="card">
 <div class="section-title">{{ $t('profile.langSwitch') }}</div>
 <div class="lang-switch-row">
 <button class="toggle-btn" :class="{ active: isZh }" @click="setLocale('zh')">{{ $t('profile.langZh') }}</button>
 <button class="toggle-btn" :class="{ active: !isZh }" @click="setLocale('en')">{{ $t('profile.langEn') }}</button>
 </div>
 </div>

 <!-- 生成线路配置：仅传 routeId，不暴露底层模型信息 -->
 <div class="card model-config-card">
 <div class="section-title">{{ $t('profile.aiConfig') }}</div>
 <div class="config-desc">{{ $t('profile.aiConfigDesc') }}</div>
 <div class="form-group route-selector">
 <label for="generation-route">{{ $t('profile.routeSelect') }}</label>
 <select id="generation-route" v-model="modelConfig.routeId" class="input select-input">
 <option v-for="route in publicRoutes" :key="route.id" :value="route.id">
 {{ routeLabel(route.id) }}
 </option>
 </select>
 </div>
 <div class="current-route">
 <span>{{ $t('profile.routeCurrent') }}</span>
 <strong>{{ routeLabel(modelConfig.routeId) }}</strong>
 </div>

 <button class="btn btn-primary btn-block" style="margin-top:14px;" :disabled="savingConfig" @click="saveConfig">
 {{ savingConfig ? $t('common.loading') : $t('profile.saveConfig') }}
 </button>
 <div v-if="configMsg" class="config-msg" :class="{ ok: configMsgOk }">{{ configMsg }}</div>
 </div>

 <!-- 退出登录 -->
 <button class="btn btn-outline btn-block logout-btn" @click="handleLogout">{{ $t('auth.logout') }}</button>
 </div>
 </div>
 </div>
</template>

<script setup>
import { ref, computed, onMounted, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useNovelStore } from '../stores/novel'
import { useI18n } from '../composables/useI18n'

const router = useRouter()
const authStore = useAuthStore()
const novelStore = useNovelStore()
const { t, isZh, setLocale } = useI18n()
const newNickname = ref('')

// 签到
const checkinDayIndex = ref(0)
const checkinTotal = ref(0)
const checkinDone = ref(false)
const checkining = ref(false)
const checkinMsg = ref('')
const checkinOk = ref(false)

// 邀请
const inviteInfo = ref({ inviteCode: '', inviteCount: 0, inviteRewards: 0, inviteLink: '' })

// 积分账户
const totalTokens = ref(0)
const usedTokens = ref(0)
const availableTokens = ref(0)
const ledger = ref([])
const ledgerLoading = ref(false)
const tokenPercent = computed(() => {
 if (totalTokens.value === 0) return 100
 return Math.round(usedTokens.value / totalTokens.value * 100)
})
const showGroupInfo = ref(false)

const activities = ref([])
const activitiesLoading = ref(false)
const claimingActivityId = ref('')
const activityMessage = ref('')
const activityMessageOk = ref(false)
const activityText = computed(() => isZh.value ? {
 title: '积分活动', refresh: '刷新', loading: '正在加载活动...', empty: '暂无可参与活动',
 reward: '奖励', probability: '概率', ready: '已满足领取条件', unavailable: '暂不可领取',
 claim: '领取', claiming: '领取中...', points: '积分', noRequirement: '无需门槛',
} : {
 title: 'Points Activities', refresh: 'Refresh', loading: 'Loading...', empty: 'No activities available',
 reward: 'Reward', probability: 'Chance', ready: 'Ready to claim', unavailable: 'Unavailable',
 claim: 'Claim', claiming: 'Claiming...', points: 'Points', noRequirement: 'No requirement',
})

const routeDefinitions = [
 { id: 'normal_1', labelKey: 'lineStandardOne' },
 { id: 'normal_2', labelKey: 'lineStandardTwo' },
 { id: 'advanced_1', labelKey: 'lineAdvancedOne' },
 { id: 'vip', labelKey: 'lineVip' },
 { id: 'svip', labelKey: 'lineSvip' },
]
const publicRoutes = ref([...routeDefinitions])
const modelConfig = ref({ routeId: 'normal_1', routeAlias: '' })
const savingConfig = ref(false)
const configMsg = ref('')
const configMsgOk = ref(false)

function routeLabel(routeId) {
 const route = routeDefinitions.find(item => item.id === routeId) || routeDefinitions[0]
 return t(`profile.${route.labelKey}`)
}

function applyPublicRoutes(payload) {
 const rawRoutes = payload?.routes || payload?.publicRoutes || payload?.availableRoutes || payload?.routeCatalog || []
 const availableIds = rawRoutes
  .map(route => route?.id || route?.routeId)
  .filter(id => routeDefinitions.some(route => route.id === id))
 publicRoutes.value = availableIds.length
  ? routeDefinitions.filter(route => availableIds.includes(route.id))
  : [...routeDefinitions]
}

// 统计
const stats = ref({ totalNovels: 0, totalWords: 0, completedNovels: 0, inProgressNovels: 0 })

onMounted(async () => {
 if (!authStore.isLoggedIn) return
 loadTokenInfo()
 loadStats()
 loadModelConfig()
 loadCheckinStatus()
 loadInviteInfo()
 loadActivities()
})

// 从 keep-alive 缓存重新激活时刷新数据
onActivated(() => {
 if (!authStore.isLoggedIn) return
 checkinMsg.value = ''
 newNickname.value = ''
 configMsg.value = ''
 loadTokenInfo()
 loadStats()
 loadCheckinStatus()
 loadInviteInfo()
 loadActivities()
})

async function loadActivities() {
 activitiesLoading.value = true
 try { activities.value = await authStore.getActivities() }
 catch { activities.value = [] }
 activitiesLoading.value = false
}

function rewardLabel(activity) {
 const min = Number(activity.reward?.min ?? activity.minRewardPoints ?? activity.rewardPoints ?? 0)
 const max = Number(activity.reward?.max ?? activity.maxRewardPoints ?? activity.rewardPoints ?? min)
 return `${min === max ? min : `${min}-${max}`} ${activityText.value.points}`
}

function difficultyLabel(value) {
 const labels = isZh.value
  ? { easy: '轻松', medium: '适中', hard: '挑战', custom: '自定义' }
  : { easy: 'Easy', medium: 'Medium', hard: 'Hard', custom: 'Custom' }
 return labels[value] || labels.custom
}

function requirementLabel(activity) {
 const requirement = activity.requirement || {}
 if (!requirement.metric || requirement.metric === 'none') return activityText.value.noRequirement
 const labels = isZh.value
  ? { checkin_days: '签到天数', invite_count: '邀请人数', novel_count: '作品数', chapter_count: '章节数', word_count: '创作字数', account_age_days: '注册天数' }
  : { checkin_days: 'Check-ins', invite_count: 'Invites', novel_count: 'Works', chapter_count: 'Chapters', word_count: 'Words', account_age_days: 'Account age' }
 const value = Number(activity.eligibility?.value ?? 0)
 const operator = requirement.operator === 'lte' ? '≤' : '≥'
 return `${labels[requirement.metric] || requirement.metric} ${value} / ${operator}${Number(requirement.threshold || 0)}`
}

async function claimPointsActivity(activity) {
 const id = activity.id || activity._id
 claimingActivityId.value = id
 activityMessage.value = ''
 try {
  const result = await authStore.claimActivity(id)
  activityMessage.value = result.message
  activityMessageOk.value = Boolean(result.won)
  if (result.balance) {
   totalTokens.value = result.balance.total || totalTokens.value
   usedTokens.value = result.balance.used || 0
   availableTokens.value = result.balance.available || 0
  }
  await loadActivities()
 } catch (error) {
  activityMessage.value = error.response?.data?.message || error.message
  activityMessageOk.value = false
 }
 claimingActivityId.value = ''
}

async function loadCheckinStatus() {
 try {
 const data = await authStore.getCheckinStatus()
 checkinDone.value = data.checkedIn
 checkinDayIndex.value = data.dayIndex || 0
 checkinTotal.value = data.totalDays || 0
 } catch {}
}

async function loadInviteInfo() {
 try {
 inviteInfo.value = await authStore.getInviteInfo()
 } catch {}
}

async function doCheckin() {
 checkining.value = true; checkinMsg.value = ''
 try {
 const data = await authStore.checkin()
 checkinDone.value = true
 checkinDayIndex.value = data.dayIndex
 checkinTotal.value = data.totalDays
 checkinMsg.value = data.message
 checkinOk.value = true
 } catch (e) {
 checkinMsg.value = e.response?.data?.message || '签到失败'
 checkinOk.value = false
 }
 checkining.value = false
}

function copyToClipboard(text, label) {
 // 优先使用 Clipboard API（HTTPS 环境）
 if (navigator.clipboard && navigator.clipboard.writeText) {
 navigator.clipboard.writeText(text).then(() => {
 alert(`${label}已复制`)
 }).catch(() => {
 fallbackCopy(text, label)
 })
 } else {
 fallbackCopy(text, label)
 }
}

function fallbackCopy(text, label) {
 const ta = document.createElement('textarea')
 ta.value = text
 ta.style.position = 'fixed'
 ta.style.left = '-9999px'
 ta.style.top = '-9999px'
 document.body.appendChild(ta)
 ta.select()
 ta.setSelectionRange(0, text.length)
 try {
 document.execCommand('copy')
 alert(`${label}已复制`)
 } catch {
 // 全失败时引导用户手动复制
 prompt('请手动复制以下内容：', text)
 }
 document.body.removeChild(ta)
}

function copyInviteCode() {
 if (inviteInfo.value.inviteCode) {
 copyToClipboard(inviteInfo.value.inviteCode, '邀请码')
 }
}

function copyInviteLink() {
 if (inviteInfo.value.inviteLink) {
 copyToClipboard(inviteInfo.value.inviteLink, '邀请链接')
 }
}

async function loadTokenInfo() {
 ledgerLoading.value = true
 try {
 const res = await authStore.getTokenInfo()
 totalTokens.value = res.total || 0
 usedTokens.value = res.used || 0
 availableTokens.value = res.available || 0
 ledger.value = Array.isArray(res.ledger) ? [...res.ledger].reverse() : []
 } catch (e) { console.error('获取积分信息失败:', e) }
 finally { ledgerLoading.value = false }
}

function ledgerReason(reason) {
 const labels = { daily_checkin: '每日签到', invite_reward: '邀请奖励', group_reward: '进群奖励', purchase: '充值', novel_generation: '模型生成' }
 if (String(reason || '').startsWith('activity:')) return '活动奖励'
 if (String(reason || '').startsWith('admin_adjust:')) return `管理员调整：${String(reason).slice(13)}`
 return labels[reason] || reason || '积分变动'
}

async function loadStats() {
 try { stats.value = await authStore.getUserStats() }
 catch (e) { console.error('获取统计失败:', e) }
}

async function loadModelConfig() {
 try {
 const payload = await authStore.getModelConfig()
 const config = payload?.modelConfig || payload || {}
 applyPublicRoutes(payload)
 const routeId = publicRoutes.value.some(route => route.id === config.routeId) ? config.routeId : publicRoutes.value[0]?.id
 modelConfig.value = { routeId: routeId || 'normal_1', routeAlias: routeLabel(routeId) }
 } catch (e) { console.error('加载线路配置失败:', e) }
}

async function saveConfig() {
 savingConfig.value = true; configMsg.value = ''
 try {
 const response = await authStore.saveModelConfig({ routeId: modelConfig.value.routeId })
 const savedConfig = response?.modelConfig || response || {}
 if (savedConfig.routeId) modelConfig.value.routeId = savedConfig.routeId
 modelConfig.value.routeAlias = routeLabel(modelConfig.value.routeId)
 configMsg.value = ' ' + t('profile.saved')
 configMsgOk.value = true
 } catch (e) {
 configMsg.value = ' ' + (e.response?.data?.message || e.message)
 configMsgOk.value = false
 }
 savingConfig.value = false
}

function goToLogin() { router.push('/login') }
function goToRegister() { router.push('/register') }
async function updateNickname() {
 if (!newNickname.value.trim()) return
 try { await authStore.updateProfile(newNickname.value.trim()); alert(t('profile.nickUpdated')) }
 catch (e) { alert(t('profile.nickFail') + (e.response?.data?.message || e.message)) }
}
async function handleLogout() {
 authStore.logout()
 router.push('/login')
}
</script>

<style scoped>
.profile-page { padding-top: var(--header-height); }
.page-header {
 position: fixed; top: 0; left: 0; right: 0; height: var(--header-height);
 background: var(--card-bg); display: flex; align-items: center; justify-content: center;
 font-size: 16px; font-weight: 600; border-bottom: 1px solid var(--border-color); z-index: 100;
}
.profile-content { padding: 8px 0; }
.not-logged-in { text-align: center; padding: 40px 20px; }
.avatar-placeholder { font-size: 48px; }
.user-card { display: flex; align-items: center; gap: 14px; }
.avatar {
 width: 48px; height: 48px; border-radius: 50%;
 background: linear-gradient(135deg, var(--primary-color), var(--accent));
 color: white; display: flex; align-items: center; justify-content: center;
 font-size: 20px; font-weight: 700; flex-shrink: 0;
}
.user-info { flex: 1; min-width: 0; }
.user-name { font-size: 16px; font-weight: 600; color: var(--text-primary); }
.user-email { font-size: 12px; color: var(--text-light); margin-top: 2px; }
.token-card { text-align: center; }
.token-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
.token-ball-wrapper { display: flex; justify-content: center; position: relative; height: 120px; }
.token-ball {
 width: 120px; height: 120px; border-radius: 50%;
 background: var(--primary-light); overflow: hidden;
 position: relative; box-shadow: 0 4px 16px rgba(47, 101, 70, 0.16); cursor: default;
}
.water-wave { position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(180deg, #79b98b, var(--primary)); transition: height 0.6s ease; }
.wave { position: absolute; top: -8px; left: 0; right: 0; height: 16px; background: rgba(255,255,255,0.3); border-radius: 50%; }
.wave1 { animation: waveMove 3s linear infinite; }
.wave2 { animation: waveMove 4s linear infinite reverse; opacity: 0.5; }
@keyframes waveMove {
 0% { transform: translateX(-10%) rotate(0deg); }
 100% { transform: translateX(10%) rotate(5deg); }
}
.token-ball-text { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; color: white; text-shadow: 0 1px 4px rgba(0,0,0,0.3); z-index: 1; }
.token-num { font-size: 26px; font-weight: 700; }
.token-label { font-size: 12px; opacity: 0.9; }
.token-info-row { display: flex; justify-content: space-around; font-size: 12px; color: var(--text-light); padding: 8px 0; }
.group-info-card { margin-top: 12px; padding: 16px; border-radius: 10px; background: var(--accent-light); border: 1px solid var(--warning-border); text-align: center; animation: fadeIn 0.3s ease; }
.group-info-text { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
.group-qq { font-size: 22px; font-weight: 700; color: var(--primary-color); }
.group-hint { font-size: 12px; color: var(--text-light); margin-top: 4px; }
.ledger-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.ledger-list { margin-top:8px; }
.ledger-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid var(--border-color); color:var(--text-light); font-size:11px; }
.ledger-row:last-child { border-bottom:0; }
.ledger-row > div { min-width:0; display:flex; align-items:center; gap:8px; }
.ledger-credit { color:var(--success-color); }.ledger-debit { color:var(--error-color); }.ledger-reason { overflow-wrap:anywhere; color:var(--text-secondary); }.ledger-empty { padding:16px 0 4px; color:var(--text-light); font-size:13px; text-align:center; }

/* 签到 */
.checkin-card { text-align: center; }
.checkin-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.checkin-total { font-size: 12px; color: var(--text-light); }
.checkin-streak { display: flex; gap: 4px; justify-content: center; margin-bottom: 14px; }
.checkin-day { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 6px; border-radius: 10px; background: #f5f5f5; min-width: 44px; transition: all 0.2s; }
.checkin-day.active { background: var(--primary-light); border: 1px solid var(--primary-color); }
.checkin-day.done { background: var(--success-bg); border: 1px solid var(--success-border); }
.checkin-day.today { border: 2px solid var(--primary-color); }
.day-icon { font-size: 16px; }
.day-label { font-size: 10px; color: var(--text-light); }
.day-reward { font-size: 11px; font-weight: 700; color: var(--primary-color); }
.checkin-msg { margin-top: 8px; font-size: 13px; color: var(--error-color); }
.checkin-msg.ok { color: var(--success-color); }

/* 积分活动 */
.activity-heading, .activity-title-row, .activity-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.activity-heading { margin-bottom: 4px; }
.activity-list { display: flex; flex-direction: column; }
.activity-row { padding: 14px 0; border-bottom: 1px solid var(--border-color); }
.activity-row:last-child { padding-bottom: 2px; border-bottom: 0; }
.activity-title-row strong { min-width: 0; color: var(--text-primary); font-size: 14px; overflow-wrap: anywhere; }
.activity-badge { flex: 0 0 auto; padding: 3px 7px; color: var(--primary-hover); background: var(--primary-light); border-radius: 4px; font-size: 11px; font-weight: 700; }
.activity-description { margin-top: 6px; color: var(--text-secondary); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
.activity-meta { display: flex; flex-wrap: wrap; gap: 5px 12px; margin-top: 8px; color: var(--text-light); font-size: 11px; }
.activity-actions { align-items: flex-end; margin-top: 10px; }
.activity-state { min-width: 0; color: var(--text-light); font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
.activity-state.ready { color: var(--success-color); font-weight: 600; }
.activity-empty { padding: 20px 0 8px; color: var(--text-light); font-size: 13px; text-align: center; }
.activity-message { margin-top: 10px; color: var(--error-color); font-size: 13px; }
.activity-message.ok { color: var(--success-color); }

/* 邀请 */
.invite-card { text-align: center; border-color: var(--warning-border); background: linear-gradient(135deg, var(--accent-light), #fffaf0); }
.invite-stats { display: flex; gap: 20px; justify-content: center; margin: 12px 0; }
.invite-stat { display: flex; flex-direction: column; align-items: center; }
.invite-stat .stat-num { font-size: 22px; font-weight: 700; color: var(--primary-color); }
.invite-stat span:last-child { font-size: 11px; color: var(--text-light); }
.invite-code-row { display: flex; align-items: center; gap: 8px; justify-content: center; margin-bottom: 10px; }
.invite-label { font-size: 13px; color: var(--text-secondary); }
.invite-code { font-size: 18px; font-weight: 700; color: var(--primary-color); cursor: pointer; letter-spacing: 2px; }
.invite-code:hover { text-decoration: underline; }
.invite-qr { margin: 10px 0; }
.invite-qr img { border-radius: 8px; border: 1px solid var(--border-color); }
.invite-hint { font-size: 12px; color: var(--text-light); margin-top: 6px; }
.invite-hint strong { color: var(--primary-color); }

@media (max-width: 420px) {
 .activity-actions { align-items: stretch; flex-direction: column; }
 .activity-actions .btn { width: 100%; }
}

/* 语言切换 */
.lang-switch-row { display: flex; gap: 10px; }
.toggle-btn { flex: 1; padding: 10px; border: 2px solid var(--border-color); border-radius: 10px; font-size: 14px; font-weight: 600; background: #f8f8f8; cursor: pointer; font-family: inherit; transition: all 0.2s; }
.toggle-btn.active { border-color: var(--primary-color); background: var(--primary-light); }
.model-config-card { border: 1px solid var(--warning-border); }
.route-selector { margin-top: 14px; }
.current-route { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; padding: 10px 12px; border: 1px solid var(--card-border); border-radius: 8px; color: var(--text-secondary); background: var(--primary-light); font-size: 13px; }
.current-route strong { min-width: 0; color: var(--primary-hover); text-align: right; overflow-wrap: anywhere; }
.config-desc { font-size: 12px; color: var(--text-light); margin-bottom: 12px; }
.form-group { margin-bottom: 14px; }
.form-group label { display: block; font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-bottom: 6px; }
.select-input { appearance: auto; cursor: pointer; }
.system-info { background: var(--accent-light); border-radius: 8px; padding: 14px; margin-bottom: 14px; border: 1px solid var(--warning-border); }
.system-info-icon { font-size: 24px; margin-bottom: 6px; }
.system-info div:not(:last-child) { margin-bottom: 4px; }
.system-info .system-price { font-size: 12px; color: var(--text-light); }
.system-info .system-balance { font-size: 13px; }
.model-list { margin-top: 10px; max-height: 160px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; }
.model-item { padding: 8px 12px; cursor: pointer; font-size: 13px; border-bottom: 1px solid var(--border-color); transition: background 0.15s; }
.model-item:hover { background: #f5f5f5; }
.model-item:last-child { border-bottom: none; }
.model-name { color: var(--text-primary); font-weight: 500; }
.model-size { color: var(--text-light); font-size: 11px; margin-left: 8px; }
.model-error { color: var(--error-color); font-size: 12px; margin-top: 8px; }
.config-msg { margin-top: 10px; font-size: 14px; font-weight: 500; color: var(--error-color); }
.config-msg.ok { color: var(--success-color); }
.stats-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; }
.stat-item { text-align: center; }
.stat-number { font-size: 18px; font-weight: 700; color: var(--primary-color); }
.stat-label { font-size: 12px; color: var(--text-light); margin-top: 2px; }
.nickname-edit { display: flex; gap: 8px; }
.nickname-edit .input { flex: 1; }
.nickname-edit .btn { flex-shrink: 0; }
.logout-btn { margin-top: 12px; color: var(--error-color); border-color: var(--error-color); }
.logout-btn:hover { background: #fff1f0; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
</style>
