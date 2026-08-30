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
    res.status(500).json({ message: '获取数据失败', error: error.message });
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
    res.status(500).json({ message: '获取用户列表失败', error: error.message });
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
    res.status(500).json({ message: '更新失败', error: error.message });
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
    res.status(500).json({ message: '读取模型配置失败', error: error.message });
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
    res.status(500).json({ message: '保存失败', error: error.message });
  }
});

module.exports = router;
