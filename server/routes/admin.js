const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const User = require('../models/User');
const Novel = require('../models/Novel');
const ReferenceNovel = require('../models/ReferenceNovel');

// 所有管理路由需要 admin 权限
router.use(adminAuth);

// ========== 1. 仪表盘 ==========
router.get('/dashboard', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: 'user' });
    const totalNovels = await Novel.countDocuments();
    const totalTokensAllocated = (await User.aggregate([
      { $match: { role: 'user' } },
      { $group: { _id: null, total: { $sum: '$tokens.total' }, used: { $sum: '$tokens.used' } } },
    ]))[0] || { total: 0, used: 0 };

    // 用户注册趋势（近7天）
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const recentRegistrations = await User.countDocuments({ role: 'user', createdAt: { $gte: sevenDaysAgo } });

    // 生成次数 = 已完成的 + 暂停的 + 生成中的小说总数
    const completedNovels = await Novel.countDocuments({ status: 'completed' });
    const generatingNovels = await Novel.countDocuments({ status: { $in: ['generating', 'paused'] } });

    res.json({
      totalUsers,
      totalNovels,
      totalTokens: totalTokensAllocated.total,
      usedTokens: totalTokensAllocated.used,
      recentRegistrations,
      completedNovels,
      generatingNovels,
    });
  } catch (error) {
    res.status(500).json({ message: '获取数据失败', error: error.message });
  }
});

// ========== 2. 用户管理 ==========
router.get('/users', async (req, res) => {
  try {
    const { page = 1, pageSize = 20, keyword } = req.query;
    const query = {};
    if (keyword) {
      query.$or = [
        { email: new RegExp(keyword, 'i') },
        { nickname: new RegExp(keyword, 'i') },
      ];
    }
    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-password')
      .populate('invitedBy', 'email nickname')
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(Number(pageSize));
    res.json({ users, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (error) {
    res.status(500).json({ message: '获取用户列表失败', error: error.message });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const { nickname, role, disabled, addTokens } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: '用户不存在' });

    if (nickname !== undefined) user.nickname = nickname;
    if (role !== undefined) user.role = role;
    if (disabled !== undefined) user.disabled = disabled;
    if (addTokens !== undefined && addTokens > 0) {
      user.tokens.total += addTokens;
    }
    await user.save();
    const { password, ...safe } = user.toObject();
    res.json({ message: '更新成功', user: safe });
  } catch (error) {
    res.status(500).json({ message: '更新失败', error: error.message });
  }
});

// 进群赠送5000 Token
router.post('/users/:id/group-reward', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: '用户不存在' });
    if (user.groupRewardClaimed) return res.status(400).json({ message: '该用户已领取过进群奖励' });

    user.tokens.total += 5000;
    user.groupRewardClaimed = true;
    await user.save();
    const { password, ...safe } = user.toObject();
    res.json({ message: '赠送成功，已发放 5000 Token', user: safe });
  } catch (error) {
    res.status(500).json({ message: '赠送失败', error: error.message });
  }
});

// 获取某用户邀请的用户列表
router.get('/users/:id/invited-users', async (req, res) => {
  try {
    const invited = await User.find({ invitedBy: req.params.id })
      .select('email nickname createdAt tokens')
      .sort({ createdAt: -1 });
    res.json(invited);
  } catch (error) {
    res.status(500).json({ message: '获取失败', error: error.message });
  }
});

