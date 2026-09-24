import { computed, onMounted, onUnmounted, ref } from 'vue'

/**
 * 桌面端偏好（持久化在 localStorage）
 *
 * 依据评审确认的 4 条交互规则：
 *  1. 侧栏默认状态按"当前窗口宽度"判断：≥1440 展开；1200–1440 收起；<1200 强制收起。
 *     用户手动切换后写入 railPref，优先级高于自动判断（可"恢复自动"）。
 *  2. 收起态鼠标移入 → 悬停浮层展开（不推挤正文），移出收回；<1200 时不启用（避免遮挡）。
 *  3. 章节栏（第二条栏）纯手动收起，只有用户点击才变化，不受窗口尺寸影响。
 *  4. 右侧检查器记住上次停留的页签。
 */

const KEY_RAIL = 'mn_rail_pref'
const KEY_CHAPTERS = 'mn_chapters_collapsed'
const KEY_INSP = 'mn_insp_tab'
const KEY_CHAPTERS_WIDTH = 'mn_chapters_width'

export const RAIL_BREAKPOINT_EXPAND = 1440
export const RAIL_BREAKPOINT_MIN = 1200

function read(key, fallback) {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value
  } catch {
    return fallback
  }
}

function write(key, value) {
  try { localStorage.setItem(key, value) } catch { /* 忽略隐私模式下的写入失败 */ }
}

// 偏好必须是模块级单例。DesktopShell 与 WorkbenchLayout 会同时调用本 composable；
// 若每次创建独立 ref，顶栏快捷键只会改到自己的副本，工作台章节栏不会即时响应。
const railPref = ref(read(KEY_RAIL, 'auto'))
const viewportWidth = ref(typeof window === 'undefined' ? RAIL_BREAKPOINT_EXPAND : window.innerWidth)
const railHovered = ref(false)
const chaptersCollapsed = ref(read(KEY_CHAPTERS, '0') === '1')
const chaptersWidth = ref(Number(read(KEY_CHAPTERS_WIDTH, '236')) || 236)
const inspectorTab = ref(read(KEY_INSP, 'context'))
let resizeSubscribers = 0

function handleResize() {
  viewportWidth.value = window.innerWidth
}

export function useDesktopPrefs() {
  // 侧栏：auto（按窗口判断）| expanded | collapsed
  const autoExpanded = computed(() => {
    if (viewportWidth.value < RAIL_BREAKPOINT_MIN) return false
    return viewportWidth.value >= RAIL_BREAKPOINT_EXPAND
  })

  /** 侧栏是否"固定展开"（用户选择优先于自动判断） */
  const railPinned = computed(() => {
    if (railPref.value === 'expanded') return true
    if (railPref.value === 'collapsed') return false
    return autoExpanded.value
  })

  /** 悬停浮层展开：仅收起态 + 窗口不低于下限时启用 */
  const railHoverOpen = computed(() =>
    !railPinned.value && viewportWidth.value >= RAIL_BREAKPOINT_MIN && railHovered.value
  )

  /** 侧栏可视宽度（用于布局计算） */
  const railExpandedVisual = computed(() => railPinned.value || railHoverOpen.value)

  function toggleRail() {
    railPref.value = railPinned.value ? 'collapsed' : 'expanded'
    write(KEY_RAIL, railPref.value)
  }

  function resetRailPref() {
    railPref.value = 'auto'
    write(KEY_RAIL, 'auto')
  }

  // 章节栏：纯手动
  function toggleChapters() {
    chaptersCollapsed.value = !chaptersCollapsed.value
    write(KEY_CHAPTERS, chaptersCollapsed.value ? '1' : '0')
  }
  function setChaptersWidth(width) {
    const next = Math.max(180, Math.min(420, Math.round(width)))
    chaptersWidth.value = next
    write(KEY_CHAPTERS_WIDTH, String(next))
  }

  // 检查器页签记忆
  function setInspectorTab(tab) {
    inspectorTab.value = tab
    write(KEY_INSP, tab)
  }

  onMounted(() => {
    resizeSubscribers += 1
    if (resizeSubscribers === 1) window.addEventListener('resize', handleResize)
  })
  onUnmounted(() => {
    resizeSubscribers = Math.max(0, resizeSubscribers - 1)
    if (resizeSubscribers === 0) window.removeEventListener('resize', handleResize)
  })

  return {
    // 侧栏
    railPref, railPinned, railHovered, railHoverOpen, railExpandedVisual,
    toggleRail, resetRailPref,
    // 章节栏
    chaptersCollapsed, chaptersWidth, toggleChapters, setChaptersWidth,
    // 检查器
    inspectorTab, setInspectorTab,
    // 环境
    viewportWidth,
  }
}
