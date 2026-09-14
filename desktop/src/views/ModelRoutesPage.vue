<template>
  <div class="model-page">
    <!-- 概览：当前真正在用的线路 -->
    <section class="panel">
      <div class="panel-head">
        <h2>{{ $t('desktop.models.title') }}</h2>
        <span class="source-tag" :class="sourceClass">{{ sourceLabel }}</span>
      </div>
      <p class="panel-desc">
        {{ $t('desktop.models.desc1') }}<strong>{{ $t('desktop.models.descBold1') }}</strong>{{ $t('desktop.models.desc2') }}<strong>{{ $t('desktop.models.descBold2') }}</strong>{{ $t('desktop.models.desc3') }}<strong>{{ $t('desktop.models.descBold3') }}</strong>{{ $t('desktop.models.desc4') }}<strong>{{ $t('desktop.models.descBold4') }}</strong>{{ $t('desktop.models.desc5') }}
      </p>
      <div v-if="routes.length" class="current">
        <div class="current-row">
          <span>{{ $t('desktop.models.defaultRoute') }}</span>
          <code>{{ routeNameById(propsForm.defaultRouteId) || $t('desktop.models.notSet') }}</code>
        </div>
        <div v-for="role in roles" :key="role.key" class="current-row">
          <span>{{ $t(role.shortKey) }}</span>
          <code>{{ taskSummary(role.key) }}</code>
        </div>
      </div>
      <p v-else class="empty-hint">{{ $t('desktop.models.noRoutesHint') }}</p>
    </section>

    <!-- 线路列表 -->
    <section class="panel">
      <div class="panel-head">
        <h2>{{ $t('desktop.models.myRoutes') }}</h2>
        <button class="btn btn-sm" type="button" :disabled="routes.length >= MAX_ROUTES" @click="addRoute">
          {{ routes.length >= MAX_ROUTES ? $t('desktop.models.maxRoutes', { n: MAX_ROUTES }) : $t('desktop.models.addRoute') }}
        </button>
      </div>

      <p v-if="!routes.length" class="empty-hint">{{ $t('desktop.models.emptyRoutes') }}</p>

      <div v-for="(route, index) in routes" :key="route.id" class="route-card">
        <div class="route-head">
          <label class="route-name-field">
            <span class="label-sm">{{ $t('desktop.models.routeNameLabel') }}</span>
            <input v-model.trim="route.name" class="input" :placeholder="$t('desktop.models.routeNamePlaceholder')" spellcheck="false" />
          </label>
          <div class="route-head-actions">
            <span v-if="route.id === propsForm.defaultRouteId" class="default-tag">{{ $t('desktop.models.defaultTag') }}</span>
            <button v-else class="btn btn-sm" type="button" @click="setDefault(route.id)">{{ $t('desktop.models.setDefault') }}</button>
            <button class="btn btn-sm" type="button" :disabled="testingId === route.id" @click="testRoute(route)">
              {{ testingId === route.id ? $t('desktop.models.testing') : $t('desktop.models.test') }}
            </button>
            <button class="btn btn-sm btn-danger" type="button" @click="removeRoute(index)">{{ $t('desktop.models.remove') }}</button>
          </div>
        </div>

        <div class="route-grid">
          <label class="field">
            <span class="label">{{ $t('desktop.models.baseUrl') }}</span>
            <input v-model.trim="route.baseUrl" class="input" placeholder="https://api.example.com/v1" spellcheck="false" />
          </label>
          <label class="field">
            <span class="label">{{ $t('desktop.models.apiKeyLabel') }}</span>
            <div class="key-row">
              <input
                v-model.trim="route.apiKey"
                class="input"
                :type="showKey[route.id] ? 'text' : 'password'"
                placeholder="sk-..."
                spellcheck="false"
              />
              <button class="btn btn-sm" type="button" @click="toggleKey(route.id)">
                {{ showKey[route.id] ? $t('desktop.models.hide') : $t('desktop.models.show') }}
              </button>
            </div>
          </label>
        </div>

        <div class="field">
          <span class="label">{{ $t('desktop.models.routeModels') }}</span>
          <div class="roles">
            <label v-for="role in roles" :key="role.key" class="role-row">
              <span class="role-name">
                {{ $t(role.labelKey) }}
                <em v-if="role.key === 'writing'" class="req">{{ $t('desktop.models.required') }}</em>
              </span>
              <input
                v-model.trim="route.models[role.key]"
                class="input"
                :placeholder="role.key === 'writing' ? $t('desktop.models.placeholderWriting') : $t('desktop.models.placeholderOther')"
                spellcheck="false"
              />
            </label>
          </div>
        </div>

        <p v-if="testResults[route.id]" class="msg inline" :class="{ error: !testResults[route.id].ok }">
          {{ testResults[route.id].ok ? $t('desktop.models.testOk') : $t('desktop.models.testFail') }}：{{ testResults[route.id].message }}
          <span v-if="testResults[route.id].latencyMs">（{{ testResults[route.id].latencyMs }} ms）</span>
        </p>
      </div>
    </section>

    <!-- 任务分配 + 保存 -->
    <section class="panel">
      <div class="panel-head"><h2>{{ $t('desktop.models.taskTitle') }}</h2></div>
      <p class="panel-desc">{{ $t('desktop.models.taskDesc') }}</p>

      <label class="field">
        <span class="label">{{ $t('desktop.models.defaultRoute') }}</span>
        <select v-model="propsForm.defaultRouteId" class="input select" :disabled="!routes.length">
          <option v-for="route in routes" :key="route.id" :value="route.id">{{ routeName(route) }}</option>
        </select>
      </label>

      <div class="roles">
        <label v-for="role in roles" :key="role.key" class="role-row">
          <span class="role-name">{{ $t(role.labelKey) }}</span>
          <select v-model="propsForm.taskRoutes[role.key]" class="input select" :disabled="!routes.length">
            <option value="">{{ $t('desktop.models.followDefault', { name: routeNameById(propsForm.defaultRouteId) || $t('desktop.models.notSet') }) }}</option>
            <option v-for="route in routes" :key="route.id" :value="route.id">{{ routeName(route) }}</option>
          </select>
        </label>
      </div>

      <div class="actions">
        <button class="btn btn-primary" :disabled="saving" @click="saveLocal">{{ saving ? $t('desktop.models.saving') : $t('desktop.models.saveLocal') }}</button>
        <button class="btn" :disabled="syncing || !routes.length" @click="syncDefaultToAccount">
          {{ syncing ? $t('desktop.models.syncing') : $t('desktop.models.syncAccount') }}
        </button>
        <button v-if="hasLocal" class="btn" @click="removeLocal">{{ $t('desktop.models.clearLocal') }}</button>
        <span v-if="dirty" class="dirty-hint">{{ $t('desktop.models.dirty') }}</span>
      </div>

      <p class="hint">
        {{ $t('desktop.models.syncHintBefore') }}<strong>{{ $t('desktop.models.syncHintBold') }}</strong>{{ $t('desktop.models.syncHintAfter') }}
      </p>

      <p v-if="message" class="msg" :class="{ error: messageIsError }">{{ message }}</p>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import api from '@client/api'
