/**
 * 敏感字段封装（AES-256-GCM）
 *
 * 用途：用户选择"把模型 Key 存进账号"时，数据库里不能出现明文密钥——
 * 一旦数据库备份泄露、或管理员直连查看用户文档，密钥就等于公开。
 *
 * 设计：
 *  - 密钥由 MODEL_KEY_SECRET（推荐）或 JWT_SECRET 经 scrypt 派生，不额外引入依赖；
 *  - 存储格式 `enc:v1:<iv>:<tag>:<cipher>`，带版本号便于将来轮换算法；
 *  - open() 对未加密的历史数据（明文）原样返回，保证老账号不受影响；
 *  - 泄露面控制：只加密/解密，绝不把明文写日志。
 */

const crypto = require('node:crypto');

const PREFIX = 'enc:v1:';
const SALT = 'mirrornovel-model-key-v1';

function deriveKey() {
  const secret = process.env.MODEL_KEY_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('缺少 MODEL_KEY_SECRET / JWT_SECRET，无法加密模型密钥');
  }
  return crypto.scryptSync(String(secret), SALT, 32);
}

function isSealed(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** 加密明文；空值原样返回，避免把空字符串变成"看起来已配置"的密文。 */
function seal(plain) {
  const text = String(plain ?? '');
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/** 解密；对未加密的历史明文原样返回；解密失败返回空串（视为未配置，而不是抛错中断请求）。 */
function open(stored) {
  const value = String(stored ?? '');
  if (!value) return '';
  if (!isSealed(value)) return value;
  try {
    const [ivPart, tagPart, dataPart] = value.slice(PREFIX.length).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]);
    return plain.toString('utf8');
  } catch (error) {
    console.warn('[SecretBox] 模型密钥解密失败（可能是密钥轮换或数据损坏）');
    return '';
  }
}

/** 只保留尾部 4 位用于界面提示，绝不回传完整密钥。 */
function hintOf(plain) {
  const text = String(plain ?? '');
  if (!text) return '';
  return text.length <= 4 ? '****' : `****${text.slice(-4)}`;
}

module.exports = { seal, open, isSealed, hintOf, PREFIX };
