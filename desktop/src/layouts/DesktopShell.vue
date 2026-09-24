<template>
  <div class="desktop-shell">
    <div class="shell-body">
      <!-- 侧栏：固定展开 / 固定收起 / 悬停浮层展开 三态 -->
      <div class="rail-slot">
        <aside
          class="desktop-rail"
          :class="{ pinned: railPinned, 'hover-open': railHoverOpen }"
          @mouseenter="railHovered = true"
          @mouseleave="railHovered = false"
        >
          <div class="rail-head">
            <span class="brand-mark">M</span>
            <span class="brand-name">MirrorNovel</span>
          </div>

          <button class="rail-toggle" :title="railPinned ? $t('desktop.shell.collapseRailTip') : $t('desktop.shell.expandRailTip')" @click="handleRailToggle">
            <span class="chev">{{ railPinned ? '«' : '»' }}</span>
            <span class="lbl">{{ railPinned ? $t('desktop.shell.collapseRail') : $t('desktop.shell.expandRail') }}</span>
          </button>

          <nav class="rail-nav">
            <div v-for="group in visibleGroups" :key="group.key" class="rail-group">
              <div class="rail-group-title">{{ groupTitle(group) }}</div>
              <button
                v-for="item in group.items"
                :key="item.key"
                class="rail-item"
                :class="{ active: isActive(item) }"
                :title="labelOf(item)"
                :data-tip="labelOf(item)"
                @click="go(item)"
              >
                <span class="ico" v-html="item.icon"></span>
                <span class="lbl">{{ labelOf(item) }}</span>
                <span v-if="item.key === 'bookshelf' && novelCount" class="badge">{{ novelCount }}</span>
              </button>
            </div>
          </nav>

          <div class="rail-foot">
            <button class="user-card" :title="$t('desktop.shell.accountTip')" @click="router.push('/profile')">
              <span class="avatar">{{ userInitial }}</span>
              <span class="user-meta">
                <strong>{{ authStore.user?.nickname || authStore.user?.email || $t('desktop.shell.notLoggedIn') }}</strong>
                <span>{{ authStore.user?.email || '' }}</span>
              </span>
            </button>
          </div>
        </aside>
      </div>

      <!-- 主区 -->
      <div class="desktop-main">
        <header class="desktop-topbar">
          <h1>{{ pageTitle }}</h1>
          <span v-if="pageCrumb" class="crumb">{{ pageCrumb }}</span>
          <span class="spacer"></span>
          <div class="quick-search" :title="$t('desktop.shell.searchTip')">
            <span class="ico">⌕</span>
            <span class="ph">{{ $t('desktop.shell.searchPlaceholder') }}</span>
            <kbd>Ctrl K</kbd>
          </div>
          <button class="top-btn" :title="$t('desktop.shell.toggleChaptersTip')" @click="toggleChapters">▥</button>
          <button class="top-btn" :title="$t('desktop.shell.settingsTip')" @click="router.push('/profile')">⚙</button>
        </header>

        <!-- workbench 类：三栏工作台页面需要占满内容区，去掉通用留白（见 desktop.css） -->
        <main class="desktop-content" :class="{ workbench: route.meta?.workbench }">
          <slot />
        </main>
      </div>
    </div>

    <footer class="desktop-statusbar">
      <span class="status">
        <span class="dot" :class="{ ok: apiReady }"></span>
        {{ apiReady ? $t('desktop.shell.connected', { host: apiLabel }) : $t('desktop.shell.disconnected') }}
      </span>
      <span class="hint">{{ shellHint }}</span>
      <span class="spacer"></span>
      <span class="hint">{{ $t('desktop.shell.hintRail') }}</span>
      <span class="hint">{{ $t('desktop.shell.hintChapters') }}</span>
      <span class="hint">{{ $t('desktop.shell.hintContinue') }}</span>
    </footer>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@client/stores/auth'
