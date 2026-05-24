<template>
  <div class="app">
    <router-view v-slot="{ Component, route }">
      <transition name="slide-fade" mode="out-in">
        <keep-alive>
          <component :is="Component" :key="route.path" />
        </keep-alive>
      </transition>
    </router-view>
    <TabBar v-if="showTabBar" />
    <div v-if="showTabBar" class="global-footer">官方群：<strong>1019601998</strong></div>

    <!-- 公告弹窗 -->
    <Teleport to="body">
      <div v-if="showAnnouncement" class="announcement-overlay" @click.self="closeAnnouncement">
        <div class="announcement-modal">
          <div class="modal-header">🎉 欢迎使用红薯小说生成</div>
          <div class="modal-body">
            <div class="gift-icon">🎁</div>
            <div class="announce-text">
              加官方QQ群 <strong>1019601998</strong> 联系管理员
            </div>
            <div class="announce-highlight">
              免费领取 <strong>5,000 Token</strong>
            </div>
            <div class="announce-detail">
              <p>📌 进群后发送：我的用户名 <strong>{{ authStore.user?.email || '' }}</strong></p>
              <p>📌 Token 自动到账，可用于系统模型生成</p>
              <p>📌 1 Token ≈ 1 字输出，5000 Token 可生成约 5000 字</p>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-primary btn-block" @click="closeAnnouncement">
              我知道了
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import TabBar from './components/TabBar.vue'
import { useAuthStore } from './stores/auth'

const route = useRoute()
const authStore = useAuthStore()
const hiddenRoutes = ['Login', 'Register', 'NovelDetail']
const showTabBar = computed(() => !hiddenRoutes.includes(route.name))

const showAnnouncement = ref(false)

// 每次登录状态变化时检查公告
watchEffect(async () => {
  if (authStore.isLoggedIn) {
    const shouldShow = await authStore.checkAnnouncement()
    showAnnouncement.value = shouldShow
  }
})

async function closeAnnouncement() {
  showAnnouncement.value = false
  try { await authStore.dismissAnnouncement() } catch {}
}
</script>

<style scoped>
.app {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* 底部群号 */
.global-footer {
  position: fixed;
  bottom: var(--tab-height);
  left: 0; right: 0;
  text-align: center;
  font-size: 11px;
  color: var(--text-light);
  padding: 4px 0;
  background: var(--card-bg);
  border-top: 1px solid var(--border-color);
  z-index: 999;
}
.global-footer strong {
  color: var(--primary-color);
}

/* 公告弹窗 */
:global(.announcement-overlay) {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999;
  padding: 24px;
}
:global(.announcement-modal) {
  background: white;
  border-radius: 16px;
  max-width: 360px;
  width: 100%;
  overflow: hidden;
  animation: popIn 0.3s ease;
}
@keyframes popIn {
  0% { transform: scale(0.8); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
:global(.modal-header) {
  text-align: center;
  font-size: 18px;
  font-weight: 700;
  color: var(--primary-color);
  padding: 24px 20px 0;
}
:global(.modal-body) {
  padding: 20px;
  text-align: center;
}
:global(.gift-icon) {
  font-size: 56px;
  margin-bottom: 12px;
  animation: bounce 1s infinite;
}
@keyframes bounce {
  0%,100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}
:global(.announce-text) {
  font-size: 15px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
:global(.announce-highlight) {
  font-size: 22px;
  font-weight: 700;
  color: var(--primary-color);
  padding: 10px 0;
}
:global(.announce-highlight strong) {
  font-size: 28px;
}
:global(.announce-detail) {
  text-align: left;
  margin-top: 12px;
  padding: 12px;
  background: #fff9f5;
  border-radius: 8px;
  border: 1px solid #ffe0d0;
}
:global(.announce-detail p) {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 6px;
  line-height: 1.5;
}
:global(.announce-detail p:last-child) { margin-bottom: 0; }
:global(.modal-footer) {
  padding: 0 20px 20px;
}
</style>
