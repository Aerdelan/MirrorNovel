const crypto = require('crypto');
const Activity = require('../models/Activity');
const Novel = require('../models/Novel');
const User = require('../models/User');
const {
  buildPointsMutationFields,
  getPointsSnapshot,
} = require('./pointsService');

const ACTIVITY_CATALOG = Object.freeze([
  { type: 'login', label: '登录奖励', suggestedMetric: 'none' },
  { type: 'checkin', label: '每日签到阶梯', suggestedMetric: 'checkin_days' },
  { type: 'writing', label: '写作字数挑战', suggestedMetric: 'word_count' },
  { type: 'continuous', label: '连续创作任务', suggestedMetric: 'chapter_count' },
  { type: 'invite', label: '邀请好友奖励', suggestedMetric: 'invite_count' },
  { type: 'lottery', label: '幸运抽奖', suggestedMetric: 'none' },
  { type: 'new_user', label: '新手任务', suggestedMetric: 'account_age_days' },
  { type: 'custom', label: '自定义挑战', suggestedMetric: 'none' },
]);

const METRIC_LABELS = Object.freeze({
  none: '无需门槛',
  checkin_days: '累计签到天数',
  invite_count: '成功邀请人数',
  novel_count: '作品数量',
  chapter_count: '已生成章节数',
  word_count: '累计创作字数',
  account_age_days: '注册天数',
});

class ActivityClaimError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ActivityClaimError';
    this.code = code;
    this.status = status;
  }
}

function positiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function rewardRange(activity) {
  const fixed = positiveInteger(activity.rewardPoints || activity.tokenAmount);
  const min = positiveInteger(activity.minRewardPoints, fixed);
  const max = Math.max(min, positiveInteger(activity.maxRewardPoints, fixed || min));
  return { min, max };
}

function randomReward(activity) {
  const { min, max } = rewardRange(activity);
  if (max <= min) return min;
  return crypto.randomInt(min, max + 1);
}

function drawPrize(probability) {
  const percentage = Math.max(0, Math.min(100, Number(probability ?? 100)));
  if (percentage >= 100) return true;
  if (percentage <= 0) return false;
  return crypto.randomInt(0, 1_000_000) < Math.round(percentage * 10_000);
}

function activityIdOf(claim) {
  return String(claim?.activityId?._id || claim?.activityId || '');
}

function activeStatus(activity, now = new Date()) {
  if (activity.enabled === false) return 'disabled';
  if (now < new Date(activity.startTime)) return 'pending';
  if (now > new Date(activity.endTime)) return 'ended';
  return 'active';
}

async function collectUserMetrics(user) {
  let writing = {};
  try {
    const result = await Novel.aggregate([
      { $match: { userId: user._id } },
      {
        $group: {
          _id: null,
          novelCount: { $sum: 1 },
          chapterCount: { $sum: { $size: { $ifNull: ['$chapters', []] } } },
          wordCount: { $sum: { $ifNull: ['$currentWordCount', 0] } },
        },
      },
    ]);
    writing = result[0] || {};
  } catch (error) {
    // A metrics failure should only block activities that rely on writing data.
    writing = { metricsError: error.message };
  }

  const createdAt = new Date(user.createdAt || Date.now());
  const accountAgeDays = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86_400_000));
  return {
    none: 0,
    checkin_days: Number(user.checkin?.totalDays || 0),
    invite_count: Number(user.inviteCount || 0),
    novel_count: Number(writing.novelCount || 0),
    chapter_count: Number(writing.chapterCount || 0),
    word_count: Number(writing.wordCount || 0),
    account_age_days: accountAgeDays,
    metricsError: writing.metricsError || '',
  };
}

