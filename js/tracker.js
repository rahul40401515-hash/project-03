/**
 * Smooths fingertip detections. IDs are stable: LEFT-THUMB, LEFT-INDEX, ...
 */

import { FINGERS } from "./config.js";

export class Tracker {
  constructor() {
    this.points = new Map();
  }

  reset() {
    this.points.clear();
  }

  update(detections, now) {
    if (detections === null) return this.snapshot(now);

    const seen = new Set();
    for (const d of detections) {
      seen.add(d.id);
      let p = this.points.get(d.id);
      if (!p) {
        p = {
          id: d.id,
          hand: d.hand,
          finger: d.finger,
          x: d.x,
          y: d.y,
          tx: d.x,
          ty: d.y,
          confidence: d.confidence,
          lastSeen: now,
        };
        this.points.set(d.id, p);
      } else {
        p.tx = d.x;
        p.ty = d.y;
        p.hand = d.hand;
        p.finger = d.finger;
        p.confidence = d.confidence;
        p.lastSeen = now;
      }
    }

    const lerp = FINGERS.lerp;
    for (const [id, p] of this.points) {
      p.x += (p.tx - p.x) * lerp;
      p.y += (p.ty - p.y) * lerp;
      if (now - p.lastSeen > FINGERS.lostMs && !seen.has(id)) {
        this.points.delete(id);
      }
    }

    return this.snapshot(now);
  }

  snapshot() {
    const points = [...this.points.values()];
    return {
      points,
      status: points.length ? "ACTIVE" : "SEARCHING",
    };
  }
}
