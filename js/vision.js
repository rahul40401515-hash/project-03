/**
 * Hand tracking with an iOS/Vercel-safe engine.
 * Primary: @mediapipe/hands (jsDelivr) — no Google Storage models.
 * Fallback: MediaPipe Tasks HandLandmarker.
 */

import { MEDIAPIPE } from "./config.js";

const TIP = { thumb: 4, index: 8 };
const PIP = { thumb: 3, index: 6 };
const MCP = { thumb: 2, index: 5 };

const HANDS_VERSION = "0.4.1675469240";
const HANDS_CDNS = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${HANDS_VERSION}`,
  `https://unpkg.com/@mediapipe/hands@${HANDS_VERSION}`,
];

export class VisionEngine {
  constructor() {
    this.backend = null;
    this.hands = null;
    this.handLandmarker = null;
    this.cached = [];
    this.fresh = false;
    this.busy = false;
    this.lastMediaTime = -1;
  }

  async init(onProgress = () => {}) {
    onProgress(0.2, "LOADING HAND ENGINE");
    const errors = [];

    try {
      await this.#initLegacy(onProgress);
      this.backend = "hands";
      onProgress(0.92, "HAND ENGINE READY");
      return;
    } catch (err) {
      errors.push(`hands: ${err?.message || err}`);
      console.warn("Legacy Hands failed", err);
    }

    onProgress(0.45, "TRYING FALLBACK ENGINE");
    try {
      await this.#initTasks(onProgress);
      this.backend = "tasks";
      onProgress(0.92, "HAND ENGINE READY");
      return;
    } catch (err) {
      errors.push(`tasks: ${err?.message || err}`);
      console.warn("Tasks Hands failed", err);
    }

    throw new Error(errors.join(" | ") || "Hand tracker failed");
  }

  async #initLegacy(onProgress) {
    let lastErr;
    for (const base of HANDS_CDNS) {
      try {
        onProgress(0.35, "FETCHING HAND MODEL");
        await loadScript(`${base}/hands.js`);
        const Hands = window.Hands;
        if (!Hands) throw new Error("Hands global missing");

        const hands = new Hands({
          locateFile: (file) => `${base}/${file}`,
        });
        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: isMobile() ? 0 : 1,
          minDetectionConfidence: 0.55,
          minTrackingConfidence: 0.5,
        });
        hands.onResults((results) => {
          this.cached = this.#fromLegacy(results, this._vw || 1, this._vh || 1);
          this.fresh = true;
        });
        if (typeof hands.initialize === "function") {
          await withTimeout(hands.initialize(), 20000, "hands initialize");
        }
        this.hands = hands;
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("All Hands CDNs failed");
  }

  async #initTasks(onProgress) {
    const visionMod = await import(MEDIAPIPE.visionBundle);
    onProgress(0.6, "LOADING WASM");
    const fileset = await visionMod.FilesetResolver.forVisionTasks(MEDIAPIPE.wasm);
    onProgress(0.75, "LOADING LANDMARKER");
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const delegates = isIOS ? ["CPU"] : ["CPU", "GPU"];
    let lastErr;
    for (const delegate of delegates) {
      try {
        this.handLandmarker = await visionMod.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MEDIAPIPE.handModel, delegate },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("HandLandmarker create failed");
  }

  /**
   * @returns {Array|null} null = no new result this tick
   */
  detectFingers(video, timestampMs) {
    if (!video?.videoWidth) return [];

    if (this.backend === "hands") {
      this._vw = video.videoWidth;
      this._vh = video.videoHeight;
      if (!this.busy && this.hands && video.readyState >= 2) {
        this.busy = true;
        this.hands
          .send({ image: video })
          .catch(() => {})
          .finally(() => {
            this.busy = false;
          });
      }
      if (!this.fresh) return null;
      this.fresh = false;
      return this.cached;
    }

    if (this.backend === "tasks" && this.handLandmarker) {
      if (video.currentTime === this.lastMediaTime) return null;
      this.lastMediaTime = video.currentTime;
      try {
        const res = this.handLandmarker.detectForVideo(video, timestampMs);
        return this.#fromTasks(res, video);
      } catch (err) {
        console.warn("detect frame skipped", err);
        return [];
      }
    }

    return [];
  }

  #fromLegacy(results, vw, vh) {
    const hands = results?.multiHandLandmarks || [];
    const handed = results?.multiHandedness || [];
    const out = [];
    for (let i = 0; i < hands.length; i++) {
      const lm = hands[i];
      let side = (handed[i]?.label || "Right").toUpperCase();
      if (side !== "LEFT" && side !== "RIGHT") side = "RIGHT";
      const score = handed[i]?.score ?? 0.7;
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

  #fromTasks(res, video) {
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

function isMobile() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = [...document.scripts].find((s) => s.src === src);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.crossOrigin = "anonymous";
    const t = setTimeout(() => reject(new Error(`timeout ${src}`)), 18000);
    s.onload = () => {
      clearTimeout(t);
      resolve();
    };
    s.onerror = () => {
      clearTimeout(t);
      reject(new Error(`script ${src}`));
    };
    document.head.appendChild(s);
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms)),
  ]);
}
