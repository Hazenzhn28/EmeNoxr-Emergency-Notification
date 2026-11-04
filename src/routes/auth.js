const express = require("express");
const { z } = require("zod");
const { AuthError } = require("../services/auth");
const { validateBody } = require("../middleware/validate");
const { loginLimiter, registerLimiter } = require("../middleware/rateLimit");

const email = z.string().trim().toLowerCase().max(254).email("Enter a valid email address.");

const registerSchema = z
  .object({
    email,
    password: z
      .string()
      .min(12, "Password must be at least 12 characters.")
      .max(128, "Password must be at most 128 characters."),
    fullName: z.string().trim().min(1).max(100).optional()
  })
  .strict(); // rejects unexpected keys

const loginSchema = z
  .object({
    email,
    // No minimum here: don't reveal the password policy to attackers.
    password: z.string().min(1).max(128)
  })
  .strict();

// Express 4 doesn't catch rejected promises, so forward them to next().
const asyncHandler = handler => (req, res, next) => handler(req, res, next).catch(next);

function createAuthRouter({ authService, users, requireAuth }) {
  const router = express.Router();

  router.post(
    "/register",
    registerLimiter,
    validateBody(registerSchema),
    asyncHandler(async (req, res) => {
      try {
        const user = await authService.register(req.body);
        authService.setAuthCookie(res, authService.signToken(user));
        res.status(201).json({ user });
      } catch (error) {
        if (error instanceof AuthError) {
          res.status(error.status).json({ error: error.message });
          return;
        }
        throw error;
      }
    })
  );

  router.post(
    "/login",
    loginLimiter,
    validateBody(loginSchema),
    asyncHandler(async (req, res) => {
      try {
        const user = await authService.authenticate(req.body);
        authService.setAuthCookie(res, authService.signToken(user));
        res.json({ user });
      } catch (error) {
        if (error instanceof AuthError) {
          res.status(error.status).json({ error: error.message });
          return;
        }
        throw error;
      }
    })
  );

  // Public and idempotent: clearing a cookie that isn't there is harmless.
  router.post("/logout", (req, res) => {
    authService.clearAuthCookie(res);
    res.json({ ok: true });
  });

  // Lets the frontend check "am I logged in?" on page load.
  router.get(
    "/me",
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = await users.findById(req.user.id);
      if (!user) {
        // Valid token for an account that no longer exists.
        authService.clearAuthCookie(res);
        res.status(401).json({ error: "Authentication required." });
        return;
      }
      res.json({ user });
    })
  );

  return router;
}

module.exports = { createAuthRouter };