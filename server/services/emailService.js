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

  await transporter.sendMail(mailOptions);
};

/**
 * 验证邮箱配置是否可用（connect-only，不发信）
 */
const verifyTransporter = async () => {
  return new Promise((resolve) => {
    // 只验证连接，设置短超时
    const verifyTimeout = setTimeout(() => {
      resolve({ ok: false, error: 'SMTP连接超时' });
    }, 5000);

    transporter.verify()
      .then(() => {
        clearTimeout(verifyTimeout);
        resolve({ ok: true });
      })
      .catch((err) => {
        clearTimeout(verifyTimeout);
        resolve({ ok: false, error: err.message });
      });
  });
};

/**
 * 发送限免活动通知邮件
 * @param {string} to - 目标邮箱
 * @param {object} activity - 活动对象
 */
const sendActivityNotification = async (to, activity) => {
  const startDate = new Date(activity.startTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const endDate = new Date(activity.endTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const rewardPoints = activity.rewardPoints || activity.tokenAmount || 0;

  const html = `
    <div style="max-width:600px;margin:0 auto;padding:20px;background:#fff;border-radius:10px;">
      <div style="text-align:center;padding:20px 0;">
        <h1 style="color:#FF6B35;margin:0;">🎉 MirrorNovel生成 限免活动</h1>
      </div>
      <div style="padding:20px;background:#f9f9f9;border-radius:8px;">
        <p style="font-size:16px;color:#333;">亲爱的用户：</p>
        <p style="font-size:16px;color:#333;">
          <strong>MirrorNovel生成</strong> 将举办积分活动！完成活动条件即可获得
          <span style="color:#FF6B35;font-weight:bold;font-size:20px;">${rewardPoints}</span> 积分！
        </p>
        <div style="text-align:center;padding:20px 0;">
          <div style="display:inline-block;background:linear-gradient(135deg,#FF6B35,#ff8f5e);color:white;padding:15px 30px;border-radius:8px;">
            <div style="font-size:14px;opacity:0.9;">📅 活动时间</div>
            <div style="font-size:16px;font-weight:bold;margin-top:5px;">${startDate} 至 ${endDate}</div>
          </div>
        </div>
        <p style="font-size:15px;color:#555;text-align:center;">活动奖励 <strong>${rewardPoints} 积分</strong>，具体领取条件请以活动页面为准</p>
        <p style="font-size:14px;color:#999;text-align:center;margin-top:20px;">如有疑问，请加 QQ 群 1019601998 联系群主</p>
      </div>
    </div>
  `;

  const mailOptions = {
    from: `"MirrorNovel生成" <${process.env.EMAIL_USERNAME}>`,
    to,
    subject: `【MirrorNovel生成】积分活动：最高可得 ${rewardPoints} 积分`,
    html,
  };

  await transporter.sendMail(mailOptions);
};

/** Send a low-frequency reminder for a major, user-confirmed story decision. */
const sendBlueprintProposalNotification = async (to, proposal, novelId) => {
  const title = escapeHtml(String(proposal?.title || '剧情蓝图优化建议').slice(0, 80));
  const summary = escapeHtml(String(proposal?.summary || 'AI 为后续剧情提出了新的蓝图建议。').slice(0, 800));
  const link = `${process.env.CLIENT_URL || 'http://localhost:5173'}/novel/${novelId}`;
  await transporter.sendMail({
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
};

module.exports = { sendVerificationCode, verifyTransporter, sendActivityNotification, sendBlueprintProposalNotification };
