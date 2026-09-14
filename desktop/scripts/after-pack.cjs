/**
 * 打包后钩子（afterPack）：给 Windows 可执行文件写入图标与版本信息。
 *
 * 为什么需要它：
 * electron-builder 内置的 `signAndEditExecutable` 流程会连带触发 winCodeSign 工具包下载，
 * 该包内含 macOS 符号链接，在未开启"开发者模式"的 Windows 上解压会报
 * "客户端没有所需的特权" 并中断打包（与是否真的签名无关）。
 * 因此配置里关掉了内置流程，改由本钩子完成"改写 exe 资源"这一件事——
 * 使用 electron-builder 自带的纯 JS 库 resedit，不下载任何外部二进制。
 *
 * 走 resedit 的好处：跨平台、无权限要求、失败也不影响出包（下面做了兜底）。
 */
const fs = require('node:fs')
const path = require('node:path')

const PRODUCT_NAME = 'MirrorNovel'
const DESCRIPTION = 'MirrorNovel 桌面端'
const COPYRIGHT = 'Copyright © MirrorNovel'

/** 从 package.json 读取版本号并按 Windows 版本号格式切分（最多四段）。 */
function readVersion(projectDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'))
    const parts = String(pkg.version || '1.0.0')
      .split('.')
      .map((n) => parseInt(n, 10) || 0)
    while (parts.length < 4) parts.push(0)
    return parts.slice(0, 4)
  } catch {
    return [1, 0, 0, 0]
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const projectDir = context.packager.projectDir
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  // 必须用 .ico：resedit 不解析 PNG，喂 PNG 会得到 0 个图标并把图标组清空。
  const iconPath = path.join(projectDir, 'build', 'icon.ico')

  if (!fs.existsSync(exePath)) return

  let resedit
  try {
    // eslint-disable-next-line global-require
    resedit = require('resedit')
  } catch (error) {
    console.warn(`[afterPack] 未找到 resedit，跳过图标与版本信息写入：${error.message}`)
    return
  }

  try {
    const { NtExecutable, NtExecutableResource, Resource, Data } = resedit
    const executable = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true })
    const resource = NtExecutableResource.from(executable)

    // 1) 版本信息：文件资源管理器"属性 → 详细信息"里显示的内容。
    //    复用 Electron 自带的那一份版本块（Windows 只识别这种既有的结构），
    //    若用 createEmpty() 新建，字符串字段不会被系统读取。
    const [major, minor, build, revision] = readVersion(projectDir)
    const existing = Resource.VersionInfo.fromEntries(resource.entries)
    const versionInfo = existing.length ? existing[0] : Resource.VersionInfo.createEmpty()
    versionInfo.setFileVersion(major, minor, build, revision)
    versionInfo.setProductVersion(major, minor, build, revision)
    versionInfo.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        ProductName: PRODUCT_NAME,
        FileDescription: DESCRIPTION,
        CompanyName: PRODUCT_NAME,
        LegalCopyright: COPYRIGHT,
        InternalName: PRODUCT_NAME,
        OriginalFilename: `${PRODUCT_NAME}.exe`,
      }
    )
    // 去掉原有版本资源，避免出现两份（Windows 属性页可能读到字段为空的那一份）
    for (let i = resource.entries.length - 1; i >= 0; i -= 1) {
      if (resource.entries[i].type === 16 /* RT_VERSION */) resource.entries.splice(i, 1)
    }
    versionInfo.outputToResourceEntries(resource.entries)

    // 2) 图标：任务栏 / 快捷方式 / 文件资源管理器里看到的图标
    if (fs.existsSync(iconPath)) {
      const iconFile = Data.IconFile.from(fs.readFileSync(iconPath))
      const icons = iconFile.icons.map((item) => item.data)
      if (icons.length) {
        // 逐个替换已存在的图标组（electorn.exe 的组 id/lang 不固定，写死 1/1033 容易落空）
        const groups = Resource.IconGroupEntry.fromEntries(resource.entries)
        if (groups.length) {
          for (const group of groups) {
            Resource.IconGroupEntry.replaceIconsForResource(resource.entries, group.id, group.lang, icons)
          }
        } else {
          Resource.IconGroupEntry.replaceIconsForResource(resource.entries, 1, 1033, icons)
        }
      } else {
        console.warn(`[afterPack] ${path.basename(iconPath)} 解析出 0 个图标，跳过图标写入`)
      }
    } else {
      console.warn(`[afterPack] 缺少 ${path.relative(projectDir, iconPath)}，使用默认图标`)
    }

    resource.outputResource(executable)
    fs.writeFileSync(exePath, Buffer.from(executable.generate()))
    console.log(`[afterPack] 已写入图标与版本信息：${path.basename(exePath)} ${major}.${minor}.${build}`)
  } catch (error) {
    // 资源写入属于"锦上添花"，失败不应让整个打包失败。
    console.warn(`[afterPack] 写入 exe 资源失败，将使用默认图标：${error.message}`)
  }
}
