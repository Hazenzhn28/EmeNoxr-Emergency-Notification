const express = require("express");
const { z } = require("zod");
const { CameraError, isUuid } = require("../services/cameras");
const { StreamError } = require("../services/streamManager");
const { validateBody } = require("../middleware/validate");

const createCameraSchema = z
  .object({
    name: z.string().trim().min(1, "Give the camera a name.").max(80, "Camera name is too long."),
    sourceType: z.enum(["rtsp", "webcam"]).default("rtsp"),
    rtspUrl: z.string().trim().max(2048, "Stream address is too long.").optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.sourceType === "rtsp" && !value.rtspUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rtspUrl"],
        message: "Enter the RTSP stream address."
      });
    }
    if (value.sourceType === "webcam" && value.rtspUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rtspUrl"],
        message: "A webcam does not have a stream address."
      });
    }
  });

const asyncHandler = handler => (req, res, next) => handler(req, res, next).catch(next);

// The router is mounted behind requireAuth in server.js, so req.user.id always exists here.
function createCameraRouter({ cameras, streamManager }) {
  const router = express.Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json({ cameras: await cameras.list(req.user.id) });
    })
  );

  router.post(
    "/",
    validateBody(createCameraSchema),
    asyncHandler(async (req, res) => {
      try {
        const camera = await cameras.create(req.user.id, req.body);
        res.status(201).json({ camera });
      } catch (error) {
        if (error instanceof CameraError) {
          res.status(error.status).json({ error: error.message });
          return;
        }
        throw error;
      }
    })
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      // Not found and not yours are deliberately indistinguishable.
      const removed = isUuid(req.params.id) && (await cameras.remove(req.user.id, req.params.id));
      if (!removed) {
        res.status(404).json({ error: "Camera not found." });
        return;
      }
      streamManager.stopCamera(req.user.id, req.params.id);
      res.status(204).end();
    })
  );

  // Live MJPEG feed. Usable directly as <img src="/api/cameras/<id>/stream">.
  router.get(
    "/:id/stream",
    asyncHandler(async (req, res) => {
      if (!isUuid(req.params.id)) {
        res.status(404).json({ error: "Camera not found." });
        return;
      }
      try {
        await streamManager.attach(req.user.id, req.params.id, res);
      } catch (error) {
        // The viewer left, or the stream already started: there's nothing to send.
        if (res.headersSent || res.destroyed || res.socket?.destroyed) return;
        if (error instanceof StreamError || error instanceof CameraError) {
          res.status(error.status).json({ error: error.message });
          return;
        }
        throw error;
      }
    })
  );

  return router;
}

module.exports = { createCameraRouter };