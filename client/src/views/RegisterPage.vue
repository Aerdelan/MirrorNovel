<template>
  <div class="register-page">
    <div class="auth-container">
      <div class="auth-header">
        <div class="auth-icon">📚</div>
        <h1>{{ $t('auth.register') }}</h1>
        <p>创建你的{{ $t('app.title') }}账号</p>
      </div>
      <div class="card auth-form">
        <div class="form-group">
          <label>{{ $t('auth.email') }}</label>
          <input v-model="email" class="input" type="email" :placeholder="$t('auth.placeholderEmail')" />
        </div>
        <div class="form-group">
          <label>{{ $t('auth.nickname') }}（{{ $t('common.no') }}选）</label>
          <input v-model="nickname" class="input" :placeholder="$t('auth.placeholderNick')" maxlength="20" />
        </div>
        <div class="form-group">
          <label>{{ $t('auth.password') }}</label>
          <input v-model="password" class="input" type="password" :placeholder="$t('auth.placeholderPwdConfirm')" />
        </div>
        <div class="form-group">
          <label>确认{{ $t('auth.password') }}</label>
          <input v-model="confirmPassword" class="input" type="password" placeholder="再次输入密码" />
        </div>
        <div class="form-group">
          <label>{{ $t('auth.verifyCode') }}</label>
          <div class="code-row">
            <input v-model="code" class="input" :placeholder="$t('auth.placeholderCode')" maxlength="6" />
            <button class="btn btn-outline btn-sm code-btn" :disabled="codeSending || codeCountdown > 0" @click="sendCode">
              {{ codeCountdown > 0 ? `${codeCountdown}s` : (codeSending ? $t('auth.sending') : $t('auth.getCode')) }}
            </button>
          </div>
        </div>
        <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>
        <button class="btn btn-primary btn-block" @click="handleRegister" :disabled="loading">
          <span v-if="loading" class="loading-spinner"></span>
          <span v-else>{{ $t('auth.register') }}</span>
        </button>
        <div class="auth-footer">
          {{ $t('auth.hasAccount') }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useI18n } from '../composables/useI18n'

const router = useRouter()
const authStore = useAuthStore()
const { $t } = useI18n()

const email = ref('')
const nickname = ref('')
const password = ref('')
const confirmPassword = ref('')
const code = ref('')
const errorMsg = ref('')
const loading = ref(false)
const codeSending = ref(false)
const codeCountdown = ref(0)

async function sendCode() {
  if (!email.value) { errorMsg.value = '请先输入邮箱'; return }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email.value)) { errorMsg.value = $t('auth.invalidEmail'); return }
  codeSending.value = true; errorMsg.value = ''
  try {
    await authStore.sendCode(email.value)
    codeCountdown.value = 60
    const timer = setInterval(() => { codeCountdown.value--; if (codeCountdown.value <= 0) clearInterval(timer) }, 1000)
    alert($t('auth.codeSent'))
  } catch (e) { errorMsg.value = e.response?.data?.message || $t('auth.codeFail') }
  codeSending.value = false
}

async function handleRegister() {
  if (!email.value || !password.value || !code.value) { errorMsg.value = $t('auth.fillAll'); return }
  if (password.value.length < 6) { errorMsg.value = $t('auth.pwdMinLen'); return }
  if (password.value !== confirmPassword.value) { errorMsg.value = $t('auth.pwdMismatch'); return }
  loading.value = true; errorMsg.value = ''
  try { await authStore.register(email.value, password.value, code.value, nickname.value); router.push('/generate') }
  catch (e) { errorMsg.value = e.response?.data?.message || $t('auth.registerFail') }
  loading.value = false
}
</script>

<style scoped>
.register-page { height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #FFF5F0 0%, #FFE8D6 100%); padding: 20px; overflow-y: auto; }
.auth-container { width: 100%; max-width: 380px; }
.auth-header { text-align: center; margin-bottom: 24px; }
.auth-icon { font-size: 56px; margin-bottom: 8px; }
.auth-header h1 { font-size: 24px; color: var(--text-primary); margin-bottom: 4px; }
.auth-header p { font-size: 14px; color: var(--text-light); }
.auth-form { padding: 24px; }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-bottom: 6px; }
.code-row { display: flex; gap: 8px; }
.code-row .input { flex: 1; }
.code-btn { white-space: nowrap; flex-shrink: 0; }
.error-msg { color: var(--error-color); font-size: 13px; margin-bottom: 12px; text-align: center; }
.auth-footer { text-align: center; margin-top: 16px; font-size: 13px; color: var(--text-light); }
.auth-footer a { color: var(--primary-color); text-decoration: none; font-weight: 500; }
</style>
