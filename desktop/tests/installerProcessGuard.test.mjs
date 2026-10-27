import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('installer process checks and shutdown are bounded and scoped to the selected directory', { skip: process.platform !== 'win32', timeout: 45000 }, async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mn-installer-guard-'))
 const target = path.join(root, '安装 目录 & target'), other = path.join(root, 'another copy')
 await fs.mkdir(target); await fs.mkdir(other)
 const executableName = 'MirrorNovelGuardProbe.exe'
 const probeSource = path.join(root, 'Probe.cs')
 await fs.writeFile(probeSource, 'class Probe { static void Main() { System.Threading.Thread.Sleep(60000); } }')
 const compiler = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
 const built = spawnSync(compiler, ['/nologo', '/target:winexe', `/out:${path.join(target, executableName)}`, probeSource], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
 assert.equal(built.status, 0, built.stderr || built.stdout)
 await fs.copyFile(path.join(target, executableName), path.join(other, executableName))
 const children = [target, other].map(dir => spawn(path.join(dir, executableName), [], { windowsHide: true, stdio: 'ignore' }))
 const script = fileURLToPath(new URL('../build/installer-process-guard.ps1', import.meta.url))
 const run = (mode, directory = target) => spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
  '-InstallDirectory', directory, '-ExecutableName', executableName, '-Mode', mode], { encoding: 'utf8', windowsHide: true, timeout: 14000 })
 try {
  await new Promise(resolve => setTimeout(resolve, 300))
  const absent = run('Check', path.join(root, 'not installed'))
  assert.equal(absent.status, 0, absent.stderr || absent.stdout)
  const check = run('Check')
  assert.equal(check.status, 2, check.stderr || check.stdout)
  const close = run('Close')
  assert.equal(close.status, 0, close.stderr || close.stdout)
  assert.equal(run('Check').status, 0)
  assert.doesNotThrow(() => process.kill(children[1].pid, 0), 'a copy in another folder must never be stopped')
 } finally {
  for (const child of children) { try { child.kill() } catch {} }
  await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))))
  // Only remove the exact temporary directory created by this test.
  const resolved = path.resolve(root)
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('mn-installer-guard-'))
  await fs.rm(resolved, { recursive: true, force: true })
 }
})
