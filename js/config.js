/** PROJECT 03 — fingertip tracking. */

export const MEDIAPIPE = {
  visionBundle: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs",
  wasm: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  handModel:
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.tflite",
};

export const FINGERS = {
  lerp: 0.38,
  lostMs: 280,
  extendRatio: 1.18,
};

export const HUD = {
  neon: "#39f7ff",
  neonSoft: "rgba(57, 247, 255, 0.55)",
  line: "rgba(244,244,241,0.85)",
  dim: "rgba(244,244,241,0.35)",
};
