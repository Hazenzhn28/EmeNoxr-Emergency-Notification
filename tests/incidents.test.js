const test = require("node:test");
const assert = require("node:assert/strict");
const { createIncidentLog } = require("../src/services/incidents");

test("creates and uses the PostgreSQL incident table with parameterized queries", async () => {
  const queries = [];
  const incident = {
    alertId: "alert-1",
    detectionTime: new Date("2026-11-03T10:00:00.000Z"),
    alertTime: null,
    parentResponse: "Pending",
    outcome: "Alert delivery in progress."
  };
  const pool = {
    async query(text, values) {
      queries.push({ text, values });
      if (text.includes("INSERT INTO")) return { rows: [incident] };
      if (text.includes("UPDATE public.incidents")) {
        return { rows: [{ ...incident, ...Object.fromEntries(
          text.includes("parent_response = $2") ? [["parentResponse", values[1]]] : []
        ) }] };
      }
      if (text.includes("SELECT")) return { rows: [incident] };
      return { rows: [] };
    }
  };
  const log = createIncidentLog(pool);

  await log.initialize();
  assert.match(queries[0].text, /CREATE TABLE IF NOT EXISTS public\.incidents/);

  const savedIncident = await log.recordDetection("alert-1", incident.detectionTime);
  assert.equal(savedIncident.alertId, "alert-1");
  assert.deepEqual(queries[1].values, [
    "alert-1",
    incident.detectionTime,
    "Alert delivery in progress."
  ]);
  assert.match(queries[1].text, /VALUES \(\$1, \$2, \$3\)/);

  await log.update("alert-1", { parentResponse: "False Alarm" });
  assert.deepEqual(queries[2].values, ["alert-1", "False Alarm"]);
  assert.match(queries[2].text, /parent_response = \$2/);

  assert.deepEqual(await log.list(), [incident]);
  assert.match(queries[3].text, /ORDER BY detection_time DESC/);
});

test("rejects unsupported incident update fields", async () => {
  const log = createIncidentLog({ query: async () => ({ rows: [] }) });
  await assert.rejects(log.update("alert-1", { alertId: "changed" }), /supported field/);
});
