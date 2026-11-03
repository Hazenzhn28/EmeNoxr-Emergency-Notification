const test = require("node:test");
const assert = require("node:assert/strict");
const { createTelegramService } = require("../src/services/telegram");
const { createIncidentLog } = require("../src/services/incidents");

test("keeps the Call 999 label while showing the friend number as a simulated target", async () => {
  const sentMessages = [];
  const incidentLog = createIncidentLog();
  const bot = {
    async sendMessage(chatId, text, options) {
      sentMessages.push({ chatId, text, options });
      return { message_id: 1 };
    },
    async editMessageReplyMarkup() {
      return true;
    }
  };
  const service = createTelegramService(bot, "12345", "+60 10 914 0397", incidentLog);

  const alertId = await service.sendAlert({ className: "Test", confidence: 0.9, test: true });

  assert.match(sentMessages[0].text, /Test call target: \+60 10 914 0397/);
  assert.match(sentMessages[0].text, /no call will be placed/i);
  assert.equal(
    sentMessages[0].options.reply_markup.inline_keyboard[0][0].text,
    "Call 999 (simulated)"
  );
  const [incident] = incidentLog.list();
  assert.equal(incident.alertId, alertId);
  assert.ok(incident.detectionTime);
  assert.ok(incident.alertTime);
  assert.equal(incident.parentResponse, "Pending");

  await service.handleAction(alertId, "call_999", {
    chat: { id: "12345" },
    message_id: 1
  });
  assert.equal(incident.parentResponse, "Call 999");
  assert.match(incident.outcome, /no call was placed/i);
});

test("records failed Telegram delivery as the incident outcome", async () => {
  const incidentLog = createIncidentLog();
  const bot = {
    async sendMessage() {
      throw new Error("Telegram unavailable");
    }
  };
  const service = createTelegramService(bot, "12345", "+60 10 914 0397", incidentLog);

  await assert.rejects(
    service.sendAlert({ className: "Test", confidence: 0.9 }),
    /Telegram unavailable/
  );
  const [incident] = incidentLog.list();
  assert.equal(incident.alertTime, null);
  assert.equal(incident.outcome, "Telegram alert delivery failed.");
});
