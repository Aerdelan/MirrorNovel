<template>
  <!-- 登录类页面独占窗口；其余页面统一包在桌面外壳（侧栏 + 顶栏 + 状态栏）里 -->
  <DesktopShell v-if="useShell">
    <router-view v-slot="{ Component }">
      <keep-alive>
        <component :is="Component" />
      </keep-alive>
    </router-view>
  </DesktopShell>
  <router-view v-else />

  <!-- 免责声明：与 Web 端同一份 localStorage 开关，首次使用必须同意 -->
  <Teleport to="body">
    <div v-if="showDisclaimer" class="mn-overlay">
      <div class="mn-modal">
        <div class="mn-modal-head">{{ $t('disclaimer.title') }}</div>
        <div class="mn-modal-body">
          <p class="para">{{ $t('disclaimer.para1') }}</p>
          <p class="para warn">{{ $t('disclaimer.warn') }}</p>
        </div>
        <div class="mn-modal-foot">
          <button class="btn btn-primary btn-block btn-lg" @click="agreeDisclaimer">{{ $t('disclaimer.agree') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import DesktopShell from './layouts/DesktopShell.vue'
import { SHELL_LESS_ROUTES } from './nav/navItems'
import { useAuthStore } from '@client/stores/auth'

const route = useRoute()
const authStore = useAuthStore()
const useShell = computed(() => !SHELL_LESS_ROUTES.includes(route.name))

// 与 Web 端共用同一个 key，桌面端同意过就不必再弹
const DISCLAIMER_KEY = 'mn_disclaimer_agreed'
const showDisclaimer = ref(false)
watchEffect(() => {
  if (authStore.isLoggedIn) showDisclaimer.value = !localStorage.getItem(DISCLAIMER_KEY)
})
function agreeDisclaimer() {
  localStorage.setItem(DISCLAIMER_KEY, '1')
  showDisclaimer.value = false
}
</script>

<style scoped>
.mn-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  background: rgba(23, 52, 38, 0.42);
}
.mn-modal {
  width: 480px;
  max-width: 90vw;
  background: var(--card);
  border-radius: var(--radius-xl);
  box-shadow: 0 18px 48px rgba(32, 53, 42, 0.28);
  overflow: hidden;
}
.mn-modal-head { padding: 16px 20px; font-weight: 700; border-bottom: 1px solid var(--card-border); }
.mn-modal-body { padding: 16px 20px; max-height: 60vh; overflow: auto; }
.mn-modal-body .para { font-size: 13px; line-height: 1.8; color: var(--text-secondary); margin-bottom: 10px; }
.mn-modal-body .para.warn { color: var(--error); font-weight: 600; }
.mn-modal-foot { padding: 14px 20px; border-top: 1px solid var(--card-border); }
</style>
