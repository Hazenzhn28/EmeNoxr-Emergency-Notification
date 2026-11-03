const { randomUUID } = require("node:crypto");

const ESCALATION_DELAY_MS = 60_000;
const ALERT_RETENTION_MS = 24 * 60 * 60 * 1000;

function createTelegramService(bot, chatId, friendPhoneNumber, incidentLog, sendDemoSms = null) {
  const alerts = new Map();

  async function updateIncident(alertId, updates) {
    try {
      await incidentLog.update(alertId, updates);
    } catch (error) {
      console.error("Could not update incident history:", error.name || "UnknownError");
    }
  }

  function scheduleCleanup(alertId, record) {
    record.cleanupTimeout = setTimeout(() => alerts.delete(alertId), ALERT_RETENTION_MS);
    record.cleanupTimeout.unref?.();
  }

  async function sendAlert({ className, confidence, test }) {
    const alertId = randomUUID();
    await incidentLog.recordDetection(alertId, new Date().toISOString());
    const prefix = test ? "[TEST] " : "";
    const text = [
      `${prefix}EmeNoxr alert`,
      `Detected class: ${className}`,
      `Confidence: ${(confidence * 100).toFixed(1)}%`,
      `Received: ${new Date().toISOString()}`,
      "",
      `Demo message target: ${friendPhoneNumber}`,
      "The 999 action never places a call. If configured, it sends a clearly labeled demo SMS after 60 seconds."
    ].join("\n");

    let message;
    try {
      message = await bot.sendMessage(chatId, text, {
        reply_markup: {
          inline_keyboard: [[
            { text: "Call 999 (demo SMS in 60s)", callback_data: `alert:${alertId}:call_999` },
            { text: "False Alarm", callback_data: `alert:${alertId}:false_alarm` }
          ]]
        }
      });
    } catch (error) {
      await updateIncident(alertId, { outcome: "Telegram alert delivery failed." });
      throw error;
    }

    await updateIncident(alertId, {
      alertTime: new Date().toISOString(),
      outcome: "Alert sent; awaiting parent response."
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

  async function completeSimulatedCall(alertId, record) {
    if (alerts.get(alertId) !== record || record.status !== "call_scheduled") return;
    record.status = "simulated_call";
    await removeButtons({ chat: { id: chatId }, message_id: record.messageId });
    let deliveryNotice;
    try {
      if (!sendDemoSms) {
        throw new Error("Demo SMS is not configured.");
      }
      await sendDemoSms();
      await updateIncident(alertId, {
        outcome: "DEMO SMS sent through the configured email-to-SMS gateway; no call was placed."
      });
      deliveryNotice = "The clearly labeled DEMO SMS was sent; no call was placed.";
    } catch (error) {
      await updateIncident(alertId, {
        outcome: "DEMO SMS was not sent; no call was placed."
      });
      console.error("Could not send demo SMS:", error.name || "UnknownError");
      deliveryNotice = "The DEMO SMS could not be sent; no call was placed.";
    }

    try {
      await bot.sendMessage(
        chatId,
        `SIMULATION ONLY: the 60-second delay ended. ${deliveryNotice}`
      );
    } catch (error) {
      console.error("Could not send demo escalation confirmation:", error.name || "UnknownError");
    }
    scheduleCleanup(alertId, record);
  }

  async function escalate(alertId, record) {
    if (alerts.get(alertId) !== record || record.status !== "pending") return;
    record.status = "escalated";
    await updateIncident(alertId, {
      parentResponse: "Timeout",
      outcome: "Timed out; sending simulated escalation notice."
    });

    await removeButtons({ chat: { id: chatId }, message_id: record.messageId });
    try {
      await bot.sendMessage(
        chatId,
        `No response was received within 60 seconds. SIMULATED ESCALATION ONLY: no call to ${friendPhoneNumber} was placed.`
      );
      await updateIncident(alertId, { outcome: "Timed out; simulated escalation notice sent." });
    } catch (error) {
      await updateIncident(alertId, { outcome: "Timed out; simulated escalation notice could not be sent." });
      console.error("Could not send simulated escalation notice:", error.name || "UnknownError");
    }
    scheduleCleanup(alertId, record);
  }

  async function handleAction(alertId, action, message) {
    const record = alerts.get(alertId);
    if (!record || !["pending", "call_scheduled"].includes(record.status)) {
      return "This alert is no longer active.";
    }

    if (action === "call_999") {
      if (record.status === "call_scheduled") {
        return "A simulated call is already scheduled.";
      }

      clearTimeout(record.escalationTimeout);
      record.status = "call_scheduled";
      await updateIncident(alertId, {
        parentResponse: "Call 999",
        outcome: `Call confirmed; simulated call to ${friendPhoneNumber} scheduled in 60 seconds.`
      });
      record.simulatedCallTimeout = setTimeout(() => {
        void completeSimulatedCall(alertId, record);
      }, ESCALATION_DELAY_MS);
      record.simulatedCallTimeout.unref?.();

      await bot.sendMessage(
        chatId,
        `Call 999 request confirmed. DEMO ONLY: a clearly labeled test SMS to ${friendPhoneNumber} is scheduled in 60 seconds if configured. Press False Alarm to cancel; no call will be placed.`
      );
      return "Call 999 confirmed; demo SMS scheduled in 60 seconds.";
    }

    record.status = "false_alarm";
    clearTimeout(record.escalationTimeout);
    clearTimeout(record.simulatedCallTimeout);
    await updateIncident(alertId, {
      parentResponse: "False Alarm",
      outcome: "Alert marked as a false alarm; no call was placed."
    });
    await removeButtons(message);
    scheduleCleanup(alertId, record);
    await bot.sendMessage(chatId, "This alert was marked as a false alarm. No call was made.");
    return "Marked as false alarm; pending timer cancelled.";
  }

  return { sendAlert, handleAction, alerts };
}

module.exports = { createTelegramService, ESCALATION_DELAY_MS };
