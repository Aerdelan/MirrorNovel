const express = require('express');
const cors = require('cors');
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

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // 路由
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/novel', require('./routes/novel'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/persona', require('./routes/persona'));

  // 健康检查
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // 全局错误处理
  app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ message: '请求数据格式无效，请重试', error: err.message });
    }
    res.status(500).json({ message: '服务器内部错误', error: err.message });
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