import { useI18n } from '@client/composables/useI18n'
import { createRoute, MODEL_ROLE_KEYS } from '@client/utils/modelOverride'
import { useModelConfig } from '../composables/useModelConfig'

const MAX_ROUTES = 6

const { $t } = useI18n()
const { localConfig, hasLocal, saveConfig, clearLocal } = useModelConfig()

// labelKey 用于表单与任务分配（较长），shortKey 用于概览行（较短）
const roles = [
  { key: 'writing', labelKey: 'desktop.models.roleWriting', shortKey: 'desktop.models.shortWriting', required: true },
  { key: 'outline', labelKey: 'desktop.models.roleOutline', shortKey: 'desktop.models.shortOutline' },
  { key: 'reasoning', labelKey: 'desktop.models.roleReasoning', shortKey: 'desktop.models.shortReasoning' },
  { key: 'polish', labelKey: 'desktop.models.rolePolish', shortKey: 'desktop.models.shortPolish' },
]

const ROLE_KEYS = MODEL_ROLE_KEYS

const routes = ref([])
const propsForm = reactive({
  defaultRouteId: '',
  taskRoutes: { outline: '', writing: '', reasoning: '', polish: '' },
})

const showKey = ref({})
const testingId = ref('')
const testResults = ref({})
const saving = ref(false)
const syncing = ref(false)
const message = ref('')
const messageIsError = ref(false)
const dirty = ref(false)
const accountConfig = ref(null)

