<template>
  <div class="register-page">
    <div class="auth-container">
      <div class="auth-header">
        <div class="auth-icon">📚</div>
        <h1>注册账号</h1>
        <p>创建你的番茄小说账号</p>
      </div>
      <div class="card auth-form">
        <div class="form-group">
          <label>邮箱</label>
          <input v-model="email" class="input" type="email" placeholder="请输入邮箱" />
        </div>
        <div class="form-group">
          <label>昵称（可选）</label>
          <input v-model="nickname" class="input" placeholder="给自己起个昵称" maxlength="20" />
        </div>
        <div class="form-group">
          <label>密码</label>
          <input v-model="password" class="input" type="password" placeholder="至少6位密码" />
        </div>
        <div class="form-group">
          <label>确认密码</label>
          <input v-model="confirmPassword" class="input" type="password" placeholder="再次输入密码" />
        </div>
        <div class="form-group">
          <label>验证码</label>
          <div class="code-row">
            <input v-model="code" class="input" placeholder="输入验证码" maxlength="6" />
            <button
              class="btn btn-outline btn-sm code-btn"
              :disabled="codeSending || codeCountdown > 0"
              @click="sendCode"
            >
              {{ codeCountdown > 0 ? `${codeCountdown}s` : (codeSending ? '发送中' : '获取验证码') }}
            </button>
          </div>
        </div>
        <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>
        <button class="btn btn-primary btn-block" @click="handleRegister" :disabled="loading">
          <span v-if="loading" class="loading-spinner"></span>
          <span v-else>注册</span>
        </button>
        <div class="auth-footer">
          已有账号？<router-link to="/login">立即登录</router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const email = ref('')
const nickname = ref('')
const password = ref('')
const confirmPassword = ref('')
const code = ref('')
const errorMsg = ref('')
const loading = ref(false)
const codeSending = ref(false)
const codeCountdown = ref(0)

async function sendCode() {
  if (!email.value) {
    errorMsg.value = '请先输入邮箱'
    return
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email.value)) {
    errorMsg.value = '请输入有效的邮箱地址'
    return
  }
  codeSending.value = true
  errorMsg.value = ''
  try {
    await authStore.sendCode(email.value)
    // 开始倒计时
    codeCountdown.value = 60
    const timer = setInterval(() => {
      codeCountdown.value--
      if (codeCountdown.value <= 0) clearInterval(timer)
    }, 1000)
    alert('验证码已发送到邮箱，请注意查收')
  } catch (e) {
    errorMsg.value = e.response?.data?.message || '发送验证码失败'
  }
  codeSending.value = false
}

async function handleRegister() {
  if (!email.value || !password.value || !code.value) {
    errorMsg.value = '请填写完整信息'
    return
  }
  if (password.value.length < 6) {
    errorMsg.value = '密码至少6位'
    return
  }
  if (password.value !== confirmPassword.value) {
    errorMsg.value = '两次密码输入不一致'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    await authStore.register(email.value, password.value, code.value, nickname.value)
    router.push('/generate')
  } catch (e) {
    errorMsg.value = e.response?.data?.message || '注册失败'
  }
  loading.value = false
}
</script>

<style scoped>
.register-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #FFF5F0 0%, #FFE8D6 100%);
  padding: 20px;
  overflow-y: auto;
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

.code-row {
  display: flex;
  gap: 8px;
}

.code-row .input {
  flex: 1;
}

.code-btn {
  white-space: nowrap;
  flex-shrink: 0;
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
</style>
