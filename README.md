# EmeNoxr — Emergency Notification System

EmeNoxr is a full-stack capstone prototype for exploring how computer-vision monitoring, camera streaming, and multi-channel notifications can work together to support caregivers of children with epilepsy. It combines browser-based Teachable Machine detection with optional RTSP/CCTV streams, authenticated user accounts, incident history, location sharing, and a database-backed escalation workflow.

> 🔴 **Safety warning:** EmeNoxr is a simulation/prototype, not a medical device or emergency response service. It does **not** call 999 or contact real emergency services. The “dummy 999” flow is simulated; if explicitly configured, it may send a clearly labeled demo email or email-to-SMS message to a test recipient.

## Key Features

- **Authentication and account isolation:** Email/password registration and login, Argon2id password hashing, JWT-based sessions, and user-scoped camera and incident data.
- **Webcam AI detection:** Run a Teachable Machine image classifier in the browser with TensorFlow.js; the alert class and confidence threshold are configurable in the dashboard.
- **RTSP/CCTV monitoring:** Save RTSP/RTSPS sources and view their converted live stream in the dashboard. FFmpeg is provided by the `ffmpeg-static` package.
- **Tiered, persistent escalation:**
  1. **Level 1 — Telegram:** Send an alert to the configured Telegram chat with response buttons.
  2. **Level 2 — Timeout notice:** If no response is received within 60 seconds, record the timeout and send a notice.
  3. **Level 3 — Dummy 999:** After a further 60 seconds without a response, record the simulated final step. In `TEST_MODE`, an optional, clearly labeled demo email can be sent to the configured test inbox. No call is placed.
- **Caregiver response controls:** Mark an alert as a false alarm or select the demo call action. The optional email-to-SMS demo action is delayed and can be canceled during the delay.
- **GPS location sharing:** With browser permission, include coordinates in the alert and a Google Maps link in Telegram. Location is optional and is omitted when unavailable or denied.
- **Incident history:** Store detections, response state, outcomes, location, and escalation status in PostgreSQL.

## Tech Stack

- **Server:** Node.js 18+, Express
- **Database:** PostgreSQL, with Supabase supported as the hosted database
- **Authentication and validation:** JWT, Argon2id, Zod
- **AI and camera processing:** Teachable Machine, TensorFlow.js, FFmpeg (`ffmpeg-static`)
- **Notifications:** Telegram Bot API, Nodemailer (optional demo email / email-to-SMS gateway)
- **Client:** HTML, CSS, and JavaScript

## Prerequisites

