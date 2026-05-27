<template>
  <div class="admin-layout">
    <!-- 侧边栏 -->
    <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div class="sidebar-header">
        <span class="logo">📚</span>
        <span v-if="!sidebarCollapsed" class="logo-text">MirrorNovel</span>
      </div>
      <nav class="sidebar-nav">
        <div v-for="item in menuItems" :key="item.path"
          class="nav-item"
          :class="{ active: currentPath.startsWith(item.path) }"
          @click="navigate(item.path)">
          <span class="nav-icon">{{ item.icon }}</span>
          <span v-if="!sidebarCollapsed" class="nav-label">{{ item.label }}</span>
        </div>
      </nav>
      <div class="sidebar-footer">
        <div class="nav-item" @click="toggleSidebar">
          <span class="nav-icon">{{ sidebarCollapsed ? '▶' : '◀' }}</span>
          <span v-if="!sidebarCollapsed" class="nav-label">收起</span>
        </div>
        <div class="nav-item" @click="handleLogout">
          <span class="nav-icon">🚪</span>
          <span v-if="!sidebarCollapsed" class="nav-label">退出</span>
        </div>
      </div>
    </aside>

    <!-- 主内容区 -->
    <div class="main-area" :class="{ expanded: sidebarCollapsed }">
      <!-- 顶部栏 -->
      <header class="topbar">
        <div class="topbar-left">
          <span class="page-title">{{ currentTitle }}</span>
        </div>
        <div class="topbar-right">
          <span class="admin-info">👤 {{ adminUser?.email || '管理员' }}</span>
          <span class="admin-role">{{ adminUser?.role }}</span>
        </div>
      </header>

      <!-- 内容区 -->
      <main class="content">
        <slot />
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()
const sidebarCollapsed = ref(false)
const currentPath = computed(() => route.path)

const adminUser = computed(() => {
  try { return JSON.parse(localStorage.getItem('admin_user') || 'null') }
  catch { return null }
})

const menuItems = [
  { path: '/dashboard', icon: '📊', label: '数据大屏' },
  { path: '/users', icon: '👥', label: '用户管理' },
  { path: '/novels', icon: '📖', label: '小说管理' },
  { path: '/distill', icon: '🧪', label: '蒸馏管理' },
  { path: '/templates', icon: '📋', label: '类型模板' },
  { path: '/models', icon: '⚙️', label: '模型配置' },
]

const pageTitles = {
  '/dashboard': '数据大屏',
  '/users': '用户管理',
  '/novels': '小说管理',
  '/distill': '蒸馏管理',
  '/templates': '类型模板',
  '/models': '模型配置',
}

const currentTitle = computed(() => pageTitles[currentPath.value] || '管理后台')

function navigate(path) { router.push(path) }
function toggleSidebar() { sidebarCollapsed.value = !sidebarCollapsed.value }
function handleLogout() {
  localStorage.removeItem('admin_token')
  localStorage.removeItem('admin_user')
  router.push('/login')
}
</script>

<style scoped>
.admin-layout { display: flex; height: 100vh; }
.sidebar {
  width: 220px; background: #001529; color: #fff;
  display: flex; flex-direction: column; transition: width 0.3s;
  flex-shrink: 0; overflow: hidden;
}
.sidebar.collapsed { width: 64px; }
.sidebar-header { display: flex; align-items: center; gap: 10px; padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); }
.logo { font-size: 24px; }
.logo-text { font-size: 16px; font-weight: 600; white-space: nowrap; }
.sidebar-nav { flex: 1; padding: 8px; overflow-y: auto; }
.sidebar-footer { border-top: 1px solid rgba(255,255,255,0.1); padding: 8px; }
.nav-item {
  display: flex; align-items: center; gap: 10px; padding: 12px;
  border-radius: 8px; cursor: pointer; transition: all 0.2s;
  white-space: nowrap; color: rgba(255,255,255,0.65);
}
.nav-item:hover { background: rgba(255,255,255,0.08); color: #fff; }
.nav-item.active { background: #1890ff; color: #fff; }
.nav-icon { font-size: 18px; width: 24px; text-align: center; flex-shrink: 0; }
.nav-label { font-size: 14px; }

.main-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; transition: margin-left 0.3s; }
.topbar {
  height: 56px; background: #fff; border-bottom: 1px solid #e8e8e8;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px; flex-shrink: 0;
}
.page-title { font-size: 18px; font-weight: 600; color: #333; }
.topbar-right { display: flex; align-items: center; gap: 12px; }
.admin-info { font-size: 13px; color: #666; }
.admin-role { font-size: 11px; background: #e6f7ff; color: #1890ff; padding: 2px 8px; border-radius: 4px; }

.content { flex: 1; overflow-y: auto; padding: 24px; background: #f0f2f5; }
</style>
