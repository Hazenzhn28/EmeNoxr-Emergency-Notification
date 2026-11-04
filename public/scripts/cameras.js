const video = document.querySelector("#camera");
const rtspView = document.querySelector("#rtsp-view");
const placeholder = document.querySelector("#camera-placeholder");
const overlayConnection = document.querySelector("#overlay-connection");
const detectionStatus = document.querySelector("#status");
const stopDetectionButton = document.querySelector("#stop-button");

const sourceBadge = document.querySelector("#source-badge");
const select = document.querySelector("#camera-select");
const useRtspButton = document.querySelector("#use-rtsp-button");
const useWebcamButton = document.querySelector("#use-webcam-button");
const sourceStatus = document.querySelector("#source-status");

const form = document.querySelector("#add-camera-form");
const nameInput = document.querySelector("#camera-name");
const urlInput = document.querySelector("#camera-url");
const toggleUrlButton = document.querySelector("#toggle-url-button");
const formError = document.querySelector("#camera-form-error");
const addButton = document.querySelector("#add-camera-button");
const cameraList = document.querySelector("#camera-list");

// A 1x1 transparent GIF. Pointing the <img> at it makes the browser drop the open
// stream connection, which in turn makes the server stop that ffmpeg process.
const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

let cameras = [];
let mode = "webcam"; // "webcam" | "rtsp"
let activeCameraId = null;

/* ---------- API helper ---------- */

function messageFrom(data) {
  if (Array.isArray(data?.details) && data.details.length > 0) {
    return data.details.map(detail => detail.message).join(" ");
  }
  return data?.error || "Something went wrong. Please try again.";
}

async function api(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection.");
  }

  if (response.status === 401) {
    window.location.replace("/login.html");
    throw new Error("Not signed in.");
  }

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(messageFrom(data));
  return data;
}

const streamUrl = id => `/api/cameras/${encodeURIComponent(id)}/stream`;

/* ---------- Rendering ---------- */

function setMessage(text) {
  sourceStatus.textContent = text;
}

function usableCameras() {
  return cameras.filter(c => c.sourceType === "rtsp" && c.hasStream && c.isActive);
}

function updateButtons() {
  const hasChoice = Boolean(select.value);
  useRtspButton.disabled = !hasChoice || (mode === "rtsp" && select.value === activeCameraId);
  useWebcamButton.disabled = mode === "webcam";
}

function renderSelect(preferredId) {
  const usable = usableCameras();
  const keep = preferredId ?? select.value;

  select.replaceChildren();
  if (usable.length === 0) {
    select.append(new Option("No cameras saved yet", ""));
    select.disabled = true;
  } else {
    for (const camera of usable) {
      select.append(new Option(camera.name, camera.id)); // Option sets text safely
    }
    select.disabled = false;
    select.value = usable.some(c => c.id === keep) ? keep : usable[0].id;
  }
  updateButtons();
}

const STATUS_TONE = { online: "teal", error: "red", offline: "" };

