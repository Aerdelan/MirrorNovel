/**
 * 桌面端侧栏菜单配置
 *
 * 与 Web 端底部 TabBar（components/TabBar.vue）保持一致，确保菜单不比原版少：
 *   生成 / 续写 / 润色 / 书架 / 我的  →  全部保留
 *   模型线路  →  桌面端新增的独立页面，用户自己填 URL / Key / 模型
 * 收起态与展开态共用这份配置，只隐藏文字，不存在"收起后少项"的问题。
 *
 * 文案：一律用 labelKey / titleKey 指向语言包（client/src/locales/desktop.*.js），
 * fallback 只作语言包缺失时的兜底，避免切换英文后侧栏残留中文。
 */

const icon = {
  generate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 1 6 6c0 2.5-1.2 4.5-3 6l-3 3-3-3c-1.8-1.5-3-3.5-3-6a6 6 0 0 1 6-6z"/><circle cx="12" cy="9" r="2"/></svg>',
  continue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
  polish: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.5 5L6 6.5 8.5 11l-5 1.5 5 1.5L6 19l4.5-2.5L12 22l1.5-5.5L18 19l-2.5-5 5-1.5-5-1.5L18 6.5l-4.5 2.5z"/></svg>',
  bookshelf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M8 8h8"/><path d="M8 12h6"/></svg>',
  persona: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/></svg>',
  exportIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>',
  model: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 13.6H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.7 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4v6c0 5-3.5 7.5-8 8-4.5-.5-8-3-8-8V7z"/></svg>',
}

/** 侧栏分组菜单（roles 控制可见性，与 Web 端 TabBar 的 roles 语义一致） */
export const navGroups = [
  {
    key: 'create',
    titleKey: 'desktop.nav.groupCreate',
    titleFallback: '创作',
    items: [
      { key: 'generate', labelKey: 'desktop.nav.generate', fallback: '生成小说', path: '/generate', icon: icon.generate, roles: ['user', 'admin', 'importer'] },
      { key: 'continue', labelKey: 'desktop.nav.continue', fallback: '小说续写', path: '/continue', icon: icon.continue, roles: ['user', 'admin', 'importer'] },
      { key: 'polish', labelKey: 'desktop.nav.polish', fallback: '润色文本', path: '/polish', icon: icon.polish, roles: ['user', 'admin', 'importer'] },
    ],
  },
  {
    key: 'works',
    titleKey: 'desktop.nav.groupWorks',
    titleFallback: '作品',
    items: [
      { key: 'bookshelf', labelKey: 'desktop.nav.bookshelf', fallback: '我的书架', path: '/bookshelf', icon: icon.bookshelf, roles: ['user', 'admin', 'importer'] },
      // 写作人格管理原本位于「我的」页内；单机版移除该页后暂不提供管理入口
      // （生成时仍沿用已保存的人格快照，不影响已有作品）。待专用页面做好后恢复此项。
      { key: 'export', labelKey: 'desktop.nav.export', fallback: '导出与备份', path: '/bookshelf?action=export', icon: icon.exportIcon, roles: ['user', 'admin', 'importer'] },
    ],
  },
  {
    key: 'account',
    titleKey: 'desktop.nav.groupAccount',
    titleFallback: '账户',
    items: [
      { key: 'profile', labelKey: 'desktop.nav.profile', fallback: '我的', path: '/profile', icon: icon.profile, roles: ['user', 'admin', 'importer'] },
      { key: 'model', labelKey: 'desktop.nav.modelRoutes', fallback: '模型线路', path: '/models', icon: icon.model, roles: ['user', 'admin', 'importer'] },
      { key: 'admin', labelKey: 'desktop.nav.admin', fallback: '管理端', path: '/admin-entry', icon: icon.admin, roles: ['admin'], external: true },
    ],
  },
]

/** 需要隐藏外壳（不使用侧栏）的路由名：登录类页面独占窗口 */
export const SHELL_LESS_ROUTES = ['Login', 'Register', 'ForgotPassword']

/** 顶部栏标题：路由名 → 语言包 key（缺失时回落到路由 meta.title） */
export const ROUTE_TITLE_KEYS = {
  Generate: 'desktop.title.generate',
  Continue: 'desktop.title.continue',
  Bookshelf: 'desktop.title.bookshelf',
  NovelDetail: 'desktop.title.novelDetail',
  Polish: 'desktop.title.polish',
  Profile: 'desktop.title.profile',
  ModelRoutes: 'desktop.title.modelRoutes',
}
