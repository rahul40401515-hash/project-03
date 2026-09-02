/**
 * PROJECT 02 visual-analysis HUD.
 * Renders smoothed tracks from the tracker — never invents coordinates.
 */

import { HUD } from "./config.js";

export class HUDRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.enabled = true;
    this.scanEnabled = true;
    this.geometryOn = true;
    this.glitchUntil = 0;
    this.scanHit = 0;
    this.frame = 0;
    this.fps = 0;
    this._fpsN = 0;
    this._fpsT = 0;
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
      vw,
      vh,
    };
  }

  clear() {
    this.ctx.clearRect(0, 0, this.cssW, this.cssH);
  }

  draw({ video, mirrored, mode, snapshot, now, cameraOn }) {
    const ctx = this.ctx;
    this.frame++;
    this._fpsN++;
    if (!this._fpsT) this._fpsT = now;
    if (now - this._fpsT >= 500) {
      this.fps = Math.round((this._fpsN * 1000) / (now - this._fpsT));
      this._fpsN = 0;
      this._fpsT = now;
    }

    this.clear();
    this.#viewfinder(ctx);
    if (!this.enabled) {
      this.#telemetry(ctx, mode, snapshot);
      return;
    }

    const map = video?.videoWidth ? this.mapping(video, mirrored) : null;
    this.#centerReticle(ctx);

    if (this.scanEnabled && cameraOn) {
      this.#scanLine(ctx, now, snapshot, map);
    } else {
      this.scanHit *= 0.9;
    }

    if (map && snapshot) {
      const tracks = snapshot.tracks || [];
      tracks.forEach((t, i) => this.#target(ctx, t, map, i === 0, now, i));
    }

    this.#telemetry(ctx, mode, snapshot);
    this.#subtleGlitch(ctx, now);
  }

  #viewfinder(ctx) {
    const m = 14;
    const len = 22;
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
    ctx.moveTo(cx - 9, cy);
    ctx.lineTo(cx + 9, cy);
    ctx.moveTo(cx, cy - 9);
    ctx.lineTo(cx, cy + 9);
    ctx.stroke();
    ctx.restore();
  }

  #scanLine(ctx, now, snapshot, map) {
    const period = HUD.scanPeriod;
    const y = ((now % period) / period) * this.cssH;
    ctx.save();
    ctx.strokeStyle = HUD.scan;
    ctx.globalAlpha = 0.5 + this.scanHit * 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, y);
    ctx.lineTo(this.cssW - 16, y);
    ctx.stroke();
    const g = ctx.createLinearGradient(0, y - 16, 0, y);
    g.addColorStop(0, "rgba(244,244,241,0)");
    g.addColorStop(1, "rgba(244,244,241,0.06)");
    ctx.fillStyle = g;
    ctx.fillRect(0, y - 16, this.cssW, 16);
    ctx.restore();

    let hit = false;
    if (map && snapshot?.tracks?.length) {
      for (const t of snapshot.tracks) {
        const a = map.to(t.x, t.y);
        const b = map.to(t.x + t.w, t.y + t.h);
        const top = Math.min(a.y, b.y);
        const bot = Math.max(a.y, b.y);
        if (y >= top && y <= bot) hit = true;
      }
    }
    this.scanHit = hit ? Math.min(1, this.scanHit + 0.18) : this.scanHit * 0.88;
  }

  #target(ctx, t, map, primary, now, index) {
    ctx.save();
    ctx.globalAlpha = t.alpha ?? 1;

    const p1 = map.to(t.x, t.y);
    const p2 = map.to(t.x + t.w, t.y + t.h);
    let x = Math.min(p1.x, p2.x);
    let y = Math.min(p1.y, p2.y);
    let w = Math.abs(p2.x - p1.x);
    let h = Math.abs(p2.y - p1.y);

    const expand = t.lockT || 1;
    const cx = x + w / 2;
    const cy = y + h / 2;
    w *= expand;
    h *= expand;
    x = cx - w / 2;
    y = cy - h / 2;

    const boost = 0.55 + this.scanHit * 0.45;
    this.#brackets(ctx, x, y, w, h, primary, boost);
    this.#centerMark(ctx, cx, cy, now, primary);

    if (this.geometryOn && t.corners?.length === 4) {
      this.#quad(ctx, t.corners, map, primary);
    }

    if (primary) {
      this.#leaders(ctx, x, y, w, h, t);
      this.#readout(ctx, x, y, w, h, t);
      if (t.keypoints?.length >= 13 && t.source === "pose") {
        this.#poseSketch(ctx, t.keypoints, map);
      }
    } else {
      this.#miniId(ctx, x, y, w, t, index);
    }

    ctx.restore();
  }

  #brackets(ctx, x, y, w, h, primary, boost) {
    const len = Math.max(
      HUD.bracketMin,
      Math.min(HUD.bracketMax, Math.min(w, h) * HUD.bracketLenRatio)
    );
    const gap = 6;
    ctx.save();
    ctx.strokeStyle = primary ? HUD.line : HUD.dim;
    ctx.globalAlpha = (primary ? 0.95 : 0.55) * boost;
    ctx.lineWidth = primary ? 1.2 : 1;
    ctx.lineCap = "square";
    const x0 = x - gap;
    const y0 = y - gap;
    const x1 = x + w + gap;
    const y1 = y + h + gap;

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

  #centerMark(ctx, cx, cy, now, primary) {
    const pulse = 1 + Math.sin(now / 220) * 0.18;
    const s = (primary ? 5 : 3.5) * pulse;
    ctx.save();
    ctx.strokeStyle = primary ? HUD.accent : HUD.dim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - s - 4, cy);
    ctx.lineTo(cx - 2, cy);
    ctx.moveTo(cx + 2, cy);
    ctx.lineTo(cx + s + 4, cy);
    ctx.moveTo(cx, cy - s - 4);
    ctx.lineTo(cx, cy - 2);
    ctx.moveTo(cx, cy + 2);
    ctx.lineTo(cx, cy + s + 4);
    ctx.stroke();
    ctx.strokeRect(cx - 2.2, cy - 2.2, 4.4, 4.4);
    ctx.restore();
  }

  #leaders(ctx, x, y, w, h, t) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const useRight = cx < this.cssW * 0.58;
    const side = useRight ? 1 : -1;
    const ax = useRight ? x + w + 14 : x - 14;
    const lx = ax + side * 72;
    const ly = cy;

    ctx.save();
    ctx.strokeStyle = HUD.dim;
    ctx.fillStyle = HUD.line;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ax, cy);
    ctx.lineTo(lx, ly);
    ctx.stroke();

    const y2 = Math.min(this.cssH - 110, y + h + 22);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.5, y + h);
    ctx.lineTo(x + w * 0.5 + 10, y2);
    ctx.lineTo(x + w * 0.5 + 78, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = "300 10px 'IBM Plex Mono', monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = useRight ? "left" : "right";
    ctx.fillText(`X: ${Math.round(t.cx)}  Y: ${Math.round(t.cy)}`, lx + side * 8, ly);

    ctx.textAlign = "left";
    ctx.fillStyle = HUD.dim;
    const lock =
      t.lockPhase === "LOCKED"
        ? "TRACKING: ACTIVE"
        : t.lockPhase === "ACQUIRED"
          ? "TARGET ACQUIRED"
          : t.lockPhase === "LOST"
            ? "TRACKING LOST"
            : "TARGET DETECTED";
    ctx.fillText(lock, x + w * 0.5 + 82, y2);

    if (t.hasAngle) {
      const y3 = y2 + 18;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(x + w, y + h);
      ctx.lineTo(x + w + 36, y3);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(`ROTATION: ${Math.round(t.angle)}°`, x + w + 40, y3);
    }
    ctx.restore();
  }

  #readout(ctx, x, y, w, h, t) {
    const conf = ((t.confidence || 0) * 100).toFixed(1);
    ctx.save();
    ctx.font = "300 9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = HUD.line;
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    ctx.fillText(`ID: ${t.id}`, x, y - 10);
    ctx.fillStyle = HUD.dim;
    ctx.fillText(t.label || t.type, x, y - 22);

    ctx.textAlign = "right";
    ctx.fillStyle = HUD.line;
    ctx.fillText(`CONF: ${conf}%`, x + w, y - 10);

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = HUD.dim;
    const lines = [
      `W: ${Math.round(t.w)}`,
      `H: ${Math.round(t.h)}`,
    ];
    if (t.speed >= 8) {
      lines.push(`SPEED: ${t.speed.toFixed(1)} PX/S`);
      lines.push(`DIR: ${t.direction}`);
    }
    lines.forEach((line, i) => ctx.fillText(line, x, y + h + 8 + i * 12));
    ctx.restore();
  }

  #miniId(ctx, x, y, w, t) {
    ctx.save();
    ctx.font = "300 9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = HUD.dim;
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    ctx.fillText(`${t.label}  ID:${t.id}`, x, y - 8);
    ctx.restore();
  }

  #quad(ctx, corners, map, primary) {
    const pts = corners.map((c) => map.to(c.x, c.y));
    ctx.save();
    ctx.strokeStyle = primary ? HUD.accent : HUD.dim;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = "300 8px 'IBM Plex Mono', monospace";
    ctx.fillStyle = HUD.line;
    ctx.textBaseline = "bottom";
    pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.stroke();
      const label = `CORNER 0${i + 1}`;
      const ox = p.x < this.cssW / 2 ? 8 : -8;
      ctx.textAlign = ox > 0 ? "left" : "right";
      ctx.fillText(label, p.x + ox, p.y - 6);
    });

    if (primary && pts.length === 4) {
      const midTop = mid(pts[0], pts[1]);
      const midLeft = mid(pts[0], pts[3]);
      ctx.strokeStyle = HUD.faint;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[3].x, pts[3].y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = HUD.dim;
      ctx.textAlign = "center";
      ctx.fillText("W", midTop.x, midTop.y - 6);
      ctx.save();
      ctx.translate(midLeft.x - 8, midLeft.y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("H", 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  #poseSketch(ctx, pts, map) {
    const pairs = [
      [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
      [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
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
    ctx.restore();
  }

  #telemetry(ctx, mode, snapshot) {
    const names = { human: "HUMAN", face: "FACE", object: "OBJECT" };
    const phase = snapshot?.phase || snapshot?.status || "STANDBY";
    const phaseLabel = {
      SCANNING: "SCANNING…",
      DETECTED: "TARGET DETECTED",
      ACQUIRED: "TARGET ACQUIRED",
      LOCKED: "TRACKING ACTIVE",
      RESTORED: "TRACKING RESTORED",
      LOST: "TRACKING LOST",
      SEARCHING: "SCANNING…",
      ACTIVE: "TRACKING ACTIVE",
      STANDBY: "STANDBY",
    }[phase] || phase;

    ctx.save();
    ctx.font = "300 9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = HUD.dim;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const top = 78;
    ctx.fillText("VISION SYSTEM", 16, top);
    ctx.fillText("TRACKING ENGINE", 16, top + 13);
    ctx.fillText(`MODE: ${names[mode] || mode}`, 16, top + 26);

    ctx.textAlign = "right";
    ctx.fillText("SYSTEM: ONLINE", this.cssW - 16, top);
    ctx.fillText(`FRAME: ${String(this.frame).padStart(5, "0")}`, this.cssW - 16, top + 13);
    ctx.fillText(`FPS: ${this.fps}`, this.cssW - 16, top + 26);

    if (!snapshot?.primary && (phase === "SCANNING" || phase === "SEARCHING" || phase === "STANDBY")) {
      ctx.textAlign = "center";
      ctx.fillStyle = HUD.line;
      ctx.font = "300 11px 'IBM Plex Mono', monospace";
      ctx.fillText("SCANNING…", this.cssW / 2, this.cssH * 0.18);
    } else if (phase === "LOST") {
      ctx.textAlign = "center";
      ctx.fillStyle = HUD.line;
      ctx.font = "300 11px 'IBM Plex Mono', monospace";
      ctx.fillText("TRACKING LOST", this.cssW / 2, this.cssH * 0.18);
    }

    ctx.textAlign = "left";
    ctx.font = "300 9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = HUD.dim;
    ctx.fillText(phaseLabel, 16, this.cssH - 28);
    ctx.restore();
  }

  #subtleGlitch(ctx, now) {
    if (now > this.glitchUntil) {
      if (Math.random() < 0.006) this.glitchUntil = now + 80;
      return;
    }
    const y = Math.random() * this.cssH;
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, y, this.cssW, 1.5);
    ctx.restore();
  }
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
