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

        <!-- Token -->
        <view class="card token-card">
          <view class="token-title">Token 余额</view>
          <view class="token-ball-wrapper">
            <view class="token-ball">
              <view class="water-wave" :style="{ height: (100 - tokenPercent) + '%' }">
                <view class="wave wave1"></view>
                <view class="wave wave2"></view>
              </view>
              <view class="token-ball-text">
                <view class="token-num">{{ availableTokens.toLocaleString() }}</view>
                <view class="token-label">可用</view>
              </view>
            </view>
          </view>
          <view class="token-info-row">
            <text>总计 {{ totalTokens.toLocaleString() }}</text>
            <text>已用 {{ usedTokens.toLocaleString() }}</text>
          </view>
          <button class="btn btn-primary btn-block" style="margin-top:10px;" @click="showGroupInfo = !showGroupInfo">
            获取 Token
          </button>
          <view v-if="showGroupInfo" class="group-info-card">
            <view class="group-info-text">加QQ群联系群主购买Token</view>
            <view class="group-qq">1019601998</view>
            <view class="group-hint">购买后群主会手动充值</view>
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
            <view class="invite-stat"><text class="stat-num">{{ inviteInfo.inviteRewards }}</text><text>获得 Token</text></view>
          </view>
          <view class="invite-code-row">
            <text class="invite-label">邀请码</text>
            <text class="invite-code" @click="copyInviteCode">{{ inviteInfo.inviteCode }}</text>
            <button class="btn btn-sm btn-outline" @click="copyInviteLink">复制链接</button>
          </view>
          <view class="invite-hint">每邀请一位新用户注册，您可获得 <text style="color:var(--primary-color);font-weight:700;">2000 Token</text></view>
        </view>

        <!-- 昵称 -->
        <view class="card">
          <view class="section-title">修改昵称</view>
          <view class="nickname-edit">
            <input v-model="newNickname" class="input" placeholder="输入新昵称" maxlength="20" />
            <button class="btn btn-primary btn-sm" @click="updateNickname" :disabled="!newNickname.trim()">保存</button>
          </view>
        </view>

        <!-- 模型配置（仅管理员） -->
        <view v-if="authStore.user?.role === 'admin'" class="card model-config-card">
          <view class="section-title">AI 模型配置</view>
          <view class="config-desc">配置 AI 模型提供商和参数</view>
          <view class="form-group">
            <text class="label">提供商</text>
            <picker :value="providerIndex" :range="providerList" @change="onProviderPicker">
              <view class="input picker-input">{{ providerList[providerIndex] }}</view>
            </picker>
          </view>

          <!-- Ollama -->
          <template v-if="modelConfig.provider === 'ollama'">
            <view class="form-group">
              <text class="label">Ollama URL</text>
              <input v-model="modelConfig.ollamaBaseUrl" class="input" placeholder="http://localhost:11434" />
            </view>
            <view v-for="role in modelRoles" :key="role.key" class="form-group">
              <text class="label">{{ role.icon }} {{ role.label }}</text>
              <input v-model="modelConfig['ollama' + role.fieldSuffix]" class="input" :placeholder="role.placeholder" />
            </view>
          </template>

          <!-- 云端 -->
          <template v-if="modelConfig.provider === 'cloud'">
            <view class="form-group">
              <text class="label">API URL</text>
              <input v-model="modelConfig.cloudBaseUrl" class="input" placeholder="https://api.siliconflow.cn/v1" />
            </view>
            <view class="form-group">
              <text class="label">API Key</text>
              <input v-model="modelConfig.cloudApiKey" class="input" type="password" placeholder="sk-..." />
            </view>
            <view v-for="role in modelRoles" :key="role.key" class="form-group">
              <text class="label">{{ role.icon }} {{ role.label }}</text>
              <input v-model="modelConfig['cloud' + role.fieldSuffix]" class="input" :placeholder="role.placeholder" />
            </view>
          </template>

          <button class="btn btn-primary btn-block" style="margin-top:14px;" :disabled="savingConfig" @click="saveConfig">
            {{ savingConfig ? '保存中...' : '保存配置' }}
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
import { useNovelStore } from '../../stores/novel'

const authStore = useAuthStore()
const novelStore = useNovelStore()
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

