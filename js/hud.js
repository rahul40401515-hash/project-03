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

  draw({ video, mirrored, snapshot, xray = false, pose = null }) {
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
      if (xray) this.#xrayInside(ctx, video, mirrored, map, poly, pose);
      else this.#negativeInside(ctx, video, mirrored, map, poly);
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
  #negativeInside(ctx, video, mirrored, map, poly) {
    const inner = insetPoly(poly, 4);
    if (inner.length < 3) return;

    ctx.save();
    this.#path(ctx, inner);
    ctx.clip();

    ctx.save();
    if (mirrored) {
      ctx.translate(this.cssW, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, map.dx, map.dy, map.vw * map.scale, map.vh * map.scale);
    ctx.restore();

    ctx.globalCompositeOperation = "difference";
    ctx.fillStyle = "#ffffff";
    this.#path(ctx, inner);
    ctx.fill();
    ctx.restore();
  }

  #xrayInside(ctx, video, mirrored, map, poly, pose) {
    const inner = insetPoly(poly, 4);
    if (inner.length < 3) return;

    ctx.save();
    this.#path(ctx, inner);
    ctx.clip();

    ctx.save();
    if (mirrored) {
      ctx.translate(this.cssW, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, map.dx, map.dy, map.vw * map.scale, map.vh * map.scale);
    ctx.restore();

    ctx.fillStyle = "rgba(2, 10, 18, 0.72)";
    this.#path(ctx, inner);
    ctx.fill();

    const bones = pose ? pose.map((p) => {
      const s = map.to(p.x, p.y);
      return { x: s.x, y: s.y, v: p.v };
    }) : null;

    if (bones) this.#drawSkeleton(ctx, bones);
    ctx.restore();
  }

  #drawSkeleton(ctx, lm) {
    const vis = (i) => lm[i] && (lm[i].v ?? 1) > 0.35;
    const P = (i) => lm[i];

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(180, 230, 255, 0.85)";
    ctx.shadowBlur = 10;
    ctx.strokeStyle = "rgba(220, 236, 255, 0.95)";
    ctx.fillStyle = "rgba(220, 236, 255, 0.92)";

    const bone = (a, b, w) => {
      if (!vis(a) || !vis(b)) return;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(P(a).x, P(a).y);
      ctx.lineTo(P(b).x, P(b).y);
      ctx.stroke();
    };
    const joint = (i, r) => {
      if (!vis(i)) return;
      ctx.beginPath();
      ctx.arc(P(i).x, P(i).y, r, 0, Math.PI * 2);
      ctx.fill();
    };

    if (vis(11) && vis(12) && vis(23) && vis(24)) {
      const neck = {
        x: (P(11).x + P(12).x) / 2,
        y: (P(11).y + P(12).y) / 2,
      };
      const hip = {
        x: (P(23).x + P(24).x) / 2,
        y: (P(23).y + P(24).y) / 2,
      };
      const sw = Math.hypot(P(12).x - P(11).x, P(12).y - P(11).y);
      ctx.lineWidth = Math.max(5, sw * 0.08);
      ctx.beginPath();
      ctx.moveTo(neck.x, neck.y);
      ctx.lineTo(hip.x, hip.y);
      ctx.stroke();

      ctx.lineWidth = Math.max(2.2, sw * 0.035);
      for (let i = 0; i < 6; i++) {
        const t = 0.12 + i * 0.12;
        const cx = neck.x + (hip.x - neck.x) * t;
        const cy = neck.y + (hip.y - neck.y) * t;
        const rw = sw * (0.42 - i * 0.035);
        const rh = sw * 0.07;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.lineWidth = Math.max(3, sw * 0.05);
      ctx.beginPath();
      ctx.ellipse(hip.x, hip.y - sw * 0.04, sw * 0.22, sw * 0.1, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (vis(0) && vis(7) && vis(8)) {
      const r = Math.max(14, Math.hypot(P(7).x - P(8).x, P(7).y - P(8).y) * 0.72);
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.ellipse(P(0).x, P(0).y - r * 0.15, r * 0.85, r, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (vis(0)) {
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(P(0).x, P(0).y, 22, 0, Math.PI * 2);
      ctx.stroke();
    }

    bone(11, 12, 4);
    bone(11, 13, 7);
    bone(13, 15, 6);
    bone(12, 14, 7);
    bone(14, 16, 6);
    bone(11, 23, 6);
    bone(12, 24, 6);
    bone(23, 24, 5);
    bone(23, 25, 8);
    bone(25, 27, 7);
    bone(24, 26, 8);
    bone(26, 28, 7);
    bone(27, 31, 4);
    bone(28, 32, 4);
    bone(15, 19, 3);
    bone(16, 20, 3);

    [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].forEach((i) => joint(i, 4.2));
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
