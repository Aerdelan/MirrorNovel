<template>
  <div class="login-page">
    <div class="login-box">
      <div class="logo">⚙️</div>
      <h1>管理后台</h1>
      <p class="sub">MirrorNovel生成系统</p>
      <div class="form-group">
        <input v-model="email" class="input" placeholder="管理员邮箱" @keyup.enter="login" />
      </div>
      <div class="form-group">
        <input v-model="password" class="input" type="password" placeholder="密码" @keyup.enter="login" />
      </div>
      <div v-if="err" class="error">{{ err }}</div>
      <button class="btn btn-primary" :disabled="loading" @click="login">
        {{ loading ? '登录中...' : '登录' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const router = useRouter()
const email = ref('')
const password = ref('')
const err = ref('')
const loading = ref(false)

async function login() {
  if (!email.value || !password.value) { err.value = '请输入邮箱和密码'; return }
  loading.value = true; err.value = ''
  try {
    const res = await api.post('/auth/login', { email: email.value, password: password.value })
    const user = res.data.user
    if (user.role !== 'admin') { err.value = '该账号不是管理员'; return }
    localStorage.setItem('admin_token', res.data.token)
    localStorage.setItem('admin_user', JSON.stringify(user))
    router.push('/dashboard')
  } catch (e) {
    err.value = e.response?.data?.message || '登录失败'
  }
  loading.value = false
}
</script>

<style scoped>
.login-page {
  height: 100%; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #1a1a2e, #16213e);
}
.login-box {
  background: white; border-radius: 16px; padding: 40px 32px;
  max-width: 380px; width: 100%; text-align: center;
}
.logo { font-size: 48px; margin-bottom: 8px; }
h1 { font-size: 22px; color: #1a1a2e; }
.sub { font-size: 13px; color: #999; margin-bottom: 24px; }
.form-group { margin-bottom: 14px; }
.input {
  width: 100%; padding: 10px 14px; border: 1px solid #ddd; border-radius: 8px;
  font-size: 14px; outline: none;
}
.input:focus { border-color: #e94560; }
.error { color: #e94560; font-size: 13px; margin-bottom: 12px; }
.btn {
  width: 100%; padding: 12px; border: none; border-radius: 8px;
  font-size: 15px; font-weight: 600; cursor: pointer; color: white;
  background: #e94560; transition: all 0.2s;
}
.btn:hover { background: #d63850; }
.btn:disabled { background: #ccc; cursor: not-allowed; }
</style>
