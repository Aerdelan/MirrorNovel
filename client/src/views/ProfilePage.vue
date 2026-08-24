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

 <!-- 邀请 -->
 <div class="card invite-card">
 <div class="section-title"> 邀请好友</div>
 <div class="invite-stats">
 <div class="invite-stat"><span class="stat-num">{{ inviteInfo.inviteCount }}</span><span>已邀请</span></div>
 </div>
 <div class="invite-code-row">
 <span class="invite-label">邀请码</span>
 <span class="invite-code" @click="copyInviteCode">{{ inviteInfo.inviteCode }}</span>
 <button class="btn btn-sm btn-outline" @click="copyInviteLink">复制链接</button>
 </div>
 <div class="invite-qr" v-if="inviteInfo.inviteLink">
 <img :src="'https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=' + encodeURIComponent(inviteInfo.inviteLink)" alt="QR" />
 </div>
 <div class="invite-hint">邀请好友一起使用 MirrorNovel</div>
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

 <details class="role-routes-details">
 <summary>{{ $t('profile.roleRoutesTitle') }}</summary>
 <div class="config-desc role-routes-desc">{{ $t('profile.roleRoutesDesc') }}</div>
 <div v-for="role in modelRoles" :key="role.key" class="form-group role-route-row">
 <label :for="`role-route-${role.key}`">{{ $t(`profile.${role.labelKey}`) }}</label>
 <select :id="`role-route-${role.key}`" v-model="modelConfig.roleRoutes[role.key]" class="input select-input">
 <option value="">{{ $t('profile.lineFollowDefault') }}</option>
 <option v-for="route in publicRoutes" :key="route.id" :value="route.id">
 {{ routeLabel(route.id) }}
 </option>
 </select>
 </div>
 </details>

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

// 邀请
const inviteInfo = ref({ inviteCode: '', inviteCount: 0, inviteRewards: 0, inviteLink: '' })

const routeDefinitions = [
 { id: 'normal_1', labelKey: 'lineStandardOne' },
 { id: 'normal_2', labelKey: 'lineStandardTwo' },
 { id: 'advanced_1', labelKey: 'lineAdvancedOne' },
 { id: 'vip', labelKey: 'lineVip' },
 { id: 'svip', labelKey: 'lineSvip' },
]
const publicRoutes = ref([...routeDefinitions])
const modelRoles = [
 { key: 'outline', labelKey: 'modelOutline' },
 { key: 'writing', labelKey: 'modelWriting' },
 { key: 'reasoning', labelKey: 'modelReasoning' },
 { key: 'polish', labelKey: 'modelPolish' },
]
const modelConfig = ref({ routeId: 'normal_1', routeAlias: '', roleRoutes: {} })
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
 loadStats()
 loadModelConfig()
 loadInviteInfo()
})

// 从 keep-alive 缓存重新激活时刷新数据
onActivated(() => {
 if (!authStore.isLoggedIn) return
 newNickname.value = ''
 configMsg.value = ''
 loadStats()
 loadInviteInfo()
})

async function loadInviteInfo() {
 try {
 inviteInfo.value = await authStore.getInviteInfo()
 } catch {}
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
 const roleRoutes = {}
 modelRoles.forEach(({ key }) => {
  const value = config.roleRoutes?.[key]
  roleRoutes[key] = publicRoutes.value.some(route => route.id === value) ? value : ''
 })
 modelConfig.value = { routeId: routeId || 'normal_1', routeAlias: routeLabel(routeId), roleRoutes }
 } catch (e) { console.error('加载线路配置失败:', e) }
}

async function saveConfig() {
 savingConfig.value = true; configMsg.value = ''
 try {
 const response = await authStore.saveModelConfig({
  routeId: modelConfig.value.routeId,
  roleRoutes: { ...modelConfig.value.roleRoutes },
 })
 const savedConfig = response?.modelConfig || response || {}
 if (savedConfig.routeId) modelConfig.value.routeId = savedConfig.routeId
 modelRoles.forEach(({ key }) => {
  modelConfig.value.roleRoutes[key] = publicRoutes.value.some(route => route.id === savedConfig.roleRoutes?.[key])
   ? savedConfig.roleRoutes[key] : ''
 })
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

/* 语言切换 */
.lang-switch-row { display: flex; gap: 10px; }
.toggle-btn { flex: 1; padding: 10px; border: 2px solid var(--border-color); border-radius: 10px; font-size: 14px; font-weight: 600; background: #f8f8f8; cursor: pointer; font-family: inherit; transition: all 0.2s; }
.toggle-btn.active { border-color: var(--primary-color); background: var(--primary-light); }
.model-config-card { border: 1px solid var(--warning-border); }
.route-selector { margin-top: 14px; }
.role-routes-details { margin-top: 14px; border-top: 1px solid var(--border-color); padding-top: 12px; }
.role-routes-details summary { cursor: pointer; color: var(--primary-hover); font-size: 13px; font-weight: 600; }
.role-routes-desc { margin-top: 10px; margin-bottom: 12px; }
.role-route-row { margin-bottom: 12px; }
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
