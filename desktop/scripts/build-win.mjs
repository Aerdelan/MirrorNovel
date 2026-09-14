/**
 * Windows 打包入口（npm run dist 实际执行本脚本）。
 *
 * 为什么需要这一层包装，而不是直接写 "vite build && electron-builder"：
 *
 * 1. SIGNTOOL_PATH
 *    electron-builder 在签名阶段会调用 getToolPath()，若没有 SIGNTOOL_PATH，
 *    它会去下载 winCodeSign 工具包（5.6MB）。该包内含 macOS 的符号链接
 *    （darwin/10.12/lib/*.dylib），在未开启"开发者模式"的 Windows 上解压会报
 *    "客户端没有所需的特权"，进而让整个打包中断——即使项目根本没有配置签名证书。
 *    显式给出 SIGNTOOL_PATH 后走系统工具分支，既不下载也不再触发解压问题。
 *    （本项目未配置证书，签名流程本身会被 electron-builder 判定为 skip。）
 *
 * 2. 镜像
 *    国内网络下拉取 Electron 运行时与 NSIS 资源较慢，这里默认走 npmmirror；
 *    如需覆盖，直接设置同名环境变量即可（脚本不会覆盖已有值）。
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 未配置签名证书：只需给一个路径让 electron-builder 走"系统工具"分支，避免下载 winCodeSign。
// 将来要发布带签名的正式版，把 SIGNTOOL_PATH 指向真实的 signtool.exe 即可。
process.env.SIGNTOOL_PATH ||= 'signtool.exe'
process.env.ELECTRON_MIRROR ||= 'https://npmmirror.com/mirrors/electron/'
process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||= 'https://npmmirror.com/mirrors/electron-builder-binaries/'

// 直接用当前 Node 执行本地 CLI 脚本，避免 shell 解析带来的转义与安全告警。
const NODE = process.execPath
const localBin = (...segments) => path.join(desktopDir, 'node_modules', ...segments)

function run(args) {
  const result = spawnSync(NODE, args, { cwd: desktopDir, stdio: 'inherit', env: process.env })
  if (result.error) {
    console.error(`[build] 无法执行 ${args.join(' ')}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// 1) 渲染层产物（复用 client 源码，输出到 desktop/dist）
run([localBin('vite', 'bin', 'vite.js'), 'build'])
// 2) 生成图标（幂等；build/icon.png 供安装包与 exe 使用，electron/tray.png 供托盘使用）
run([path.join(desktopDir, 'scripts', 'make-icon.mjs')])
// 3) 打出 Windows 安装包（NSIS），产物在 desktop/release
run([localBin('electron-builder', 'cli.js')])
