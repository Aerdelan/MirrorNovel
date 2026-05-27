const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  nickname: { type: String, default: '书友' },
  avatar: { type: String, default: '' },
  role: { type: String, enum: ['user', 'admin', 'importer'], default: 'user' },
  disabled: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  lastLoginAt: { type: Date, default: Date.now },
  tokens: { total: { type: Number, default: 0 }, used: { type: Number, default: 0 } },
  groupRewardClaimed: { type: Boolean, default: false },
  showAnnouncement: { type: Boolean, default: true },

  // 签到
  checkin: {
    lastDate: { type: String, default: '' },     // 上次签到日期 YYYY-MM-DD
    dayIndex: { type: Number, default: 0 },        // 当前周期第几天 (0-6)
    totalDays: { type: Number, default: 0 },       // 累计签到天数
  },

  // 邀请
  inviteCode: { type: String, unique: true, sparse: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  inviteCount: { type: Number, default: 0 },
  inviteRewards: { type: Number, default: 0 },     // 邀请累计获得的token

  modelConfig: {
    type: {
      provider: { type: String, enum: ['default', 'system', 'ollama', 'cloud'], default: 'default' },
      ollamaBaseUrl: { type: String, default: 'http://localhost:11434' },
      ollamaOutlineModel: { type: String, default: '' },
      ollamaWritingModel: { type: String, default: '' },
      ollamaPolishModel: { type: String, default: '' },
      ollamaReasoningModel: { type: String, default: '' },
      cloudBaseUrl: { type: String, default: '' },
      cloudApiKey: { type: String, default: '' },
      cloudOutlineModel: { type: String, default: '' },
      cloudWritingModel: { type: String, default: '' },
      cloudPolishModel: { type: String, default: '' },
      cloudReasoningModel: { type: String, default: '' },
    },
    default: () => ({ provider: 'default' }),
  },
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// 自动生成邀请码
userSchema.pre('save', function (next) {
  if (!this.inviteCode) {
    const hash = crypto.createHash('md5').update(this.email + Date.now()).digest('hex');
    this.inviteCode = hash.substring(0, 8);
  }
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.virtual('availableTokens').get(function () {
  return Math.max(0, this.tokens.total - this.tokens.used);
});

userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('User', userSchema);
