/**
 * Webcam access via MediaDevices. Permission is requested only on user gesture.
 * Prefers the rear camera on phones; supports flipping between facing modes.
 */

export class Camera {
  constructor(videoEl, invertEl = null) {
    this.video = videoEl;
    this.invert = invertEl;
    this.stream = null;
    this.facingMode = this.#defaultFacing();
    this.running = false;
  }

  #defaultFacing() {
    const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    return mobile ? "environment" : "user";
  }

  isFront() {
    return this.facingMode === "user";
  }

  async start(facingMode = this.facingMode) {
    this.facingMode = facingMode;
    await this.stop();

    const tryConstraints = [
      {
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      {
        audio: false,
        video: { facingMode },
      },
      { audio: false, video: true },
    ];

    let lastError;
    for (const constraints of tryConstraints) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!this.stream) throw lastError || new Error("Camera permission denied");

    this.video.srcObject = this.stream;
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.setAttribute("playsinline", "true");
    this.video.classList.toggle("is-front", this.isFront());

    if (this.invert) {
      this.invert.srcObject = this.stream;
      this.invert.playsInline = true;
      this.invert.muted = true;
      this.invert.setAttribute("playsinline", "true");
      this.invert.classList.toggle("is-front", this.isFront());
      this.invert.play().catch(() => {});
    }

    await this.video.play();
    await this.#waitForData();
    this.running = true;
    return this.video;
  }

  async #waitForData() {
    if (this.video.readyState >= 2 && this.video.videoWidth) return;
    await new Promise((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error("Video failed to start"));
      };
      const cleanup = () => {
        this.video.removeEventListener("loadeddata", onReady);
        this.video.removeEventListener("error", onErr);
      };
      this.video.addEventListener("loadeddata", onReady);
      this.video.addEventListener("error", onErr);
      setTimeout(onReady, 2500);
    });
  }

  async flip() {
    const next = this.facingMode === "user" ? "environment" : "user";
    return this.start(next);
  }

  async stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
    if (this.invert) this.invert.srcObject = null;
    this.running = false;
  }

  size() {
    return {
      width: this.video.videoWidth || 0,
      height: this.video.videoHeight || 0,
    };
  }
}
