const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { toPublicModelConfig } = require('../config/modelPriceCatalog');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  nickname: { type: String, default: '书友' },
  avatar: { type: String, default: '' },
  role: { type: String, enum: ['user', 'admin', 'importer'], default: 'user' },
  disabled: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  lastLoginAt: { type: Date, default: Date.now },
  // tokens 保留给旧客户端；积分服务会在首次写入时从这里迁移并持续镜像。
  tokens: { total: { type: Number, default: 0 }, used: { type: Number, default: 0 } },
  points: {
    version: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    used: { type: Number, default: 0 },
  },
  pointsLedger: [{
    type: { type: String, enum: ['credit', 'debit'], required: true },
    points: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true, min: 0 },
    routeId: { type: String, default: '' },
    routeAlias: { type: String, default: '' },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    billableTokens: { type: Number, default: 0 },
    reason: { type: String, default: '' },
    referenceId: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  }],
  groupRewardClaimed: { type: Boolean, default: false },
  showAnnouncement: { type: Boolean, default: true },

  // 签到
  checkin: {
    lastDate: { type: String, default: '' },     // 上次签到日期 YYYY-MM-DD
    dayIndex: { type: Number, default: 0 },        // 当前周期第几天 (0-6)
    totalDays: { type: Number, default: 0 },       // 累计签到天数
  },

  // Activity attempts are kept for eligibility checks and reward auditing.
  activityClaims: [{
    activityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Activity', required: true },
    claimedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['completed', 'rejected'], default: 'completed' },
    won: { type: Boolean, default: true },
    points: { type: Number, min: 0, default: 0 },
    metric: { type: String, default: 'none' },
    metricValue: { type: Number, min: 0, default: 0 },
  }],

  // 邀请
  inviteCode: { type: String, unique: true, sparse: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  inviteCount: { type: Number, default: 0 },
  inviteRewards: { type: Number, default: 0 },     // 邀请累计获得的积分

  modelConfig: {
    type: {
      provider: { type: String, enum: ['default', 'system', 'ollama', 'cloud'], default: 'default' },
      routeId: { type: String, default: 'normal_1' },
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
  const source = Number(this.points?.version || 0) >= 1 ? this.points : this.tokens;
  return Math.max(0, Number(source?.total || 0) - Number(source?.used || 0));
});

userSchema.virtual('availablePoints').get(function () {
  const source = Number(this.points?.version || 0) >= 1 ? this.points : this.tokens;
  return Math.max(0, Number(source?.total || 0) - Number(source?.used || 0));
});

function sanitizeUserOutput(_doc, ret) {
  delete ret.password;
  ret.modelConfig = toPublicModelConfig(ret.modelConfig);
  return ret;
}

userSchema.set('toJSON', { virtuals: true, transform: sanitizeUserOutput });
userSchema.set('toObject', { virtuals: true, transform: sanitizeUserOutput });

module.exports = mongoose.model('User', userSchema);
