/**
 * Fingertip HUD: black dots, thick neon connections.
 * Negative fill is a CSS-inverted video clipped to the fingertip polygon
 * (works on iOS; canvas filter invert does not).
 */

import { HUD } from "./config.js";

export class HUDRenderer {
  constructor(canvas, invertEl = null) {
    this.canvas = canvas;
    this.invertEl = invertEl;
    this.ctx = canvas.getContext("2d");
    this.enabled = true;
    this.dpr = 1;
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

  mapping(video, mirrored) {
    const vw = video.videoWidth || 1;
    const vh = video.videoHeight || 1;
    const cw = this.cssW;
    const ch = this.cssH;
    const scale = Math.max(cw / vw, ch / vh);
    const dx = (cw - vw * scale) / 2;
    const dy = (ch - vh * scale) / 2;
    return {
      to(x, y) {
        let px = x * scale + dx;
        const py = y * scale + dy;
        if (mirrored) px = cw - px;
        return { x: px, y: py };
      },
      scale,
      dx,
      dy,
      vw,
      vh,
    };
  }

  clear() {
    this.ctx.clearRect(0, 0, this.cssW, this.cssH);
  }

  setInvertClip(hull) {
    const el = this.invertEl;
    if (!el) return;
    if (!hull || hull.length < 3) {
      const empty = "polygon(0px 0px, 0px 0px, 0px 0px)";
      el.style.clipPath = empty;
      el.style.webkitClipPath = empty;
      el.style.opacity = "0";
      return;
    }
    const poly = `polygon(${hull
      .map((p) => `${p.sx.toFixed(1)}px ${p.sy.toFixed(1)}px`)
      .join(", ")})`;
    el.style.clipPath = poly;
    el.style.webkitClipPath = poly;
    el.style.opacity = "1";
  }

  draw({ video, mirrored, snapshot }) {
    const ctx = this.ctx;
    this.clear();
    if (!this.enabled) {
      this.setInvertClip(null);
      return;
    }

    const pts = snapshot?.points || [];
    if (!video?.videoWidth || !pts.length) {
      this.setInvertClip(null);
      return;
    }

    const map = this.mapping(video, mirrored);
    const screen = pts.map((p) => {
      const s = map.to(p.x, p.y);
      return { ...p, sx: s.x, sy: s.y };
    });

    const hull = convexHull(screen);
    this.setInvertClip(hull.length >= 3 ? hull : null);

    if (screen.length >= 2) {
      this.#neon(ctx, hull.length >= 3 ? hull : screen);
    }
    for (const p of screen) this.#dot(ctx, p);
  }

  #neon(ctx, pts) {
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = HUD.neon;
    ctx.shadowBlur = 22;
    ctx.strokeStyle = HUD.neon;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(pts[0].sx, pts[0].sy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
    if (pts.length >= 3) ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#eaffff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  #dot(ctx, p) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, 9, 0, Math.PI * 2);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.restore();
  }
}

function convexHull(points) {
  if (points.length < 3) return points.slice();
  const pts = points
    .map((p) => ({ ...p }))
    .sort((a, b) => a.sx - b.sx || a.sy - b.sy);

  const cross = (o, a, b) => (a.sx - o.sx) * (b.sy - o.sy) - (a.sy - o.sy) * (b.sx - o.sx);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
