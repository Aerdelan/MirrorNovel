<template>
 <SidebarLayout>
 <!-- ====== 数据大屏 ====== -->
 <div v-if="activeTab === 'dashboard'">
 <div class="grid-4">
 <div class="card"><div class="num">{{ dash.totalUsers }}</div><div class="lbl">注册用户</div></div>
 <div class="card"><div class="num">{{ dash.totalNovels }}</div><div class="lbl">总小说</div></div>
 <div class="card"><div class="num">{{ compactNumber(dashboardPoints.total) }}</div><div class="lbl">发放积分</div></div>
 <div class="card"><div class="num">{{ compactNumber(dashboardPoints.used) }}</div><div class="lbl">消耗积分</div></div>
 </div>
 <div class="grid-4" style="margin-top:10px;">
 <div class="card accent"><div class="num">{{ dash.completedNovels }}</div><div class="lbl">生成完成</div></div>
 <div class="card accent"><div class="num">{{ dash.generatingNovels }}</div><div class="lbl">生成中/暂停</div></div>
 <div class="card accent"><div class="num">{{ dash.recentRegistrations }}</div><div class="lbl">近7日注册</div></div>
 <div class="card accent"><div class="num">{{ pointsValue }}元</div><div class="lbl">积分对应金额</div></div>
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
 <thead><tr><th>邮箱</th><th>昵称</th><th>角色</th><th>邀请人</th><th>积分（可用 / 总额）</th><th>进群</th><th>状态</th><th>操作</th></tr></thead>
 <tbody>
 <tr v-for="u in users" :key="u._id">
 <td>{{ u.email }}</td>
 <td>{{ u.nickname }}</td>
 <td><span class="badge" :class="u.role">{{ u.role==='admin'?'管理员':'用户' }}</span></td>
 <td>{{ u.invitedBy?.email || '-' }}</td>
 <td class="points-cell">{{ formatNumber(userPoints(u).available) }} / {{ formatNumber(userPoints(u).total) }}</td>
 <td>
 <button v-if="!u.groupRewardClaimed" class="btn-sm btn-gift" :disabled="rewarding===u._id" @click="grantReward(u)">{{ rewarding===u._id?'...':' 进群赠送' }}</button>
 <span v-else class="claimed-badge">已领取</span>
 </td>
 <td><span class="dot" :class="{ off: u.disabled }"></span>{{ u.disabled ? '禁用' : '正常' }}</td>
 <td class="acts">
  <button class="btn-sm" @click="openEdit(u)">编辑</button>
  <button class="btn-sm" @click="showPointsLedger(u)">流水</button>
 <button class="btn-sm" :class="u.disabled?'green':'red'" @click="toggleDisable(u)">{{ u.disabled?'启用':'禁用' }}</button>
 <button class="btn-sm btn-invite" @click="showInvitedUsers(u)">已邀请</button>
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
 <div class="row"><label>积分调整</label><input v-model.number="editForm.adjustPoints" class="input" type="number" step="1" placeholder="正数发放，负数扣减" /></div>
 <div class="row"><label>调整原因</label><input v-model.trim="editForm.adjustReason" class="input" maxlength="120" placeholder="积分调整时必填" /></div>
 <div class="modal-acts">
 <button class="btn btn-outline" @click="showModal=false">取消</button>
 <button class="btn btn-primary" @click="saveUser">保存</button>
 </div>
 </div>
 </div>
 </Teleport>
 <Teleport to="body">
 <div v-if="ledgerModal" class="overlay" @click.self="ledgerModal=false"><div class="modal" style="max-width:640px;"><h3>{{ ledgerUser.email }} 的积分流水</h3><div v-if="ledgerLoading" style="padding:20px;text-align:center;">加载中...</div><div v-else-if="ledgerEntries.length===0" style="padding:20px;text-align:center;color:#888;">暂无积分记录</div><div v-else class="modal-table-wrap"><table><thead><tr><th>时间</th><th>类型</th><th>积分</th><th>余额</th><th>原因</th></tr></thead><tbody><tr v-for="(entry,index) in ledgerEntries" :key="`${entry.createdAt}-${index}`"><td>{{ formatDate(entry.createdAt) }}</td><td>{{ entry.type === 'credit' ? '收入' : '支出' }}</td><td>{{ entry.type === 'credit' ? '+' : '-' }}{{ formatNumber(entry.points) }}</td><td>{{ formatNumber(entry.balanceAfter) }}</td><td>{{ ledgerReason(entry.reason) }}</td></tr></tbody></table></div><div class="modal-acts"><button class="btn btn-outline" @click="ledgerModal=false">关闭</button></div></div></div>
 </Teleport>
 <!-- 已邀请用户弹窗 -->
 <Teleport to="body">
 <div v-if="inviteModal" class="overlay" @click.self="inviteModal=false">
 <div class="modal" style="max-width:500px;">
 <h3> {{ inviteModalUser?.email }} 的邀请记录</h3>
 <div v-if="invitedUsers.length === 0" style="text-align:center;padding:20px;color:#999;">暂无邀请记录</div>
 <div v-else class="modal-table-wrap">
 <table>
 <thead><tr><th>邮箱</th><th>昵称</th><th>注册时间</th></tr></thead>
 <tbody>
 <tr v-for="iu in invitedUsers" :key="iu._id">
 <td>{{ iu.email }}</td>
 <td>{{ iu.nickname }}</td>
 <td>{{ fmt(iu.createdAt) }}</td>
 </tr>
 </tbody>
 </table>
 </div>
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
 <select v-model="nFilterUser" class="input filter-user" @change="loadNovels">
 <option value="">全部用户</option>
 <option v-for="u in allU" :key="u._id" :value="u._id">{{ u.email }}</option>
 </select>
 <select v-model="nFilterStatus" class="input filter-status" @change="loadNovels">
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
 <select v-model="dFilterUser" class="input filter-user" @change="loadDistillations">
 <option value="">全部导入员</option>
 <option v-for="u in allU" :key="u._id" :value="u._id">{{ u.email }}</option>
 </select>
 <input v-model="dQ" class="input" placeholder="搜索小说名" @input="debounce(loadDistillations,300)" />
 <button class="btn-sm btn-export" :disabled="dSelected.length===0" @click="batchExportDistill">批量导出</button>
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
 <button class="btn-sm btn-success" @click="exportDistill(d)">导出</button>
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

 <!-- ====== 积分活动 ====== -->
 <div v-if="activeTab === 'activities'">
 <div class="activity-editor">
 <div class="editor-heading">
 <div>
 <h3 class="form-title">{{ editingActivityId ? '编辑积分活动' : '创建积分活动' }}</h3>
 <p>奖励额度、中奖概率、任务难度和领取上限均由后台控制。</p>
 </div>
 <button v-if="editingActivityId" type="button" class="btn-sm" @click="resetActivityForm">取消编辑</button>
 </div>

 <div class="field-grid activity-basics">
 <div class="field span-2"><label>活动名称</label><input v-model.trim="acForm.name" class="input" maxlength="80" placeholder="如：连续创作七日挑战" /></div>
 <div class="field"><label>活动类型</label><select v-model="acForm.type" class="input"><option v-for="option in activityTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></div>
 <div class="field"><label>任务难度</label><select v-model="acForm.difficulty" class="input"><option v-for="option in difficultyOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></div>
 <div class="field span-2"><label>活动说明</label><textarea v-model.trim="acForm.description" class="textarea" maxlength="300" rows="3" placeholder="用户可看到的参与条件与奖励说明"></textarea></div>
 <div class="field"><label>开始时间</label><input v-model="acForm.startTime" class="input" type="datetime-local" /></div>
 <div class="field"><label>结束时间</label><input v-model="acForm.endTime" class="input" type="datetime-local" /></div>
 </div>

 <div class="rule-section">
 <h4>奖励规则</h4>
 <div class="field-grid">
 <div class="field"><label>基础奖励积分</label><input v-model.number="acForm.rewardPoints" class="input" type="number" min="1" step="1" /></div>
 <div class="field"><label>最低奖励积分</label><input v-model.number="acForm.minRewardPoints" class="input" type="number" min="1" step="1" /></div>
 <div class="field"><label>最高奖励积分</label><input v-model.number="acForm.maxRewardPoints" class="input" type="number" min="1" step="1" /></div>
 <div class="field"><label>中奖概率（%）</label><input v-model.number="acForm.probability" class="input" type="number" min="0" max="100" step="0.1" /></div>
 </div>
 </div>

 <div class="rule-section">
 <h4>参与门槛</h4>
 <div class="field-grid requirement-grid">
 <div class="field"><label>统计指标</label><select v-model="acForm.requirement.metric" class="input"><option v-for="option in metricOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></div>
 <div class="field"><label>比较方式</label><select v-model="acForm.requirement.operator" class="input" :disabled="acForm.requirement.metric === 'none'"><option value="gte">不少于</option><option value="lte">不多于</option></select></div>
 <div class="field"><label>门槛数值</label><input v-model.number="acForm.requirement.threshold" class="input" type="number" min="0" step="1" :disabled="acForm.requirement.metric === 'none'" /></div>
 </div>
 </div>

 <div class="rule-section">
 <h4>额度与次数限制</h4>
 <div class="field-grid limits-grid">
 <div class="field"><label>每人每日次数</label><input v-model.number="acForm.dailyLimit" class="input" type="number" min="0" step="1" /><small>0 表示不限</small></div>
 <div class="field"><label>每人总次数</label><input v-model.number="acForm.perUserLimit" class="input" type="number" min="0" step="1" /><small>0 表示不限</small></div>
 <div class="field"><label>全站总次数</label><input v-model.number="acForm.totalLimit" class="input" type="number" min="0" step="1" /><small>0 表示不限</small></div>
 <div class="field"><label>积分总预算</label><input v-model.number="acForm.totalPointsBudget" class="input" type="number" min="0" step="1" /><small>0 表示不限</small></div>
 </div>
 </div>

 <div class="rule-section activity-switches">
 <label class="switch-field"><input v-model="acForm.enabled" type="checkbox" /><span>启用活动</span></label>
 <label class="switch-field"><input v-model="acForm.autoClaim" type="checkbox" /><span>达成后自动发放</span></label>
 </div>

 <div class="field email-field"><label>邮件通知内容</label><textarea v-model.trim="acForm.emailContent" class="textarea" rows="4" placeholder="可选；发送通知时使用"></textarea></div>
 <div class="editor-actions">
 <button type="button" class="btn btn-outline" @click="resetActivityForm">重置</button>
 <button type="button" class="btn btn-primary" :disabled="acSaving" @click="saveActivity">{{ acSaving ? '保存中...' : editingActivityId ? '保存修改' : '创建活动' }}</button>
 </div>
 <div v-if="acMsg" class="msg" :class="{ ok: acOk }">{{ acMsg }}</div>
 </div>

 <div class="activity-list">
 <h3 class="section-title">活动记录</h3>
 <div v-if="activities.length === 0" class="empty-state">暂无活动</div>
 <div v-for="act in activities" :key="act._id" class="act-card">
 <div class="act-head">
 <div>
 <strong>{{ act.name }}</strong>
 <span class="badge" :class="activityStatus(act)" style="margin-left:8px;">{{ activityStatusLabel(act) }}</span>
 <span class="activity-type">{{ activityTypeLabel(act.type) }}</span>
 </div>
 <div class="activity-actions">
 <button type="button" class="btn-sm" @click="editActivity(act)">编辑</button>
 <button type="button" class="btn-sm" :class="act.enabled === false ? 'green' : 'red'" :disabled="act.toggling" @click="toggleActivity(act)">{{ act.toggling ? '处理中...' : act.enabled === false ? '启用' : '停用' }}</button>
 <button type="button" class="btn-sm red" :disabled="act.deleting" @click="deleteActivity(act)">{{ act.deleting ? '删除中...' : '删除' }}</button>
 <button v-if="!act.emailSent" type="button" class="btn-sm btn-mail" :disabled="act.sending" @click="sendActivityEmail(act)">{{ act.sending?'发送中...':'发送邮件通知' }}</button>
 <span v-else class="claimed-badge"> 已发送邮件</span>
 </div>
 </div>
 <p v-if="act.description" class="act-description">{{ act.description }}</p>
 <div class="act-metrics">
 <span>奖励 <strong>{{ rewardSummary(act) }}</strong> 积分</span>
 <span>概率 <strong>{{ numberValue(act.probability, 100) }}%</strong></span>
 <span>难度 <strong>{{ difficultyLabel(act.difficulty) }}</strong></span>
 <span>{{ requirementSummary(act.requirement) }}</span>
 </div>
 <div class="act-detail">
 <span>{{ fmt(act.startTime) }} 至 {{ fmt(act.endTime) }}</span>
 <span>每日 / 每人 / 全站：{{ limitLabel(act.dailyLimit) }} / {{ limitLabel(act.perUserLimit) }} / {{ limitLabel(act.totalLimit) }}</span>
 <span>预算：{{ limitPointsLabel(act.totalPointsBudget) }}</span>
 <span>参与 {{ formatNumber(act.counters?.attempts || 0) }}，中奖 {{ formatNumber(act.counters?.winners || 0) }}，已发 {{ formatNumber(act.counters?.pointsAwarded || 0) }} 积分</span>
 </div>
 </div>
 </div>
 </div>

 <!-- ====== 线路与计价配置 ====== -->
 <div v-if="activeTab === 'models'">
 <div class="model-page-heading">
 <div><h3>服务端线路映射</h3><p>用户端只显示线路别名；真实模型、地址、密钥及供应商成本仅管理员可见。</p></div>
 <div class="pricing-note"><strong>兑换基准</strong><span>1 元 = 1000 积分</span><span>成本线路按 8 倍计价</span></div>
 </div>
 <div class="route-list">
 <section v-for="(line, index) in modelRoutes" :key="line.id" class="route-card">
 <div class="route-head">
 <div><span class="route-index">{{ index + 1 }}</span><strong>{{ line.alias }}</strong><code>{{ line.id }}</code></div>
 <span class="pricing-badge" :class="line.pricingMode">{{ line.pricingMode === 'cost' ? '成本计价' : '固定计价' }}</span>
 </div>
 <div class="field-grid route-fields">
 <div class="field span-2"><label>API 地址</label><input v-model.trim="line.baseUrl" class="input" placeholder="https://provider.example/v1" /></div>
 <div class="field"><label>真实模型名</label><input v-model.trim="line.model" class="input" autocomplete="off" placeholder="仅后台可见" /></div>
 <div class="field"><label>API Key</label><input v-model.trim="line.apiKey" class="input" type="password" autocomplete="new-password" :placeholder="line.hasApiKey ? '已配置，留空则不修改' : '输入密钥'" /></div>
 <template v-if="line.pricingMode === 'fixed'">
 <div class="field"><label>每计费块积分</label><input v-model.number="line.pointsPerBlock" class="input" type="number" min="1" step="1" /></div>
 <div class="field"><label>每计费块模型用量</label><input v-model.number="line.tokensPerBlock" class="input" type="number" min="1" step="1" /></div>
 </template>
 <template v-else>
 <div class="field"><label>输入成本（元 / 百万用量）</label><input v-model.number="line.inputRmbPerMillion" class="input" type="number" min="0" step="0.001" placeholder="供应商原价" /></div>
 <div class="field"><label>输出成本（元 / 百万用量）</label><input v-model.number="line.outputRmbPerMillion" class="input" type="number" min="0" step="0.001" placeholder="供应商原价" /></div>
 </template>
 </div>
 <div class="route-summary">{{ routePricingSummary(line) }}</div>
 </section>
 </div>
 <div class="model-actions">
 <button type="button" class="btn btn-primary" :disabled="mSaving" @click="saveModels">{{ mSaving ? '保存中...' : '保存全部线路' }}</button>
 <span v-if="mMsg" class="msg inline-msg" :class="{ ok: mOk }">{{ mMsg }}</span>
 </div>
 <div class="form-card secondary-form-card">
 <button class="btn red-btn" @click="restartServer">重启服务</button>
 <div class="form-help">重启 Node.js 服务（PM2 会自动恢复）</div>
 </div>
 </div>

 <!-- ====== 类型模板管理 ====== -->
 <div v-if="activeTab === 'templates'">
 <div class="search-bar template-actions">
 <button class="btn-sm btn-add" @click="addTemplate">新增模板</button>
 <button class="btn-sm btn-save" :disabled="!tplDirty" @click="saveTemplates">{{ tplSaving ? '保存中...' : '保存全部' }}</button>
 <span v-if="tplDirty" class="unsaved-hint">有未保存的修改</span>
 <span v-if="tplMsg" class="msg inline-msg" :class="{ ok: tplOk }">{{ tplMsg }}</span>
 </div>
 <div class="tpl-list">
 <div v-for="(tpl, idx) in templates" :key="idx" class="tpl-card">
 <div class="tpl-header">
 <span class="tpl-name">{{ tpl.name }} <span class="tpl-kw-count">{{ (tpl.keywords||[]).length }}个关键词</span></span>
 <button class="btn-sm red" @click="deleteTemplate(idx)">删除</button>
 </div>
 <div class="tpl-field">
 <label class="tpl-label">匹配关键词（逗号分隔）</label>
 <input v-model="tpl.keywordsStr" class="input tpl-input" placeholder="关键词1, 关键词2, ..." @input="tplDirty=true" />
 </div>
 <div class="tpl-field">
 <label class="tpl-label">注入提示（AI 参考上下文）</label>
 <textarea v-model="tpl.contextPrompt" class="textarea tpl-textarea" rows="4" @input="tplDirty=true"></textarea>
 </div>
 </div>
 </div>
 <div v-if="templates.length === 0" class="empty-state">暂无模板</div>
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
 const tabMap = { '/dashboard':'dashboard', '/users':'users', '/novels':'novels', '/distill':'distill', '/activities':'activities', '/templates':'templates', '/models':'models' }
 if (p === '/templates') loadTemplates()
 if (p === '/activities') loadActivities()
 activeTab.value = tabMap[p] || 'dashboard'
}, { immediate: true })

