<template>
 <SidebarLayout>
  <section v-if="activeTab === 'dashboard'" class="grid">
   <div class="card"><strong>{{ dashboard.totalUsers }}</strong><span>注册用户</span></div>
   <div class="card"><strong>{{ dashboard.totalNovels }}</strong><span>小说总数</span></div>
   <div class="card"><strong>{{ dashboard.completedNovels }}</strong><span>已完成作品</span></div>
   <div class="card"><strong>{{ dashboard.generatingNovels }}</strong><span>生成中或暂停</span></div>
  </section>

  <section v-else-if="activeTab === 'users'">
   <input v-model="keyword" class="input" placeholder="搜索邮箱或昵称" @input="loadUsers" />
   <div class="table-wrap"><table><thead><tr><th>邮箱</th><th>昵称</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>
    <tr v-for="user in users" :key="user._id"><td>{{ user.email }}</td><td>{{ user.nickname }}</td><td>{{ user.role }}</td><td>{{ user.disabled ? '禁用' : '正常' }}</td><td><button @click="toggleUser(user)">{{ user.disabled ? '启用' : '禁用' }}</button></td></tr>
   </tbody></table></div>
  </section>

  <section v-else-if="activeTab === 'models'">
   <div class="section-head"><h2>模型线路</h2><button :disabled="saving" @click="saveModels">{{ saving ? '保存中...' : '保存配置' }}</button></div>
   <div v-for="route in routes" :key="route.id" class="route-row">
    <h3>{{ route.alias }}</h3>
    <label>接口地址<input v-model.trim="route.baseUrl" class="input" /></label>
    <label>模型名称<input v-model.trim="route.model" class="input" /></label>
    <label>API Key<input v-model.trim="route.apiKey" class="input" :placeholder="route.apiKeyConfigured ? '已配置，留空则保持不变' : '请输入 API Key'" /></label>
   </div>
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
const message = ref('')
const errorMessage = ref(false)

async function loadDashboard() { dashboard.value = (await api.get('/admin/dashboard')).data }
async function loadUsers() { users.value = (await api.get('/admin/users', { params: { keyword: keyword.value } })).data.users || [] }
async function loadModels() { routes.value = (await api.get('/admin/models')).data.routes || [] }
async function toggleUser(user) { await api.put(`/admin/users/${user._id}`, { disabled: !user.disabled }); await loadUsers() }
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
}
watch(activeTab, loadCurrent)
onMounted(loadCurrent)
</script>

<style scoped>
.grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
.card,.route-row { background:#fff; border:1px solid #dce3df; padding:18px; border-radius:6px; }
.card strong { display:block; font-size:28px; }.card span { color:#66736c; font-size:13px; }
.table-wrap { overflow:auto; margin-top:14px; background:#fff; border:1px solid #dce3df; }.table-wrap table { width:100%; border-collapse:collapse; }.table-wrap th,.table-wrap td { padding:10px; border-bottom:1px solid #edf0ee; text-align:left; }
.section-head { display:flex; justify-content:space-between; align-items:center; }.route-row { margin-top:12px; }.route-row h3 { margin:0 0 12px; }.route-row label { display:block; margin-top:10px; font-size:13px; }.input { display:block; width:100%; box-sizing:border-box; margin-top:5px; padding:8px; border:1px solid #bcc9c1; border-radius:4px; } button { padding:8px 12px; border:1px solid #63836f; border-radius:4px; background:#fff; cursor:pointer; }.error { color:#b42318; }.empty { color:#66736c; }
@media (max-width:760px) { .grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>
