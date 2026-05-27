<template>
  <SidebarLayout>
    <!-- ====== 数据大屏 ====== -->
    <div v-if="activeTab === 'dashboard'">
      <div class="grid-4">
        <div class="card"><div class="num">{{ dash.totalUsers }}</div><div class="lbl">注册用户</div></div>
        <div class="card"><div class="num">{{ dash.totalNovels }}</div><div class="lbl">总小说</div></div>
        <div class="card"><div class="num">{{ (dash.totalTokens/10000).toFixed(1) }}万</div><div class="lbl">充值Token</div></div>
        <div class="card"><div class="num">{{ (dash.usedTokens/10000).toFixed(1) }}万</div><div class="lbl">消耗Token</div></div>
      </div>
      <div class="grid-4" style="margin-top:10px;">
        <div class="card accent"><div class="num">{{ dash.completedNovels }}</div><div class="lbl">生成完成</div></div>
        <div class="card accent"><div class="num">{{ dash.generatingNovels }}</div><div class="lbl">生成中/暂停</div></div>
        <div class="card accent"><div class="num">{{ dash.recentRegistrations }}</div><div class="lbl">近7日注册</div></div>
        <div class="card accent"><div class="num">{{ revenue }}元</div><div class="lbl">估算收入</div></div>
      </div>
      <div class="update-time">更新于 {{ now }}</div>
    </div>

    <!-- ====== 用户管理 ====== -->
    <div v-if="activeTab === 'users'">
      <div class="search-bar">
        <input v-model="userQ" class="input" placeholder="搜索邮箱/昵称" @input="debounce(loadUsers,300)" />
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>邮箱</th><th>昵称</th><th>角色</th><th>邀请人</th><th>Token(剩余/总额)</th><th>进群</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="u in users" :key="u._id">
              <td>{{ u.email }}</td>
              <td>{{ u.nickname }}</td>
              <td><span class="badge" :class="u.role">{{ u.role==='admin'?'管理员':'用户' }}</span></td>
              <td>{{ u.invitedBy?.email || '-' }}</td>
              <td>{{ (u.tokens?.total||0)-(u.tokens?.used||0) }}/{{ u.tokens?.total||0 }}</td>
              <td>
                <button v-if="!u.groupRewardClaimed" class="btn-sm btn-gift" :disabled="rewarding===u._id" @click="grantReward(u)">{{ rewarding===u._id?'...':'🎁 进群赠送' }}</button>
                <span v-else class="claimed-badge">已领取</span>
              </td>
              <td><span class="dot" :class="{ off: u.disabled }"></span>{{ u.disabled ? '禁用' : '正常' }}</td>
              <td class="acts">
                <button class="btn-sm" @click="openEdit(u)">编辑</button>
                <button class="btn-sm" :class="u.disabled?'green':'red'" @click="toggleDisable(u)">{{ u.disabled?'启用':'禁用' }}</button>
                <button class="btn-sm" style="color:#722ed1;border-color:#722ed1;" @click="showInvitedUsers(u)">已邀请</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- 编辑弹窗 -->
      <Teleport to="body">
        <div v-if="showModal" class="overlay" @click.self="showModal=false">
          <div class="modal">
            <h3>编辑用户</h3>
            <div class="row"><label>邮箱</label><span>{{ editUserData.email }}</span></div>
            <div class="row"><label>昵称</label><input v-model="editForm.nickname" class="input" /></div>
            <div class="row"><label>角色</label>
              <select v-model="editForm.role" class="input"><option value="user">用户</option><option value="admin">管理员</option><option value="importer">导入员</option></select>
            </div>
            <div class="row"><label>追加Token</label><input v-model.number="editForm.addTokens" class="input" type="number" min="0" placeholder="0" /></div>
            <div class="modal-acts">
              <button class="btn btn-outline" @click="showModal=false">取消</button>
              <button class="btn btn-primary" @click="saveUser">保存</button>
            </div>
          </div>
        </div>
      </Teleport>
      <!-- 已邀请用户弹窗 -->
      <Teleport to="body">
        <div v-if="inviteModal" class="overlay" @click.self="inviteModal=false">
          <div class="modal" style="max-width:500px;">
            <h3>👥 {{ inviteModalUser?.email }} 的邀请记录</h3>
            <div v-if="invitedUsers.length === 0" style="text-align:center;padding:20px;color:#999;">暂无邀请记录</div>
            <table v-else style="width:100%;font-size:13px;">
              <thead><tr><th>邮箱</th><th>昵称</th><th>注册时间</th></tr></thead>
              <tbody>
                <tr v-for="iu in invitedUsers" :key="iu._id">
                  <td>{{ iu.email }}</td>
                  <td>{{ iu.nickname }}</td>
                  <td>{{ fmt(iu.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
            <div class="modal-acts">
              <button class="btn btn-outline" @click="inviteModal=false">关闭</button>
            </div>
          </div>
        </div>
      </Teleport>
    </div>

    <!-- ====== 小说管理 ====== -->
    <div v-if="activeTab === 'novels'">
      <div class="search-bar" style="flex-wrap:wrap;">
        <select v-model="nFilterUser" class="input" style="max-width:180px;" @change="loadNovels">
          <option value="">全部用户</option>
          <option v-for="u in allU" :key="u._id" :value="u._id">{{ u.email }}</option>
        </select>
        <select v-model="nFilterStatus" class="input" style="max-width:120px;" @change="loadNovels">
          <option value="">全部状态</option>
          <option value="generating">生成中</option><option value="paused">已暂停</option><option value="completed">已完成</option>
        </select>
        <input v-model="nQ" class="input" placeholder="搜索标题" @input="debounce(loadNovels,300)" />
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>标题</th><th>作者</th><th>类型</th><th>字数</th><th>状态</th><th>更新</th></tr></thead>
          <tbody>
            <tr v-for="n in novels" :key="n._id">
              <td>{{ n.title }}</td>
              <td>{{ n.userId?.email||'未知' }}</td>
              <td>{{ n.novelTypeName }}</td>
              <td>{{ n.currentWordCount }}/{{ n.targetWordCount }}</td>
              <td><span class="sb" :class="n.status">{{ statusMap[n.status] }}</span></td>
              <td>{{ fmt(n.updatedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ====== 蒸馏管理 ====== -->
    <div v-if="activeTab === 'distill'">
      <div class="search-bar" style="flex-wrap:wrap;">
        <select v-model="dFilterUser" class="input" style="max-width:180px;" @change="loadDistillations">
          <option value="">全部导入员</option>
          <option v-for="u in allU" :key="u._id" :value="u._id">{{ u.email }}</option>
        </select>
        <input v-model="dQ" class="input" placeholder="搜索小说名" @input="debounce(loadDistillations,300)" />
        <button class="btn-sm" :disabled="dSelected.length===0" @click="batchExportDistill" style="background:#e94560;color:white;border:none;">📦 批量导出</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:30px;"><input type="checkbox" :checked="dAllSelected" @change="dToggleAll" /></th>
              <th>小说名</th>
              <th>分类</th>
              <th>导入员</th>
              <th title="原始素材字数（成功下载的文本总字符数）">字数</th>
              <th>质量分</th>
              <th>AI</th>
              <th>时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in distillations" :key="d._id">
              <td><input type="checkbox" :checked="dSelected.includes(d._id)" @change="dToggle(d._id)" /></td>
              <td>{{ d.title }}</td>
              <td>{{ d.mainCategory }}{{ d.subCategory ? '/'+d.subCategory : '' }}</td>
              <td>{{ d.userId?.email || '未知' }}</td>
              <td>
                <div class="wc-cell">
                  <span class="wc-num">{{ (d.originalLength||0).toLocaleString() }}</span>
                  <span v-if="d.downloadStats?.totalChapters" class="wc-detail" :class="wcRateClass(d.downloadStats)">
                    ({{ d.downloadStats.downloadedChapters }}/{{ d.downloadStats.totalChapters }}章)
                  </span>
                </div>
              </td>
              <td><span class="score" :class="scoreClass(d.qualityScore)">{{ d.qualityScore || '-' }}</span></td>
              <td><span class="dot" :class="{ off: !d.aiProcessed }"></span>{{ d.aiProcessed ? '已分析' : '未分析' }}</td>
              <td>{{ fmt(d.createdAt) }}</td>
              <td class="acts">
                <button class="btn-sm" @click="viewDistillJson(d)">JSON</button>
                <button class="btn-sm" @click="editDistill(d)">编辑</button>
                <button class="btn-sm red" @click="deleteDistill(d)">删除</button>
                <button class="btn-sm" style="color:#52c41a;" @click="exportDistill(d)">导出</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 蒸馏JSON预览/编辑弹窗 -->
      <Teleport to="body">
        <div v-if="dJsonShow" class="overlay" @click.self="dJsonShow=false">
          <div class="modal d-json-modal">
            <h3>{{ dJsonMode==='view'?'JSON 预览':'编辑' }} - {{ dJsonData?.title }}</h3>
            <textarea v-if="dJsonMode==='edit'" v-model="dEditContent" class="textarea" rows="15"></textarea>
            <pre v-else class="json-view">{{ JSON.stringify(dJsonData, null, 2) }}</pre>
            <div class="modal-acts">
              <button class="btn btn-outline" @click="dJsonShow=false">关闭</button>
              <button v-if="dJsonMode==='view'" class="btn btn-primary" @click="dJsonMode='edit'">编辑</button>
              <button v-if="dJsonMode==='edit'" class="btn btn-primary" @click="saveDistillJson">保存</button>
            </div>
          </div>
        </div>
      </Teleport>
    </div>

    <!-- ====== 模型配置 ====== -->
    <div v-if="activeTab === 'models'">
      <div class="form-card">
        <div class="row"><label>API 地址</label><input v-model="mApi" class="input" placeholder="https://api.siliconflow.cn/v1" /></div>
        <div class="row"><label>模型名</label><input v-model="mModel" class="input" placeholder="deepseek-ai/DeepSeek-V4-Flash" /></div>
        <div class="row"><label>API Key</label><input v-model="mKey" class="input" type="password" placeholder="sk-..." /></div>
        <button class="btn btn-primary" :disabled="mSaving" @click="saveModels">{{ mSaving ? '保存中...' : '💾 保存配置' }}</button>
        <div v-if="mMsg" class="msg" :class="{ ok: mOk }">{{ mMsg }}</div>
      </div>
      <div class="form-card" style="margin-top:12px;">
        <button class="btn red-btn" @click="restartServer">🔄 重启服务</button>
        <div style="font-size:12px;color:#999;margin-top:6px;">重启 Node.js 服务（PM2 会自动恢复）</div>
      </div>
    </div>
  </SidebarLayout>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import SidebarLayout from '../components/SidebarLayout.vue'

const route = useRoute()
const router = useRouter()
const activeTab = ref('dashboard')
const now = ref(new Date().toLocaleString('zh-CN'))

// 监听路由变化切换Tab
watch(() => route.path, (p) => {
  const tabMap = { '/dashboard':'dashboard', '/users':'users', '/novels':'novels', '/distill':'distill', '/models':'models' }
  activeTab.value = tabMap[p] || 'dashboard'
}, { immediate: true })

// ====== 仪表盘 ======
const dash = ref({})
const revenue = computed(() => ((dash.value.totalTokens || 0) * 15 / 1000000).toFixed(2))
async function loadDash() {
  try { const r = await api.get('/admin/dashboard'); dash.value = r.data }
  catch { dash.value = { totalUsers:0, totalNovels:0, totalTokens:0, usedTokens:0, completedNovels:0, generatingNovels:0, recentRegistrations:0 } }
}
const timeInt = setInterval(() => { now.value = new Date().toLocaleString('zh-CN') }, 1000)
onUnmounted(() => clearInterval(timeInt))

// ====== 用户管理 ======
const users = ref([]); const userQ = ref(''); const showModal = ref(false); const editUserData = ref({}); const editForm = ref({}); const rewarding = ref('')
async function loadUsers() {
  try { const r = await api.get('/admin/users', { params: { q: userQ.value } }); users.value = r.data.users || r.data }
  catch {}
}
let debounceTimer; function debounce(fn, ms) { clearTimeout(debounceTimer); debounceTimer = setTimeout(fn, ms) }
function openEdit(u) { editUserData.value = u; editForm.value = { nickname: u.nickname, role: u.role, addTokens: 0 }; showModal.value = true }

// 已邀请用户
const inviteModal = ref(false); const inviteModalUser = ref({}); const invitedUsers = ref([])
async function showInvitedUsers(u) {
  inviteModalUser.value = u; invitedUsers.value = []
  inviteModal.value = true
  try { const r = await api.get(`/admin/users/${u._id}/invited-users`); invitedUsers.value = r.data }
  catch { alert('获取失败') }
}
async function saveUser() {
  try { await api.put(`/admin/users/${editUserData.value._id}`, editForm.value); showModal.value = false; loadUsers() }
  catch (e) { alert('保存失败:' + (e.response?.data?.message || e.message)) }
}
async function toggleDisable(u) {
  try { await api.put(`/admin/users/${u._id}`, { disabled: !u.disabled }); loadUsers() }
  catch (e) { alert('操作失败:' + (e.response?.data?.message || e.message)) }
}
async function grantReward(u) { rewarding.value = u._id; try { await api.post(`/admin/users/${u._id}/group-reward`); loadUsers() } catch {}; rewarding.value = '' }

// ====== 小说管理 ======
const novels = ref([]); const nQ = ref(''); const nFilterUser = ref(''); const nFilterStatus = ref(''); const allU = ref([])
const statusMap = { generating:'生成中', paused:'已暂停', completed:'已完成', error:'出错了' }
async function loadNovels() {
  try { const r = await api.get('/admin/novels', { params: { q: nQ.value, userId: nFilterUser.value, status: nFilterStatus.value } }); novels.value = r.data.novels || r.data }
  catch {}
}
async function loadUsersSimple() {
  try { const r = await api.get('/admin/users/simple'); allU.value = r.data }
  catch {}
}

// ====== 蒸馏管理 ======
const distillations = ref([]); const dQ = ref(''); const dFilterUser = ref(''); const dSelected = ref([])
const dAllSelected = computed(() => distillations.value.length > 0 && dSelected.value.length === distillations.value.length)
const dJsonShow = ref(false); const dJsonData = ref({}); const dJsonMode = ref('view'); const dEditContent = ref('')
function dToggleAll() { dSelected.value = dAllSelected.value ? [] : distillations.value.map(d => d._id) }
function dToggle(id) { const i = dSelected.value.indexOf(id); i > -1 ? dSelected.value.splice(i,1) : dSelected.value.push(id) }
async function loadDistillations() {
  try { const r = await api.get('/admin/distillations', { params: { q: dQ.value, userId: dFilterUser.value } }); distillations.value = r.data.distillations || r.data }
  catch {}
}
function viewDistillJson(d) { dJsonData.value = d; dJsonMode.value = 'view'; dJsonShow.value = true }
async function editDistill(d) { dJsonData.value = d; dEditContent.value = JSON.stringify(d, null, 2); dJsonMode.value = 'edit'; dJsonShow.value = true }
async function saveDistillJson() { try { await api.put(`/admin/distillations/${dJsonData.value._id}`, { data: JSON.parse(dEditContent.value) }); dJsonShow.value = false; loadDistillations() } catch (e) { alert('保存失败:' + e.message) } }
async function deleteDistill(d) { if (!confirm(`删除《${d.title}》？`)) return; await api.delete(`/admin/distillations/${d._id}`); loadDistillations() }
async function exportDistill(d) { window.open(`/api/admin/distillations/${d._id}/export?token=${encodeURIComponent(localStorage.getItem('admin_token')||'')}`, '_blank') }
async function batchExportDistill() { if (dSelected.value.length === 0) return; const ids = dSelected.value; const token = localStorage.getItem('admin_token'); window.open(`/api/admin/distillations/export-batch?token=${encodeURIComponent(token||'')}&ids=${ids.join(',')}`, '_blank') }

// ====== 模型管理 ======
const mApi = ref(''); const mModel = ref(''); const mKey = ref(''); const mSaving = ref(false); const mMsg = ref(''); const mOk = ref(false)
async function loadModels() {
  try { const r = await api.get('/admin/models'); const c = r.data; mApi.value = c.baseUrl || ''; mModel.value = c.model || ''; mKey.value = c.apiKey || '' }
  catch {}
}
async function saveModels() {
  mSaving.value = true; mMsg.value = '';
  try { await api.put('/admin/models', { baseUrl: mApi.value, model: mModel.value, apiKey: mKey.value }); mMsg.value = '✅ 配置已保存'; mOk.value = true }
  catch (e) { mMsg.value = '❌ ' + (e.response?.data?.message || e.message); mOk.value = false }
  mSaving.value = false
}
function restartServer() { if (confirm('确定重启服务？')) { api.post('/admin/restart').then(() => alert('重启命令已发送')).catch(() => alert('重启失败')) } }

function fmt(d) { if (!d) return ''; const date = new Date(d); return `${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}` }
function scoreClass(s) { if (!s) return ''; if (s >= 80) return 'high'; if (s >= 60) return 'mid'; return 'low' }
function wcRateClass(s) { if (!s?.totalChapters) return ''; const rate = s.downloadedChapters / s.totalChapters; if (rate >= 0.9) return 'rate-high'; if (rate >= 0.5) return 'rate-mid'; return 'rate-low' }

onMounted(() => {
  loadDash(); loadUsers(); loadNovels(); loadDistillations(); loadModels(); loadUsersSimple()
})
</script>

<style scoped>
.grid-4 { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; }
.card { background: #fff; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.card .num { font-size: 28px; font-weight: 700; color: #333; }
.card .lbl { font-size: 12px; color: #999; margin-top: 4px; }
.card.accent { background: linear-gradient(135deg, #667eea, #764ba2); }
.card.accent .num, .card.accent .lbl { color: #fff; }
.update-time { text-align: center; font-size: 12px; color: #999; margin-top: 8px; }

.search-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.search-bar .input { padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px; outline: none; }
.search-bar .input:focus { border-color: #1890ff; }

.table-wrap { overflow-x: auto; background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { background: #fafafa; padding: 12px; text-align: left; font-weight: 600; color: #666; border-bottom: 1px solid #f0f0f0; white-space: nowrap; }
td { padding: 10px 12px; border-bottom: 1px solid #f5f5f5; color: #333; }
tr:hover td { background: #fafafa; }
.acts { display: flex; gap: 4px; flex-wrap: wrap; }
.btn-sm { padding: 4px 10px; border-radius: 4px; font-size: 12px; cursor: pointer; border: 1px solid #d9d9d9; background: #fff; white-space: nowrap; }
.btn-sm:hover { border-color: #1890ff; color: #1890ff; }
.btn-sm.red { color: #ff4d4f; border-color: #ff4d4f; }
.btn-sm.red:hover { background: #fff1f0; }
.btn-sm.green { color: #52c41a; border-color: #52c41a; }
.btn-sm.green:hover { background: #f6ffed; }
.btn-gift { background: #ff6b35; color: white; border: none; }
.btn-gift:hover { background: #ff8540; }

.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.badge.admin { background: #fff7e6; color: #fa8c16; }
.badge.user { background: #e6f7ff; color: #1890ff; }
.badge.importer { background: #f6ffed; color: #52c41a; }
.claimed-badge { font-size: 11px; color: #999; }
.dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #52c41a; margin-right: 4px; }
.dot.off { background: #d9d9d9; }
.sb { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.sb.generating { background: #e6f7ff; color: #1890ff; }
.sb.paused { background: #fff7e6; color: #fa8c16; }
.sb.completed { background: #f6ffed; color: #52c41a; }
.sb.error { background: #fff1f0; color: #ff4d4f; }
.score { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.score.high { background: #f6ffed; color: #52c41a; }
.score.mid { background: #fff7e6; color: #fa8c16; }
.score.low { background: #fff1f0; color: #ff4d4f; }

.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: #fff; border-radius: 12px; padding: 24px; width: 90%; max-width: 420px; }
.modal h3 { margin-bottom: 16px; font-size: 16px; }
.row { display: flex; align-items: center; margin-bottom: 12px; gap: 8px; }
.row label { width: 80px; font-size: 13px; color: #666; flex-shrink: 0; }
.row .input, .row select { flex: 1; padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px; outline: none; }
.modal-acts { display: flex; gap: 8px; margin-top: 16px; }
.modal-acts button { flex: 1; padding: 8px; border-radius: 6px; font-size: 14px; cursor: pointer; border: none; }
.btn { padding: 8px 20px; border-radius: 6px; font-size: 14px; cursor: pointer; border: none; }
.btn-primary { background: #1890ff; color: #fff; }
.btn-primary:hover { background: #40a9ff; }
.btn-outline { background: #fff; border: 1px solid #d9d9d9; }
.btn-outline:hover { border-color: #1890ff; color: #1890ff; }
.red-btn { background: #ff4d4f; color: #fff; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
.red-btn:hover { background: #ff7875; }

.wc-cell { display: flex; flex-direction: column; gap: 2px; }
.wc-num { font-weight: 600; }
.wc-detail { font-size: 11px; white-space: nowrap; }
.wc-detail.rate-high { color: #52c41a; }
.wc-detail.rate-mid { color: #fa8c16; }
.wc-detail.rate-low { color: #ff4d4f; }

.form-card { background: #fff; border-radius: 8px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); max-width: 500px; }
.form-card .row { margin-bottom: 16px; }
.form-card .row label { width: 90px; }
.msg { margin-top: 10px; font-size: 14px; color: #ff4d4f; }
.msg.ok { color: #52c41a; }
.d-json-modal { max-width: 700px; }
.json-view { background: #f5f5f5; padding: 12px; border-radius: 6px; font-size: 12px; max-height: 400px; overflow: auto; white-space: pre-wrap; }
.textarea { width: 100%; padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px; outline: none; font-family: monospace; resize: vertical; }
</style>
