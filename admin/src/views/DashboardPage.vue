<template>
  <div class="admin-page">
    <!-- 顶栏 -->
    <div class="topbar">
      <h2>⚙️ 管理后台</h2>
      <div class="topbar-right">
        <span class="admin-name">{{ adminUser?.email }}</span>
        <button class="logout-btn" @click="handleLogout">退出</button>
      </div>
    </div>

    <!-- Tab 导航 -->
    <div class="tabs">
      <button v-for="t in tabs" :key="t.key" class="tab"
        :class="{ active: activeTab === t.key }" @click="activeTab = t.key">
        {{ t.icon }} {{ t.label }}
      </button>
    </div>

    <div class="body">
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
            <thead><tr><th>邮箱</th><th>昵称</th><th>角色</th><th>Token(剩余/总额)</th><th>进群</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="u in users" :key="u._id">
                <td>{{ u.email }}</td>
                <td>{{ u.nickname }}</td>
                <td><span class="badge" :class="u.role">{{ u.role==='admin'?'管理员':'用户' }}</span></td>
                <td>{{ (u.tokens?.total||0)-(u.tokens?.used||0) }}/{{ u.tokens?.total||0 }}</td>
                <td>
                  <button v-if="!u.groupRewardClaimed" class="btn-sm btn-gift" :disabled="rewarding===u._id" @click="grantReward(u)">{{ rewarding===u._id?'...':'🎁 进群赠送' }}</button>
                  <span v-else class="claimed-badge">已领取</span>
                </td>
                <td><span class="dot" :class="{ off: u.disabled }"></span>{{ u.disabled ? '禁用' : '正常' }}</td>
                <td class="acts">
                  <button class="btn-sm" @click="openEdit(u)">编辑</button>
                  <button class="btn-sm" :class="u.disabled?'green':'red'" @click="toggleDisable(u)">{{ u.disabled?'启用':'禁用' }}</button>
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
                <th>字数</th>
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
                <td>{{ (d.originalLength||0).toLocaleString() }}</td>
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

        <!-- JSON 预览弹窗 -->
        <Teleport to="body">
          <div v-if="jsonModal" class="overlay" @click.self="jsonModal=false">
            <div class="modal" style="max-width:700px;">
              <h3>📋 蒸馏 JSON</h3>
              <pre class="json-preview">{{ jsonContent }}</pre>
              <div class="modal-acts">
                <button class="btn btn-outline" @click="jsonModal=false">关闭</button>
                <button class="btn btn-primary" @click="copyJson">📋 复制</button>
              </div>
            </div>
          </div>
        </Teleport>

        <!-- 编辑弹窗 -->
        <Teleport to="body">
          <div v-if="editModal" class="overlay" @click.self="editModal=false">
            <div class="modal" style="max-width:600px;">
              <h3>编辑蒸馏记录</h3>
              <div class="row"><label>小说名</label><input v-model="dForm.title" class="input" /></div>
              <div class="row"><label>主分类</label><input v-model="dForm.mainCategory" class="input" /></div>
              <div class="row"><label>二级分类</label><input v-model="dForm.subCategory" class="input" /></div>
              <div class="row"><label>标签（逗号分隔）</label><input v-model="dForm.tags" class="input" /></div>
              <div class="row"><label>质量评分（1-100）</label><input v-model.number="dForm.qualityScore" class="input" type="number" min="0" max="100" /></div>
              <div class="row"><label>风格描述</label><textarea v-model="dForm.styleProfile" class="input" rows="4"></textarea></div>
              <div class="row"><label>写作特点</label><textarea v-model="dForm.writingCharacteristics" class="input" rows="3"></textarea></div>
              <div class="modal-acts">
                <button class="btn btn-outline" @click="editModal=false">取消</button>
                <button class="btn btn-primary" @click="saveDistill">保存</button>
              </div>
            </div>
          </div>
        </Teleport>
      </div>

      <!-- ====== 模型管理 ====== -->
      <div v-if="activeTab === 'models'">
        <div class="model-box">
          <div class="row"><label>API 地址</label><input v-model="mForm.baseUrl" class="input" /></div>
          <div class="row"><label>模型名称</label><input v-model="mForm.model" class="input" /></div>
          <div class="row"><label>API Key</label>
            <div class="key-r"><input v-model="mForm.apiKey" class="input" :type="showK?'text':'password'" />
              <button class="btn-sm btn-outline" @click="showK=!showK">{{ showK?'🙈':'👁️' }}</button>
            </div>
          </div>
          <div class="acts">
            <button class="btn btn-primary" :disabled="savingM" @click="saveModel">{{ savingM?'保存中...':'💾 保存模型配置' }}</button>
            <button class="btn btn-red" :disabled="restarting" @click="restartSrv">{{ restarting?'重启中...':'🔄 重启服务' }}</button>
          </div>
          <div v-if="mMsg" class="msg" :class="{ ok: mMsgOk }">{{ mMsg }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const router = useRouter()
function safeParse(key) { try { const v = localStorage.getItem(key); if (!v || v === 'undefined') return {}; return JSON.parse(v) } catch { return {} } }
const adminUser = computed(() => safeParse('admin_user'))
const activeTab = ref('dashboard')
const now = ref(new Date().toLocaleString())
setInterval(() => { now.value = new Date().toLocaleString() }, 10000)

const tabs = [
  { key: 'dashboard', icon: '📊', label: '数据大屏' },
  { key: 'users', icon: '👥', label: '用户管理' },
  { key: 'novels', icon: '📚', label: '小说管理' },
  { key: 'distill', icon: '🧪', label: '蒸馏管理' },
  { key: 'models', icon: '🤖', label: '模型管理' },
]
const statusMap = { generating: '生成中', paused: '已暂停', completed: '已完成', error: '出错' }

// ====== 仪表盘 ======
const dash = reactive({ totalUsers:0,totalNovels:0,totalTokens:0,usedTokens:0,recentRegistrations:0,completedNovels:0,generatingNovels:0 })
const revenue = ref(0)
async function loadDash() {
  try { const r=await api.get('/admin/dashboard'); Object.assign(dash,r.data); revenue.value=Math.round((dash.totalTokens/1000000)*15) } catch {}
}

// ====== 用户 ======
const users = ref([])
const userQ = ref('')
const showModal = ref(false)
const editUserData = ref(null)
const editForm = reactive({ nickname:'', role:'user', addTokens:0 })
const rewarding = ref('')

async function loadUsers() {
  try { const r=await api.get('/admin/users',{params:{keyword:userQ.value}}); users.value=r.data.users } catch {}
}
function openEdit(u) {
  editUserData.value=u; editForm.nickname=u.nickname; editForm.role=u.role; editForm.addTokens=0; showModal.value=true
}
async function saveUser() {
  try { await api.put(`/admin/users/${editUserData.value._id}`,{...editForm}); showModal.value=false; loadUsers() }
  catch(e) { alert('保存失败:'+(e.response?.data?.message||e.message)) }
}
async function toggleDisable(u) {
  try { await api.put(`/admin/users/${u._id}`,{disabled:!u.disabled}); loadUsers() } catch {}
}
async function grantReward(u) {
  if (!confirm(`确认给 ${u.email} 赠送 5000 Token（进群奖励）？`)) return
  rewarding.value = u._id
  try {
    await api.post(`/admin/users/${u._id}/group-reward`)
    loadUsers()
  } catch (e) { alert('赠送失败:'+(e.response?.data?.message||e.message)) }
  rewarding.value = ''
}

// ====== 小说 ======
const novels = ref([])
const allU = ref([])
const nFilterUser = ref('')
const nFilterStatus = ref('')
const nQ = ref('')
async function loadNovels() {
  try { const r=await api.get('/admin/novels',{params:{userId:nFilterUser.value,status:nFilterStatus.value,keyword:nQ.value}}); novels.value=r.data.novels } catch {}
}
async function loadSimpleUsers() {
  try { const r=await api.get('/admin/users/simple'); allU.value=r.data } catch {}
}

// ====== 模型 ======
const mForm = reactive({ baseUrl:'', model:'', apiKey:'' })
const showK = ref(false)
const savingM = ref(false)
const restarting = ref(false)
const mMsg = ref('')
const mMsgOk = ref(false)

async function loadModel() {
  try { const r=await api.get('/admin/models'); mForm.baseUrl=r.data.baseUrl; mForm.model=r.data.model; mForm.apiKey='' } catch {}
}
async function saveModel() {
  savingM.value=true; mMsg.value=''
  try { await api.put('/admin/models',{...mForm}); mMsg.value='✅ 已保存，请点击重启服务'; mMsgOk.value=true }
  catch(e) { mMsg.value='❌ '+(e.response?.data?.message||e.message); mMsgOk.value=false }
  savingM.value=false
}
async function restartSrv() {
  if(!confirm('确认重启服务？')) return; restarting.value=true
  try { await api.post('/admin/restart'); alert('服务正在重启...') } catch {}
  restarting.value=false
}

// ====== 蒸馏管理 ======
const distillations = ref([])
const dFilterUser = ref('')
const dQ = ref('')
const dSelected = ref([])
const jsonModal = ref(false)
const jsonContent = ref('')
const editModal = ref(false)
const dForm = reactive({ title:'', mainCategory:'', subCategory:'', tags:'', qualityScore:0, styleProfile:'', writingCharacteristics:'' })
const editDistillId = ref('')

const dAllSelected = computed(() => distillations.value.length > 0 && dSelected.value.length === distillations.value.length)

async function loadDistillations() {
  try {
    const r = await api.get('/admin/distillations', {
      params: { userId: dFilterUser.value, keyword: dQ.value, pageSize: 100 }
    })
    distillations.value = r.data.list
    dSelected.value = []
  } catch {}
}
function dToggleAll() {
  if (dAllSelected.value) dSelected.value = []
  else dSelected.value = distillations.value.map(d => d._id)
}
function dToggle(id) {
  const idx = dSelected.value.indexOf(id)
  if (idx > -1) dSelected.value.splice(idx, 1)
  else dSelected.value.push(id)
}
function scoreClass(s) {
  if (!s) return '';
  if (s >= 80) return 'high';
  if (s >= 60) return 'mid';
  return 'low';
}
async function viewDistillJson(d) {
  try {
    const r = await api.get(`/admin/distillations/${d._id}`)
    jsonContent.value = JSON.stringify(r.data, null, 2)
    jsonModal.value = true
  } catch (e) { alert('获取失败:' + (e.response?.data?.message || e.message)) }
}
function copyJson() {
  navigator.clipboard.writeText(jsonContent.value).then(() => alert('已复制')).catch(() => {})
}
function editDistill(d) {
  editDistillId.value = d._id
  dForm.title = d.title
  dForm.mainCategory = d.mainCategory
  dForm.subCategory = d.subCategory || ''
  dForm.tags = (d.tags || []).join(', ')
  dForm.qualityScore = d.qualityScore || 0
  dForm.styleProfile = d.styleProfile || ''
  dForm.writingCharacteristics = d.writingCharacteristics || ''
  editModal.value = true
}
async function saveDistill() {
  try {
    await api.put(`/admin/distillations/${editDistillId.value}`, {
      title: dForm.title, mainCategory: dForm.mainCategory, subCategory: dForm.subCategory,
      tags: dForm.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean),
      qualityScore: dForm.qualityScore, styleProfile: dForm.styleProfile,
    })
    editModal.value = false
    loadDistillations()
  } catch (e) { alert('保存失败:' + (e.response?.data?.message || e.message)) }
}
async function deleteDistill(d) {
  if (!confirm(`确认删除《${d.title}》的蒸馏记录？`)) return
  try { await api.delete(`/admin/distillations/${d._id}`); loadDistillations() }
  catch (e) { alert('删除失败') }
}
async function exportDistill(d) {
  const token = localStorage.getItem('admin_token')
  window.open(`/api/admin/distillations/${d._id}/export?token=${encodeURIComponent(token)}`, '_blank')
}
async function batchExportDistill() {
  const token = localStorage.getItem('admin_token')
  const ids = dSelected.value
  try {
    const r = await fetch('/api/admin/distillations/export-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ ids }),
    })
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `蒸馏批量导出_${Date.now()}.json`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  } catch (e) { alert('批量导出失败') }
}

