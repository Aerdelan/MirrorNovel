// Real NSIS smoke test with an isolated product identity and a tiny inert exe.
// Never installs/uninstalls the production app or launches a real model client.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'

if (process.platform !== 'win32') throw Error('Windows is required')
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const suffix = randomBytes(5).toString('hex')
const root = path.join(desktop, 'release', `installer-smoke-${suffix}`)
const fixture = path.join(root, 'fixture'), installed = path.join(root, '安装 路径 with spaces')
const product = `MirrorNovelInstallerProbe-${suffix}`
const exeName = product + '.exe'
const children = new Set()
const run = (exe, args, timeout = 120000) => {
 const result = spawnSync(exe, args, { cwd: desktop, encoding: 'utf8', windowsHide: true, timeout, env: { ...process.env, SIGNTOOL_PATH: 'signtool.exe' } })
 if (result.error) throw result.error
 return result
}
const check = result => assert.equal(result.status, 0, (result.stdout || '') + (result.stderr || ''))
const payload = path.join(installed, 'resources', 'payload.txt')
const stopChild = async child => {
 if (!child) return
 try { child.kill() } catch {}
 await new Promise(resolve => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', resolve))
 children.delete(child)
}
let candidateInstaller, uninstaller
await fs.mkdir(path.join(fixture, 'resources'), { recursive: true })
const source = path.join(root, 'Probe.cs')
await fs.writeFile(source, 'using System.Reflection; [assembly: AssemblyFileVersion("1.1.1.0")] class Probe { static void Main() { System.Threading.Thread.Sleep(60000); } }')
check(run(path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), ['/nologo', '/target:winexe', `/out:${path.join(fixture, exeName)}`, source], 15000))
const legacyInclude = path.join(root, 'legacy.nsh')
await fs.writeFile(legacyInclude, '; Legacy defaults, for testing migration only.\n')
const builder = path.join(desktop, 'node_modules', 'electron-builder', 'cli.js')
async function build(legacy) {
 const label = legacy ? 'legacy' : 'candidate'
 await fs.writeFile(path.join(fixture, 'resources', 'payload.txt'), label)
 const config = {
  extends: null, appId: `top.blockstory.mirrornovel.installer-test.${suffix}`, productName: product,
  artifactName: `${label}.exe`, afterPack: null,
  extraMetadata: { name: `mn-installer-test-${suffix}`, version: legacy ? '1.1.1' : '1.1.2' },
  directories: { output: path.join(root, label), buildResources: path.join(desktop, 'build') },
  win: { target: ['nsis'], signAndEditExecutable: false },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
   createDesktopShortcut: false, createStartMenuShortcut: false, runAfterFinish: false, deleteAppDataOnUninstall: false,
   include: legacy ? legacyInclude : path.join(desktop, 'build', 'installer.nsh') },
 }
 const configPath = path.join(root, `${label}.json`)
 await fs.writeFile(configPath, JSON.stringify(config))
 const result = run(process.execPath, [builder, '--win', 'nsis', '--x64', '--prepackaged', fixture, '--config', configPath], 180000)
 check(result)
 console.log(`Built isolated ${label} installer`)
 return path.join(root, label, `${label}.exe`)
}
try {
 const legacy = await build(true)
 candidateInstaller = await build(false)
 const install = (installer, timeout = 60000) => run(installer, ['/S', '/currentuser', `/D=${installed}`], timeout)
 check(install(legacy))
 assert.equal(await fs.readFile(payload, 'utf8'), 'legacy')
 console.log('PASS: clean installation in a Chinese path with spaces')
 check(install(candidateInstaller))
 assert.equal(await fs.readFile(payload, 'utf8'), 'candidate')
 console.log('PASS: upgrade from the legacy installer')
 uninstaller = path.join(installed, 'Uninstall ' + exeName)

 const app = spawn(path.join(installed, exeName), [], { windowsHide: true, stdio: 'ignore' })
 children.add(app)
 await new Promise(resolve => setTimeout(resolve, 300))
 const running = install(candidateInstaller)
 assert.equal(running.status, 2, running.stderr || running.stdout)
 assert.equal(await fs.readFile(payload, 'utf8'), 'candidate')
 await stopChild(app)
 console.log('PASS: silent upgrade refuses a running app without changing files')

 const marker = path.join(root, 'locked.ready')
 const quote = value => "'" + value.replaceAll("'", "''") + "'"
 const lockScript = `$f=[IO.File]::Open(${quote(payload)},'Open','Read','None'); [IO.File]::WriteAllText(${quote(marker)},'ready'); Start-Sleep -Seconds 60; $f.Dispose()`
 const locker = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(lockScript, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' })
 children.add(locker)
 const deadline = Date.now() + 15000
 while (Date.now() < deadline) { try { await fs.access(marker); break } catch {} await new Promise(resolve => setTimeout(resolve, 100)) }
 await fs.access(marker)
 const start = Date.now()
 const blocked = install(candidateInstaller, 45000)
 assert.notEqual(blocked.status, 0, 'a locked payload must not be reported as a successful upgrade')
 await stopChild(locker)
 assert.equal(await fs.readFile(payload, 'utf8'), 'candidate', 'the failed upgrade must restore the previous payload')
 console.log(`PASS: locked-file upgrade returns an error in ${Date.now() - start}ms and preserves the old payload`)
 check(install(candidateInstaller))
 assert.equal(await fs.readFile(payload, 'utf8'), 'candidate')
 console.log('PASS: retry after releasing the lock succeeds')
 check(run(uninstaller, ['/S', '/KEEP_APP_DATA', '/currentuser'], 60000))
 // NSIS copies an uninstaller to %TEMP% and its launcher may exit before
 // that child has finished removing the installation.
 const uninstallDeadline = Date.now() + 30000
 let removed = false
 while (Date.now() < uninstallDeadline) {
  try { await fs.access(path.join(installed, exeName)) } catch { removed = true; break }
  await new Promise(resolve => setTimeout(resolve, 100))
 }
 assert.equal(removed, true, 'the uninstaller child must finish removing the isolated executable')
 console.log('PASS: isolated uninstall completes; production app and user data were not touched')
} finally {
 for (const child of [...children]) await stopChild(child)
 // Keep this isolated run's build/log files for inspection; no broad cleanup.
 console.log('Installer smoke artifacts: ' + root)
}
