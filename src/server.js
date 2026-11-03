const path = require("node:path");
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const { botToken, chatId, friendPhoneNumber, port } = require("./config/env");
const { createAlertRouter } = require("./routes/alerts");
const { createTelegramService } = require("./services/telegram");
const { createTelegramCallbackHandler } = require("./handlers/telegramCallbacks");

const app = express();
const bot = new TelegramBot(botToken, { polling: true });
const telegram = createTelegramService(bot, chatId, friendPhoneNumber);

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/api/alerts", createAlertRouter(telegram.sendAlert));

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

function shutdown() {
  server.close(() => {
    void bot.stopPolling().finally(() => process.exit(0));
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
