<template>
 <div class="admin-layout">
  <div v-if="mobileMenuOpen" class="sidebar-backdrop" @click="mobileMenuOpen = false"></div>

  <aside class="sidebar" :class="{ collapsed: sidebarCollapsed, open: mobileMenuOpen }">
   <div class="sidebar-header">
    <span class="brand-mark" aria-hidden="true">M</span>
    <span class="logo-text">MirrorNovel</span>
   </div>

   <nav class="sidebar-nav" aria-label="后台主导航">
    <button
     v-for="item in menuItems"
     :key="item.path"
     type="button"
     class="nav-item"
     :class="{ active: currentPath.startsWith(item.path) }"
     :title="sidebarCollapsed ? item.label : ''"
     :aria-current="currentPath.startsWith(item.path) ? 'page' : undefined"
     @click="navigate(item.path)"
    >
     <span class="nav-glyph" aria-hidden="true">{{ item.glyph }}</span>
     <span class="nav-label">{{ item.label }}</span>
    </button>
   </nav>

   <div class="sidebar-footer">
    <button
     type="button"
     class="nav-item collapse-control"
     :title="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
     @click="toggleSidebar"
    >
     <span class="nav-glyph" aria-hidden="true">{{ sidebarCollapsed ? '›' : '‹' }}</span>
     <span class="nav-label">收起侧栏</span>
    </button>
    <button type="button" class="nav-item" title="退出登录" @click="handleLogout">
     <span class="nav-glyph" aria-hidden="true">↪</span>
     <span class="nav-label">退出登录</span>
    </button>
   </div>
  </aside>

  <div class="main-area">
   <header class="topbar">
    <div class="topbar-left">
     <button
      type="button"
      class="mobile-menu-button"
      title="打开导航"
      aria-label="打开导航"
      @click="mobileMenuOpen = true"
     >
      ☰
     </button>
     <span class="page-title">{{ currentTitle }}</span>
    </div>
    <div class="topbar-right">
     <span class="admin-info">{{ adminUser?.email || '管理员' }}</span>
     <span v-if="adminUser?.role" class="admin-role">{{ adminUser.role }}</span>
    </div>
   </header>

   <main class="content">
    <slot />
   </main>
  </div>
 </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()
const sidebarCollapsed = ref(false)
const mobileMenuOpen = ref(false)
const currentPath = computed(() => route.path)

function safeParse(key) {
 try { const value = localStorage.getItem(key); if (!value || value === 'undefined') return null; return JSON.parse(value) }
 catch { return null }
}
const adminUser = computed(() => safeParse('admin_user'))

const menuItems = [
 { path: '/dashboard', label: '数据大屏', glyph: '览' },
 { path: '/users', label: '用户管理', glyph: '人' },
 { path: '/novels', label: '小说管理', glyph: '文' },
 { path: '/distill', label: '蒸馏管理', glyph: '析' },
 { path: '/activities', label: '积分活动', glyph: '惠' },
 { path: '/templates', label: '类型模板', glyph: '类' },
 { path: '/models', label: '线路与计价', glyph: '线' },
]

const pageTitles = {
 '/dashboard': '数据大屏',
 '/users': '用户管理',
 '/novels': '小说管理',
 '/distill': '蒸馏管理',
 '/activities': '积分活动',
 '/templates': '类型模板',
 '/models': '线路与计价',
}

const currentTitle = computed(() => pageTitles[currentPath.value] || '管理后台')

watch(() => route.fullPath, () => { mobileMenuOpen.value = false })

function navigate(path) { router.push(path) }
function toggleSidebar() { sidebarCollapsed.value = !sidebarCollapsed.value }
function handleLogout() {
 localStorage.removeItem('admin_token')
 localStorage.removeItem('admin_user')
 router.push('/login')
}
</script>

