const INCIDENT_COLUMNS = `
  alert_id AS "alertId",
  detection_time AS "detectionTime",
  alert_time AS "alertTime",
  parent_response AS "parentResponse",
  outcome,
  camera_id AS "cameraId",
  location_lat AS "locationLat",
  location_lng AS "locationLng",
  escalation_level AS "escalationLevel"
`;

const LIST_LIMIT = 200;

function createIncidentLog(pool) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A PostgreSQL pool is required to create the incident log.");
  }

  // The schema now lives in src/db/migrations, so startup only checks connectivity.
  async function initialize() {
    await pool.query("SELECT 1");
  }

  // userId is mandatory: an incident can't exist without an owner.
  async function recordDetection(
    alertId,
    detectionTime,
    userId,
    { cameraId = null, locationLat = null, locationLng = null } = {}
  ) {
    if (typeof userId !== "string" || userId.length === 0) {
      throw new TypeError("recordDetection requires the owning userId.");
    }

    // The camera is only accepted if it belongs to the same user.
    const result = await pool.query(
      `INSERT INTO public.incidents
         (alert_id, detection_time, outcome, user_id, camera_id, location_lat, location_lng)
       SELECT $1::text, $2::timestamptz, $3::text, $4::uuid, $5::uuid, $6::float8, $7::float8
       WHERE $5::uuid IS NULL
          OR EXISTS (SELECT 1 FROM public.cameras WHERE id = $5::uuid AND user_id = $4::uuid)
       RETURNING ${INCIDENT_COLUMNS}`,
      [alertId, detectionTime, "Alert delivery in progress.", userId, cameraId, locationLat, locationLng]
    );
    if (result.rows.length === 0) {
      throw new Error("Camera not found for this user.");
    }
    return result.rows[0];
  }

  // Pass { userId } whenever a user session is available. The Telegram callback path
  // has no session, so it can call update(alertId, updates) until we map chat -> user.
  async function update(alertId, updates, { userId } = {}) {
    const allowedColumns = {
      alertTime: "alert_time",
      parentResponse: "parent_response",
      outcome: "outcome",
      escalationLevel: "escalation_level"
    };
    const assignments = [];
    const values = [alertId];

    for (const [key, column] of Object.entries(allowedColumns)) {
      if (Object.hasOwn(updates, key)) {
        values.push(updates[key]);
        assignments.push(`${column} = $${values.length}`);
      }
    }

    if (assignments.length === 0) {
      throw new TypeError("Incident update must include a supported field.");
    }

    let scope = "";
    if (userId) {
      values.push(userId);
      scope = ` AND user_id = $${values.length}`;
    }

    const result = await pool.query(
      `UPDATE public.incidents
       SET ${assignments.join(", ")}
       WHERE alert_id = $1${scope}
       RETURNING ${INCIDENT_COLUMNS}`,
      values
    );
    return result.rows[0] || null;
  }

  async function list(userId) {
    if (typeof userId !== "string" || userId.length === 0) {
      throw new TypeError("list requires the owning userId.");
    }
    const result = await pool.query(
      `SELECT ${INCIDENT_COLUMNS}
       FROM public.incidents
       WHERE user_id = $1
       ORDER BY detection_time DESC
       LIMIT ${LIST_LIMIT}`,
      [userId]
    );
    return result.rows;
  }

  return { initialize, recordDetection, update, list };
}

module.exports = { createIncidentLog };