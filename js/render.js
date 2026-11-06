// Canvas drawing for strokes and notes. Everything here is in board units: the caller sets the
// scale on the context before drawing.
import { LINE_HEIGHT } from './strokes.js';

// The handwriting face for notes, with system fonts behind it for scripts it does not cover.
export const FONT_STACK = '"Shantell Sans", "Atkinson Hyperlegible", system-ui, "Segoe UI", "Noto Sans", sans-serif';

export const textFont = (size) => `600 ${size}px ${FONT_STACK}`;

export function drawStroke(ctx, pts, color, width) {
  const count = pts.length / 2;
  if (count < 1) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (count === 1) {
    ctx.beginPath();
    ctx.arc(pts[0], pts[1], width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  if (count === 2) {
    ctx.lineTo(pts[2], pts[3]);
  } else {
    // Curve through the midpoints so the line looks smooth instead of faceted.
    for (let i = 1; i < count - 1; i++) {
      const cx = pts[i * 2];
      const cy = pts[i * 2 + 1];
      ctx.quadraticCurveTo(cx, cy, (cx + pts[i * 2 + 2]) / 2, (cy + pts[i * 2 + 3]) / 2);
    }
    ctx.lineTo(pts[(count - 1) * 2], pts[(count - 1) * 2 + 1]);
  }
  ctx.stroke();
}

export function drawText(ctx, item) {
  const lineHeight = item.size * LINE_HEIGHT;
  const lift = (lineHeight - item.size) / 2; // matches where a textarea puts its first line
  ctx.fillStyle = item.color;
  ctx.font = textFont(item.size);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  item.text.split('\n').forEach((line, i) => ctx.fillText(line, item.x, item.y + lift + i * lineHeight));
}

export function drawItem(ctx, item) {
  if (item.type === 'text') drawText(ctx, item);
  else drawStroke(ctx, item.pts, item.color, item.size);
}
