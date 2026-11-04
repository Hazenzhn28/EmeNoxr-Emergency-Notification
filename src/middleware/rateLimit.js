const rateLimit = require("express-rate-limit");

const tooMany = (req, res) =>
  res.status(429).json({ error: "Too many attempts. Please try again later." });

// Failed and successful logins both count toward the limit only if they fail.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooMany
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooMany
});

module.exports = { loginLimiter, registerLimiter };