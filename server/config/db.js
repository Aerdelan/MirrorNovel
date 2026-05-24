const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('错误: 未设置 MONGODB_URI 环境变量');
    process.exit(1);
  }
  console.log('正在连接 MongoDB...');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log('MongoDB 已连接');
};

module.exports = connectDB;
