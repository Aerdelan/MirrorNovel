import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
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
    path: '/novel/:id',
    name: 'NovelDetail',
    component: () => import('../views/NovelDetailPage.vue'),
    meta: { title: '小说详情', requiresAuth: true },
  },
  {
    path: '/reference-upload',
    name: 'ReferenceUpload',
    component: () => import('../views/ReferenceUploadPage.vue'),
    meta: { title: '参考风格库', requiresAuth: true, requiresAdmin: true },
  },
  {
    path: '/reference-list',
    name: 'ReferenceList',
    component: () => import('../views/ReferenceListPage.vue'),
    meta: { title: '风格参考库', requiresAuth: true, requiresAdmin: true },
  },
  {
    path: '/polish',
    name: 'Polish',
    component: () => import('../views/PolishPage.vue'),
    meta: { title: '润色文本', requiresAuth: true },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 路由守卫
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

export default router
