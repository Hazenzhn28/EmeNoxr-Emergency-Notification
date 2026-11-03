const INCIDENT_COLUMNS = `
  alert_id AS "alertId",
  detection_time AS "detectionTime",
  alert_time AS "alertTime",
  parent_response AS "parentResponse",
  outcome
`;

function createIncidentLog(pool) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A PostgreSQL pool is required to create the incident log.");
  }

  async function initialize() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.incidents (
        alert_id TEXT PRIMARY KEY,
        detection_time TIMESTAMPTZ NOT NULL,
        alert_time TIMESTAMPTZ,
        parent_response TEXT NOT NULL DEFAULT 'Pending'
          CHECK (parent_response IN ('Pending', 'Call 999', 'False Alarm', 'Timeout')),
        outcome TEXT NOT NULL
      )
    `);
  }

  async function recordDetection(alertId, detectionTime) {
    const result = await pool.query(
      `INSERT INTO public.incidents (alert_id, detection_time, outcome)
       VALUES ($1, $2, $3)
       RETURNING ${INCIDENT_COLUMNS}`,
      [alertId, detectionTime, "Alert delivery in progress."]
    );
    return result.rows[0];
  }

  async function update(alertId, updates) {
    const allowedColumns = {
      alertTime: "alert_time",
      parentResponse: "parent_response",
      outcome: "outcome"
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

    const result = await pool.query(
      `UPDATE public.incidents
       SET ${assignments.join(", ")}
       WHERE alert_id = $1
       RETURNING ${INCIDENT_COLUMNS}`,
      values
    );
    return result.rows[0] || null;
  }

  async function list() {
    const result = await pool.query(
      `SELECT ${INCIDENT_COLUMNS}
       FROM public.incidents
       ORDER BY detection_time DESC`
    );
    return result.rows;
  }

  return { initialize, recordDetection, update, list };
}

module.exports = { createIncidentLog };
