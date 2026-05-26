import { ref, computed } from 'vue'
import zh from '../locales/zh'
import en from '../locales/en'

const locale = ref(localStorage.getItem('locale') || 'zh')
const locales = { zh, en }

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

  const currentLocale = computed(() => locale.value)
  const isZh = computed(() => locale.value === 'zh')

  return { locale: currentLocale, isZh, setLocale, $t, t: $t, $tn, $tt }
}

// 单例，所有组件共享同一状态
export { locale }