function fmt(d) { return d?new Date(d).toLocaleString():'' }

let dt;
function debounce(fn,ms) { clearTimeout(dt); dt=setTimeout(fn,ms) }
function handleLogout() { localStorage.removeItem('admin_token'); localStorage.removeItem('admin_user'); router.push('/login') }

onMounted(async () => {
  await loadDash(); await loadUsers(); await loadNovels(); await loadSimpleUsers(); await loadModel(); await loadDistillations()
})
</script>

<style scoped>
.admin-page { height:100%; display:flex; flex-direction:column; background:#f0f2f5; }

.topbar {
  display:flex; align-items:center; padding:12px 16px;
  background:#1a1a2e; color:white; gap:12px;
}
.topbar h2 { flex:1; font-size:16px; }
.topbar-right { display:flex; align-items:center; gap:10px; }
.admin-name { font-size:12px; opacity:0.8; }
.logout-btn { background:none; border:1px solid #555; color:#aaa; padding:4px 12px; border-radius:4px; cursor:pointer; font-size:12px; }
.logout-btn:hover { color:white; border-color:#e94560; }

.tabs { display:flex; background:#16213e; }
.tab {
  flex:1; padding:12px 4px; border:none; background:transparent;
  color:#8899aa; font-size:12px; cursor:pointer; white-space:nowrap;
  border-bottom:3px solid transparent; transition:all .2s;
}
.tab.active { color:#e94560; border-bottom-color:#e94560; background:rgba(233,69,96,0.08); }

.body { flex:1; overflow-y:auto; padding:12px; }

.grid-4 { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
.card { background:white; border-radius:10px; padding:16px 8px; text-align:center; }
.card.accent { background:linear-gradient(135deg,#667eea,#764ba2); color:white; }
.num { font-size:22px; font-weight:700; }
.lbl { font-size:11px; opacity:0.8; margin-top:4px; }
.update-time { text-align:center; font-size:11px; color:#999; margin-top:12px; }

.search-bar { display:flex; gap:8px; margin-bottom:10px; }
.search-bar .input { font-size:13px; padding:8px 12px; border:1px solid #ddd; border-radius:6px; outline:none; }

.table-wrap { background:white; border-radius:10px; overflow-x:auto; }
table { width:100%; border-collapse:collapse; font-size:12px; }
th { background:#f5f5f5; padding:10px 8px; text-align:left; font-weight:600; white-space:nowrap; }
td { padding:10px 8px; border-bottom:1px solid #eee; }
.acts { display:flex; gap:4px; }
.btn-sm { padding:3px 8px; border:1px solid #ddd; border-radius:4px; font-size:11px; cursor:pointer; background:white; }
.btn-sm.red { color:#e94560; border-color:#e94560; }
.btn-sm.green { color:#52c41a; border-color:#52c41a; }
.btn-sm.btn-gift { color:#FF6B35; border-color:#FF6B35; }
.claimed-badge { font-size:11px; color:#999; }
.badge { padding:1px 6px; border-radius:3px; font-size:11px; }
.badge.admin { background:#fff0f0; color:#e94560; }
.badge.user { background:#f0f5ff; color:#1890ff; }
.dot { display:inline-block; width:6px; height:6px; border-radius:50%; background:#52c41a; margin-right:4px; }
.dot.off { background:#ff4d4f; }
.sb { padding:1px 6px; border-radius:3px; font-size:11px; }
.sb.generating { background:#e6f7ff; color:#1890ff; }
.sb.paused { background:#fff7e6; color:#fa8c16; }
.sb.completed { background:#f6ffed; color:#52c41a; }

.overlay { position:fixed; top:0;left:0;right:0;bottom:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px; }
.modal { background:white; border-radius:12px; padding:24px; max-width:400px; width:100%; }
.modal h3 { margin-bottom:16px; }
.row { margin-bottom:12px; }
.row label { display:block; font-size:12px; color:#666; margin-bottom:4px; }
.row .input { width:100%; padding:8px 12px; border:1px solid #ddd; border-radius:6px; font-size:13px; outline:none; }
.modal-acts { display:flex; gap:8px; margin-top:16px; }
.modal-acts button { flex:1; padding:10px; border:none; border-radius:8px; font-size:14px; cursor:pointer; }
.btn-primary { background:#e94560; color:white; }
.btn-primary:disabled { background:#ccc; }
.btn-outline { background:white; border:1px solid #ddd; }
.btn-red { background:#ff4d4f; color:white; border:none; }

.model-box { background:white; border-radius:10px; padding:20px; }
.key-r { display:flex; gap:6px; }
.key-r .input { flex:1; }
.acts { display:flex; gap:8px; margin-top:16px; }
.acts button { flex:1; padding:10px; border:none; border-radius:8px; font-size:13px; cursor:pointer; }
.msg { margin-top:10px; padding:8px; border-radius:6px; font-size:13px; text-align:center; }
.msg.ok { background:#f6ffed; color:#52c41a; border:1px solid #b7eb8f; }
.score { padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; }
.score.high { background:#f6ffed; color:#52c41a; }
.score.mid { background:#fff7e6; color:#fa8c16; }
.score.low { background:#fff1f0; color:#ff4d4f; }
.json-preview {
  background:#1a1a2e; color:#e6e6e6; padding:16px; border-radius:8px;
  font-size:12px; line-height:1.5; max-height:400px; overflow:auto;
  white-space:pre-wrap; word-break:break-all; font-family:monospace;
}
</style>
