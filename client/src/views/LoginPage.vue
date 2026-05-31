<template>
  <div class="login-page">
    <div class="auth-container">
      <div class="auth-brand">
        <div class="brand-icon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="48" height="48" rx="12" fill="#2563eb"/>
            <path d="M14 16h20v2H14zM14 22h20v2H14zM14 28h14v2H14z" fill="white"/>
            <path d="M33 27l5 5-5 5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h1 class="brand-title">{{ $t('app.title') }}</h1>
        <p class="brand-subtitle">{{ $t('auth.loginSuccess') }}</p>
      </div>

      <div class="card auth-card">
        <div class="form-group">
          <label class="label">{{ $t('auth.email') }}</label>
          <input v-model="email" class="input" type="email" :placeholder="$t('auth.placeholderEmail')" />
        </div>
        <div class="form-group" style="margin-top: 16px;">
          <label class="label">{{ $t('auth.password') }}</label>
          <input v-model="password" class="input" type="password" :placeholder="$t('auth.placeholderPwd')" @keyup.enter="handleLogin" />
        </div>

        <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

        <button class="btn btn-primary btn-block btn-lg" style="margin-top: 20px;" @click="handleLogin" :disabled="loading">
          <span v-if="loading" class="spinner"></span>
          <span v-else>{{ $t('auth.login') }}</span>
        </button>

        <div class="auth-footer">
          {{ $t('auth.needAccount') }}
          <router-link to="/register" class="link">{{ $t('auth.register') }}</router-link>
        </div>

        <div class="back-link">
          <router-link to="/generate" class="link-secondary">{{ $t('auth.backHome') }}</router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useI18n } from '../composables/useI18n'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { $t } = useI18n()

const email = ref('')
const password = ref('')
const errorMsg = ref('')
const loading = ref(false)

async function handleLogin() {
  if (!email.value || !password.value) {
    errorMsg.value = $t('auth.fillAll')
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    await authStore.login(email.value, password.value)
    const redirect = route.query.redirect || '/generate'
    router.push(redirect)
  } catch (e) {
    errorMsg.value = e.response?.data?.message || $t('auth.loginFail')
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
  background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 50%, #f1f5f9 100%);
  padding: 24px;
}
.auth-container {
  width: 100%;
  max-width: 400px;
}
.auth-brand {
  text-align: center;
  margin-bottom: 28px;
}
.brand-icon {
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
}
.brand-title {
  font-size: 26px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 6px;
  letter-spacing: -0.02em;
}
.brand-subtitle {
  font-size: 14px;
  color: var(--text-secondary);
}
.auth-card {
  padding: 28px;
}
.form-group {
  margin-bottom: 4px;
}
.error-msg {
  color: var(--error);
  font-size: 13px;
  margin-top: 12px;
  text-align: center;
  background: var(--error-bg);
  padding: 8px 12px;
  border-radius: var(--radius);
}
.auth-footer {
  text-align: center;
  margin-top: 20px;
  font-size: 13px;
  color: var(--text-tertiary);
}
.link {
  color: var(--primary);
  text-decoration: none;
  font-weight: 500;
  margin-left: 2px;
}
.link:hover {
  text-decoration: underline;
}
.back-link {
  text-align: center;
  margin-top: 12px;
}
.link-secondary {
  color: var(--text-tertiary);
  text-decoration: none;
  font-size: 13px;
}
.link-secondary:hover {
  color: var(--text-secondary);
}
</style>
