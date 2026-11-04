const MAX_CAMERAS_PER_USER = 10;
const ALLOWED_PROTOCOLS = ["rtsp:", "rtsps:"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Note: rtsp_url_enc is deliberately NOT in this list. Only a boolean leaves the database.
const PUBLIC_COLUMNS = `
  id,
  name,
  source_type AS "sourceType",
  status,
  is_active AS "isActive",
  (rtsp_url_enc IS NOT NULL) AS "hasStream",
  created_at AS "createdAt"
`;

class CameraError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "CameraError";
    this.code = code;
    this.status = status;
  }
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function assertUserId(userId) {
  if (!isUuid(userId)) {
    throw new TypeError("A valid owning userId is required.");
  }
}

function assertRtspUrl(rtspUrl) {
  let parsed;
  try {
    parsed = new URL(rtspUrl);
  } catch {
    throw new CameraError("INVALID_URL", "The stream address is not a valid URL.", 400);
  }
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol) || !parsed.hostname) {
    throw new CameraError("INVALID_URL", "The stream address must start with rtsp:// or rtsps://.", 400);
  }
}

function createCameraStore(pool, cryptoService) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A PostgreSQL pool is required to create the camera store.");
  }
  if (!cryptoService?.encrypt || !cryptoService?.decrypt) {
    throw new TypeError("A crypto service is required to create the camera store.");
  }

  // Every query below includes `user_id = $n`. A camera id alone never selects a row.

  async function create(userId, { name, sourceType = "rtsp", rtspUrl }) {
    assertUserId(userId);

    let encrypted = null;
    if (sourceType === "rtsp") {
      assertRtspUrl(rtspUrl);
      encrypted = cryptoService.encrypt(rtspUrl, userId); // bound to this user
    } else if (sourceType !== "webcam") {
      throw new CameraError("INVALID_SOURCE", "Unsupported camera type.", 400);
    }

    // The limit check and insert are one statement, so it can't be skipped by a
    // separate SELECT going stale.
    const result = await pool.query(
      `INSERT INTO public.cameras (user_id, name, source_type, rtsp_url_enc)
       SELECT $1::uuid, $2::text, $3::text, $4::text
       WHERE (SELECT count(*) FROM public.cameras WHERE user_id = $1::uuid) < $5
       RETURNING ${PUBLIC_COLUMNS}`,
      [userId, name, sourceType, encrypted, MAX_CAMERAS_PER_USER]
    );
    if (result.rows.length === 0) {
      throw new CameraError(
        "CAMERA_LIMIT",
        `You can add up to ${MAX_CAMERAS_PER_USER} cameras.`,
        409
      );
    }
    return result.rows[0];
  }

  async function list(userId) {
    assertUserId(userId);
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS}
       FROM public.cameras
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );
    return result.rows;
  }

  // Returns true if a row was deleted. False means "not found OR not yours";
  // callers should answer 404 in both cases.
  async function remove(userId, cameraId) {
    assertUserId(userId);
    if (!isUuid(cameraId)) return false;
    const result = await pool.query(
      `DELETE FROM public.cameras WHERE id = $1 AND user_id = $2`,
      [cameraId, userId]
    );
    return result.rowCount > 0;
  }

  async function setStatus(userId, cameraId, status) {
    assertUserId(userId);
    if (!isUuid(cameraId)) return null;
    if (!["online", "offline", "error"].includes(status)) {
      throw new TypeError("Unsupported camera status.");
    }
    const result = await pool.query(
      `UPDATE public.cameras SET status = $3
       WHERE id = $1 AND user_id = $2
       RETURNING ${PUBLIC_COLUMNS}`,
      [cameraId, userId, status]
    );
    return result.rows[0] || null;
  }

  // SERVER-INTERNAL ONLY, for streamManager to hand to ffmpeg.
  // Never call this from a route handler that returns its result to the client.
  async function getStreamUrl(userId, cameraId) {
    assertUserId(userId);
    if (!isUuid(cameraId)) return null;
    const result = await pool.query(
      `SELECT rtsp_url_enc AS "rtspUrlEnc"
       FROM public.cameras
       WHERE id = $1 AND user_id = $2 AND is_active = true AND source_type = 'rtsp'`,
      [cameraId, userId]
    );
    const row = result.rows[0];
    if (!row?.rtspUrlEnc) return null;
    return cryptoService.decrypt(row.rtspUrlEnc, userId);
  }

  return { create, list, remove, setStatus, getStreamUrl };
}

module.exports = { createCameraStore, CameraError, isUuid };