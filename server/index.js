const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const connectDB = require('./config/db');
const User = require('./models/User');

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '.env') });

// 清理残留 Chromium 进程
const { execSync } = require('child_process');
try { execSync('pkill -f "ms-playwright" 2>/dev/null || true') } catch {}

const startApp = async () => {
  await connectDB();

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
        tokens: { total: 999999999, used: 0 },
      });
      console.log(`✅ 管理员账号已创建: ${adminEmail}`);
    } else {
      console.log(`✅ 管理员账号已存在: ${adminEmail}`);
    }
  } catch (e) {
    console.error('创建管理员失败:', e.message);
  }

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // 路由
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/novel', require('./routes/novel'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/reference', require('./routes/reference'));

  // 健康检查
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // 全局错误处理
  app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({ message: '服务器内部错误', error: err.message });
  });

  // 延长超时，番茄全本下载可能需 10-15 分钟
  app.timeout = 1200000; // 20 分钟

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`服务器已启动，端口: ${PORT}`);
    console.log(`API 地址: http://localhost:${PORT}/api`);
    console.log(`管理后台: http://localhost:${PORT}/api/admin`);
  });
};

startApp();
