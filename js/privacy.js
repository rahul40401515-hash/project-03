/**
 * Transparent overlay: hard-blur face + clothing only.
 * Does not replace the camera feed. Hands stay visible.
 */

const FACE_CDNS = [
  "https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4.1646425229",
  "https://unpkg.com/@mediapipe/face_detection@0.4.1646425229",
];

export class PrivacyLayer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });
    this.enabled = true;
    this.ready = false;
    this.face = null;
    this.faces = [];
    this.busy = false;
    this._vw = 1;
    this._vh = 1;
    this.tiny = document.createElement("canvas");
    this.tinyCtx = this.tiny.getContext("2d");
    this.frame = document.createElement("canvas");
    this.frameCtx = this.frame.getContext("2d");
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.dpr = dpr;
    this.cssW = w;
    this.cssH = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  async init() {
    let lastErr;
    for (const base of FACE_CDNS) {
      try {
        await loadScript(`${base}/face_detection.js`);
        const FaceDetection = window.FaceDetection;
        if (!FaceDetection) throw new Error("FaceDetection missing");
        const fd = new FaceDetection({ locateFile: (file) => `${base}/${file}` });
        fd.setOptions({ model: "short", minDetectionConfidence: 0.5 });
        fd.onResults((res) => {
          this.faces = parseFaces(res, this._vw, this._vh);
        });
        if (typeof fd.initialize === "function") {
          await withTimeout(fd.initialize(), 16000, "face initialize");
        }
        this.face = fd;
        this.ready = true;
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Face model failed");
  }

  tick(video) {
    if (!this.face || !video?.videoWidth) return;
    this._vw = video.videoWidth;
    this._vh = video.videoHeight;
    if (this.busy || video.readyState < 2) return;
    this.busy = true;
    this.face
      .send({ image: video })
      .catch(() => {})
      .finally(() => {
        this.busy = false;
      });
  }

  draw(video, mirrored, handBounds = []) {
    const ctx = this.ctx;
    const w = this.cssW;
    const h = this.cssH;
    ctx.clearRect(0, 0, w, h);
    if (!this.enabled || !this.ready || !video?.videoWidth) return;
    if (!this.faces.length) return;

    const map = mapping(video, w, h, mirrored);
    if (this.frame.width !== Math.round(w) || this.frame.height !== Math.round(h)) {
      this.frame.width = Math.round(w);
      this.frame.height = Math.round(h);
    }
    this.frameCtx.clearRect(0, 0, w, h);
    drawCover(this.frameCtx, video, map, mirrored, w);

    const hands = (handBounds || []).map((b) => toScreenRect(b, map));

    for (const f of this.faces) {
      const face = expand(toScreenRect(f, map), 1.28);
      const cloth = toScreenRect(clothFromFace(f), map);
      this.#hardBlur(ctx, face, 40, "ellipse");
      this.#hardBlur(ctx, cloth, 24, "rect");
    }

    for (const hand of hands) {
      this.#restoreVideo(ctx, video, map, mirrored, w, expand(hand, 1.2));
    }
  }

  #hardBlur(ctx, rect, strength, shape) {
    let { x, y, w, h } = rect;
    x = Math.max(0, x);
    y = Math.max(0, y);
    w = Math.min(w, this.cssW - x);
    h = Math.min(h, this.cssH - y);
    if (w < 10 || h < 10) return;

    const tw = Math.max(3, Math.round(w / strength));
    const th = Math.max(3, Math.round(h / strength));
    this.tiny.width = tw;
    this.tiny.height = th;
    this.tinyCtx.imageSmoothingEnabled = true;
    this.tinyCtx.drawImage(this.frame, x, y, w, h, 0, 0, tw, th);

    ctx.save();
    ctx.beginPath();
    if (shape === "ellipse") {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else {
      roundRect(ctx, x, y, w, h, Math.min(28, w * 0.14));
    }
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.tiny, 0, 0, tw, th, x, y, w, h);
    ctx.restore();
  }

  #restoreVideo(ctx, video, map, mirrored, cssW, rect) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2, rect.h / 2, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }
}

function clothFromFace(f) {
  return {
    x: f.x + f.w * 0.5 - f.w * 1.05,
    y: f.y + f.h * 0.78,
    w: f.w * 2.1,
    h: f.h * 2.4,
  };
}

function expand(r, s) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const w = r.w * s;
  const h = r.h * s;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function mapping(video, cw, ch, mirrored) {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const scale = Math.max(cw / vw, ch / vh);
  return {
    scale,
    dx: (cw - vw * scale) / 2,
    dy: (ch - vh * scale) / 2,
    vw,
    vh,
    cw,
    mirrored,
  };
}

function toScreenRect(r, map) {
  const a = mapPoint(r.x, r.y, map);
  const b = mapPoint(r.x + r.w, r.y + r.h, map);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

function mapPoint(x, y, map) {
  let px = x * map.scale + map.dx;
  const py = y * map.scale + map.dy;
  if (map.mirrored) px = map.cw - px;
  return { x: px, y: py };
}

function drawCover(ctx, video, map, mirrored, cssW) {
  ctx.save();
  if (mirrored) {
    ctx.translate(cssW, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, map.dx, map.dy, map.vw * map.scale, map.vh * map.scale);
  ctx.restore();
}

function parseFaces(res, vw, vh) {
  const dets = res?.detections || [];
  return dets.map((d) => {
    const bb = d.boundingBox || {};
    let x, y, w, h;
    if (bb.xMin != null) {
      x = bb.xMin * vw;
      y = bb.yMin * vh;
      w = (bb.width ?? bb.xMax - bb.xMin) * vw;
      h = (bb.height ?? bb.yMax - bb.yMin) * vh;
    } else if (bb.originX != null) {
      x = bb.originX;
      y = bb.originY;
      w = bb.width;
      h = bb.height;
    } else {
      w = (bb.width || 0.2) * vw;
      h = (bb.height || 0.2) * vh;
      x = (bb.xCenter || 0.5) * vw - w / 2;
      y = (bb.yCenter || 0.5) * vh - h / 2;
    }
    return { x, y, w, h };
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
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
    const t = setTimeout(() => reject(new Error(`timeout ${src}`)), 16000);
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
