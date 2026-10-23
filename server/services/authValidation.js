const crypto = require('crypto');
const VerificationCode = require('../models/VerificationCode');
const { codeMaxAttempts } = require('../config/authPolicy');

const text = value => typeof value === 'string' ? value.trim() : '';
const normalizeEmail = value => text(value).toLowerCase();
const validEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
function passwordError(password) {
  if (typeof password !== 'string' || password.length < 6) return '密码至少6位';
  // bcrypt only uses the first 72 bytes; do not silently accept an ignored suffix.
  if (Buffer.byteLength(password, 'utf8') > 72) return '密码不能超过72字节（中文字符通常占3字节）';
  return '';
}

async function consumeCode(email, type, code) {
  // Count guesses atomically, including concurrent requests and legacy records.
  const verification = await VerificationCode.findOneAndUpdate({
    email, type, expiresAt: { $gt: new Date() },
    $or: [{ attempts: { $lt: codeMaxAttempts } }, { attempts: { $exists: false } }],
  }, { $inc: { attempts: 1 } }, { new: true, sort: { createdAt: -1 } });
  if (!verification || verification.code.length !== code.length ||
      !crypto.timingSafeEqual(Buffer.from(verification.code), Buffer.from(code))) return false;
  // Only one request can consume the same code. Never delete a newer resend.
  return Boolean(await VerificationCode.findOneAndDelete({ _id: verification._id, code }));
}

module.exports = { text, normalizeEmail, validEmail, passwordError, consumeCode };
