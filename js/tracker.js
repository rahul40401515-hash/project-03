/**
 * Temporal tracking + derived analysis (speed, direction, lock phase).
 * Consumes detections from the existing vision engine; does not detect.
 */

import { TRACK } from "./config.js";

let nextId = 1;
const padId = (n) => String(n).padStart(2, "0");

export class Tracker {
  constructor() {
    this.tracks = [];
    this.status = "STANDBY";
    this.event = null;
    this.eventUntil = 0;
    this.hadLock = false;
    this.phase = "SCANNING";
  }

  reset() {
    this.tracks = [];
    this.status = "STANDBY";
    this.event = null;
    this.hadLock = false;
    this.phase = "SCANNING";
    nextId = 1;
  }

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
    const corners = cloneCorners(det.corners);
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
      speed: 0,
      direction: "STILL",
      angle: det.hasAngle ? det.angle || 0 : 0,
      tAngle: det.hasAngle ? det.angle || 0 : 0,
      hasAngle: !!det.hasAngle,
      confidence: det.confidence || 0,
      keypoints: det.keypoints || [],
      corners,
      tCorners: corners,
      geo: det.geo || null,
      source: det.source,
      lastSeen: now,
      born: now,
      missing: false,
      lockT: 1.28,
      alpha: 1,
      lockPhase: "DETECTED",
    };
  }

  #integrate(track, det, now) {
    const dtMs = Math.max(8, now - track.lastSeen);
    const ncx = det.x + det.w / 2;
    const ncy = det.y + det.h / 2;
    const ocx = track.tx + track.tw / 2;
    const ocy = track.ty + track.th / 2;
    const instSpeed = (Math.hypot(ncx - ocx, ncy - ocy) / dtMs) * 1000;
    track.speed = track.speed * 0.72 + instSpeed * 0.28;
    track.vx = (ncx - ocx) / (dtMs / 1000);
    track.vy = (ncy - ocy) / (dtMs / 1000);
    track.direction = heading(track.vx, track.vy, track.speed);

    track.tx = det.x;
    track.ty = det.y;
    track.tw = det.w;
    track.th = det.h;
    track.hasAngle = !!det.hasAngle;
    if (det.hasAngle) track.tAngle = det.angle || 0;
    track.confidence = det.confidence;
    track.label = det.label;
    track.type = det.type;
    track.keypoints = det.keypoints || track.keypoints;
    track.source = det.source;
    track.geo = det.geo || track.geo;
    if (det.corners) track.tCorners = cloneCorners(det.corners);
    track.lastSeen = now;
    track.missing = false;
  }

  #age(now) {
    for (const t of this.tracks) {
      const locked = t.lockPhase === "LOCKED";
      const pos = locked ? TRACK.lerpLocked : TRACK.lerpPos;
      const size = locked ? TRACK.lerpLocked : TRACK.lerpSize;
      t.x += (t.tx - t.x) * pos;
      t.y += (t.ty - t.y) * pos;
      t.w += (t.tw - t.w) * size;
      t.h += (t.th - t.h) * size;
      if (t.hasAngle) t.angle += (t.tAngle - t.angle) * 0.16;
      t.lockT += ((locked ? 1 : 1.04) - t.lockT) * 0.1;
      t.alpha += ((t.missing ? 0.35 : 1) - t.alpha) * 0.2;

      if (t.tCorners && t.tCorners.length === 4) {
        if (!t.corners) t.corners = cloneCorners(t.tCorners);
        else {
          for (let i = 0; i < 4; i++) {
            t.corners[i].x += (t.tCorners[i].x - t.corners[i].x) * pos;
            t.corners[i].y += (t.tCorners[i].y - t.corners[i].y) * pos;
          }
        }
      }

      const age = now - t.born;
      const seen = now - t.lastSeen < TRACK.lostMs;
      if (!seen) t.lockPhase = "LOST";
      else if (age < TRACK.detectMs) t.lockPhase = "DETECTED";
      else if (age < TRACK.acquireMs) t.lockPhase = "ACQUIRED";
      else t.lockPhase = "LOCKED";
    }

    const live = this.tracks.filter((t) => now - t.lastSeen < TRACK.lostMs);
    const prev = this.phase;

    if (live.length) {
      const oldest = live.reduce((a, b) => (a.born < b.born ? a : b));
      const age = now - oldest.born;
      if (this.status === "LOST" || (this.hadLock && prev === "SCANNING")) {
        this.event = "TRACKING RESTORED";
        this.eventUntil = now + TRACK.restoreToastMs;
        this.phase = "RESTORED";
      } else if (age < TRACK.detectMs) {
        this.phase = "DETECTED";
        if (prev === "SCANNING") {
          this.event = "TARGET DETECTED";
          this.eventUntil = now + 700;
        }
      } else if (age < TRACK.acquireMs) {
        this.phase = "ACQUIRED";
        if (prev === "DETECTED") {
          this.event = "TARGET ACQUIRED";
          this.eventUntil = now + 700;
        }
      } else {
        this.phase = "LOCKED";
        if (prev === "ACQUIRED") {
          this.event = "TRACKING LOCKED";
          this.eventUntil = now + 800;
        }
      }
      this.status = "ACTIVE";
      this.hadLock = true;
    } else if (this.hadLock) {
      if (this.status !== "LOST") {
        this.event = "TRACKING LOST";
        this.eventUntil = now + TRACK.lostToastMs;
      }
      this.status = "LOST";
      this.phase = "LOST";
    } else {
      this.status = "SEARCHING";
      this.phase = "SCANNING";
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
        movement: t.speed,
      }))
      .sort((a, b) => b.w * b.h - a.w * a.h);

    return {
      tracks: live,
      primary: live[0] || null,
      status: this.status,
      phase: this.phase,
      event: this.event,
    };
  }
}

function heading(vx, vy, speed) {
  if (speed < TRACK.stillPxS) return "STILL";
  if (Math.abs(vx) > Math.abs(vy) * 1.15) return vx > 0 ? "RIGHT" : "LEFT";
  if (Math.abs(vy) > Math.abs(vx) * 1.15) return vy > 0 ? "DOWN" : "UP";
  if (vx > 0 && vy > 0) return "DOWN-RIGHT";
  if (vx > 0 && vy < 0) return "UP-RIGHT";
  if (vx < 0 && vy > 0) return "DOWN-LEFT";
  return "UP-LEFT";
}

function cloneCorners(c) {
  if (!c || c.length !== 4) return null;
  return c.map((p) => ({ x: p.x, y: p.y }));
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
