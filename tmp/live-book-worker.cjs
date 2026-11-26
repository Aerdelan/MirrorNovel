const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const directory = path.resolve(process.argv[2]);
const credential = fs.readFileSync(0, 'utf8').trim();
if (!credential) throw new Error('The test worker requires its credential on stdin');

const startedAt = new Date().toISOString();
const resumeIdentifier = startedAt.replace(/[:.]/g, '-');
const logPath = path.join(directory, 'worker.log');
const pidPath = path.join(directory, 'worker-pid.json');
const exitPath = path.join(directory, 'worker-exit.json');
const save = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
const redact = value => String(value || '').replaceAll(credential, '[redacted]');
if (fs.existsSync(exitPath)) fs.renameSync(exitPath, path.join(directory, `worker-exit.${resumeIdentifier}.json`));
if (fs.existsSync(pidPath)) fs.copyFileSync(pidPath, path.join(directory, `worker-pid.${resumeIdentifier}.json`));

const runner = spawn(process.execPath, [path.join(__dirname, 'live-book-runner.cjs'), '--out', directory,
  '--max-resumes', '2', '--trace-progress'], {
  cwd: path.dirname(__dirname), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
});
save(pidPath, { pid: process.pid, runner: runner.pid, startedAt });
for (const stream of [runner.stdout, runner.stderr]) {
  stream.setEncoding('utf8');
  let pending = '';
  stream.on('data', chunk => {
    pending += chunk;
    const boundary = pending.lastIndexOf('\n');
    if (boundary < 0) return;
    fs.appendFileSync(logPath, redact(pending.slice(0, boundary + 1)), 'utf8');
    pending = pending.slice(boundary + 1);
  });
  stream.on('end', () => { if (pending) fs.appendFileSync(logPath, redact(pending), 'utf8'); });
}
const finish = status => save(exitPath, { startedAt, finishedAt: new Date().toISOString(), ...status });
runner.on('error', error => finish({ error: redact(error.message) }));
runner.on('close', (code, signal) => finish({ code, signal }));
runner.stdin.on('error', error => fs.appendFileSync(logPath, redact(error.message) + '\n'));
runner.stdin.end(credential);
