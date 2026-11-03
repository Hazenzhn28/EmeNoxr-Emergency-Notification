const test = require("node:test");
const assert = require("node:assert/strict");
const { createTelegramService } = require("../src/services/telegram");

function createTestIncidentLog() {
  const incidents = [];
  return {
    async recordDetection(alertId, detectionTime) {
      const incident = {
        alertId,
        detectionTime,
        alertTime: null,
        parentResponse: "Pending",
        outcome: "Alert delivery in progress."
      };
      incidents.push(incident);
      return incident;
    },
    async update(alertId, updates) {
      const incident = incidents.find(item => item.alertId === alertId);
      if (!incident) return null;
      Object.assign(incident, updates);
      return incident;
    },
    async list() {
      return incidents.slice().reverse();
    }
  };
}

test("schedules a simulated call 60 seconds after Call 999 is confirmed", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sentMessages = [];
  const incidentLog = createTestIncidentLog();
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
  const [incident] = await incidentLog.list();
  assert.equal(incident.alertId, alertId);
  assert.ok(incident.detectionTime);
  assert.ok(incident.alertTime);
  assert.equal(incident.parentResponse, "Pending");

  await service.handleAction(alertId, "call_999", {
    chat: { id: "12345" },
    message_id: 1
  });
  assert.match(sentMessages[1].text, /request confirmed/i);
  assert.match(sentMessages[1].text, /scheduled in 60 seconds/i);
  assert.equal(service.alerts.get(alertId).status, "call_scheduled");
  assert.equal(incident.parentResponse, "Call 999");
  assert.match(incident.outcome, /scheduled in 60 seconds/i);

  t.mock.timers.tick(59_999);
  assert.equal(sentMessages.length, 2);
  t.mock.timers.tick(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(sentMessages[2].text, /SIMULATION ONLY/i);
  assert.match(sentMessages[2].text, /no call was made/i);
  assert.equal(service.alerts.get(alertId).status, "simulated_call");
  assert.match(incident.outcome, /no call was placed/i);
});

test("False Alarm cancels the 60-second no-response escalation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sentMessages = [];
  const bot = {
    async sendMessage(chatId, text) {
      sentMessages.push(text);
      return { message_id: sentMessages.length };
    },
    async editMessageReplyMarkup() {
      return true;
    }
  };
  const service = createTelegramService(bot, "12345", "+60 10 914 0397", createTestIncidentLog());
  const alertId = await service.sendAlert({ className: "Seizure", confidence: 1 });

  await service.handleAction(alertId, "false_alarm", {
    chat: { id: "12345" },
    message_id: 1
  });
  t.mock.timers.tick(60_000);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(service.alerts.get(alertId).status, "false_alarm");
  assert.equal(sentMessages.length, 2);
  assert.match(sentMessages[1], /false alarm/i);
});

test("False Alarm cancels a scheduled simulated call", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sentMessages = [];
  const bot = {
    async sendMessage(chatId, text) {
      sentMessages.push(text);
      return { message_id: sentMessages.length };
    },
    async editMessageReplyMarkup() {
      return true;
    }
  };
  const service = createTelegramService(bot, "12345", "+60 10 914 0397", createTestIncidentLog());
  const alertId = await service.sendAlert({ className: "Seizure", confidence: 1 });
  const message = { chat: { id: "12345" }, message_id: 1 };

  await service.handleAction(alertId, "call_999", message);
  const response = await service.handleAction(alertId, "false_alarm", message);
  t.mock.timers.tick(60_000);
  await new Promise(resolve => setImmediate(resolve));

  assert.match(response, /timer cancelled/i);
  assert.equal(service.alerts.get(alertId).status, "false_alarm");
  assert.equal(sentMessages.length, 3);
  assert.doesNotMatch(sentMessages.join("\n"), /SIMULATION ONLY: the 60-second delay ended/);
});

test("sends a simulated escalation if no button is clicked within 60 seconds", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sentMessages = [];
  const incidentLog = createTestIncidentLog();
  const bot = {
    async sendMessage(chatId, text) {
      sentMessages.push(text);
      return { message_id: sentMessages.length };
    },
    async editMessageReplyMarkup() {
      return true;
    }
  };
  const service = createTelegramService(bot, "12345", "+60 10 914 0397", incidentLog);
  const alertId = await service.sendAlert({ className: "Seizure", confidence: 1 });

  t.mock.timers.tick(60_000);
  await new Promise(resolve => setImmediate(resolve));

  assert.match(sentMessages[1], /No response was received within 60 seconds/);
  assert.match(sentMessages[1], /SIMULATED ESCALATION ONLY/);
  assert.equal((await incidentLog.list())[0].parentResponse, "Timeout");
  assert.equal(service.alerts.get(alertId).status, "escalated");
});

test("records failed Telegram delivery as the incident outcome", async () => {
  const incidentLog = createTestIncidentLog();
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
  const [incident] = await incidentLog.list();
  assert.equal(incident.alertTime, null);
  assert.equal(incident.outcome, "Telegram alert delivery failed.");
});
