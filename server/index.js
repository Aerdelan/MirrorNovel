const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const path = require('path');
const connectDB = require('./config/db');
const User = require('./models/User');
const Novel = require('./models/Novel');

// 加载环境变量（支持 --env test 加载 .env.test）
const envFile = process.argv.includes('--env') && process.argv[process.argv.indexOf('--env') + 1] === 'test'
  ? '.env.test'
  : '.env';
dotenv.config({ path: path.resolve(__dirname, envFile) });
console.log(`📄 加载环境配置: ${envFile}`);

const startApp = async () => {
  await connectDB();

  try {
    const SysConfig = require('./models/SysConfig');
    const { setCatalogOverrides } = require('./config/modelCatalog');
    const modelConfig = await SysConfig.findOne({ key: 'model_catalog' });
    if (modelConfig?.value) setCatalogOverrides(modelConfig.value);
  } catch (error) {
    console.warn('[Model] 无法加载数据库模型配置，暂用环境变量配置:', error.message);
  }

  // 启动时创建管理员账号
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@xiaoshuo.com';
    const exists = await User.findOne({ email: adminEmail });
    if (!exists) {
      await User.create({
        email: adminEmail,
        password: process.env.ADMIN_PASSWORD || 'admin888',
        nickname: process.env.ADMIN_NICKNAME || '超级管理员',
        role: 'admin',
      });
      console.log(`✅ 管理员账号已创建: ${adminEmail}`);
    } else {
      console.log(`✅ 管理员账号已存在: ${adminEmail}`);
    }
  } catch (e) {
    console.error('创建管理员失败:', e.message);
  }

  // 启动时清理 orphaned 生成状态：服务重启意味着 activeStreams 已丢失，
  // 所有残留的 status='generating' 小说应自动转为 'paused'，否则用户将无法续写。
  try {
    const orphaned = await Novel.updateMany(
      { status: 'generating' },
      { $set: { status: 'paused' } }
    );
    if (orphaned.modifiedCount > 0) {
      console.log(`🔧 启动清理：已将 ${orphaned.modifiedCount} 本孤儿化生成中小说状态重置为 paused`);
    }
  } catch (e) {
    console.warn('启动清理失败（非致命）:', e.message);
  }

  const app = express();

  // 安全：HTTP 安全头 + 收紧 CORS（生产前后端同源；CORS 主要服务于本地开发跨端口）
  app.use(helmet({ crossOriginResourcePolicy: false, crossOriginEmbedderPolicy: false }));
  const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174')
    .split(',').map(s => s.trim()).filter(Boolean);
  app.use(cors({ origin: corsOrigins.length ? corsOrigins : true, credentials: true }));

  // 安全：登录/验证码/重置密码接口限流，防爆破与验证码滥用
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { message: '请求过于频繁，请稍后再试' } });
  const codeLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { message: '验证码请求过于频繁，请稍后再试' } });

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // 路由
  const authRouter = require('./routes/auth');
  // 对验证码/重置相关接口施加更严限流
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/send-code', codeLimiter);
  app.use('/api/auth/send-reset-code', codeLimiter);
  app.use('/api/auth/reset-password', codeLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/novel', require('./routes/novel'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/persona', require('./routes/persona'));

  // 健康检查
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // 全局错误处理：生产环境不向客户端暴露内部错误细节
  app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ message: '请求数据格式无效，请重试' });
    }
    res.status(500).json({ message: '服务器内部错误，请稍后重试' });
  });

  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => {
    console.log(`服务器已启动，端口: ${PORT}`);
    console.log(`API 地址: http://localhost:${PORT}/api`);
    console.log(`管理后台: http://localhost:${PORT}/api/admin`);
  });
  // Long-form generation uses the provider response time rather than Node's default timeout.
  server.timeout = 0;
  server.requestTimeout = 0;
};

startApp();
