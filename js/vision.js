/**
 * Browser computer vision via MediaPipe Tasks.
 * Face, pose (human), and object detectors — all run locally in WASM.
 */

import { MEDIAPIPE } from "./config.js";
import { detectGeometry } from "./geometry.js";

export class VisionEngine {
  constructor() {
    this.ready = { face: false, pose: false, object: false };
    this.faceDetector = null;
    this.poseLandmarker = null;
    this.objectDetector = null;
    this.fileset = null;
    this.lastVideoTime = -1;
    this.lastMediaTime = -1;
    this._objectLoading = null;
  }

  async init(onProgress = () => {}) {
    const visionMod = await import(MEDIAPIPE.visionBundle);
    this.mp = visionMod;
    onProgress(0.22, "LOADING VISION RUNTIME");

    this.fileset = await visionMod.FilesetResolver.forVisionTasks(MEDIAPIPE.wasm);
    onProgress(0.4, "RESOLVING MODELS");

    const results = await Promise.allSettled([this.#loadFace(), this.#loadPose()]);
    results.forEach((r) => {
      if (r.status === "rejected") console.warn("Model load failed", r.reason);
    });
    if (!this.ready.face && !this.ready.pose) {
      console.warn("MediaPipe detectors unavailable — geometry mode still works.");
    }
    onProgress(0.82, "CALIBRATING TRACKERS");
  }

  async #withDelegate(factory) {
    try {
      return await factory("GPU");
    } catch {
      return factory("CPU");
    }
  }

  async #loadFace() {
    this.faceDetector = await this.#withDelegate((delegate) =>
      this.mp.FaceDetector.createFromOptions(this.fileset, {
        baseOptions: { modelAssetPath: MEDIAPIPE.faceModel, delegate },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.45,
      })
    );
    this.ready.face = true;
  }

  async #loadPose() {
    this.poseLandmarker = await this.#withDelegate((delegate) =>
      this.mp.PoseLandmarker.createFromOptions(this.fileset, {
        baseOptions: { modelAssetPath: MEDIAPIPE.poseModel, delegate },
        runningMode: "VIDEO",
        numPoses: 2,
        minPoseDetectionConfidence: 0.4,
        minPosePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      })
    );
    this.ready.pose = true;
  }

  async ensureObjectDetector() {
    if (this.objectDetector) return;
    if (this._objectLoading) return this._objectLoading;
    this._objectLoading = (async () => {
      try {
        this.objectDetector = await this.#withDelegate((delegate) =>
          this.mp.ObjectDetector.createFromOptions(this.fileset, {
            baseOptions: { modelAssetPath: MEDIAPIPE.objectModel, delegate },
            runningMode: "VIDEO",
            scoreThreshold: 0.35,
            maxResults: 5,
          })
        );
        this.ready.object = true;
      } catch (err) {
        console.warn("Object detector unavailable", err);
      }
    })();
    return this._objectLoading;
  }

  /**
   * Run the active mode against the current video frame.
   * Returns detections in video-pixel space.
   */
  detect(video, mode, timestampMs) {
    if (!video.videoWidth) return [];
    // Skip duplicate camera frames; MediaPipe still needs a rising timestamp.
    if (video.currentTime === this.lastMediaTime) return null;
    this.lastMediaTime = video.currentTime;
    const t = timestampMs;

    try {
      if (mode === "face" && this.faceDetector) {
        const res = this.faceDetector.detectForVideo(video, t);
        return this.#fromFaces(res, video);
      }
      if (mode === "human" && this.poseLandmarker) {
        const res = this.poseLandmarker.detectForVideo(video, t);
        return this.#fromPose(res, video);
      }
      if (mode === "object") {
        return this.#fromObjects(video, t);
      }
    } catch (err) {
      // GPU delegate can throw on a single frame; skip it.
      console.warn("detect frame skipped", err);
    }
    return [];
  }

  #fromFaces(res, video) {
    const dets = res?.detections || [];
    return dets.map((d) => {
      const bb = d.boundingBox;
      const score = d.categories?.[0]?.score ?? 0.7;
      return {
        type: "FACE",
        label: "HUMAN FACE",
        x: bb.originX,
        y: bb.originY,
        w: bb.width,
        h: bb.height,
        confidence: score,
        angle: 0,
        keypoints: (d.keypoints || []).map((k) => ({
          x: k.x * video.videoWidth,
          y: k.y * video.videoHeight,
        })),
        source: "face",
      };
    });
  }

  #fromPose(res, video) {
    const poses = res?.landmarks || [];
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    return poses.map((lm) => {
      const pts = lm.map((p) => ({
        x: p.x * vw,
        y: p.y * vh,
        v: p.visibility ?? 1,
      }));
      const visible = pts.filter((p) => p.v > 0.35);
      if (visible.length < 4) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of visible) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      const padX = (maxX - minX) * 0.12;
      const padY = (maxY - minY) * 0.12;
      const lShoulder = pts[11];
      const rShoulder = pts[12];
      let angle = 0;
      if (lShoulder && rShoulder) {
        angle = (Math.atan2(rShoulder.y - lShoulder.y, rShoulder.x - lShoulder.x) * 180) / Math.PI;
      }
      const avgV = visible.reduce((s, p) => s + p.v, 0) / visible.length;
      return {
        type: "HUMAN",
        label: "HUMAN",
        x: minX - padX,
        y: minY - padY,
        w: maxX - minX + padX * 2,
        h: maxY - minY + padY * 2,
        confidence: avgV,
        angle,
        hasAngle: true,
        keypoints: pts,
        source: "pose",
      };
    }).filter(Boolean);
  }

  #fromObjects(video, t) {
    const geo = detectGeometry(video);
    let coco = [];
    if (this.objectDetector) {
      try {
        const res = this.objectDetector.detectForVideo(video, t);
        coco = (res?.detections || []).map((d) => {
          const bb = d.boundingBox;
          const cat = d.categories?.[0];
          return {
            type: "OBJECT",
            label: (cat?.categoryName || "OBJECT").toUpperCase(),
            x: bb.originX,
            y: bb.originY,
            w: bb.width,
            h: bb.height,
            confidence: cat?.score ?? 0.5,
            angle: 0,
            keypoints: [],
            source: "coco",
          };
        });
      } catch {
        /* skip frame */
      }
    }
    // Prefer named COCO hits; keep geometry if it doesn't heavily overlap.
    const merged = [...coco];
    for (const g of geo) {
      const overlaps = merged.some((o) => iou(o, g) > 0.45);
      if (!overlaps) merged.push(g);
    }
    return merged.slice(0, 5);
  }
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}
