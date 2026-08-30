const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader ? authHeader.split(' ')[1] : req.query.token;
    if (!token) {
      return res.status(401).json({ message: '未登录，请先登录' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({ message: '用户不存在' });
    }
    // 禁用拦截必须放在每次鉴权里：只拦登录的话，已签发的 token 在有效期内
    // 仍能调用所有受保护接口，禁用形同虚设。
    if (user.disabled) {
      return res.status(403).json({ message: '账号已被禁用，请联系管理员', disabled: true });
    }

    req.user = user;
    req.userId = user._id;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: '登录已过期，请重新登录' });
    }
    return res.status(401).json({ message: '认证失败', error: error.message });
  }
};

module.exports = auth;
