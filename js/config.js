/** Tunable constants for PROJECT 02 — Visual Analysis. */

export const MODES = {
  human: { id: "HUMAN", label: "MODE 01 — HUMAN" },
  face: { id: "FACE", label: "MODE 02 — FACE" },
  object: { id: "OBJECT", label: "MODE 03 — OBJECT" },
};

export const MEDIAPIPE = {
  visionBundle: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs",
  wasm: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  faceModel:
    "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
  poseModel:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.tflite",
  objectModel:
    "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
};

export const TRACK = {
  lerpPos: 0.22,
  lerpSize: 0.14,
  lerpLocked: 0.12,
  lostMs: 720,
  restoreToastMs: 900,
  lostToastMs: 1100,
  minConfidence: 0.35,
  iouMatch: 0.28,
  detectMs: 280,
  acquireMs: 700,
  lockMs: 1400,
  stillPxS: 22,
};

export const HUD = {
  line: "rgba(244,244,241,0.9)",
  dim: "rgba(244,244,241,0.4)",
  faint: "rgba(244,244,241,0.16)",
  accent: "rgba(186,220,235,0.88)",
  scan: "rgba(244,244,241,0.5)",
  bracketLenRatio: 0.16,
  bracketMin: 16,
  bracketMax: 38,
  scanPeriod: 4600,
};

export const GEOMETRY = {
  sampleW: 192,
  minAreaRatio: 0.01,
  maxAreaRatio: 0.58,
  edgeThreshold: 36,
};
