/**
 * Minimal control surface. All camera / HUD flags live on the shared `state`.
 */

export function bindControls(state, handlers) {
  const root = document.getElementById("controls");
  const peek = document.getElementById("toggle-ui");
  const toast = document.getElementById("toast");
  const metaMode = document.getElementById("meta-mode");
  const metaTrack = document.getElementById("meta-track");
  const errorOverlay = document.getElementById("error-overlay");
  const errorText = document.getElementById("error-text");

  root.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.mode) {
      handlers.setMode(btn.dataset.mode);
      return;
    }
    const action = btn.dataset.action;
    if (action && handlers[action]) handlers[action]();
  });

  peek.addEventListener("click", () => handlers.hide());
  document.getElementById("error-retry")?.addEventListener("click", () => {
    errorOverlay.hidden = true;
    handlers.camera?.();
  });

  function syncButtons() {
    root.querySelectorAll("[data-action]").forEach((btn) => {
      const a = btn.dataset.action;
      if (a === "camera") {
        btn.textContent = state.cameraOn ? "STOP CAMERA" : "START CAMERA";
        btn.classList.toggle("is-on", state.cameraOn);
      }
      if (a === "tracking") {
        btn.textContent = state.trackingOn ? "TRACKING ON" : "TRACKING OFF";
        btn.classList.toggle("is-on", state.trackingOn);
      }
      if (a === "hud") {
        btn.textContent = state.hudOn ? "HUD ON" : "HUD OFF";
        btn.classList.toggle("is-on", state.hudOn);
      }
      if (a === "scan") {
        btn.textContent = state.scanOn ? "SCAN ON" : "SCAN OFF";
        btn.classList.toggle("is-on", state.scanOn);
      }
      if (a === "geometry") {
        btn.textContent = state.geometryOn ? "GEOMETRY ON" : "GEOMETRY OFF";
        btn.classList.toggle("is-on", state.geometryOn);
      }
      if (a === "flip") {
        btn.textContent = "CAMERA SWITCH";
      }
    });
    root.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.classList.toggle("is-on", btn.dataset.mode === state.mode);
    });
    root.classList.toggle("is-hidden", state.uiHidden);
    peek.textContent = state.uiHidden ? "CONTROLS" : "HIDE UI";
    const meta = document.getElementById("meta-panel");
    if (meta) meta.style.opacity = state.uiHidden ? "0" : "1";
  }

  function syncMeta() {
    const names = { human: "HUMAN", face: "FACE", object: "OBJECT" };
    metaMode.textContent = `MODE: ${names[state.mode] || "—"}`;
    metaTrack.textContent = `TRACKING: ${state.trackStatus || "STANDBY"}`;
  }

  let toastTimer = 0;
  function showToast(text) {
    if (!text) {
      toast.hidden = true;
      return;
    }
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 1200);
  }

  function showError(message) {
    errorText.textContent = message;
    errorOverlay.hidden = false;
  }

  function hideError() {
    errorOverlay.hidden = true;
  }

  return { syncButtons, syncMeta, showToast, showError, hideError };
}
