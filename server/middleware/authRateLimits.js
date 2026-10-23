const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { normalizeEmail } = require('../services/authValidation');
const policy = require('../config/authPolicy');

function applyAuthRateLimits(app, options = {}) {
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const handler = code => (req, res) => {
    const retryAfter = Math.max(1, Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000));
    res.set('Retry-After', String(retryAfter)).status(429).json({
      code, retryAfter,
      message: `请求较多，请在${retryAfter}秒后重试`,
    });
  };
  // A broad IP ceiling for SMTP abuse; shared-office users no longer share a
  // ten-per-hour quota with registration and password-reset submissions.
  const sendLimiter = rateLimit({
    windowMs, limit: options.sendLimit ?? policy.codeIpLimit,
    standardHeaders: true, legacyHeaders: false,
    handler: handler('EMAIL_CODE_RATE_LIMITED'),
  });
  const loginLimiter = rateLimit({
    windowMs, limit: options.loginLimit ?? 30,
    keyGenerator: req => `${ipKeyGenerator(req.ip)}:${normalizeEmail(req.body?.email).slice(0, 254)}`,
    skipSuccessfulRequests: true,
    standardHeaders: true, legacyHeaders: false,
    handler: handler('LOGIN_RATE_LIMITED'),
  });
  const loginIpLimiter = rateLimit({
    windowMs, limit: options.loginIpLimit ?? 300,
    skipSuccessfulRequests: true,
    standardHeaders: true, legacyHeaders: false,
    handler: handler('LOGIN_RATE_LIMITED'),
  });
  app.use('/api/auth/login', loginIpLimiter, loginLimiter);
  app.use('/api/auth/send-code', sendLimiter);
  app.use('/api/auth/send-reset-code', sendLimiter);
  // Code attempts are counted per email/code in consumeCode, independently
  // of mail sending. A correct delivered code can still be submitted at a cap.
}

module.exports = { applyAuthRateLimits };
