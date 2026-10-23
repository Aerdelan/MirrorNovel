<template>
  <view class="register-page">
    <view class="register-card">
      <text class="title">注册</text>

      <view class="form-group">
        <text class="label">邮箱</text>
        <input v-model.trim="email" class="input" type="text" placeholder="输入邮箱" :disabled="registering" />
      </view>

      <view class="form-group">
        <text class="label">验证码</text>
        <view class="code-row">
          <input v-model.trim="code" class="input" type="number" placeholder="输入验证码" maxlength="6" :disabled="registering" />
          <button class="btn btn-sm btn-outline" hover-class="btn-hover" :disabled="registering || codeSending || codeCountdown > 0" @click="sendCode">
            {{ codeCountdown > 0 ? `${codeCountdown}s` : '获取验证码' }}
          </button>
        </view>
      </view>

      <view class="form-group">
        <text class="label">昵称（选填）</text>
        <input v-model.trim="nickname" class="input" type="text" placeholder="输入昵称" maxlength="20" :disabled="registering" />
      </view>

      <view class="form-group">
        <text class="label">密码</text>
        <input v-model="password" class="input" password placeholder="至少6位" :disabled="registering" />
      </view>
      <view class="form-group">
        <text class="label">确认密码</text>
        <input v-model="confirmPassword" class="input" password placeholder="再次输入密码" :disabled="registering" />
      </view>

      <view class="form-group">
        <text class="label">邀请码（选填）</text>
        <input v-model.trim="inviteCode" class="input" type="text" placeholder="输入邀请码" :disabled="registering" />
      </view>

      <button class="btn btn-primary btn-block btn-lg" hover-class="btn-hover" :disabled="registering || codeSending" @click="handleRegister">
        {{ registering ? '注册中...' : '注册' }}
      </button>

      <view class="links">
        <text class="link" @click="goLogin">已有账号？去登录</text>
      </view>
    </view>
  </view>
</template>
<script setup>
import { ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useAuthStore } from '../../stores/auth'
import { useVerificationCode } from '../../composables/useVerificationCode'

const authStore = useAuthStore()
const email = ref('')
const code = ref('')
const nickname = ref('')
const password = ref('')
const confirmPassword = ref('')
const inviteCode = ref('')
const registering = ref(false)
const { sending: codeSending, countdown: codeCountdown, active, resetCountdown, startFromResponse, handleRateLimit } = useVerificationCode()
onLoad(options => { if (typeof options?.invite === 'string') inviteCode.value = options.invite })
watch(email, () => { code.value = ''; resetCountdown() })

async function sendCode() {
  if (registering.value || codeSending.value || codeCountdown.value > 0) return
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
    uni.showToast({ title: '请输入有效的邮箱地址', icon: 'none' }); return
  }
  const requestedEmail = email.value
  codeSending.value = true
  try {
    const res = await authStore.sendCode(requestedEmail)
    if (!active() || email.value !== requestedEmail) return
    if (res?.emailSent === false) {
      uni.showToast({ title: '邮件发送失败，请稍后重试', icon: 'none' }); return
    }
    uni.showToast({ title: res?.cooldown ? '验证码正在发送或已发送，请稍候查收' : '验证码已发送', icon: 'none' })
    startFromResponse(res)
  } catch (e) {
    if (active() && email.value === requestedEmail) {
      handleRateLimit(e)
      uni.showToast({ title: e.message || '发送失败', icon: 'none' })
    }
  }
  finally { codeSending.value = false }
}

async function handleRegister() {
  if (registering.value || codeSending.value) return
  if (!email.value || !code.value || !password.value || !confirmPassword.value) {
    uni.showToast({ title: '请填写完整信息', icon: 'none' })
    return
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) { uni.showToast({ title: '请输入有效的邮箱地址', icon: 'none' }); return }
  if (!/^\d{6}$/.test(code.value)) { uni.showToast({ title: '请输入6位数字验证码', icon: 'none' }); return }
  if (password.value.length < 6) { uni.showToast({ title: '密码至少6位', icon: 'none' }); return }
  if (password.value !== confirmPassword.value) { uni.showToast({ title: '两次密码输入不一致', icon: 'none' }); return }
  registering.value = true
  try {
    await authStore.register(email.value, password.value, code.value, nickname.value, inviteCode.value)
    uni.showToast({ title: '注册成功', icon: 'success' })
    uni.switchTab({ url: '/pages/index/index' })
  } catch (e) {
    uni.showToast({ title: e.message || '注册失败', icon: 'none' })
  }
  registering.value = false
}

function goLogin() { uni.navigateTo({ url: '/pages/login/login' }) }
</script>
<style scoped>
.register-page { display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;background:linear-gradient(135deg,#fff5f0,#f8f8f8); }
.register-card { background:white;border-radius:20px;padding:36px 28px;width:100%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,0.08); }
.title { font-size:26px;font-weight:700;text-align:center;display:block;margin-bottom:28px;color:var(--text-primary); }
.form-group { margin-bottom:16px; }
.label { display:block;font-size:13px;color:var(--text-secondary);margin-bottom:6px;font-weight:500; }
.code-row { display:flex;gap:8px; }
.code-row .input { flex:1;min-width:0; }
.links { text-align:center;margin-top:16px; }
.link { color:var(--primary-color);font-size:13px; }
</style>
