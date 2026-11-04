export async function sendAlert(className, confidence, test = false, location = {}) {
  let response;
  try {
    response = await fetch("/api/alerts", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        className,
        confidence,
        test,
        // null for both is the "no location" signal the backend expects
        locationLat: location.locationLat ?? null,
        locationLng: location.locationLng ?? null
      })
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection.");
  }

  if (response.status === 401) {
    window.location.replace("/login.html");
    throw new Error("Your session has expired. Please sign in again.");
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || "The alert could not be sent.");
  }
  return data; // { ok: true, alertId }
}