// ====== 仪表盘 ======
const dash = ref({})
const dashboardPoints = computed(() => ({
 total: numberValue(dash.value.totalPoints, dash.value.totalTokens || 0),
 used: numberValue(dash.value.usedPoints, dash.value.usedTokens || 0),
}))
const pointsValue = computed(() => (dashboardPoints.value.total / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 2 }))
async function loadDash() {
 try { const r = await api.get('/admin/dashboard'); dash.value = r.data }
 catch { dash.value = { totalUsers:0, totalNovels:0, totalPoints:0, usedPoints:0, completedNovels:0, generatingNovels:0, recentRegistrations:0 } }
}
const timeInt = setInterval(() => { now.value = new Date().toLocaleString('zh-CN') }, 1000)
onUnmounted(() => clearInterval(timeInt))

// ====== 用户管理 ======
const users = ref([]); const userQ = ref(''); const showModal = ref(false); const editUserData = ref({}); const editForm = ref({}); const rewarding = ref('')
async function loadUsers() {
 try { const r = await api.get('/admin/users', { params: { q: userQ.value, keyword: userQ.value } }); users.value = r.data.users || r.data }
 catch {}
}
let debounceTimer; function debounce(fn, ms) { clearTimeout(debounceTimer); debounceTimer = setTimeout(fn, ms) }
 function openEdit(u) { editUserData.value = u; editForm.value = { nickname: u.nickname, role: u.role, adjustPoints: 0, adjustReason: '' }; showModal.value = true }

