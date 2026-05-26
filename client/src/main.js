import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useI18n } from './composables/useI18n'
import './assets/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// 挂载 i18n 到全局
const i18n = useI18n()
app.config.globalProperties.$t = i18n.$t
app.config.globalProperties.$tn = i18n.$tn
app.config.globalProperties.$tt = i18n.$tt
app.config.globalProperties.$locale = i18n.locale
app.config.globalProperties.$setLocale = i18n.setLocale
app.provide('i18n', i18n)

app.mount('#app')