function evaluateEligibility(activity, user, metrics, now = new Date()) {
  const status = activeStatus(activity, now);
  if (status !== 'active') {
    const labels = { disabled: '活动未启用', pending: '活动尚未开始', ended: '活动已结束' };
    return { eligible: false, code: `ACTIVITY_${status.toUpperCase()}`, reason: labels[status], status };
  }

  const id = String(activity._id);
  const claims = (user.activityClaims || []).filter((claim) => activityIdOf(claim) === id && claim.status !== 'rejected');
  const perUserLimit = Number(activity.perUserLimit || 0);
  if (perUserLimit > 0 && claims.length >= perUserLimit) {
    return { eligible: false, code: 'USER_LIMIT_REACHED', reason: '已达到本活动参与次数上限', status };
  }

  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const todayClaims = claims.filter((claim) => new Date(claim.claimedAt || 0) >= dayStart);
  const dailyLimit = Number(activity.dailyLimit || 0);
  if (dailyLimit > 0 && todayClaims.length >= dailyLimit) {
    return { eligible: false, code: 'DAILY_LIMIT_REACHED', reason: '今日参与次数已用完', status };
  }

  const requirement = activity.requirement || {};
  const metric = requirement.metric || 'none';
  const threshold = Number(requirement.threshold || 0);
  const value = Number(metrics[metric] || 0);
  const operator = requirement.operator === 'lte' ? 'lte' : 'gte';
  const passed = metric === 'none' || (operator === 'lte' ? value <= threshold : value >= threshold);
  if (!passed) {
    return {
      eligible: false,
      code: 'REQUIREMENT_NOT_MET',
      reason: `${METRIC_LABELS[metric] || '任务进度'}未达到领取条件`,
      status,
      metric,
      operator,
      value,
      threshold,
    };
  }

  return {
    eligible: true,
    code: 'ELIGIBLE',
    reason: '',
    status,
    metric,
    operator,
    value,
    threshold,
    remainingToday: dailyLimit > 0 ? Math.max(0, dailyLimit - todayClaims.length) : null,
    remainingTotal: perUserLimit > 0 ? Math.max(0, perUserLimit - claims.length) : null,
  };
}

function publicActivity(activity, eligibility) {
  const source = typeof activity.toObject === 'function' ? activity.toObject({ virtuals: true }) : activity;
  const range = rewardRange(source);
  const counters = source.counters || {};
  return {
    id: String(source._id),
    name: source.name,
    description: source.description || '',
    type: source.type || 'login',
    status: eligibility?.status || activeStatus(source),
    startTime: source.startTime,
    endTime: source.endTime,
    reward: range,
    probability: Number(source.probability ?? 100),
    difficulty: source.difficulty || 'easy',
    requirement: source.requirement || { metric: 'none', operator: 'gte', threshold: 0 },
    limits: {
      daily: Number(source.dailyLimit || 0),
      perUser: Number(source.perUserLimit || 0),
      total: Number(source.totalLimit || 0),
      pointsBudget: Number(source.totalPointsBudget || 0),
    },
    counters: {
      attempts: Number(counters.attempts || 0),
      winners: Number(counters.winners || 0),
      pointsAwarded: Number(counters.pointsAwarded || 0),
    },
    canClaim: Boolean(eligibility?.eligible),
    eligibility: eligibility || null,
  };
}

async function listActivitiesForUser(user, options = {}) {
  const now = options.now || new Date();
  const query = options.includeInactive
    ? {}
    : { enabled: { $ne: false }, endTime: { $gte: now } };
  const [activities, metrics] = await Promise.all([
    Activity.find(query).sort({ startTime: 1, createdAt: -1 }),
    collectUserMetrics(user),
  ]);
  return activities.map((activity) => publicActivity(activity, evaluateEligibility(activity, user, metrics, now)));
}

function reserveFilter(activity, reward, won, now) {
  const expressions = [];
  const totalLimit = Number(activity.totalLimit || 0);
  const budget = Number(activity.totalPointsBudget || 0);
  if (totalLimit > 0) {
    expressions.push({ $lt: [{ $ifNull: ['$counters.attempts', 0] }, totalLimit] });
  }
  if (won && budget > 0) {
    expressions.push({
      $lte: [
        { $add: [{ $ifNull: ['$counters.pointsAwarded', 0] }, reward] },
        budget,
      ],
    });
  }
  return {
    _id: activity._id,
    enabled: { $ne: false },
    startTime: { $lte: now },
    endTime: { $gte: now },
    ...(expressions.length > 0 ? { $expr: expressions.length === 1 ? expressions[0] : { $and: expressions } } : {}),
  };
}

async function rollbackReservation(activityId, reward, won) {
  const decrement = { 'counters.attempts': -1 };
  if (won) {
    decrement['counters.winners'] = -1;
    decrement['counters.pointsAwarded'] = -reward;
  }
  try {
    await Activity.updateOne({ _id: activityId }, { $inc: decrement });
  } catch (error) {
    console.error('[Activity] failed to roll back reservation:', error.message);
  }
}

function claimsForActivityExpression(activityId, extraCondition = null) {
  const conditions = [
    { $eq: ['$$claim.activityId', activityId] },
    { $ne: ['$$claim.status', 'rejected'] },
  ];
  if (extraCondition) conditions.push(extraCondition);
  return {
    $filter: {
      input: { $ifNull: ['$activityClaims', []] },
      as: 'claim',
      cond: { $and: conditions },
    },
  };
}

