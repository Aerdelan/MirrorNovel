const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const User = require('../models/User');
const Novel = require('../models/Novel');
const ReferenceNovel = require('../models/ReferenceNovel');
const Activity = require('../models/Activity');
const { creditPoints, adjustPointsForUser, sanitizeLedger } = require('../services/pointsService');
const {
  PUBLIC_ROUTE_DEFINITIONS,
  FIXED_POINTS_PER_TOKENS,
  COST_MARKUP_MULTIPLIER,
  POINTS_PER_RMB,
  createPriceCatalog,
} = require('../config/modelPriceCatalog');

// 所有管理路由需要 admin 权限
router.use(adminAuth);

// ========== 1. 仪表盘 ==========
router.get('/dashboard', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: 'user' });
    const totalNovels = await Novel.countDocuments();
    const totalPointsAllocated = (await User.aggregate([
      { $match: { role: 'user' } },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $cond: [{ $gte: ['$points.version', 1] }, '$points.total', '$tokens.total'],
            },
          },
          used: {
            $sum: {
              $cond: [{ $gte: ['$points.version', 1] }, '$points.used', '$tokens.used'],
            },
          },
        },
      },
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
      totalPoints: totalPointsAllocated.total,
      usedPoints: totalPointsAllocated.used,
      // Legacy aliases for older admin builds.
      totalTokens: totalPointsAllocated.total,
      usedTokens: totalPointsAllocated.used,
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
    const { nickname, role, disabled } = req.body;
    const addPoints = Number(req.body.addPoints ?? req.body.addTokens ?? 0);
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: '用户不存在' });

    if (nickname !== undefined) user.nickname = nickname;
    if (role !== undefined) user.role = role;
    if (disabled !== undefined) user.disabled = disabled;
    if (addPoints > 0) {
      await creditPoints(user, addPoints, { reason: 'admin_credit', referenceId: String(req.params.id), save: false });
    }
    await user.save();
    const { password, ...safe } = user.toObject();
    res.json({ message: '更新成功', user: safe });
  } catch (error) {
    res.status(500).json({ message: '更新失败', error: error.message });
  }
});

// 进群赠送 5000 积分
router.post('/users/:id/group-reward', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: '用户不存在' });
    if (user.groupRewardClaimed) return res.status(400).json({ message: '该用户已领取过进群奖励' });

    await creditPoints(user, 5000, { reason: 'group_reward', referenceId: String(req.params.id), save: false });
    user.groupRewardClaimed = true;
    await user.save();
    const { password, ...safe } = user.toObject();
    res.json({ message: '赠送成功，已发放 5000 积分', user: safe });
  } catch (error) {
    res.status(500).json({ message: '赠送失败', error: error.message });
  }
});

router.get('/users/:id/points-ledger', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('email nickname points tokens pointsLedger');
    if (!user) return res.status(404).json({ message: '用户不存在' });
    res.json({ user: { id: user._id, email: user.email, nickname: user.nickname }, ledger: sanitizeLedger(user.pointsLedger) });
  } catch (error) {
    res.status(500).json({ message: '获取积分流水失败', error: error.message });
  }
});

router.post('/users/:id/points-adjust', async (req, res) => {
  try {
    const amount = Math.trunc(Number(req.body?.amount));
    const reason = String(req.body?.reason || '').trim();
    if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ message: '调整积分必须是非零整数' });
    if (!reason || reason.length > 120) return res.status(400).json({ message: '请填写 1 至 120 字的调整原因' });
    const balance = await adjustPointsForUser(User, req.params.id, amount, {
      reason: `admin_adjust:${reason}`,
      referenceId: String(req.userId || req.user?._id || ''),
    });
    res.json({ message: '积分调整成功', balance });
  } catch (error) {
    const status = error.code === 'POINTS_INSUFFICIENT' ? 409 : error.message === 'user not found' ? 404 : 500;
    res.status(status).json({ message: status === 409 ? '用户可用积分不足，无法扣减' : status === 404 ? '用户不存在' : '积分调整失败', error: error.message });
  }
});

