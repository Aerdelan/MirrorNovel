const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const User = require('../models/User');
const Novel = require('../models/Novel');
const SysConfig = require('../models/SysConfig');
const {
  MODEL_ROUTE_DEFINITIONS,
  createModelCatalog,
  setCatalogOverrides,
} = require('../config/modelCatalog');

router.use(adminAuth);

router.get('/dashboard', async (req, res) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [totalUsers, totalNovels, completedNovels, generatingNovels, recentRegistrations] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      Novel.countDocuments(),
      Novel.countDocuments({ status: 'completed' }),
      Novel.countDocuments({ status: { $in: ['generating', 'paused'] } }),
      User.countDocuments({ role: 'user', createdAt: { $gte: sevenDaysAgo } }),
    ]);
    res.json({ totalUsers, totalNovels, completedNovels, generatingNovels, recentRegistrations });
  } catch (error) {
    res.status(500).json({ message: '获取数据失败' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const { page = 1, pageSize = 50, keyword } = req.query;
    // 旧版前端不传分页参数时后端默认只回 20 条，第 21 个用户开始"凭空消失"。
    // 默认页大小提到 50 并显式返回 total，前端据此渲染分页。
    const size = Math.min(200, Math.max(1, Number(pageSize) || 50));
    const query = keyword ? { $or: [{ email: new RegExp(escapeRegExp(keyword), 'i') }, { nickname: new RegExp(escapeRegExp(keyword), 'i') }] } : {};
    const [total, users] = await Promise.all([
      User.countDocuments(query),
      User.find(query).select('-password').sort({ createdAt: -1 }).skip((Number(page) - 1) * size).limit(size).lean(),
    ]);

    // 每个用户的 token 消耗：聚合其名下所有小说的 tokenUsage 账本。
    const userIds = users.map((user) => user._id);
    const novels = await Novel.find({ userId: { $in: userIds } })
      .select('userId tokenUsage')
      .lean();
    const usageByUser = new Map();
    for (const novel of novels) {
      const usage = novel.tokenUsage;
      if (!usage || typeof usage !== 'object') continue;
      const entry = usageByUser.get(String(novel.userId)) || { inputTokens: 0, outputTokens: 0, cacheSavedTokens: 0, calls: 0, novelCount: 0 };
      entry.inputTokens += Number(usage.inputTokens) || 0;
      entry.outputTokens += Number(usage.outputTokens) || 0;
      entry.cacheSavedTokens += Number(usage.cacheSavedTokens) || 0;
      entry.calls += Number(usage.calls) || 0;
      entry.novelCount += 1;
      usageByUser.set(String(novel.userId), entry);
    }
    const usersWithUsage = users.map((user) => ({
      ...user,
      tokenUsage: usageByUser.get(String(user._id)) || { inputTokens: 0, outputTokens: 0, cacheSavedTokens: 0, calls: 0, novelCount: 0 },
    }));

    res.json({ users: usersWithUsage, total, page: Number(page), pageSize: size });
  } catch (error) {
    res.status(500).json({ message: '获取用户列表失败' });
  }
});

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.put('/users/:id', async (req, res) => {
  try {
    const { nickname, role, disabled } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: '用户不存在' });
    // 禁用/降级保护：不能禁用自己，也不能禁用或降级其他管理员——
    // 否则最后一个管理员被误禁用后整个后台无人能进。
    if (disabled !== undefined || role !== undefined) {
      const selfTargeted = String(user._id) === String(req.userId);
      const adminTargeted = user.role === 'admin';
      if (selfTargeted) return res.status(400).json({ message: '不能对当前登录的管理员账号执行禁用或降级' });
      if (adminTargeted && (disabled === true || (role !== undefined && role !== 'admin'))) {
        return res.status(400).json({ message: '不能禁用或降级其他管理员账号' });
      }
    }
    if (nickname !== undefined) user.nickname = nickname;
    if (role !== undefined) user.role = role;
    if (disabled !== undefined) user.disabled = disabled;
    await user.save();
    res.json({ message: '更新成功', user: user.toObject() });
  } catch (error) {
    res.status(500).json({ message: '更新失败' });
  }
});