const sourceLabel = computed(() => {
  if (hasLocal.value) return $t('desktop.models.sourceLocal')
  if (accountConfig.value?.baseUrl || accountConfig.value?.apiKeyConfigured) return $t('desktop.models.sourceAccount')
  return $t('desktop.models.sourceNone')
})
const sourceClass = computed(() => (hasLocal.value ? 'local' : accountConfig.value?.baseUrl ? 'account' : 'none'))

function routeName(route) {
  return route.name || route.models?.writing || $t('desktop.models.untitledRoute')
}

function routeNameById(id) {
  const route = routes.value.find((item) => item.id === id)
  return route ? routeName(route) : ''
}

/** 某任务最终走哪条线路 + 用哪个模型，用于概览展示 */
function taskSummary(roleKey) {
  const wanted = propsForm.taskRoutes[roleKey]
  const route = routes.value.find((item) => item.id === wanted)
    || routes.value.find((item) => item.id === propsForm.defaultRouteId)
    || routes.value[0]
  if (!route) return $t('desktop.models.notConfigured')
  const model = route.models?.[roleKey] || route.models?.writing || $t('desktop.models.noModel')
  return `${routeName(route)} · ${model}`
}

function loadFromConfig() {
  const config = localConfig.value
  if (!config?.routes?.length) return false
  routes.value = config.routes.map((route) => createRoute(route))
  propsForm.defaultRouteId = config.defaultRouteId || routes.value[0].id
  for (const key of ROLE_KEYS) propsForm.taskRoutes[key] = config.taskRoutes?.[key] || ''
  return true
}

async function loadAccountConfig() {
  try {
    const response = await api.get('/auth/model-config')
    const config = response.data?.modelConfig
    if (config?.provider !== 'cloud') return
    accountConfig.value = config
    // 本机还没配置时，用账号里的那份生成一条线路，省去用户重新填写
    if (!routes.value.length && config.baseUrl) {
      const route = createRoute({
        id: 'r-account',
        name: config.models?.writing || config.baseUrl,
        baseUrl: config.baseUrl,
        apiKey: '',
        models: config.models,
      })
      routes.value = [route]
      propsForm.defaultRouteId = route.id
    }
  } catch { /* 未登录或接口异常时不影响本机配置使用 */ }
}

function addRoute() {
  if (routes.value.length >= MAX_ROUTES) return
  const route = createRoute()
  routes.value.push(route)
  if (!propsForm.defaultRouteId) propsForm.defaultRouteId = route.id
  dirty.value = true
}

function removeRoute(index) {
  const [removed] = routes.value.splice(index, 1)
  if (!removed) return
  // 默认线路/任务分配指向被删线路时，回落到第一条，避免留下悬空引用
  if (propsForm.defaultRouteId === removed.id) propsForm.defaultRouteId = routes.value[0]?.id || ''
  for (const key of ROLE_KEYS) {
    if (propsForm.taskRoutes[key] === removed.id) propsForm.taskRoutes[key] = ''
  }
  delete testResults.value[removed.id]
  dirty.value = true
}

function setDefault(routeId) {
  propsForm.defaultRouteId = routeId
  dirty.value = true
}

function toggleKey(routeId) {
  showKey.value = { ...showKey.value, [routeId]: !showKey.value[routeId] }
}

