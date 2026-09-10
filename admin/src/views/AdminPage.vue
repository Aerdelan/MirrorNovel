<template>
 <SidebarLayout>
  <section v-if="activeTab === 'dashboard'" class="grid">
   <div class="card"><strong>{{ dashboard.totalUsers }}</strong><span>注册用户</span></div>
   <div class="card"><strong>{{ dashboard.totalNovels }}</strong><span>小说总数</span></div>
   <div class="card"><strong>{{ dashboard.completedNovels }}</strong><span>已完成作品</span></div>
   <div class="card"><strong>{{ dashboard.generatingNovels }}</strong><span>生成中或暂停</span></div>
  </section>

  <section v-else-if="activeTab === 'users'">
   <div class="users-toolbar">
    <input v-model="keyword" class="input" placeholder="搜索邮箱或昵称" @input="searchUsers" />
    <span class="users-total">共 {{ usersTotal }} 个用户</span>
   </div>
   <div class="table-wrap"><table><thead><tr>
    <th>邮箱</th><th>昵称</th><th>角色</th><th>状态</th><th>Token 消耗（输入/输出）</th><th>作品数</th><th>操作</th>
   </tr></thead><tbody>
    <tr v-for="user in users" :key="user._id">
     <td>{{ user.email }}</td>
     <td>{{ user.nickname }}</td>
     <td>{{ roleLabel(user.role) }}</td>
     <td><span :class="user.disabled ? 'badge-disabled' : 'badge-ok'">{{ user.disabled ? '禁用' : '正常' }}</span></td>
     <td>
      <span v-if="user.tokenUsage && user.tokenUsage.calls" class="token-cell">
       {{ formatTokenCount(user.tokenUsage.inputTokens) }} / {{ formatTokenCount(user.tokenUsage.outputTokens) }}
       <span v-if="user.tokenUsage.cacheSavedTokens > 0" class="token-cache">（缓存 {{ formatTokenCount(user.tokenUsage.cacheSavedTokens) }}）</span>
      </span>
      <span v-else class="token-empty">—</span>
     </td>
     <td>{{ user.tokenUsage?.novelCount || 0 }}</td>
     <td>
      <button :disabled="updatingUserId === user._id || user.role === 'admin'" @click="toggleUser(user)">{{ updatingUserId === user._id ? '处理中...' : (user.disabled ? '启用' : '禁用') }}</button>
     </td>
    </tr>
    <tr v-if="!users.length && !usersLoading"><td colspan="7" class="empty">没有匹配的用户</td></tr>
   </tbody></table></div>
   <div v-if="usersTotal > usersPageSize" class="pager">
    <button :disabled="usersPage <= 1 || usersLoading" @click="goUsersPage(usersPage - 1)">上一页</button>
    <span>第 {{ usersPage }} / {{ usersTotalPages }} 页</span>
    <button :disabled="usersPage >= usersTotalPages || usersLoading" @click="goUsersPage(usersPage + 1)">下一页</button>
   </div>
   <p v-if="message" :class="{ error: errorMessage }">{{ message }}</p>
  </section>

  <section v-else-if="activeTab === 'models'">
   <div class="section-head"><h2>模型线路</h2><button :disabled="saving" @click="saveModels">{{ saving ? '保存中...' : '保存配置' }}</button></div>
   <div v-for="route in routes" :key="route.id" class="route-row">
    <h3>{{ route.alias }}</h3>
    <label>接口地址<input v-model.trim="route.baseUrl" :disabled="saving" class="input" /></label>
    <label>模型名称<input v-model.trim="route.model" :disabled="saving" class="input" /></label>
    <label>API Key<input v-model.trim="route.apiKey" :disabled="saving" class="input" :placeholder="route.apiKeyConfigured ? '已配置，留空则保持不变' : '请输入 API Key'" /></label>
   </div>
   <p v-if="message" :class="{ error: errorMessage }">{{ message }}</p>
  </section>

  <section v-else-if="activeTab === 'usage'" class="usage-section">
   <div class="section-head">
    <h2>Token 用量归因</h2>
    <div class="usage-actions">
     <label class="usage-limit">Top 作品数
      <select v-model.number="usageLimit" class="input" @change="loadUsage">
       <option :value="10">10</option>
       <option :value="20">20</option>
       <option :value="50">50</option>
      </select>
     </label>
     <button :disabled="usageLoading" @click="loadUsage">{{ usageLoading ? '加载中...' : '刷新' }}</button>
    </div>
   </div>

   <div class="grid usage-cards">
    <div class="card"><strong>{{ formatTokenCount(usage.totals.inputTokens) }}</strong><span>输入 Token</span></div>
    <div class="card"><strong>{{ formatTokenCount(usage.totals.outputTokens) }}</strong><span>输出 Token</span></div>
    <div class="card"><strong>{{ formatTokenCount(usage.totals.cacheSavedTokens) }}</strong><span>前缀缓存命中</span></div>
    <div class="card"><strong>{{ formatPercent(usage.totals.cacheHitRate) }}</strong><span>缓存命中率</span></div>
    <div class="card"><strong>{{ formatTokenCount(usage.totals.calls) }}</strong><span>累计调用次数</span></div>
    <div class="card"><strong>{{ usage.totals.novelCount }}</strong><span>计费作品数</span></div>
   </div>

   <h3 class="usage-subhead">按任务角色归因（输入占比决定优化方向）</h3>
   <div class="table-wrap"><table><thead><tr>
    <th>角色</th><th>输入 Token</th><th>输入占比</th><th>输出 Token</th><th>缓存命中</th><th>调用次数</th><th>说明</th>
   </tr></thead><tbody>
    <tr v-for="row in usage.byRole" :key="row.role">
     <td><strong>{{ row.label }}</strong></td>
     <td>{{ formatTokenCount(row.inputTokens) }}</td>
     <td>
      <div class="share-cell">
       <div class="share-bar"><span :style="{ width: formatPercent(row.inputShare) }"></span></div>
       <span class="share-text">{{ formatPercent(row.inputShare) }}</span>
      </div>
     </td>
     <td>{{ formatTokenCount(row.outputTokens) }}</td>
     <td>{{ formatTokenCount(row.cacheSavedTokens) }}</td>
     <td>{{ row.calls }}</td>
     <td class="usage-note">{{ roleNote(row.role) }}</td>
    </tr>
    <tr v-if="!usage.byRole.length && !usageLoading"><td colspan="7" class="empty">暂无用量数据（尚无作品产生计费调用）</td></tr>
   </tbody></table></div>

   <h3 class="usage-subhead">单本作品消耗 Top {{ usageLimit }}（每千字输入越低越省）</h3>
   <div class="table-wrap"><table><thead><tr>
    <th>作品</th><th>类型</th><th>状态</th><th>字数</th><th>输入 Token</th><th>输出 Token</th><th>缓存命中</th><th>每千字输入</th>
   </tr></thead><tbody>
    <tr v-for="novel in usage.topNovels" :key="novel.id">
     <td class="usage-title">{{ novel.title }}</td>
     <td>{{ novel.novelTypeName || '—' }}</td>
     <td>{{ novel.status || '—' }}</td>
     <td>{{ novel.currentWordCount }}</td>
     <td>{{ formatTokenCount(novel.inputTokens) }}</td>
     <td>{{ formatTokenCount(novel.outputTokens) }}</td>
     <td>{{ formatTokenCount(novel.cacheSavedTokens) }}</td>
     <td>{{ novel.inputPerThousandWords }}</td>
    </tr>
    <tr v-if="!usage.topNovels.length && !usageLoading"><td colspan="8" class="empty">暂无作品用量数据</td></tr>
   </tbody></table></div>
   <p v-if="message" :class="{ error: errorMessage }">{{ message }}</p>
  </section>

  <section v-else class="empty">该管理功能已精简。</section>
 </SidebarLayout>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import SidebarLayout from '../components/SidebarLayout.vue'
