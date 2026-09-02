/**
 * Futuristic computer-vision HUD.
 * Drawn every animation frame from smoothed tracks (video-pixel space).
 */

import { HUD } from "./config.js";

export class HUDRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.enabled = true;
    this.scanEnabled = true;
    this.scanOffset = 0;
    this.glitchUntil = 0;
    this.lastW = 0;
    this.lastH = 0;
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

  /**
   * Map video pixels → CSS canvas pixels, matching object-fit: cover.
   * Front-facing cameras are CSS-mirrored, so X is flipped to match.
   */
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

  draw({ video, mirrored, mode, snapshot, now, cameraOn }) {
    const ctx = this.ctx;
    this.clear();
    if (!this.enabled) {
      this.#viewfinder(ctx);
      return;
    }

    const map = video?.videoWidth ? this.mapping(video, mirrored) : null;

    this.#viewfinder(ctx);
    this.#centerReticle(ctx);

    if (this.scanEnabled && cameraOn) {
      this.#scanLine(ctx, now, snapshot, map);
    }

    if (map && snapshot) {
      const tracks = snapshot.tracks || [];
      tracks.forEach((t, i) => {
        this.#target(ctx, t, map, i === 0, now);
      });
      this.#status(ctx, snapshot.status, mode);
    }

    this.#subtleGlitch(ctx, now);
  }

  #viewfinder(ctx) {
    const m = 16;
    const len = 26;
    const w = this.cssW;
    const h = this.cssH;
    ctx.save();
    ctx.strokeStyle = HUD.dim;
    ctx.lineWidth = 1;
    const corners = [
      [m, m + len, m, m, m + len, m],
      [w - m - len, m, w - m, m, w - m, m + len],
      [m, h - m - len, m, h - m, m + len, h - m],
      [w - m - len, h - m, w - m, h - m, w - m, h - m - len],
    ];
    for (const c of corners) {
      ctx.beginPath();
      ctx.moveTo(c[0], c[1]);
      ctx.lineTo(c[2], c[3]);
      ctx.lineTo(c[4], c[5]);
      ctx.stroke();
    }
    ctx.restore();
  }

  #centerReticle(ctx) {
    const cx = this.cssW / 2;
    const cy = this.cssH / 2;
    ctx.save();
    ctx.strokeStyle = HUD.faint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx, cy + 10);
    ctx.stroke();
    ctx.strokeRect(cx - 3.5, cy - 3.5, 7, 7);
    ctx.restore();
  }

  #scanLine(ctx, now, snapshot, map) {
    const period = HUD.scanPeriod;
    const y = ((now % period) / period) * this.cssH;
    ctx.save();
    ctx.strokeStyle = HUD.scan;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(18, y);
    ctx.lineTo(this.cssW - 18, y);
    ctx.stroke();
    const g = ctx.createLinearGradient(0, y - 18, 0, y);
    g.addColorStop(0, "rgba(244,244,241,0)");
    g.addColorStop(1, "rgba(244,244,241,0.07)");
    ctx.fillStyle = g;
    ctx.fillRect(0, y - 18, this.cssW, 18);
    ctx.restore();

    if (map && snapshot?.primary) {
      const t = snapshot.primary;
      const a = map.to(t.x, t.y);
      const b = map.to(t.x + t.w, t.y + t.h);
      const top = Math.min(a.y, b.y);
      const bot = Math.max(a.y, b.y);
      if (y >= top && y <= bot) {
        ctx.save();
        ctx.strokeStyle = HUD.accent;
        ctx.globalAlpha = 0.55;
        ctx.strokeRect(
          Math.min(a.x, b.x),
          top,
          Math.abs(b.x - a.x),
          bot - top
        );
        ctx.restore();
      }
    }
  }

  #target(ctx, t, map, primary, now) {
    const p1 = map.to(t.x, t.y);
    const p2 = map.to(t.x + t.w, t.y + t.h);
    let x = Math.min(p1.x, p2.x);
    let y = Math.min(p1.y, p2.y);
    let w = Math.abs(p2.x - p1.x);
    let h = Math.abs(p2.y - p1.y);

    const expand = t.lockT;
    const cx = x + w / 2;
    const cy = y + h / 2;
    w *= expand;
    h *= expand;
    x = cx - w / 2;
    y = cy - h / 2;

    this.#brackets(ctx, x, y, w, h, primary);
    if (primary) this.#leaders(ctx, x, y, w, h, t);
    this.#label(ctx, x, y, w, h, t, primary);

    if (primary && t.keypoints?.length >= 13 && t.source === "pose") {
      this.#poseSketch(ctx, t.keypoints, map);
    }
  }

  #brackets(ctx, x, y, w, h, primary) {
    const len = Math.max(
      HUD.bracketMin,
      Math.min(HUD.bracketMax, Math.min(w, h) * HUD.bracketLenRatio)
    );
    const inset = 0;
    ctx.save();
    ctx.strokeStyle = primary ? HUD.line : HUD.dim;
    ctx.lineWidth = primary ? 1.25 : 1;
    ctx.lineCap = "square";
    const x0 = x - inset;
    const y0 = y - inset;
    const x1 = x + w + inset;
    const y1 = y + h + inset;

    ctx.beginPath();
    ctx.moveTo(x0, y0 + len);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 + len, y0);
    ctx.moveTo(x1 - len, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(x1, y0 + len);
    ctx.moveTo(x0, y1 - len);
    ctx.lineTo(x0, y1);
    ctx.lineTo(x0 + len, y1);
    ctx.moveTo(x1 - len, y1);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1, y1 - len);
    ctx.stroke();
    ctx.restore();
  }

  #leaders(ctx, x, y, w, h, t) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const right = x + w + 18;
    const left = x - 18;
    const useRight = cx < this.cssW * 0.62;
    const anchorX = useRight ? right : left;
    const textX = useRight ? anchorX + 10 : anchorX - 10;
    const align = useRight ? "left" : "right";

    ctx.save();
    ctx.strokeStyle = HUD.dim;
    ctx.fillStyle = HUD.line;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(anchorX, cy);
    ctx.lineTo(anchorX + (useRight ? 46 : -46), cy);
    ctx.stroke();

    const y2 = Math.min(this.cssH - 90, y + h + 28);
    ctx.beginPath();
    ctx.moveTo(x + w, y + h);
    ctx.lineTo(x + w + 12, y2);
    ctx.lineTo(x + w + 54, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = "300 10px 'IBM Plex Mono', monospace";
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(
      `X:${Math.round(t.cx)} Y:${Math.round(t.cy)}`,
      textX + (useRight ? 46 : -46),
      cy
    );

    ctx.textAlign = "left";
    ctx.fillStyle = HUD.dim;
    ctx.fillText(`ANGLE:${Math.round(t.angle)}°`, x + w + 56, y2);
    ctx.restore();
  }

  #label(ctx, x, y, w, h, t, primary) {
    ctx.save();
    ctx.font = "300 10px 'IBM Plex Mono', monospace";
    ctx.fillStyle = primary ? HUD.line : HUD.dim;
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    const conf = Math.round((t.confidence || 0) * 100);
    const id = `ID:${t.id}`;
    ctx.fillText(id, x, y - 8);

    ctx.textAlign = "right";
    ctx.fillText(`X:${Math.round(t.cx)} Y:${Math.round(t.cy)}`, x + w, y - 8);

    if (primary) {
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = HUD.dim;
      const lines = [
        `OBJECT: ${t.label}`,
        `SIZE: ${Math.round(t.w)} × ${Math.round(t.h)}`,
        `CONF: ${conf}%`,
        `W:${Math.round(t.w)}  H:${Math.round(t.h)}`,
      ];
      lines.forEach((line, i) => {
        ctx.fillText(line, x, y + h + 8 + i * 13);
      });
    }
    ctx.restore();
  }

  #poseSketch(ctx, pts, map) {
    const pairs = [
      [11, 12],
      [11, 13],
      [13, 15],
      [12, 14],
      [14, 16],
      [11, 23],
      [12, 24],
      [23, 24],
      [23, 25],
      [25, 27],
      [24, 26],
      [26, 28],
    ];
    ctx.save();
    ctx.strokeStyle = HUD.faint;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    for (const [a, b] of pairs) {
      if (!pts[a] || !pts[b]) continue;
      if ((pts[a].v ?? 1) < 0.4 || (pts[b].v ?? 1) < 0.4) continue;
      const pa = map.to(pts[a].x, pts[a].y);
      const pb = map.to(pts[b].x, pts[b].y);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = HUD.dim;
    for (const idx of [0, 15, 16]) {
      const p = pts[idx];
      if (!p || (p.v ?? 1) < 0.45) continue;
      const q = map.to(p.x, p.y);
      ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
    }
    ctx.restore();
  }

  #status(ctx, status, mode) {
    const names = { human: "HUMAN", face: "FACE", object: "OBJECT" };
    ctx.save();
    ctx.font = "300 9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = HUD.dim;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`MODE: ${names[mode] || mode}`, 18, 18);
    ctx.fillText(`TRACKING: ${status || "STANDBY"}`, 18, 32);
    if (status === "SEARCHING") {
      ctx.textAlign = "center";
      ctx.fillStyle = HUD.line;
      ctx.letterSpacing = "0.35em";
      ctx.font = "300 11px 'IBM Plex Mono', monospace";
      ctx.fillText("SCANNING", this.cssW / 2, this.cssH * 0.18);
    }
    ctx.restore();
  }

  #subtleGlitch(ctx, now) {
    if (now > this.glitchUntil) {
      if (Math.random() < 0.008) this.glitchUntil = now + 90;
      return;
    }
    const y = Math.random() * this.cssH;
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, y, this.cssW, 2);
    ctx.restore();
  }
}
