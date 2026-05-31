import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5183,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        timeout: 1200000,
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
