<template>
  <view class="page-container profile-page">
    <view class="page-header">
      <text>我的</text>
    </view>

    <view class="profile-content">
      <!-- 未登录 -->
      <view v-if="!authStore.isLoggedIn" class="card not-logged-in">
        <view class="avatar-placeholder">👤</view>
        <view class="text" style="margin:12px 0;font-size:16px;">请先登录</view>
        <button class="btn btn-primary btn-block" @click="goToLogin">登录</button>
        <button class="btn btn-outline btn-block" style="margin-top:8px;" @click="goToRegister">注册</button>
      </view>

      <!-- 已登录 -->
      <view v-else>
        <view class="card user-card">
          <view class="avatar">{{ (authStore.user?.email || 'U').charAt(0).toUpperCase() }}</view>
          <view class="user-info">
            <view class="user-name">{{ authStore.user?.nickname || '书友' }}</view>
            <view class="user-email">{{ authStore.user?.email }}</view>
          </view>
        </view>

        <!-- 积分账户 -->
        <view class="card points-card">
          <view class="points-title">积分余额</view>
          <view class="points-ball-wrapper">
            <view class="points-ball">
              <view class="water-wave" :style="{ height: (100 - pointsPercent) + '%' }">
                <view class="wave wave1"></view>
                <view class="wave wave2"></view>
              </view>
              <view class="points-ball-text">
                <view class="points-num">{{ availablePoints.toLocaleString() }}</view>
                <view class="points-label">可用积分</view>
              </view>
            </view>
          </view>
          <view class="points-info-row">
            <text>总积分 {{ totalPoints.toLocaleString() }}</text>
            <text>已使用 {{ usedPoints.toLocaleString() }}</text>
          </view>
          <button class="btn btn-primary btn-block" style="margin-top:10px;" @click="showGroupInfo = !showGroupInfo">
            获取积分
          </button>
          <view v-if="showGroupInfo" class="group-info-card">
            <view class="group-info-text">可通过积分活动免费获取，或联系群主充值</view>
            <view class="group-qq">1019601998</view>
            <view class="group-hint">充值基准：1 元 = 1000 积分</view>
          </view>
        </view>

        <view class="card ledger-card">
          <view class="ledger-header"><view class="section-title" style="margin:0;">积分流水</view><button class="refresh-button" :disabled="ledgerLoading" @click="loadPointsInfo">刷新</button></view>
          <view v-if="ledger.length === 0" class="ledger-empty">暂无积分记录</view>
          <view v-else class="ledger-list">
            <view v-for="(entry, index) in ledger" :key="`${entry.createdAt}-${index}`" class="ledger-row">
              <view><text :class="entry.type === 'credit' ? 'ledger-credit' : 'ledger-debit'">{{ entry.type === 'credit' ? '+' : '-' }}{{ Number(entry.points || 0) }}</text><text class="ledger-reason">{{ ledgerReason(entry.reason) }}</text></view>
              <text>{{ formatLedgerTime(entry.createdAt) }}</text>
            </view>
          </view>
        </view>

        <!-- 积分活动 -->
        <view class="card activities-card">
          <view class="activity-section-header">
            <view>
              <view class="section-title" style="margin:0;">积分活动</view>
              <view class="section-subtitle">完成任务或参与抽奖，免费领取积分</view>
            </view>
            <button class="refresh-button" :disabled="activitiesLoading" @click="loadActivities">
              {{ activitiesLoading ? '刷新中' : '刷新' }}
            </button>
          </view>

          <view v-if="activitiesLoading && activities.length === 0" class="activity-state">
            <view class="loading-spinner"></view>
          </view>
          <view v-else-if="activitiesError && activities.length === 0" class="activity-state error-state">
            <text>{{ activitiesError }}</text>
            <button class="btn btn-outline btn-sm" @click="loadActivities">重新加载</button>
          </view>
          <view v-else-if="activities.length === 0" class="activity-state">暂无可参与的积分活动</view>

          <view v-else class="activity-list">
            <view v-for="activity in activities" :key="activity.id" class="activity-item">
              <view class="activity-heading">
                <view class="activity-name-wrap">
                  <text class="activity-name">{{ activity.name }}</text>
                  <text class="activity-type">{{ activityTypeLabel(activity.type) }}</text>
                </view>
                <text class="activity-status" :class="'status-' + activity.status">
                  {{ activityStatusLabel(activity.status) }}
                </text>
              </view>
              <view v-if="activity.description" class="activity-description">{{ activity.description }}</view>

              <view class="activity-meta">
                <text>{{ activityRewardText(activity) }}</text>
                <text>中奖概率 {{ formatProbability(activity.probability) }}</text>
                <text>难度 {{ difficultyLabel(activity.difficulty) }}</text>
              </view>

              <view v-if="hasActivityProgress(activity)" class="activity-progress">
                <view class="progress-copy">
                  <text>{{ requirementLabel(activity.requirement?.metric) }}</text>
                  <text>{{ activityProgressText(activity) }}</text>
                </view>
                <view class="progress-track">
                  <view class="progress-value" :style="{ width: activityProgressPercent(activity) + '%' }"></view>
                </view>
              </view>

              <view class="activity-action-row">
                <text class="activity-reason">{{ activity.canClaim ? claimLimitText(activity) : activity.eligibility?.reason }}</text>
                <button class="btn btn-primary btn-sm claim-button"
                  :disabled="!activity.canClaim || claimingActivityId === activity.id"
                  @click="claimPoints(activity)">
                  {{ claimingActivityId === activity.id ? '领取中' : activity.canClaim ? '立即领取' : '暂不可领' }}
                </button>
              </view>
              <view v-if="activityResults[activity.id]" class="claim-result" :class="{ won: activityResults[activity.id].won }">
                {{ activityResults[activity.id].message }}
              </view>
            </view>
          </view>
        </view>

        <!-- 统计 -->
        <view class="card stats-card">
          <view class="section-title">统计数据</view>
          <view class="stats-grid">
            <view class="stat-item"><view class="stat-number">{{ stats.totalNovels }}</view><view class="stat-label">总作品</view></view>
            <view class="stat-item"><view class="stat-number">{{ stats.totalWords }}</view><view class="stat-label">总字数</view></view>
            <view class="stat-item"><view class="stat-number">{{ stats.completedNovels }}</view><view class="stat-label">已完成</view></view>
            <view class="stat-item"><view class="stat-number">{{ stats.inProgressNovels }}</view><view class="stat-label">进行中</view></view>
          </view>
        </view>

        <!-- 签到 -->
        <view class="card checkin-card">
          <view class="checkin-header">
            <view class="section-title" style="margin:0;">📅 签到</view>
            <text class="checkin-total">已签到 {{ checkinTotal }} 天</text>
          </view>
          <view class="checkin-streak">
            <view v-for="d in 7" :key="d" class="checkin-day"
              :class="{ active: d <= checkinDayIndex, today: d === checkinDayIndex && !checkinDone, done: d <= checkinDayIndex && (d < checkinDayIndex || checkinDone) }">
              <view class="day-icon">{{ d === 7 ? '🎁' : '📅' }}</view>
              <view class="day-label">Day {{ d }}</view>
              <view class="day-reward">{{ d === 7 ? '200' : '100' }}</view>
            </view>
          </view>
          <button class="btn btn-primary btn-block" :disabled="checkinDone || checkining" @click="doCheckin">
            {{ checkining ? '⏳' : checkinDone ? '✅ 已签到' : '📅 今日签到' }}
          </button>
          <view v-if="checkinMsg" class="checkin-msg" :class="{ ok: checkinOk }">{{ checkinMsg }}</view>
        </view>

        <!-- 邀请 -->
        <view class="card invite-card">
          <view class="section-title">👥 邀请好友</view>
          <view class="invite-stats">
            <view class="invite-stat"><text class="stat-num">{{ inviteInfo.inviteCount }}</text><text>已邀请</text></view>
            <view class="invite-stat"><text class="stat-num">{{ inviteInfo.inviteRewards }}</text><text>获得积分</text></view>
          </view>
          <view class="invite-code-row">
            <text class="invite-label">邀请码</text>
            <text class="invite-code" @click="copyInviteCode">{{ inviteInfo.inviteCode }}</text>
            <button class="btn btn-sm btn-outline" @click="copyInviteLink">复制链接</button>
          </view>
          <view class="invite-hint">每邀请一位新用户注册，您可获得 <text style="color:var(--primary-color);font-weight:700;">2000 积分</text></view>
        </view>

        <!-- 昵称 -->
        <view class="card">
          <view class="section-title">修改昵称</view>
          <view class="nickname-edit">
            <input v-model="newNickname" class="input" placeholder="输入新昵称" maxlength="20" />
            <button class="btn btn-primary btn-sm" @click="updateNickname" :disabled="!newNickname.trim()">保存</button>
          </view>
        </view>

        <!-- 用户只选择匿名生成线路，真实模型映射仅由后台维护。 -->
        <view class="card model-config-card">
          <view class="section-title">生成线路</view>
          <view class="config-desc">不同线路的生成速度、长篇能力和积分消耗可能不同</view>
          <view class="form-group">
            <text class="label">当前线路</text>
            <picker :value="routeIndex" :range="routeLabels" @change="onRoutePicker">
              <view class="input picker-input">
                <text>{{ routeLabels[routeIndex] || routeLabel(modelConfig.routeId) }}</text>
                <text class="picker-arrow">⌄</text>
              </view>
            </picker>
          </view>
          <view class="route-summary">
            <text class="route-summary-label">已选择</text>
            <text class="route-summary-value">{{ routeLabel(modelConfig.routeId) }}</text>
          </view>

          <button class="btn btn-primary btn-block" style="margin-top:14px;" :disabled="savingConfig" @click="saveConfig">
            {{ savingConfig ? '保存中...' : '保存线路' }}
          </button>
          <view v-if="configMsg" class="config-msg" :class="{ ok: configMsgOk }">{{ configMsg }}</view>
        </view>

        <button class="btn btn-outline btn-block logout-btn" @click="handleLogout">退出登录</button>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted, onActivated } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { toUserFacingMessage } from '../../utils/userFacing'