// 获取某用户邀请的用户列表
router.get('/users/:id/invited-users', async (req, res) => {
  try {
    const invited = await User.find({ invitedBy: req.params.id })
      .select('email nickname createdAt points tokens')
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

// ========== 4. 线路与计价配置 ==========
function adminRouteView(route) {
  return {
    id: route.id,
    alias: route.alias,
    pricingMode: route.pricingMode,
    baseUrl: route.baseUrl || '',
    model: route.model || '',
    apiKeyConfigured: Boolean(route.apiKey),
    pointsPerBlock: route.pointsPerBlock,
    tokensPerBlock: route.tokensPerBlock,
    inputRmbPerMillion: route.inputRmbPerMillion,
    outputRmbPerMillion: route.outputRmbPerMillion,
    costMarkupMultiplier: route.costMarkupMultiplier,
    pointsPerRmb: route.pointsPerRmb,
    configured: Boolean(route.baseUrl && route.model && (route.pricingMode === 'fixed'
      || (route.inputRmbPerMillion !== null && route.outputRmbPerMillion !== null))),
  };
}

router.get('/models', async (req, res) => {
  const routes = createPriceCatalog().map(adminRouteView);
  res.json({
    routes,
    formula: {
      pointsPerRmb: POINTS_PER_RMB,
      fixedPoints: FIXED_POINTS_PER_TOKENS.points,
      fixedTokens: FIXED_POINTS_PER_TOKENS.tokens,
      paidMarkupMultiplier: COST_MARKUP_MULTIPLIER,
    },
  });
});

router.put('/models', async (req, res) => {
  try {
    const currentCatalog = createPriceCatalog();
    let requestedRoutes = Array.isArray(req.body.routes) ? req.body.routes : [];

    // Keep the previous single-model admin form functional during rollout.
    if (requestedRoutes.length === 0 && (req.body.baseUrl || req.body.model || req.body.apiKey)) {
      requestedRoutes = [{ id: 'normal_1', ...req.body }];
    }
    if (requestedRoutes.length === 0) {
      return res.status(400).json({ message: '请至少提交一条线路配置' });
    }

    const allowedIds = new Set(PUBLIC_ROUTE_DEFINITIONS.map((route) => route.id));
    const overrides = {};
    for (const submitted of requestedRoutes) {
      const id = String(submitted.id || '');
      if (!allowedIds.has(id)) return res.status(400).json({ message: `无效线路：${id}` });
      const current = currentCatalog.find((route) => route.id === id);
      const definition = PUBLIC_ROUTE_DEFINITIONS.find((route) => route.id === id);
      const override = {
        baseUrl: String(submitted.baseUrl ?? current.baseUrl ?? '').trim(),
        model: String(submitted.model ?? current.model ?? '').trim(),
        apiKey: submitted.apiKey && submitted.apiKey !== '********'
          ? String(submitted.apiKey).trim()
          : String(current.apiKey || ''),
      };

      if (definition.pricingMode === 'cost') {
        const inputPrice = Number(submitted.inputRmbPerMillion);
        const outputPrice = Number(submitted.outputRmbPerMillion);
        if (!Number.isFinite(inputPrice) || inputPrice < 0 || !Number.isFinite(outputPrice) || outputPrice < 0) {
          return res.status(400).json({ message: `${definition.alias} 必须填写有效的输入、输出人民币成本价` });
        }
        override.inputRmbPerMillion = inputPrice;
        override.outputRmbPerMillion = outputPrice;
      }
      overrides[id] = override;
    }

    // Preserve routes that were not included in this partial update.
    for (const current of currentCatalog) {
      if (overrides[current.id]) continue;
      const stored = {
        baseUrl: current.baseUrl || '',
        model: current.model || '',
        apiKey: current.apiKey || '',
      };
      if (current.pricingMode === 'cost') {
        stored.inputRmbPerMillion = current.inputRmbPerMillion;
        stored.outputRmbPerMillion = current.outputRmbPerMillion;
      }
      overrides[current.id] = stored;
    }

    const SysConfig = require('../models/SysConfig');
    await SysConfig.findOneAndUpdate(
      { key: 'points_price_catalog' },
      { value: overrides, updatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    process.env.POINTS_PRICE_CATALOG_JSON = JSON.stringify(overrides);

    res.json({
      message: '线路与积分计价已保存并即时生效',
      routes: createPriceCatalog().map(adminRouteView),
    });
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

// ========== 7. 积分活动管理 ==========
const { sendActivityNotification } = require('../services/emailService');

function activityInput(body, creating = false) {
  const output = {};
  const copyString = (key) => {
    if (creating || body[key] !== undefined) output[key] = String(body[key] || '').trim();
  };
  copyString('name');
  copyString('description');
  copyString('emailContent');

  for (const key of ['type', 'difficulty']) {
    if (body[key] !== undefined) output[key] = String(body[key]);
  }
  for (const key of ['startTime', 'endTime']) {
    if (creating || body[key] !== undefined) {
      const date = new Date(body[key]);
      if (Number.isNaN(date.getTime())) throw Object.assign(new Error(`${key} 不是有效时间`), { status: 400 });
      output[key] = date;
    }
  }

  const rewardValue = body.rewardPoints ?? body.tokenAmount;
  if (creating || rewardValue !== undefined) {
    const rewardPoints = Math.floor(Number(rewardValue));
    if (!Number.isFinite(rewardPoints) || rewardPoints < 1) {
      throw Object.assign(new Error('奖励积分必须大于 0'), { status: 400 });
    }
    output.rewardPoints = rewardPoints;
    output.tokenAmount = rewardPoints;
  }
  for (const key of ['minRewardPoints', 'maxRewardPoints']) {
    if (body[key] !== undefined && body[key] !== '') {
      const value = Math.floor(Number(body[key]));
      if (!Number.isFinite(value) || value < 1) throw Object.assign(new Error(`${key} 必须大于 0`), { status: 400 });
      output[key] = value;
    }
  }

  if (creating || body.probability !== undefined) {
    const probability = Number(body.probability ?? 100);
    if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
      throw Object.assign(new Error('中奖概率必须在 0 到 100 之间'), { status: 400 });
    }
    output.probability = probability;
  }
  for (const key of ['dailyLimit', 'perUserLimit', 'totalLimit', 'totalPointsBudget']) {
    if (body[key] !== undefined) {
      const value = Math.floor(Number(body[key]));
      if (!Number.isFinite(value) || value < 0) throw Object.assign(new Error(`${key} 不能小于 0`), { status: 400 });
      output[key] = value;
    }
  }

  if (body.requirement !== undefined) {
    output.requirement = {
      metric: String(body.requirement?.metric || 'none'),
      operator: body.requirement?.operator === 'lte' ? 'lte' : 'gte',
      threshold: Math.max(0, Number(body.requirement?.threshold || 0)),
    };
  }
  for (const key of ['enabled', 'autoClaim']) {
    if (body[key] !== undefined) output[key] = Boolean(body[key]);
  }
  return output;
}

// 获取活动列表
router.get('/activities', async (req, res) => {
  try {
    const activities = await Activity.find().sort({ createdAt: -1 });
    res.json({ activities });
  } catch (error) {
    res.status(500).json({ message: '获取活动列表失败', error: error.message });
  }
});

// 创建活动
router.post('/activities', async (req, res) => {
  try {
    const payload = activityInput(req.body, true);
    if (!payload.name) return res.status(400).json({ message: '请填写活动名称' });
    if (!payload.type) payload.type = 'custom';
    if (!payload.difficulty) payload.difficulty = 'easy';
    if (!payload.requirement) payload.requirement = { metric: 'none', operator: 'gte', threshold: 0 };
    if (payload.dailyLimit === undefined) payload.dailyLimit = 1;
    if (payload.perUserLimit === undefined) payload.perUserLimit = 1;
    if (payload.totalLimit === undefined) payload.totalLimit = 0;
    if (payload.totalPointsBudget === undefined) payload.totalPointsBudget = 0;
    if (payload.enabled === undefined) payload.enabled = true;
    if (payload.autoClaim === undefined) {
      payload.autoClaim = ['login', 'checkin', 'writing', 'continuous', 'invite', 'new_user'].includes(payload.type);
    }
    const activity = new Activity(payload);
    await activity.save();
    res.status(201).json({ message: '活动创建成功', activity });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.status ? error.message : '创建活动失败', error: error.message });
  }
});

// 编辑活动
router.put('/activities/:id', async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ message: '活动不存在' });
    const payload = activityInput(req.body, false);
    Object.assign(activity, payload, { updatedAt: new Date() });
    await activity.save();
    res.json({ message: '活动已更新', activity });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.status ? error.message : '更新失败', error: error.message });
  }
});

