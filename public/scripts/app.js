import { startCamera, stopCamera } from "./camera.js";
import { classify, loadModel } from "./classifier.js";
import { sendAlert } from "./alerts.js";
import { loadIncidents, setIncidentsListener } from "./incidents.js";

const video = document.querySelector("#camera");
const placeholder = document.querySelector("#camera-placeholder");
const status = document.querySelector("#status");
const predictionLabel = document.querySelector("#prediction");
const startButton = document.querySelector("#start-button");
const stopButton = document.querySelector("#stop-button");
const testButton = document.querySelector("#test-alert-button");
const simulateDetectionButton = document.querySelector("#simulate-detection-button");
const modelError = document.querySelector("#model-error");
const classInput = document.querySelector("#alert-class");
const thresholdInput = document.querySelector("#confidence-threshold");
const thresholdValue = document.querySelector("#threshold-value");
const escalationCountdown = document.querySelector("#escalation-countdown");

let model;
let running = false;
let detectionLatched = false;
let stream;
let countdownInterval;
let activeCountdownAlertId;

function stopCountdown(message) {
  window.clearInterval(countdownInterval);
  countdownInterval = undefined;
  activeCountdownAlertId = undefined;
  escalationCountdown.textContent = message;
  escalationCountdown.setAttribute("aria-live", "polite");
}

function startEscalationCountdown(alertId) {
  window.clearInterval(countdownInterval);
  activeCountdownAlertId = alertId;
  escalationCountdown.hidden = false;
  escalationCountdown.setAttribute("aria-live", "off");
  const deadline = Date.now() + 60_000;

  function updateCountdown() {
    const secondsRemaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (secondsRemaining === 0) {
      stopCountdown("Simulated 999 Escalation Triggered");
      return;
    }
    escalationCountdown.textContent =
      `Simulated 999 escalation in ${secondsRemaining} second${secondsRemaining === 1 ? "" : "s"}.`;
  }

  updateCountdown();
  countdownInterval = window.setInterval(updateCountdown, 250);
}

// Stop the simulated countdown once the parent has responded.
setIncidentsListener(incidents => {
  if (!activeCountdownAlertId) return;
  const activeIncident = incidents.find(incident => incident.alertId === activeCountdownAlertId);
  if (activeIncident && activeIncident.parentResponse !== "Pending") {
    stopCountdown(activeIncident.parentResponse === "Timeout"
      ? "Simulated 999 Escalation Triggered"
      : `Simulated countdown stopped: ${activeIncident.parentResponse} response received.`);
  }
});

// Single alert path used by BOTH real camera detection and the simulate button.
async function triggerAlert(className, confidence, test = false) {
  const result = await sendAlert(className, confidence, test);
  status.textContent = test
    ? "Test alert sent. Check the configured Telegram chat."
    : "Alert sent. Check the configured Telegram chat.";
  if (!test && className.trim().toLowerCase() === "seizure") {
    startEscalationCountdown(result.alertId);
  }
  void loadIncidents({ silent: true });
}

thresholdInput.addEventListener("input", () => {
  thresholdValue.value = `${thresholdInput.value}%`;
});

async function runDetection() {
  while (running) {
    try {
      const prediction = await classify(model, video);
      if (!running) return;
      const confidence = prediction.probability;
      const threshold = Number(thresholdInput.value) / 100;
      const targetClass = classInput.value.trim().toLowerCase();
      const matches = prediction.className.toLowerCase() === targetClass
        && confidence >= threshold;

      predictionLabel.textContent =
        `${prediction.className}: ${(confidence * 100).toFixed(1)}%`;

      if (matches && !detectionLatched) {
        detectionLatched = true;
        status.textContent = "Matching class detected. Sending Telegram alert…";
        try {
          await triggerAlert(prediction.className, confidence);
        } catch (error) {
          detectionLatched = false;
          status.textContent = error.message;
        }
      } else if (!matches) {
        detectionLatched = false;
      }
    } catch (error) {
      await stopDetection();
      status.textContent = `Detection stopped: ${error.message}`;
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

async function stopDetection() {
  running = false;
  startButton.disabled = false;
  stopButton.disabled = true;
  if (stream) {
    stopCamera(video);
    stream = undefined;
    placeholder.hidden = false;
  }
  status.textContent = "Detection stopped.";
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  status.textContent = "Loading model and camera…";
  try {
    model ??= await loadModel();
    modelError.hidden = true;
    simulateDetectionButton.hidden = true;
    stream = await startCamera(video);
    placeholder.hidden = true;
    running = true;
    detectionLatched = false;
    stopButton.disabled = false;
    status.textContent = "Detection is running.";
    void runDetection();
  } catch (error) {
    if (stream) {
      stopCamera(video);
      stream = undefined;
    }
    startButton.disabled = false;
    if (!model) {
      modelError.textContent =
        "We couldn't load the Teachable Machine model. Check that its files are in public/model/. You can still test the alert flow with simulated detection.";
      modelError.hidden = false;
      simulateDetectionButton.hidden = false;
      status.textContent = "Camera detection is unavailable; simulated detection is ready.";
    } else {
      status.textContent = error.message;
    }
  }
});

stopButton.addEventListener("click", () => {
  void stopDetection();
});

simulateDetectionButton.addEventListener("click", async () => {
  simulateDetectionButton.disabled = true;
  status.textContent = "Sending simulated Seizure alert…";
  try {
    await triggerAlert("Seizure", 1); // same path as real detection
  } catch (error) {
    status.textContent = error.message;
  } finally {
    simulateDetectionButton.disabled = false;
  }
});

testButton.addEventListener("click", async () => {
  if (!window.confirm("Send a clearly marked test message to Telegram?")) {
    return;
  }

  testButton.disabled = true;
  status.textContent = "Sending test message…";
  try {
    await triggerAlert(classInput.value.trim() || "Test", 1, true);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    testButton.disabled = false;
  }
});

void loadIncidents();
window.setInterval(() => {
  void loadIncidents({ silent: true });
}, 5000);

window.addEventListener("pagehide", () => {
  window.clearInterval(countdownInterval);
  if (stream) {
    stopCamera(video);
  }
});