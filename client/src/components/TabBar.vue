<template>
  <div class="nav-bar">
    <button
      v-for="tab in visibleTabs"
      :key="tab.name"
      class="nav-item"
      :class="{ active: currentRoute === tab.path }"
      @click="navigate(tab.path)"
    >
      <span class="nav-icon" v-html="tab.icon"></span>
      <span class="nav-label">{{ $t(tab.labelKey) }}</span>
    </button>
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
  {
    name: 'generate',
    path: '/generate',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 1 6 6c0 2.5-1.2 4.5-3 6l-3 3-3-3c-1.8-1.5-3-3.5-3-6a6 6 0 0 1 6-6z"/><circle cx="12" cy="9" r="2"/></svg>',
    labelKey: 'tab.generate',
    roles: ['user', 'admin', 'importer'],
  },
  {
    name: 'polish',
    path: '/polish',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.5 5L6 6.5 8.5 11l-5 1.5 5 1.5L6 19l4.5-2.5L12 22l1.5-5.5L18 19l-2.5-5 5-1.5-5-1.5L18 6.5l-4.5 2.5z"/></svg>',
    labelKey: 'tab.polish',
    roles: ['user', 'admin', 'importer'],
  },
  {
    name: 'bookshelf',
    path: '/bookshelf',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M8 8h8"/><path d="M8 12h6"/></svg>',
    labelKey: 'tab.bookshelf',
    roles: ['user', 'admin', 'importer'],
  },
  {
    name: 'profile',
    path: '/profile',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>',
    labelKey: 'tab.profile',
    roles: ['user', 'admin', 'importer'],
  },
  {
    name: 'distill',
    path: '/reference-upload',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>',
    labelKey: 'tab.distill',
    roles: ['admin'],
  },
]

const visibleTabs = computed(() => {
  const userRole = authStore.user?.role || 'user'
  return tabs.filter(t => t.roles.includes(userRole))
})

function navigate(path) {
  if (route.path !== path) router.push(path)
}
</script>

<style scoped>
.nav-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--tab-height);
  background: var(--card);
  border-top: 1px solid var(--card-border);
  display: flex;
  align-items: stretch;
  justify-content: space-around;
  z-index: 1000;
  padding-bottom: env(safe-area-inset-bottom, 0);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  background: rgba(255, 255, 255, 0.95);
}
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  flex: 1;
  cursor: pointer;
  border: none;
  background: transparent;
  font-family: inherit;
  padding: 4px 0;
  transition: color var(--transition);
  color: var(--text-tertiary);
  position: relative;
  -webkit-tap-highlight-color: transparent;
}
.nav-item.active {
  color: var(--primary);
}
.nav-item.active .nav-icon {
  transform: scale(1.05);
}
.nav-item.active::after {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 24px;
  height: 2px;
  background: var(--primary);
  border-radius: 0 0 2px 2px;
}
.nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  transition: transform var(--transition);
}
.nav-icon :deep(svg) {
  display: block;
}
.nav-label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.02em;
}
</style>
