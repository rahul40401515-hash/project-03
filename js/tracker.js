/**
 * Temporal tracking: IoU identity, lerp smoothing, velocity, lost/restored state.
 * HUD reads smoothed tracks every frame even when CV skipped a tick.
 */

import { TRACK } from "./config.js";

let nextId = 1;
const padId = (n) => String(n).padStart(2, "0");

export class Tracker {
  constructor() {
    this.tracks = [];
    this.status = "STANDBY"; // STANDBY | SEARCHING | ACTIVE | LOST
    this.event = null;
    this.eventUntil = 0;
    this.hadLock = false;
  }

  reset() {
    this.tracks = [];
    this.status = "STANDBY";
    this.event = null;
    this.hadLock = false;
    nextId = 1;
  }

  /**
   * @param {Array|null} detections  null means "no new CV frame"
   */
  update(detections, now) {
    if (detections === null) {
      this.#age(now);
      return this.snapshot(now);
    }

    const unmatched = detections.map((d) => ({ ...d }));
    const used = new Set();

    for (const track of this.tracks) {
      let best = -1;
      let bestIou = TRACK.iouMatch;
      for (let i = 0; i < unmatched.length; i++) {
        if (used.has(i)) continue;
        const v = iou(track, unmatched[i]);
        if (v > bestIou) {
          bestIou = v;
          best = i;
        }
      }
      if (best >= 0) {
        used.add(best);
        this.#integrate(track, unmatched[best], now);
      } else {
        track.missing = true;
      }
    }

    for (let i = 0; i < unmatched.length; i++) {
      if (used.has(i)) continue;
      if ((unmatched[i].confidence ?? 1) < TRACK.minConfidence) continue;
      this.tracks.push(this.#create(unmatched[i], now));
    }

    this.tracks = this.tracks.filter((t) => now - t.lastSeen < TRACK.lostMs * 2.4);
    this.#age(now);
    return this.snapshot(now);
  }

  #create(det, now) {
    const id = padId(nextId++);
    return {
      id,
      type: det.type,
      label: det.label,
      x: det.x,
      y: det.y,
      w: det.w,
      h: det.h,
      tx: det.x,
      ty: det.y,
      tw: det.w,
      th: det.h,
      vx: 0,
      vy: 0,
      angle: det.angle || 0,
      tAngle: det.angle || 0,
      confidence: det.confidence || 0,
      keypoints: det.keypoints || [],
      source: det.source,
      lastSeen: now,
      born: now,
      missing: false,
      lockT: 1.25,
    };
  }

  #integrate(track, det, now) {
    const dt = Math.max(1, now - track.lastSeen) / 16.67;
    track.vx = (det.x + det.w / 2 - (track.tx + track.tw / 2)) / dt;
    track.vy = (det.y + det.h / 2 - (track.ty + track.th / 2)) / dt;
    track.tx = det.x;
    track.ty = det.y;
    track.tw = det.w;
    track.th = det.h;
    track.tAngle = det.angle || 0;
    track.confidence = det.confidence;
    track.label = det.label;
    track.type = det.type;
    track.keypoints = det.keypoints || track.keypoints;
    track.source = det.source;
    track.lastSeen = now;
    track.missing = false;
  }

  #age(now) {
    const pos = TRACK.lerpPos;
    const size = TRACK.lerpSize;
    for (const t of this.tracks) {
      t.x += (t.tx - t.x) * pos;
      t.y += (t.ty - t.y) * pos;
      t.w += (t.tw - t.w) * size;
      t.h += (t.th - t.h) * size;
      t.angle += (t.tAngle - t.angle) * 0.2;
      t.lockT += (1 - t.lockT) * 0.12;
    }

    const live = this.tracks.filter((t) => now - t.lastSeen < TRACK.lostMs);

    if (live.length) {
      if (this.status === "LOST" || (this.hadLock && this.status === "SEARCHING")) {
        this.event = "TRACKING RESTORED";
        this.eventUntil = now + TRACK.restoreToastMs;
      }
      this.status = "ACTIVE";
      this.hadLock = true;
    } else if (this.hadLock) {
      if (this.status !== "LOST") {
        this.event = "TRACKING LOST";
        this.eventUntil = now + TRACK.lostToastMs;
      }
      this.status = "LOST";
    } else {
      this.status = "SEARCHING";
    }

    if (this.event && now > this.eventUntil) this.event = null;
  }

  snapshot(now) {
    const live = this.tracks
      .filter((t) => now - t.lastSeen < TRACK.lostMs * 1.6)
      .map((t) => ({
        ...t,
        cx: t.x + t.w / 2,
        cy: t.y + t.h / 2,
        movement: Math.hypot(t.vx, t.vy),
      }))
      .sort((a, b) => b.w * b.h - a.w * a.h);

    return {
      tracks: live,
      primary: live[0] || null,
      status: this.status,
      event: this.event,
    };
  }
}

function iou(a, b) {
  const ax = a.tx ?? a.x;
  const ay = a.ty ?? a.y;
  const aw = a.tw ?? a.w;
  const ah = a.th ?? a.h;
  const x1 = Math.max(ax, b.x);
  const y1 = Math.max(ay, b.y);
  const x2 = Math.min(ax + aw, b.x + b.w);
  const y2 = Math.min(ay + ah, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = aw * ah + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}
