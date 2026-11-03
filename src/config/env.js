const dotenv = require("dotenv");

dotenv.config();

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

if (!botToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is required. Set it in your .env file.");
}
if (!chatId || !/^-?\d+$/.test(chatId)) {
  throw new Error("TELEGRAM_CHAT_ID must be a numeric Telegram chat ID.");
}

module.exports = { botToken, chatId, port };
