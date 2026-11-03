const { randomUUID } = require("node:crypto");

const ESCALATION_DELAY_MS = 60_000;
const ALERT_RETENTION_MS = 24 * 60 * 60 * 1000;

function createTelegramService(bot, chatId, friendPhoneNumber, incidentLog) {
  const alerts = new Map();
  const incidents = new Map();

  function scheduleCleanup(alertId, record) {
    record.cleanupTimeout = setTimeout(() => alerts.delete(alertId), ALERT_RETENTION_MS);
    record.cleanupTimeout.unref?.();
  }

  async function sendAlert({ className, confidence, test }) {
    const alertId = randomUUID();
    const incident = incidentLog.recordDetection(alertId, new Date().toISOString());
    incidents.set(alertId, incident);
    const prefix = test ? "[TEST] " : "";
    const text = [
      `${prefix}EmeNoxr alert`,
      `Detected class: ${className}`,
      `Confidence: ${(confidence * 100).toFixed(1)}%`,
      `Received: ${new Date().toISOString()}`,
      "",
      `Test call target: ${friendPhoneNumber}`,
      "The call action is a simulation only; no call will be placed."
    ].join("\n");

    let message;
    try {
      message = await bot.sendMessage(chatId, text, {
        reply_markup: {
          inline_keyboard: [[
            { text: "Call 999 (simulated)", callback_data: `alert:${alertId}:call_999` },
            { text: "False Alarm", callback_data: `alert:${alertId}:false_alarm` }
          ]]
        }
      });
    } catch (error) {
      incident.outcome = "Telegram alert delivery failed.";
      throw error;
    }

    incident.alertTime = new Date().toISOString();
    incident.outcome = "Alert sent; awaiting parent response.";
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

  async function completeSimulatedCall(alertId, record) {
    if (alerts.get(alertId) !== record || record.status !== "call_scheduled") return;
    record.status = "simulated_call";
    const incident = incidents.get(alertId);
    if (incident) {
      incident.outcome = `Simulated call to ${friendPhoneNumber} completed; no call was placed.`;
    }

    await removeButtons({ chat: { id: chatId }, message_id: record.messageId });
    try {
      await bot.sendMessage(
        chatId,
        `SIMULATION ONLY: the 60-second delay ended. A call to ${friendPhoneNumber} would now be placed; no call was made.`
      );
    } catch (error) {
      if (incident) {
        incident.outcome = `Simulated call to ${friendPhoneNumber} could not be confirmed; no call was placed.`;
      }
      console.error("Could not send simulated call completion notice:", error.name || "UnknownError");
    }
    scheduleCleanup(alertId, record);
  }

  async function escalate(alertId, record) {
    if (alerts.get(alertId) !== record || record.status !== "pending") return;
    record.status = "escalated";
    const incident = incidents.get(alertId);
    if (incident) {
      incident.parentResponse = "Timeout";
      incident.outcome = "Timed out; sending simulated escalation notice.";
    }

    await removeButtons({ chat: { id: chatId }, message_id: record.messageId });
    try {
      await bot.sendMessage(
        chatId,
        `No response was received within 60 seconds. SIMULATED ESCALATION ONLY: no call to ${friendPhoneNumber} was placed.`
      );
      if (incident) incident.outcome = "Timed out; simulated escalation notice sent.";
    } catch (error) {
      if (incident) incident.outcome = "Timed out; simulated escalation notice could not be sent.";
      console.error("Could not send simulated escalation notice:", error.name || "UnknownError");
    }
    scheduleCleanup(alertId, record);
  }

  async function handleAction(alertId, action, message) {
    const record = alerts.get(alertId);
    if (!record || !["pending", "call_scheduled"].includes(record.status)) {
      return "This alert is no longer active.";
    }

    const incident = incidents.get(alertId);
    if (action === "call_999") {
      if (record.status === "call_scheduled") {
        return "A simulated call is already scheduled.";
      }

      clearTimeout(record.escalationTimeout);
      record.status = "call_scheduled";
      if (incident) {
        incident.parentResponse = "Call 999";
        incident.outcome = `Call confirmed; simulated call to ${friendPhoneNumber} scheduled in 60 seconds.`;
      }
      record.simulatedCallTimeout = setTimeout(() => {
        void completeSimulatedCall(alertId, record);
      }, ESCALATION_DELAY_MS);
      record.simulatedCallTimeout.unref?.();

      await bot.sendMessage(
        chatId,
        `Call 999 request confirmed. SIMULATION ONLY: a call to ${friendPhoneNumber} is scheduled in 60 seconds. Press False Alarm to cancel; no real call will be placed.`
      );
      return "Call 999 confirmed; simulated call scheduled in 60 seconds.";
    }

    record.status = "false_alarm";
    clearTimeout(record.escalationTimeout);
    clearTimeout(record.simulatedCallTimeout);
    if (incident) {
      incident.parentResponse = "False Alarm";
      incident.outcome = "Alert marked as a false alarm; no call was placed.";
    }
    await removeButtons(message);
    scheduleCleanup(alertId, record);
    await bot.sendMessage(chatId, "This alert was marked as a false alarm. No call was made.");
    return "Marked as false alarm; pending timer cancelled.";
  }

  return { sendAlert, handleAction, alerts };
}

module.exports = { createTelegramService, ESCALATION_DELAY_MS };
