const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const TelegramBot = require("node-telegram-bot-api");
const {
  botToken,
  chatId,
  friendPhoneNumber,
  demoSmsConfig,
  port,
  isProduction,
  testMode
} = require("./config/env");
const { pool } = require("./db/pool");
const cryptoService = require("./services/crypto");
const { createUserStore } = require("./services/users");
const { createAuthService } = require("./services/auth");
const { createCameraStore } = require("./services/cameras");
const { createStreamManager } = require("./services/streamManager");
const { createEscalationService } = require("./services/escalation");
const { createRequireAuth } = require("./middleware/requireAuth");
const { createAuthRouter } = require("./routes/auth");
const { createCameraRouter } = require("./routes/cameras");
const { createAlertRouter } = require("./routes/alerts");
const { createTelegramService } = require("./services/telegram");
const { createTelegramCallbackHandler } = require("./handlers/telegramCallbacks");
const { createIncidentLog } = require("./services/incidents");
const { createDemoSmsSender } = require("./services/demoSms");

const app = express();
const users = createUserStore(pool);
const authService = createAuthService({ users });
const requireAuth = createRequireAuth(authService);
const incidentLog = createIncidentLog(pool);
const cameras = createCameraStore(pool, cryptoService);
const streamManager = createStreamManager({ cameras });
const escalation = createEscalationService({ pool });

// Behind a reverse proxy (Render, Railway, Nginx) the rate limiter needs the real client IP.
if (isProduction) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");

// Content-Security-Policy. If the browser console reports a blocked script or
// connection (e.g. TensorFlow.js from a different CDN), add that origin here.
const csp = {
  ...helmet.contentSecurityPolicy.getDefaultDirectives(),
  "script-src": ["'self'", "https://cdn.jsdelivr.net"],
  "img-src": ["'self'", "data:", "blob:"],
  "media-src": ["'self'", "blob:"],
  "connect-src": ["'self'"]
};
if (!isProduction) {
  // Plain http://localhost must not be upgraded to https.
  csp["upgrade-insecure-requests"] = null;
}
app.use(helmet({ contentSecurityPolicy: { directives: csp } }));

app.use(cookieParser());
app.use(express.json({ limit: "16kb" }));
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// PUBLIC: register, login, logout. /me protects itself with requireAuth.
app.use("/api/auth", createAuthRouter({ authService, users, requireAuth }));

// Dashboard page guard: redirect to the login page instead of returning JSON.
function requirePageLogin(req, res, next) {
  const token = req.cookies?.[authService.cookieName];
  if (token) {
    try {
      authService.verifyToken(token);
      next();
      return;
    } catch {
      // fall through to redirect
    }
  }
  res.redirect("/login.html");
}
app.get(["/", "/index.html"], requirePageLogin);
app.use(express.static(path.join(__dirname, "..", "public")));

// PROTECTED + TENANT-SCOPED: user id comes only from the verified token.
app.get("/api/incidents", requireAuth, async (req, res) => {
  try {
    const incidents = await incidentLog.list(req.user.id);
    res.json({ incidents });
  } catch (error) {
    console.error("Incident list failed:", error.name || "UnknownError", error.code || "");
    res.status(500).json({ error: "Incident history could not be loaded." });
  }
});

// PROTECTED + TENANT-SCOPED: camera management and live streams.
// Mounted here (before the /api 404 handler that startServer registers).
app.use("/api/cameras", requireAuth, createCameraRouter({ cameras, streamManager }));

async function startServer() {
  await incidentLog.initialize();

  const bot = new TelegramBot(botToken, { polling: true });
  const sendDemoSms = demoSmsConfig ? createDemoSmsSender(demoSmsConfig) : null;
  if (!sendDemoSms) {
    console.warn("Demo SMS is not configured; the dummy 999 and demo SMS steps will not send email.");
  }
  console.log(`Dummy 999 mode: ${testMode ? "TEST_MODE (test inbox only)" : "mock NG999 (nothing is sent)"}`);

  // Creating the Telegram service registers the escalation handlers, so it must come before start().
  const telegram = createTelegramService(
    bot,
    chatId,
    friendPhoneNumber,
    incidentLog,
    escalation,
    { sendDemoSms, testMode }
  );

  // PROTECTED: only logged-in users can trigger alerts.
  app.use("/api/alerts", requireAuth, createAlertRouter(telegram.sendAlert));

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "API route not found." });
  });
  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: "Request body must be valid JSON." });
      return;
    }
    console.error("HTTP request failed:", error.name || "UnknownError");
    res.status(500).json({ error: "An unexpected server error occurred." });
  });
  bot.on("callback_query", createTelegramCallbackHandler(bot, chatId, telegram.handleAction));
  bot.on("polling_error", error => {
    console.error("Telegram polling failed:", error.name || "UnknownError");
  });

  const server = app.listen(port, () => {
    console.log(`EmeNoxr server listening on http://localhost:${port}`);
  });

  // Starts the 5-second poller. It also runs once immediately, which picks up any escalation
  // that came due while the server was down.
  escalation.start();

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    // Open camera streams never finish on their own, so close them before server.close().
    streamManager.stopAll();
    server.close(async error => {
      if (error) {
        console.error("HTTP server shutdown failed:", error.name || "UnknownError");
      }
      // Order matters: escalation handlers use the bot and the pool, so stop them first.
      try {
        await escalation.stop();
      } catch (stopError) {
        console.error("Escalation shutdown failed:", stopError.name || "UnknownError");
      }
      try {
        await bot.stopPolling();
      } catch (stopError) {
        console.error("Telegram polling shutdown failed:", stopError.name || "UnknownError");
      }
      try {
        await pool.end();
      } catch (closeError) {
        console.error("PostgreSQL pool shutdown failed:", closeError.name || "UnknownError");
      }
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startServer().catch(async error => {
  console.error(
    "Could not start the server. Check DATABASE_URL and Supabase connectivity:",
    error.name || "UnknownError",
    error.code || ""
  );
  try {
    await escalation.stop();
  } catch {
    // nothing to clean up if it never started
  }
  try {
    await pool.end();
  } catch (closeError) {
    console.error("PostgreSQL pool shutdown failed:", closeError.name || "UnknownError");
  }
  process.exitCode = 1;
});