// 已邀请用户
const inviteModal = ref(false); const inviteModalUser = ref({}); const invitedUsers = ref([])
async function showInvitedUsers(u) {
 inviteModalUser.value = u; invitedUsers.value = []
 inviteModal.value = true
 try { const r = await api.get(`/admin/users/${u._id}/invited-users`); invitedUsers.value = r.data }
 catch { alert('获取失败') }
}
async function saveUser() {
 const adjustPoints = Math.trunc(numberValue(editForm.value.adjustPoints, 0))
 const payload = { nickname: editForm.value.nickname, role: editForm.value.role }
 try {
  await api.put(`/admin/users/${editUserData.value._id}`, payload)
  if (adjustPoints !== 0) {
   if (!editForm.value.adjustReason) throw new Error('积分调整必须填写原因')
   await api.post(`/admin/users/${editUserData.value._id}/points-adjust`, { amount: adjustPoints, reason: editForm.value.adjustReason })
  }
  showModal.value = false; loadUsers()
 }
 catch (e) { alert('保存失败:' + (e.response?.data?.message || e.message)) }
}
async function toggleDisable(u) {
 try { await api.put(`/admin/users/${u._id}`, { disabled: !u.disabled }); loadUsers() }
 catch (e) { alert('操作失败:' + (e.response?.data?.message || e.message)) }
}
async function grantReward(u) {
 if (!confirm(`确认给 ${u.email} 发放 5000 积分进群奖励？`)) return
 rewarding.value = u._id
 try { await api.post(`/admin/users/${u._id}/group-reward`); await loadUsers() }
 catch (e) { alert('发放失败:' + (e.response?.data?.message || e.message)) }
 finally { rewarding.value = '' }
}
const ledgerModal = ref(false); const ledgerLoading = ref(false); const ledgerEntries = ref([]); const ledgerUser = ref({})
async function showPointsLedger(u) { ledgerUser.value = u; ledgerEntries.value = []; ledgerModal.value = true; ledgerLoading.value = true; try { const r = await api.get(`/admin/users/${u._id}/points-ledger`); ledgerEntries.value = r.data.ledger || [] } catch (e) { alert('获取流水失败:' + (e.response?.data?.message || e.message)) } finally { ledgerLoading.value = false } }
function ledgerReason(reason) { if (String(reason || '').startsWith('activity:')) return '活动奖励'; if (String(reason || '').startsWith('admin_adjust:')) return `管理员调整：${String(reason).slice(13)}`; return ({ daily_checkin:'每日签到', invite_reward:'邀请奖励', group_reward:'进群奖励', purchase:'充值', novel_generation:'模型生成' })[reason] || reason || '-' }

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

