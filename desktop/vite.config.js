import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

/**
 * 桌面端渲染层构建配置
 *
 * 关键：通过 alias 把 client/src 直接纳入编译，views / stores / api / locales / assets
 * 全部复用现有 Web 端代码，桌面端只新增外壳（DesktopShell）、导航配置与样式覆盖层。
 * 因此 Web 端的改动会自动同步到桌面端，不需要维护两份页面代码。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // 开发时后端地址：项目当前正式环境使用 IP 部署；域名属于另一套产品。
  // 可用 MN_SERVER 覆盖（如 http://localhost:3000、内测版地址或自建服务器）
  const apiTarget = env.MN_SERVER || 'http://43.159.149.223:5173'

  return {
    root: fileURLToPath(new URL('./src', import.meta.url)),
    // 渲染层始终由主进程内嵌的本地 HTTP 服务提供（从不以 file:// 加载），
    // 因此用绝对根路径：无论地址栏处于哪条路由，静态资源都能正确定位，
    // 不会出现"刷新后 assets 相对路径解析错位 → 白屏"的问题。
    base: '/',
    plugins: [vue()],
    resolve: {
      // 关键：client/ 与 desktop/ 各自装了一份 vue / vue-router / pinia / axios，
      // 而桌面端构建会把 client/src 一起编译进来。若不强制去重，产物里会有两份 Pinia，
      // 业务 store 读到的 activePinia 永远是 undefined，启动即白屏
      // （dev 模式 Vite 的依赖预打包会天然去重，所以只在打包后暴露）。
      dedupe: ['vue', 'vue-router', 'pinia', 'axios'],
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@client': fileURLToPath(new URL('../client/src', import.meta.url)),
        // client 内部使用 '@' 指向自身 src，这里保持其语义不变
        '@client-src': fileURLToPath(new URL('../client/src', import.meta.url)),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
          // SSE 长连接：禁掉超时并关闭缓冲，否则思考阶段会被切断
          timeout: 0,
          proxyTimeout: 0,
        },
      },
    },
    build: {
      outDir: fileURLToPath(new URL('./dist', import.meta.url)),
      emptyOutDir: true,
      chunkSizeWarningLimit: 1500,
    },
  }
})