import { useI18n } from '@client/composables/useI18n'
import api from '@client/api'
import { navGroups, ROUTE_TITLE_KEYS } from '../nav/navItems'
import { useDesktopPrefs } from '../composables/useDesktopPrefs'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const { $t } = useI18n()
const { railPinned, railHovered, railHoverOpen, toggleRail, toggleChapters } = useDesktopPrefs()

const novelCount = ref(0)
const apiReady = ref(false)
const apiLabel = ref(import.meta.env.VITE_API_LABEL || '43.159.149.223:5173')

const userInitial = computed(() => {
  const name = authStore.user?.nickname || authStore.user?.email || 'M'
  return String(name).trim().charAt(0).toUpperCase()
})

const role = computed(() => authStore.user?.role || 'user')
const visibleGroups = computed(() => navGroups
  .map((group) => ({ ...group, items: group.items.filter((item) => item.roles.includes(role.value)) }))
  .filter((group) => group.items.length))

const pageTitle = computed(() => {
  const key = ROUTE_TITLE_KEYS[route.name]
  const translated = key ? $t(key) : ''
  if (translated && translated !== key) return translated
  return route.meta?.title || $t('desktop.title.fallback')
})
const pageCrumb = computed(() => {
  if (route.name === 'NovelDetail') return $t('desktop.shell.novelCrumb', { id: route.params.id || '' })
  return ''
})
const shellHint = computed(() => (route.name === 'NovelDetail' ? $t('desktop.shell.workbenchHint') : ''))

function groupTitle(group) {
  const translated = group.titleKey ? $t(group.titleKey) : ''
  if (translated && translated !== group.titleKey) return translated
  return group.titleFallback || group.key
}

function labelOf(item) {
  // 文案集中在 locales/desktop.*.js；语言包缺失该 key 时回落到 fallback，
  // 避免侧栏出现裸 key 或空白
  const translated = item.labelKey ? $t(item.labelKey) : ''
  if (typeof translated === 'string' && translated && translated !== item.labelKey) return translated
  return item.fallback || item.key
}

function handleRailToggle() {
  const collapsing = railPinned.value
  toggleRail()
  // 点击收起时指针仍位于侧栏内部。如果保留 hovered=true，收起状态会在同一帧
  // 立刻变成 hover-open，表现为按钮已写“展开侧栏”，菜单却仍占着完整宽度。
  // 清掉本次悬停后，用户必须先移出再重新移入，悬浮展开才会再次生效。
  if (collapsing) railHovered.value = false
}

/**
 * 菜单高亮判定。
 *
 * 注意：同一路径下可能存在多个菜单项，靠 query 区分（书架 / 导出与备份都是 /bookshelf）。
 * 只比路径会让两个菜单同时高亮，所以这里分两层判断：
 *   1. 带 query 的菜单项：路径 + query 全部匹配才高亮；
 *   2. 不带 query 的菜单项：路径匹配，且该路径没有被"带 query 的兄弟菜单"认领时才高亮。
 */
function isActive(item) {
  if (item.external) return false
  const [base, queryString] = String(item.path).split('?')
  const pathMatched = base === '/profile'
    ? route.path === '/profile'
    : route.path === base || route.path.startsWith(`${base}/`)
  if (!pathMatched) return false

  const wanted = new URLSearchParams(queryString || '')
  if (wanted.toString()) {
    for (const [key, value] of wanted.entries()) {
      if (String(route.query[key] ?? '') !== value) return false
    }
    return true
  }
  return !claimedByQueryItem(base)
}

/** 当前地址是否已被某个"带 query 的同路径菜单项"命中 */
function claimedByQueryItem(base) {
  return navGroups.some((group) => group.items.some((item) => {
    if (item.external) return false
    const [itemBase, queryString] = String(item.path).split('?')
    if (itemBase !== base || !queryString) return false
    for (const [key, value] of new URLSearchParams(queryString).entries()) {
      if (String(route.query[key] ?? '') !== value) return false
    }
    return true
  }))
}

