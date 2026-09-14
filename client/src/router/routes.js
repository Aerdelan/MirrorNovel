/**
 * 路由表（无副作用模块）
 *
 * 单独抽出来的原因：Web 端与桌面端（Electron）都要用同一份路由表，
 * 但两端的 history 实现不同（web history / hash history）。若路由表与
 * "创建 router 实例"写在同一个模块里，桌面端一旦 import 就会顺带执行
 * `createWebHistory()`（在 file:// 或本地服务下并不适用）。
 * 因此这里只导出纯数据，实例化交给各自的入口。
 */

export const routes = [
 {
  path: '/',
  redirect: '/generate',
 },
 {
  path: '/generate',
  name: 'Generate',
  component: () => import('../views/GeneratePage.vue'),
  meta: { title: '生成小说' },
 },
 {
  path: '/continue',
  name: 'Continue',
  component: () => import('../views/ContinuePage.vue'),
  meta: { title: '小说续写', requiresAuth: true },
 },
 {
  path: '/bookshelf',
  name: 'Bookshelf',
  component: () => import('../views/BookshelfPage.vue'),
  meta: { title: '我的书架', requiresAuth: true },
 },
 {
  path: '/profile',
  name: 'Profile',
  component: () => import('../views/ProfilePage.vue'),
  meta: { title: '我的' },
 },
 {
  path: '/login',
  name: 'Login',
  component: () => import('../views/LoginPage.vue'),
  meta: { title: '登录' },
 },
 {
  path: '/register',
  name: 'Register',
  component: () => import('../views/RegisterPage.vue'),
  meta: { title: '注册' },
 },
 {
  path: '/forgot-password',
  name: 'ForgotPassword',
  component: () => import('../views/ForgotPasswordPage.vue'),
  meta: { title: '找回密码' },
 },
 {
  path: '/novel/:id',
  name: 'NovelDetail',
  component: () => import('../views/NovelDetailPage.vue'),
  meta: { title: '小说详情', requiresAuth: true },
 },
 {
  path: '/polish',
  name: 'Polish',
  component: () => import('../views/PolishPage.vue'),
  meta: { title: '润色文本', requiresAuth: true },
 },
]

export default routes
