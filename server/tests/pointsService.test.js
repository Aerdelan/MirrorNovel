const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPriceCatalog,
  getPublicRoutes,
  toPublicModelConfig,
} = require('../config/modelPriceCatalog');
const {
  PointsInsufficientError,
  calculatePointsCharge,
  ensurePointsAccount,
  getPointsSnapshot,
  creditPoints,
  debitPoints,
  debitPointsForUser,
  adjustPointsForUser,
} = require('../services/pointsService');

function paidCatalog() {
  return createPriceCatalog({
    AI_API_BASE: 'https://provider.example/v1',
    AI_API_KEY: 'private-key',
    AI_MODEL: 'private-model-name',
    POINTS_PRICE_CATALOG_JSON: JSON.stringify({
      vip: { inputRmbPerMillion: 2, outputRmbPerMillion: 8 },
      svip: { inputRmbPerMillion: 4, outputRmbPerMillion: 12 },
    }),
  });
}

test('ordinary routes charge 1000 points for every 20000 billable tokens', () => {
  const charge = calculatePointsCharge({
    routeId: 'normal_1',
    inputTokens: 5000,
    outputTokens: 15000,
    catalog: paidCatalog(),
  });
  assert.equal(charge.points, 1000);
  assert.equal(charge.billableTokens, 20000);

  const partial = calculatePointsCharge({
    routeId: 'normal_2',
    inputTokens: 1,
    outputTokens: 0,
    catalog: paidCatalog(),
  });
  assert.equal(partial.points, 1);
});

test('VIP and SVIP use input/output costs at 800 percent and 1000 points per RMB', () => {
  const catalog = paidCatalog();
  const vip = calculatePointsCharge({
    routeId: 'vip',
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    catalog,
  });
  assert.equal(vip.points, (2 + 8) * 8 * 1000);

  const svip = calculatePointsCharge({
    routeId: 'svip',
    inputTokens: 500_000,
    outputTokens: 250_000,
    catalog,
  });
  assert.equal(svip.points, (4 * 0.5 + 12 * 0.25) * 8 * 1000);
});

test('public route payloads never expose provider model names, URLs, keys, or costs', () => {
  const catalog = paidCatalog();
  const publicRoutes = getPublicRoutes(catalog);
  const serialized = JSON.stringify(publicRoutes);
  assert.deepEqual(publicRoutes.map((route) => Object.keys(route).sort()), publicRoutes.map(() => ['alias', 'id']));
  assert.doesNotMatch(serialized, /private-model-name|provider\.example|private-key|inputRmb/i);

  assert.deepEqual(
    toPublicModelConfig({ provider: 'system', routeId: 'vip', cloudApiKey: 'should-not-leak' }, catalog),
    { provider: 'system', routeId: 'vip', routeAlias: 'VIP线路模型' }
  );
});

test('legacy balances migrate once and remain mirrored for old clients', async () => {
  const user = {
    tokens: { total: 3000, used: 500 },
    points: { version: 0, total: 0, used: 0 },
    pointsLedger: [],
    async save() {},
  };
  ensurePointsAccount(user);
  assert.deepEqual(getPointsSnapshot(user), { total: 3000, used: 500, available: 2500 });

  await creditPoints(user, 200, { reason: 'test_credit' });
  assert.equal(user.points.total, 3200);
  assert.equal(user.tokens.total, 3200);
  assert.equal(user.pointsLedger.at(-1).balanceAfter, 2700);

  await debitPoints(user, {
    routeId: 'normal_1',
    inputTokens: 1000,
    outputTokens: 1000,
    catalog: paidCatalog(),
  }, { reason: 'test_generation', catalog: paidCatalog() });
  assert.equal(user.points.used, 600);
  assert.equal(user.tokens.used, 600);
});

test('debit rejects an unaffordable generation without changing the balance', async () => {
  const user = {
    tokens: { total: 10, used: 0 },
    points: { version: 1, total: 10, used: 0 },
    pointsLedger: [],
    async save() {},
  };

  await assert.rejects(
    debitPoints(user, {
      routeId: 'normal_1',
      inputTokens: 10000,
      outputTokens: 10000,
      catalog: paidCatalog(),
    }, { catalog: paidCatalog() }),
    (error) => error instanceof PointsInsufficientError && error.required === 1000 && error.available === 10
  );
  assert.deepEqual(getPointsSnapshot(user), { total: 10, used: 0, available: 10 });
  assert.equal(user.pointsLedger.length, 0);
});

test('atomic debit uses a conditional user update and appends a debit ledger entry', async () => {
  const updatedUser = { points: { version: 1, total: 2000, used: 1000 }, tokens: { total: 2000, used: 1000 } };
  let captured;
  const UserModel = {
    async findOneAndUpdate(filter, pipeline) { captured = { filter, pipeline }; return updatedUser; },
    async findById() { return updatedUser; },
  };
  const result = await debitPointsForUser(UserModel, 'user-1', {
    routeId: 'normal_1', inputTokens: 10000, outputTokens: 10000, catalog: paidCatalog(),
  }, { catalog: paidCatalog(), reason: 'test_atomic' });
  assert.equal(result.available, 1000);
  assert.equal(captured.filter._id, 'user-1');
  assert.ok(captured.filter.$expr, 'available-balance check must be part of the update filter');
  assert.equal(captured.pipeline[0].$set.pointsLedger.$slice[1], -200);
  assert.equal(captured.pipeline[0].$set.pointsLedger.$slice[0].$concatArrays[1][0].type, 'debit');
});

test('manual adjustment uses a conditional update for debits', async () => {
  const updatedUser = { points: { version: 1, total: 500, used: 100 }, tokens: { total: 500, used: 100 } };
  let captured;
  const UserModel = {
    async findOneAndUpdate(filter, pipeline) { captured = { filter, pipeline }; return updatedUser; },
    async findById() { return updatedUser; },
  };
  const result = await adjustPointsForUser(UserModel, 'user-1', -50, { reason: 'test_adjust' });
  assert.equal(result.available, 400);
  assert.ok(captured.filter.$expr, 'debit adjustment must check available balance atomically');
  assert.equal(captured.pipeline[0].$set.pointsLedger.$slice[0].$concatArrays[1][0].type, 'debit');
});