// ====== 线路与模型管理 ======
const defaultModelRoutes = [
 { id:'normal_1', alias:'普通线路模型一', pricingMode:'fixed', pointsPerBlock:1000, tokensPerBlock:20000 },
 { id:'normal_2', alias:'普通线路模型二', pricingMode:'fixed', pointsPerBlock:1000, tokensPerBlock:20000 },
 { id:'advanced_1', alias:'高级线路模型一', pricingMode:'fixed', pointsPerBlock:1000, tokensPerBlock:20000 },
 { id:'vip', alias:'VIP线路模型', pricingMode:'cost', inputRmbPerMillion:null, outputRmbPerMillion:null },
 { id:'svip', alias:'SVIP线路模型', pricingMode:'cost', inputRmbPerMillion:null, outputRmbPerMillion:null },
]
const modelRoutes = ref(defaultModelRoutes.map(route => normalizeModelRoute(route)))
const mSaving = ref(false); const mMsg = ref(''); const mOk = ref(false)

function normalizeModelRoute(source = {}, fallback = {}) {
 const pricing = source.pricing || {}
 return {
  id: source.id || fallback.id || 'normal_1',
  alias: source.alias || fallback.alias || '普通线路模型一',
  pricingMode: source.pricingMode || pricing.mode || fallback.pricingMode || 'fixed',
  baseUrl: source.baseUrl || source.apiBase || fallback.baseUrl || '',
  model: source.model || source.modelName || fallback.model || '',
  apiKey: '',
  hasApiKey: Boolean(source.hasApiKey || source.apiKeyConfigured || fallback.hasApiKey),
  pointsPerBlock: numberValue(source.pointsPerBlock ?? pricing.pointsPerBlock, fallback.pointsPerBlock || 1000),
  tokensPerBlock: numberValue(source.tokensPerBlock ?? pricing.tokensPerBlock, fallback.tokensPerBlock || 20000),
  inputRmbPerMillion: nullableNumber(source.inputRmbPerMillion ?? pricing.inputRmbPerMillion ?? fallback.inputRmbPerMillion),
  outputRmbPerMillion: nullableNumber(source.outputRmbPerMillion ?? pricing.outputRmbPerMillion ?? fallback.outputRmbPerMillion),
 }
}
async function loadModels() {
 try {
  const { data } = await api.get('/admin/models')
  const incoming = Array.isArray(data.routes) ? data.routes : Array.isArray(data.modelRoutes) ? data.modelRoutes : []
  modelRoutes.value = defaultModelRoutes.map((fallback, index) => {
   const matched = incoming.find(route => route.id === fallback.id) || incoming[index]
   const legacy = index === 0 && !matched ? data : {}
   return normalizeModelRoute(matched || legacy, fallback)
  })
 } catch {
  modelRoutes.value = defaultModelRoutes.map(route => normalizeModelRoute(route))
 }
}
async function saveModels() {
 mSaving.value = true; mMsg.value = '';
 const missingCost = modelRoutes.value.find(line => line.pricingMode === 'cost'
  && (nullableNumber(line.inputRmbPerMillion) === null || nullableNumber(line.outputRmbPerMillion) === null))
 if (missingCost) {
  mMsg.value = `${missingCost.alias} 需要填写输入和输出供应商成本`; mOk.value = false; mSaving.value = false; return
 }
 const routes = modelRoutes.value.map(line => {
  const payload = {
   id: line.id,
   alias: line.alias,
   pricingMode: line.pricingMode,
   baseUrl: line.baseUrl,
   model: line.model,
  }
  if (line.apiKey) payload.apiKey = line.apiKey
  if (line.pricingMode === 'fixed') {
   payload.pointsPerBlock = Math.max(1, Math.floor(numberValue(line.pointsPerBlock, 1000)))
   payload.tokensPerBlock = Math.max(1, Math.floor(numberValue(line.tokensPerBlock, 20000)))
  } else {
   payload.inputRmbPerMillion = nullableNumber(line.inputRmbPerMillion)
   payload.outputRmbPerMillion = nullableNumber(line.outputRmbPerMillion)
   payload.costMarkupMultiplier = 8
   payload.pointsPerRmb = 1000
  }
  return payload
 })
 const primary = routes[0] || {}
 try {
  await api.put('/admin/models', { routes, baseUrl: primary.baseUrl, model: primary.model, apiKey: primary.apiKey })
  mMsg.value = '线路与定价配置已保存'; mOk.value = true
  await loadModels()
 }
 catch (e) { mMsg.value = ' ' + (e.response?.data?.message || e.message); mOk.value = false }
 mSaving.value = false
}
function routePricingSummary(line) {
 if (line.pricingMode === 'fixed') {
  const points = numberValue(line.pointsPerBlock, 1000)
  const tokens = Math.max(1, numberValue(line.tokensPerBlock, 20000))
  return `${formatNumber(points)} 积分 / ${formatNumber(tokens)} 模型用量，约 ${(points / tokens).toFixed(4)} 积分 / 单位用量`
 }
 const input = nullableNumber(line.inputRmbPerMillion)
 const output = nullableNumber(line.outputRmbPerMillion)
 if (input === null || output === null) return '请先填写供应商输入与输出原价，系统再按 8 倍成本换算积分。'
 return `每百万模型用量：输入 ${formatNumber(input * 8000)} 积分，输出 ${formatNumber(output * 8000)} 积分`
}
function restartServer() { if (confirm('确定重启服务？')) { api.post('/admin/restart').then(() => alert('重启命令已发送')).catch(() => alert('重启失败')) } }

// ====== 类型模板管理 ======
const templates = ref([])
const tplDirty = ref(false)
const tplSaving = ref(false)
const tplMsg = ref('')
const tplOk = ref(false)

async function loadTemplates() {
 try {
 const r = await api.get('/admin/templates')
 templates.value = (r.data.templates || []).map(t => ({
 ...t,
 keywordsStr: (t.keywords || []).join(', '),
 }))
 tplDirty.value = false
 } catch {}
}
function addTemplate() {
 templates.value.push({ name: '新模板', keywords: [], keywordsStr: '', contextPrompt: '' })
 tplDirty.value = true
}
function deleteTemplate(idx) {
 if (!confirm('删除 "' + templates.value[idx].name + '" ？')) return
 templates.value.splice(idx, 1)
 tplDirty.value = true
}
async function saveTemplates() {
 tplSaving.value = true; tplMsg.value = ''; tplOk.value = false
 try {
 const data = templates.value.map(t => ({
 name: t.name,
 keywords: t.keywordsStr.split(/[,，、]/).map(s => s.trim()).filter(Boolean),
 contextPrompt: t.contextPrompt || '',
 }))
 await api.put('/admin/templates', { templates: data })
 tplMsg.value = ' 模板已保存'
 tplOk.value = true; tplDirty.value = false
 } catch (e) {
 tplMsg.value = ' ' + (e.response?.data?.message || e.message)
 tplOk.value = false
 }
 tplSaving.value = false
}

