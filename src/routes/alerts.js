const express = require("express");

function isMissing(value) {
  return value === undefined || value === null;
}

function validateAlert(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object." };
  }

  const className = typeof body.className === "string" ? body.className.trim() : "";
  if (!className || className.length > 80) {
    return { error: "className must contain between 1 and 80 characters." };
  }
  if (typeof body.confidence !== "number"
    || !Number.isFinite(body.confidence)
    || body.confidence < 0
    || body.confidence > 1) {
    return { error: "confidence must be a number between 0 and 1." };
  }
  if (body.test !== undefined && typeof body.test !== "boolean") {
    return { error: "test must be a boolean when provided." };
  }

  // Location is optional (the user may deny permission), but it is all or nothing.
  // null is accepted as "not available" so the frontend can send it as-is.
  let locationLat = null;
  let locationLng = null;
  const hasLat = !isMissing(body.locationLat);
  const hasLng = !isMissing(body.locationLng);
  if (hasLat !== hasLng) {
    return { error: "locationLat and locationLng must be provided together." };
  }
  if (hasLat && hasLng) {
    if (typeof body.locationLat !== "number"
      || !Number.isFinite(body.locationLat)
      || body.locationLat < -90
      || body.locationLat > 90) {
      return { error: "locationLat must be a number between -90 and 90." };
    }
    if (typeof body.locationLng !== "number"
      || !Number.isFinite(body.locationLng)
      || body.locationLng < -180
      || body.locationLng > 180) {
      return { error: "locationLng must be a number between -180 and 180." };
    }
    locationLat = body.locationLat;
    locationLng = body.locationLng;
  }

  return {
    value: {
      className,
      confidence: body.confidence,
      test: body.test === true,
      locationLat,
      locationLng
    }
  };
}

function createAlertRouter(sendAlert) {
  const router = express.Router();

  router.post("/", async (req, res) => {
    const validation = validateAlert(req.body);
    if (validation.error) {
      res.status(400).json({ error: validation.error });
      return;
    }

    try {
      // userId comes only from the verified JWT (set by requireAuth), never from the body.
      const alertId = await sendAlert({ ...validation.value, userId: req.user.id });
      res.status(202).json({ ok: true, alertId });
    } catch (error) {
      console.error("Telegram alert delivery failed:", error.name || "UnknownError");
      res.status(502).json({ error: "Telegram could not deliver the alert." });
    }
  });

  return router;
}

module.exports = { createAlertRouter, validateAlert };