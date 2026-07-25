import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 1200000, // 20 分钟超时，用于番茄全本下载
        proxyTimeout: 1200000,
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
