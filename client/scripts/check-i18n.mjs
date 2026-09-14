/**
 * i18n 自检脚本：找出"界面用了 $t('xxx')，但英文语言包里没有这个 key"的地方。
 *
 * 为什么需要它：
 * useI18n 的 $t 在找不到当前语言的 key 时会**静默回退到中文**。
 * 于是"只在 zh.js 加了文案、忘了加 en.js"这类问题不会报错，
 * 只会表现为"切成英文后这一块还是中文"，很难发现（已踩过两次）。
 *
 * 用法：node scripts/check-i18n.mjs
 * 退出码非 0 表示存在缺失（适合挂到 CI）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')

/** 读取语言包（内容是纯对象字面量，去掉 export default 后直接求值） */
function loadLocale(relativePath) {
  const file = path.join(root, relativePath)
  // 语言包开头可能有注释，所以不锚定行首
  const source = fs.readFileSync(file, 'utf8').replace(/export\s+default\s*/, '')
  // 注意用括号包住：直接 `return {…}` 换行会被 ASI 解析成空 return
  // eslint-disable-next-line no-new-func
  return new Function(`return (${source})`)()
}

const en = loadLocale('client/src/locales/en.js')
const desktopEn = loadLocale('client/src/locales/desktop.en.js')
const zh = loadLocale('client/src/locales/zh.js')
const desktopZh = loadLocale('client/src/locales/desktop.zh.js')

function lookup(source, key) {
  return key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), source)
}

/**
 * 解析 key 在语言包里的真实位置。
 * `desktop.*` 是 useI18n 合并时加的段名（locales/desktop.*.js 的根就是这些 key），
 * 所以要先把前缀去掉，否则会把本来存在的文案误报成缺失。
 */
function resolveKey(key) {
  if (key.startsWith('desktop.')) {
    const stripped = key.slice('desktop.'.length)
    return { enValue: lookup(desktopEn, stripped), zhValue: lookup(desktopZh, stripped) }
  }
  return { enValue: lookup(en, key), zhValue: lookup(zh, key) }
}

/** 递归收集需要检查的源文件 */
function collect(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'locales') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collect(full, acc)
    else if (/\.(vue|js)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

const files = [
  ...collect(path.join(root, 'client', 'src')),
  ...collect(path.join(root, 'desktop', 'src')),
]

const problems = []
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(/\$t\('([^']+)'/g)) {
    const key = match[1]
    const { enValue, zhValue } = resolveKey(key)
    if (enValue !== undefined) continue
    problems.push({
      file: path.relative(root, file),
      key,
      // 中文也缺 = 界面上会直接显示裸 key，属于更严重的问题
      severity: zhValue === undefined ? 'MISSING_ALL' : 'MISSING_EN',
      zhValue,
    })
  }
}

if (!problems.length) {
  console.log('i18n OK：所有 $t() 用到的 key 都有英文文案')
  process.exit(0)
}

console.log(`发现 ${problems.length} 处英文缺失（$t 会回退成中文，用户看到的就是这个）：\n`)
for (const problem of problems) {
  const tag = problem.severity === 'MISSING_ALL' ? '[中英都缺]' : '[缺英文]'
  console.log(`${tag} ${problem.key}`)
  console.log(`        位置: ${problem.file}`)
  if (problem.zhValue !== undefined) console.log(`        当前显示(中文): ${JSON.stringify(problem.zhValue)}`)
}
process.exit(1)