// Token 用量归因：把 Novel.tokenUsage 账本按"任务角色"和"单本作品"两个维度聚合。
// 目的不是展示总量，而是回答"钱花在哪个环节"——大纲/正文/审稿/润色四类角色的
// 输入占比决定了下一轮优化的方向（详见 docs/OPTIMIZATION_AND_TOKEN_CACHE_PLAN.md）。
const USAGE_ROLE_LABELS = {
  outline: '大纲生成',
  writing: '正文生成',
  reasoning: '审稿/推理',
  polish: '润色修订',
  other: '其他',
};

function emptyUsageCell() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheSavedTokens: 0,
    calls: 0,
    logicalCalls: 0,
    failedCalls: 0,
    estimatedCalls: 0,
    discardedTokens: 0,
  };
}

function addUsageCell(target, source) {
  target.inputTokens += Number(source?.inputTokens) || 0;
  target.outputTokens += Number(source?.outputTokens) || 0;
  target.reasoningTokens += Number(source?.reasoningTokens) || 0;
  target.cacheSavedTokens += Number(source?.cacheSavedTokens) || 0;
  target.calls += Number(source?.calls) || 0;
  target.logicalCalls += Number(source?.logicalCalls) || 0;
  target.failedCalls += Number(source?.failedCalls) || 0;
  target.estimatedCalls += Number(source?.estimatedCalls) || 0;
  target.discardedTokens += Number(source?.discardedTokens) || 0;
  return target;
}

