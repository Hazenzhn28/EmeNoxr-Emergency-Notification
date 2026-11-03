const dotenv = require("dotenv");

dotenv.config();

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
const friendPhoneNumber = process.env.TELEGRAM_FRIEND_PHONE_NUMBER?.trim();

if (!botToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is required. Set it in your .env file.");
}
if (!chatId || !/^-?\d+$/.test(chatId)) {
  throw new Error("TELEGRAM_CHAT_ID must be a numeric Telegram chat ID.");
}
if (!friendPhoneNumber || !/^\+?\d{6,15}$/.test(friendPhoneNumber.replace(/[\s()-]/g, ""))) {
  throw new Error("TELEGRAM_FRIEND_PHONE_NUMBER must be a valid phone number. Set it in your .env file.");
}

module.exports = { botToken, chatId, friendPhoneNumber, port };
