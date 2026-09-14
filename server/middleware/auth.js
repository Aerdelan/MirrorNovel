const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { HEADER_NAME, parseOverrideHeader, mergeModelConfig } = require('../services/localModelConfig');
const { open } = require('../services/secretBox');

/**
 * 账号里的模型密钥可能是加密存储的（用户选择"存进账号"时）。
 * 在这里统一解密，后续 AI 调用点就能透明地拿到可用密钥，不必各自关心加密细节。
 */
function decryptedModelConfig(modelConfig) {
  if (!modelConfig) return modelConfig;
  const provider = modelConfig.provider || 'default';
  if (provider !== 'cloud') return modelConfig;
  const plainKey = open(modelConfig.cloudApiKey);
  if (plainKey === modelConfig.cloudApiKey) return modelConfig;
  return { ...modelConfig, cloudApiKey: plainKey };
}

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

    // 本次请求实际使用的模型配置。
    // 默认取账号里的配置；若桌面端带了"仅存本地"的配置头，则只在本次调用中生效，
    // 绝不写回用户文档（密钥不进服务器数据库）。AI 调用点统一读 req.userModelConfig。
    req.userModelConfig = decryptedModelConfig(user.modelConfig);
    const override = parseOverrideHeader(req.headers[HEADER_NAME]);
    if (override.ok) {
      req.userModelConfig = mergeModelConfig(user.modelConfig, override.config);
      req.modelConfigFromLocal = true;
    }

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: '登录已过期，请重新登录' });
    }
    return res.status(401).json({ message: '认证失败', error: error.message });
  }
};

module.exports = auth;
