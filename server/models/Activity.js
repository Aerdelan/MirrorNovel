const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  name: { type: String, required: true },               // 活动名称，如"限免活动"
  startTime: { type: Date, required: true },             // 活动开始时间
  endTime: { type: Date, required: true },               // 活动结束时间
  tokenAmount: { type: Number, required: true },         // 登录赠送 Token 数量
  emailSent: { type: Boolean, default: false },          // 是否已发送通知邮件
  emailContent: { type: String, default: '' },           // 邮件正文
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

activitySchema.virtual('status').get(function () {
  const now = new Date();
  if (now < this.startTime) return 'pending';
  if (now > this.endTime) return 'ended';
  return 'active';
});

activitySchema.set('toJSON', { virtuals: true });
activitySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Activity', activitySchema);
