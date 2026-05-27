import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    redirect: '/login',
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginPage.vue'),
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('../views/AdminPage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/users',
    name: 'Users',
    component: () => import('../views/AdminPage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/novels',
    name: 'Novels',
    component: () => import('../views/AdminPage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/distill',
    name: 'Distill',
    component: () => import('../views/AdminPage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/models',
    name: 'Models',
    component: () => import('../views/AdminPage.vue'),
    meta: { requiresAuth: true },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to, from, next) => {
  if (to.meta.requiresAuth) {
    const token = localStorage.getItem('admin_token')
    if (!token) return next('/login')
  }
  next()
})

export default router
