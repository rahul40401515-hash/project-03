/**
 * Optional body pose for X-ray mode. Loads in the background.
 * Uses @mediapipe/pose from jsDelivr (same pattern as hands).
 */

const POSE_VERSION = "0.5.1675469404";
const POSE_CDNS = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/pose@${POSE_VERSION}`,
  `https://unpkg.com/@mediapipe/pose@${POSE_VERSION}`,
];

export class PoseEngine {
  constructor() {
    this.pose = null;
    this.ready = false;
    this.busy = false;
    this.landmarks = null;
    this._vw = 1;
    this._vh = 1;
  }

  async init() {
    let lastErr;
    for (const base of POSE_CDNS) {
      try {
        await loadScript(`${base}/pose.js`);
        const Pose = window.Pose;
        if (!Pose) throw new Error("Pose global missing");
        const pose = new Pose({ locateFile: (file) => `${base}/${file}` });
        pose.setOptions({
          modelComplexity: 0,
          smoothLandmarks: true,
          enableSegmentation: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        pose.onResults((res) => {
          this.landmarks = this.#fromResults(res, this._vw, this._vh);
        });
        if (typeof pose.initialize === "function") {
          await withTimeout(pose.initialize(), 18000, "pose initialize");
        }
        this.pose = pose;
        this.ready = true;
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Pose model failed");
  }

  tick(video) {
    if (!this.pose || !video?.videoWidth) return;
    this._vw = video.videoWidth;
    this._vh = video.videoHeight;
    if (this.busy || video.readyState < 2) return;
    this.busy = true;
    this.pose
      .send({ image: video })
      .catch(() => {})
      .finally(() => {
        this.busy = false;
      });
  }

  #fromResults(res, vw, vh) {
    const lm = res?.poseLandmarks;
    if (!lm || !lm.length) return null;
    return lm.map((p) => ({
      x: p.x * vw,
      y: p.y * vh,
      v: p.visibility ?? 1,
    }));
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) {
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
