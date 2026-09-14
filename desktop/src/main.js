import { createApp } from 'vue'
import { createPinia } from 'pinia'
import DesktopApp from './DesktopApp.vue'
import { createDesktopRouter } from './router'
import { useI18n } from '@client/composables/useI18n'
import '@client/assets/main.css'
import './styles/desktop.css'

const app = createApp(DesktopApp)
app.use(createPinia())
app.use(createDesktopRouter())

// i18n 与 Web 端共用同一套 composable 与语言包
const i18n = useI18n()
app.config.globalProperties.$t = i18n.$t
app.config.globalProperties.$tn = i18n.$tn
app.config.globalProperties.$tt = i18n.$tt
app.config.globalProperties.$tp = i18n.$tp
app.config.globalProperties.$locale = i18n.locale
app.config.globalProperties.$setLocale = i18n.setLocale
app.provide('i18n', i18n)

app.mount('#app')