- Node.js 18 or newer and npm
- A Supabase project (or another PostgreSQL database)
- A Telegram bot token from [@BotFather](https://t.me/BotFather), plus the numeric chat ID that should receive alerts
- A Teachable Machine **Image Project** exported for TensorFlow.js
- FFmpeg support: the project uses `ffmpeg-static` and normally installs a platform-specific binary with npm; no separate system installation is needed when that package supports your platform
- Optional: SMTP credentials and a consenting test recipient for the demo email/email-to-SMS step

## Installation & Setup

1. Clone the repository and install dependencies:

   ```sh
   git clone https://github.com/Hazenzhn28/EmeNoxr-Emergency-Notification.git
   cd EmeNoxr-Emergency-Notification
   npm install
   ```

2. Create a private environment file:

   ```sh
   cp .env.example .env
   ```

   On PowerShell, use `Copy-Item .env.example .env`. Set the required values in `.env`:

   ```dotenv
   NODE_ENV=development
   PORT=3000

   DATABASE_URL=postgresql://postgres:YOUR_URL_ENCODED_PASSWORD@YOUR_DB_HOST:5432/postgres
   DATABASE_SSL_CA=

   JWT_SECRET=REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
   JWT_EXPIRES_IN=15m
   COOKIE_SECURE=
   ENCRYPTION_KEY=REPLACE_WITH_64_HEX_CHARACTERS

   TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN
   TELEGRAM_CHAT_ID=YOUR_NUMERIC_CHAT_ID
   TELEGRAM_FRIEND_PHONE_NUMBER=+15551234567

   TEST_MODE=true

   # Optional demo email / email-to-SMS configuration. Configure all six or none.
   SMTP_HOST=
   SMTP_PORT=
   SMTP_USER=
   SMTP_PASS=
   SMTP_FROM=
   DEMO_SMS_TO=
   ```

   Generate independent secrets with Node.js, then put one 64-character hex value in `JWT_SECRET` and a different one in `ENCRYPTION_KEY`:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   `JWT_SECRET` must be at least 32 characters. `ENCRYPTION_KEY` must be exactly 64 hexadecimal characters (32 bytes). `TELEGRAM_CHAT_ID` must be numeric, and `TELEGRAM_FRIEND_PHONE_NUMBER` is displayed as the demo target. Obtain the PostgreSQL connection URI from your Supabase project’s database settings; URL-encode reserved characters in the database password. If your database requires a custom CA certificate, set `DATABASE_SSL_CA` to its local file path. The app verifies database TLS certificates. Telegram and demo-message destinations are global environment settings shared by all accounts; tenant isolation applies to stored user, camera, and incident data, not separate per-user notification destinations.

3. Apply the database schema migration before starting the server. In the Supabase Dashboard, open **SQL Editor**, paste the contents of [`src/db/migrations/001_initial_schema.sql`](src/db/migrations/001_initial_schema.sql), and run it against the project connected by `DATABASE_URL`. The migration creates the users, cameras, incidents, and escalation-event tables and their supporting indexes. For a PostgreSQL installation with `psql`, you can instead run:

   ```sh
   psql "$DATABASE_URL" -f src/db/migrations/001_initial_schema.sql
   ```

   The application checks connectivity at startup; it does not automatically apply migrations.

4. Configure Telegram. Create a bot with [@BotFather](https://t.me/BotFather), set `TELEGRAM_BOT_TOKEN`, and set `TELEGRAM_CHAT_ID` to the intended chat. Add the bot to a group if you want alerts sent there. The app uses Telegram long polling for response buttons, so do not configure a webhook for the same bot at the same time.

5. Export your Teachable Machine **Image Project** using the TensorFlow.js export option. Place `model.json`, `metadata.json`, and every referenced weight file in `public/model/`. These project-specific assets are intentionally excluded from Git; see [`public/model/README.md`](public/model/README.md). Class names in the dashboard must match the model’s exported labels.

6. (Optional) Enable demo email/email-to-SMS by filling in **all** SMTP values and `DEMO_SMS_TO`. For example, with Gmail use an App Password rather than your regular account password. `TEST_MODE=true` is the safe default: the optional message is a test message, not an emergency notification. If SMTP is omitted, the escalation is still recorded, but no email or SMS is sent. Setting `TEST_MODE=false` does not enable a real emergency integration; the current NG999 integration remains a mock and sends nothing.

## Deployment on Render

Create a **Web Service** for this repository on Render, use `npm install` as the build command and `npm start` as the start command, then add the app's configuration under **Environment**. Set the required variables from `.env.example`, including:

- `NODE_ENV=production` so production behavior is enabled, especially secure session cookies when Render serves the app over HTTPS.
- `DATABASE_URL` to the PostgreSQL connection URI for your hosted database.
- `JWT_SECRET` and `ENCRYPTION_KEY` to separate, securely generated secrets. Keep `JWT_SECRET` at least 32 characters and `ENCRYPTION_KEY` exactly 64 hexadecimal characters.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `TELEGRAM_FRIEND_PHONE_NUMBER`.
- `TEST_MODE=true` unless you specifically intend to disable the demo-only behavior.

Do not set a fixed `PORT` in Render; leave that variable blank/unset so Render can provide the port at runtime. The app reads Render's injected `PORT` automatically.

If your database requires a custom CA certificate, set `DATABASE_SSL_CA` to the **raw certificate text**, including the `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----` lines. Do not set it to a certificate file path on Render. For local development, it can still be set to a path to a PEM file. Leave it blank if your database does not require a custom CA. Optional SMTP variables should only be set when configuring the demo email feature, following the all-or-nothing setup described above.

## How to Run the App

Start the server:

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000), create an account, and sign in. Grant camera and (if desired) location permissions, configure the model’s alert class and confidence threshold, then start detection. For RTSP monitoring, add a camera from its RTSP/RTSPS URL and open its stream in the dashboard. The browser camera and geolocation APIs require a secure context; `localhost` is supported for local development.

To run the test suite:

```sh
npm test
```

## Security & Privacy Note

- RTSP/RTSPS URLs are encrypted at rest using AES-256-GCM. Keep `ENCRYPTION_KEY` private and backed up securely; changing it without re-encrypting stored camera addresses will make them unreadable.
- Authentication uses Argon2id password hashes and signed JWTs in HTTP-only cookies. Set `NODE_ENV=production` when deploying behind HTTPS so secure-cookie behavior is enabled.
- User identity is derived from the verified session, and camera and incident queries are scoped to that user. Do not expose the database, environment file, or secrets in client-side code or logs.
- GPS coordinates are requested from the browser only with permission and may be included in Telegram alerts and incident history. Denying permission leaves location out of the alert.
- `.env` contains credentials and must never be committed. Only use test recipients who have agreed to receive demo messages.

EmeNoxr is intended for academic demonstration and evaluation. It has not been clinically validated and must not be relied upon to detect seizures or summon help.
