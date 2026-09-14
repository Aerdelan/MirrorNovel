/**
 * MirrorNovel 桌面端主进程
 *
 * 设计要点：
 * 1. 渲染层复用 client 的 Vue 代码，主进程只负责窗口、菜单、托盘与"网络接入"。
 * 2. 开发模式直连 Vite dev server（自带 /api 代理）；打包后用内嵌的本地
 *    HTTP 服务同时承担"静态资源"与"/api 反向代理"，这样渲染层里所有相对路径
 *    的 /api 请求都能原样工作，无需为了桌面端改动业务代码。
 * 3. 代理必须支持 SSE 流式透传（长篇生成的思考/正文都是 SSE），因此禁用缓冲与超时。
 */

const { app, BrowserWindow, ipcMain, shell, Menu, Tray, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const { URL } = require('node:url')

const DIST_DIR = path.join(__dirname, '..', 'dist')
const DEV_SERVER = process.env.MN_DEV_SERVER || ''
// 默认后端：指向正式服务器（该站点的 nginx 同源提供 /api）。
// 注意 www.blockstory.top 是内测版，不要作为默认值。
// 可用 MN_API_TARGET 环境变量改成自建服务器地址。
const API_TARGET = process.env.MN_API_TARGET || 'http://43.159.149.223:5173'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
}

let mainWindow = null
let tray = null
let localServer = null

// ===== 窗口尺寸记忆（桌面端基本体验） =====
function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json')
}
function loadState() {
  try {
    const raw = fs.readFileSync(stateFile(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && Number.isFinite(parsed.width) && Number.isFinite(parsed.height)) return parsed
  } catch { /* 首次启动没有状态文件 */ }
  return { width: 1280, height: 800, maximized: false }
}
function saveState() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    const bounds = mainWindow.getNormalBounds ? mainWindow.getNormalBounds() : mainWindow.getBounds()
    fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized: mainWindow.isMaximized() }))
  } catch { /* 忽略写入失败 */ }
}

// ===== /api 反向代理（支持 SSE 流式透传） =====
function proxyApi(req, res) {
  let target
  try {
    target = new URL(req.url, API_TARGET)
  } catch {
    res.writeHead(400).end('bad api target')
    return
  }
  const client = target.protocol === 'https:' ? https : http
  const headers = { ...req.headers, host: target.host }
  delete headers['accept-encoding'] // 避免压缩后再解压，SSE 更稳

  const upstream = client.request(
    { protocol: target.protocol, hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers },
    (upstreamRes) => {
      // 关闭一切缓冲，保证流式内容尽快到达渲染层
      res.writeHead(upstreamRes.statusCode || 502, {
        ...upstreamRes.headers,
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      })
      upstreamRes.pipe(res)
    }
  )
  upstream.setTimeout(0) // 长连接不设超时（思考阶段可能数分钟无数据）
  upstream.on('error', (error) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ message: `无法连接后端：${error.message}` }))
  })
  req.pipe(upstream)
}

// ===== 打包后的本地静态服务 + 代理 =====
// 端口必须尽量固定：localStorage / IndexedDB 是按"源"（scheme + host + port）隔离的，
// 如果每次启动都换随机端口，用户看到的现象就是"每次打开都要重新登录，自己配的模型线路也没了"。
// 这里从固定端口开始顺延尝试，保证多次启动落在同一个源上。
const PREFERRED_PORTS = [39741, 39742, 39743, 39744, 39745];

function listenOn(server, port) {
  return new Promise((resolve) => {
    const onError = (error) => {
      server.removeListener('listening', onListening);
      resolve({ ok: false, error });
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve({ ok: true });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/api')) return proxyApi(req, res)

      const urlPath = decodeURIComponent(req.url.split('?')[0])
      let filePath = path.join(DIST_DIR, urlPath === '/' ? 'index.html' : urlPath)
      // 防目录穿越
      if (!filePath.startsWith(DIST_DIR)) filePath = path.join(DIST_DIR, 'index.html')
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        // 资源类请求（带扩展名）缺失时如实返回 404：
        // 如果一律回退 index.html，浏览器会拿到 text/html 的"脚本"并静默白屏，极难排查。
        const missingExt = path.extname(filePath).toLowerCase()
        if (missingExt && missingExt !== '.html') {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          res.end(`not found: ${urlPath}`)
          return
        }
        filePath = path.join(DIST_DIR, 'index.html') // SPA 兜底
      }
      const ext = path.extname(filePath).toLowerCase()
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' })
      fs.createReadStream(filePath).pipe(res)
    })
    server.on('error', reject)
    ;(async () => {
      for (const port of PREFERRED_PORTS) {
        // eslint-disable-next-line no-await-in-loop
        const result = await listenOn(server, port)
        if (result.ok) {
          console.log(`[desktop] 本地服务已就绪：http://127.0.0.1:${port}`)
          resolve(port)
          return
        }
      }
      // 固定端口全被占用（少见）：退回随机端口，功能不受影响，但存储源会变化
      const fallback = await listenOn(server, 0)
      if (fallback.ok) resolve(server.address().port)
      else reject(fallback.error)
    })()
  })
}

// ===== 窗口 =====
async function createWindow() {
  const state = loadState()
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#f3f7f2',
    title: 'MirrorNovel',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  if (state.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (DEV_SERVER) {
    await mainWindow.loadURL(DEV_SERVER)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    const port = await startLocalServer()
    localServer = true
    await mainWindow.loadURL(`http://127.0.0.1:${port}/index.html`)
  }

  mainWindow.on('resize', saveState)
  mainWindow.on('move', saveState)
  mainWindow.on('close', saveState)
  mainWindow.on('closed', () => { mainWindow = null })

  // 外部链接交给系统浏览器，避免在应用窗口里打开登录页/文档
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '重新载入', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'resetZoom', label: '实际大小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', click: () => mainWindow?.webContents.toggleDevTools() },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ===== IPC：窗口控制与桌面能力 =====
function registerIpc() {
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:is-maximized', () => Boolean(mainWindow?.isMaximized()))
  ipcMain.handle('app:versions', () => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    app: app.getVersion(),
  }))
  ipcMain.handle('app:open-external', (_event, url) => {
    if (typeof url === 'string' && /^https?:/i.test(url)) return shell.openExternal(url)
    return false
  })
  // 导出章节/整本时用系统保存对话框，这是 Web 端做不到的桌面能力
  ipcMain.handle('file:save-text', async (_event, { defaultName, content }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName || 'novel.txt',
      filters: [{ name: '文本文件', extensions: ['txt'] }, { name: '全部文件', extensions: ['*'] }],
    })
    if (result.canceled || !result.filePath) return { saved: false }
    fs.writeFileSync(result.filePath, String(content ?? ''), 'utf8')
    return { saved: true, filePath: result.filePath }
  })
  ipcMain.handle('api:target', () => API_TARGET)
}

function createTray() {
  // 托盘：生成过程中关闭窗口也能继续跑，点击托盘重新打开
  const iconPath = path.join(__dirname, 'tray.png')
  if (!fs.existsSync(iconPath)) return
  tray = new Tray(iconPath)
  tray.setToolTip('MirrorNovel')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => { if (mainWindow) mainWindow.show(); else createWindow() } },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]))
  tray.on('click', () => { if (mainWindow) mainWindow.show() })
}

app.whenReady().then(async () => {
  app.setAppUserModelId('top.blockstory.mirrornovel')
  registerIpc()
  buildMenu()
  await createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // 托盘常驻时保持后台生成；macOS 常规行为同样不退出
  if (process.platform === 'darwin' || tray) return
  app.quit()
})
