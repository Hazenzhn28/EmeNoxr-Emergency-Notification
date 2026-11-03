const { randomUUID } = require("node:crypto");

const ESCALATION_DELAY_MS = 60_000;
const ALERT_RETENTION_MS = 24 * 60 * 60 * 1000;

function createTelegramService(bot, chatId) {
  const alerts = new Map();

  function scheduleCleanup(alertId, record) {
    record.cleanupTimeout = setTimeout(() => alerts.delete(alertId), ALERT_RETENTION_MS);
    record.cleanupTimeout.unref?.();
  }

  async function sendAlert({ className, confidence, test }) {
    const alertId = randomUUID();
    const prefix = test ? "[TEST] " : "";
    const text = [
      `${prefix}EmeNoxr alert`,
      `Detected class: ${className}`,
      `Confidence: ${(confidence * 100).toFixed(1)}%`,
      `Received: ${new Date().toISOString()}`,
      "",
      "Choose an action below. The 999 action is a simulation only."
    ].join("\n");

    const message = await bot.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [[
          { text: "Call 999 (simulated)", callback_data: `alert:${alertId}:call_999` },
          { text: "False Alarm", callback_data: `alert:${alertId}:false_alarm` }
        ]]
      }
    });

    const record = { status: "pending", messageId: message.message_id };
    alerts.set(alertId, record);
    record.escalationTimeout = setTimeout(() => {
      void escalate(alertId, record);
    }, ESCALATION_DELAY_MS);
    record.escalationTimeout.unref?.();
    return alertId;
  }

  async function removeButtons(message) {
    if (!message?.message_id) return;
    try {
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: message.chat.id, message_id: message.message_id }
      );
    } catch (error) {
      console.error("Could not update Telegram alert buttons:", error.name || "UnknownError");
    }
  }

  async function escalate(alertId, record) {
    if (alerts.get(alertId) !== record || record.status !== "pending") return;
    record.status = "escalated";

    await removeButtons({ chat: { id: chatId }, message_id: record.messageId });
    try {
      await bot.sendMessage(
        chatId,
        "No response was received within 60 seconds. SIMULATED ESCALATION ONLY: no 999 call was placed and no emergency services were contacted."
      );
    } catch (error) {
      console.error("Could not send simulated escalation notice:", error.name || "UnknownError");
    }
    scheduleCleanup(alertId, record);
  }

  async function handleAction(alertId, action, message) {
    const record = alerts.get(alertId);
    if (!record || record.status !== "pending") {
      return "This alert is no longer active.";
    }

    record.status = action === "call_999" ? "simulated_call" : "false_alarm";
    clearTimeout(record.escalationTimeout);
    await removeButtons(message);
    scheduleCleanup(alertId, record);

    const response = action === "call_999"
      ? "SIMULATION ONLY: a 999 call would be placed. No call was made."
      : "This alert was marked as a false alarm. No call was made.";
    await bot.sendMessage(chatId, response);
    return action === "call_999" ? "999 call simulated; no call was made." : "Marked as false alarm.";
  }

  return { sendAlert, handleAction, alerts };
}

module.exports = { createTelegramService, ESCALATION_DELAY_MS };
