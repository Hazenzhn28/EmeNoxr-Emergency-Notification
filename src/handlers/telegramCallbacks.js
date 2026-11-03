function parseCallbackData(data) {
  if (typeof data !== "string") return null;
  const match = /^alert:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(call_999|false_alarm)$/i.exec(data);
  if (!match) return null;
  return { alertId: match[1], action: match[2] };
}

function createTelegramCallbackHandler(bot, chatId, handleAction) {
  async function answer(queryId, options) {
    try {
      await bot.answerCallbackQuery(queryId, options);
    } catch (error) {
      console.error("Could not acknowledge Telegram button action:", error.name || "UnknownError");
    }
  }

  return async query => {
    const callback = parseCallbackData(query.data);
    if (!callback) {
      await answer(query.id, { text: "Invalid alert action." });
      return;
    }

    const message = query.message;
    if (!message?.chat || String(message.chat.id) !== String(chatId)) {
      await answer(query.id, { text: "This action is not authorized." });
      return;
    }

    try {
      const response = await handleAction(callback.alertId, callback.action, message);
      await answer(query.id, { text: response });
    } catch (error) {
      console.error("Could not process Telegram alert action:", error.name || "UnknownError");
      await answer(query.id, {
        text: "The action could not be completed. Please check the alert."
      });
    }
  };
}

module.exports = { createTelegramCallbackHandler, parseCallbackData };
