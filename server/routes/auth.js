const express = require('express');
const router = express.Router();
const User = require('../models/User');
const VerificationCode = require('../models/VerificationCode');
const { sendVerificationCode, verifyTransporter } = require('../services/emailService');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');

// 是否启用邮箱发送——如果连接不上就退化为控制台打印
let emailEnabled = true;

// 初始化时检查邮箱可用性（不阻塞启动）
setTimeout(async () => {
  const result = await verifyTransporter();
  if (result.ok) {
    console.log('✅ 邮箱服务连接正常');
  } else {
    emailEnabled = false;
    console.warn(`⚠️  邮箱服务不可用 (${result.error})，验证码将打印到控制台`);
  }
}, 100);

// 生成6位随机验证码
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 发送验证码
router.post('/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: '请输入邮箱地址' });
    }

    // 检查邮箱是否已注册
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: '该邮箱已注册' });
    }

    // 生成验证码
    const code = generateCode();
    
    // 删除该邮箱旧的验证码
    await VerificationCode.deleteMany({ email, type: 'register' });
    
    // 保存新验证码（10分钟有效期）
    const verificationCode = new VerificationCode({
      email,
      code,
      type: 'register',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    await verificationCode.save();

    // 尝试发送邮件
    if (emailEnabled) {
      try {
        await sendVerificationCode(email, code, 'register');
        console.log(`验证码已发送至 ${email}`);
        return res.json({ message: '验证码已发送到您的邮箱' });
      } catch (emailError) {
        console.error('邮件发送失败，转为控制台输出:', emailError.message);
        emailEnabled = false;
      }
    }

    // 邮箱不可用时，打印到控制台并返回
    console.log(`\n═══════════════════════════════════════`);
    console.log(`  📧 验证码（邮箱: ${email}）`);
    console.log(`  🔑 ${code}`);
    console.log(`  ⏰ 有效期 10 分钟`);
    console.log(`═══════════════════════════════════════\n`);
    res.json({
      message: '验证码已发送（邮箱服务暂不可用，请在控制台查看验证码）',
      code, // 开发阶段返回验证码，方便调试
    });
  } catch (error) {
    console.error('发送验证码流程失败:', error);
    res.status(500).json({ message: '发送验证码失败，请稍后重试' });
  }
});

// 注册
router.post('/register', async (req, res) => {
  try {
    const { email, password, code, nickname } = req.body;

    if (!email || !password || !code) {
      return res.status(400).json({ message: '请填写完整信息' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: '密码至少6位' });
    }

    // 验证验证码
    const verification = await VerificationCode.findOne({
      email,
      code,
      type: 'register',
      expiresAt: { $gt: new Date() },
    });

    if (!verification) {
      return res.status(400).json({ message: '验证码无效或已过期' });
    }

    // 检查邮箱是否已注册
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: '该邮箱已注册' });
    }

    // 创建用户
    const user = new User({
      email,
      password,
      nickname: nickname || '书友',
    });
    await user.save();

    // 删除已使用的验证码
    await VerificationCode.deleteMany({ email, type: 'register' });

    // 生成JWT
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.status(201).json({
      message: '注册成功',
      token,
      user: {
        id: user._id,
        email: user.email,
        nickname: user.nickname,
        avatar: user.avatar,
        role: user.role,
        tokens: user.tokens,
        availableTokens: user.availableTokens,
      },
    });
  } catch (error) {
    console.error('注册失败:', error);
    res.status(500).json({ message: '注册失败', error: error.message });
  }
});

// 登录
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: '请输入邮箱和密码' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: '邮箱或密码错误' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: '邮箱或密码错误' });
    }

    if (user.disabled) {
      return res.status(403).json({ message: '账号已被禁用，请联系管理员' });
    }

    // 更新最后登录时间
    user.lastLoginAt = new Date();
    await user.save();

    // 生成JWT
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      message: '登录成功',
      token,
      user: {
        id: user._id,
        email: user.email,
        nickname: user.nickname,
        avatar: user.avatar,
        role: user.role,
        tokens: user.tokens,
        availableTokens: user.availableTokens,
      },
    });
  } catch (error) {
    console.error('登录失败:', error);
    res.status(500).json({ message: '登录失败', error: error.message });
  }
});

// 获取用户信息
router.get('/profile', auth, async (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      email: req.user.email,
      nickname: req.user.nickname,
      avatar: req.user.avatar,
      role: req.user.role,
      disabled: req.user.disabled,
      createdAt: req.user.createdAt,
      modelConfig: req.user.modelConfig || { provider: 'default' },
      tokens: req.user.tokens,
      availableTokens: req.user.availableTokens,
      showAnnouncement: req.user.showAnnouncement,
    },
  });
});

