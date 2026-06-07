// App 全局配置
const isNativeApp = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform()

const config = {
  // 在原生 App 中使用完整 URL，H5 中使用 /api 代理
  apiBase: isNativeApp ? 'http://43.159.149.223:3001/api' : '/api',
  serverHost: '43.159.149.223',
  serverPort: 3001,
}

export default config
