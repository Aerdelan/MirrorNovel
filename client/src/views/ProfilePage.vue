<template>
  <div class="page-container profile-page">
    <div class="page-header">
      <span>{{ $t('profile.title') }}</span>
    </div>

    <div class="profile-content">
      <!-- 未登录 -->
      <div v-if="!authStore.isLoggedIn" class="card not-logged-in">
        <div class="avatar-placeholder">👤</div>
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

        <!-- Token 水球 -->
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

        <!-- 模型配置（仅管理员可见） -->
        <div v-if="authStore.user?.role === 'admin'" class="card model-config-card">
          <div class="section-title">{{ $t('profile.aiConfig') }}</div>
          <div class="config-desc">{{ $t('profile.aiConfigDesc') }}</div>

          <div class="form-group">
            <label>{{ $t('profile.modelProvider') }}</label>
            <select v-model="modelConfig.provider" class="input select-input" @change="onProviderChange">
              <option value="default">{{ $t('profile.providerDefault') }}</option>
              <option value="system">{{ $t('profile.providerSystem') }}</option>
              <option value="ollama">{{ $t('profile.providerOllama') }}</option>
              <option value="cloud">{{ $t('profile.providerCloud') }}</option>
            </select>
          </div>

          <!-- System 提示 -->
          <div v-if="modelConfig.provider === 'system'" class="system-info">
            <div class="system-info-icon">💡</div>
            <div>{{ $t('profile.systemDesc') }}</div>
            <div class="system-price">{{ $t('profile.rate') }}</div>
            <div class="system-balance">{{ $t('profile.balance') }}<strong>{{ availableTokens.toLocaleString() }} Token</strong></div>
            <div class="system-group-hint" style="margin-top:8px;font-size:13px;color:var(--text-light);">
              {{ $t('profile.buyToken') }}
            </div>
          </div>

          <!-- Ollama -->
          <template v-if="modelConfig.provider === 'ollama'">
            <div class="form-group">
              <label>Ollama URL</label>
              <input v-model="modelConfig.ollamaBaseUrl" class="input" placeholder="http://localhost:11434" />
            </div>
            <div v-for="role in modelRoles" :key="role.key" class="form-group">
              <label>{{ role.icon }} {{ $t('profile.' + role.labelKey) }}</label>
              <input v-model="modelConfig['ollama' + role.fieldSuffix]" class="input" :placeholder="role.placeholder" />
            </div>
            <button class="btn btn-outline btn-sm" :disabled="ollamaLoading" @click="fetchOllamaModels">
              {{ ollamaLoading ? $t('common.loading') : $t('profile.refreshModels') }}
            </button>
            <div v-if="ollamaModels.length > 0" class="model-list">
              <div v-for="m in ollamaModels" :key="m.name" class="model-item" @click="setOllamaModel(m.name)">
                <span class="model-name">{{ m.name }}</span>
                <span v-if="m.details" class="model-size">({{ formatSize(m.size) }})</span>
              </div>
            </div>
            <div v-if="ollamaError" class="model-error">{{ ollamaError }}</div>
          </template>

          <!-- 云端自定义 -->
          <template v-if="modelConfig.provider === 'cloud'">
            <div class="form-group">
              <label>API URL</label>
              <input v-model="modelConfig.cloudBaseUrl" class="input" placeholder="https://api.siliconflow.cn/v1" />
            </div>
            <div class="form-group">
              <label>API Key</label>
              <input v-model="modelConfig.cloudApiKey" class="input" type="password" placeholder="sk-..." />
            </div>
            <div v-for="role in modelRoles" :key="role.key" class="form-group">
              <label>{{ role.icon }} {{ $t('profile.' + role.labelKey) }}</label>
              <input v-model="modelConfig['cloud' + role.fieldSuffix]" class="input" :placeholder="role.placeholder" />
            </div>
          </template>

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
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useNovelStore } from '../stores/novel'
import { useI18n } from '../composables/useI18n'

const router = useRouter()
const authStore = useAuthStore()
const novelStore = useNovelStore()
const { isZh, setLocale } = useI18n()
const newNickname = ref('')

// Token
const totalTokens = ref(0)
const usedTokens = ref(0)
const availableTokens = ref(0)
const tokenPercent = computed(() => {
  if (totalTokens.value === 0) return 100
  return Math.round(usedTokens.value / totalTokens.value * 100)
})
const showGroupInfo = ref(false)