const authStore = useAuthStore()
const newNickname = ref('')
const showGroupInfo = ref(false)

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
const totalPoints = ref(0)
const usedPoints = ref(0)
const availablePoints = ref(0)
const ledger = ref([])
const ledgerLoading = ref(false)
const pointsPercent = computed(() => {
  if (totalPoints.value === 0) return 100
  return Math.min(100, Math.round(usedPoints.value / totalPoints.value * 100))
})

// 匿名线路。客户端固定别名，不信任接口返回的展示名称。
const routeDefinitions = [
  { id: 'normal_1', label: '普通线路模型一' },
  { id: 'normal_2', label: '普通线路模型二' },
  { id: 'advanced_1', label: '高级线路模型一' },
  { id: 'vip', label: 'VIP线路模型' },
  { id: 'svip', label: 'SVIP线路模型' },
]
const publicRoutes = ref([...routeDefinitions])
const routeLabels = computed(() => publicRoutes.value.map(route => route.label))
const routeIndex = ref(0)
const modelConfig = ref({ routeId: 'normal_1' })
const savingConfig = ref(false)
const configMsg = ref('')
const configMsgOk = ref(false)

// 积分活动
const activities = ref([])
const activitiesLoading = ref(false)
const activitiesError = ref('')
const claimingActivityId = ref('')
const activityResults = ref({})

