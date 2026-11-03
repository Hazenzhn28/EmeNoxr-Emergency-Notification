const path = require("node:path");
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const { Pool } = require("pg");
const {
  botToken,
  chatId,
  friendPhoneNumber,
  databaseUrl,
  port
} = require("./config/env");
const { createAlertRouter } = require("./routes/alerts");
const { createTelegramService } = require("./services/telegram");
const { createTelegramCallbackHandler } = require("./handlers/telegramCallbacks");
const { createIncidentLog } = require("./services/incidents");

const app = express();
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: true }
});
const incidentLog = createIncidentLog(pool);

pool.on("error", error => {
  console.error("Unexpected PostgreSQL pool error:", error.name || "UnknownError", error.code || "");
});

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("/api/incidents", async (req, res) => {
  try {
    const incidents = await incidentLog.list();
    res.json({ incidents });
  } catch (error) {
    console.error("Incident list failed:", error.name || "UnknownError", error.code || "");
    res.status(500).json({ error: "Incident history could not be loaded." });
  }
});
async function startServer() {
  await incidentLog.initialize();

  const bot = new TelegramBot(botToken, { polling: true });
  const telegram = createTelegramService(bot, chatId, friendPhoneNumber, incidentLog);
  app.use("/api/alerts", createAlertRouter(telegram.sendAlert));
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

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(async error => {
      if (error) {
        console.error("HTTP server shutdown failed:", error.name || "UnknownError");
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
    await pool.end();
  } catch (closeError) {
    console.error("PostgreSQL pool shutdown failed:", closeError.name || "UnknownError");
  }
  process.exitCode = 1;
});
