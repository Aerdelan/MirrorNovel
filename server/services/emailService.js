const nodemailer = require('nodemailer');

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
    ? '【红薯小说生成】注册验证码' 
    : '【红薯小说生成】密码重置验证码';
  
  const html = `
    <div style="max-width:600px;margin:0 auto;padding:20px;background:#fff;border-radius:10px;">
      <div style="text-align:center;padding:20px 0;">
        <h1 style="color:#FF6B35;margin:0;">📚 红薯小说生成</h1>
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
    from: `"红薯小说生成" <${process.env.EMAIL_USERNAME}>`,
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

module.exports = { sendVerificationCode, verifyTransporter };