const activityTypeLabels = {
  login: '登录奖励', checkin: '签到阶梯', writing: '写作挑战', continuous: '连续创作',
  invite: '邀请奖励', lottery: '幸运抽奖', new_user: '新手任务', custom: '自定义任务',
}
const requirementLabels = {
  none: '无需门槛', checkin_days: '累计签到天数', invite_count: '成功邀请人数',
  novel_count: '作品数量', chapter_count: '生成章节数', word_count: '累计创作字数',
  account_age_days: '注册天数',
}

// 统计
const stats = ref({ totalNovels: 0, totalWords: 0, completedNovels: 0, inProgressNovels: 0 })

onMounted(async () => {
  if (!authStore.isLoggedIn) return
  loadPointsInfo()
  loadStats()
  loadModelConfig()
  loadCheckinStatus()
  loadInviteInfo()
  loadActivities()
})

onActivated(() => {
  if (!authStore.isLoggedIn) return
  checkinMsg.value = ''
  configMsg.value = ''
  loadPointsInfo()
  loadStats()
  loadCheckinStatus()
  loadInviteInfo()
  loadActivities()
})

function routeLabel(routeId) {
  return routeDefinitions.find(route => route.id === routeId)?.label || routeDefinitions[0].label
}

function applyPublicRoutes(payload) {
  const ids = (payload?.routes || [])
    .map(route => route?.id || route?.routeId)
    .filter(id => routeDefinitions.some(route => route.id === id))
  publicRoutes.value = ids.length
    ? routeDefinitions.filter(route => ids.includes(route.id))
    : [...routeDefinitions]
}

