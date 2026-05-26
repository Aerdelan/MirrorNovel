<template>
  <div class="tab-bar">
    <div
      v-for="tab in visibleTabs"
      :key="tab.name"
      class="tab-item"
      :class="{ active: currentRoute === tab.path }"
      @click="navigate(tab.path)"
    >
      <span class="tab-icon">{{ tab.icon }}</span>
      <span class="tab-label">{{ tab.label }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const currentRoute = computed(() => route.path)

const tabs = [
  { name: 'generate', path: '/generate', icon: '✍️', label: '生成', roles: ['user', 'admin', 'importer'] },
  { name: 'polish', path: '/polish', icon: '✨', label: '润色', roles: ['user', 'admin', 'importer'] },
  { name: 'profile', path: '/profile', icon: '👤', label: '我的', roles: ['user', 'admin', 'importer'] },
  { name: 'bookshelf', path: '/bookshelf', icon: '📖', label: '书架', roles: ['user', 'admin', 'importer'] },
  { name: 'distill', path: '/reference-upload', icon: '🧪', label: '蒸馏', roles: ['admin'] },
]

const visibleTabs = computed(() => {
  const userRole = authStore.user?.role || 'user'
  return tabs.filter(t => t.roles.includes(userRole))
})

function navigate(path) {
  router.push(path)
}
</script>

<style scoped>
.tab-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--tab-height);
  background: var(--card-bg);
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-around;
  z-index: 1000;
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.tab-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 6px 16px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: all 0.2s;
  position: relative;
}

.tab-item.active .tab-icon {
  transform: scale(1.1);
}
.tab-item.active .tab-label {
  color: var(--primary-color);
  font-weight: 600;
}

.tab-icon {
  font-size: 22px;
  transition: transform 0.2s;
}

.tab-label {
  font-size: 11px;
  color: var(--text-light);
  transition: color 0.2s;
}
</style>