router.get('/token-usage', async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const [roleRows, totalsRows, countedNovels, topNovels, taskRows, recentAttemptRows] = await Promise.all([
      Novel.aggregate([
        { $match: { 'tokenUsage.byRole': { $type: 'object' } } },
        { $project: { roles: { $objectToArray: '$tokenUsage.byRole' } } },
        { $unwind: '$roles' },
        {
          $group: {
            _id: '$roles.k',
            inputTokens: { $sum: '$roles.v.inputTokens' },
            outputTokens: { $sum: '$roles.v.outputTokens' },
            reasoningTokens: { $sum: '$roles.v.reasoningTokens' },
            cacheSavedTokens: { $sum: '$roles.v.cacheSavedTokens' },
            calls: { $sum: '$roles.v.calls' },
            logicalCalls: { $sum: '$roles.v.logicalCalls' },
            failedCalls: { $sum: '$roles.v.failedCalls' },
            estimatedCalls: { $sum: '$roles.v.estimatedCalls' },
            discardedTokens: { $sum: '$roles.v.discardedTokens' },
          },
        },
        { $sort: { inputTokens: -1 } },
      ]),
      Novel.aggregate([
        {
          $group: {
            _id: null,
            inputTokens: { $sum: '$tokenUsage.inputTokens' },
            outputTokens: { $sum: '$tokenUsage.outputTokens' },
            reasoningTokens: { $sum: '$tokenUsage.reasoningTokens' },
            cacheSavedTokens: { $sum: '$tokenUsage.cacheSavedTokens' },
            calls: { $sum: '$tokenUsage.calls' },
            logicalCalls: { $sum: '$tokenUsage.logicalCalls' },
            failedCalls: { $sum: '$tokenUsage.failedCalls' },
            estimatedCalls: { $sum: '$tokenUsage.estimatedCalls' },
            discardedTokens: { $sum: '$tokenUsage.discardedTokens' },
          },
        },
      ]),
      Novel.countDocuments({ 'tokenUsage.calls': { $gt: 0 } }),
      Novel.find({ 'tokenUsage.calls': { $gt: 0 } })
        .select('title novelTypeName currentWordCount status tokenUsage updatedAt')
        .sort({ 'tokenUsage.inputTokens': -1 })
        .limit(limit)
        .lean(),
      Novel.aggregate([
        { $match: { 'tokenUsage.attempts.0': { $exists: true } } },
        { $unwind: '$tokenUsage.attempts' },
        {
          $group: {
            _id: {
              taskType: { $ifNull: ['$tokenUsage.attempts.taskType', '$tokenUsage.attempts.role'] },
              role: { $ifNull: ['$tokenUsage.attempts.role', 'other'] },
              model: { $ifNull: ['$tokenUsage.attempts.model', 'unknown'] },
              routeId: { $ifNull: ['$tokenUsage.attempts.routeId', ''] },
              providerHost: { $ifNull: ['$tokenUsage.attempts.providerHost', ''] },
            },
            inputTokens: { $sum: '$tokenUsage.attempts.inputTokens' },
            outputTokens: { $sum: '$tokenUsage.attempts.outputTokens' },
            reasoningTokens: { $sum: '$tokenUsage.attempts.reasoningTokens' },
            cacheSavedTokens: { $sum: '$tokenUsage.attempts.cacheSavedTokens' },
            calls: { $sum: 1 },
            failedCalls: {
              $sum: { $cond: [{ $or: [
                { $ne: ['$tokenUsage.attempts.error', null] },
                { $ne: ['$tokenUsage.attempts.accepted', true] },
              ] }, 1, 0] },
            },
            estimatedCalls: { $sum: { $cond: ['$tokenUsage.attempts.estimated', 1, 0] } },
            discardedTokens: {
              $sum: { $cond: ['$tokenUsage.attempts.discarded', '$tokenUsage.attempts.outputTokens', 0] },
            },
            averageDurationMs: { $avg: '$tokenUsage.attempts.durationMs' },
            lastRecordedAt: { $max: '$tokenUsage.attempts.recordedAt' },
          },
        },
        { $sort: { inputTokens: -1, outputTokens: -1 } },
        { $limit: 50 },
      ]),
      Novel.aggregate([
        { $match: { 'tokenUsage.attempts.0': { $exists: true } } },
        { $project: { title: 1, attempt: '$tokenUsage.attempts' } },
        { $unwind: '$attempt' },
        { $sort: { 'attempt.recordedAt': -1 } },
        { $limit: 50 },
        {
          $project: {
            _id: 0,
            novelId: { $toString: '$_id' },
            novelTitle: '$title',
            taskType: '$attempt.taskType',
            role: '$attempt.role',
            model: '$attempt.model',
            routeId: '$attempt.routeId',
            providerHost: '$attempt.providerHost',
            accepted: '$attempt.accepted',
            discarded: '$attempt.discarded',
            estimated: '$attempt.estimated',
            inputTokens: '$attempt.inputTokens',
            outputTokens: '$attempt.outputTokens',
            reasoningTokens: '$attempt.reasoningTokens',
            finishReason: '$attempt.finishReason',
            retryReason: '$attempt.retryReason',
            error: '$attempt.error',
            durationMs: '$attempt.durationMs',
            statusCode: '$attempt.statusCode',
            recordedAt: '$attempt.recordedAt',
          },
        },
      ]),
    ]);

    const totals = addUsageCell(emptyUsageCell(), totalsRows[0] || {});
    const byRole = roleRows
      .map((row) => ({
        role: String(row._id || 'other'),
        label: USAGE_ROLE_LABELS[row._id] || USAGE_ROLE_LABELS.other,
        ...addUsageCell(emptyUsageCell(), row),
      }))
      .map((row) => ({
        ...row,
        // 输入 token 占比：优化决策看这个比例，而不是绝对值。
        inputShare: totals.inputTokens > 0 ? Number((row.inputTokens / totals.inputTokens).toFixed(4)) : 0,
      }));

    res.json({
      totals: {
        ...totals,
        // cacheSavedTokens 是服务商前缀缓存命中量（其本身已计入 inputTokens），
        // 命中率越高，账单口径越接近 1/10 单价。
        cacheHitRate: totals.inputTokens > 0 ? Number((totals.cacheSavedTokens / totals.inputTokens).toFixed(4)) : 0,
        discardedRate: totals.outputTokens > 0 ? Number((totals.discardedTokens / totals.outputTokens).toFixed(4)) : 0,
        estimatedCallRate: totals.calls > 0 ? Number((totals.estimatedCalls / totals.calls).toFixed(4)) : 0,
        novelCount: Number(countedNovels) || 0,
      },
      byRole,
      // Attempt rows are a bounded diagnostic window (last 200 per novel),
      // not a second lifetime total. They answer which concrete task/model is
      // retrying, slow, estimated or throwing output away.
      byTask: taskRows.map((row) => ({
        taskType: String(row._id?.taskType || row._id?.role || 'other'),
        role: String(row._id?.role || 'other'),
        model: String(row._id?.model || 'unknown'),
        routeId: String(row._id?.routeId || ''),
        providerHost: String(row._id?.providerHost || ''),
        inputTokens: Number(row.inputTokens) || 0,
        outputTokens: Number(row.outputTokens) || 0,
        reasoningTokens: Number(row.reasoningTokens) || 0,
        cacheSavedTokens: Number(row.cacheSavedTokens) || 0,
        calls: Number(row.calls) || 0,
        failedCalls: Number(row.failedCalls) || 0,
        estimatedCalls: Number(row.estimatedCalls) || 0,
        discardedTokens: Number(row.discardedTokens) || 0,
        averageDurationMs: Math.round(Number(row.averageDurationMs) || 0),
        lastRecordedAt: row.lastRecordedAt || null,
      })),
      recentAttempts: recentAttemptRows,
      attemptWindow: { maxPerNovel: 200 },
      topNovels: topNovels.map((novel) => {
        const usage = addUsageCell(emptyUsageCell(), novel.tokenUsage || {});
        const words = Number(novel.currentWordCount) || 0;
        return {
          id: String(novel._id),
          title: novel.title || '未命名',
          novelTypeName: novel.novelTypeName || '',
          status: novel.status || '',
          currentWordCount: words,
          ...usage,
          // 每千字输入消耗：跨作品可比的长篇效率指标。
          inputPerThousandWords: words > 0 ? Math.round((usage.inputTokens / words) * 1000) : 0,
          updatedAt: novel.updatedAt || null,
        };
      }),
    });
  } catch (error) {
    res.status(500).json({ message: '获取用量数据失败' });
  }
});