function syncRouteIndex() {
  const index = publicRoutes.value.findIndex(route => route.id === modelConfig.value.routeId)
  routeIndex.value = index >= 0 ? index : 0
}

function onRoutePicker(e) {
  const index = Number(e.detail.value) || 0
  routeIndex.value = index
  modelConfig.value.routeId = publicRoutes.value[index]?.id || 'normal_1'
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
  try { inviteInfo.value = await authStore.getInviteInfo() } catch {}
}

async function loadPointsInfo() {
  ledgerLoading.value = true
  try {
    const res = await authStore.getPointsInfo()
    totalPoints.value = res.total || 0
    usedPoints.value = res.used || 0
    availablePoints.value = res.available || 0
    ledger.value = Array.isArray(res.ledger) ? [...res.ledger].reverse() : []
  } catch (e) { console.error('获取积分失败:', e) }
  finally { ledgerLoading.value = false }
}

function ledgerReason(reason) {
  const labels = { daily_checkin: '每日签到', invite_reward: '邀请奖励', group_reward: '进群奖励', purchase: '充值', novel_generation: '模型生成' }
  if (String(reason || '').startsWith('activity:')) return '活动奖励'
  if (String(reason || '').startsWith('admin_adjust:')) return `管理员调整：${String(reason).slice(13)}`
  return labels[reason] || reason || '积分变动'
}

function formatLedgerTime(value) {
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? new Date(time).toLocaleDateString('zh-CN') : ''
}

async function loadStats() {
  try { stats.value = await authStore.getUserStats() }
  catch (e) { console.error('获取统计失败:', e) }
}

async function loadModelConfig() {
  try {
    const payload = await authStore.getModelConfig()
    applyPublicRoutes(payload)
    const requestedId = payload?.modelConfig?.routeId
    modelConfig.value.routeId = publicRoutes.value.some(route => route.id === requestedId)
      ? requestedId
      : (publicRoutes.value[0]?.id || 'normal_1')
    syncRouteIndex()
  } catch (e) { console.error('加载线路配置失败:', e) }
}

function activityTypeLabel(type) {
  return activityTypeLabels[type] || '积分活动'
}

function activityStatusLabel(status) {
  return { active: '进行中', pending: '未开始', ended: '已结束', disabled: '已停用' }[status] || '进行中'
}

function difficultyLabel(value) {
  return { easy: '轻松', medium: '适中', hard: '挑战', custom: '自定义' }[value] || '轻松'
}

function requirementLabel(metric) {
  return requirementLabels[metric] || '任务进度'
}

function formatProbability(value) {
  const probability = Number(value ?? 100)
  return `${Number.isInteger(probability) ? probability : probability.toFixed(1)}%`
}

function activityRewardText(activity) {
  const fixed = Number(activity?.rewardPoints || activity?.tokenAmount || 0)
  const min = Number(activity?.reward?.min ?? fixed)
  const max = Number(activity?.reward?.max ?? min)
  return min === max ? `奖励 ${min.toLocaleString()} 积分` : `奖励 ${min.toLocaleString()}-${max.toLocaleString()} 积分`
}

function hasActivityProgress(activity) {
  return activity?.requirement?.metric && activity.requirement.metric !== 'none'
}

function activityProgressValues(activity) {
  const threshold = Math.max(0, Number(activity?.requirement?.threshold || activity?.eligibility?.threshold || 0))
  const value = Math.max(0, Number(activity?.eligibility?.value || 0))
  return { value, threshold }
}

function activityProgressText(activity) {
  const { value, threshold } = activityProgressValues(activity)
  return `${value.toLocaleString()} / ${threshold.toLocaleString()}`
}

function activityProgressPercent(activity) {
  const { value, threshold } = activityProgressValues(activity)
  if (threshold <= 0) return 100
  if (activity?.requirement?.operator === 'lte') return value <= threshold ? 100 : 0
  return Math.min(100, Math.round(value / threshold * 100))
}

