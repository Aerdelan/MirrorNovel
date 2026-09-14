import { createWebHashHistory } from 'vue-router'
// 只引用"无副作用"模块：路由表 + 工厂函数。
// 若从 '@client/router' 引入，会在 import 期间顺带创建 web-history 路由实例。
import { routes as clientRoutes } from '@client/router/routes'
import { createAppRouter } from '@client/router/createAppRouter'
import ModelRoutesPage from '../views/ModelRoutesPage.vue'
import NovelWorkbench from '../views/NovelWorkbench.vue'

/**
 * 桌面端路由
 *
 * 与 Web 端的差异：
 *  1. history 用 hash：打包后以本地服务 / file:// 加载时，web history 无法定位文件；
 *  2. 新增「模型线路」页：单机版用户自己填 URL / Key / 模型（支持"只存本地"与"存进账号"）；
 *  3. 其余页面（含「我的」）与 Web 端共用同一份路由表。
 */
export function desktopRouteList() {
  // 作品详情页换成"三栏工作台"（章节栏 + 正文区 + 上下文检查器）：
  // 内部仍然渲染 Web 端同一个 NovelDetailPage，生成 / 编辑 / 去 AI 味 / 导出等能力不变，
  // 桌面端只是把章节列表与上下文信息放到两侧常驻，避免写长篇时来回跳页。
  const withWorkbench = clientRoutes.map((route) => (route.name === 'NovelDetail'
    ? { ...route, component: NovelWorkbench, meta: { ...route.meta, workbench: true } }
    : route))

  return [
    ...withWorkbench,
    {
      path: '/models',
      name: 'ModelRoutes',
      component: ModelRoutesPage,
      // 标题由 navItems 的 ROUTE_TITLE_KEYS 提供（支持中英切换），这里不再写死文案
      meta: { requiresAuth: true },
    },
  ]
}

export function createDesktopRouter() {
  return createAppRouter(createWebHashHistory(), desktopRouteList())
}

export default createDesktopRouter
