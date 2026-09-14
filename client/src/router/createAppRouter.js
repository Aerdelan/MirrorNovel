import { createRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { routes } from './routes'

/**
 * 创建应用路由（无副作用模块）
 *
 * history 与路由表由调用方注入：
 *  - Web 端：createWebHistory() + 完整路由表（见 ./index.js）
 *  - 桌面端：createWebHashHistory() + 去掉「我的」等单机版不适用的页面
 * 守卫只有一份，保证两端行为一致。
 */
export function createAppRouter(history, routeList = routes) {
  const router = createRouter({ history, routes: routeList })

  router.beforeEach((to, from, next) => {
    const authStore = useAuthStore()

    if (to.meta.requiresAuth && !authStore.isLoggedIn) {
      next({ name: 'Login', query: { redirect: to.fullPath } })
      return
    }

    if (to.meta.requiresAdmin && authStore.user?.role !== 'admin') {
      next({ name: 'Generate' })
      return
    }

    next()
  })

  return router
}

export default createAppRouter
