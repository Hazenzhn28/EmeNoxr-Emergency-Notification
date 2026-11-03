const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCallbackData } = require("../src/handlers/telegramCallbacks");

test("parses supported alert button callback data", () => {
  const alertId = "e78633bc-e415-4c79-8aae-3d4d7c83562f";
  assert.deepEqual(parseCallbackData(`alert:${alertId}:call_999`), {
    alertId,
    action: "call_999"
  });
  assert.deepEqual(parseCallbackData(`alert:${alertId}:false_alarm`), {
    alertId,
    action: "false_alarm"
  });
});

test("rejects malformed or unsupported callback data", () => {
  assert.equal(parseCallbackData("alert:not-a-uuid:call_999"), null);
  assert.equal(parseCallbackData("alert:e78633bc-e415-4c79-8aae-3d4d7c83562f:dial"), null);
  assert.equal(parseCallbackData(undefined), null);
});
