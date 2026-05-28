<template>
  <div class="app">
    <router-view v-slot="{ Component }">
      <transition name="slide-fade" mode="out-in">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </transition>
    </router-view>
    <TabBar v-if="showTabBar" />
    <div v-if="showTabBar" class="global-footer">
      {{ $t('app.group') }}：<strong>1019601998</strong>
      <span class="lang-toggle" @click="switchLang">{{ isZh ? '🌐 English' : '🌐 中文' }}</span>
    </div>

    <!-- 公告弹窗 -->
    <Teleport to="body">
      <div v-if="showAnnouncement" class="announcement-overlay" @click.self="closeAnnouncement">
        <div class="announcement-modal">
          <div class="modal-header">{{ $t('announcement.title') }}</div>
          <div class="modal-body">
            <div class="gift-icon">🎁</div>
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
            <button class="btn btn-primary btn-block" @click="closeAnnouncement">
              {{ $t('announcement.gotIt') }}
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

const hiddenRoutes = ['Login', 'Register', 'NovelDetail']
const showTabBar = computed(() => !hiddenRoutes.includes(route.name))
const showAnnouncement = ref(false)

watchEffect(async () => {
  if (authStore.isLoggedIn) {
    const shouldShow = await authStore.checkAnnouncement()
    showAnnouncement.value = shouldShow
  }
})

// 手机切后台再回来时：验证 token 是否仍有效
function handleVisibilityChange() {
  if (document.visibilityState === 'visible' && authStore.isLoggedIn) {
    authStore.getProfile().catch(() => {
      // getProfile 返回 401 时，api 拦截器会清 token 并跳转登录
    })
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
</script>

<style scoped>
.app { width: 100%; height: 100%; display: flex; flex-direction: column; position: relative; }
.global-footer {
  position: fixed; bottom: var(--tab-height); left: 0; right: 0;
  text-align: center; font-size: 11px; color: var(--text-light);
  padding: 4px 0; background: var(--card-bg);
  border-top: 1px solid var(--border-color); z-index: 999;
  display: flex; align-items: center; justify-content: center; gap: 12px;
}
.global-footer strong { color: var(--primary-color); }
.lang-toggle { cursor: pointer; color: var(--primary-color); font-weight: 500; }
.lang-toggle:hover { text-decoration: underline; }

/* 公告弹窗 */
:global(.announcement-overlay) {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5); display: flex; align-items: center;
  justify-content: center; z-index: 9999; padding: 24px;
}
:global(.announcement-modal) {
  background: white; border-radius: 16px; max-width: 360px;
  width: 100%; overflow: hidden; animation: popIn 0.3s ease;
}
@keyframes popIn {
  0% { transform: scale(0.8); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
:global(.modal-header) {
  text-align: center; font-size: 18px; font-weight: 700;
  color: var(--primary-color); padding: 24px 20px 0;
}
:global(.modal-body) { padding: 20px; text-align: center; }
:global(.gift-icon) { font-size: 56px; margin-bottom: 12px; animation: bounce 1s infinite; }
@keyframes bounce {
  0%,100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}
:global(.announce-text) { font-size: 15px; color: var(--text-secondary); margin-bottom: 8px; }
:global(.announce-highlight) { font-size: 22px; font-weight: 700; color: var(--primary-color); padding: 10px 0; }
:global(.announce-highlight strong) { font-size: 28px; }
:global(.announce-detail) {
  text-align: left; margin-top: 12px; padding: 12px;
  background: #fff9f5; border-radius: 8px; border: 1px solid #ffe0d0;
}
:global(.announce-detail p) { font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; line-height: 1.5; }
:global(.announce-detail p:last-child) { margin-bottom: 0; }
:global(.modal-footer) { padding: 0 20px 20px; }
</style>
