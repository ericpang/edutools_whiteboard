// The landing page lets visitors scribble on the empty parts of the page, like a real whiteboard.
// Marks fade after a few seconds so the page never fills up. Mouse and pen only, so touch scrolling still works.
import { drawStroke } from './render.js';
import { MIN_STEP } from './strokes.js';

const INK = '#2b4fd8';
const WIDTH = 5;
const HOLD_MS = 5000;
const FADE_MS = 2500;

// Anything with its own job keeps it; only bare page is drawable.
const NOT_DRAWABLE = 'a, button, input, label, form, textarea, select, h1, h2, h3, p, footer, dialog';

export function mountDoodle(canvas) {
  const ctx = canvas.getContext('2d');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const marks = [];
  let current = null;
  let frame = 0;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * ratio);
    canvas.height = Math.round(innerHeight * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }

  function draw() {
    frame = 0;
    const now = performance.now();
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (let i = marks.length - 1; i >= 0; i--) {
      const age = now - marks[i].born;
      const alpha = marks[i] === current ? 1 : reduceMotion.matches ? (age < HOLD_MS + FADE_MS ? 1 : 0) : Math.min(1, Math.max(0, 1 - (age - HOLD_MS) / FADE_MS));
      if (alpha <= 0) {
        marks.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = alpha;
      drawStroke(ctx, marks[i].pts, INK, WIDTH);
    }
    ctx.globalAlpha = 1;
    if (marks.length) frame = requestAnimationFrame(draw);
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' || event.button !== 0 || event.target.closest(NOT_DRAWABLE)) return;
    current = { pts: [event.clientX, event.clientY], born: performance.now() };
    marks.push(current);
    schedule();
  });

  addEventListener('pointermove', (event) => {
    if (!current || !(event.buttons & 1)) return;
    const { pts } = current;
    if (Math.hypot(event.clientX - pts[pts.length - 2], event.clientY - pts[pts.length - 1]) >= MIN_STEP) pts.push(event.clientX, event.clientY);
    current.born = performance.now();
    schedule();
  });

  const finish = () => {
    if (current) current.born = performance.now();
    current = null;
  };
  addEventListener('pointerup', finish);
  addEventListener('pointercancel', finish);
  addEventListener('resize', resize);
  resize();
}
