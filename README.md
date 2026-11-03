# EmeNoxr Emergency Notification

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/hazieq-muhaimin-070854336)

A browser-based Teachable Machine image classifier that can notify a configured Telegram chat when a selected class is detected.

> **Safety notice:** This project is a prototype, not a medical device or a substitute for emergency services. The “Call 999” action is a simulation and never places a phone call. If configured, it may send a clearly labeled demo SMS to the consenting recipient after 60 seconds; it does not contact emergency services.

## Requirements

- Node.js 18 or newer
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- The Telegram chat ID that should receive alerts
- A Teachable Machine **Image Project** exported for TensorFlow.js

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and set `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_CHAT_ID`, `TELEGRAM_FRIEND_PHONE_NUMBER`, and `DATABASE_URL`.
   Get a fresh PostgreSQL connection URI from your Supabase project's database
   settings. If the password contains URI-reserved characters (such as `@`),
   percent-encode them in the URI. If Node reports a certificate-chain error,
   download the database CA certificate from Supabase and set
   `DATABASE_SSL_CA` to its local file path; certificate verification remains
   enabled. The app creates its `public.incidents` table on startup. Keep
   `.env` private; never commit your credentials or contact details.

3. Export your Teachable Machine image project using the TensorFlow.js export option.
   Put the exported model files in `public/model/`, so that `model.json`,
   `metadata.json`, and any referenced weight files are present there. See
   [public/model/README.md](public/model/README.md).

4. Start the server:

   ```sh
   npm start
   ```

5. Open <http://localhost:3000>. Allow camera access, enter the exact class name
   you want to alert on, and start detection. Use **Send test Telegram alert**
   to check the bot integration; it sends a clearly marked test message.
   If the Teachable Machine model is unavailable, the page offers **Simulate
   Seizure Detection**, which sends the same Seizure alert through the backend
   without using the camera. The call action remains simulated.
   To enable the optional demo SMS, configure the SMTP variables below.

### Optional demo SMS

The **Call 999 (demo SMS in 60s)** button can send a clearly labeled test
message through an email-to-SMS gateway after 60 seconds. It never places a
phone call or sends a real emergency alert. Only configure this for a recipient
who has agreed to receive the demo, and confirm their carrier supports its
email-to-SMS gateway; gateway domains and availability vary by carrier.

For Gmail SMTP, enable 2-Step Verification and create a Google App Password.
Add these lines to the private `.env` file:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-gmail-address@gmail.com
SMTP_PASS=your-16-character-google-app-password
SMTP_FROM=your-gmail-address@gmail.com
DEMO_SMS_TO=recipient-address-confirmed-by-their-carrier
```

Use the same Gmail address for `SMTP_USER` and `SMTP_FROM`. Do not use your
normal Gmail password or share the App Password. The app expects either all six
SMTP settings or none; if they are omitted, alerts continue in simulation-only
mode and no SMS is sent.

Nodemailer SMTP debug logging (`debug: true`, `logger: true`) is currently
enabled to help troubleshoot delivery. Restart the server and check its
terminal output after triggering a demo. These logs may contain email addresses,
message metadata, or other sensitive details: keep them private and redact them
before sharing. Once SMTP is working, remove these two options from
`src/services/demoSms.js` to reduce routine logging.

The app and API are served from the same origin. The bot uses Telegram long
polling for button callbacks; do not configure a webhook for the same bot at
the same time. Find the numeric chat ID using a trusted method before running
the app; for a group, add the bot to the intended group and use that group's ID.

## Alert behavior

- A matching class at or above the selected confidence threshold sends one
  Telegram alert. The detector must stop matching before it can trigger again.
- The Telegram message includes **Call 999 (simulated)** and **False Alarm**
  buttons, and shows the configured friend number as the test call target.
- Selecting **Call 999 (simulated)** sends a confirmation and schedules a
  simulated call notice 60 seconds later. **False Alarm** remains available
  during that delay and cancels it. No phone call is ever placed.
- Selecting **False Alarm** before responding also cancels the no-response
  timer and marks the alert as dismissed.
- A Seizure alert shows a visible 60-second countdown in the web app. If it
  reaches zero, the app displays “Simulated 999 Escalation Triggered”; this
  does not place a call. A Telegram response stops the countdown.
- If neither button is selected within 60 seconds, the bot sends a simulated
  escalation notice. No call is placed.
- The 60-second alert state is kept in server memory. Restarting the server
  loses pending timers and button state.
- Incident history is stored in the Supabase PostgreSQL `public.incidents`
  table. The Incident History panel refreshes automatically and can also be
  refreshed manually.

Run the unit tests with:

```sh
npm test
```

## Project layout

- `public/` — Browser UI, camera and classifier integration, and model files.
- `src/` — Express server, environment configuration, alert API, and Telegram
  bot/callback handling.
- `tests/` — Unit tests for alert validation and callback data parsing.
