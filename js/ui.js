/** Minimal control surface. */

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
      if (a === "xray") {
        btn.textContent = state.xrayOn ? "X-RAY ON" : "X-RAY MODE";
        btn.classList.toggle("is-on", state.xrayOn);
      }
    });
    root.classList.toggle("is-hidden", state.uiHidden);
    peek.textContent = state.uiHidden ? "CONTROLS" : "HIDE UI";
    const meta = document.getElementById("meta-panel");
    if (meta) meta.style.opacity = state.uiHidden ? "0" : "1";
  }

  function syncMeta() {
    if (metaMode) metaMode.textContent = state.xrayOn ? "MODE: X-RAY" : "MODE: FINGERS";
    if (metaTrack) metaTrack.textContent = `TRACKING: ${state.trackStatus || "STANDBY"}`;
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