import api from '../api'

const route = useRoute()
const activeTab = computed(() => route.path.slice(1) || 'dashboard')
const dashboard = ref({ totalUsers: 0, totalNovels: 0, completedNovels: 0, generatingNovels: 0 })
const users = ref([])
const keyword = ref('')
const routes = ref([])
const saving = ref(false)
const updatingUserId = ref('')
const message = ref('')
const errorMessage = ref(false)

async function loadDashboard() { dashboard.value = (await api.get('/admin/dashboard')).data }

const usersTotal = ref(0)
const usersPage = ref(1)
const usersPageSize = 50
const usersLoading = ref(false)
const usersTotalPages = computed(() => Math.max(1, Math.ceil(usersTotal.value / usersPageSize)))

async function loadUsers() {
 usersLoading.value = true
 try {
  const response = await api.get('/admin/users', { params: { keyword: keyword.value || undefined, page: usersPage.value, pageSize: usersPageSize } })
  users.value = response.data.users || []
  usersTotal.value = Number(response.data.total) || users.value.length
 } finally { usersLoading.value = false }
}
let searchTimer = null
function searchUsers() {
 clearTimeout(searchTimer)
 searchTimer = setTimeout(() => { usersPage.value = 1; loadUsers() }, 300)
}
function goUsersPage(page) {
 usersPage.value = Math.min(Math.max(1, page), usersTotalPages.value)
 loadUsers()
}
function roleLabel(role) { return role === 'admin' ? '管理员' : role === 'importer' ? '导入员' : '用户' }
function formatTokenCount(value) {
 const number = Number(value) || 0
 if (number >= 1000000) return `${(number / 1000000).toFixed(2)}M`
 if (number >= 10000) return `${(number / 10000).toFixed(1)}万`
 if (number >= 1000) return `${(number / 1000).toFixed(1)}k`
 return String(number)
}
async function toggleUser(user) {
 if (updatingUserId.value) return
 if (user.role === 'admin') return
 if (!user.disabled && !window.confirm(`确定禁用 ${user.email}？禁用后该用户将无法登录和调用任何需要鉴权的接口。`)) return
 updatingUserId.value = user._id
 message.value = ''
 try {
  await api.put(`/admin/users/${user._id}`, { disabled: !user.disabled })
  await loadUsers()
  message.value = user.disabled ? `已启用 ${user.email}` : `已禁用 ${user.email}（其现有登录态将立即失效）`
  errorMessage.value = false
 } catch (error) {
  message.value = error.response?.data?.message || error.message
  errorMessage.value = true
 } finally { updatingUserId.value = '' }
}
async function loadModels() { routes.value = (await api.get('/admin/models')).data.routes || [] }

