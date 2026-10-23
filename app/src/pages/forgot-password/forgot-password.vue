<template>
  <view class="reset-page">
    <view class="reset-card">
      <text class="title">找回密码</text>
      <view class="form-group">
        <text class="label">邮箱</text>
        <input v-model.trim="email" class="input" placeholder="输入已注册邮箱" :disabled="loading" />
      </view>
      <view class="form-group">
        <text class="label">验证码</text>
        <view class="code-row">
          <input v-model.trim="code" class="input" type="number" placeholder="输入6位验证码" maxlength="6" :disabled="loading" />
          <button class="btn btn-sm btn-outline" :disabled="loading || sending || countdown > 0" @click="sendCode">
            {{ countdown > 0 ? `${countdown}s` : (sending ? '发送中...' : '获取验证码') }}
          </button>
        </view>
      </view>
      <view class="form-group">
        <text class="label">新密码</text>
        <input v-model="password" class="input" password placeholder="至少6位" :disabled="loading" />
      </view>
      <view class="form-group">
        <text class="label">确认新密码</text>
        <input v-model="confirmPassword" class="input" password placeholder="再次输入新密码" :disabled="loading" @confirm="resetPassword" />
      </view>
      <text v-if="message" class="message">{{ message }}</text>
      <button class="btn btn-primary btn-block" :disabled="loading || sending" @click="resetPassword">{{ loading ? '重置中...' : '重置密码' }}</button>
      <view class="links"><text class="link" @click="goLogin">返回登录</text></view>
    </view>
  </view>
</template>

<script setup>
import { ref, watch } from 'vue'
import api from '../../api'
import { useAuthStore } from '../../stores/auth'
import { useVerificationCode } from '../../composables/useVerificationCode'

const authStore = useAuthStore()
const email = ref(''), code = ref(''), password = ref(''), confirmPassword = ref('')
const loading = ref(false), message = ref('')
const { sending, countdown, active, resetCountdown, startFromResponse, handleRateLimit } = useVerificationCode()
const toast = title => uni.showToast({ title, icon: 'none' })
const validEmail = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)
watch(email, () => { code.value = ''; message.value = ''; resetCountdown() })

async function sendCode() {
  if (loading.value || sending.value || countdown.value > 0) return
  if (!validEmail()) { toast('请输入有效的邮箱地址'); return }
  const requestedEmail = email.value
  sending.value = true; message.value = ''
  try {
    const res = await api.post('/auth/send-reset-code', { email: requestedEmail }, { timeout: 30000 })
    if (!active() || email.value !== requestedEmail) return
    if (res?.emailSent === false) { toast('邮件发送失败，请稍后重试'); return }
    message.value = res?.cooldown ? '验证码正在发送或已发送，请稍候查收，无需重复获取' : '如果该邮箱已注册，验证码将发送到您的邮箱'
    startFromResponse(res)
  } catch (e) {
    if (active() && email.value === requestedEmail) { handleRateLimit(e); toast(e.message || '发送验证码失败') }
  }
  finally { sending.value = false }
}
async function resetPassword() {
  if (loading.value || sending.value) return
  if (!validEmail()) { toast('请输入有效的邮箱地址'); return }
  if (!/^\d{6}$/.test(code.value)) { toast('请输入6位数字验证码'); return }
  if (password.value.length < 6) { toast('密码至少6位'); return }
  if (password.value !== confirmPassword.value) { toast('两次密码输入不一致'); return }
  loading.value = true
  try {
    await api.post('/auth/reset-password', { email: email.value, code: code.value, password: password.value }, { timeout: 30000 })
    authStore.clearAuth()
    if (active()) { uni.reLaunch({ url: '/pages/login/login' }); toast('密码已重置，请使用新密码登录') }
  } catch (e) { if (active()) toast(e.message || '密码重置失败') }
  finally { loading.value = false }
}
function goLogin() { uni.reLaunch({ url: '/pages/login/login' }) }
</script>

<style scoped>
.reset-page { display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;background:linear-gradient(135deg,#fff5f0,#f8f8f8); }
.reset-card { background:white;border-radius:20px;padding:36px 28px;width:100%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,0.08); }
.title { display:block;text-align:center;font-size:26px;font-weight:700;margin-bottom:28px; }
.form-group { margin-bottom:16px; }
.label { display:block;font-size:13px;margin-bottom:6px; }
.code-row { display:flex;gap:8px; }
.code-row .input { flex:1;min-width:0; }
.message { display:block;font-size:13px;color:var(--primary-color);margin-bottom:12px; }
.links { text-align:center;margin-top:16px; }
.link { color:var(--primary-color);font-size:13px; }
</style>
