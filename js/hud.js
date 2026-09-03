/**
 * Fingertip HUD.
 * Neon box and negative fill share the same polygon so the invert
 * cannot drift outside the box.
 */

import { HUD } from "./config.js";

export class HUDRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });
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

  draw({ video, mirrored, snapshot }) {
    const ctx = this.ctx;
    this.clear();
    if (!this.enabled) return;

    const pts = snapshot?.points || [];
    if (!video?.videoWidth || !pts.length) return;

    const map = this.mapping(video, mirrored);
    const screen = pts.map((p) => {
      const s = map.to(p.x, p.y);
      return { ...p, sx: s.x, sy: s.y };
    });

    const poly = orderPoly(screen);

    if (poly.length >= 3) {
      this.#negativeInside(ctx, video, mirrored, map, poly);
      this.#neonBox(ctx, poly);
    } else if (poly.length === 2) {
      this.#neonBox(ctx, poly);
    }

    for (const p of screen) this.#dot(ctx, p);
  }

  #path(ctx, poly) {
    ctx.beginPath();
    ctx.moveTo(poly[0].sx, poly[0].sy);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].sx, poly[i].sy);
    if (poly.length >= 3) ctx.closePath();
  }

  /**
   * Invert is clipped to an inset of the SAME polygon as the neon stroke.
   * White + "difference" = photographic negative, works on iOS.
   */
  #negativeInside(ctx, video, mirrored, map, poly, screenSource) {
    const inner = insetPoly(poly, 4);
    if (inner.length < 3) return;

    ctx.save();
    this.#path(ctx, inner);
    ctx.clip();

    if (screenSource) {
      ctx.drawImage(screenSource, 0, 0, this.cssW, this.cssH);
    } else {
      ctx.save();
      if (mirrored) {
        ctx.translate(this.cssW, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, map.dx, map.dy, map.vw * map.scale, map.vh * map.scale);
      ctx.restore();
    }

    ctx.globalCompositeOperation = "difference";
    ctx.fillStyle = "#ffffff";
    this.#path(ctx, inner);
    ctx.fill();
    ctx.restore();
  }

  #neonBox(ctx, poly) {
    ctx.save();
    ctx.lineJoin = "miter";
    ctx.miterLimit = 3;
    ctx.lineCap = "round";
    ctx.shadowColor = HUD.neon;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = HUD.neon;
    ctx.lineWidth = 6;
    this.#path(ctx, poly);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#eaffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  #dot(ctx, p) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.restore();
  }
}

function orderPoly(points) {
  if (points.length < 3) return points.slice();
  const cx = points.reduce((s, p) => s + p.sx, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.sy, 0) / points.length;
  return [...points].sort(
    (a, b) => Math.atan2(a.sy - cy, a.sx - cx) - Math.atan2(b.sy - cy, b.sx - cx)
  );
}

/** Shrink a CCW polygon so the fill sits inside the neon stroke. */
function insetPoly(poly, dist) {
  const n = poly.length;
  if (n < 3) return poly;
  const cx = poly.reduce((s, p) => s + p.sx, 0) / n;
  const cy = poly.reduce((s, p) => s + p.sy, 0) / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n];
    const b = poly[i];
    const c = poly[(i + 1) % n];
    let n1x = a.sy - b.sy;
    let n1y = b.sx - a.sx;
    let n2x = b.sy - c.sy;
    let n2y = c.sx - b.sx;
    const l1 = Math.hypot(n1x, n1y) || 1;
    const l2 = Math.hypot(n2x, n2y) || 1;
    n1x /= l1;
    n1y /= l1;
    n2x /= l2;
    n2y /= l2;
    let nx = n1x + n2x;
    let ny = n1y + n2y;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    if (nx * (cx - b.sx) + ny * (cy - b.sy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    out.push({ sx: b.sx + nx * dist, sy: b.sy + ny * dist });
  }
  return out;
}
