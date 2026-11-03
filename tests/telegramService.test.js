const test = require("node:test");
const assert = require("node:assert/strict");
const { createTelegramService } = require("../src/services/telegram");

test("keeps the Call 999 label while showing the friend number as a simulated target", async () => {
  const sentMessages = [];
  const bot = {
    async sendMessage(chatId, text, options) {
      sentMessages.push({ chatId, text, options });
      return { message_id: 1 };
    }
  };
  const service = createTelegramService(bot, "12345", "+60 10 914 0397");

  await service.sendAlert({ className: "Test", confidence: 0.9, test: true });

  assert.match(sentMessages[0].text, /Test call target: \+60 10 914 0397/);
  assert.match(sentMessages[0].text, /no call will be placed/i);
  assert.equal(
    sentMessages[0].options.reply_markup.inline_keyboard[0][0].text,
    "Call 999 (simulated)"
  );
});
