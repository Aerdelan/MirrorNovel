<template>
  <div class="login-page">
    <div class="auth-container">
      <div class="auth-header">
        <div class="auth-icon">📚</div>
        <h1>红薯小说生成</h1>
        <p>登录后继续使用</p>
      </div>
      <div class="card auth-form">
        <div class="form-group">
          <label>邮箱</label>
          <input v-model="email" class="input" type="email" placeholder="请输入邮箱" />
        </div>
        <div class="form-group">
          <label>密码</label>
          <input v-model="password" class="input" type="password" placeholder="请输入密码" @keyup.enter="handleLogin" />
        </div>
        <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>
        <button class="btn btn-primary btn-block" @click="handleLogin" :disabled="loading">
          <span v-if="loading" class="loading-spinner"></span>
          <span v-else>登录</span>
        </button>
        <div class="auth-footer">
          还没有账号？<router-link to="/register">立即注册</router-link>
        </div>
        <div class="back-link">
          <router-link to="/generate">返回首页</router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const email = ref('')
const password = ref('')
const errorMsg = ref('')
const loading = ref(false)

async function handleLogin() {
  if (!email.value || !password.value) {
    errorMsg.value = '请填写完整信息'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    await authStore.login(email.value, password.value)
    const redirect = route.query.redirect || '/generate'
    router.push(redirect)
  } catch (e) {
    errorMsg.value = e.response?.data?.message || '登录失败'
  }
  loading.value = false
}
</script>

<style scoped>
.login-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #FFF5F0 0%, #FFE8D6 100%);
  padding: 20px;
}

.auth-container {
  width: 100%;
  max-width: 380px;
}

.auth-header {
  text-align: center;
  margin-bottom: 24px;
}

.auth-icon {
  font-size: 56px;
  margin-bottom: 8px;
}

.auth-header h1 {
  font-size: 24px;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.auth-header p {
  font-size: 14px;
  color: var(--text-light);
}

.auth-form {
  padding: 24px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.error-msg {
  color: var(--error-color);
  font-size: 13px;
  margin-bottom: 12px;
  text-align: center;
}

.auth-footer {
  text-align: center;
  margin-top: 16px;
  font-size: 13px;
  color: var(--text-light);
}

.auth-footer a {
  color: var(--primary-color);
  text-decoration: none;
  font-weight: 500;
}

.back-link {
  text-align: center;
  margin-top: 12px;
}

.back-link a {
  color: var(--text-light);
  text-decoration: none;
  font-size: 13px;
}
</style>
