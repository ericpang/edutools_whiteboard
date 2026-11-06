// Stroke and item maths. Pure, so it can be unit tested in Node.
//
// Points live in flat arrays [x0, y0, x1, y1, ...] in board units (see BOARD_W/BOARD_H). In the
// database a stroke is one compact string, "x,y x,y ...", because Realtime Database turns arrays
// into numbered child nodes, which is slow and bulky for hundreds of points.

import { BOARD_H, BOARD_W, COLOR_PATTERN, TEXT_MAX, clamp } from './util.js';

// Pairs per stored stroke. At most 10 characters a pair ("1920,1080 "), so this stays under the 20000
// characters the rules allow.
export const MAX_PAIRS = 1500;

// Board units between kept points; closer ones add bytes without changing the line.
export const MIN_STEP = 2;

export const LINE_HEIGHT = 1.3;

const FALLBACK_COLOR = '#1b1f27';

export function encodePoints(flat) {
  const pairs = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pairs.push(`${Math.round(flat[i])},${Math.round(flat[i + 1])}`);
  return pairs.join(' ');
}

// Tolerant on purpose: this runs on data written by other browsers.
export function decodePoints(text) {
  if (typeof text !== 'string') return [];
  const flat = [];
  for (const pair of text.split(' ')) {
    const [xs, ys] = pair.split(',');
    const x = Number(xs);
    const y = Number(ys);
    if (xs && ys && Number.isFinite(x) && Number.isFinite(y)) flat.push(x, y);
  }
  return flat;
}

// Drops points closer than `minDist` to the last kept one. First and last points always stay.
export function thinPoints(flat, minDist = MIN_STEP) {
  if (flat.length <= 2) return flat.slice();
  const kept = [flat[0], flat[1]];
  const min2 = minDist * minDist;
  let lx = flat[0];
  let ly = flat[1];
  for (let i = 2; i < flat.length; i += 2) {
    const dx = flat[i] - lx;
    const dy = flat[i + 1] - ly;
    if (dx * dx + dy * dy >= min2) {
      kept.push(flat[i], flat[i + 1]);
      lx = flat[i];
      ly = flat[i + 1];
    }
  }
  const n = flat.length;
  if (kept[kept.length - 2] !== flat[n - 2] || kept[kept.length - 1] !== flat[n - 1]) kept.push(flat[n - 2], flat[n - 1]);
  return kept;
}

// Splits a very long stroke into storable pieces. Each piece starts on the last point of the previous
// one so the pieces join up.
export function chunkPoints(flat, maxPairs = MAX_PAIRS) {
  const pairs = Math.floor(flat.length / 2);
  if (pairs <= maxPairs) return [flat];
  const chunks = [];
  let start = 0;
  while (start < pairs - 1) {
    const end = Math.min(start + maxPairs, pairs);
    chunks.push(flat.slice(start * 2, end * 2));
    if (end >= pairs) break;
    start = end - 1;
  }
  return chunks;
}

function boundsOf(flat, pad) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    minX = Math.min(minX, flat[i]);
    maxX = Math.max(maxX, flat[i]);
    minY = Math.min(minY, flat[i + 1]);
    maxY = Math.max(maxY, flat[i + 1]);
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

// Rough size of a text item. Close enough for erasing; the screen draws the real glyphs.
function textBounds(text, x, y, size) {
  const lines = text.split('\n');
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return { minX: x, minY: y, maxX: x + longest * size * 0.62, maxY: y + lines.length * size * LINE_HEIGHT };
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Does a circle of radius `r` at (x, y) touch a stroke drawn with the given line width?
export function strokeHits(flat, width, x, y, r) {
  const reach = r + width / 2;
  if (flat.length === 2) return Math.hypot(x - flat[0], y - flat[1]) <= reach;
  for (let i = 0; i + 3 < flat.length; i += 2) {
    if (distToSegment(x, y, flat[i], flat[i + 1], flat[i + 2], flat[i + 3]) <= reach) return true;
  }
  return false;
}

export function itemHits(item, x, y, r) {
  const b = item.bounds;
  if (x < b.minX - r || x > b.maxX + r || y < b.minY - r || y > b.maxY + r) return false;
  return item.type === 'text' ? true : strokeHits(item.pts, item.size, x, y, r);
}

// Turns a database value into a drawable item, or null if it is not one. Never trust what another
// browser wrote: bad colors, sizes and coordinates are corrected here.
export function parseItem(id, raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.uid !== 'string') return null;
  const color = COLOR_PATTERN.test(raw.color) ? raw.color : FALLBACK_COLOR;
  const size = clamp(Number(raw.size) || 4, 1, 120);

  if (raw.type === 'stroke') {
    const pts = decodePoints(raw.pts).map((v, i) => clamp(v, 0, i % 2 ? BOARD_H : BOARD_W));
    if (pts.length < 2) return null;
    return { id, type: 'stroke', uid: raw.uid, color, size, pts, bounds: boundsOf(pts, size / 2) };
  }

  if (raw.type === 'text' && typeof raw.text === 'string' && raw.text) {
    const text = raw.text.slice(0, TEXT_MAX);
    const x = clamp(Number(raw.x) || 0, 0, BOARD_W);
    const y = clamp(Number(raw.y) || 0, 0, BOARD_H);
    return { id, type: 'text', uid: raw.uid, color, size, text, x, y, bounds: textBounds(text, x, y, size) };
  }

  return null;
}