// 模型角色
const modelRoles = [
  { key: 'outline',  icon: '📐', labelKey: 'modelOutline', fieldSuffix: 'OutlineModel',  placeholder: 'deepseek-ai/DeepSeek-V4-Flash' },
  { key: 'writing',  icon: '✍️', labelKey: 'modelWriting', fieldSuffix: 'WritingModel',  placeholder: 'deepseek-ai/DeepSeek-V4-Flash' },
  { key: 'polish',   icon: '✨', labelKey: 'modelPolish', fieldSuffix: 'PolishModel',   placeholder: 'deepseek-ai/DeepSeek-V4-Flash' },
  { key: 'reasoning',icon: '🧠', labelKey: 'modelReasoning', fieldSuffix: 'ReasoningModel',placeholder: 'deepseek-ai/DeepSeek-V4-Flash' },
]

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
})

async function loadTokenInfo() {
  try {
    const res = await authStore.getTokenInfo()
    totalTokens.value = res.total || 0
    usedTokens.value = res.used || 0
    availableTokens.value = res.available || 0
  } catch (e) { console.error('获取 Token 信息失败:', e) }
}

async function loadStats() {
  try { stats.value = await authStore.getUserStats() }
  catch (e) { console.error('获取统计失败:', e) }
}

async function loadModelConfig() {
  try {
    const res = await authStore.getModelConfig()
    if (res?.modelConfig) modelConfig.value = { ...modelConfig.value, ...res.modelConfig }
  } catch (e) { console.error('加载模型配置失败:', e) }
}

function onProviderChange() {
  configMsg.value = ''
  if (modelConfig.value.provider === 'ollama') fetchOllamaModels()
}

async function fetchOllamaModels() {
  ollamaLoading.value = true; ollamaError.value = ''; ollamaModels.value = []
  try { ollamaModels.value = await authStore.fetchOllamaModels() }
  catch (e) { ollamaError.value = e.response?.data?.message || e.message || '连接失败' }
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
    configMsg.value = '✅ ' + t('profile.saved')
    configMsgOk.value = true
  } catch (e) {
    configMsg.value = '❌ ' + (e.response?.data?.message || e.message)
    configMsgOk.value = false
  }
  savingConfig.value = false
}

import { getCurrentInstance } from 'vue'
const { t } = getCurrentInstance().appContext.config.globalProperties

function formatSize(bytes) {
  if (!bytes) return ''
  const gb = bytes/1024/1024/1024
  return gb >= 1 ? `${gb.toFixed(1)}GB` : `${(bytes/1024/1024).toFixed(0)}MB`
}

function goToLogin() { router.push('/login') }
function goToRegister() { router.push('/register') }
async function updateNickname() {
  if (!newNickname.value.trim()) return
  try { await authStore.updateNickname(newNickname.value.trim()); alert(t('profile.nickUpdated')) }
  catch (e) { alert(t('profile.nickFail') + (e.response?.data?.message || e.message)) }
}
function setOllamaModel(name) {
  modelConfig.value.ollamaOutlineModel = name
  modelConfig.value.ollamaWritingModel = name
  modelConfig.value.ollamaPolishModel = name
  modelConfig.value.ollamaReasoningModel = name
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
  background: linear-gradient(135deg, var(--primary-color), #ff6b6b);
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
  background: #e8f4f8; overflow: hidden;
  position: relative; box-shadow: 0 4px 16px rgba(0,150,200,0.2); cursor: default;
}
.water-wave { position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(180deg, #40a9ff, #1890ff); transition: height 0.6s ease; }
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
.group-info-card { margin-top: 12px; padding: 16px; border-radius: 10px; background: #fff5f0; border: 1px solid #ffe8d6; text-align: center; animation: fadeIn 0.3s ease; }
.group-info-text { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
.group-qq { font-size: 22px; font-weight: 700; color: var(--primary-color); }
.group-hint { font-size: 12px; color: var(--text-light); margin-top: 4px; }

/* 语言切换 */
.lang-switch-row { display: flex; gap: 10px; }
.toggle-btn { flex: 1; padding: 10px; border: 2px solid var(--border-color); border-radius: 10px; font-size: 14px; font-weight: 600; background: #f8f8f8; cursor: pointer; font-family: inherit; transition: all 0.2s; }
.toggle-btn.active { border-color: var(--primary-color); background: #fff5f0; }
.model-config-card { border: 1px solid #ffe0d0; }
.config-desc { font-size: 12px; color: var(--text-light); margin-bottom: 12px; }
.form-group { margin-bottom: 14px; }
.form-group label { display: block; font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-bottom: 6px; }
.select-input { appearance: auto; cursor: pointer; }
.system-info { background: #fff5f0; border-radius: 8px; padding: 14px; margin-bottom: 14px; border: 1px solid #ffe8d6; }
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