router.delete('/activities/:id', async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ message: '活动不存在' });
    if (Number(activity.counters?.attempts || 0) > 0) {
      activity.enabled = false;
      activity.updatedAt = new Date();
      await activity.save();
      return res.json({ message: '活动已有参与记录，已停用并保留审计数据', activity });
    }
    await activity.deleteOne();
    res.json({ message: '活动已删除' });
  } catch (error) {
    res.status(500).json({ message: '删除失败', error: error.message });
  }
});

// 发送活动通知邮件给所有用户
router.post('/activities/:id/send-email', async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ message: '活动不存在' });
    if (activity.emailSent) return res.status(400).json({ message: '邮件已发送过，请勿重复发送' });

    const users = await User.find({ role: 'user' }).select('email');
    const emails = users.map(u => u.email).filter(Boolean);

    res.json({ message: `正在向 ${emails.length} 位用户发送邮件...` });

    // 异步发送，不阻塞响应
    let success = 0, failed = 0;
    for (const email of emails) {
      try {
        await sendActivityNotification(email, activity);
        success++;
      } catch (e) {
        failed++;
        console.error(`[活动邮件] 发送失败 ${email}:`, e.message);
      }
      // 每封邮件间隔 200ms，避免 SMTP 限流
      await new Promise(r => setTimeout(r, 200));
    }

    activity.emailSent = true;
    activity.updatedAt = new Date();
    await activity.save();
    console.log(`[活动邮件] 发送完成: 成功 ${success}, 失败 ${failed}`);
  } catch (error) {
    console.error('[活动邮件] 发送失败:', error);
  }
});

// 获取活动统计（已领取人数等）
router.get('/activities/:id/stats', async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ message: '活动不存在' });

    const participatingUsers = await User.countDocuments({
      'activityClaims.activityId': activity._id
    });

    res.json({
      participatingUsers,
      claimedUsers: participatingUsers,
      attempts: Number(activity.counters?.attempts || 0),
      winners: Number(activity.counters?.winners || 0),
      totalPointsGiven: Number(activity.counters?.pointsAwarded || 0),
    });
  } catch (error) {
    res.status(500).json({ message: '获取统计失败', error: error.message });
  }
});

module.exports = router;
