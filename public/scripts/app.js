import { startCamera, stopCamera } from "./camera.js";
import { classify, loadModel } from "./classifier.js";
import { sendAlert } from "./alerts.js";

const video = document.querySelector("#camera");
const placeholder = document.querySelector("#camera-placeholder");
const status = document.querySelector("#status");
const predictionLabel = document.querySelector("#prediction");
const startButton = document.querySelector("#start-button");
const stopButton = document.querySelector("#stop-button");
const testButton = document.querySelector("#test-alert-button");
const classInput = document.querySelector("#alert-class");
const thresholdInput = document.querySelector("#confidence-threshold");
const thresholdValue = document.querySelector("#threshold-value");

let model;
let running = false;
let detectionLatched = false;
let stream;

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
          await sendAlert(prediction.className, confidence);
          status.textContent = "Alert sent. Check the configured Telegram chat.";
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
    status.textContent = error.message;
  }
});

stopButton.addEventListener("click", () => {
  void stopDetection();
});

testButton.addEventListener("click", async () => {
  if (!window.confirm("Send a clearly marked test message to Telegram?")) {
    return;
  }

  testButton.disabled = true;
  status.textContent = "Sending test message…";
  try {
    await sendAlert(classInput.value.trim() || "Test", 1, true);
    status.textContent = "Test alert sent. Check the configured Telegram chat.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    testButton.disabled = false;
  }
});

window.addEventListener("pagehide", () => {
  if (stream) {
    stopCamera(video);
  }
});