// ====== 用量分析：角色归因 + 单本作品排行 ======
const usageLimit = ref(10)
const usageLoading = ref(false)
const emptyUsagePayload = () => ({
 totals: { inputTokens: 0, outputTokens: 0, cacheSavedTokens: 0, calls: 0, cacheHitRate: 0, novelCount: 0 },
 byRole: [],
 topNovels: [],
})
const usage = ref(emptyUsagePayload())

function formatPercent(value) {
 const number = Number(value) || 0
 return `${(number * 100).toFixed(1)}%`
}

// 角色说明：告诉运维"这个环节为什么会花这么多"，而不只是一个数字。
function roleNote(role) {
 if (role === 'writing') return '每章必调，输入以分层大纲 + 剧情脉络为主，是总量最大项'
 if (role === 'reasoning') return '审稿/伏笔自评/蓝图提案；已加本地门控减少无效调用'
 if (role === 'polish') return '仅审稿评分偏低或主动去 AI 味时触发'
 if (role === 'outline') return '每本书一次，输出预算已封顶'
 return '历史数据或未归类角色'
}

async function loadUsage() {
 usageLoading.value = true
 message.value = ''
 try {
  const response = await api.get('/admin/token-usage', { params: { limit: usageLimit.value } })
  usage.value = {
   totals: { ...emptyUsagePayload().totals, ...(response.data.totals || {}) },
   byRole: response.data.byRole || [],
   topNovels: response.data.topNovels || [],
  }
  errorMessage.value = false
 } catch (error) {
  message.value = error.response?.data?.message || error.message
  errorMessage.value = true
 } finally { usageLoading.value = false }
}
async function saveModels() {
 saving.value = true; message.value = ''
 try { const response = await api.put('/admin/models', { routes: routes.value }); routes.value = response.data.routes || routes.value; message.value = response.data.message; errorMessage.value = false }
 catch (error) { message.value = error.response?.data?.message || error.message; errorMessage.value = true }
 finally { saving.value = false }
}
async function loadCurrent() {
 if (activeTab.value === 'dashboard') await loadDashboard()
 if (activeTab.value === 'users') await loadUsers()
 if (activeTab.value === 'models') await loadModels()
 if (activeTab.value === 'usage') await loadUsage()
}
watch(activeTab, loadCurrent)
onMounted(loadCurrent)
</script>

