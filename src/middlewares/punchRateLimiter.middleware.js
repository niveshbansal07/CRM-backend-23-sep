const attempts = new Map();

const punchRateLimiter = (req, res, next) => {
  const userId = String(req.user?._id || req.ip);
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxAttempts = 8;
  const key = `${userId}:${req.path}`;
  const record = attempts.get(key) || { count: 0, resetAt: now + windowMs };

  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }

  record.count += 1;
  attempts.set(key, record);

  if (record.count > maxAttempts) {
    return res.status(429).json({
      success: false,
      message: "Too many punch attempts. Please try again shortly.",
    });
  }

  next();
};

module.exports = punchRateLimiter;