// 更新昵称
router.put('/profile', auth, async (req, res) => {
  try {
    const { nickname } = req.body;
    if (nickname) {
      req.user.nickname = nickname;
      await req.user.save();
    }
    res.json({ message: '更新成功', nickname: req.user.nickname });
  } catch (error) {
    res.status(500).json({ message: '更新失败', error: error.message });
  }
});

// ---- 模型配置 ----

// 获取模型配置
router.get('/model-config', auth, async (req, res) => {
  res.json({ modelConfig: req.user.modelConfig || { provider: 'default' } });
});

// 保存模型配置
router.put('/model-config', auth, async (req, res) => {
  try {
    const { provider, ollamaModel, cloudBaseUrl, cloudModel, cloudApiKey } = req.body;
    
    if (provider && !['default', 'system', 'ollama', 'cloud'].includes(provider)) {
      return res.status(400).json({ message: '无效的 provider' });
    }

    // 取前端所有字段
    const {
      ollamaBaseUrl, ollamaOutlineModel, ollamaWritingModel,
      ollamaPolishModel, ollamaReasoningModel,
      cloudOutlineModel, cloudWritingModel, cloudPolishModel, cloudReasoningModel,
    } = req.body;

    const config = { provider: provider || 'default' };
    if (provider === 'ollama') {
      config.ollamaBaseUrl = ollamaBaseUrl || 'http://localhost:11434';
      config.ollamaOutlineModel = ollamaOutlineModel || '';
      config.ollamaWritingModel = ollamaWritingModel || '';
      config.ollamaPolishModel = ollamaPolishModel || '';
      config.ollamaReasoningModel = ollamaReasoningModel || '';
    } else if (provider === 'cloud') {
      config.cloudBaseUrl = req.body.cloudBaseUrl || '';
      config.cloudApiKey = req.body.cloudApiKey || '';
      config.cloudOutlineModel = cloudOutlineModel || '';
      config.cloudWritingModel = cloudWritingModel || '';
      config.cloudPolishModel = cloudPolishModel || '';
      config.cloudReasoningModel = cloudReasoningModel || '';
    }

    req.user.modelConfig = config;
    await req.user.save();
    res.json({ message: '模型配置已保存', modelConfig: config });
  } catch (error) {
    res.status(500).json({ message: '保存配置失败', error: error.message });
  }
});

// ---- 用户统计 ----
router.get('/stats', auth, async (req, res) => {
  try {
    const Novel = require('../models/Novel')
    const novels = await Novel.find({ userId: req.userId }).select('status currentWordCount')
    const totalNovels = novels.length
    const totalWords = novels.reduce((s, n) => s + (n.currentWordCount || 0), 0)
    const completedNovels = novels.filter(n => n.status === 'completed').length
    const inProgressNovels = novels.filter(n => n.status === 'generating' || n.status === 'paused').length
    res.json({ totalNovels, totalWords, completedNovels, inProgressNovels })
  } catch (error) {
    res.status(500).json({ message: '获取统计失败', error: error.message })
  }
})

// ---- Token / 支付 / 公告 ----

// 获取用户 token 信息
router.get('/tokens', auth, async (req, res) => {
  res.json({
    total: req.user.tokens.total,
    used: req.user.tokens.used,
    available: req.user.availableTokens,
  });
});

// 假支付：购买 token
router.post('/purchase', auth, async (req, res) => {
  try {
    const { amount, method } = req.body; // amount: 充值金额(元), method: 'alipay'
    const tokenPrice = 15; // 15元/100万token
    const tokenAmount = Math.floor((amount || 0) / tokenPrice * 1000000);

    if (tokenAmount <= 0) {
      return res.status(400).json({ message: '充值金额无效' });
    }

    // 假装支付成功
    req.user.tokens.total += tokenAmount;
    await req.user.save();

    res.json({
      message: `充值成功！获得 ${tokenAmount.toLocaleString()} Token`,
      total: req.user.tokens.total,
      available: req.user.availableTokens,
      paid: amount,
      method,
      tokenAmount,
    });
  } catch (error) {
    res.status(500).json({ message: '充值失败', error: error.message });
  }
});

// 关闭公告
router.post('/dismiss-announcement', auth, async (req, res) => {
  req.user.showAnnouncement = false;
  await req.user.save();
  res.json({ ok: true });
});

// 检查是否显示公告
router.get('/announcement', auth, async (req, res) => {
  res.json({ show: req.user.showAnnouncement });
});

// 获取本地 Ollama 模型列表
router.get('/ollama/models', auth, async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch('http://localhost:11434/api/tags', {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Ollama 返回 ${response.status}`);
    }

    const data = await response.json();
    const models = (data.models || data.models || []).map(m => ({
      name: m.name,
      size: m.size,
      modified: m.modified_at,
    }));
    res.json({ models });
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ message: 'Ollama 连接超时，请确认 Ollama 服务已启动' });
    }
    res.status(502).json({ message: '获取 Ollama 模型失败: ' + error.message });
  }
});

module.exports = router;
