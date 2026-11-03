const dotenv = require("dotenv");

dotenv.config();

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
const friendPhoneNumber = process.env.TELEGRAM_FRIEND_PHONE_NUMBER?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
const databaseSslCaPath = process.env.DATABASE_SSL_CA?.trim();
const smtpHost = process.env.SMTP_HOST?.trim();
const smtpPortValue = process.env.SMTP_PORT?.trim();
const smtpUser = process.env.SMTP_USER?.trim();
const smtpPassword = process.env.SMTP_PASS?.trim();
const smtpFrom = process.env.SMTP_FROM?.trim();
const demoSmsTo = process.env.DEMO_SMS_TO?.trim();

if (!botToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is required. Set it in your .env file.");
}
if (!chatId || !/^-?\d+$/.test(chatId)) {
  throw new Error("TELEGRAM_CHAT_ID must be a numeric Telegram chat ID.");
}
if (!friendPhoneNumber || !/^\+?\d{6,15}$/.test(friendPhoneNumber.replace(/[\s()-]/g, ""))) {
  throw new Error("TELEGRAM_FRIEND_PHONE_NUMBER must be a valid phone number. Set it in your .env file.");
}
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Set your Supabase PostgreSQL connection URI in .env.");
}

let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  throw new Error("DATABASE_URL must be a valid PostgreSQL connection URI.");
}
if (!["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)) {
  throw new Error("DATABASE_URL must use the postgres:// or postgresql:// scheme.");
}

const smtpValues = [smtpHost, smtpPortValue, smtpUser, smtpPassword, smtpFrom];
const smtpConfiguredCount = smtpValues.filter(Boolean).length;
if (smtpConfiguredCount !== 0 && smtpConfiguredCount !== smtpValues.length) {
  throw new Error(
    "Demo SMS requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM together in .env."
  );
}

let demoSmsConfig = null;
if (smtpConfiguredCount === smtpValues.length) {
  if (!demoSmsTo) {
    throw new Error("DEMO_SMS_TO is required when SMTP demo SMS is configured.");
  }
  const smtpPort = Number(smtpPortValue);
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error("SMTP_PORT must be an integer between 1 and 65535.");
  }
  demoSmsConfig = {
    host: smtpHost,
    port: smtpPort,
    user: smtpUser,
    password: smtpPassword,
    from: smtpFrom,
    to: demoSmsTo
  };
}

module.exports = {
  botToken,
  chatId,
  friendPhoneNumber,
  databaseUrl,
  databaseSslCaPath,
  demoSmsConfig,
  port
};
