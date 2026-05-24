const mongoose = require('mongoose');

const verificationCodeSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  code: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ['register', 'reset'],
    default: 'register',
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// 自动删除过期验证码（TTL索引）
verificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// 按邮箱查询的索引
verificationCodeSchema.index({ email: 1, type: 1 });

module.exports = mongoose.model('VerificationCode', verificationCodeSchema);