// Token
const totalTokens = ref(0)
const usedTokens = ref(0)
const availableTokens = ref(0)
const tokenPercent = computed(() => {
  if (totalTokens.value === 0) return 100
  return Math.round(usedTokens.value / totalTokens.value * 100)
})

// 模型角色
const modelRoles = [
  { key: 'outline',  icon: '📐', label: '大纲模型', fieldSuffix: 'OutlineModel',  placeholder: 'deepseek-ai/DeepSeek-V4-Flash' },
  { key: 'writing',  icon: '✍️', label: '写作模型', fieldSuffix: 'WritingModel',  placeholder: 'deepseek-ai/DeepSeek-V4-Flash' },
  { key: 'polish',   icon: '✨', label: '润色模型', fieldSuffix: 'PolishModel',   placeholder: 'deepseek-ai/DeepSeek-V4-Flash' },
  { key: 'reasoning',icon: '🧠', label: '推理模型', fieldSuffix: 'ReasoningModel',placeholder: 'deepseek-ai/DeepSeek-V4-Flash' },
]

const providerList = ['默认', '系统', 'Ollama', '云端']
const providerIndex = ref(0)

const modelConfig = ref({
  provider: 'default',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaOutlineModel: '', ollamaWritingModel: '', ollamaPolishModel: '', ollamaReasoningModel: '',
  cloudBaseUrl: 'https://api.siliconflow.cn/v1',
  cloudApiKey: '', cloudOutlineModel: '', cloudWritingModel: '', cloudPolishModel: '', cloudReasoningModel: '',
})

const ollamaModels = ref([])
const ollamaLoading = ref(false)
const ollamaError = ref('')
const savingConfig = ref(false)
const configMsg = ref('')
const configMsgOk = ref(false)

// 统计
const stats = ref({ totalNovels: 0, totalWords: 0, completedNovels: 0, inProgressNovels: 0 })

onMounted(async () => {
  if (!authStore.isLoggedIn) return
  loadTokenInfo()
  loadStats()
  loadModelConfig()
  loadCheckinStatus()
  loadInviteInfo()
})

onActivated(() => {
  if (!authStore.isLoggedIn) return
  loadTokenInfo()
  loadStats()
  loadCheckinStatus()
  loadInviteInfo()
})

