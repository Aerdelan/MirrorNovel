<template>
 <div class="app">
 <router-view v-slot="{ Component }">
 <keep-alive>
 <component :is="Component" />
 </keep-alive>
 </router-view>
 <TabBar v-if="showTabBar" />
 <div v-if="showTabBar" class="global-footer">
 <div class="footer-left">
 {{ $t('app.group') }}：<strong>1019601998</strong>
 </div>
 <div class="footer-right">
 <div class="lang-toggle-group">
 <button class="lang-btn" :class="{ active: isZh }" @click="setLocale('zh')">中文</button>
 <button class="lang-btn" :class="{ active: !isZh }" @click="setLocale('en')">English</button>
 </div>
 </div>
 </div>

 <!-- 公告弹窗 -->
 <Teleport to="body">
 <div v-if="showAnnouncement" class="announcement-overlay" @click.self="closeAnnouncement">
 <div class="announcement-modal">
 <div class="modal-header">{{ $t('announcement.title') }}</div>
 <div class="modal-body">
 <div class="gift-icon"></div>
 <div class="announce-text">
 {{ $t('announcement.desc') }}
 </div>
 <div class="announce-highlight">
 {{ $t('announcement.claim') }}
 </div>
 <div class="announce-detail">
 <p>{{ $t('announcement.tip1', { email: authStore.user?.email || '' }) }}</p>
 <p>{{ $t('announcement.tip2') }}</p>
 <p>{{ $t('announcement.tip3') }}</p>
 </div>
 </div>
 <div class="modal-footer">
 <button class="btn btn-primary btn-block btn-lg" @click="closeAnnouncement">
 {{ $t('announcement.gotIt') }}
 </button>
 </div>
 </div>
 </div>
 </Teleport>

 <!-- 免责声明弹窗（首次使用必须同意） -->
 <Teleport to="body">
 <div v-if="showDisclaimer" class="announcement-overlay" @click.self.stop>
 <div class="announcement-modal disclaimer-modal">
 <div class="modal-header">{{ $t('disclaimer.title') }}</div>
 <div class="modal-body">
 <div class="disclaimer-scroll">
 <p class="disclaimer-para">{{ $t('disclaimer.para1') }}</p>
 <p class="disclaimer-para disclaimer-warn">{{ $t('disclaimer.warn') }}</p>
 </div>
 </div>
 <div class="modal-footer">
 <button class="btn btn-primary btn-block btn-lg" @click="agreeDisclaimer">
 {{ $t('disclaimer.agree') }}
 </button>
 </div>
 </div>
 </div>
 </Teleport>
 </div>
 </template>

<script setup>
import { ref, computed, watchEffect, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import TabBar from './components/TabBar.vue'
import { useAuthStore } from './stores/auth'
import { useI18n } from './composables/useI18n'

const route = useRoute()
const authStore = useAuthStore()
const { isZh, setLocale } = useI18n()

const hiddenRoutes = ['Login', 'Register', 'ForgotPassword', 'NovelDetail']
const showTabBar = computed(() => !hiddenRoutes.includes(route.name))
const showAnnouncement = ref(false)

// 免责声明：首次使用必须同意，同意后 localStorage 记录
const DISCLAIMER_KEY = 'mn_disclaimer_agreed'
const showDisclaimer = ref(false)
watchEffect(() => {
  if (authStore.isLoggedIn) {
    showDisclaimer.value = !localStorage.getItem(DISCLAIMER_KEY)
  }
})
function agreeDisclaimer() {
  localStorage.setItem(DISCLAIMER_KEY, '1')
  showDisclaimer.value = false
}

watchEffect(async () => {
 if (authStore.isLoggedIn) {
 const shouldShow = await authStore.checkAnnouncement()
 showAnnouncement.value = shouldShow
 }
})

function handleVisibilityChange() {
 if (document.visibilityState === 'visible' && authStore.isLoggedIn) {
 authStore.getProfile().catch(() => {})
 }
}
onMounted(() => {
 document.addEventListener('visibilitychange', handleVisibilityChange)
})
onUnmounted(() => {
 document.removeEventListener('visibilitychange', handleVisibilityChange)
})

function closeAnnouncement() {
 showAnnouncement.value = false
 try { authStore.dismissAnnouncement() } catch {}
}

function switchLang() {
 setLocale(isZh.value ? 'en' : 'zh')
}

// Set i18n text methods on window for inline use
// 语言切换已改为底部双按钮切换模式
</script>

<style scoped>
.app {
 width: 100%;
 height: 100%;
 display: flex;
 flex-direction: column;
 position: relative;
}
/* 免责声明弹窗 */
.disclaimer-modal {
 max-width: 480px;
}
.disclaimer-scroll {
 max-height: 60vh;
 overflow-y: auto;
 padding-right: 4px;
}
.disclaimer-para {
 font-size: 13px;
 line-height: 1.8;
 color: var(--text-secondary);
 margin-bottom: 10px;
}
.disclaimer-warn {
 color: var(--error, #c0392b);
 font-weight: 600;
}
</style>