function claimLimitText(activity) {
  const eligibility = activity?.eligibility || {}
  if (eligibility.remainingToday !== null && eligibility.remainingToday !== undefined) {
    return `今日还可参与 ${eligibility.remainingToday} 次`
  }
  if (eligibility.remainingTotal !== null && eligibility.remainingTotal !== undefined) {
    return `还可参与 ${eligibility.remainingTotal} 次`
  }
  return '已满足领取条件'
}

function normalizeActivity(activity) {
  return {
    ...activity,
    id: String(activity?.id || activity?._id || ''),
    name: toUserFacingMessage(activity?.name || '积分活动'),
    description: toUserFacingMessage(activity?.description || ''),
    eligibility: activity?.eligibility
      ? { ...activity.eligibility, reason: toUserFacingMessage(activity.eligibility.reason || '') }
      : null,
  }
}

async function loadActivities() {
  if (activitiesLoading.value) return
  activitiesLoading.value = true
  activitiesError.value = ''
  try {
    const result = await authStore.getActivities()
    activities.value = result.map(normalizeActivity)
  } catch (e) {
    activitiesError.value = e.message || '活动加载失败'
  } finally {
    activitiesLoading.value = false
  }
}

async function claimPoints(activity) {
  if (!activity?.canClaim || claimingActivityId.value) return
  claimingActivityId.value = activity.id
  try {
    const result = await authStore.claimActivity(activity.id)
    activityResults.value = {
      ...activityResults.value,
      [activity.id]: { won: Boolean(result.won), message: toUserFacingMessage(result.message || '参与成功') },
    }
    if (result.activity) {
      const index = activities.value.findIndex(item => item.id === activity.id)
      if (index >= 0) activities.value.splice(index, 1, normalizeActivity(result.activity))
    }
    await loadPointsInfo()
  } catch (e) {
    activityResults.value = {
      ...activityResults.value,
      [activity.id]: { won: false, message: e.message || '领取失败，请稍后重试' },
    }
    await loadActivities()
  } finally {
    claimingActivityId.value = ''
  }
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
    checkinMsg.value = e.message || '签到失败'
    checkinOk.value = false
  }
  checkining.value = false
}

function copyInviteCode() {
  if (inviteInfo.value.inviteCode) {
    uni.setClipboardData({ data: inviteInfo.value.inviteCode, success: () => uni.showToast({ title: '邀请码已复制' }) })
  }
}

function copyInviteLink() {
  if (inviteInfo.value.inviteLink) {
    uni.setClipboardData({ data: inviteInfo.value.inviteLink, success: () => uni.showToast({ title: '链接已复制' }) })
  }
}

async function updateNickname() {
  if (!newNickname.value.trim()) return
  try {
    await authStore.updateNickname(newNickname.value.trim())
    uni.showToast({ title: '昵称已更新', icon: 'success' })
  } catch (e) {
    uni.showModal({ title: '更新失败', content: e.message || '请重试' })
  }
}

async function saveConfig() {
  savingConfig.value = true; configMsg.value = ''
  try {
    const result = await authStore.saveModelConfig({ routeId: modelConfig.value.routeId })
    const savedId = result?.modelConfig?.routeId
    if (publicRoutes.value.some(route => route.id === savedId)) modelConfig.value.routeId = savedId
    syncRouteIndex()
    configMsg.value = '线路已保存'
    configMsgOk.value = true
  } catch (e) {
    configMsg.value = e.message || '保存失败'
    configMsgOk.value = false
  }
  savingConfig.value = false
}

function goToLogin() { uni.navigateTo({ url: '/pages/login/login' }) }
function goToRegister() { uni.navigateTo({ url: '/pages/register/register' }) }
function handleLogout() { authStore.logout(); uni.reLaunch({ url: '/pages/login/login' }) }
</script>

