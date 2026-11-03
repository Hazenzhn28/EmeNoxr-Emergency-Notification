# EmeNoxr Emergency Notification

A browser-based Teachable Machine image classifier that can notify a configured Telegram chat when a selected class is detected.

> **Safety notice:** This project is a prototype, not a medical device or a substitute for emergency services. The “Call 999” button and the 60-second escalation are simulations only. This application never places a phone call or contacts emergency services.

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
   `TELEGRAM_CHAT_ID`, and `TELEGRAM_FRIEND_PHONE_NUMBER`. The friend number
   only appears in the simulated Telegram action; the app never calls it.
   Keep `.env` private; never commit your bot token or the phone number.

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
- Incident history is kept in server memory and is cleared when the server
  restarts. The Incident History panel refreshes automatically and can also be
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
