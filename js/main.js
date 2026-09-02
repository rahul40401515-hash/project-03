/**
 * PROJECT 02 — Visual Analysis System
 * Detection: existing MediaPipe engine (vision.js) — unchanged pipeline.
 * This file wires tracking, geometry overlay, and HUD animation.
 * Camera frames never leave this device.
 */

import { playBootSequence, setBootProgress, logBoot, unlockStart, dismissBoot } from "./boot.js";
import { Camera } from "./camera.js";
import { VisionEngine } from "./vision.js";
import { detectGeometry, mergeDetections } from "./geometry.js";
import { Tracker } from "./tracker.js";
import { HUDRenderer } from "./hud.js";
import { bindControls } from "./ui.js";

const state = {
  mode: "human",
  cameraOn: false,
  trackingOn: true,
  hudOn: true,
  scanOn: true,
  geometryOn: true,
  uiHidden: false,
  trackStatus: "STANDBY",
  started: false,
};

const video = document.getElementById("camera");
const canvas = document.getElementById("hud");
const camera = new Camera(video);
const vision = new VisionEngine();
const tracker = new Tracker();
const hud = new HUDRenderer(canvas);

let lastEvent = null;
let raf = 0;

const ui = bindControls(state, {
  camera: toggleCamera,
  tracking: () => {
    state.trackingOn = !state.trackingOn;
    if (!state.trackingOn) {
      tracker.reset();
      state.trackStatus = "OFF";
    }
    ui.syncButtons();
    ui.syncMeta();
  },
  hud: () => {
    state.hudOn = !state.hudOn;
    hud.enabled = state.hudOn;
    ui.syncButtons();
  },
  scan: () => {
    state.scanOn = !state.scanOn;
    hud.scanEnabled = state.scanOn;
    ui.syncButtons();
  },
  geometry: () => {
    state.geometryOn = !state.geometryOn;
    hud.geometryOn = state.geometryOn;
    ui.syncButtons();
  },
  flip: async () => {
    if (!state.cameraOn) return;
    try {
      await camera.flip();
      tracker.reset();
    } catch (err) {
      ui.showError(err.message || "Unable to switch camera.");
    }
  },
  fullscreen: toggleFullscreen,
  reset: () => {
    tracker.reset();
    state.trackStatus = state.cameraOn ? "SEARCHING" : "STANDBY";
    ui.syncMeta();
  },
  hide: () => {
    state.uiHidden = !state.uiHidden;
    ui.syncButtons();
  },
  setMode: async (mode) => {
    state.mode = mode;
    tracker.reset();
    ui.syncButtons();
    ui.syncMeta();
    if (mode === "object") {
      ui.showToast("LOADING OBJECT MODEL");
      await vision.ensureObjectDetector();
      ui.showToast("MODE 03 OBJECT");
    }
  },
});

async function main() {
  await playBootSequence();

  if (!navigator.mediaDevices?.getUserMedia) {
    setBootProgress(100, "CAMERA API UNAVAILABLE");
    logBoot("SYSTEM FAULT");
    document.getElementById("boot-status").textContent = "THIS BROWSER CANNOT ACCESS A CAMERA";
    return;
  }

  try {
    setBootProgress(18, "INITIALIZING…");
    await vision.init((pct, msg) => {
      setBootProgress(Math.round(pct * 100), msg);
    });
    setBootProgress(90, "SYSTEM ONLINE");
    logBoot("SYSTEM ONLINE");
    await wait(280);
    logBoot("CAMERA READY");
    setBootProgress(96, "CAMERA READY");
    await wait(280);
    logBoot("ANALYSIS READY");
    setBootProgress(100, "ANALYSIS READY");
    await wait(200);
    unlockStart();
  } catch (err) {
    console.error(err);
    setBootProgress(100, "VISION RUNTIME FAILED");
    logBoot("FALLBACK: GEOMETRY TRACKER ONLY");
    unlockStart();
  }

  document.getElementById("start-btn").addEventListener("click", onStart);
}

async function onStart() {
  const btn = document.getElementById("start-btn");
  btn.disabled = true;
  btn.querySelector("span").textContent = "REQUESTING CAMERA";
  try {
    await camera.start();
    state.cameraOn = true;
    state.started = true;
    document.getElementById("stage").hidden = false;
    await dismissBoot();
    ui.syncButtons();
    ui.syncMeta();
    loop();
  } catch (err) {
    btn.disabled = false;
    btn.querySelector("span").textContent = "START VISION";
    ui.showError(
      friendlyCameraError(err) +
        " Grant camera permission and retry. Nothing is uploaded — processing stays on this device."
    );
  }
}

async function toggleCamera() {
  if (state.cameraOn) {
    cancelAnimationFrame(raf);
    await camera.stop();
    state.cameraOn = false;
    tracker.reset();
    state.trackStatus = "STANDBY";
    hud.clear();
    ui.syncButtons();
    ui.syncMeta();
    return;
  }
  try {
    ui.hideError();
    await camera.start();
    state.cameraOn = true;
    loop();
  } catch (err) {
    ui.showError(friendlyCameraError(err));
  }
  ui.syncButtons();
  ui.syncMeta();
}

function loop() {
  cancelAnimationFrame(raf);
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const now = performance.now();

    hud.enabled = state.hudOn;
    hud.scanEnabled = state.scanOn;
    hud.geometryOn = state.geometryOn;

    if (state.cameraOn && camera.running && state.trackingOn && video.readyState >= 2) {
      let dets = vision.detect(video, state.mode, now);
      if (dets !== null && state.geometryOn && state.mode !== "object") {
        dets = mergeDetections(dets, detectGeometry(video));
      }
      const snap = tracker.update(dets, now);
      state.trackStatus = snap.phase || snap.status;
      if (snap.event && snap.event !== lastEvent) ui.showToast(snap.event);
      lastEvent = snap.event;
      ui.syncMeta();
      hud.draw({
        video,
        mirrored: camera.isFront(),
        mode: state.mode,
        snapshot: snap,
        now,
        cameraOn: true,
      });
    } else {
      hud.draw({
        video,
        mirrored: camera.isFront(),
        mode: state.mode,
        snapshot: { tracks: [], primary: null, status: state.trackStatus, phase: state.trackStatus },
        now,
        cameraOn: state.cameraOn,
      });
    }
  };
  tick();
}

function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) {
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    req?.call(el);
  } else {
    document.exitFullscreen?.();
  }
}

function friendlyCameraError(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera permission was denied.";
  }
  if (name === "NotFoundError") return "No camera was found on this device.";
  if (name === "NotReadableError") return "The camera is already in use by another application.";
  return err?.message || "Unable to open the camera.";
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

main();