<style scoped>
.grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
.card,.route-row { background:#fff; border:1px solid #dce3df; padding:18px; border-radius:6px; }
.card strong { display:block; font-size:28px; }.card span { color:#66736c; font-size:13px; }
.table-wrap { overflow:auto; margin-top:14px; background:#fff; border:1px solid #dce3df; }.table-wrap table { width:100%; border-collapse:collapse; }.table-wrap th,.table-wrap td { padding:10px; border-bottom:1px solid #edf0ee; text-align:left; }
.section-head { display:flex; justify-content:space-between; align-items:center; }.route-row { margin-top:12px; }.route-row h3 { margin:0 0 12px; }.route-row label { display:block; margin-top:10px; font-size:13px; }.input { display:block; width:100%; box-sizing:border-box; margin-top:5px; padding:8px; border:1px solid #bcc9c1; border-radius:4px; } button { padding:8px 12px; border:1px solid #63836f; border-radius:4px; background:#fff; cursor:pointer; } button:disabled, .input:disabled { opacity:0.55; cursor:not-allowed; }.error { color:#b42318; }.empty { color:#66736c; }
@media (max-width:760px) { .grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
.users-toolbar { display:flex; align-items:center; gap:12px; }.users-toolbar .input { width:280px; margin-top:0; }.users-total { color:#66736c; font-size:13px; }
.badge-ok { color:#1a7f37; }.badge-disabled { color:#b42318; font-weight:600; }
.token-cell { font-variant-numeric:tabular-nums; }.token-cache { color:#1a7f37; font-size:12px; }.token-empty { color:#b6beb9; }
.usage-actions { display:flex; align-items:center; gap:10px; }
.usage-limit { display:flex; align-items:center; gap:6px; color:#66736c; font-size:13px; }
.usage-limit .input { width:auto; margin-top:0; padding:6px 8px; }
.usage-cards { margin-top:14px; grid-template-columns:repeat(6,minmax(0,1fr)); }
.usage-subhead { margin:22px 0 0; font-size:15px; color:#243b2e; }
.share-cell { display:flex; align-items:center; gap:8px; min-width:120px; }
.share-bar { flex:1; height:8px; border-radius:999px; background:#edf0ee; overflow:hidden; }
.share-bar span { display:block; height:100%; background:#3f7f5c; }
.share-text { min-width:44px; color:#66736c; font-size:12px; font-variant-numeric:tabular-nums; }
.usage-note { color:#66736c; font-size:12px; max-width:320px; }
.usage-title { max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
@media (max-width:1100px) { .usage-cards { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media (max-width:760px) { .usage-cards { grid-template-columns:repeat(2,minmax(0,1fr)); } .usage-actions { flex-wrap:wrap; } }
.pager { display:flex; align-items:center; gap:10px; margin-top:12px; color:#66736c; font-size:13px; }
</style>
