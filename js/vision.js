/**
 * Hand landmark detection (MediaPipe).
 * Only thumb tip + index tip, and only when that finger is extended.
 */

import { MEDIAPIPE } from "./config.js";

const TIP = { thumb: 4, index: 8 };
const PIP = { thumb: 3, index: 6 };
const MCP = { thumb: 2, index: 5 };

export class VisionEngine {
  constructor() {
    this.ready = { hands: false };
    this.handLandmarker = null;
    this.fileset = null;
    this.mp = null;
    this.lastMediaTime = -1;
  }

  async init(onProgress = () => {}) {
    const visionMod = await import(MEDIAPIPE.visionBundle);
    this.mp = visionMod;
    onProgress(0.25, "LOADING VISION RUNTIME");

    this.fileset = await visionMod.FilesetResolver.forVisionTasks(MEDIAPIPE.wasm);
    onProgress(0.5, "LOADING HAND MODEL");

    this.handLandmarker = await this.#withDelegate((delegate) =>
      this.mp.HandLandmarker.createFromOptions(this.fileset, {
        baseOptions: { modelAssetPath: MEDIAPIPE.handModel, delegate },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
    );
    this.ready.hands = true;
    onProgress(0.9, "CALIBRATING FINGERS");
  }

  async #withDelegate(factory) {
    try {
      return await factory("GPU");
    } catch {
      return factory("CPU");
    }
  }

  /**
   * Returns extended thumb/index tips in video-pixel space.
   * @returns {Array|null} null = same video frame as last call
   */
  detectFingers(video, timestampMs) {
    if (!video.videoWidth || !this.handLandmarker) return [];
    if (video.currentTime === this.lastMediaTime) return null;
    this.lastMediaTime = video.currentTime;

    try {
      const res = this.handLandmarker.detectForVideo(video, timestampMs);
      return this.#fromHands(res, video);
    } catch (err) {
      console.warn("hand frame skipped", err);
      return [];
    }
  }

  #fromHands(res, video) {
    const hands = res?.landmarks || [];
    const handed = res?.handedness || [];
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const out = [];

    for (let i = 0; i < hands.length; i++) {
      const lm = hands[i];
      let side = (handed[i]?.[0]?.categoryName || "Right").toUpperCase();
      if (side !== "LEFT" && side !== "RIGHT") side = "RIGHT";
      const score = handed[i]?.[0]?.score ?? 0.7;

      for (const finger of ["thumb", "index"]) {
        if (!isExtended(lm, finger)) continue;
        const tip = lm[TIP[finger]];
        if (!tip) continue;
        out.push({
          id: `${side}-${finger.toUpperCase()}`,
          hand: side,
          finger: finger.toUpperCase(),
          x: tip.x * vw,
          y: tip.y * vh,
          confidence: score,
        });
      }
    }
    return out;
  }
}

function isExtended(lm, finger) {
  const tip = lm[TIP[finger]];
  const pip = lm[PIP[finger]];
  const mcp = lm[MCP[finger]];
  if (!tip || !pip || !mcp) return false;
  const tipDist = Math.hypot(tip.x - mcp.x, tip.y - mcp.y);
  const pipDist = Math.hypot(pip.x - mcp.x, pip.y - mcp.y);
  if (pipDist < 1e-5) return false;
  const ratio = finger === "thumb" ? 1.05 : 1.12;
  return tipDist > pipDist * ratio;
}