async function go(item) {
  if (item.external) {
    // 管理端没有打进桌面安装包，必须打开部署站点的绝对地址。
    const url = await window.mnDesktop?.adminUrl?.()
    if (url) await window.mnDesktop.openExternal(url)
    return
  }
  if (route.fullPath !== item.path) router.push(item.path)
}

// 快捷键：Ctrl+B 侧栏、Ctrl+\ 章节栏、Ctrl+Enter 交给页面自行处理
function handleKeydown(event) {
  if (!(event.ctrlKey || event.metaKey)) return
  const key = event.key.toLowerCase()
  if (key === 'b') { event.preventDefault(); handleRailToggle() }
  if (key === '\\') { event.preventDefault(); toggleChapters() }
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  try {
    const response = await api.get('/novel/bookshelf')
    const list = response.data?.novels || response.data?.bookshelf || []
    novelCount.value = Array.isArray(list) ? list.length : 0
    apiReady.value = true
    const host = String(api.defaults.baseURL || '')
    if (host.startsWith('http')) apiLabel.value = host.replace(/^https?:\/\//, '').replace(/\/api$/, '')
  } catch {
    apiReady.value = false
  }
})
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
</script>

<style scoped>
.desktop-shell {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  overflow: hidden;
}
.shell-body { flex: 1; display: flex; min-height: 0; }

/* ===== 侧栏三态 ===== */
.rail-slot {
  width: 64px;
  flex: 0 0 64px;
  position: relative;
  transition: width var(--transition), flex-basis var(--transition);
}
.desktop-shell.rail-pinned .rail-slot,
.desktop-shell:has(.desktop-rail.pinned) .rail-slot { width: 216px; flex-basis: 216px; }

.desktop-rail {
  position: absolute;
  inset: 0 auto 0 0;
  width: 64px;
  display: flex;
  flex-direction: column;
  padding: 8px 8px 10px;
  background: var(--card);
  border-right: 1px solid var(--card-border);
  transition: width var(--transition), box-shadow var(--transition);
  overflow: hidden;
}
.desktop-rail.pinned,
.desktop-rail.hover-open { width: 216px; }
.desktop-rail.hover-open { box-shadow: 8px 0 20px rgba(32, 53, 42, 0.14); z-index: 30; }

.rail-head { display: flex; align-items: center; gap: 9px; padding: 2px 4px 10px; min-height: 40px; }
.brand-mark {
  width: 26px; height: 26px; flex: 0 0 26px;
  display: grid; place-items: center;
  border-radius: 7px; background: var(--primary); color: #fff;
  font-size: 13px; font-weight: 700;
}
.brand-name { font-size: 13.5px; font-weight: 700; white-space: nowrap; }

.rail-toggle {
  width: 100%; height: 26px; margin-bottom: 6px;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  border: 1px solid var(--card-border); border-radius: var(--radius);
  background: var(--card); color: var(--text-tertiary);
  font-family: inherit; font-size: 11px; cursor: pointer;
}
.rail-toggle:hover { background: var(--bg-alt); color: var(--text-secondary); }

.rail-nav { flex: 1; overflow-y: auto; overflow-x: hidden; min-height: 0; }
.rail-group { margin-bottom: 10px; }
.rail-group-title {
  padding: 4px 8px 5px; color: var(--text-tertiary);
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; white-space: nowrap;
}
.rail-item {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border: 0; border-radius: var(--radius);
  background: transparent; color: var(--text-secondary);
  font-family: inherit; font-size: 13px; text-align: left; cursor: pointer;
  transition: background var(--transition), color var(--transition);
  position: relative;
}
.rail-item + .rail-item { margin-top: 2px; }
.rail-item:hover { background: var(--bg-alt); color: var(--text); }
.rail-item.active { background: var(--primary-light); color: var(--primary); font-weight: 600; }
.ico { width: 18px; height: 18px; flex: 0 0 18px; display: grid; place-items: center; }
.ico :deep(svg) { width: 18px; height: 18px; }
.badge {
  margin-left: auto; padding: 0 6px; border-radius: 999px;
  background: var(--bg-alt); color: var(--text-tertiary); font-size: 11px;
}
.rail-item.active .badge { background: var(--primary-subtle); color: var(--primary-hover); }

