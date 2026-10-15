// 通用内存滑窗限流器（docx 十一·低：登录限流）。
// 抽成纯工厂便于单测；生产多实例部署应换 Redis 实现。
function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 10, keyFn = (req) => req.ip } = {}) {
  const hits = new Map();
  let lastSweep = Date.now();

  function sweep(now) {
    if (now - lastSweep < windowMs / 2) return;
    for (const [key, window] of hits) {
      if (now - window.start > windowMs * 2) hits.delete(key);
    }
    lastSweep = now;
  }

  function limiter(req, res, next) {
    const now = Date.now();
    sweep(now);
    const key = String(keyFn(req) || 'unknown');
    let window = hits.get(key);
    if (!window || now - window.start > windowMs) {
      window = { start: now, count: 0 };
      hits.set(key, window);
    }
    window.count += 1;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - window.count));
    if (window.count > max) {
      const retryAfter = Math.ceil((window.start + windowMs - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({ message: `请求过于频繁，请 ${retryAfter} 秒后重试` });
    }
    next();
  }
  return limiter;
}

module.exports = { createRateLimiter };
