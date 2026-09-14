import { createWebHistory } from 'vue-router'
import { createAppRouter } from './createAppRouter'
import { routes } from './routes'

// Web 端入口：沿用 web history。
// 桌面端（Electron）从 './routes' 与 './createAppRouter' 分别取纯模块，
// 避免为了拿路由表而顺带实例化一个 web history 路由。
export { createAppRouter, routes }

export default createAppRouter(createWebHistory())
