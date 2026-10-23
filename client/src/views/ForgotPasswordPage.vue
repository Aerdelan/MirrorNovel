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
      <input ref="codeInput" v-model.trim="code" class="input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" :disabled="loading" :placeholder="$t('auth.placeholderCode')" />
      <button type="button" class="btn btn-outline btn-sm code-btn" :disabled="!canSendCode" @click="sendCode">
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

    <div v-if="message" class="success-msg" role="status">{{ message }}</div>
    <div v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</div>
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
import { computed, ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '../composables/useI18n'
import api from '../api'
import { useAuthStore } from '../stores/auth'
import { useVerificationCode } from '../composables/useVerificationCode'

const router = useRouter()
const authStore = useAuthStore()
const { $t } = useI18n()
const email = ref('')
const code = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const message = ref('')
const loading = ref(false)
const codeInput = ref(null)
const completed = ref(false)
const { sending, countdown, available, startFromResponse, resetCountdown, active, handleRateLimit } = useVerificationCode()
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const canSendCode = computed(() => !loading.value && !completed.value && available.value && emailRegex.test(email.value))
const canReset = computed(() => !loading.value && !sending.value && !completed.value && Boolean(email.value && code.value && password.value && confirmPassword.value))
watch(email, () => { code.value = ''; message.value = ''; errorMsg.value = ''; resetCountdown() })

async function sendCode() {
 if (loading.value || completed.value || !available.value) return
 if (!emailRegex.test(email.value)) { errorMsg.value = $t('auth.invalidEmail'); return }
 const requestedEmail = email.value
 sending.value = true; errorMsg.value = ''; message.value = ''
 try {
  const res = await api.post('/auth/send-reset-code', { email: requestedEmail }, { timeout: 30000 })
  if (!active()) return
  if (email.value !== requestedEmail) return
  if (res?.data?.emailSent !== false) startFromResponse(res)
  if (res?.data?.emailSent === false) errorMsg.value = $t('auth.resetCodeEmailFailed')
  else {
   message.value = $t(res?.data?.cooldown ? 'auth.codePending' : 'auth.resetCodeSent')
   await nextTick()
   if (active()) codeInput.value?.focus()
  }
 } catch (e) {
  if (email.value === requestedEmail) handleRateLimit(e)
  if (active() && email.value === requestedEmail) errorMsg.value = e.response?.data?.message || $t('auth.codeFail')
 } finally { sending.value = false }
}

async function resetPassword() {
 if (loading.value || sending.value || completed.value) return
 errorMsg.value = ''; message.value = ''
 if (!email.value || !code.value || !password.value || !confirmPassword.value) { errorMsg.value = $t('auth.fillAll'); return }
 if (!emailRegex.test(email.value)) { errorMsg.value = $t('auth.invalidEmail'); return }
 if (!/^\d{6}$/.test(code.value)) { errorMsg.value = $t('auth.invalidCode'); return }
 if (password.value.length < 6) { errorMsg.value = $t('auth.pwdMinLen'); return }
 if (password.value !== confirmPassword.value) { errorMsg.value = $t('auth.pwdMismatch'); return }
 loading.value = true
 try {
  await api.post('/auth/reset-password', { email: email.value, code: code.value, password: password.value }, { timeout: 30000 })
  authStore.clearAuth()
  completed.value = true
  message.value = $t('auth.resetSuccess')
  if (active()) await router.replace('/login')
 } catch (e) {
  errorMsg.value = e.response?.data?.message || $t('auth.resetFail')
 } finally { loading.value = false }
}
</script>

<style scoped>
.login-page { height: 100%; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; background: radial-gradient(circle at 18% 12%, #fff7e9 0%, transparent 32%), linear-gradient(135deg, #f3f7f2 0%, #e2efe3 50%, #f8f4ea 100%); padding: 24px; }
.auth-container { width: 100%; max-width: 400px; margin: auto 0; flex-shrink: 0; }
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
