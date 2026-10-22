const nodemailer = require('nodemailer');

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 创建邮件传输器（添加超时配置）
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD,
  },
  connectionTimeout: 8000,    // 连接超时 8 秒
  greetingTimeout: 8000,       // 问候超时 8 秒
  socketTimeout: 10000,        // Socket 超时 10 秒
});

/**
 * 发送验证码邮件
 * @param {string} to - 目标邮箱
 * @param {string} code - 验证码
 * @param {string} type - 验证码类型（register/reset）
 */
const sendVerificationCode = async (to, code, type = 'register') => {
  const subject = type === 'register' 
    ? '【MirrorNovel生成】注册验证码' 
    : '【MirrorNovel生成】密码重置验证码';
  
  const html = `
    <div style="max-width:600px;margin:0 auto;padding:20px;background:#fff;border-radius:10px;">
      <div style="text-align:center;padding:20px 0;">
        <h1 style="color:#FF6B35;margin:0;">📚 MirrorNovel生成</h1>
      </div>
      <div style="padding:20px;background:#f9f9f9;border-radius:8px;">
        <p style="font-size:16px;color:#333;">您好！</p>
        <p style="font-size:16px;color:#333;">您正在进行${type === 'register' ? '注册' : '密码重置'}操作，请使用以下验证码：</p>
        <div style="text-align:center;padding:20px 0;">
          <div style="display:inline-block;background:#FF6B35;color:white;font-size:32px;font-weight:bold;padding:15px 40px;border-radius:8px;letter-spacing:8px;">
            ${code}
          </div>
        </div>
        <p style="font-size:14px;color:#999;">验证码有效期为10分钟，请尽快使用。</p>
        <p style="font-size:14px;color:#999;">如果这不是您本人操作，请忽略此邮件。</p>
      </div>
    </div>
  `;

  const mailOptions = {
    from: `"MirrorNovel生成" <${process.env.EMAIL_USERNAME}>`,
    to,
    subject,
    html,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    markSendSuccess();
    // SMTP 回 250 只代表 163 收下了，不等于送达；messageId 落日志便于日后对账
    console.log(`[email] 已提交发信 → ${to}（messageId=${info?.messageId || '无'}）`);
    return info;
  } catch (error) {
    markSendFailure(error);
    throw error;
  }
};

/**
 * 验证邮箱配置是否可用（connect-only，不发信）
 */
const verifyTransporter = async () => {
  return new Promise((resolve) => {
    // 只验证连接。冷启动要完成 TCP + TLS + AUTH 三轮往返，5 秒在云服务器上
    // 很容易把“慢”误判成“配置不可用”，而旧实现一旦误判就永久停发，所以放宽到 15 秒。
    const verifyTimeout = setTimeout(() => {
      resolve({ ok: false, error: 'SMTP连接超时(15s)' });
    }, 15000);

    transporter.verify()
      .then(() => {
        clearTimeout(verifyTimeout);
        resolve({ ok: true });
      })
      .catch((err) => {
        clearTimeout(verifyTimeout);
        // cause 保留原始错误对象，健康状态需要它做粗分类
        resolve({ ok: false, error: err.message, cause: err });
      });
  });
};

/**
 * ===== 邮箱健康状态（可自愈）=====
 *
 * 旧实现是 routes/auth.js 里一个模块级布尔量：启动探测失败、或某次 sendMail 抛错，
 * 就一路 false 到进程重启，期间接口照样返回“验证码已发送”。网络抖一下就能把发信
 * 永久关掉，而且外面完全看不出来。状态收进本模块后，失败只推迟下一次探测，
 * 探测通过即自动恢复发信。
 */
const HEALTH_PROBE_BACKOFF_MS = [15000, 30000, 60000, 120000, 300000];

const emailHealth = {
  ok: true,          // 乐观起步：首次探测出结果前允许尝试发信（sendMail 自带超时兜底）
  checked: false,    // 供 /api/health 区分“还没测”和“测过且正常”
  error: '',         // 完整错误文本，只进服务日志，不对外
  kind: '',          // 对外只给粗分类，见 classifySmtpError
  checkedAt: 0,
  failures: 0,
};

let healthProbeTimer = null;

const stopHealthProbe = () => {
  if (healthProbeTimer) {
    clearTimeout(healthProbeTimer);
    healthProbeTimer = null;
  }
};

const scheduleHealthProbe = () => {
  stopHealthProbe();
  const index = Math.min(Math.max(emailHealth.failures - 1, 0), HEALTH_PROBE_BACKOFF_MS.length - 1);
  healthProbeTimer = setTimeout(() => {
    healthProbeTimer = null;
    probeEmailTransport();
  }, HEALTH_PROBE_BACKOFF_MS[index]);
  // 定时器不能拖住进程退出（测试收尾、优雅停机）
  healthProbeTimer.unref?.();
};

/** 完整错误文本：code / response 才是能定位的信息，压成一行方便 grep，仅写日志 */
const describeSmtpError = (error) => [
  error?.code,
  error?.responseCode,
  error?.response && String(error.response).trim(),
  error?.message,
].filter(Boolean).join(' | ').slice(0, 300) || '未知错误';

