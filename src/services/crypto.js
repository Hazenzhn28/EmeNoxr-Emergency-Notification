const crypto = require("node:crypto");
const { encryptionKey } = require("../config/env");

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;   // the recommended nonce size for GCM
const TAG_BYTES = 16;

if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) {
  throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes.");
}

// Output format: v1:<iv>:<authTag>:<ciphertext>, each part base64url.
// The version prefix lets us rotate keys or change the format later.
//
// `aad` (additional authenticated data) is not encrypted but is bound to the
// ciphertext: decryption fails unless the same value is supplied. We pass the
// owning user's id, so a ciphertext copied into another user's row won't decrypt.
function encrypt(plaintext, aad = "") {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new TypeError("encrypt requires a non-empty string.");
  }
  const iv = crypto.randomBytes(IV_BYTES); // fresh random IV for every message
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(String(aad), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(":");
}

// Throws on a wrong key, wrong aad, tampering, or a malformed value.
function decrypt(payload, aad = "") {
  if (typeof payload !== "string") {
    throw new TypeError("decrypt requires a string.");
  }
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Unsupported or malformed encrypted value.");
  }
  const [, ivPart, tagPart, dataPart] = parts;
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Unsupported or malformed encrypted value.");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(String(aad), "utf8"));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final()
  ]);
  return plaintext.toString("utf8");
}

module.exports = { encrypt, decrypt };