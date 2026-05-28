<template>
  <view class="login-page">
    <view class="login-card">
      <view class="login-logo">📖</view>
      <text class="login-title">登录</text>
      <text class="login-subtitle">番茄小说AI</text>

      <view class="form-group">
        <text class="label">邮箱</text>
        <input v-model="email" class="input" type="text" placeholder="输入邮箱地址" />
      </view>

      <view class="form-group">
        <text class="label">密码</text>
        <input v-model="password" class="input" password placeholder="输入密码" />
      </view>

      <button class="btn btn-primary btn-block btn-lg" hover-class="btn-hover" :disabled="logging" @click="handleLogin">
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
    uni.showToast({ title: e.errMsg || e.message || '登录失败', icon: 'none' })
  }
  logging.value = false
}

function goRegister() { uni.navigateTo({ url: '/pages/register/register' }) }
</script>

<style scoped>
.login-page { display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;background:linear-gradient(135deg,#fff5f0,#f8f8f8); }
.login-card { background:white;border-radius:20px;padding:40px 28px 32px;width:100%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,0.08); }
.login-logo { font-size:48px;text-align:center;margin-bottom:8px; }
.login-title { font-size:26px;font-weight:700;text-align:center;display:block;color:var(--text-primary); }
.login-subtitle { font-size:13px;color:var(--text-light);text-align:center;display:block;margin-bottom:28px;margin-top:4px; }
.form-group { margin-bottom:18px; }
.label { display:block;font-size:13px;color:var(--text-secondary);margin-bottom:6px;font-weight:500; }
.links { text-align:center;margin-top:18px; }
.link { color:var(--primary-color);font-size:13px; }
</style>