<style scoped>
.admin-layout {
 display: flex;
 width: 100%;
 height: 100vh;
 height: 100dvh;
 overflow: hidden;
 background: var(--canvas);
}
.sidebar {
 width: 236px;
 flex: 0 0 auto;
 display: flex;
 flex-direction: column;
 overflow: hidden;
 color: #f7fbf8;
 background: var(--forest-900);
 border-right: 1px solid rgba(255, 255, 255, 0.08);
 transition: width 0.22s ease, transform 0.22s ease;
 z-index: 30;
}
.sidebar.collapsed { width: 72px; }
.sidebar-header {
 min-height: 64px;
 display: flex;
 align-items: center;
 gap: 11px;
 padding: 12px 16px;
 border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.brand-mark {
 width: 34px;
 height: 34px;
 flex: 0 0 34px;
 display: grid;
 place-items: center;
 color: var(--forest-950);
 background: var(--sun-500);
 border-radius: 8px;
 font-size: 17px;
 font-weight: 800;
}
.logo-text { font-size: 16px; font-weight: 700; white-space: nowrap; }
.sidebar-nav { flex: 1; padding: 12px 10px; overflow-y: auto; }
.sidebar-footer { padding: 10px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
.nav-item {
 width: 100%;
 min-height: 44px;
 display: flex;
 align-items: center;
 gap: 11px;
 padding: 8px 10px;
 border: 0;
 border-radius: 8px;
 color: rgba(247, 251, 248, 0.76);
 background: transparent;
 cursor: pointer;
 text-align: left;
 white-space: nowrap;
 transition: color 0.18s ease, background 0.18s ease;
}
.nav-item + .nav-item { margin-top: 3px; }
.nav-item:hover { color: #fff; background: rgba(255, 255, 255, 0.09); }
.nav-item.active {
 color: var(--forest-950);
 background: var(--sun-500);
 font-weight: 700;
}
.nav-glyph {
 width: 28px;
 height: 28px;
 flex: 0 0 28px;
 display: grid;
 place-items: center;
 border-radius: 6px;
 color: inherit;
 background: rgba(255, 255, 255, 0.08);
 font-size: 13px;
 font-weight: 700;
}
.nav-item.active .nav-glyph { background: rgba(255, 255, 255, 0.35); }
.nav-label { font-size: 14px; }
.sidebar.collapsed .logo-text,
.sidebar.collapsed .nav-label { display: none; }
.sidebar.collapsed .sidebar-header,
.sidebar.collapsed .nav-item { justify-content: center; }
.sidebar.collapsed .sidebar-header { padding-inline: 19px; }
.sidebar.collapsed .nav-item { padding-inline: 8px; }

.main-area { min-width: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.topbar {
 min-height: 64px;
 flex: 0 0 64px;
 display: flex;
 align-items: center;
 justify-content: space-between;
 gap: 16px;
 padding: 0 24px;
 background: rgba(255, 255, 255, 0.96);
 border-bottom: 1px solid var(--border);
}
.topbar-left, .topbar-right { min-width: 0; display: flex; align-items: center; gap: 12px; }
.page-title { color: var(--text-strong); font-size: 18px; font-weight: 700; white-space: nowrap; }
.admin-info { max-width: 280px; overflow: hidden; color: var(--text-muted); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.admin-role {
 padding: 3px 8px;
 border-radius: 4px;
 color: var(--sun-700);
 background: var(--sun-100);
 font-size: 11px;
 font-weight: 700;
 text-transform: uppercase;
}
.mobile-menu-button {
 width: 40px;
 height: 40px;
 display: none;
 place-items: center;
 border: 1px solid var(--border);
 border-radius: 8px;
 color: var(--forest-800);
 background: var(--surface);
 font-size: 20px;
 cursor: pointer;
}
.content {
 min-width: 0;
 flex: 1;
 overflow: auto;
 padding: 24px;
 background: var(--canvas);
}
.sidebar-backdrop { display: none; }

@media (max-width: 900px) {
 .sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: 236px;
  transform: translateX(-100%);
  box-shadow: 12px 0 32px rgba(23, 52, 38, 0.2);
 }
 .sidebar.collapsed { width: 236px; }
 .sidebar.collapsed .logo-text,
 .sidebar.collapsed .nav-label { display: inline; }
 .sidebar.collapsed .sidebar-header,
 .sidebar.collapsed .nav-item { justify-content: flex-start; }
 .sidebar.collapsed .sidebar-header { padding-inline: 16px; }
 .sidebar.collapsed .nav-item { padding-inline: 10px; }
 .sidebar.open { transform: translateX(0); }
 .sidebar-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: block;
  background: rgba(23, 52, 38, 0.42);
 }
 .collapse-control { display: none; }
 .mobile-menu-button { display: grid; }
 .topbar { padding-inline: 18px; }
 .content { padding: 18px; }
}

@media (max-width: 520px) {
 .topbar { min-height: 58px; flex-basis: 58px; padding-inline: 12px; }
 .page-title { font-size: 16px; }
 .admin-info { max-width: 128px; font-size: 12px; }
 .admin-role { display: none; }
 .content { padding: 12px; }
}
</style>
