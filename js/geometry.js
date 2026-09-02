/**
 * Geometric / high-contrast region detector.
 * Used as MODE 03 fallback and as PROJECT 02 geometry overlay
 * (paper / card / rectangle corners). Detection stays local.
 */

import { GEOMETRY } from "./config.js";

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

export function detectGeometry(video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return [];

  const w = GEOMETRY.sampleW;
  const h = Math.max(48, Math.round((vh / vw) * w));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  ctx.drawImage(video, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const gray = toGray(img.data, w, h);
  const edges = sobel(gray, w, h);

  const cell = 8;
  const cols = Math.floor(w / cell);
  const rows = Math.floor(h / cell);
  const active = new Uint8Array(cols * rows);

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      let sum = 0;
      let n = 0;
      for (let y = gy * cell; y < gy * cell + cell; y++) {
        for (let x = gx * cell; x < gx * cell + cell; x++) {
          sum += edges[y * w + x];
          n++;
        }
      }
      if (n && sum / n > GEOMETRY.edgeThreshold) active[gy * cols + gx] = 1;
    }
  }

  const labels = new Int16Array(cols * rows).fill(-1);
  const regions = [];
  let label = 0;

  for (let i = 0; i < active.length; i++) {
    if (!active[i] || labels[i] !== -1) continue;
    const stack = [i];
    labels[i] = label;
    let minX = cols, minY = rows, maxX = 0, maxY = 0, count = 0;
    while (stack.length) {
      const idx = stack.pop();
      const x = idx % cols;
      const y = (idx / cols) | 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count++;
      const neighbors = [idx - 1, idx + 1, idx - cols, idx + cols];
      for (const n of neighbors) {
        if (n < 0 || n >= active.length) continue;
        if (!active[n] || labels[n] !== -1) continue;
        const nx = n % cols;
        const ny = (n / cols) | 0;
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        labels[n] = label;
        stack.push(n);
      }
    }
    regions.push({ minX, minY, maxX, maxY, count, label });
    label++;
  }

  const sx = vw / w;
  const sy = vh / h;
  const frameArea = vw * vh;
  const out = [];

  for (const r of regions) {
    if (r.count < 6) continue;
    const x0 = r.minX * cell;
    const y0 = r.minY * cell;
    const x1 = (r.maxX + 1) * cell;
    const y1 = (r.maxY + 1) * cell;
    const bw = (x1 - x0) * sx;
    const bh = (y1 - y0) * sy;
    const area = bw * bh;
    const ratio = area / frameArea;
    if (ratio < GEOMETRY.minAreaRatio || ratio > GEOMETRY.maxAreaRatio) continue;
    const aspect = bw / Math.max(1, bh);
    if (aspect < 0.18 || aspect > 5.5) continue;

    const cornersSample = extractQuad(edges, w, h, x0, y0, Math.min(x1, w - 1), Math.min(y1, h - 1));
    const corners = cornersSample.map((p) => ({ x: p.x * sx, y: p.y * sy }));
    const ordered = orderQuad(corners);
    const geo = measureQuad(ordered);
    const rectangular = isRectangular(ordered);

    out.push({
      idHint: "GEO",
      type: "OBJECT",
      label: rectangular ? (aspect > 2.2 ? "STRIP" : "PAPER") : "SHAPE",
      x: Math.min(...ordered.map((c) => c.x)),
      y: Math.min(...ordered.map((c) => c.y)),
      w: bw,
      h: bh,
      confidence: Math.min(0.93, 0.48 + r.count / 80),
      angle: geo.rotation,
      hasAngle: true,
      corners: ordered,
      geo,
      source: "geometry",
    });
  }

  out.sort((a, b) => b.w * b.h - a.w * a.h);
  return out.slice(0, 3);
}

/** Four extreme edge pixels inside a region → approximate quad. */
function extractQuad(edges, w, h, x0, y0, x1, y1) {
  let tl = { x: x0, y: y0, s: Infinity };
  let tr = { x: x1, y: y0, s: -Infinity };
  let bl = { x: x0, y: y1, s: Infinity };
  let br = { x: x1, y: y1, s: -Infinity };
  let hits = 0;
  const thr = Math.max(24, GEOMETRY.edgeThreshold * 0.7);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (edges[y * w + x] < thr) continue;
      hits++;
      const sum = x + y;
      const diff = x - y;
      if (sum < tl.s) tl = { x, y, s: sum };
      if (sum > br.s) br = { x, y, s: sum };
      if (diff > tr.s) tr = { x, y, s: diff };
      if (diff < bl.s) bl = { x, y, s: diff };
    }
  }

  if (hits < 18) {
    return [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
  }
  return [
    { x: tl.x, y: tl.y },
    { x: tr.x, y: tr.y },
    { x: br.x, y: br.y },
    { x: bl.x, y: bl.y },
  ];
}

function orderQuad(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const sorted = [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );
  let start = 0;
  let best = Infinity;
  sorted.forEach((p, i) => {
    const s = p.x + p.y;
    if (s < best) {
      best = s;
      start = i;
    }
  });
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}

function measureQuad(c) {
  const [tl, tr, br, bl] = c;
  const width = dist(tl, tr);
  const height = dist(tl, bl);
  const cx = (tl.x + tr.x + br.x + bl.x) / 4;
  const cy = (tl.y + tr.y + br.y + bl.y) / 4;
  const rotation = (Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180) / Math.PI;
  const persp =
    Math.abs(dist(tl, tr) - dist(bl, br)) / Math.max(1, (dist(tl, tr) + dist(bl, br)) / 2);
  return { width, height, cx, cy, rotation, perspective: persp };
}

function isRectangular(c) {
  const [tl, tr, br, bl] = c;
  const a1 = angleBetween(tl, tr, br);
  const a2 = angleBetween(tr, br, bl);
  const a3 = angleBetween(br, bl, tl);
  const a4 = angleBetween(bl, tl, tr);
  const near90 = (a) => Math.abs(Math.abs(a) - 90) < 28;
  return [a1, a2, a3, a4].filter(near90).length >= 2;
}

function angleBetween(a, b, c) {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const d = Math.atan2(v2y, v2x) - Math.atan2(v1y, v1x);
  let deg = (d * 180) / Math.PI;
  while (deg < 0) deg += 360;
  if (deg > 180) deg = 360 - deg;
  return deg;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toGray(data, w, h) {
  const g = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    g[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  return g;
}

function sobel(gray, w, h) {
  const mag = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] +
        gray[i - w + 1] -
        2 * gray[i - 1] +
        2 * gray[i + 1] -
        gray[i + w - 1] +
        gray[i + w + 1];
      const gy =
        -gray[i - w - 1] -
        2 * gray[i - w] -
        gray[i - w + 1] +
        gray[i + w - 1] +
        2 * gray[i + w] +
        gray[i + w + 1];
      const m = Math.sqrt(gx * gx + gy * gy);
      mag[i] = m > 255 ? 255 : m | 0;
    }
  }
  return mag;
}

export function mergeDetections(primary, extra) {
  const merged = [...(primary || [])];
  for (const g of extra || []) {
    const overlaps = merged.some((o) => boxIou(o, g) > 0.45);
    if (!overlaps) merged.push(g);
  }
  return merged;
}

function boxIou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}
