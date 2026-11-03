export async function sendAlert(className, confidence, test = false) {
  const response = await fetch("/api/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ className, confidence, test })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || "The alert could not be sent.");
  }
  return result;
}