function activityClaimFilter(userId, activity, now) {
  const conditions = [];
  const perUserLimit = Number(activity.perUserLimit || 0);
  if (perUserLimit > 0) {
    conditions.push({ $lt: [{ $size: claimsForActivityExpression(activity._id) }, perUserLimit] });
  }
  const dailyLimit = Number(activity.dailyLimit || 0);
  if (dailyLimit > 0) {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    conditions.push({
      $lt: [
        { $size: claimsForActivityExpression(activity._id, { $gte: ['$$claim.claimedAt', dayStart] }) },
        dailyLimit,
      ],
    });
  }
  return conditions.length ? { _id: userId, $expr: { $and: conditions } } : { _id: userId };
}

async function persistActivityClaim(userId, activity, { now, won, reward, eligibility }) {
  const claim = {
    activityId: activity._id,
    claimedAt: now,
    status: 'completed',
    won,
    points: reward,
    metric: eligibility.metric || 'none',
    metricValue: Number(eligibility.value || 0),
  };
  const fields = won ? buildPointsMutationFields(reward, {
    reason: `activity:${activity.type || 'custom'}`,
    referenceId: activity._id,
    createdAt: now,
  }) : {};
  fields.activityClaims = {
    $concatArrays: [{ $ifNull: ['$activityClaims', []] }, [claim]],
  };
  return User.findOneAndUpdate(
    activityClaimFilter(userId, activity, now),
    [{ $set: fields }],
    { new: true }
  );
}

async function claimActivity(activity, user, options = {}) {
  const now = options.now || new Date();
  const metrics = options.metrics || await collectUserMetrics(user);
  const eligibility = evaluateEligibility(activity, user, metrics, now);
  if (!eligibility.eligible) {
    throw new ActivityClaimError(eligibility.code, eligibility.reason);
  }

  const won = options.forceWon === undefined ? drawPrize(activity.probability) : Boolean(options.forceWon);
  const reward = won ? (options.forceReward || randomReward(activity)) : 0;
  const increment = { 'counters.attempts': 1 };
  if (won) {
    increment['counters.winners'] = 1;
    increment['counters.pointsAwarded'] = reward;
  }

  const reserved = await Activity.findOneAndUpdate(
    reserveFilter(activity, reward, won, now),
    { $inc: increment, $set: { updatedAt: now } },
    { new: true }
  );
  if (!reserved) {
    throw new ActivityClaimError('ACTIVITY_QUOTA_EXHAUSTED', '本活动奖励名额或积分预算已发完', 409);
  }

  try {
    const persistedUser = await persistActivityClaim(user._id, activity, { now, won, reward, eligibility });
    if (!persistedUser) {
      throw new ActivityClaimError('USER_LIMIT_REACHED', '已达到本活动参与次数上限', 409);
    }
    user = persistedUser;
  } catch (error) {
    await rollbackReservation(activity._id, reward, won);
    throw error;
  }

  return {
    won,
    points: reward,
    message: won ? `恭喜获得 ${reward} 积分` : '本次未中奖，完成更多任务后再来试试',
    balance: getPointsSnapshot(user),
    activity: publicActivity(reserved, evaluateEligibility(reserved, user, metrics, now)),
  };
}

async function claimAutoActivitiesForUser(user, type, options = {}) {
  if (Activity.db?.readyState !== 1 && !options.allowDisconnected) return [];
  try {
    const now = options.now || new Date();
    const activities = await Activity.find({
      type,
      enabled: { $ne: false },
      autoClaim: true,
      startTime: { $lte: now },
      endTime: { $gte: now },
    }).sort({ startTime: -1 });
    const results = [];
    for (const activity of activities) {
      try {
        results.push(await claimActivity(activity, user, { now, metrics: options.metrics }));
      } catch (error) {
        if (!(error instanceof ActivityClaimError)) throw error;
      }
    }
    return results;
  } catch (error) {
    // Activity rewards must never interrupt login, creation or a completed chapter.
    console.error(`[Activity] ${type} auto-claim failed:`, error.message);
    return [];
  }
}

module.exports = {
  ACTIVITY_CATALOG,
  METRIC_LABELS,
  ActivityClaimError,
  rewardRange,
  drawPrize,
  collectUserMetrics,
  evaluateEligibility,
  publicActivity,
  listActivitiesForUser,
  claimActivity,
  claimAutoActivitiesForUser,
};
