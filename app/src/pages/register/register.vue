<template>
  <view class="register-page">
    <view class="register-card">
      <text class="title">注册</text>

      <view class="form-group">
        <text class="label">邮箱</text>
        <input v-model="email" class="input" type="email" placeholder="输入邮箱" @blur="sendCode" />
      </view>

      <view class="form-group">
        <text class="label">验证码</text>
        <view class="code-row">
          <input v-model="code" class="input" type="text" placeholder="输入验证码" maxlength="6" />
          <button class="btn btn-sm btn-outline" :disabled="codeSending || codeCountdown > 0" @click="sendCode">
            {{ codeCountdown > 0 ? `${codeCountdown}s` : '获取验证码' }}
          </button>
        </view>
      </view>

      <view class="form-group">
        <text class="label">昵称</text>
        <input v-model="nickname" class="input" placeholder="输入昵称" maxlength="20" />
      </view>

      <view class="form-group">
        <text class="label">密码</text>
        <input v-model="password" class="input" type="password" placeholder="至少6位" />
      </view>

      <view class="form-group">
        <text class="label">邀请码（选填）</text>
        <input v-model="inviteCode" class="input" placeholder="输入邀请码" />
      </view>

      <button class="btn btn-primary btn-block btn-lg" :disabled="registering" @click="handleRegister">
        {{ registering ? '注册中...' : '注册' }}
      </button>

      <view class="links">
        <text class="link" @click="goLogin">已有账号？去登录</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../../stores/auth'

const authStore = useAuthStore()
const email = ref('')
const code = ref('')
const nickname = ref('')
const password = ref('')
const inviteCode = ref('')
const registering = ref(false)
const codeSending = ref(false)
const codeCountdown = ref(0)

async function sendCode() {
  if (!email.value) return
  codeSending.value = true
  try {
    await authStore.sendCode(email.value)
    uni.showToast({ title: '验证码已发送', icon: 'success' })
    codeCountdown.value = 60
    const timer = setInterval(() => {
      codeCountdown.value--
      if (codeCountdown.value <= 0) { clearInterval(timer); codeCountdown.value = 0 }
    }, 1000)
  } catch (e) {
    uni.showToast({ title: e.message || '发送失败', icon: 'none' })
  }
  codeSending.value = false
}

async function handleRegister() {
  if (!email.value || !code.value || !password.value || !nickname.value) {
    uni.showToast({ title: '请填写完整信息', icon: 'none' })
    return
  }
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
.register-page {
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh; padding: 24px; background: #f8f8f8;
}
.register-card {
  background: white; border-radius: 16px; padding: 32px 24px;
  width: 100%; max-width: 400px;
}
.title { font-size: 24px; font-weight: 700; text-align: center; display: block; margin-bottom: 24px; }
.form-group { margin-bottom: 16px; }
.label { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; }
.code-row { display: flex; gap: 8px; }
.code-row .input { flex: 1; }
.links { text-align: center; margin-top: 16px; }
.link { color: var(--primary-color); font-size: 13px; }
</style>
