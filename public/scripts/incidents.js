const INCIDENTS_ENDPOINT = "/api/incidents";

const listEl = document.getElementById("incident-list");
const stateEl = document.getElementById("incident-state");
const statusEl = document.getElementById("incident-status");
const refreshBtn = document.getElementById("refresh-incidents-button");

let inFlight = false;
let incidentsListener = () => {};

function showState(kind, title, text) {
  const box = document.createElement("div");
  box.className = "state-box";
  box.dataset.kind = kind;

  const heading = document.createElement("h3");
  heading.textContent = title;
  const description = document.createElement("p");
  description.textContent = text;
  box.append(heading, description);
  stateEl.replaceChildren(box);
}

function formatTime(value) {
  if (!value) return "Not sent";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function renderRows(incidents) {
  const rows = incidents.map(incident => {
    const row = document.createElement("tr");
    const values = [
      formatTime(incident.detectionTime),
      formatTime(incident.alertTime),
      incident.parentResponse || "—",
      incident.outcome || "—"
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }

    return row;
  });
  listEl.replaceChildren(...rows);
}

export function setIncidentsListener(listener) {
  incidentsListener = typeof listener === "function" ? listener : () => {};
}

export async function loadIncidents({ silent = false } = {}) {
  if (inFlight) return;
  inFlight = true;
  if (refreshBtn) refreshBtn.disabled = true;
  stateEl.replaceChildren();

  if (!silent) {
    statusEl.hidden = false;
    statusEl.textContent = "Loading incident history…";
  }

  try {
    const response = await fetch(INCIDENTS_ENDPOINT, {
      headers: { Accept: "application/json" }
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Incident history endpoint did not return JSON.");
    }
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || `Incident history request failed (${response.status}).`);
    }

    const incidents = body.incidents;
    if (!Array.isArray(incidents)) {
      throw new Error("Incident history response has an invalid format.");
    }

    renderRows(incidents);
    statusEl.hidden = incidents.length > 0;
    statusEl.textContent = incidents.length
      ? ""
      : "No incidents recorded yet.";
    if (incidents.length === 0) {
      showState(
        "empty",
        "No incidents recorded yet",
        "Your monitoring history will appear here when detection events are recorded."
      );
    }
    incidentsListener(incidents);
  } catch (error) {
    console.error("Incident history error:", error);
    listEl.replaceChildren();
    statusEl.hidden = true;
    showState(
      "error",
      "Unable to load incident history",
      "Incident records are temporarily unavailable. Check your connection and try again."
    );
  } finally {
    inFlight = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}