// ========== 3. 小说管理 ==========
router.get('/novels', async (req, res) => {
  try {
    const { page = 1, pageSize = 20, userId, status, keyword } = req.query;
    const query = {};
    if (userId) query.userId = userId;
    if (status) query.status = status;
    if (keyword) query.title = new RegExp(keyword, 'i');

    const total = await Novel.countDocuments(query);
    const novels = await Novel.find(query)
      .populate('userId', 'email nickname')
      .select('-chapters')
      .sort({ updatedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(Number(pageSize));
    res.json({ novels, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (error) {
    res.status(500).json({ message: '获取小说列表失败', error: error.message });
  }
});

// 获取所有用户列表（供筛选下拉用）
router.get('/users/simple', async (req, res) => {
  try {
    const users = await User.find({ role: { $ne: 'admin' } }).select('email nickname role').sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: '获取用户列表失败', error: error.message });
  }
});

// ========== 4. 蒸馏管理 ==========
// 获取蒸馏记录列表
router.get('/distillations', async (req, res) => {
  try {
    const { page = 1, pageSize = 20, userId, keyword } = req.query;
    const query = {};
    if (userId) query.userId = userId;
    if (keyword) query.title = new RegExp(keyword, 'i');

    const total = await ReferenceNovel.countDocuments(query);
    const list = await ReferenceNovel.find(query)
      .populate('userId', 'email nickname')
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(Number(pageSize));
    res.json({ list, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (error) {
    res.status(500).json({ message: '获取蒸馏记录失败', error: error.message });
  }
});

// 获取单条蒸馏记录详情（含完整 JSON）
router.get('/distillations/:id', async (req, res) => {
  try {
    const doc = await ReferenceNovel.findById(req.params.id).populate('userId', 'email nickname');
    if (!doc) return res.status(404).json({ message: '记录不存在' });
    res.json(doc);
  } catch (error) {
    res.status(500).json({ message: '获取详情失败', error: error.message });
  }
});

// 编辑蒸馏记录
router.put('/distillations/:id', async (req, res) => {
  try {
    const { title, gender, mainCategory, subCategory, tags, styleProfile, keyExcerpts, writingCharacteristics, vocabularyBank, chapterStructure } = req.body;
    const doc = await ReferenceNovel.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: '记录不存在' });

    if (title !== undefined) doc.title = title;
    if (gender !== undefined) doc.gender = gender;
    if (mainCategory !== undefined) doc.mainCategory = mainCategory;
    if (subCategory !== undefined) doc.subCategory = subCategory;
    if (tags !== undefined) doc.tags = tags;
    if (styleProfile !== undefined) doc.styleProfile = styleProfile;
    if (keyExcerpts !== undefined) doc.keyExcerpts = keyExcerpts;
    if (vocabularyBank !== undefined) doc.vocabularyBank = vocabularyBank;
    if (chapterStructure !== undefined) doc.chapterStructure = chapterStructure;

    await doc.save();
    res.json({ message: '更新成功', doc });
  } catch (error) {
    res.status(500).json({ message: '更新失败', error: error.message });
  }
});

// 删除蒸馏记录
router.delete('/distillations/:id', async (req, res) => {
  try {
    const result = await ReferenceNovel.deleteOne({ _id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ message: '记录不存在' });
    res.json({ message: '已删除' });
  } catch (error) {
    res.status(500).json({ message: '删除失败', error: error.message });
  }
});

// 导出单条蒸馏记录为 JSON
router.get('/distillations/:id/export', async (req, res) => {
  try {
    const doc = await ReferenceNovel.findById(req.params.id).populate('userId', 'email nickname');
    if (!doc) return res.status(404).json({ message: '记录不存在' });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="蒸馏_${doc.title}_${Date.now()}.json"`);
    res.json(doc.toObject());
  } catch (error) {
    res.status(500).json({ message: '导出失败', error: error.message });
  }
});

// 批量导出蒸馏记录为 JSON 数组
router.post('/distillations/export-batch', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: '请选择要导出的记录' });
    const docs = await ReferenceNovel.find({ _id: { $in: ids } }).populate('userId', 'email nickname');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="蒸馏批量导出_${Date.now()}.json"`);
    res.json(docs.map(d => d.toObject()));
  } catch (error) {
    res.status(500).json({ message: '导出失败', error: error.message });
  }
});

// ========== 4. 系统模型配置 ==========
router.get('/models', async (req, res) => {
  res.json({
    baseUrl: process.env.AI_API_BASE || '',
    model: process.env.AI_MODEL || '',
    apiKey: process.env.AI_API_KEY ? '********' : '',
  });
});

router.put('/models', async (req, res) => {
  try {
    const { baseUrl, model, apiKey } = req.body;
    // 存入数据库全局配置（使用一个简单的配置文档）
    const SysConfig = require('../models/SysConfig');
    const existing = await SysConfig.findOne({ key: 'system_model' });
    if (existing) {
      existing.value = { baseUrl, model, apiKey };
      await existing.save();
    } else {
      await new SysConfig({ key: 'system_model', value: { baseUrl, model, apiKey } }).save();
    }
    res.json({ message: '模型配置已保存，请重启服务生效' });
  } catch (error) {
    res.status(500).json({ message: '保存失败', error: error.message });
  }
});

// 重启服务
router.post('/restart', async (req, res) => {
  res.json({ message: '服务即将重启...' });
  console.log('管理员请求重启服务');
  setTimeout(() => { process.exit(0); }, 1000);
});

// ========== 6. 类型模板管理 ==========

const novelTemplates = require('../config/novelTemplates');
const fs = require('fs');
const path = require('path');

// 获取所有模板
router.get('/templates', async (req, res) => {
  try {
    res.json({ templates: novelTemplates });
  } catch (error) {
    res.status(500).json({ message: '获取模板失败', error: error.message });
  }
});

// 保存模板
router.put('/templates', async (req, res) => {
  try {
    const { templates } = req.body;
    if (!Array.isArray(templates)) return res.status(400).json({ message: '模板数据格式错误' });

    const tplPath = path.join(__dirname, '../config/novelTemplates.js');
    const content = `/**\n * 小说类型模板库\n * 每个模板包含：匹配关键词、系统提示上下文\n */\n\nconst novelTemplates = ${JSON.stringify(templates, null, 2)}\n\nmodule.exports = novelTemplates\n`;
    fs.writeFileSync(tplPath, content, 'utf-8');
    // 清除 require 缓存
    delete require.cache[require.resolve('../config/novelTemplates')];

    res.json({ message: '模板已保存', count: templates.length });
  } catch (error) {
    res.status(500).json({ message: '保存模板失败', error: error.message });
  }
});

module.exports = router;
