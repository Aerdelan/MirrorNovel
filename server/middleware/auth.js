const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { HEADER_NAME, parseOverrideHeader, mergeModelConfig } = require('../services/localModelConfig');
const { runWithRequestContext } = require('../services/requestContext');
const { open } = require('../services/secretBox');

/**
 * 账号里的模型密钥可能是加密存储的（用户选择"存进账号"时）。
 * 在这里统一解密，后续 AI 调用点就能透明地拿到可用密钥，不必各自关心加密细节。
 */
function decryptedModelConfig(modelConfig) {
  if (!modelConfig) return modelConfig;
  // Mongoose 子文档直接展开（{ ...doc }）只会拿到 $__/$__parent/_doc 等内部字段，
  // provider / baseUrl / 模型名会整份丢失，账号里的云线路于是被静默忽略、请求退回
  // 服务器默认线路（默认线路没配时报“线路尚未配置”）。必须先转成普通对象。
  const plain = typeof modelConfig.toObject === 'function' ? modelConfig.toObject() : modelConfig;
  const provider = plain.provider || 'default';
  if (provider !== 'cloud') return plain;
  const plainKey = open(plain.cloudApiKey);
  if (plainKey === plain.cloudApiKey) return plain;
  return { ...plain, cloudApiKey: plainKey };
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
    if ((decoded.authVersion || 0) !== (user.authVersion || 0)) {
      return res.status(401).json({ message: '密码已修改，请重新登录' });
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
      req.userModelConfig = mergeModelConfig(req.userModelConfig, override.config);
      req.modelConfigFromLocal = true;
    }

    // 把"本次请求实际生效的模型配置"放进请求上下文：内部调用链（写作 agent、
    // 编辑引擎、去AI化、后台任务）没把配置一路传下来时，resolveApiConfig 会
    // 回退到这里，而不是静默落到服务器默认线路。
    // 诊断：一行说清"这次请求是谁发的、用哪条线路"，便于与 [线路] 行对照定位
    // （只在域名/线路层面，不含任何密钥）。
    try {
      const who = user.email || String(user._id);
      const src = req.modelConfigFromLocal
        ? '本机覆盖'
        : `${req.userModelConfig?.provider || '空配置'}${req.userModelConfig?.cloudBaseUrl ? ':' + req.userModelConfig.cloudBaseUrl : ''}`;
      console.log(`[请求] ${who} | ${req.method} ${req.originalUrl?.split('?')[0] || req.url} | 线路来源=${src}`);
    } catch { }
    return runWithRequestContext({ userModelConfig: req.userModelConfig }, () => next());
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: '登录已过期，请重新登录' });
    }
    return res.status(401).json({ message: '认证失败', error: error.message });
  }
};

module.exports = auth;
// 仅供回归测试：验证加密 Key 解密后不会丢掉账号线路字段。
module.exports.decryptedModelConfig = decryptedModelConfig;
