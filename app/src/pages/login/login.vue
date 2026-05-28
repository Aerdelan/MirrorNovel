<template>
  <view class="login-page">
    <view class="login-card">
      <text class="login-title">登录</text>

      <view class="form-group">
        <text class="label">邮箱</text>
        <input v-model="email" class="input" type="email" placeholder="输入邮箱" />
      </view>

      <view class="form-group">
        <text class="label">密码</text>
        <input v-model="password" class="input" type="password" placeholder="输入密码" />
      </view>

      <button class="btn btn-primary btn-block btn-lg" :disabled="logging" @click="handleLogin">
        {{ logging ? '登录中...' : '登录' }}
      </button>

      <view class="links">
        <text class="link" @click="goRegister">没有账号？去注册</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../../stores/auth'

const authStore = useAuthStore()
const email = ref('')
const password = ref('')
const logging = ref(false)

async function handleLogin() {
  if (!email.value || !password.value) {
    uni.showToast({ title: '请填写邮箱和密码', icon: 'none' })
    return
  }
  logging.value = true
  try {
    await authStore.login(email.value, password.value)
    uni.showToast({ title: '登录成功', icon: 'success' })
    uni.switchTab({ url: '/pages/index/index' })
  } catch (e) {
    uni.showToast({ title: e.message || '登录失败', icon: 'none' })
  }
  logging.value = false
}

function goRegister() {
  uni.navigateTo({ url: '/pages/register/register' })
}
</script>

<style scoped>
.login-page {
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh; padding: 24px; background: #f8f8f8;
}
.login-card {
  background: white; border-radius: 16px; padding: 32px 24px;
  width: 100%; max-width: 400px;
}
.login-title { font-size: 24px; font-weight: 700; text-align: center; display: block; margin-bottom: 24px; }
.form-group { margin-bottom: 16px; }
.label { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; }
.links { text-align: center; margin-top: 16px; }
.link { color: var(--primary-color); font-size: 13px; }
</style>
