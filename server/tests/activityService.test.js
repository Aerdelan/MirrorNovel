const test = require('node:test');
const assert = require('node:assert/strict');

const Activity = require('../models/Activity');
const {
  ActivityClaimError,
  rewardRange,
  drawPrize,
  evaluateEligibility,
  claimActivity,
} = require('../services/activityService');

function makeActivity(overrides = {}) {
  const now = Date.now();
  return {
    _id: 'activity-1',
    name: '写作挑战',
    type: 'writing',
    startTime: new Date(now - 60_000),
    endTime: new Date(now + 60_000),
    enabled: true,
    rewardPoints: 120,
    minRewardPoints: 120,
    maxRewardPoints: 120,
    probability: 100,
    difficulty: 'medium',
    requirement: { metric: 'word_count', operator: 'gte', threshold: 1000 },
    dailyLimit: 1,
    perUserLimit: 2,
    totalLimit: 100,
    totalPointsBudget: 12000,
    counters: { attempts: 0, winners: 0, pointsAwarded: 0 },
    ...overrides,
  };
}

function makeUser(overrides = {}) {
  return {
    _id: 'user-1',
    createdAt: new Date(Date.now() - 86_400_000),
    points: { version: 1, total: 500, used: 50 },
    tokens: { total: 500, used: 50 },
    pointsLedger: [],
    activityClaims: [],
    checkin: { totalDays: 3 },
    inviteCount: 1,
    async save() {},
    ...overrides,
  };
}

test('reward range keeps legacy activities compatible with points', () => {
  assert.deepEqual(rewardRange({ tokenAmount: 88 }), { min: 88, max: 88 });
  assert.deepEqual(
    rewardRange({ rewardPoints: 50, minRewardPoints: 10, maxRewardPoints: 90 }),
    { min: 10, max: 90 }
  );
});

test('prize draw honors zero and full probability boundaries', () => {
  assert.equal(drawPrize(0), false);
  assert.equal(drawPrize(100), true);
});

test('eligibility enforces task progress and per-day limits', () => {
  const activity = makeActivity();
  const user = makeUser();

  const blocked = evaluateEligibility(activity, user, { word_count: 999 });
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.code, 'REQUIREMENT_NOT_MET');
  assert.equal(blocked.value, 999);

  const eligible = evaluateEligibility(activity, user, { word_count: 1000 });
  assert.equal(eligible.eligible, true);

  user.activityClaims.push({ activityId: activity._id, claimedAt: new Date(), status: 'completed' });
  const limited = evaluateEligibility(activity, user, { word_count: 2000 });
  assert.equal(limited.eligible, false);
  assert.equal(limited.code, 'DAILY_LIMIT_REACHED');
});

test('claim reserves quota, credits points, and writes an auditable result', async () => {
  const originalFindOneAndUpdate = Activity.findOneAndUpdate;
  const activity = makeActivity();
  const user = makeUser();
  let reserveUpdate;
  Activity.findOneAndUpdate = async (filter, update) => {
    reserveUpdate = { filter, update };
    return { ...activity, counters: { attempts: 1, winners: 1, pointsAwarded: 120 } };
  };

  try {
    const result = await claimActivity(activity, user, {
      metrics: { word_count: 1500 },
      forceWon: true,
      forceReward: 120,
    });
    assert.equal(result.won, true);
    assert.equal(result.points, 120);
    assert.equal(result.balance.available, 570);
    assert.equal(user.points.total, 620);
    assert.equal(user.tokens.total, 620);
    assert.equal(user.activityClaims.length, 1);
    assert.equal(user.activityClaims[0].metricValue, 1500);
    assert.equal(user.pointsLedger.at(-1).reason, 'activity:writing');
    assert.equal(reserveUpdate.update.$inc['counters.pointsAwarded'], 120);
  } finally {
    Activity.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test('claim reports exhausted global quota without changing the user balance', async () => {
  const originalFindOneAndUpdate = Activity.findOneAndUpdate;
  const activity = makeActivity();
  const user = makeUser();
  Activity.findOneAndUpdate = async () => null;

  try {
    await assert.rejects(
      claimActivity(activity, user, { metrics: { word_count: 1500 }, forceWon: true }),
      (error) => error instanceof ActivityClaimError && error.code === 'ACTIVITY_QUOTA_EXHAUSTED'
    );
    assert.equal(user.points.total, 500);
    assert.equal(user.activityClaims.length, 0);
  } finally {
    Activity.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
