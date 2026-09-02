/**
 * PROJECT 03 — fingertip visual analysis.
 * Tracks left/right thumb + index only. No object boxes.
 */

import { playBootSequence, setBootProgress, logBoot, unlockStart, dismissBoot } from "./boot.js";
import { Camera } from "./camera.js";
import { VisionEngine } from "./vision.js";
import { Tracker } from "./tracker.js";
import { HUDRenderer } from "./hud.js";
import { bindControls } from "./ui.js";

const state = {
  cameraOn: false,
  trackingOn: true,
  hudOn: true,
  uiHidden: false,
  trackStatus: "STANDBY",
};

const video = document.getElementById("camera");
const canvas = document.getElementById("hud");
const camera = new Camera(video);
const vision = new VisionEngine();
const tracker = new Tracker();
const hud = new HUDRenderer(canvas);

let raf = 0;

const ui = bindControls(state, {
  camera: toggleCamera,
  tracking: () => {
    state.trackingOn = !state.trackingOn;
    if (!state.trackingOn) tracker.reset();
    state.trackStatus = state.trackingOn ? "STANDBY" : "OFF";
    ui.syncButtons();
    ui.syncMeta();
  },
  hud: () => {
    state.hudOn = !state.hudOn;
    hud.enabled = state.hudOn;
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
  hide: () => {
    state.uiHidden = !state.uiHidden;
    ui.syncButtons();
  },
});

async function main() {
  await playBootSequence();

  if (!navigator.mediaDevices?.getUserMedia) {
    setBootProgress(100, "CAMERA API UNAVAILABLE");
    logBoot("SYSTEM FAULT");
    return;
  }

  try {
    setBootProgress(20, "INITIALIZING…");
    await vision.init((pct, msg) => setBootProgress(Math.round(pct * 100), msg));
    logBoot("SYSTEM ONLINE");
    await wait(220);
    logBoot("CAMERA READY");
    await wait(220);
    logBoot(vision.backend === "hands" ? "HAND ENGINE READY" : "TRACKING READY");
    setBootProgress(100, "TRACKING READY");
    unlockStart();
  } catch (err) {
    console.error(err);
    setBootProgress(100, "HAND MODEL FAILED");
    logBoot("UNABLE TO LOAD HAND TRACKER");
    const detail = String(err?.message || err).slice(0, 80);
    if (detail) logBoot(detail.toUpperCase());
  }

  document.getElementById("start-btn").addEventListener("click", onStart);
}

async function onStart() {
  const btn = document.getElementById("start-btn");
  btn.disabled = true;
  btn.querySelector("span").textContent = "REQUESTING CAMERA";
  try {
    await camera.start("user");
    state.cameraOn = true;
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
        " Grant camera permission and retry. Processing stays on this device."
    );
  }
}

async function toggleCamera() {
  if (state.cameraOn) {
    cancelAnimationFrame(raf);
    await camera.stop();
    state.cameraOn = false;
    tracker.reset();
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

    if (state.cameraOn && camera.running && state.trackingOn && video.readyState >= 2) {
      const dets = vision.detectFingers(video, now);
      const snap = tracker.update(dets, now);
      state.trackStatus = snap.status;
      ui.syncMeta();
      hud.draw({
        video,
        mirrored: camera.isFront(),
        snapshot: snap,
      });
    } else {
      hud.clear();
    }
  };
  tick();
}

function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) {
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
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
