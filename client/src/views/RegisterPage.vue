<template>
 <div class="register-page">
 <div class="auth-container">
 <div class="auth-header">
 <div class="auth-icon"></div>
 <h1>{{ $t('auth.register') }}</h1>
 <p>{{ $t('auth.registerDesc', { app: $t('app.title') }) }}</p>
 </div>
 <div class="card auth-form">
 <div class="form-group">
 <label>{{ $t('auth.email') }}</label>
 <input v-model.trim="email" class="input" type="email" autocomplete="email" :disabled="loading" :placeholder="$t('auth.placeholderEmail')" />
 </div>
 <div class="form-group">
 <label>{{ $t('auth.nicknameOptional', { label: $t('auth.nickname') }) }}</label>
 <input v-model.trim="nickname" class="input" :disabled="loading" :placeholder="$t('auth.placeholderNick')" maxlength="20" />
 </div>
 <div class="form-group">
 <label>{{ $t('auth.password') }}</label>
 <input v-model="password" class="input" type="password" autocomplete="new-password" :disabled="loading" :placeholder="$t('auth.placeholderPwdConfirm')" />
 </div>
 <div class="form-group">
 <label>{{ $t('auth.confirmPasswordLabel', { label: $t('auth.password') }) }}</label>
 <input v-model="confirmPassword" class="input" type="password" autocomplete="new-password" :disabled="loading" :placeholder="$t('auth.confirmPasswordPlaceholder')" />
 </div>
 <div class="form-group">
 <label>{{ $t('auth.verifyCode') }}</label>
 <div class="code-row">
 <input ref="codeInput" v-model.trim="code" class="input" inputmode="numeric" autocomplete="one-time-code" :disabled="loading" :placeholder="$t('auth.placeholderCode')" maxlength="6" @keyup.enter="handleRegister" />
 <button type="button" class="btn btn-outline btn-sm code-btn" :disabled="!canSendCode" @click="sendCode">
 {{ codeCountdown > 0 ? `${codeCountdown}s` : (codeSending ? $t('auth.sending') : $t('auth.getCode')) }}
 </button>
 </div>
 </div>
 <div v-if="message" class="success-msg" role="status">{{ message }}</div>
 <div v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</div>
 <button class="btn btn-primary btn-block" @click="handleRegister" :disabled="!canRegister" :aria-busy="loading">
 <span v-if="loading" class="loading-spinner"></span>
 <span>{{ loading ? $t('common.loading') : $t('auth.register') }}</span>
 </button>
 <div class="auth-footer">
 {{ $t('auth.hasAccount') }}<router-link to="/login">{{ $t('auth.login') }}</router-link>
 </div>
 </div>
 </div>
 </div>
</template>

<script setup>
import { computed, ref, onMounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useI18n } from '../composables/useI18n'
import { useVerificationCode } from '../composables/useVerificationCode'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { $t } = useI18n()

const email = ref('')
const nickname = ref('')
const inviteCode = ref('')
const password = ref('')
const confirmPassword = ref('')
const code = ref('')
const errorMsg = ref('')
const message = ref('')
const codeInput = ref(null)
const loading = ref(false)
const { sending: codeSending, countdown: codeCountdown, available, startFromResponse, resetCountdown, active, handleRateLimit } = useVerificationCode()
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const canSendCode = computed(() => !loading.value && available.value && emailRegex.test(email.value))
const canRegister = computed(() => !loading.value && !codeSending.value && Boolean(email.value && password.value && confirmPassword.value && code.value))
watch(email, () => { code.value = ''; message.value = ''; errorMsg.value = ''; resetCountdown() })

async function sendCode() {
 if (loading.value || !available.value) return
 if (!email.value) { errorMsg.value = $t('auth.needEmail'); return }
 if (!emailRegex.test(email.value)) { errorMsg.value = $t('auth.invalidEmail'); return }
 const requestedEmail = email.value
 codeSending.value = true; errorMsg.value = ''; message.value = ''
 try {
 const res = await authStore.sendCode(requestedEmail)
 if (!active()) return
 if (email.value !== requestedEmail) return
 if (res?.data?.emailSent !== false) startFromResponse(res)
 if (res?.data?.emailSent === false) errorMsg.value = $t('auth.codeEmailFailed')
 else {
  message.value = $t(res?.data?.cooldown ? 'auth.codePending' : 'auth.codeSent')
  await nextTick()
  if (active()) codeInput.value?.focus()
 }
 } catch (e) {
  if (email.value === requestedEmail) handleRateLimit(e)
  if (active() && email.value === requestedEmail) errorMsg.value = e.response?.data?.message || $t('auth.codeFail')
 }
 finally { codeSending.value = false }
}

async function handleRegister() {
 if (loading.value || codeSending.value) return
 if (!email.value || !password.value || !code.value) { errorMsg.value = $t('auth.fillAll'); return }
 if (!emailRegex.test(email.value)) { errorMsg.value = $t('auth.invalidEmail'); return }
 if (!/^\d{6}$/.test(code.value)) { errorMsg.value = $t('auth.invalidCode'); return }
 if (password.value.length < 6) { errorMsg.value = $t('auth.pwdMinLen'); return }
 if (password.value !== confirmPassword.value) { errorMsg.value = $t('auth.pwdMismatch'); return }
 loading.value = true; errorMsg.value = ''
 try { await authStore.register(email.value, password.value, code.value, nickname.value, inviteCode.value || undefined); router.push('/generate') }
 catch (e) { errorMsg.value = e.response?.data?.message || $t('auth.registerFail') }
 finally { loading.value = false }
}

onMounted(() => {
 // 读取URL中的邀请码
 const invite = route.query.invite
 if (typeof invite === 'string') inviteCode.value = invite
})
</script>

<style scoped>
.register-page { height: 100%; min-height: 0; display: flex; align-items: center; justify-content: flex-start; flex-direction: column; background: radial-gradient(circle at 80% 10%, #fff4df 0%, transparent 30%), linear-gradient(135deg, #f3f7f2 0%, #e5f0e6 100%); padding: 20px; overflow-y: auto; }
.auth-container { width: 100%; max-width: 380px; margin: auto 0; flex-shrink: 0; }
.auth-header { text-align: center; margin-bottom: 24px; }
.auth-icon { font-size: 56px; margin-bottom: 8px; }
.auth-header h1 { font-size: 24px; color: var(--text-primary); margin-bottom: 4px; }
.auth-header p { font-size: 14px; color: var(--text-light); }
.auth-form { padding: 24px; }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-bottom: 6px; }
.code-row { display: flex; gap: 8px; }
.code-row .input { flex: 1; min-width: 0; }
.code-btn { white-space: nowrap; flex-shrink: 0; }
.error-msg { color: var(--error-color); font-size: 13px; margin-bottom: 12px; text-align: center; }
.success-msg { color: var(--success); background: var(--success-bg); padding: 8px 12px; border-radius: var(--radius); font-size: 13px; margin-bottom: 12px; }
.auth-footer { text-align: center; margin-top: 16px; font-size: 13px; color: var(--text-light); }
.auth-footer a { color: var(--primary-color); text-decoration: none; font-weight: 500; }
</style>
