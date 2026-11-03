const test = require("node:test");
const assert = require("node:assert/strict");
const { createDemoSmsSender, DEMO_SMS_TEXT } = require("../src/services/demoSms");

test("sends a visibly labeled demo message using configured SMTP gateway settings", async () => {
  let transportOptions;
  let mailOptions;
  const expectedResult = { messageId: "demo-message" };
  const sendDemoSms = createDemoSmsSender({
    host: "smtp.example.test",
    port: 465,
    user: "demo@example.test",
    password: "app-password",
    from: "demo@example.test",
    to: "recipient@gateway.example.test"
  }, options => {
    transportOptions = options;
    return {
      async sendMail(options) {
        mailOptions = options;
        return expectedResult;
      }
    };
  });

  const result = await sendDemoSms();

  assert.equal(transportOptions.secure, true);
  assert.equal(transportOptions.auth.user, "demo@example.test");
  assert.equal(mailOptions.to, "recipient@gateway.example.test");
  assert.equal(mailOptions.subject, "[DEMO] EmeNoxr simulated 999 escalation");
  assert.match(mailOptions.text, /^DEMO\/TEST ONLY:/);
  assert.equal(mailOptions.text, DEMO_SMS_TEXT);
  assert.equal(result, expectedResult);
});
