const nodemailer = require("nodemailer");

const DEMO_SMS_TEXT =
  "DEMO/TEST ONLY: EmeNoxr simulated seizure alert. A demo 999 escalation was triggered. No real emergency response or call is in progress.";

function createDemoSmsSender(config, createTransport = nodemailer.createTransport) {
  const transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    debug: true,
    logger: true,
    auth: {
      user: config.user,
      pass: config.password
    }
  });

  return async function sendDemoSms() {
    return transporter.sendMail({
      from: config.from,
      to: config.to,
      subject: "[DEMO] EmeNoxr simulated 999 escalation",
      text: DEMO_SMS_TEXT
    });
  };
}

module.exports = { createDemoSmsSender, DEMO_SMS_TEXT };
