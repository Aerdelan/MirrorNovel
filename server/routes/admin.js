const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const User = require('../models/User');
const Novel = require('../models/Novel');
const SysConfig = require('../models/SysConfig');
const {
  MODEL_ROUTE_DEFINITIONS,
  createModelCatalog,
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
    const { page = 1, pageSize = 20, keyword } = req.query;
    const query = keyword ? { $or: [{ email: new RegExp(keyword, 'i') }, { nickname: new RegExp(keyword, 'i') }] } : {};
    const total = await User.countDocuments(query);
    const users = await User.find(query).select('-password').sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(Number(pageSize));
    res.json({ users, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (error) {
    res.status(500).json({ message: '获取用户列表失败', error: error.message });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const { nickname, role, disabled } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: '用户不存在' });
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

router.get('/models', (req, res) => {
  res.json({ routes: createModelCatalog().map(modelRouteView) });
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
    process.env.MODEL_CATALOG_JSON = JSON.stringify(overrides);
    res.json({ message: '模型线路配置已保存并即时生效', routes: createModelCatalog().map(modelRouteView) });
  } catch (error) {
    res.status(500).json({ message: '保存失败', error: error.message });
  }
});

module.exports = router;
