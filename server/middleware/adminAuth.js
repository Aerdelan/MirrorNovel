const jwt = require('jsonwebtoken');
const User = require('../models/User');

const adminAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader ? authHeader.split(' ')[1] : req.query.token;
    if (!token) {
      return res.status(401).json({ message: '未登录' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) return res.status(401).json({ message: '用户不存在' });
    if (user.role !== 'admin') return res.status(403).json({ message: '权限不足，需要管理员账号' });
    if (user.disabled) return res.status(403).json({ message: '账号已被禁用' });
    req.user = user;
    req.userId = user._id;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') return res.status(401).json({ message: '登录已过期' });
    return res.status(401).json({ message: '认证失败' });
  }
};

module.exports = adminAuth;