function renderList() {
  cameraList.replaceChildren();
  if (cameras.length === 0) {
    const empty = document.createElement("li");
    empty.className = "camera-empty";
    empty.textContent = "No cameras yet. Add one above.";
    cameraList.append(empty);
    return;
  }

  for (const camera of cameras) {
    const item = document.createElement("li");
    item.className = "camera-item";

    const label = document.createElement("span");
    label.className = "camera-name";
    label.textContent = camera.name;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = camera.status;
    if (STATUS_TONE[camera.status]) badge.dataset.tone = STATUS_TONE[camera.status];

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary small";
    remove.dataset.deleteId = camera.id;
    remove.dataset.deleteName = camera.name;
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete camera ${camera.name}`);

    item.append(label, badge, remove);
    cameraList.append(item);
  }
}

async function loadCameras(preferredId) {
  const data = await api("/api/cameras");
  cameras = data.cameras;
  renderSelect(preferredId);
  renderList();
}

/* ---------- Switching sources ---------- */

function showWebcam() {
  mode = "webcam";
  activeCameraId = null;
  rtspView.src = BLANK_IMAGE; // drops the stream connection
  rtspView.hidden = true;
  video.hidden = false;
  placeholder.hidden = Boolean(video.srcObject);
  overlayConnection.textContent = video.srcObject ? "Connected" : "Disconnected";
  sourceBadge.textContent = "Source: Webcam";
  delete sourceBadge.dataset.tone;
  updateButtons();
}

function showRtsp(camera) {
  // The webcam classifier must not keep running underneath a different video source.
  if (!stopDetectionButton.disabled) stopDetectionButton.click();

  mode = "rtsp";
  activeCameraId = camera.id;
  video.hidden = true;
  placeholder.hidden = true; // stopping detection above shows it again, so hide it after
  rtspView.hidden = false;
  overlayConnection.textContent = "Connecting…";
  sourceBadge.textContent = `Source: ${camera.name}`;
  sourceBadge.dataset.tone = "teal";
  // The query string forces a fresh request when re-selecting the same camera.
  rtspView.src = `${streamUrl(camera.id)}?t=${Date.now()}`;
  setMessage(`Connecting to ${camera.name}…`);
  updateButtons();
}

// The <img> error event carries no detail, so ask the server why it was refused.
async function explainStreamFailure(id) {
  const controller = new AbortController();
  try {
    const response = await fetch(streamUrl(id), {
      credentials: "same-origin",
      signal: controller.signal
    });
    if (response.ok) {
      controller.abort(); // it works now; we only needed the headers
      return "The stream stopped unexpectedly. Try switching again.";
    }
    const data = await response.json().catch(() => null);
    return data?.error || "Could not connect to the camera.";
  } catch {
    return "Could not reach the camera stream.";
  }
}

rtspView.addEventListener("load", () => {
  if (mode !== "rtsp") return;
  overlayConnection.textContent = "RTSP live";
  const camera = cameras.find(c => c.id === activeCameraId);
  setMessage(camera ? `Streaming ${camera.name}.` : "Streaming.");
  void loadCameras().catch(() => {}); // refresh the online/offline badges
});

rtspView.addEventListener("error", async () => {
  if (mode !== "rtsp") return;
  const failedId = activeCameraId;
  showWebcam();
  setMessage("Could not start the stream. Checking why…");
  setMessage(await explainStreamFailure(failedId));
  void loadCameras().catch(() => {});
});

useRtspButton.addEventListener("click", () => {
  const camera = cameras.find(c => c.id === select.value);
  if (camera) showRtsp(camera);
});

useWebcamButton.addEventListener("click", () => {
  showWebcam();
  setMessage("Switched to the webcam.");
});

select.addEventListener("change", updateButtons);

// Detection still runs on the webcam only. Say so instead of silently starting the
// webcam behind an RTSP picture. This runs in the capture phase, before app.js sees the click.
document.addEventListener(
  "click",
  event => {
    if (mode !== "rtsp") return;
    if (!event.target.closest?.("#start-button")) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    detectionStatus.textContent =
      "Detection on RTSP cameras is not enabled yet. Switch to Webcam to run detection.";
  },
  true
);

/* ---------- Add / delete ---------- */

toggleUrlButton.addEventListener("click", () => {
  const show = urlInput.type === "password";
  urlInput.type = show ? "text" : "password";
  toggleUrlButton.textContent = show ? "Hide" : "Show";
  toggleUrlButton.setAttribute("aria-pressed", String(show));
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  formError.textContent = "";

  const name = nameInput.value.trim();
  const rtspUrl = urlInput.value.trim();

  if (!name) {
    formError.textContent = "Give the camera a name.";
    return;
  }
  if (!/^rtsps?:\/\//i.test(rtspUrl)) {
    formError.textContent = "The address must start with rtsp:// or rtsps://.";
    return;
  }

  addButton.disabled = true;
  addButton.textContent = "Adding…";
  try {
    const { camera } = await api("/api/cameras", {
      method: "POST",
      body: JSON.stringify({ name, sourceType: "rtsp", rtspUrl })
    });
    form.reset();
    urlInput.type = "password";
    toggleUrlButton.textContent = "Show";
    toggleUrlButton.setAttribute("aria-pressed", "false");
    await loadCameras(camera.id);
    setMessage(`Added ${camera.name}. Press "Switch to RTSP Stream" to view it.`);
  } catch (error) {
    formError.textContent = error.message;
  } finally {
    addButton.disabled = false;
    addButton.textContent = "Add camera";
  }
});

cameraList.addEventListener("click", async event => {
  const button = event.target.closest("[data-delete-id]");
  if (!button) return;

  const { deleteId, deleteName } = button.dataset;
  if (!window.confirm(`Delete "${deleteName}"? Any live stream from it will stop.`)) return;

  button.disabled = true;
  try {
    await api(`/api/cameras/${encodeURIComponent(deleteId)}`, { method: "DELETE" });
    if (activeCameraId === deleteId) showWebcam();
    setMessage(`Deleted ${deleteName}.`);
  } catch (error) {
    setMessage(error.message);
  }
  try {
    await loadCameras();
  } catch {
    // the list will refresh on the next successful load
  }
});

window.addEventListener("pagehide", () => {
  rtspView.src = BLANK_IMAGE;
});

/* ---------- Start ---------- */

loadCameras().catch(error => {
  setMessage(`Could not load your cameras: ${error.message}`);
});