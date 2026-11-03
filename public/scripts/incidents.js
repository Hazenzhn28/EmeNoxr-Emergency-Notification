// Drop-in replacement for the incident-history fetch logic.
// 1) Set INCIDENTS_ENDPOINT to the exact URL app.js currently fetches.
// 2) Delete the old incident fetch/render code and its refresh listener from app.js.
// 3) Add <script type="module" src="/scripts/incidents.js"></script> to index.html.
const INCIDENTS_ENDPOINT = "/api/incidents";

const listEl = document.getElementById("incident-list");
const stateEl = document.getElementById("incident-state");
const statusEl = document.getElementById("incident-status");
const refreshBtn = document.getElementById("refresh-incidents-button");

const ICON_HISTORY = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>';
const ICON_ERROR = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg>';

function showState(kind, title, text, withRetry) {
  stateEl.innerHTML = `<div class="state-box" data-kind="${kind}">${kind === "error" ? ICON_ERROR : ICON_HISTORY}<h3></h3><p></p>${withRetry ? '<button type="button" class="secondary" id="retry-incidents">Retry</button>' : ""}</div>`;
  stateEl.querySelector("h3").textContent = title;
  stateEl.querySelector("p").textContent = text;
  stateEl.querySelector("#retry-incidents")?.addEventListener("click", loadIncidents);
}

const fmt = (v) => {
  if (v == null || v === "") return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
};
// Field names are guesses with fallbacks: align them with your backend's response.
const pick = (o, ...keys) => keys.map((k) => o[k]).find((v) => v != null && v !== "");

function renderRows(incidents) {
  listEl.replaceChildren(...incidents.map((i) => {
    const tr = document.createElement("tr");
    [
      fmt(pick(i, "detectionTime", "detectedAt", "detection_time", "timestamp")),
      fmt(pick(i, "alertTime", "alertSentAt", "alert_time")),
      pick(i, "parentResponse", "parent_response", "response") ?? "—",
      pick(i, "outcome", "status") ?? "—",
    ].forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    });
    return tr;
  }));
}

let inFlight = false;
async function loadIncidents() {
  if (inFlight) return;
  inFlight = true;
  refreshBtn.disabled = true;
  stateEl.replaceChildren();
  listEl.replaceChildren();
  statusEl.hidden = false;
  statusEl.innerHTML = '<span class="spinner" aria-hidden="true"></span>Loading incident history…';

  try {
    const res = await fetch(INCIDENTS_ENDPOINT, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") || "";
    if (!type.includes("application/json")) {
      throw new Error(`Expected JSON from ${INCIDENTS_ENDPOINT} but got "${type}". The route is probably missing or the API server is not running.`);
    }
    const body = await res.json();
    const incidents = Array.isArray(body) ? body : body.incidents;
    if (!Array.isArray(incidents)) throw new Error("Unexpected response shape");

    statusEl.hidden = true;
    if (incidents.length === 0) {
      showState("empty", "No incidents recorded yet", "Your monitoring history will appear here when detection events are recorded.", false);
    } else {
      renderRows(incidents);
    }
  } catch (err) {
    console.error("Incident history error:", err);
    statusEl.hidden = true;
    showState("error", "Unable to load incident history", "Incident records are temporarily unavailable. Please try again.", true);
  } finally {
    inFlight = false;
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", loadIncidents);
loadIncidents();