.rail-foot { border-top: 1px solid var(--card-border); padding-top: 8px; }
.user-card {
  width: 100%; display: flex; align-items: center; gap: 9px;
  padding: 6px; border: 0; border-radius: var(--radius);
  background: transparent; cursor: pointer; text-align: left; font-family: inherit;
}
.user-card:hover { background: var(--bg-alt); }
.avatar {
  width: 28px; height: 28px; flex: 0 0 28px; display: grid; place-items: center;
  border-radius: 50%; background: var(--primary-subtle); color: var(--primary-hover);
  font-size: 12px; font-weight: 700;
}
.user-meta { min-width: 0; }
.user-meta strong { display: block; font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-meta span { display: block; font-size: 11px; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 收起态：只隐藏文字；悬停给出浮层提示 */
.desktop-rail:not(.pinned):not(.hover-open) .brand-name,
.desktop-rail:not(.pinned):not(.hover-open) .rail-group-title,
.desktop-rail:not(.pinned):not(.hover-open) .lbl,
.desktop-rail:not(.pinned):not(.hover-open) .badge,
.desktop-rail:not(.pinned):not(.hover-open) .user-meta { display: none; }
.desktop-rail:not(.pinned):not(.hover-open) .rail-head,
.desktop-rail:not(.pinned):not(.hover-open) .rail-item,
.desktop-rail:not(.pinned):not(.hover-open) .user-card { justify-content: center; }
.desktop-rail:not(.pinned):not(.hover-open) .rail-item::after {
  content: attr(data-tip);
  position: absolute; left: calc(100% + 10px); top: 50%; transform: translateY(-50%);
  padding: 4px 8px; border-radius: 6px; background: #20352a; color: #fff;
  font-size: 11px; white-space: nowrap; opacity: 0; pointer-events: none;
  transition: opacity 140ms var(--ease); z-index: 40;
}
.desktop-rail:not(.pinned):not(.hover-open) .rail-item:hover::after { opacity: 1; }

/* ===== 主区 ===== */
.desktop-main { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.desktop-topbar {
  height: 52px; flex: 0 0 52px;
  display: flex; align-items: center; gap: 12px;
  padding: 0 16px;
  background: var(--card);
  border-bottom: 1px solid var(--card-border);
}
.desktop-topbar h1 { font-size: 14px; font-weight: 700; }
.crumb { color: var(--text-tertiary); font-size: 12px; }
.spacer { flex: 1; }
.quick-search {
  display: flex; align-items: center; gap: 7px;
  width: 260px; padding: 6px 10px;
  border: 1px solid var(--card-border); border-radius: var(--radius);
  background: var(--bg); color: var(--text-tertiary); font-size: 12px;
}
.quick-search .ph { flex: 1; }
.quick-search kbd {
  font-family: var(--font-mono); font-size: 10px;
  padding: 1px 5px; border-radius: 4px;
  background: var(--card); border: 1px solid var(--card-border);
}
.top-btn {
  width: 30px; height: 30px; display: grid; place-items: center;
  border: 1px solid var(--card-border); border-radius: var(--radius);
  background: var(--card); color: var(--text-secondary); cursor: pointer;
}
.top-btn:hover { background: var(--bg-alt); }

.desktop-content { flex: 1; overflow: auto; min-height: 0; }

/* ===== 状态栏 ===== */
.desktop-statusbar {
  height: 26px; flex: 0 0 26px;
  display: flex; align-items: center; gap: 14px;
  padding: 0 12px;
  background: var(--card);
  border-top: 1px solid var(--card-border);
  color: var(--text-tertiary); font-size: 11px;
}
.desktop-statusbar .status { display: flex; align-items: center; gap: 6px; }
.desktop-statusbar .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-tertiary); }
.desktop-statusbar .dot.ok { background: var(--success); }
.desktop-statusbar .hint { color: var(--text-tertiary); }
</style>
