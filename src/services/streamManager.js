const { spawn } = require("node:child_process");
const ffmpegPath = require("ffmpeg-static");

const BOUNDARY = "emenoxr";
const FPS = 5;                       // plenty for movement classification
const WIDTH = 640;                   // height is derived; the model resizes to 224px anyway
const JPEG_QUALITY = 5;              // ffmpeg scale: 2 (best) to 31 (worst)
const CONNECT_TIMEOUT_MS = 15_000;
const KILL_GRACE_MS = 2_000;
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
const MAX_STREAMS_PER_USER = 2;
const MAX_STREAMS_TOTAL = 6;

class StreamError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "StreamError";
    this.code = code;
    this.status = status;
  }
}

// ffmpeg only needs a PATH (and a few Windows variables). Passing the full
// environment would hand it DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, etc.
function minimalEnv() {
  const env = {};
  for (const key of ["PATH", "SystemRoot", "TEMP", "TMP"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function createStreamManager({ cameras }) {
  if (!cameras?.getStreamUrl || !cameras?.setStatus) {
    throw new TypeError("A camera store is required to create the stream manager.");
  }
  if (!ffmpegPath) {
    throw new Error(
      "ffmpeg-static has no binary for this platform. Re-run npm install and allow its install script."
    );
  }

  // One ffmpeg process per viewer connection. It's simple and correct: every viewer
  // starts at a clean frame boundary, and closing the tab kills its process.
  const sessions = new Set();

  function viewersOf(userId, cameraId) {
    let count = 0;
    for (const s of sessions) {
      if (s.established && s.userId === userId && s.cameraId === cameraId) count += 1;
    }
    return count;
  }

  function markStatus(userId, cameraId, status) {
    cameras.setStatus(userId, cameraId, status).catch(() => {});
  }

  async function attach(userId, cameraId, res) {
    const perUser = [...sessions].filter(s => s.userId === userId).length;
    if (sessions.size >= MAX_STREAMS_TOTAL || perUser >= MAX_STREAMS_PER_USER) {
      throw new StreamError("TOO_MANY_STREAMS", "Too many active camera streams. Close one and try again.", 429);
    }

    // Reserve the slot immediately, before any await, so parallel requests can't bypass the limits.
    const session = {
      userId,
      cameraId,
      proc: null,
      established: false,
      closed: false,
      reject: null,
      connectTimer: null,
      killTimer: null
    };
    sessions.add(session);

    function release(error) {
      if (session.closed) return;
      session.closed = true;
      sessions.delete(session);
      clearTimeout(session.connectTimer);

      if (!session.established && session.reject) {
        session.reject(error || new StreamError("CLOSED", "The stream was closed.", 410));
      }

      const { proc } = session;
      if (proc && proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGTERM");
        session.killTimer = setTimeout(() => proc.kill("SIGKILL"), KILL_GRACE_MS);
        session.killTimer.unref?.();
      }

      if (session.established && viewersOf(userId, cameraId) === 0) {
        markStatus(userId, cameraId, "offline");
      }
      if (!res.writableEnded && !res.destroyed) res.end();
    }
    session.release = release;

    res.on("close", () => release());
    res.on("error", () => release());

    return new Promise((resolve, reject) => {
      session.reject = reject;

      (async () => {
        let url;
        try {
          url = await cameras.getStreamUrl(userId, cameraId);
        } catch (error) {
          console.error("Could not read camera stream address:", error.name || "UnknownError");
          release(new StreamError("STREAM_UNAVAILABLE", "This camera stream is unavailable.", 502));
          return;
        }
        if (session.closed) return; // the viewer left during the lookup
        if (!url) {
          release(new StreamError("NOT_FOUND", "Camera not found.", 404));
          return;
        }

        // Arguments go in an array with no shell, so the URL can't be interpreted as a command.
        // The URL always follows -i, and only rtsp(s):// URLs are ever stored.
        const args = [
          "-nostdin", "-hide_banner", "-loglevel", "error",
          "-rtsp_transport", "tcp",
          "-i", url,
          "-an",
          "-vf", `fps=${FPS},scale=${WIDTH}:-2`,
          "-q:v", String(JPEG_QUALITY),
          "-f", "mpjpeg", "-boundary_tag", BOUNDARY,
          "pipe:1"
        ];

        const proc = spawn(ffmpegPath, args, {
          stdio: ["ignore", "pipe", "pipe"],
          env: minimalEnv(),
          windowsHide: true
        });
        session.proc = proc;

        // Drain stderr but never log it: ffmpeg error lines can contain the stream URL and credentials.
        proc.stderr.resume();

        session.connectTimer = setTimeout(() => {
          release(new StreamError("TIMEOUT", "The camera did not respond in time.", 504));
        }, CONNECT_TIMEOUT_MS);

        proc.on("error", error => {
          console.error("ffmpeg could not start:", error.code || error.name || "UnknownError");
          release(new StreamError("STREAM_UNAVAILABLE", "The video converter could not start.", 502));
        });

        proc.on("close", () => {
          clearTimeout(session.killTimer);
          release(new StreamError("CONNECT_FAILED", "Could not connect to the camera.", 502));
        });

        proc.stdout.on("data", chunk => {
          if (session.closed) return;

          if (!session.established) {
            session.established = true;
            clearTimeout(session.connectTimer);
            res.writeHead(200, {
              "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
              "Cache-Control": "no-store, no-cache, must-revalidate",
              Pragma: "no-cache",
              Connection: "close",
              "X-Accel-Buffering": "no"
            });
            markStatus(userId, cameraId, "online");
            resolve();
          }

          // A slow viewer would make memory grow without limit. Dropping single chunks
          // would corrupt the MJPEG stream, so disconnect the viewer instead.
          if (res.writableLength > MAX_BUFFERED_BYTES) {
            release();
            return;
          }
          res.write(chunk);
        });
      })();
    });
  }

  // Called when a camera is deleted so its live streams stop immediately.
  function stopCamera(userId, cameraId) {
    for (const s of [...sessions]) {
      if (s.userId === userId && s.cameraId === cameraId) s.release();
    }
  }

  // Called on shutdown. Long-lived stream connections would otherwise keep server.close() waiting forever.
  function stopAll() {
    for (const s of [...sessions]) s.release();
  }

  return { attach, stopCamera, stopAll };
}

module.exports = { createStreamManager, StreamError };