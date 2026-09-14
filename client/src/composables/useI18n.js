import { ref, computed } from 'vue'
import zh from '../locales/zh'
import en from '../locales/en'
import desktopZh from '../locales/desktop.zh'
import desktopEn from '../locales/desktop.en'

const locale = ref(localStorage.getItem('locale') || 'zh')
// 桌面端专用文案合并为 desktop 段（见 locales/desktop.zh.js），
// 与 Web 端文案互不干扰，用法一致：$t('desktop.nav.generate')
const locales = {
  zh: { ...zh, desktop: desktopZh },
  en: { ...en, desktop: desktopEn },
}

export function useI18n() {
 function setLocale(l) {
 locale.value = l
 localStorage.setItem('locale', l)
 document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'
 }

 function $t(key, params) {
 const keys = key.split('.')
 let text = locales[locale.value]
 for (const k of keys) {
 if (text && typeof text === 'object') text = text[k]
 else { text = undefined; break }
 }
 if (text === undefined) {
 text = locales['zh']
 for (const k of keys) {
 if (text && typeof text === 'object') text = text[k]
 else { text = key; break }
 }
 }
 if (typeof text !== 'string') return key
 if (params) {
 Object.entries(params).forEach(([k, v]) => {
 text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v)
 })
 }
 return text
 }

 // 翻译类型/子类型名称：中文 → 当前语言
 function $tn(name) {
 if (!name) return name
 const cur = locales[locale.value]
 const zh = locales['zh']
 return cur?.typeNames?.[name] || cur?.tagNames?.[name] || zh?.typeNames?.[name] || zh?.tagNames?.[name] || name
 }

 // 翻译标签名
 function $tt(name) {
  if (!name) return name
  const map = locales[locale.value]?.tagNames || {}
  return map[name] || locales['zh']?.tagNames?.[name] || name
 }

 /**
  * 写作风格（人格）名称/描述的翻译。
  * 这些内容由服务端下发（内置人格是中文数据），所以按"中文名"作为 key 查语言包：
  *   $tp(name)          → 译名
  *   $tp(name, 'desc')  → 译描述
  * 用户自建人格没有映射，原样返回，不会出现空白。
  */
 function $tp(name, field = 'name') {
  if (!name) return name
  const entry = locales[locale.value]?.writingPersonas?.[name]
  return entry?.[field] || (field === 'name' ? name : '')
 }

 const currentLocale = computed(() => locale.value)
 const isZh = computed(() => locale.value === 'zh')

 return { locale: currentLocale, isZh, setLocale, $t, t: $t, $tn, $tt, $tp }
}

// 单例，所有组件共享同一状态
export { locale }