<style scoped>
.profile-page { padding-top: var(--header-height); }
.page-header { position:fixed;top:0;left:0;right:0;height:var(--header-height);background:var(--card-bg);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;border-bottom:1px solid var(--border-color);z-index:100; }
.profile-content { padding: 8px 0; }
.not-logged-in { text-align: center; padding: 40px 20px; }
.avatar-placeholder { font-size: 48px; }
.user-card { display: flex; align-items: center; gap: 14px; }
.avatar { width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,var(--primary-color),var(--accent-color));color:white;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;flex-shrink:0; }
.user-info { flex:1;min-width:0; }
.user-name { font-size:16px;font-weight:600;color:var(--text-primary); }
.user-email { font-size:12px;color:var(--text-light);margin-top:2px; }
.points-card { text-align: center; }
.points-title { font-size:15px;font-weight:600;margin-bottom:12px; }
.points-ball-wrapper { display:flex;justify-content:center;height:120px; }
.points-ball { width:120px;height:120px;border-radius:50%;background:#e5f1e8;overflow:hidden;position:relative;box-shadow:0 4px 16px rgba(63,125,90,0.2); }
.water-wave { position:absolute;bottom:0;left:0;right:0;background:linear-gradient(180deg,#68a87c,var(--primary-color));transition:height 0.6s ease; }
.wave { position:absolute;top:-8px;left:0;right:0;height:16px;background:rgba(255,255,255,0.3);border-radius:50%; }
.wave1 { animation: waveMove 3s linear infinite; }
.wave2 { animation: waveMove 4s linear infinite reverse; opacity:0.5; }
@keyframes waveMove { 0%{transform:translateX(-10%)rotate(0deg)} 100%{transform:translateX(10%)rotate(5deg)} }
.points-ball-text { position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;text-shadow:0 1px 4px rgba(0,0,0,0.3);z-index:1; }
.points-num { max-width:100px;font-size:24px;font-weight:700;overflow:hidden;text-overflow:ellipsis; }
.points-label { font-size:12px;opacity:0.9; }
.points-info-row { display:flex;justify-content:space-around;gap:8px;font-size:12px;color:var(--text-light);padding:8px 0; }
.group-info-card { margin-top:12px;padding:16px;border-radius:10px;background:#fff5f0;border:1px solid #ffe8d6;text-align:center;animation:fadeIn 0.3s; }
.group-info-text { font-size:13px;color:var(--text-secondary);margin-bottom:8px; }
.group-qq { font-size:22px;font-weight:700;color:var(--primary-color); }
.group-hint { font-size:12px;color:var(--text-light);margin-top:4px; }
.ledger-card { padding:16px; }.ledger-header { display:flex;align-items:center;justify-content:space-between;gap:10px; }.ledger-list { margin-top:6px; }.ledger-row { display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-color);font-size:11px;color:var(--text-light); }.ledger-row:last-child { border-bottom:0; }.ledger-row > view { min-width:0;display:flex;align-items:center;gap:7px; }.ledger-credit { color:var(--success-color);font-weight:700; }.ledger-debit { color:var(--error-color);font-weight:700; }.ledger-reason { color:var(--text-secondary);overflow-wrap:anywhere; }.ledger-empty { padding:14px 0 2px;color:var(--text-light);font-size:13px;text-align:center; }
.checkin-card { text-align:center; }
.checkin-header { display:flex;align-items:center;justify-content:space-between;margin-bottom:12px; }
.checkin-total { font-size:12px;color:var(--text-light); }
.checkin-streak { display:flex;gap:4px;justify-content:flex-start;margin-bottom:14px;overflow-x:auto;padding-bottom:4px; }
.checkin-day { display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 6px;border-radius:10px;background:#f5f5f5;min-width:44px; }
.checkin-day.active { background:#fff5f0;border:1px solid var(--primary-color); }
.checkin-day.done { background:#f6ffed;border:1px solid #b7eb8f; }
.checkin-day.today { border:2px solid var(--primary-color); }
.day-icon { font-size:16px; }
.day-label { font-size:10px;color:var(--text-light); }
.day-reward { font-size:11px;font-weight:700;color:var(--primary-color); }
.checkin-msg { margin-top:8px;font-size:13px;color:var(--error-color); }
.checkin-msg.ok { color:var(--success-color); }
.activities-card { padding:16px 0;overflow:hidden; }
.activity-section-header { display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 16px 14px; }
.section-subtitle { margin-top:3px;font-size:12px;color:var(--text-light); }
.refresh-button { flex-shrink:0;padding:6px 8px;background:transparent;border:0;color:var(--primary-color);font-size:12px;line-height:1; }
.refresh-button[disabled] { opacity:0.55; }
.activity-state { min-height:86px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;color:var(--text-light);font-size:13px; }
.error-state { color:var(--error-color); }
.activity-list { border-top:1px solid var(--border-color); }
.activity-item { padding:15px 16px;border-bottom:1px solid var(--border-color); }
.activity-item:last-child { border-bottom:0; }
.activity-heading { display:flex;align-items:flex-start;justify-content:space-between;gap:10px; }
.activity-name-wrap { min-width:0;display:flex;align-items:center;flex-wrap:wrap;gap:7px; }
.activity-name { max-width:100%;font-size:15px;font-weight:600;color:var(--text-primary);overflow-wrap:anywhere; }
.activity-type { padding:2px 6px;border-radius:4px;background:var(--accent-light);color:#9a5d1e;font-size:10px; }
.activity-status { flex-shrink:0;padding:3px 7px;border-radius:4px;background:var(--primary-light);color:var(--primary-color);font-size:10px; }
.status-pending { background:var(--accent-light);color:#9a5d1e; }
.status-ended,.status-disabled { background:#f0f2f0;color:var(--text-light); }
.activity-description { margin-top:7px;font-size:12px;line-height:1.55;color:var(--text-secondary);overflow-wrap:anywhere; }
.activity-meta { display:flex;flex-wrap:wrap;gap:6px;margin-top:10px; }
.activity-meta text { padding:4px 7px;border-radius:4px;background:#f3f7f2;color:var(--text-secondary);font-size:10px; }
.activity-progress { margin-top:11px; }
.progress-copy { display:flex;justify-content:space-between;gap:8px;margin-bottom:5px;font-size:11px;color:var(--text-light); }
.progress-track { height:6px;border-radius:3px;background:#e7eee8;overflow:hidden; }
.progress-value { height:100%;border-radius:3px;background:linear-gradient(90deg,var(--primary-color),var(--accent-color));transition:width .25s ease; }
.activity-action-row { display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px; }
.activity-reason { flex:1;min-width:0;font-size:11px;color:var(--text-light);overflow-wrap:anywhere; }
.claim-button { flex-shrink:0;min-width:82px;height:34px;padding:6px 10px; }
.claim-result { margin-top:9px;padding:8px 10px;border-radius:6px;background:#fff3f2;color:var(--error-color);font-size:12px; }
.claim-result.won { background:var(--primary-light);color:var(--primary-dark); }
.invite-card { text-align:center;border-color:#ffd591;background:linear-gradient(135deg,#fff7e6,#fffbe6); }
.invite-stats { display:flex;gap:20px;justify-content:center;margin:12px 0; }
.invite-stat { display:flex;flex-direction:column;align-items:center; }
.invite-stat .stat-num { font-size:22px;font-weight:700;color:var(--primary-color); }
.invite-stat text:last-child { font-size:11px;color:var(--text-light); }
.invite-code-row { display:flex;align-items:center;gap:8px;justify-content:center;margin-bottom:10px; }
.invite-label { font-size:13px;color:var(--text-secondary); }
.invite-code { font-size:18px;font-weight:700;color:var(--primary-color);letter-spacing:2px; }
.invite-hint { font-size:12px;color:var(--text-light);margin-top:6px; }
.stats-grid { display:grid;grid-template-columns:repeat(4,1fr);gap:8px; }
.stat-item { text-align:center; }
.stat-number { font-size:18px;font-weight:700;color:var(--primary-color); }
.stat-label { font-size:12px;color:var(--text-light);margin-top:2px; }
.nickname-edit { display:flex;gap:8px; }
.nickname-edit .input { flex:1; }
.model-config-card { border:1px solid #dce9df; }
.config-desc { font-size:12px;color:var(--text-light);margin-bottom:12px; }
.form-group { margin-bottom:14px; }
.form-group .label { display:block;font-size:13px;font-weight:500;color:var(--text-secondary);margin-bottom:6px; }
.picker-input { display:flex;align-items:center;justify-content:space-between;min-height:40px; }
.picker-arrow { color:var(--text-light);font-size:17px; }
.route-summary { display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:8px;background:var(--primary-light); }
.route-summary-label { font-size:12px;color:var(--text-light); }
.route-summary-value { font-size:13px;font-weight:600;color:var(--primary-dark); }
.config-msg { margin-top:9px;font-size:12px;color:var(--error-color);text-align:center; }
.config-msg.ok { color:var(--success-color); }
.logout-btn { margin-top:12px;color:var(--error-color);border-color:var(--error-color); }
@keyframes fadeIn { from{opacity:0} to{opacity:1} }
</style>
