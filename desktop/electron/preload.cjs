/**
 * 预加载脚本：向渲染层暴露受限的桌面能力。
 * 只暴露必要方法，渲染层拿不到 Node API，保持 contextIsolation 的安全边界。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mnDesktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  // 窗口控制（自绘标题栏时使用）
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  // 应用能力
  getVersions: () => ipcRenderer.invoke('app:versions'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  apiTarget: () => ipcRenderer.invoke('api:target'),
  adminUrl: () => ipcRenderer.invoke('app:admin-url'),
  // 桌面专属：用系统对话框保存文本（导出章节/整本）
  saveTextFile: (payload) => ipcRenderer.invoke('file:save-text', payload),
  saveFile: (payload) => ipcRenderer.invoke('file:save', payload),
})
