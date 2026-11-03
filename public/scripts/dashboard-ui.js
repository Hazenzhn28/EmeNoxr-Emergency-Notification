// Presentation-only layer. It never classifies, simulates or fabricates results:
// it only reads state that app.js already writes to the DOM.
const $ = (id) => document.getElementById(id);

const els = {
  video: $("camera"),
  container: $("camera-container"),
  stop: $("stop-button"),
  prediction: $("prediction"),
  countdown: $("escalation-countdown"),
  alertClass: $("alert-class"),
  slider: $("confidence-threshold"),
  modelError: $("model-error"),
};

function setBadge(el, text, tone) {
  el.textContent = text;
  if (tone) el.dataset.tone = tone; else delete el.dataset.tone;
}

function updateSliderFill() {
  const { min, max, value } = els.slider;
  els.slider.style.setProperty("--fill", `${((value - min) / (max - min)) * 100}%`);
}

// "Seizure: 92%" / "Seizure 0.92" -> { label, pct }
function parsePrediction(text) {
  const m = text.match(/([A-Za-z][\w\s-]*?)\s*[:\-–]?\s*(\d+(?:\.\d+)?)\s*(%)?/);
  if (!m) return null;
  let pct = parseFloat(m[2]);
  if (!m[3] && pct <= 1) pct *= 100;
  return { label: m[1].trim(), pct };
}

let lastAlertAt = null;

function render() {
  const streaming = !!els.video.srcObject;
  const monitoring = !els.stop.disabled;
  const pred = parsePrediction(els.prediction.textContent);
  const aboveThreshold = pred
    && pred.label.toLowerCase() === els.alertClass.value.trim().toLowerCase()
    && pred.pct >= Number(els.slider.value);
  const escalating = !els.countdown.hidden;
  const alert = monitoring && (aboveThreshold || escalating) || escalating;
  const hasError = !els.modelError.hidden && els.modelError.textContent.trim() !== "";

  const state = alert ? "alert" : monitoring ? "monitoring" : "idle";
  if (els.container.dataset.state !== state) {
    els.container.dataset.state = state;
    if (state === "alert") lastAlertAt = new Date();
  }

  const labels = { idle: "Camera standby", monitoring: "Live monitoring", alert: "Seizure detected" };
  const tones = { idle: null, monitoring: "teal", alert: "amber" };
  setBadge($("camera-state-badge"), labels[state], tones[state]);
  setBadge($("monitor-badge"), { idle: "Idle", monitoring: "Monitoring", alert: "Alert" }[state], tones[state]);
  $("overlay-live").textContent = state === "idle" ? "Standby" : "Live";
  $("overlay-connection").textContent = streaming ? "Camera connected" : "Disconnected";
  setBadge($("header-camera-badge"), streaming ? "Camera: connected" : "Camera: off", streaming ? "teal" : null);
  setBadge($("header-system-badge"),
    hasError ? "System: model error" : { idle: "System: idle", monitoring: "System: monitoring", alert: "System: alert" }[state],
    hasError ? "red" : tones[state]);

  $("stat-class").textContent = pred ? pred.label : "—";
  $("stat-confidence").textContent = pred ? `${Math.round(pred.pct)}%` : "—";
  $("stat-last").textContent = lastAlertAt ? lastAlertAt.toLocaleTimeString() : "—";
  $("overlay-detection").textContent = pred
    ? `${state === "alert" ? "SEIZURE DETECTED · " : ""}${pred.label} ${Math.round(pred.pct)}%`
    : state === "alert" ? "SEIZURE DETECTED" : "No detection";
  $("overlay-resolution").textContent = els.video.videoWidth ? `${els.video.videoWidth}×${els.video.videoHeight}` : "";
  $("camera-placeholder").hidden = streaming;
}

const observer = new MutationObserver(render);
observer.observe(els.prediction, { childList: true, characterData: true, subtree: true });
observer.observe(els.countdown, { attributes: true, childList: true, characterData: true, subtree: true });
observer.observe(els.stop, { attributes: true, attributeFilter: ["disabled"] });
observer.observe(els.modelError, { attributes: true, childList: true, characterData: true, subtree: true });
["loadedmetadata", "playing", "emptied", "ended"].forEach((e) => els.video.addEventListener(e, render));
els.slider.addEventListener("input", () => { updateSliderFill(); render(); });
els.alertClass.addEventListener("input", render);

updateSliderFill();
render();