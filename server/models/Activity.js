const mongoose = require('mongoose');

const ACTIVITY_TYPES = [
  'login',
  'checkin',
  'writing',
  'continuous',
  'invite',
  'lottery',
  'new_user',
  'custom',
];

const REQUIREMENT_METRICS = [
  'none',
  'checkin_days',
  'invite_count',
  'novel_count',
  'chapter_count',
  'word_count',
  'account_age_days',
];

const requirementSchema = new mongoose.Schema({
  metric: { type: String, enum: REQUIREMENT_METRICS, default: 'none' },
  operator: { type: String, enum: ['gte', 'lte'], default: 'gte' },
  threshold: { type: Number, min: 0, default: 0 },
}, { _id: false });

const counterSchema = new mongoose.Schema({
  attempts: { type: Number, min: 0, default: 0 },
  winners: { type: Number, min: 0, default: 0 },
  pointsAwarded: { type: Number, min: 0, default: 0 },
}, { _id: false });

const activitySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, default: '', trim: true, maxlength: 300 },
  type: { type: String, enum: ACTIVITY_TYPES, default: 'login' },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },

  rewardPoints: { type: Number, min: 1 },
  minRewardPoints: { type: Number, min: 1 },
  maxRewardPoints: { type: Number, min: 1 },
  tokenAmount: { type: Number, min: 1 }, // Legacy field; interpreted as points.
  probability: { type: Number, min: 0, max: 100, default: 100 },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard', 'custom'], default: 'easy' },
  requirement: { type: requirementSchema, default: () => ({ metric: 'none', threshold: 0 }) },

  dailyLimit: { type: Number, min: 0, default: 1 },
  perUserLimit: { type: Number, min: 0, default: 1 },
  totalLimit: { type: Number, min: 0, default: 0 },
  totalPointsBudget: { type: Number, min: 0, default: 0 },
  enabled: { type: Boolean, default: true },
  autoClaim: { type: Boolean, default: false },
  counters: { type: counterSchema, default: () => ({}) },

  emailSent: { type: Boolean, default: false },
  emailContent: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

activitySchema.pre('validate', function normalizeLegacyReward(next) {
  if (!this.rewardPoints && this.tokenAmount) this.rewardPoints = this.tokenAmount;
  if (!this.tokenAmount && this.rewardPoints) this.tokenAmount = this.rewardPoints;
  if (!this.rewardPoints) this.invalidate('rewardPoints', 'rewardPoints is required');

  if (!this.minRewardPoints) this.minRewardPoints = this.rewardPoints;
  if (!this.maxRewardPoints) this.maxRewardPoints = this.rewardPoints;
  if (this.minRewardPoints > this.maxRewardPoints) {
    this.invalidate('maxRewardPoints', 'maxRewardPoints must be greater than or equal to minRewardPoints');
  }
  if (this.endTime <= this.startTime) {
    this.invalidate('endTime', 'endTime must be later than startTime');
  }
  next();
});

activitySchema.virtual('status').get(function getStatus() {
  if (!this.enabled) return 'disabled';
  const now = new Date();
  if (now < this.startTime) return 'pending';
  if (now > this.endTime) return 'ended';
  return 'active';
});

activitySchema.set('toJSON', { virtuals: true });
activitySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Activity', activitySchema);
module.exports.ACTIVITY_TYPES = ACTIVITY_TYPES;
module.exports.REQUIREMENT_METRICS = REQUIREMENT_METRICS;