/**
 * 对外只暴露粗分类。/api/health 是不鉴权端点，把 SMTP 原始错误直接回显出去
 * 可能泄露发件邮箱、内网主机甚至凭据片段，所以外部只看类别，详情留在日志。
 */
const classifySmtpError = (source) => {
  const text = String(
    typeof source === 'string'
      ? source
      : [source?.code, source?.response, source?.message].filter(Boolean).join(' '),
  ).toLowerCase();
  if (/eauth|auth|login|535|invalid user|account error/.test(text)) return 'auth';
  // 注意 ETIMEDOUT 里并不含子串 "timeout"（是 timed + out），必须单列
  if (/timeout|etimedout|econntimeout|esmtptimeout|greeting/.test(text)) return 'timeout';
  if (/tls|ssl|cert/.test(text)) return 'tls';
  if (/econnrefused|refused|relay|esmtp|host not found|enotfound|eai_again/.test(text)) return 'unreachable';
  if (/enetdown|econnreset|epipe|network/.test(text)) return 'network';
  const code = typeof source === 'string' ? '' : String(source?.code || '');
  return code ? code.toLowerCase() : 'unknown';
};

const applyProbeResult = ({ ok, error, kind, cause }) => {
  emailHealth.checked = true;
  emailHealth.checkedAt = Date.now();
  if (ok) {
    if (!emailHealth.ok) console.log('✅ 邮箱服务已恢复，重新启用邮件发送');
    emailHealth.ok = true;
    emailHealth.error = '';
    emailHealth.kind = '';
    emailHealth.failures = 0;
    stopHealthProbe();
    return;
  }
  const detail = error || (cause ? describeSmtpError(cause) : '') || '未知错误';
  emailHealth.ok = false;
  emailHealth.error = detail;
  emailHealth.kind = kind || classifySmtpError(cause || detail);
  emailHealth.failures += 1;
  console.warn(`⚠️  邮箱服务不可用（连续 ${emailHealth.failures} 次，${emailHealth.kind}）：${detail}，将自动重探`);
  scheduleHealthProbe();
};

const probeEmailTransport = async () => {
  let result;
  try {
    result = await verifyTransporter();
  } catch (error) {
    result = { ok: false, cause: error };
  }
  applyProbeResult(result);
  return result;
};

/** 启动时调一次立刻探测；失败后由退避定时器接管，不需要外部再关心 */
const startEmailHealthCheck = () => { probeEmailTransport(); };

/** 本次发信成功即可判定可用，顺带清掉退避 */
const markSendSuccess = () => applyProbeResult({ ok: true });

/** 本次发信失败：记录真实错误并进入重探，不再永久静默降级 */
const markSendFailure = (error) => applyProbeResult({ ok: false, cause: error });

/** 同步读：本次要不要真的走 SMTP */
const isEmailReady = () => emailHealth.ok;

/** 供 /api/health 暴露：只给判断所需的事实，不回显原始错误与凭据 */
const getEmailStatus = () => ({
  ready: emailHealth.ok,
  probed: emailHealth.checked,
  consecutiveFailures: emailHealth.failures,
  lastCheckAt: emailHealth.checkedAt || null,
  errorKind: emailHealth.kind || '',
  configured: Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USERNAME && process.env.EMAIL_PASSWORD),
  host: process.env.EMAIL_HOST || '',
  port: process.env.EMAIL_PORT || '',
});

/** Send a low-frequency reminder for a major, user-confirmed story decision. */
const sendBlueprintProposalNotification = async (to, proposal, novelId) => {
  const title = escapeHtml(String(proposal?.title || '剧情蓝图优化建议').slice(0, 80));
  const summary = escapeHtml(String(proposal?.summary || 'AI 为后续剧情提出了新的蓝图建议。').slice(0, 800));
  const link = `${process.env.CLIENT_URL || 'http://localhost:5173'}/novel/${novelId}`;
  try {
  const info = await transporter.sendMail({
    from: `"MirrorNovel生成" <${process.env.EMAIL_USERNAME}>`,
    to,
    subject: `【MirrorNovel生成】《${String(proposal?.novelTitle || '你的小说').slice(0, 40)}》有一项重要剧情提案待确认`,
    html: `<div style="max-width:600px;margin:0 auto;padding:20px;font-family:Arial,sans-serif;background:#fff;border-radius:10px;">
      <h2 style="color:#FF6B35;">MirrorNovel 剧情蓝图提醒</h2>
      <p>AI 在已写内容基础上提出了一项重要剧情调整，应用前不会改变后续生成。</p>
      <div style="padding:16px;background:#f9f9f9;border-radius:8px;"><strong>${title}</strong><p>${summary}</p></div>
      <p><a href="${link}" style="color:#1677ff;">打开书籍详情并确认提案</a></p>
      <p style="color:#999;font-size:12px;">最终是否应用由你在项目内决定。</p>
    </div>`,
  });
  markSendSuccess();
  return info;
  } catch (error) {
    markSendFailure(error);
    throw error;
  }
};

module.exports = {
  sendVerificationCode,
  verifyTransporter,
  sendBlueprintProposalNotification,
  startEmailHealthCheck,
  isEmailReady,
  markSendFailure,
  markSendSuccess,
  getEmailStatus,
};
