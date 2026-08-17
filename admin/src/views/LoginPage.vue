<template>
 <div class="login-page">
 <div class="login-box">
 <div class="logo" aria-hidden="true">M</div>
 <div class="brand-name">MirrorNovel</div>
 <h1>管理后台</h1>
 <p class="sub">小说生成系统</p>
 <div class="form-group">
 <label for="admin-email">管理员邮箱</label>
 <input id="admin-email" v-model="email" class="input" type="email" autocomplete="username" placeholder="name@example.com" @keyup.enter="login" />
 </div>
 <div class="form-group">
 <label for="admin-password">密码</label>
 <input id="admin-password" v-model="password" class="input" type="password" autocomplete="current-password" placeholder="请输入密码" @keyup.enter="login" />
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
 position: relative;
 min-height: 100vh;
 min-height: 100dvh;
 display: flex;
 align-items: center;
 justify-content: center;
 overflow: hidden;
 padding: 32px 20px;
 background: var(--canvas);
}
.login-page::before {
 content: '';
 position: absolute;
 inset: 0 0 auto;
 height: 38%;
 background: var(--forest-800);
}
.login-page::after {
 content: '';
 position: absolute;
 inset: 38% 0 auto;
 height: 7px;
 background: var(--sun-500);
}
.login-box {
 position: relative;
 z-index: 1;
 width: min(100%, 390px);
 padding: 34px 32px 32px;
 text-align: center;
 background: var(--surface);
 border: 1px solid var(--border);
 border-top: 4px solid var(--sun-500);
 border-radius: 8px;
 box-shadow: 0 18px 46px rgba(23, 52, 38, 0.18);
}
.logo {
 width: 48px;
 height: 48px;
 display: grid;
 place-items: center;
 margin: 0 auto 10px;
 color: var(--forest-950);
 background: var(--sun-500);
 border-radius: 8px;
 font-size: 24px;
 font-weight: 800;
}
.brand-name { color: var(--forest-700); font-size: 13px; font-weight: 700; letter-spacing: 0; }
h1 { margin-top: 4px; color: var(--text-strong); font-size: 22px; }
.sub { margin: 5px 0 24px; color: var(--text-muted); font-size: 13px; }
.form-group { margin-bottom: 15px; text-align: left; }
.form-group label { display: block; margin-bottom: 6px; color: var(--text); font-size: 13px; font-weight: 600; }
.input {
 width: 100%;
 min-height: 44px;
 padding: 10px 13px;
 border: 1px solid var(--border);
 border-radius: 8px;
 color: var(--text-strong);
 background: #fbfdfb;
 font-size: 14px;
 outline: none;
 transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}
.input::placeholder { color: #9aa79f; }
.input:focus { border-color: var(--forest-600); background: #fff; box-shadow: 0 0 0 3px rgba(63, 125, 90, 0.12); }
.error {
 margin: -2px 0 12px;
 padding: 8px 10px;
 border-radius: 6px;
 color: var(--danger);
 background: var(--danger-soft);
 font-size: 13px;
 text-align: left;
}
.btn {
 width: 100%;
 min-height: 44px;
 padding: 10px 14px;
 border: none;
 border-radius: 8px;
 color: white;
 background: var(--forest-700);
 font-size: 15px;
 font-weight: 700;
 cursor: pointer;
 transition: background 0.18s ease, transform 0.18s ease;
}
.btn:hover { background: var(--forest-800); }
.btn:active:not(:disabled) { transform: translateY(1px); }
.btn:disabled { color: #f7f8f7; background: #aab5ae; cursor: not-allowed; }

@media (max-width: 520px) {
 .login-page { align-items: flex-start; padding: max(54px, 12vh) 14px 24px; }
 .login-page::before { height: 31%; }
 .login-page::after { top: 31%; }
 .login-box { padding: 28px 20px 24px; }
}
</style>
