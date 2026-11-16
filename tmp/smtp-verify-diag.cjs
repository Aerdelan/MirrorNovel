// 临时诊断：用 server/.env 的 SMTP 凭据做 connect-only 握手（verify），不发送任何邮件。
// 输出只含结果与错误分类，绝不打印凭据内容。
const path = require('path');
const fs = require('fs');

const serverDir = path.join(__dirname, '..', 'server');
const nodemailer = require(path.join(serverDir, 'node_modules', 'nodemailer'));

const envText = fs.readFileSync(path.join(serverDir, '.env'), 'utf8');
const env = Object.fromEntries(
  envText.split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).trim()];
    }),
);

const has = Boolean(env.EMAIL_HOST && env.EMAIL_USERNAME && env.EMAIL_PASSWORD);
console.log(`configured=${has} host=${env.EMAIL_HOST} port=${env.EMAIL_PORT} secure=${env.EMAIL_SECURE} user=${env.EMAIL_USERNAME ? env.EMAIL_USERNAME.slice(0, 4) + '***' : '(空)'}`);

const transporter = nodemailer.createTransport({
  host: env.EMAIL_HOST,
  port: parseInt(env.EMAIL_PORT, 10),
  secure: env.EMAIL_SECURE === 'true',
  auth: { user: env.EMAIL_USERNAME, pass: env.EMAIL_PASSWORD },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 15000,
});

const classify = (err) => {
  const t = [err?.code, err?.response, err?.message].filter(Boolean).join(' ').toLowerCase();
  if (/eauth|auth|login|535|invalid user|account error/.test(t)) return 'auth';
  if (/timeout|etimedout|econntimeout|greeting/.test(t)) return 'timeout';
  if (/tls|ssl|cert/.test(t)) return 'tls';
  if (/refused|enotfound|eai_again/.test(t)) return 'unreachable';
  return err?.code || 'unknown';
};

transporter.verify()
  .then(() => { console.log('VERIFY_OK: 本地凭据握手成功（TCP+TLS+AUTH 全部通过）'); process.exit(0); })
  .catch((err) => {
    console.log(`VERIFY_FAIL: kind=${classify(err)} code=${err?.code || '-'} response=${String(err?.response || err?.message || '').slice(0, 200)}`);
    process.exit(1);
  });