function numberValue(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback }
function nullableNumber(value) { if (value === '' || value === null || value === undefined) return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null }
function formatNumber(value) { return numberValue(value, 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN') }
function compactNumber(value) { return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(numberValue(value, 0)) }
function userPoints(user) {
 const native = user?.points && (Number(user.points.version || 0) >= 1 || user.points.total !== undefined)
 const account = native ? user.points : (user?.tokens || {})
 const total = Math.max(0, numberValue(account.total, 0))
 const used = Math.min(total, Math.max(0, numberValue(account.used, 0)))
 const available = numberValue(user?.availablePoints, total - used)
 return { total, used, available: Math.max(0, available) }
}
function fmt(d) { if (!d) return ''; const date = new Date(d); return `${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}` }
function scoreClass(s) { if (!s) return ''; if (s >= 80) return 'high'; if (s >= 60) return 'mid'; return 'low' }
function wcRateClass(s) { if (!s?.totalChapters) return ''; const rate = s.downloadedChapters / s.totalChapters; if (rate >= 0.9) return 'rate-high'; if (rate >= 0.5) return 'rate-mid'; return 'rate-low' }

onMounted(() => {
 loadDash(); loadUsers(); loadNovels(); loadDistillations(); loadModels(); loadUsersSimple(); loadTemplates()
})

// ====== 积分活动 ======
const activities = ref([])
const activityTypeOptions = [
 { value:'login', label:'登录福利' }, { value:'checkin', label:'每日签到' },
 { value:'writing', label:'写作挑战' }, { value:'continuous', label:'连续创作' },
 { value:'invite', label:'邀请奖励' }, { value:'lottery', label:'幸运抽奖' },
 { value:'new_user', label:'新手任务' }, { value:'custom', label:'自定义活动' },
]
const difficultyOptions = [
 { value:'easy', label:'简单' }, { value:'medium', label:'中等' },
 { value:'hard', label:'困难' }, { value:'custom', label:'自定义' },
]
const metricOptions = [
 { value:'none', label:'无门槛' }, { value:'checkin_days', label:'签到天数' },
 { value:'invite_count', label:'邀请人数' }, { value:'novel_count', label:'小说数量' },
 { value:'chapter_count', label:'章节数量' }, { value:'word_count', label:'创作字数' },
 { value:'account_age_days', label:'注册天数' },
]

function toDateTimeLocal(value) {
 const date = value ? new Date(value) : new Date()
 if (Number.isNaN(date.getTime())) return ''
 const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
 return local.toISOString().slice(0, 16)
}
function defaultActivityForm() {
 const start = new Date(); start.setSeconds(0, 0)
 const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
 return {
  name:'', description:'', type:'checkin', startTime:toDateTimeLocal(start), endTime:toDateTimeLocal(end),
  rewardPoints:1000, minRewardPoints:1000, maxRewardPoints:1000, probability:100, difficulty:'easy',
  requirement:{ metric:'none', operator:'gte', threshold:0 },
  dailyLimit:1, perUserLimit:1, totalLimit:0, totalPointsBudget:0,
  enabled:true, autoClaim:false, emailContent:'',
 }
}
const acForm = ref(defaultActivityForm())
const editingActivityId = ref('')
const acSaving = ref(false)
const acMsg = ref('')
const acOk = ref(false)

async function loadActivities() {
 try { const r = await api.get('/admin/activities'); activities.value = r.data.activities || [] }
 catch { activities.value = [] }
}

function activityPayload(source = acForm.value) {
 const rewardPoints = Math.max(1, Math.floor(numberValue(source.rewardPoints, source.tokenAmount || 1)))
 const minRewardPoints = Math.max(1, Math.floor(numberValue(source.minRewardPoints, rewardPoints)))
 const maxRewardPoints = Math.max(minRewardPoints, Math.floor(numberValue(source.maxRewardPoints, rewardPoints)))
 const metric = source.requirement?.metric || 'none'
 return {
  name:String(source.name || '').trim(), description:String(source.description || '').trim(), type:source.type || 'custom',
  startTime:new Date(source.startTime).toISOString(), endTime:new Date(source.endTime).toISOString(),
  rewardPoints, minRewardPoints, maxRewardPoints, tokenAmount:rewardPoints,
  probability:Math.min(100, Math.max(0, numberValue(source.probability, 100))), difficulty:source.difficulty || 'easy',
  requirement:{ metric, operator:source.requirement?.operator || 'gte', threshold:metric === 'none' ? 0 : Math.max(0, numberValue(source.requirement?.threshold, 0)) },
  dailyLimit:Math.max(0, Math.floor(numberValue(source.dailyLimit, 0))),
  perUserLimit:Math.max(0, Math.floor(numberValue(source.perUserLimit, 0))),
  totalLimit:Math.max(0, Math.floor(numberValue(source.totalLimit, 0))),
  totalPointsBudget:Math.max(0, Math.floor(numberValue(source.totalPointsBudget, 0))),
  enabled:source.enabled !== false, autoClaim:Boolean(source.autoClaim), emailContent:String(source.emailContent || '').trim(),
 }
}
function validateActivity() {
 const form = acForm.value
 if (!form.name || !form.startTime || !form.endTime) return '请填写活动名称和有效时间'
 if (new Date(form.endTime) <= new Date(form.startTime)) return '结束时间必须晚于开始时间'
 if (numberValue(form.rewardPoints, 0) < 1 || numberValue(form.minRewardPoints, 0) < 1 || numberValue(form.maxRewardPoints, 0) < 1) return '奖励积分必须大于 0'
 if (numberValue(form.minRewardPoints, 0) > numberValue(form.maxRewardPoints, 0)) return '最低奖励不能大于最高奖励'
 if (numberValue(form.probability, -1) < 0 || numberValue(form.probability, 101) > 100) return '中奖概率应在 0 到 100 之间'
 return ''
}
async function saveActivity() {
 const validationMessage = validateActivity()
 if (validationMessage) { acMsg.value = validationMessage; acOk.value = false; return }
 acSaving.value = true; acMsg.value = ''
 try {
 const request = editingActivityId.value
  ? api.put(`/admin/activities/${editingActivityId.value}`, activityPayload())
  : api.post('/admin/activities', activityPayload())
 const { data } = await request
 acMsg.value = data.message || (editingActivityId.value ? '活动已更新' : '活动已创建'); acOk.value = true
 resetActivityForm(false)
 await loadActivities()
 } catch (e) {
 acMsg.value = e.response?.data?.message || '保存失败'
 acOk.value = false
 } finally {
 acSaving.value = false
 }
}

function resetActivityForm(clearMessage = true) {
 editingActivityId.value = ''
 acForm.value = defaultActivityForm()
 if (clearMessage) acMsg.value = ''
}
function editActivity(activity) {
 editingActivityId.value = activity._id
 const reward = numberValue(activity.rewardPoints, activity.tokenAmount || 1000)
 acForm.value = {
  name:activity.name || '', description:activity.description || '', type:activity.type || 'login',
  startTime:toDateTimeLocal(activity.startTime), endTime:toDateTimeLocal(activity.endTime),
  rewardPoints:reward, minRewardPoints:numberValue(activity.minRewardPoints, reward), maxRewardPoints:numberValue(activity.maxRewardPoints, reward),
  probability:numberValue(activity.probability, 100), difficulty:activity.difficulty || 'easy',
  requirement:{ metric:activity.requirement?.metric || 'none', operator:activity.requirement?.operator || 'gte', threshold:numberValue(activity.requirement?.threshold, 0) },
  dailyLimit:numberValue(activity.dailyLimit, 1), perUserLimit:numberValue(activity.perUserLimit, 1), totalLimit:numberValue(activity.totalLimit, 0),
  totalPointsBudget:numberValue(activity.totalPointsBudget, 0), enabled:activity.enabled !== false, autoClaim:Boolean(activity.autoClaim), emailContent:activity.emailContent || '',
 }
 acMsg.value = ''
 document.querySelector('.activity-editor')?.scrollIntoView({ behavior:'smooth', block:'start' })
}
async function toggleActivity(activity) {
 activity.toggling = true
 try {
  const payload = activityPayload({ ...activity, enabled:activity.enabled === false })
  await api.put(`/admin/activities/${activity._id}`, payload)
  await loadActivities()
 } catch (e) { alert('操作失败: ' + (e.response?.data?.message || e.message)) }
 finally { activity.toggling = false }
}
async function deleteActivity(activity) {
 if (!confirm(`确认删除积分活动“${activity.name}”？已有参与记录的活动将改为停用并保留审计数据。`)) return
 activity.deleting = true
 try {
  const { data } = await api.delete(`/admin/activities/${activity._id}`)
  if (editingActivityId.value === activity._id) resetActivityForm()
  await loadActivities()
  alert(data.message || '活动已删除')
 } catch (e) { alert('删除失败: ' + (e.response?.data?.message || e.message)) }
 finally { activity.deleting = false }
}

async function sendActivityEmail(act) {
 act.sending = true
 try {
 const r = await api.post(`/admin/activities/${act._id}/send-email`)
 act.emailSent = true
 act.sending = false
 alert(r.data.message || '发送完成')
 } catch (e) {
 act.sending = false
 alert('发送失败: ' + (e.response?.data?.message || e.message))
 }
}
function activityTypeLabel(value) { return activityTypeOptions.find(option => option.value === value)?.label || '自定义活动' }
function difficultyLabel(value) { return difficultyOptions.find(option => option.value === value)?.label || '自定义' }
function activityStatus(activity) {
 if (activity.enabled === false) return 'disabled'
 if (activity.status) return activity.status
 const nowTime = Date.now(); const start = new Date(activity.startTime).getTime(); const end = new Date(activity.endTime).getTime()
 return nowTime < start ? 'pending' : nowTime > end ? 'ended' : 'active'
}
function activityStatusLabel(activity) { return { active:'进行中', pending:'待开始', ended:'已结束', disabled:'已停用' }[activityStatus(activity)] || '未知状态' }
function rewardSummary(activity) {
 const base = numberValue(activity.rewardPoints, activity.tokenAmount || 0)
 const min = numberValue(activity.minRewardPoints, base); const max = numberValue(activity.maxRewardPoints, base)
 return min !== max ? `${formatNumber(min)} - ${formatNumber(max)}` : formatNumber(base || min)
}
function requirementSummary(requirement) {
 if (!requirement || requirement.metric === 'none') return '无参与门槛'
 const label = metricOptions.find(option => option.value === requirement.metric)?.label || '自定义指标'
 return `${label}${requirement.operator === 'lte' ? '不多于' : '不少于'} ${formatNumber(requirement.threshold)}`
}
function limitLabel(value) { return numberValue(value, 0) > 0 ? `${formatNumber(value)} 次` : '不限' }
function limitPointsLabel(value) { return numberValue(value, 0) > 0 ? `${formatNumber(value)} 积分` : '不限' }
</script>

<style scoped>
.grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.card {
 position: relative;
 min-width: 0;
 min-height: 118px;
 display: flex;
 flex-direction: column;
 align-items: center;
 justify-content: center;
 padding: 20px 14px;
 overflow: hidden;
 text-align: center;
 background: var(--surface);
 border: 1px solid var(--border);
 border-radius: 8px;
 box-shadow: var(--shadow-sm);
}
.card::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--forest-600); }
.card:nth-child(even)::before { background: var(--sun-500); }
.card .num { color: var(--forest-800); font-size: 28px; font-weight: 800; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.card:nth-child(even) .num { color: var(--sun-700); }
.card .lbl { margin-top: 5px; color: var(--text-muted); font-size: 12px; }
.card.accent { color: #fff; background: var(--forest-700); border-color: transparent; }
.card.accent:nth-child(even) { background: var(--sun-600); }
.card.accent::before { display: none; }
.card.accent .num, .card.accent .lbl { color: #fff; }
.update-time { margin-top: 12px; color: var(--text-muted); font-size: 12px; text-align: right; }

.search-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.search-bar .input {
 min-width: 0;
 min-height: 40px;
 flex: 1 1 220px;
 padding: 8px 12px;
 color: var(--text-strong);
 background: var(--surface);
 border: 1px solid var(--border);
 border-radius: 6px;
 font-size: 13px;
 outline: none;
}
.search-bar .input:focus { border-color: var(--forest-600); box-shadow: 0 0 0 3px rgba(63, 125, 90, 0.1); }
.filter-user { flex: 0 1 220px !important; }
.filter-status { flex: 0 1 150px !important; }

.table-wrap, .modal-table-wrap {
 max-width: 100%;
 overflow-x: auto;
 background: var(--surface);
 border: 1px solid var(--border);
 border-radius: 8px;
 box-shadow: var(--shadow-sm);
 -webkit-overflow-scrolling: touch;
 scrollbar-color: var(--forest-600) var(--forest-50);
}
table { width: 100%; min-width: 780px; border-collapse: collapse; color: var(--text); font-size: 13px; }
.modal-table-wrap { box-shadow: none; }
.modal-table-wrap table { min-width: 480px; }
th {
 padding: 12px;
 color: var(--forest-900);
 background: var(--forest-50);
 border-bottom: 1px solid var(--border);
 font-weight: 700;
 text-align: left;
 white-space: nowrap;
}
td { padding: 11px 12px; color: var(--text); border-bottom: 1px solid #edf2ee; white-space: nowrap; }
.points-cell { color: var(--forest-800); font-weight: 700; font-variant-numeric: tabular-nums; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: #f8fbf8; }
input[type='checkbox'] { accent-color: var(--forest-600); }
.acts { display: flex; flex-wrap: wrap; gap: 5px; }

.btn-sm, .btn {
 border-radius: 6px;
 cursor: pointer;
 white-space: nowrap;
 transition: color 0.16s ease, border-color 0.16s ease, background 0.16s ease, transform 0.16s ease;
}
.btn-sm {
 min-height: 32px;
 padding: 5px 11px;
 color: var(--text);
 background: var(--surface);
 border: 1px solid var(--border);
 font-size: 12px;
}
.btn-sm:hover { color: var(--forest-800); background: var(--forest-50); border-color: var(--forest-600); }
.btn-sm:active:not(:disabled), .btn:active:not(:disabled) { transform: translateY(1px); }
.btn-sm:disabled, .btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
.btn-sm.red { color: var(--danger); border-color: #e3aaa6; }
.btn-sm.red:hover { color: #a93d39; background: var(--danger-soft); border-color: var(--danger); }
.btn-sm.green, .btn-success { color: var(--forest-700); border-color: #9cc4aa; }
.btn-sm.green:hover, .btn-success:hover { color: var(--forest-900); background: var(--forest-100); border-color: var(--forest-600); }
.btn-gift, .btn-export, .btn-mail, .btn-add {
 color: #fff;
 background: var(--sun-600);
 border-color: var(--sun-600);
}
.btn-gift:hover, .btn-export:hover, .btn-mail:hover, .btn-add:hover { color: #fff; background: var(--sun-700); border-color: var(--sun-700); }
.btn-invite { color: var(--sun-700); border-color: #efbd89; }
.btn-invite:hover { color: #9d5319; background: var(--sun-100); border-color: var(--sun-600); }
.btn-save { color: #fff; background: var(--forest-700); border-color: var(--forest-700); }
.btn-save:hover { color: #fff; background: var(--forest-800); border-color: var(--forest-800); }

.badge, .sb, .score {
 display: inline-block;
 padding: 3px 8px;
 border-radius: 4px;
 font-size: 11px;
 font-weight: 700;
}
.badge.admin, .badge.pending { color: var(--sun-700); background: var(--sun-100); }
.badge.user, .badge.importer, .badge.active { color: var(--forest-800); background: var(--forest-100); }
.badge.ended, .badge.disabled { color: var(--text-muted); background: #edf1ee; }
.claimed-badge { color: var(--forest-700); font-size: 12px; font-weight: 600; }
.dot { display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; background: var(--forest-600); }
.dot.off { background: #a5afa8; }
.sb.generating { color: var(--forest-800); background: var(--forest-100); }
.sb.paused { color: var(--sun-700); background: var(--sun-100); }
.sb.completed { color: #2c6b49; background: #e2f2e7; }
.sb.error, .score.low { color: var(--danger); background: var(--danger-soft); }
.score.high { color: var(--forest-800); background: var(--forest-100); }
.score.mid { color: var(--sun-700); background: var(--sun-100); }

.overlay {
 position: fixed;
 inset: 0;
 z-index: 1000;
 display: flex;
 align-items: center;
 justify-content: center;
 padding: 20px;
 background: rgba(23, 52, 38, 0.48);
}
.modal {
 width: min(100%, 420px);
 max-height: calc(100vh - 40px);
 max-height: calc(100dvh - 40px);
 overflow-y: auto;
 padding: 24px;
 background: var(--surface);
 border: 1px solid var(--border);
 border-top: 4px solid var(--sun-500);
 border-radius: 8px;
 box-shadow: 0 20px 50px rgba(23, 52, 38, 0.24);
}
.modal h3 { margin-bottom: 18px; color: var(--text-strong); font-size: 17px; overflow-wrap: anywhere; }
.row { display: flex; align-items: center; gap: 10px; margin-bottom: 13px; }
.row label { width: 90px; flex: 0 0 90px; color: var(--text); font-size: 13px; font-weight: 600; }
.row > span { min-width: 0; overflow-wrap: anywhere; }
.row .input, .row select {
 min-width: 0;
 min-height: 40px;
 flex: 1;
 padding: 8px 11px;
 color: var(--text-strong);
 background: #fbfdfb;
 border: 1px solid var(--border);
 border-radius: 6px;
 font-size: 13px;
 outline: none;
}
.row .input:focus, .row select:focus, .textarea:focus { background: #fff; border-color: var(--forest-600); box-shadow: 0 0 0 3px rgba(63, 125, 90, 0.1); }
.modal-acts { display: flex; gap: 8px; margin-top: 18px; }
.modal-acts button { min-height: 40px; flex: 1; }
.btn { min-height: 40px; padding: 8px 18px; border: 1px solid transparent; font-size: 14px; font-weight: 700; }
.btn-primary { color: #fff; background: var(--forest-700); }
.btn-primary:hover { background: var(--forest-800); }
.btn-outline { color: var(--text); background: var(--surface); border-color: var(--border); }
.btn-outline:hover { color: var(--forest-800); background: var(--forest-50); border-color: var(--forest-600); }
.red-btn { color: #fff; background: var(--danger); }
.red-btn:hover { background: #ad3f3a; }

.wc-cell { display: flex; flex-direction: column; gap: 2px; }
.wc-num { font-weight: 700; font-variant-numeric: tabular-nums; }
.wc-detail { font-size: 11px; white-space: nowrap; }
.wc-detail.rate-high { color: var(--forest-700); }
.wc-detail.rate-mid { color: var(--sun-700); }
.wc-detail.rate-low { color: var(--danger); }

.form-card {
 width: min(100%, 620px);
 padding: 24px;
 background: var(--surface);
 border: 1px solid var(--border);
 border-radius: 8px;
 box-shadow: var(--shadow-sm);
}
.form-title, .section-title { color: var(--text-strong); font-size: 17px; }
.form-title { margin: 0 0 18px; }
.section-title { margin-bottom: 12px; }
.form-card .row { margin-bottom: 16px; }
.secondary-form-card { margin-top: 12px; }
.form-help { margin-top: 8px; color: var(--text-muted); font-size: 12px; }
.msg { margin-top: 10px; color: var(--danger); font-size: 13px; }
.msg.ok { color: var(--forest-700); }
.inline-msg { margin: 0; }
.unsaved-hint { color: var(--sun-700); font-size: 12px; font-weight: 600; }
.d-json-modal { max-width: 700px; }
.json-view {
 max-height: 420px;
 overflow: auto;
 padding: 14px;
 color: #eaf4ed;
 background: var(--forest-950);
 border-radius: 6px;
 font-family: Consolas, monospace;
 font-size: 12px;
 line-height: 1.55;
 white-space: pre-wrap;
 overflow-wrap: anywhere;
}
.textarea {
 width: 100%;
 padding: 9px 11px;
 color: var(--text-strong);
 background: #fbfdfb;
 border: 1px solid var(--border);
 border-radius: 6px;
 font-family: Consolas, monospace;
 font-size: 13px;
 line-height: 1.55;
 outline: none;
 resize: vertical;
}

.activity-editor {
 max-width: 1040px;
 padding: 24px;
 background: var(--surface);
 border: 1px solid var(--border);
 border-top: 4px solid var(--forest-600);
 border-radius: 8px;
 box-shadow: var(--shadow-sm);
}
.editor-heading, .model-page-heading {
 display: flex;
 align-items: flex-start;
 justify-content: space-between;
 gap: 20px;
 margin-bottom: 20px;
}
.editor-heading .form-title { margin-bottom: 5px; }
.editor-heading p, .model-page-heading p { margin: 0; color: var(--text-muted); font-size: 13px; line-height: 1.6; }
.field-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.field { min-width: 0; }
.field.span-2 { grid-column: span 2; }
.field label { display: block; margin-bottom: 6px; color: var(--text); font-size: 12px; font-weight: 700; }
.field small { display: block; margin-top: 4px; color: var(--text-muted); font-size: 11px; }
.field .input {
 width: 100%;
 min-height: 40px;
 padding: 8px 11px;
 color: var(--text-strong);
 background: #fbfdfb;
 border: 1px solid var(--border);
 border-radius: 6px;
 font-size: 13px;
 outline: none;
}
.field .input:focus { background: #fff; border-color: var(--forest-600); box-shadow: 0 0 0 3px rgba(63, 125, 90, 0.1); }
.field .input:disabled { color: var(--text-muted); background: #f1f4f2; cursor: not-allowed; }
.activity-basics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.rule-section { margin-top: 20px; padding-top: 18px; border-top: 1px solid #e5ece7; }
.rule-section h4 { margin: 0 0 12px; color: var(--forest-900); font-size: 13px; }
.requirement-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.activity-switches { display: flex; flex-wrap: wrap; gap: 20px; }
.switch-field { display: inline-flex; align-items: center; gap: 8px; color: var(--text); font-size: 13px; font-weight: 700; cursor: pointer; }
.switch-field input { width: 17px; height: 17px; margin: 0; }
.email-field { margin-top: 18px; }
.editor-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.editor-actions .btn { min-width: 116px; }

.activity-list { margin-top: 18px; }
.act-card { margin-bottom: 10px; padding: 18px; background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--sun-500); border-radius: 8px; }
.act-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.act-head strong { color: var(--text-strong); }
.activity-type { margin-left: 8px; color: var(--text-muted); font-size: 12px; }
.activity-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.act-description { margin: 9px 0 0; color: var(--text-muted); font-size: 13px; line-height: 1.6; }
.act-metrics { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.act-metrics span { padding: 5px 8px; color: var(--forest-800); background: var(--forest-50); border-radius: 4px; font-size: 12px; }
.act-detail { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 10px; color: var(--text-muted); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.empty-state { padding: 40px 16px; color: var(--text-muted); text-align: center; }

.model-page-heading { max-width: 1040px; }
.model-page-heading h3 { margin: 0 0 5px; color: var(--text-strong); font-size: 18px; }
.pricing-note { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px 12px; max-width: 380px; padding: 10px 12px; color: var(--sun-700); background: var(--sun-100); border-radius: 6px; font-size: 12px; }
.pricing-note strong { width: 100%; color: var(--text-strong); }
.route-list { max-width: 1040px; display: flex; flex-direction: column; gap: 12px; }
.route-card { padding: 18px; background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--forest-600); border-radius: 8px; box-shadow: var(--shadow-sm); }
.route-card:nth-child(4), .route-card:nth-child(5) { border-left-color: var(--sun-500); }
.route-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 15px; }
.route-head > div { min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.route-head strong { color: var(--text-strong); font-size: 15px; }
.route-head code { padding: 2px 6px; color: var(--text-muted); background: #edf2ee; border-radius: 4px; font-size: 11px; }
.route-index { width: 24px; height: 24px; display: grid; place-items: center; color: #fff; background: var(--forest-700); border-radius: 4px; font-size: 12px; font-weight: 800; }
.pricing-badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; white-space: nowrap; }
.pricing-badge.fixed { color: var(--forest-800); background: var(--forest-100); }
.pricing-badge.cost { color: var(--sun-700); background: var(--sun-100); }
.route-fields { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.route-summary { margin-top: 12px; padding-top: 10px; color: var(--text-muted); border-top: 1px solid #e5ece7; font-size: 12px; }
.model-actions { max-width: 1040px; display: flex; align-items: center; gap: 14px; margin-top: 16px; }
.secondary-form-card { max-width: 1040px; }

.template-actions { margin-bottom: 12px; }
.tpl-list { display: flex; flex-direction: column; gap: 10px; }
.tpl-card { padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow-sm); }
.tpl-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.tpl-name { min-width: 0; color: var(--text-strong); font-size: 15px; font-weight: 700; overflow-wrap: anywhere; }
.tpl-kw-count { margin-left: 8px; color: var(--text-muted); font-size: 11px; font-weight: 400; white-space: nowrap; }
.tpl-field { margin-bottom: 10px; }
.tpl-field:last-child { margin-bottom: 0; }
.tpl-label { display: block; margin-bottom: 5px; color: var(--text); font-size: 12px; font-weight: 600; }
.tpl-input, .tpl-textarea { width: 100%; box-sizing: border-box; padding: 9px 11px; color: var(--text-strong); background: #fbfdfb; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; outline: none; }
.tpl-input:focus, .tpl-textarea:focus { background: #fff; border-color: var(--forest-600); box-shadow: 0 0 0 3px rgba(63, 125, 90, 0.1); }
.tpl-textarea { font-family: inherit; line-height: 1.55; resize: vertical; }

@media (max-width: 1100px) {
 .grid-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
 .field-grid, .activity-basics, .route-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
 .requirement-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 600px) {
 .grid-4 { gap: 8px; }
 .card { min-height: 104px; padding: 15px 9px; }
 .card .num { font-size: 23px; }
 .card .lbl { font-size: 11px; }
 .update-time { text-align: center; }
 .search-bar { align-items: stretch; }
 .search-bar > .input, .search-bar > button { width: 100% !important; max-width: none !important; flex-basis: 100% !important; }
 table { min-width: 720px; }
 .table-wrap { width: 100%; }
 .overlay { align-items: flex-end; padding: 0; }
 .modal {
  width: 100% !important;
  max-width: none !important;
  max-height: 92vh;
  max-height: 92dvh;
  padding: 20px 16px max(20px, env(safe-area-inset-bottom));
  border-radius: 8px 8px 0 0;
 }
 .modal h3 { font-size: 16px; }
 .row { align-items: stretch; flex-direction: column; gap: 6px; }
 .row label { width: auto; flex-basis: auto; }
 .row .input, .row select { width: 100%; flex: none; }
 .modal-table-wrap table { min-width: 460px; }
 .form-card, .activity-editor, .route-card { padding: 18px 16px; }
 .act-head { align-items: flex-start; flex-direction: column; gap: 10px; }
 .act-head > div:last-child { width: 100%; }
 .activity-actions { justify-content: flex-start; }
 .editor-heading, .model-page-heading { flex-direction: column; gap: 10px; }
 .editor-heading > .btn-sm { width: 100%; }
 .field-grid, .activity-basics, .requirement-grid, .route-fields { grid-template-columns: 1fr; }
 .field.span-2 { grid-column: auto; }
 .activity-switches { align-items: flex-start; flex-direction: column; gap: 12px; }
 .editor-actions { flex-direction: column-reverse; }
 .editor-actions .btn { width: 100%; }
 .activity-type { display: block; margin: 6px 0 0; }
 .act-metrics { align-items: stretch; flex-direction: column; }
 .act-metrics span { width: 100%; }
 .pricing-note { width: 100%; max-width: none; justify-content: flex-start; }
 .route-head { align-items: flex-start; }
 .model-actions { align-items: stretch; flex-direction: column; }
 .model-actions .btn { width: 100%; }
 .tpl-header { align-items: flex-start; }
 .tpl-kw-count { display: block; margin: 3px 0 0; }
 .template-actions .unsaved-hint, .template-actions .inline-msg { width: 100%; }
}

@media (max-width: 360px) {
 .grid-4 { grid-template-columns: 1fr; }
}
</style>