function onProviderPicker(e) {
  const map = ['default', 'system', 'ollama', 'cloud']
  modelConfig.value.provider = map[e.detail.value]
  providerIndex.value = e.detail.value
  if (modelConfig.value.provider === 'ollama') fetchOllamaModels()
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

async function loadTokenInfo() {
  try {
    const res = await authStore.getTokenInfo()
    totalTokens.value = res.total || 0
    usedTokens.value = res.used || 0
    availableTokens.value = res.available || 0
  } catch (e) { console.error('获取 Token 失败:', e) }
}

async function loadStats() {
  try { stats.value = await authStore.getUserStats() }
  catch (e) { console.error('获取统计失败:', e) }
}

async function loadModelConfig() {
  try {
    const res = await authStore.getModelConfig()
    if (res?.modelConfig) {
      modelConfig.value = { ...modelConfig.value, ...res.modelConfig }
      const idx = providerList.findIndex(p => p.toLowerCase() === res.modelConfig.provider)
      if (idx >= 0) providerIndex.value = idx
    }
  } catch (e) { console.error('加载模型配置失败:', e) }
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

async function fetchOllamaModels() {
  ollamaLoading.value = true; ollamaError.value = ''; ollamaModels.value = []
  try { ollamaModels.value = await authStore.fetchOllamaModels() }
  catch (e) { ollamaError.value = e.message || '连接失败' }
  ollamaLoading.value = false
}

async function saveConfig() {
  savingConfig.value = true; configMsg.value = ''
  try {
    await authStore.saveModelConfig({
      provider: modelConfig.value.provider,
      ollamaBaseUrl: modelConfig.value.ollamaBaseUrl,
      ollamaOutlineModel: modelConfig.value.ollamaOutlineModel,
      ollamaWritingModel: modelConfig.value.ollamaWritingModel,
      ollamaPolishModel: modelConfig.value.ollamaPolishModel,
      ollamaReasoningModel: modelConfig.value.ollamaReasoningModel,
      cloudBaseUrl: modelConfig.value.cloudBaseUrl,
      cloudApiKey: modelConfig.value.cloudApiKey,
      cloudOutlineModel: modelConfig.value.cloudOutlineModel,
      cloudWritingModel: modelConfig.value.cloudWritingModel,
      cloudPolishModel: modelConfig.value.cloudPolishModel,
      cloudReasoningModel: modelConfig.value.cloudReasoningModel,
    })
    configMsg.value = '✅ 已保存'
    configMsgOk.value = true
  } catch (e) {
    configMsg.value = '❌ ' + (e.message || '保存失败')
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
.avatar { width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,var(--primary-color),#ff6b6b);color:white;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;flex-shrink:0; }
.user-info { flex:1;min-width:0; }
.user-name { font-size:16px;font-weight:600;color:var(--text-primary); }
.user-email { font-size:12px;color:var(--text-light);margin-top:2px; }
.token-card { text-align: center; }
.token-title { font-size:15px;font-weight:600;margin-bottom:12px; }
.token-ball-wrapper { display:flex;justify-content:center;height:120px; }
.token-ball { width:120px;height:120px;border-radius:50%;background:#e8f4f8;overflow:hidden;position:relative;box-shadow:0 4px 16px rgba(0,150,200,0.2); }
.water-wave { position:absolute;bottom:0;left:0;right:0;background:linear-gradient(180deg,#40a9ff,#1890ff);transition:height 0.6s ease; }
.wave { position:absolute;top:-8px;left:0;right:0;height:16px;background:rgba(255,255,255,0.3);border-radius:50%; }
.wave1 { animation: waveMove 3s linear infinite; }
.wave2 { animation: waveMove 4s linear infinite reverse; opacity:0.5; }
@keyframes waveMove { 0%{transform:translateX(-10%)rotate(0deg)} 100%{transform:translateX(10%)rotate(5deg)} }
.token-ball-text { position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;text-shadow:0 1px 4px rgba(0,0,0,0.3);z-index:1; }
.token-num { font-size:26px;font-weight:700; }
.token-label { font-size:12px;opacity:0.9; }
.token-info-row { display:flex;justify-content:space-around;font-size:12px;color:var(--text-light);padding:8px 0; }
.group-info-card { margin-top:12px;padding:16px;border-radius:10px;background:#fff5f0;border:1px solid #ffe8d6;text-align:center;animation:fadeIn 0.3s; }
.group-info-text { font-size:13px;color:var(--text-secondary);margin-bottom:8px; }
.group-qq { font-size:22px;font-weight:700;color:var(--primary-color); }
.group-hint { font-size:12px;color:var(--text-light);margin-top:4px; }
.checkin-card { text-align:center; }
.checkin-header { display:flex;align-items:center;justify-content:space-between;margin-bottom:12px; }
.checkin-total { font-size:12px;color:var(--text-light); }
.checkin-streak { display:flex;gap:4px;justify-content:center;margin-bottom:14px; }
.checkin-day { display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 6px;border-radius:10px;background:#f5f5f5;min-width:44px; }
.checkin-day.active { background:#fff5f0;border:1px solid var(--primary-color); }
.checkin-day.done { background:#f6ffed;border:1px solid #b7eb8f; }
.checkin-day.today { border:2px solid var(--primary-color); }
.day-icon { font-size:16px; }
.day-label { font-size:10px;color:var(--text-light); }
.day-reward { font-size:11px;font-weight:700;color:var(--primary-color); }
.checkin-msg { margin-top:8px;font-size:13px;color:var(--error-color); }
.checkin-msg.ok { color:var(--success-color); }
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
.model-config-card { border:1px solid #ffe0d0; }
.config-desc { font-size:12px;color:var(--text-light);margin-bottom:12px; }
.form-group { margin-bottom:14px; }
.form-group .label { display:block;font-size:13px;font-weight:500;color:var(--text-secondary);margin-bottom:6px; }
.picker-input { display:flex;align-items:center;min-height:40px; }
.logout-btn { margin-top:12px;color:var(--error-color);border-color:var(--error-color); }
@keyframes fadeIn { from{opacity:0} to{opacity:1} }
</style>