/** 汇总校验：返回错误信息数组（空数组表示通过） */
function validate() {
  const errors = []
  if (!routes.value.length) errors.push($t('desktop.models.errNoRoute'))
  routes.value.forEach((route, index) => {
    const name = routeName(route)
    const position = index + 1
    if (!route.baseUrl) {
      errors.push($t('desktop.models.errMissingBaseUrl', { n: position, name }))
    } else {
      try {
        const url = new URL(route.baseUrl)
        if (!['http:', 'https:'].includes(url.protocol)) {
          errors.push($t('desktop.models.errBadProtocol', { n: position, name }))
        }
      } catch {
        errors.push($t('desktop.models.errBadUrl', { n: position, name }))
      }
    }
    if (!route.models.writing) errors.push($t('desktop.models.errMissingWriting', { n: position, name }))
  })
  return errors
}

function saveLocal() {
  message.value = ''
  const errors = validate()
  if (errors.length) {
    message.value = errors[0]
    messageIsError.value = true
    return
  }
  saving.value = true
  try {
    const saved = saveConfig({
      version: 2,
      routes: routes.value,
      defaultRouteId: propsForm.defaultRouteId,
      taskRoutes: { ...propsForm.taskRoutes },
    })
    if (!saved) {
      message.value = $t('desktop.models.errIncomplete')
      messageIsError.value = true
      return
    }
    // 落盘后以归一化结果回填，避免界面显示与存储不一致（如被裁剪的线路/悬空的任务分配）
    loadFromConfig()
    dirty.value = false
    message.value = $t('desktop.models.savedLocal', { n: saved.routes.length })
    messageIsError.value = false
  } finally {
    saving.value = false
  }
}

async function testRoute(route) {
  message.value = ''
  testResults.value = { ...testResults.value, [route.id]: null }
  if (!route.baseUrl || !route.models.writing) {
    testResults.value = {
      ...testResults.value,
      [route.id]: { ok: false, message: $t('desktop.models.errNeedBaseAndModel'), latencyMs: 0 },
    }
    return
  }
  testingId.value = route.id
  try {
    const response = await api.post('/auth/model-config/verify', {
      baseUrl: route.baseUrl,
      apiKey: route.apiKey,
      model: route.models.writing,
    })
    testResults.value = { ...testResults.value, [route.id]: response.data }
  } catch (error) {
    testResults.value = {
      ...testResults.value,
      [route.id]: { ok: false, message: error.response?.data?.message || error.message, latencyMs: 0 },
    }
  } finally {
    testingId.value = ''
  }
}

/** 把默认线路同步到账号（服务端账号线路目前只支持一条，其余线路保持本机） */
async function syncDefaultToAccount() {
  message.value = ''
  const route = routes.value.find((item) => item.id === propsForm.defaultRouteId) || routes.value[0]
  if (!route) return
  const errors = validate()
  if (errors.length) {
    message.value = errors[0]
    messageIsError.value = true
    return
  }
  syncing.value = true
  try {
    await api.put('/auth/model-config', {
      provider: 'cloud',
      cloudBaseUrl: route.baseUrl,
      cloudApiKey: route.apiKey,
      cloudWritingModel: route.models.writing,
      cloudOutlineModel: route.models.outline,
      cloudReasoningModel: route.models.reasoning,
      cloudPolishModel: route.models.polish,
    })
    message.value = $t('desktop.models.syncedAccount', { name: routeName(route) })
    messageIsError.value = false
  } catch (error) {
    message.value = error.response?.data?.message || error.message
    messageIsError.value = true
  } finally {
    syncing.value = false
  }
}

function removeLocal() {
  clearLocal()
  routes.value = []
  propsForm.defaultRouteId = ''
  for (const key of ROLE_KEYS) propsForm.taskRoutes[key] = ''
  testResults.value = {}
  dirty.value = false
  message.value = $t('desktop.models.clearedLocal')
  messageIsError.value = false
}

