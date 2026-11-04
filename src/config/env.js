const dotenv = require("dotenv");
const { z } = require("zod");

dotenv.config();

// Treat empty strings in .env (e.g. "SMTP_HOST=") as "not set".
const emptyToUndefined = value =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().trim().optional());
const requiredString = name =>
  z.string({ required_error: `${name} is required.` }).trim().min(1, `${name} is required.`);

const port = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().min(1).max(65535).default(3000)
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: port,

    // Telegram
    TELEGRAM_BOT_TOKEN: requiredString("TELEGRAM_BOT_TOKEN"),
    TELEGRAM_CHAT_ID: z
      .string()
      .trim()
      .regex(/^-?\d+$/, "TELEGRAM_CHAT_ID must be a numeric Telegram chat ID."),
    TELEGRAM_FRIEND_PHONE_NUMBER: z
      .string()
      .trim()
      .refine(
        value => /^\+?\d{6,15}$/.test(value.replace(/[\s()-]/g, "")),
        "TELEGRAM_FRIEND_PHONE_NUMBER must be a valid phone number."
      ),

    // Database
    DATABASE_URL: z
      .string({ required_error: "DATABASE_URL is required." })
      .trim()
      .refine(value => {
        try {
          return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      }, "DATABASE_URL must be a valid postgres:// or postgresql:// URI."),
    DATABASE_SSL_CA: optionalString,

    // Auth
    JWT_SECRET: z
      .string({ required_error: "JWT_SECRET is required." })
      .min(32, "JWT_SECRET must be at least 32 characters."),
    JWT_EXPIRES_IN: z.preprocess(emptyToUndefined, z.string().default("15m")),
    COOKIE_SECURE: z.preprocess(
      emptyToUndefined,
      z.enum(["true", "false"]).optional()
    ),

    // Encryption for camera RTSP URLs (AES-256-GCM): 32 bytes as 64 hex chars
    ENCRYPTION_KEY: z
      .string({ required_error: "ENCRYPTION_KEY is required." })
      .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 64 hex characters (32 bytes)."),

    // Phase 3 switch (dummy 999). Defaults to the safe value.
    TEST_MODE: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).default("true")),

    // Demo SMS via SMTP (all-or-nothing)
    SMTP_HOST: optionalString,
    SMTP_PORT: optionalString,
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SMTP_FROM: optionalString,
    DEMO_SMS_TO: optionalString
  })
  .superRefine((env, ctx) => {
    const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"];
    const configured = smtpKeys.filter(key => env[key]);

    if (configured.length !== 0 && configured.length !== smtpKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Demo SMS requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM together."
      });
      return;
    }
    if (configured.length === smtpKeys.length) {
      if (!env.DEMO_SMS_TO) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["DEMO_SMS_TO"],
          message: "DEMO_SMS_TO is required when SMTP demo SMS is configured."
        });
      }
      const smtpPort = Number(env.SMTP_PORT);
      if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SMTP_PORT"],
          message: "SMTP_PORT must be an integer between 1 and 65535."
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Print variable names and messages only, never the values (they may be secrets).
  const problems = parsed.error.issues
    .map(issue => `  - ${issue.path.join(".") || "(config)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${problems}`);
}

const env = parsed.data;

const isProduction = env.NODE_ENV === "production";

const demoSmsConfig = env.SMTP_HOST
  ? {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT),
      user: env.SMTP_USER,
      password: env.SMTP_PASS,
      from: env.SMTP_FROM,
      to: env.DEMO_SMS_TO
    }
  : null;

module.exports = {
  // Existing exports (same names, so current imports keep working)
  botToken: env.TELEGRAM_BOT_TOKEN,
  chatId: env.TELEGRAM_CHAT_ID,
  friendPhoneNumber: env.TELEGRAM_FRIEND_PHONE_NUMBER,
  databaseUrl: env.DATABASE_URL,
  databaseSslCaPath: env.DATABASE_SSL_CA,
  demoSmsConfig,
  port: env.PORT,

  // New exports
  nodeEnv: env.NODE_ENV,
  isProduction,
  jwtSecret: env.JWT_SECRET,
  jwtExpiresIn: env.JWT_EXPIRES_IN,
  // Secure cookies by default in production; override with COOKIE_SECURE for local HTTPS testing.
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : isProduction,
  encryptionKey: Buffer.from(env.ENCRYPTION_KEY, "hex"),
  testMode: env.TEST_MODE === "true"
};