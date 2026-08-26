<template>
 <div class="register-page">
 <div class="auth-container">
 <div class="auth-header">
 <div class="auth-icon"></div>
 <h1>{{ $t('auth.register') }}</h1>
 <p>创建你的{{ $t('app.title') }}账号</p>
 </div>
 <div class="card auth-form">
 <div class="form-group">
 <label>{{ $t('auth.email') }}</label>
 <input v-model.trim="email" class="input" type="email" autocomplete="email" :disabled="loading" :placeholder="$t('auth.placeholderEmail')" />
 </div>
 <div class="form-group">
 <label>{{ $t('auth.nickname') }}（{{ $t('common.no') }}选）</label>
 <input v-model.trim="nickname" class="input" :disabled="loading" :placeholder="$t('auth.placeholderNick')" maxlength="20" />
 </div>
 <div class="form-group">
 <label>{{ $t('auth.password') }}</label>
 <input v-model="password" class="input" type="password" autocomplete="new-password" :disabled="loading" :placeholder="$t('auth.placeholderPwdConfirm')" />
 </div>
 <div class="form-group">
 <label>确认{{ $t('auth.password') }}</label>
 <input v-model="confirmPassword" class="input" type="password" autocomplete="new-password" :disabled="loading" placeholder="再次输入密码" />
 </div>
 <div class="form-group">
 <label>{{ $t('auth.verifyCode') }}</label>
 <div class="code-row">
 <input v-model.trim="code" class="input" inputmode="numeric" :disabled="loading" :placeholder="$t('auth.placeholderCode')" maxlength="6" />
 <button class="btn btn-outline btn-sm code-btn" :disabled="!canSendCode" @click="sendCode">
 {{ codeCountdown > 0 ? `${codeCountdown}s` : (codeSending ? $t('auth.sending') : $t('auth.getCode')) }}
 </button>
 </div>
 </div>
 <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>
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
import { computed, ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useI18n } from '../composables/useI18n'

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
const loading = ref(false)
const codeSending = ref(false)
const codeCountdown = ref(0)
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const canSendCode = computed(() => !loading.value && !codeSending.value && codeCountdown.value === 0 && emailRegex.test(email.value))
const canRegister = computed(() => !loading.value && Boolean(email.value && password.value && confirmPassword.value && code.value))

async function sendCode() {
 if (!email.value) { errorMsg.value = '请先输入邮箱'; return }
 if (!emailRegex.test(email.value)) { errorMsg.value = $t('auth.invalidEmail'); return }
 codeSending.value = true; errorMsg.value = ''
 try {
 await authStore.sendCode(email.value)
 codeCountdown.value = 60
 const timer = setInterval(() => { codeCountdown.value--; if (codeCountdown.value <= 0) clearInterval(timer) }, 1000)
 alert($t('auth.codeSent'))
 } catch (e) { errorMsg.value = e.response?.data?.message || $t('auth.codeFail') }
 finally { codeSending.value = false }
}

async function handleRegister() {
 if (!email.value || !password.value || !code.value) { errorMsg.value = $t('auth.fillAll'); return }
 if (password.value.length < 6) { errorMsg.value = $t('auth.pwdMinLen'); return }
 if (password.value !== confirmPassword.value) { errorMsg.value = $t('auth.pwdMismatch'); return }
 loading.value = true; errorMsg.value = ''
 try { await authStore.register(email.value, password.value, code.value, nickname.value, inviteCode.value || undefined); router.push('/generate') }
 catch (e) { errorMsg.value = e.response?.data?.message || $t('auth.registerFail') }
 finally { loading.value = false }
}

onMounted(() => {
 // 读取URL中的邀请码
 const code = route.query.invite
 if (code) inviteCode.value = code
})
</script>

<style scoped>
.register-page { height: 100%; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 80% 10%, #fff4df 0%, transparent 30%), linear-gradient(135deg, #f3f7f2 0%, #e5f0e6 100%); padding: 20px; overflow-y: auto; }
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
