<template>
 <div class="login-page">
  <div class="auth-container">
   <div class="auth-brand">
    <div class="brand-icon">
     <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect width="48" height="48" rx="12" fill="#3f7d5a"/>
      <path d="M14 16h20v2H14zM14 22h20v2H14zM14 28h14v2H14z" fill="white"/>
      <path d="M33 27l5 5-5 5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
     </svg>
    </div>
    <h1 class="brand-title">{{ $t('auth.resetPassword') }}</h1>
    <p class="brand-subtitle">{{ $t('auth.resetPasswordDesc') }}</p>
   </div>

   <div class="card auth-card">
    <div class="form-group">
     <label class="label">{{ $t('auth.email') }}</label>
     <input v-model.trim="email" class="input" type="email" autocomplete="email" :disabled="loading" :placeholder="$t('auth.placeholderEmail')" />
    </div>
    <div class="form-group code-group">
     <label class="label">{{ $t('auth.verifyCode') }}</label>
     <div class="code-row">
      <input v-model.trim="code" class="input" inputmode="numeric" maxlength="6" :disabled="loading" :placeholder="$t('auth.placeholderCode')" />
      <button class="btn btn-outline btn-sm code-btn" :disabled="!canSendCode" @click="sendCode">
       {{ countdown > 0 ? `${countdown}s` : (sending ? $t('auth.sending') : $t('auth.getCode')) }}
      </button>
     </div>
    </div>
    <div class="form-group">
     <label class="label">{{ $t('auth.newPassword') }}</label>
     <input v-model="password" class="input" type="password" autocomplete="new-password" :disabled="loading" :placeholder="$t('auth.placeholderPwdConfirm')" />
    </div>
    <div class="form-group">
     <label class="label">{{ $t('auth.confirmPassword') }}</label>
     <input v-model="confirmPassword" class="input" type="password" autocomplete="new-password" :disabled="loading" :placeholder="$t('auth.placeholderPwdConfirm')" @keyup.enter="resetPassword" />
    </div>

    <div v-if="message" class="success-msg">{{ message }}</div>
    <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>
    <button class="btn btn-primary btn-block btn-lg" style="margin-top: 20px;" :disabled="!canReset" :aria-busy="loading" @click="resetPassword">
     <span v-if="loading" class="spinner"></span>
     <span>{{ loading ? $t('common.loading') : $t('auth.resetButton') }}</span>
    </button>

    <div class="back-link">
     <router-link to="/login" class="link-secondary">{{ $t('auth.backLogin') }}</router-link>
    </div>
   </div>
  </div>
 </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '../composables/useI18n'
import api from '../api'

const router = useRouter()
const { $t } = useI18n()
const email = ref('')
const code = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const message = ref('')
const loading = ref(false)
const sending = ref(false)
const countdown = ref(0)
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const canSendCode = computed(() => !loading.value && !sending.value && countdown.value === 0 && emailRegex.test(email.value))
const canReset = computed(() => !loading.value && Boolean(email.value && code.value && password.value && confirmPassword.value))

function startCountdown() {
 countdown.value = 60
 const timer = setInterval(() => {
  countdown.value -= 1
  if (countdown.value <= 0) { clearInterval(timer); countdown.value = 0 }
 }, 1000)
}

async function sendCode() {
 if (!email.value) { errorMsg.value = $t('auth.invalidEmail'); return }
 sending.value = true; errorMsg.value = ''; message.value = ''
 try {
  await api.post('/auth/send-reset-code', { email: email.value })
  message.value = $t('auth.resetCodeSent')
  startCountdown()
 } catch (e) {
  errorMsg.value = e.response?.data?.message || $t('auth.codeFail')
 } finally { sending.value = false }
}

async function resetPassword() {
 errorMsg.value = ''; message.value = ''
 if (!email.value || !code.value || !password.value || !confirmPassword.value) { errorMsg.value = $t('auth.fillAll'); return }
 if (password.value.length < 6) { errorMsg.value = $t('auth.pwdMinLen'); return }
 if (password.value !== confirmPassword.value) { errorMsg.value = $t('auth.pwdMismatch'); return }
 loading.value = true
 try {
  await api.post('/auth/reset-password', { email: email.value, code: code.value, password: password.value })
  message.value = $t('auth.resetSuccess')
  setTimeout(() => router.push('/login'), 900)
 } catch (e) {
  errorMsg.value = e.response?.data?.message || $t('auth.resetFail')
 } finally { loading.value = false }
}
</script>

<style scoped>
.login-page { height: 100%; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 18% 12%, #fff7e9 0%, transparent 32%), linear-gradient(135deg, #f3f7f2 0%, #e2efe3 50%, #f8f4ea 100%); padding: 24px; }
.auth-container { width: 100%; max-width: 400px; }
.auth-brand { text-align: center; margin-bottom: 28px; }
.brand-icon { display: flex; justify-content: center; margin-bottom: 16px; }
.brand-title { font-size: 26px; font-weight: 700; color: var(--text); margin-bottom: 6px; }
.brand-subtitle { font-size: 14px; color: var(--text-secondary); }
.auth-card { padding: 28px; }
.form-group { margin-bottom: 16px; }
.code-row { display: flex; gap: 8px; }
.code-row .input { flex: 1; min-width: 0; }
.code-btn { white-space: nowrap; flex-shrink: 0; }
.error-msg, .success-msg { font-size: 13px; margin-top: 12px; text-align: center; padding: 8px 12px; border-radius: var(--radius); }
.error-msg { color: var(--error); background: var(--error-bg); }
.success-msg { color: var(--success, #2e8b57); background: rgba(46, 139, 87, 0.1); }
.back-link { text-align: center; margin-top: 16px; }
.link-secondary { color: var(--text-tertiary); text-decoration: none; font-size: 13px; }
.link-secondary:hover { color: var(--text-secondary); }
</style>
