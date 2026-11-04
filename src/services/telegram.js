const { randomUUID } = require("node:crypto");

const ESCALATION_DELAY_MS = 60_000;
const MESSAGE_RETENTION_MS = 24 * 60 * 60 * 1000;

// Six decimal places is roughly 0.1 m, which is far more precision than a phone GPS has.
function mapsLink(lat, lng) {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function createTelegramService(
  bot,
  chatId,
  friendPhoneNumber,
  incidentLog,
  escalation,
  { sendDemoSms = null, testMode = true } = {}
) {
  // Only used to remove the buttons from the original message. The escalation itself does
  // not depend on it, so losing it on a restart is harmless.
  const messageIds = new Map();

  function rememberMessage(alertId, messageId) {
    messageIds.set(alertId, messageId);
    const timeout = setTimeout(() => messageIds.delete(alertId), MESSAGE_RETENTION_MS);
    timeout.unref?.();
  }

  async function updateIncident(alertId, updates) {
    try {
      await incidentLog.update(alertId, updates);
    } catch (error) {
      console.error("Could not update incident history:", error.name || "UnknownError");
    }
  }

  async function removeButtons(messageId) {
    if (!messageId) return;
    try {
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: chatId, message_id: messageId }
      );
    } catch (error) {
      console.error("Could not update Telegram alert buttons:", error.name || "UnknownError");
    }
  }

  // Notices are best-effort: a failed Telegram message must never block or retry an escalation.
  async function say(text) {
    try {
      await bot.sendMessage(chatId, text);
    } catch (error) {
      console.error("Could not send Telegram notice:", error.name || "UnknownError");
    }
  }

  async function sendAlert({
    className,
    confidence,
    test,
    userId,
    locationLat = null,
    locationLng = null
  }) {
    if (!userId) {
      throw new TypeError("sendAlert requires the owning userId.");
    }
    const hasLocation = typeof locationLat === "number" && typeof locationLng === "number";

    const alertId = randomUUID();
    await incidentLog.recordDetection(alertId, new Date().toISOString(), userId, {
      locationLat: hasLocation ? locationLat : null,
      locationLng: hasLocation ? locationLng : null
    });

    const prefix = test ? "[TEST] " : "";
    const text = [
      `${prefix}EmeNoxr alert`,
      `Detected class: ${className}`,
      `Confidence: ${(confidence * 100).toFixed(1)}%`,
      `Received: ${new Date().toISOString()}`,
      hasLocation
        ? `Location: ${mapsLink(locationLat, locationLng)}`
        : "Location: not available",
      "",
      `Demo message target: ${friendPhoneNumber}`,
      "The 999 action never places a call. If nobody responds, the dummy 999 protocol runs after about 2 minutes."
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

    rememberMessage(alertId, message.message_id);
    await updateIncident(alertId, {
      alertTime: new Date().toISOString(),
      outcome: "Alert sent; awaiting parent response."
    });

    // Level 1 (this Telegram alert) is done. Level 2 is saved in the database, so it survives a restart.
    try {
      await escalation.schedule(alertId, {
        level: 2,
        action: "timeout_notice",
        delayMs: ESCALATION_DELAY_MS
      });
    } catch (error) {
      await updateIncident(alertId, {
        outcome: "Alert sent, but the escalation timer could not be saved."
      });
      throw error;
    }
    return alertId;
  }

  // ---- Escalation handlers ----------------------------------------------------------

  // Level 2: no response within 60s. Safe to run again after a partial failure (every step is
  // idempotent), which is why it also accepts the "Timeout" state.
  escalation.register(
    "timeout_notice",
    async ({ event }) => {
      const moved = await incidentLog.transition(event.alertId, ["Pending", "Timeout"], {
        parentResponse: "Timeout",
        escalationLevel: 2,
        outcome: "No response in 60 seconds (level 2). Dummy 999 runs in 60 more seconds unless someone responds."
      });
      if (!moved) return "skipped: parent responded first";

      await escalation.schedule(event.alertId, {
        level: 3,
        action: "dummy_999",
        delayMs: ESCALATION_DELAY_MS
      });

      await say(
        "No response was received within 60 seconds (level 2). " +
        "Emergency contacts would be notified at this step once that feature is added. " +
        "If nobody responds within another 60 seconds, the dummy 999 protocol runs. " +
        "You can still press a button on the alert message."
      );
      return "level 2 reached; level 3 scheduled";
    },
    { runIf: ["Pending", "Timeout"] }
  );

  // Level 3: still no response after another 60s.
  escalation.register(
    "dummy_999",
    async ({ event, finalAttempt }) => {
      const moved = await incidentLog.transition(event.alertId, ["Pending", "Timeout"], {
        parentResponse: "Timeout",
        escalationLevel: 3,
        outcome: "No response (level 3). Dummy 999 protocol triggered."
      });
      if (!moved) return "skipped: parent responded first";

      let outcome;
      let notice;
      try {
        if (testMode) {
          if (!sendDemoSms) {
            outcome = "Dummy 999 email not sent: SMTP is not configured. No call was placed.";
            notice = "SIMULATION ONLY: the dummy 999 protocol ran, but SMTP is not configured so no email was sent. No call was placed.";
          } else {
            await sendDemoSms();
            outcome = "TEST_MODE: dummy 999 email sent to the test inbox. No call was placed.";
            notice = "SIMULATION ONLY: the dummy 999 protocol ran. A clearly labeled test email was sent. No call was placed.";
          }
        } else {
          // TEST_MODE=false would call the real NG999 / SaveME 999 integration. That is only a
          // mock for now: nothing is sent and nothing is dialed.
          console.warn("TEST_MODE is false, but the NG999 integration is a mock. Nothing was sent.");
          outcome = "NG999 integration is a mock; nothing was sent and no call was placed.";
          notice = "SIMULATION ONLY: the NG999 integration is a mock. Nothing was sent and no call was placed.";
        }
      } catch (error) {
        console.error("Dummy 999 email failed:", error.name || "UnknownError");
        if (!finalAttempt) throw error; // let the engine retry
        outcome = "Dummy 999 email could not be sent. No call was placed.";
        notice = "SIMULATION ONLY: the dummy 999 email could not be sent. No call was placed.";
      }

      await updateIncident(event.alertId, { outcome });
      await removeButtons(messageIds.get(event.alertId));
      await say(notice);
      return outcome;
    },
    { runIf: ["Pending", "Timeout"] }
  );

  // Parent pressed "Call 999": the demo SMS goes out 60 seconds later unless cancelled.
  escalation.register(
    "demo_sms",
    async ({ event, finalAttempt }) => {
      let outcome;
      let notice;
      try {
        if (!sendDemoSms) {
          outcome = "DEMO SMS was not sent; no call was placed.";
          notice = "SIMULATION ONLY: the 60-second delay ended. The DEMO SMS is not configured; no call was placed.";
        } else {
          await sendDemoSms();
          outcome = "DEMO SMS sent through the configured email-to-SMS gateway; no call was placed.";
          notice = "SIMULATION ONLY: the 60-second delay ended. The clearly labeled DEMO SMS was sent; no call was placed.";
        }
      } catch (error) {
        console.error("Could not send demo SMS:", error.name || "UnknownError");
        if (!finalAttempt) throw error;
        outcome = "DEMO SMS was not sent; no call was placed.";
        notice = "SIMULATION ONLY: the 60-second delay ended. The DEMO SMS could not be sent; no call was placed.";
      }

      await updateIncident(event.alertId, { outcome });
      await removeButtons(messageIds.get(event.alertId));
      await say(notice);
      return outcome;
    },
    { runIf: ["Call 999"] }
  );

  // ---- Button presses ---------------------------------------------------------------

  async function handleAction(alertId, action, message) {
    if (action === "call_999") {
      const moved = await incidentLog.transition(alertId, ["Pending", "Timeout"], {
        parentResponse: "Call 999",
        outcome: `Call confirmed; simulated call to ${friendPhoneNumber} scheduled in 60 seconds.`
      });
      if (!moved) return "This alert was already handled.";

      await escalation.schedule(alertId, {
        level: 3,
        action: "demo_sms",
        delayMs: ESCALATION_DELAY_MS
      });
      await escalation.cancel(alertId, "parent chose Call 999", {
        actions: ["timeout_notice", "dummy_999"]
      });

      await say(
        `Call 999 request confirmed. DEMO ONLY: a clearly labeled test SMS to ${friendPhoneNumber} is scheduled in 60 seconds if configured. Press False Alarm to cancel; no call will be placed.`
      );
      return "Call 999 confirmed; demo SMS scheduled in 60 seconds.";
    }

    // false_alarm: also allowed after "Call 999", to cancel the scheduled demo SMS.
    const moved = await incidentLog.transition(alertId, ["Pending", "Timeout", "Call 999"], {
      parentResponse: "False Alarm",
      outcome: "Alert marked as a false alarm; no call was placed."
    });
    if (!moved) return "This alert was already handled.";

    await escalation.cancel(alertId, "parent marked false alarm");
    await removeButtons(message?.message_id ?? messageIds.get(alertId));
    await say("This alert was marked as a false alarm. No call was made.");
    return "Marked as false alarm; pending escalation cancelled.";
  }

  return { sendAlert, handleAction };
}

module.exports = { createTelegramService, ESCALATION_DELAY_MS };