onMounted(async () => {
  const hadLocal = loadFromConfig()
  await loadAccountConfig()
  if (!hadLocal && routes.value.length && !propsForm.defaultRouteId) {
    propsForm.defaultRouteId = routes.value[0].id
  }
})
</script>

<style scoped>
.model-page { display: flex; flex-direction: column; gap: 16px; }
.panel {
  background: var(--card);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--card-shadow);
  padding: 18px 20px;
}
.panel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.panel-head h2 { font-size: 15px; }
.panel-head .btn { margin-left: auto; }
.panel-desc { color: var(--text-secondary); font-size: 12.5px; line-height: 1.7; margin-bottom: 12px; }
.source-tag { margin-left: auto; padding: 3px 10px; border-radius: 999px; font-size: 11.5px; }
.source-tag.local { background: var(--success-bg); color: var(--success); border: 1px solid var(--success-border); }
.source-tag.account { background: var(--info-bg); color: var(--info); border: 1px solid var(--info-border); }
.source-tag.none { background: var(--bg-alt); color: var(--text-tertiary); }
.panel-head .source-tag { margin-left: auto; }

.empty-hint { color: var(--text-tertiary); font-size: 12.5px; }
.current { display: flex; flex-direction: column; gap: 6px; }
.current-row { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
.current-row > span { width: 72px; flex: 0 0 72px; color: var(--text-tertiary); }
.current-row code { font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary); }

.route-card {
  border: 1px solid var(--card-border); border-radius: var(--radius-lg);
  padding: 14px 16px; margin-bottom: 12px; background: var(--bg-alt);
}
.route-head { display: flex; align-items: flex-end; gap: 12px; margin-bottom: 12px; }
.route-name-field { flex: 1; min-width: 0; }
.route-head-actions { display: flex; align-items: center; gap: 8px; }
.default-tag {
  padding: 2px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 600;
  background: var(--primary-light); color: var(--primary);
}
.route-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.field { display: block; margin-bottom: 14px; }
.label { display: block; margin-bottom: 6px; color: var(--text-secondary); font-size: 12.5px; }
.label-sm { display: block; margin-bottom: 6px; color: var(--text-secondary); font-size: 11.5px; }
.input {
  width: 100%; padding: 9px 11px;
  border: 1px solid var(--card-border); border-radius: var(--radius);
  background: var(--card); font-family: inherit; font-size: 13px; color: var(--text);
}
.select { cursor: pointer; }
.key-row { display: flex; gap: 8px; }
.key-row .input { flex: 1; }
.roles { display: flex; flex-direction: column; gap: 8px; }
.role-row { display: flex; align-items: center; gap: 12px; }
.role-name { width: 170px; flex: 0 0 170px; color: var(--text-secondary); font-size: 12.5px; }
.role-row .input { flex: 1; }
.req { margin-left: 6px; color: var(--accent); font-size: 11px; font-style: normal; }
.hint { display: block; margin-top: 10px; color: var(--text-tertiary); font-size: 11.5px; line-height: 1.7; }

.actions { display: flex; gap: 10px; align-items: center; margin-top: 6px; }
.btn {
  padding: 8px 14px; border: 1px solid var(--card-border); border-radius: var(--radius);
  background: var(--card); color: var(--text); font-family: inherit; font-size: 13px; cursor: pointer;
}
.btn:hover { background: var(--bg-alt); }
.btn-sm { padding: 6px 10px; font-size: 12px; white-space: nowrap; }
.btn-primary { background: var(--primary); border-color: var(--primary); color: #fff; font-weight: 600; }
.btn-primary:hover { background: var(--primary-hover); }
.btn-danger:hover { color: var(--error); border-color: var(--error); }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.dirty-hint { color: var(--accent); font-size: 12px; }
.msg { margin-top: 12px; font-size: 12.5px; color: var(--success); }
.msg.inline { margin-top: 8px; }
.msg.error { color: var(--error); }

@media (max-width: 900px) {
  .route-grid { grid-template-columns: 1fr; }
  .route-head { flex-direction: column; align-items: stretch; }
}
</style>
