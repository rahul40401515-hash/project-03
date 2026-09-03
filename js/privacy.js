/**
 * Anonymizer: hard-blur faces and clothing so a person cannot be recognized.
 * Hands are punched back out so fingertip tracking stays sharp.
 * Uses MediaPipe Face Detection (jsDelivr). Optional selfie segmentation.
 */

const FACE_CDNS = [
  "https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4.1646425229",
  "https://unpkg.com/@mediapipe/face_detection@0.4.1646425229",
];

const SEG_CDNS = [
  "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747",
  "https://unpkg.com/@mediapipe/selfie_segmentation@0.1.1675465747",
];

export class PrivacyLayer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.enabled = true;
    this.face = null;
    this.seg = null;
    this.faces = [];
    this.mask = null;
    this.busyFace = false;
    this.busySeg = false;
    this._vw = 1;
    this._vh = 1;
    this.tiny = document.createElement("canvas");
    this.tinyCtx = this.tiny.getContext("2d");
    this.work = document.createElement("canvas");
    this.workCtx = this.work.getContext("2d");
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

  async init(onProgress = () => {}) {
    onProgress(0.3, "LOADING FACE MODEL");
    await this.#initFace();
    onProgress(0.7, "LOADING BODY MASK");
    try {
      await this.#initSeg();
    } catch (err) {
      console.warn("Segmentation optional, using face/cloth boxes", err);
    }
    onProgress(1, "ANONYMIZER READY");
  }

  async #initFace() {
    let lastErr;
    for (const base of FACE_CDNS) {
      try {
        await loadScript(`${base}/face_detection.js`);
        const FaceDetection = window.FaceDetection;
        if (!FaceDetection) throw new Error("FaceDetection missing");
        const fd = new FaceDetection({ locateFile: (file) => `${base}/${file}` });
        fd.setOptions({ model: "short", minDetectionConfidence: 0.45 });
        fd.onResults((res) => {
          this.faces = this.#parseFaces(res, this._vw, this._vh);
        });
        if (typeof fd.initialize === "function") {
          await withTimeout(fd.initialize(), 18000, "face initialize");
        }
        this.face = fd;
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Face model failed");
  }

  async #initSeg() {
    let lastErr;
    for (const base of SEG_CDNS) {
      try {
        await loadScript(`${base}/selfie_segmentation.js`);
        const SelfieSegmentation = window.SelfieSegmentation;
        if (!SelfieSegmentation) throw new Error("SelfieSegmentation missing");
        const ss = new SelfieSegmentation({ locateFile: (file) => `${base}/${file}` });
        ss.setOptions({ modelSelection: 0 });
        ss.onResults((res) => {
          this.mask = res.segmentationMask || null;
        });
        if (typeof ss.initialize === "function") {
          await withTimeout(ss.initialize(), 18000, "seg initialize");
        }
        this.seg = ss;
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Segmentation failed");
  }

  tick(video) {
    if (!video?.videoWidth) return;
    this._vw = video.videoWidth;
    this._vh = video.videoHeight;
    if (this.face && !this.busyFace && video.readyState >= 2) {
      this.busyFace = true;
      this.face
        .send({ image: video })
        .catch(() => {})
        .finally(() => {
          this.busyFace = false;
        });
    }
    if (this.seg && !this.busySeg && video.readyState >= 2) {
      this.busySeg = true;
      this.seg
        .send({ image: video })
        .catch(() => {})
        .finally(() => {
          this.busySeg = false;
        });
    }
  }

  draw(video, mirrored, handBounds = []) {
    const ctx = this.ctx;
    const w = this.cssW;
    const h = this.cssH;
    ctx.clearRect(0, 0, w, h);
    if (!video?.videoWidth) return;

    const map = mapping(video, w, h, mirrored);
    if (this.frame.width !== Math.round(w) || this.frame.height !== Math.round(h)) {
      this.frame.width = Math.round(w);
      this.frame.height = Math.round(h);
    }
    this.frameCtx.clearRect(0, 0, w, h);
    drawCover(this.frameCtx, video, map, mirrored, w);
    ctx.drawImage(this.frame, 0, 0, w, h);

    if (!this.enabled) return;

    const cloth = this.faces.map((f) => clothFromFace(f));
    const faces = this.faces.map((f) => toScreenRect(f, map));
    const clothes = cloth.map((c) => toScreenRect(c, map));
    const hands = (handBounds || []).map((b) => toScreenRect(b, map));

    if (this.mask) {
      this.#blurMaskedPerson(ctx, video, map, mirrored, w, h);
    }

    for (const c of clothes) {
      this.#hardBlur(ctx, c, 22, "rect");
    }
    for (const f of faces) {
      this.#hardBlur(ctx, expand(f, 1.22), 36, "ellipse");
    }

    for (const hand of hands) {
      this.#restoreSharp(ctx, video, map, mirrored, w, expand(hand, 1.15));
    }
  }

  #blurMaskedPerson(ctx, video, map, mirrored, w, h) {
    const work = this.work;
    const wctx = this.workCtx;
    const dw = Math.max(160, Math.round(w / 4));
    const dh = Math.max(90, Math.round(h / 4));
    if (work.width !== dw || work.height !== dh) {
      work.width = dw;
      work.height = dh;
    }
    wctx.save();
    wctx.clearRect(0, 0, dw, dh);
    if (mirrored) {
      wctx.translate(dw, 0);
      wctx.scale(-1, 1);
    }
    wctx.drawImage(video, 0, 0, dw, dh);
    wctx.globalCompositeOperation = "destination-in";
    wctx.drawImage(this.mask, 0, 0, dw, dh);
    wctx.restore();

    const tinyW = Math.max(8, Math.round(dw / 18));
    const tinyH = Math.max(8, Math.round(dh / 18));
    this.tiny.width = tinyW;
    this.tiny.height = tinyH;
    this.tinyCtx.imageSmoothingEnabled = true;
    this.tinyCtx.drawImage(work, 0, 0, tinyW, tinyH);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.tiny, 0, 0, tinyW, tinyH, 0, 0, w, h);
    ctx.restore();
  }

  #hardBlur(ctx, rect, strength, shape) {
    let { x, y, w, h } = rect;
    if (w < 8 || h < 8) return;
    x = Math.max(0, x);
    y = Math.max(0, y);
    const maxW = this.cssW - x;
    const maxH = this.cssH - y;
    w = Math.min(w, maxW);
    h = Math.min(h, maxH);
    if (w < 8 || h < 8) return;

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
      roundRect(ctx, x, y, w, h, Math.min(24, w * 0.12));
    }
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.tiny, 0, 0, tw, th, x, y, w, h);
    ctx.restore();
  }

  #restoreSharp(ctx, video, map, mirrored, cssW, rect) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2, rect.h / 2, 0, 0, Math.PI * 2);
    ctx.clip();
    drawCover(ctx, video, map, mirrored, cssW);
    ctx.restore();
  }

  #parseFaces(res, vw, vh) {
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
}

function clothFromFace(f) {
  return {
    x: f.x + f.w / 2 - f.w * 1.25,
    y: f.y + f.h * 0.72,
    w: f.w * 2.5,
    h: f.h * 3.6,
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
  const dx = (cw - vw * scale) / 2;
  const dy = (ch - vh * scale) / 2;
  return { scale, dx, dy, vw, vh, cw, mirrored };
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
