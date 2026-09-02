/**
 * Lightweight geometric / high-contrast region detector.
 * Used in MODE 03 as a fallback when COCO classes miss papers, cards, etc.
 * Runs on a downscaled grayscale frame — no server, no extra models.
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
    const x = r.minX * cell * sx;
    const y = r.minY * cell * sy;
    const bw = (r.maxX - r.minX + 1) * cell * sx;
    const bh = (r.maxY - r.minY + 1) * cell * sy;
    const area = bw * bh;
    const ratio = area / frameArea;
    if (ratio < GEOMETRY.minAreaRatio || ratio > GEOMETRY.maxAreaRatio) continue;
    const aspect = bw / Math.max(1, bh);
    if (aspect < 0.18 || aspect > 5.5) continue;

    out.push({
      idHint: "GEO",
      type: "OBJECT",
      label: aspect > 2.4 ? "RECTANGLE" : "SHAPE",
      x,
      y,
      w: bw,
      h: bh,
      confidence: Math.min(0.92, 0.45 + r.count / 80),
      angle: 0,
      source: "geometry",
    });
  }

  out.sort((a, b) => b.w * b.h - a.w * a.h);
  return out.slice(0, 3);
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
