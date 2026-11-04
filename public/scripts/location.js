const FRESH_MS = 120_000;        // a position younger than this is used as-is
const REFRESH_EVERY_MS = 60_000; // keeps the cache warm while detection runs
const ALERT_TIMEOUT_MS = 4_000;  // worst-case wait at alert time

let lastKnown = null; // { lat, lng, at }
let refreshTimer;

function isSupported() {
  return "geolocation" in navigator && window.isSecureContext;
}

// Resolves with { position } or { error }. Never rejects, never hangs.
function requestPosition({ maximumAge, timeout }) {
  return new Promise(resolve => {
    if (!isSupported()) {
      resolve({ error: "unsupported" });
      return;
    }

    let settled = false;
    let guard;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      resolve(result);
    };
    guard = setTimeout(() => finish({ error: "timeout" }), timeout + 500);

    navigator.geolocation.getCurrentPosition(
      position => {
        lastKnown = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          at: Date.now()
        };
        finish({ position: lastKnown });
      },
      error => {
        finish({
          error: error.code === error.PERMISSION_DENIED ? "denied"
            : error.code === error.TIMEOUT ? "timeout"
            : "unavailable"
        });
      },
      { enableHighAccuracy: false, maximumAge, timeout }
    );
  });
}

export function describeLocationProblem(reason) {
  switch (reason) {
    case "denied": return "location permission was denied";
    case "unsupported": return "location needs HTTPS or localhost";
    case "timeout": return "the location request timed out";
    default: return "location is unavailable";
  }
}

// Called when detection starts. Asks for permission once, then refreshes quietly so that
// an alert never has to wait for a GPS fix.
export async function primeLocation() {
  stopLocationRefresh();
  const result = await requestPosition({ maximumAge: FRESH_MS, timeout: 10_000 });
  if (result.position) {
    refreshTimer = window.setInterval(() => {
      void requestPosition({ maximumAge: 0, timeout: 10_000 });
    }, REFRESH_EVERY_MS);
    return { ok: true };
  }
  return { ok: false, reason: result.error };
}

export function stopLocationRefresh() {
  window.clearInterval(refreshTimer);
  refreshTimer = undefined;
}

// Always resolves. Coordinates are null if there is no usable location, which the backend accepts.
export async function getAlertLocation() {
  const result = await requestPosition({ maximumAge: FRESH_MS, timeout: ALERT_TIMEOUT_MS });
  if (result.position) {
    return { locationLat: result.position.lat, locationLng: result.position.lng, reason: null };
  }
  // A slightly old position beats none, but never after the user denied permission.
  if (lastKnown && result.error !== "denied") {
    return { locationLat: lastKnown.lat, locationLng: lastKnown.lng, reason: null };
  }
  return { locationLat: null, locationLng: null, reason: result.error };
}