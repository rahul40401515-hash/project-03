/** Tunable constants for PROJECT 01. */

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
  lerpPos: 0.28,
  lerpSize: 0.18,
  lostMs: 700,
  restoreToastMs: 900,
  lostToastMs: 1100,
  minConfidence: 0.35,
  iouMatch: 0.28,
};

export const HUD = {
  line: "rgba(244,244,241,0.88)",
  dim: "rgba(244,244,241,0.38)",
  faint: "rgba(244,244,241,0.16)",
  accent: "rgba(186,220,235,0.9)",
  scan: "rgba(244,244,241,0.55)",
  bracketLenRatio: 0.18,
  bracketMin: 14,
  bracketMax: 42,
  scanPeriod: 4200,
};

export const GEOMETRY = {
  sampleW: 176,
  minAreaRatio: 0.012,
  maxAreaRatio: 0.62,
  edgeThreshold: 38,
};