function modelRouteView(route) {
  return {
    id: route.id,
    alias: route.alias,
    baseUrl: route.baseUrl || '',
    model: route.model || '',
    apiKeyConfigured: Boolean(route.apiKey),
    configured: Boolean(route.baseUrl && route.model),
  };
}

router.get('/models', async (req, res) => {
  try {
    // Refresh the synchronous runtime catalog from MongoDB so an update made
    // by another admin process is visible before the next generation request.
    const stored = await SysConfig.findOne({ key: 'model_catalog' }).lean();
    if (stored?.value) setCatalogOverrides(stored.value);
    res.json({ routes: createModelCatalog().map(modelRouteView) });
  } catch (error) {
    res.status(500).json({ message: '读取模型配置失败' });
  }
});

router.put('/models', async (req, res) => {
  try {
    const currentCatalog = createModelCatalog();
    const submittedRoutes = Array.isArray(req.body.routes) ? req.body.routes : [];
    if (!submittedRoutes.length) return res.status(400).json({ message: '请至少提交一条模型线路配置' });
    const allowedIds = new Set(MODEL_ROUTE_DEFINITIONS.map((route) => route.id));
    const overrides = {};
    for (const submitted of submittedRoutes) {
      const id = String(submitted.id || '');
      if (!allowedIds.has(id)) return res.status(400).json({ message: `无效线路：${id}` });
      const current = currentCatalog.find((route) => route.id === id);
      overrides[id] = {
        baseUrl: String(submitted.baseUrl ?? current?.baseUrl ?? '').trim(),
        model: String(submitted.model ?? current?.model ?? '').trim(),
        apiKey: submitted.apiKey && submitted.apiKey !== '********' ? String(submitted.apiKey).trim() : String(current?.apiKey || ''),
      };
    }
    for (const current of currentCatalog) {
      if (!overrides[current.id]) overrides[current.id] = { baseUrl: current.baseUrl || '', model: current.model || '', apiKey: current.apiKey || '' };
    }
    await SysConfig.findOneAndUpdate({ key: 'model_catalog' }, { value: overrides, updatedAt: new Date() }, { upsert: true, new: true, setDefaultsOnInsert: true });
    setCatalogOverrides(overrides);
    res.json({ message: '模型线路配置已保存并即时生效', routes: createModelCatalog().map(modelRouteView) });
  } catch (error) {
    res.status(500).json({ message: '保存失败' });
  }
});

module.exports = router;
