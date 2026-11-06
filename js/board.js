// The shared canvas. It draws everything on the board, turns pointer input into strokes, notes and
// erasing, and keeps each browser in step through Firebase. Both the admin and student pages use it.
//
// Two canvases are stacked: `base` holds what is saved, `live` holds strokes still being drawn (yours
// and other people's) plus the eraser ring. Cursors and the note editor are ordinary elements on top.
import { addItem, announce, clearBoard, leave, moveCursor, removeItem, setLive, watchChildren, watchConnection } from './db.js';
import { FONT_STACK, drawItem, drawStroke, textFont } from './render.js';
import { LINE_HEIGHT, MAX_PAIRS, MIN_STEP, chunkPoints, encodePoints, itemHits, parseItem, thinPoints } from './strokes.js';
import { el } from './ui.js';
import {
  BOARD_H,
  BOARD_W,
  COLOR_PATTERN,
  ERASER_RADII,
  MARKERS,
  PEN_WIDTHS,
  TEXT_MAX,
  TEXT_MAX_LINES,
  TEXT_SIZES,
  clamp,
  colorForUid,
  inkOn,
  sanitizeText,
  throttle,
} from './util.js';

const LIVE_EVERY_MS = 100; // how often a stroke in progress is shared
const CURSOR_EVERY_MS = 200; // how often your pointer position is shared
const TAP_SLOP = 8; // screen pixels a tap may wander before it counts as a drag

export function createBoard({ stage, code, uid, name, isOwner = false, onError = () => {}, onPeople = () => {} }) {
  const myColor = colorForUid(uid);

  // ---- Layout -------------------------------------------------------------------------------

  const baseCanvas = el('canvas', { class: 'layer' });
  const liveCanvas = el('canvas', {
    class: 'layer layer-live',
    role: 'img',
    'aria-label': 'Shared whiteboard. What everyone draws and writes appears here.',
  });
  const cursorLayer = el('div', { class: 'cursors', 'aria-hidden': 'true' });
  const hint = el('p', { class: 'hint', hidden: true });
  const editor = el('textarea', {
    class: 'note-editor',
    rows: '1',
    hidden: true,
    spellcheck: 'false',
    maxlength: String(TEXT_MAX),
    'aria-label': 'Type your note, then press Enter to add it',
  });
  const surface = el('div', { class: 'surface', 'data-tool': 'pen' }, baseCanvas, liveCanvas, cursorLayer, hint, editor);
  const frame = el('div', { class: 'frame' }, surface);
  stage.replaceChildren(frame);

  const baseCtx = baseCanvas.getContext('2d');
  const liveCtx = liveCanvas.getContext('2d');
  const measureCtx = document.createElement('canvas').getContext('2d');

  let cssW = 0;
  let cssH = 0;

  // Sizes the board to the largest 16:9 rectangle that fits, and the canvases to match the screen's pixels.
  function fit() {
    const outer = getComputedStyle(stage);
    const inner = getComputedStyle(frame);
    const availW = stage.clientWidth - parseFloat(outer.paddingLeft) - parseFloat(outer.paddingRight) - parseFloat(inner.paddingLeft) - parseFloat(inner.paddingRight);
    const availH = stage.clientHeight - parseFloat(outer.paddingTop) - parseFloat(outer.paddingBottom) - parseFloat(inner.paddingTop) - parseFloat(inner.paddingBottom);
    if (availW < 80 || availH < 45) return;

    const width = Math.floor(Math.min(availW, (availH * BOARD_W) / BOARD_H));
    const height = Math.floor((width * BOARD_H) / BOARD_W);
    if (width === cssW && height === cssH) return;
    cssW = width;
    cssH = height;

    surface.style.width = `${width}px`;
    surface.style.height = `${height}px`;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    for (const canvas of [baseCanvas, liveCanvas]) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    needsFull = true;
    liveDirty = true;
    forgetRect();
    placeEditor();
    for (const person of people.values()) paintCursor(person);
    schedule();
  }

  // ---- State --------------------------------------------------------------------------------

  const tool = { name: 'pen', color: MARKERS[0].color, size: 1 };
  let ability = { canDraw: false, reason: 'not-joined' };
  let ownerUid = null;
  const listeners = new Set();
  const state = () => ({ tool: tool.name, color: tool.color, size: tool.size, canDraw: ability.canDraw, reason: ability.reason });
  const emit = () => listeners.forEach((listener) => listener(state()));

  const items = new Map(); // id -> drawable item
  const deleting = new Set(); // ids we've asked to remove and are waiting on
  let sortedIds = null;
  let newest = ''; // greatest id drawn so far; anything newer can be drawn on top without repainting
  let appendQueue = [];
  let needsFull = true;
  let liveDirty = true;
  let frameId = 0;
  let ready = false;

  const others = new Map(); // uid -> stroke someone else is drawing
  const people = new Map(); // uid -> presence
  const cursorNodes = new Map();

  let stroke = null; // your stroke in progress
  let erasing = null;
  let tap = null; // a possible tap with the text tool
  let hover = null; // where the pointer is, for the eraser ring
  let editing = null; // the note being typed

  const ids = () => (sortedIds ??= [...items.keys()].sort());
  const canErase = (item) => isOwner || item.uid === uid;
  const fail = (error) => onError(error);

  // ---- Painting -----------------------------------------------------------------------------

  const schedule = () => {
    if (!frameId) frameId = requestAnimationFrame(paint);
  };

  function paint() {
    frameId = 0;
    if (needsFull || appendQueue.length) paintBase();
    if (liveDirty) paintLive();
  }

  function paintBase() {
    const scale = baseCanvas.width / BOARD_W;
    baseCtx.setTransform(1, 0, 0, 1, 0, 0);
    if (needsFull) {
      baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
      baseCtx.setTransform(scale, 0, 0, scale, 0, 0);
      for (const id of ids()) drawItem(baseCtx, items.get(id));
    } else {
      baseCtx.setTransform(scale, 0, 0, scale, 0, 0);
      for (const item of appendQueue) drawItem(baseCtx, item);
    }
    appendQueue = [];
    needsFull = false;
  }

  function paintLive() {
    liveDirty = false;
    const scale = liveCanvas.width / BOARD_W;
    liveCtx.setTransform(1, 0, 0, 1, 0, 0);
    liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
    liveCtx.setTransform(scale, 0, 0, scale, 0, 0);
    for (const theirs of others.values()) drawStroke(liveCtx, theirs.pts, theirs.color, theirs.size);
    if (stroke) drawStroke(liveCtx, stroke.pts, stroke.color, stroke.size);

    if (tool.name === 'eraser' && hover && ability.canDraw) {
      liveCtx.beginPath();
      liveCtx.arc(hover[0], hover[1], ERASER_RADII[tool.size], 0, Math.PI * 2);
      liveCtx.fillStyle = 'rgba(23, 32, 43, 0.06)';
      liveCtx.fill();
      liveCtx.lineWidth = (2 * BOARD_W) / Math.max(cssW, 1);
      liveCtx.strokeStyle = 'rgba(23, 32, 43, 0.6)';
      liveCtx.setLineDash([10, 8]);
      liveCtx.stroke();
      liveCtx.setLineDash([]);
    }
  }

  // Looks the same on screen, so a server echo doesn't need a repaint.
  function sameLook(a, b) {
    return a.type === b.type && a.color === b.color && a.size === b.size && a.text === b.text && a.x === b.x && a.y === b.y && a.pts?.join() === b.pts?.join();
  }

  function updateHint() {
    const empty = ready && items.size === 0 && !stroke && !editing;
    hint.hidden = !empty;
    if (empty) hint.textContent = ability.canDraw ? 'Pick a marker and start drawing.' : 'Nothing here yet. Drawings appear as soon as someone makes them.';
  }

  // ---- What's on the board ------------------------------------------------------------------

  const stops = [];

  stops.push(
    watchChildren(
      code,
      'items',
      {
        added(id, raw) {
          const item = parseItem(id, raw);
          if (!item) return;
          items.set(id, item);
          sortedIds = null;
          if (id > newest) {
            newest = id;
            appendQueue.push(item);
          } else {
            needsFull = true;
          }
          updateHint();
          schedule();
        },
        changed(id, raw) {
          const item = parseItem(id, raw);
          const before = items.get(id);
          if (item) items.set(id, item);
          else items.delete(id);
          sortedIds = null;
          if (!item || !before || !sameLook(before, item)) needsFull = true;
          schedule();
        },
        removed(id) {
          items.delete(id);
          deleting.delete(id);
          sortedIds = null;
          needsFull = true;
          updateHint();
          schedule();
        },
      },
      // The server ends this when access is withdrawn (removed, board deleted). The page already says why.
      (error) => console.warn('Board updates stopped:', error.message),
    ),
  );

  stops.push(
    watchChildren(
      code,
      'live',
      {
        added: showLive,
        changed: showLive,
        removed(who) {
          others.delete(who);
          liveDirty = true;
          schedule();
        },
      },
      () => {},
    ),
  );

  function showLive(who, raw) {
    if (who === uid) return;
    const theirs = parseItem(who, { ...raw, type: 'stroke', uid: who });
    if (theirs) others.set(who, theirs);
    else others.delete(who);
    liveDirty = true;
    schedule();
  }

  // ---- Who's here ---------------------------------------------------------------------------

  stops.push(
    watchChildren(
      code,
      'presence',
      {
        added: showPerson,
        changed: showPerson,
        removed(who) {
          people.delete(who);
          cursorNodes.get(who)?.remove();
          cursorNodes.delete(who);
          onPeople(new Map(people));
        },
      },
      () => {},
    ),
  );

  function showPerson(who, raw) {
    const person = {
      uid: who,
      name: typeof raw?.name === 'string' ? raw.name : 'Someone',
      color: COLOR_PATTERN.test(raw?.color) ? raw.color : '#2b4fd8',
      x: Number.isFinite(raw?.x) ? clamp(raw.x, 0, BOARD_W) : null,
      y: Number.isFinite(raw?.y) ? clamp(raw.y, 0, BOARD_H) : null,
    };
    const before = people.get(who);
    people.set(who, person);
    paintCursor(person);
    // Moving a pointer updates presence many times a second; only tell the page when the crowd changes.
    if (!before || before.name !== person.name || before.color !== person.color) onPeople(new Map(people));
  }

  function paintCursor(person) {
    if (person.uid === uid) return;
    let node = cursorNodes.get(person.uid);
    const isNew = !node;
    if (isNew) {
      node = el('div', { class: 'cursor' }, el('span', { class: 'cursor-tip' }), el('span', { class: 'cursor-name', translate: 'no' }));
      cursorNodes.set(person.uid, node);
    }
    node.style.setProperty('--c', person.color);
    node.style.setProperty('--on', inkOn(person.color));
    node.classList.toggle('is-teacher', person.uid === ownerUid);
    node.lastChild.textContent = person.name;
    const visible = person.x !== null && person.y !== null;
    node.hidden = !visible;
    node.classList.toggle('is-flipped', visible && person.x > BOARD_W * 0.7);
    node.classList.toggle('is-above', visible && person.y > BOARD_H * 0.9);
    // Only transform is animated, and it is set before the node is added so a new cursor doesn't glide in from the corner.
    if (visible) node.style.transform = `translate(${person.x * (cssW / BOARD_W)}px, ${person.y * (cssH / BOARD_H)}px)`;
    if (isNew) cursorLayer.append(node);
  }

  // The server clears our presence when the connection drops, so announce again each time it comes back.
  stops.push(
    watchConnection((connected) => {
      if (connected) announce(code, uid, { name, color: myColor }).catch(() => {});
    }),
  );

  const shareCursor = throttle((x, y) => moveCursor(code, uid, x, y).catch(() => {}), CURSOR_EVERY_MS);
  const shareStroke = throttle(() => {
    if (!stroke) return;
    const flat = stroke.pts.length / 2 > MAX_PAIRS ? stroke.pts.slice(-MAX_PAIRS * 2) : stroke.pts;
    setLive(code, uid, { pts: encodePoints(flat), color: stroke.color, size: stroke.size }).catch(() => {});
  }, LIVE_EVERY_MS);

  // ---- Pointer input ------------------------------------------------------------------------

  // Where the canvas sits on screen, measured once and kept until the layout changes, so each pointer
  // move doesn't make the browser recalculate layout.
  let rect = null;
  const forgetRect = () => {
    rect = null;
  };

  function toBoard(event) {
    rect ??= liveCanvas.getBoundingClientRect();
    return [clamp(((event.clientX - rect.left) / rect.width) * BOARD_W, 0, BOARD_W), clamp(((event.clientY - rect.top) / rect.height) * BOARD_H, 0, BOARD_H)];
  }

  function addPoint(x, y) {
    const pts = stroke.pts;
    if (Math.hypot(x - pts[pts.length - 2], y - pts[pts.length - 1]) >= MIN_STEP) pts.push(x, y);
  }

  liveCanvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!ability.canDraw) return;
    forgetRect();
    const [x, y] = toBoard(event);

    if (tool.name === 'text') {
      tap = { id: event.pointerId, x, y, clientX: event.clientX, clientY: event.clientY };
      return;
    }

    commitEditor();
    liveCanvas.setPointerCapture(event.pointerId);
    if (tool.name === 'pen') {
      stroke = { id: event.pointerId, pts: [x, y], color: tool.color, size: PEN_WIDTHS[tool.size] };
      shareStroke();
    } else {
      erasing = { id: event.pointerId };
      eraseAt(x, y);
    }
    liveDirty = true;
    updateHint();
    schedule();
    event.preventDefault();
  });

  liveCanvas.addEventListener('pointermove', (event) => {
    const [x, y] = toBoard(event);
    hover = [x, y];
    shareCursor(x, y);

    if (stroke && event.pointerId === stroke.id) {
      const moves = event.getCoalescedEvents?.() ?? [];
      for (const move of moves.length ? moves : [event]) addPoint(...toBoard(move));
      shareStroke();
    } else if (erasing && event.pointerId === erasing.id) {
      eraseAt(x, y);
    }

    if (tool.name === 'eraser' || stroke) liveDirty = true;
    schedule();
  });

  function endPointer(event) {
    if (stroke && event.pointerId === stroke.id) commitStroke();
    if (erasing && event.pointerId === erasing.id) erasing = null;
    if (tap && tap.id === event.pointerId) {
      const moved = Math.hypot(event.clientX - tap.clientX, event.clientY - tap.clientY);
      if (moved < TAP_SLOP && ability.canDraw) openEditor(tap.x, tap.y);
      tap = null;
    }
  }

  liveCanvas.addEventListener('pointerup', endPointer);
  liveCanvas.addEventListener('pointercancel', endPointer);
  liveCanvas.addEventListener('pointerleave', () => {
    hover = null;
    shareCursor.cancel();
    moveCursor(code, uid, null, null).catch(() => {});
    liveDirty = true;
    schedule();
  });
  liveCanvas.addEventListener('pointerenter', forgetRect);
  liveCanvas.addEventListener('contextmenu', (event) => event.preventDefault());

  function commitStroke() {
    const finished = stroke;
    stroke = null;
    shareStroke.cancel();
    // A long stroke is stored in pieces that join up, because the rules cap the size of each item.
    for (const piece of chunkPoints(thinPoints(finished.pts))) {
      addItem(code, { type: 'stroke', uid, color: finished.color, size: finished.size, pts: encodePoints(piece) }).saved.catch(fail);
    }
    setLive(code, uid, null).catch(() => {});
    liveDirty = true;
    schedule();
  }

  function eraseAt(x, y) {
    const radius = ERASER_RADII[tool.size];
    for (const id of ids()) {
      const item = items.get(id);
      if (!item || deleting.has(id) || !canErase(item) || !itemHits(item, x, y, radius)) continue;
      deleting.add(id);
      removeItem(code, id).catch((error) => {
        deleting.delete(id);
        fail(error);
      });
    }
  }

  // ---- Notes --------------------------------------------------------------------------------

  function openEditor(x, y) {
    editing = { x, y, size: TEXT_SIZES[tool.size], color: tool.color };
    editor.value = '';
    editor.hidden = false;
    placeEditor();
    updateHint();
    editor.focus();
  }

  function placeEditor() {
    if (!editing) return;
    const unit = cssW / BOARD_W;
    editor.style.left = `${editing.x * unit}px`;
    editor.style.top = `${editing.y * unit}px`;
    editor.style.fontSize = `${editing.size * unit}px`;
    editor.style.color = editing.color;
    editor.style.borderColor = editing.color;
    sizeEditor();
  }

  // Grows the box with the text, using the same font the canvas will draw it in.
  function sizeEditor() {
    const fontSize = parseFloat(editor.style.fontSize) || 16;
    measureCtx.font = textFont(fontSize);
    const lines = editor.value.split('\n');
    const widest = Math.max(fontSize, ...lines.map((line) => measureCtx.measureText(line || ' ').width));
    editor.style.width = `${Math.ceil(widest + fontSize * 0.7)}px`;
    editor.rows = Math.min(lines.length, TEXT_MAX_LINES);
    editor.style.height = 'auto';
    editor.style.height = `${editor.scrollHeight}px`;
  }

  function closeEditor() {
    editing = null;
    editor.hidden = true;
    editor.value = '';
    updateHint();
  }

  function commitEditor() {
    if (!editing) return;
    const note = editing;
    const text = sanitizeText(editor.value);
    closeEditor();
    if (!text) return;
    addItem(code, { type: 'text', uid, color: note.color, size: note.size, text, x: Math.round(note.x), y: Math.round(note.y) }).saved.catch(fail);
  }

  editor.addEventListener('input', sizeEditor);
  editor.addEventListener('blur', commitEditor);
  editor.addEventListener('keydown', (event) => {
    if (event.isComposing) return; // Enter is confirming a word in an input method, not finishing the note
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      commitEditor();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeEditor();
    }
    event.stopPropagation(); // typing a note must not trigger tool shortcuts
  });

  // ---- Controls -----------------------------------------------------------------------------

  function setTool(next) {
    if (!['pen', 'eraser', 'text'].includes(next) || next === tool.name) return;
    commitEditor();
    tool.name = next;
    surface.dataset.tool = next;
    liveDirty = true;
    schedule();
    emit();
  }

  function setColor(color) {
    if (!COLOR_PATTERN.test(color)) return;
    tool.color = color;
    if (tool.name === 'eraser') setTool('pen');
    emit();
  }

  function setSize(index) {
    tool.size = clamp(index, 0, 2);
    liveDirty = true;
    schedule();
    emit();
  }

  function undo() {
    if (!ability.canDraw) return;
    const mine = ids().filter((id) => items.get(id).uid === uid && !deleting.has(id));
    const last = mine.at(-1);
    if (!last) return;
    deleting.add(last);
    removeItem(code, last).catch((error) => {
      deleting.delete(last);
      fail(error);
    });
  }

  function setAbility(next) {
    ability = next;
    if (!next.canDraw) {
      stroke = null;
      erasing = null;
      tap = null;
      shareStroke.cancel();
      closeEditor();
      setLive(code, uid, null).catch(() => {});
    }
    surface.classList.toggle('is-locked', !next.canDraw);
    liveDirty = true;
    updateHint();
    schedule();
    emit();
  }

  function setOwner(ownerId) {
    ownerUid = ownerId;
    for (const person of people.values()) paintCursor(person);
  }

  function exportPng() {
    const canvas = document.createElement('canvas');
    canvas.width = BOARD_W;
    canvas.height = BOARD_H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    for (const id of ids()) drawItem(ctx, items.get(id));
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  function destroy() {
    stops.forEach((stop) => stop());
    resizeObserver.disconnect();
    window.removeEventListener('scroll', forgetRect, true);
    window.removeEventListener('resize', forgetRect);
    document.fonts?.removeEventListener('loadingdone', repaintAll);
    cancelAnimationFrame(frameId);
    clearTimeout(readyTimer);
    shareStroke.cancel();
    shareCursor.cancel();
    leave(code, uid).catch(() => {});
    stage.replaceChildren();
  }

  // ---- Start --------------------------------------------------------------------------------

  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(stage);
  window.addEventListener('scroll', forgetRect, true);
  window.addEventListener('resize', forgetRect);

  // Notes are drawn in a web font; paint again once it has arrived.
  const repaintAll = () => {
    needsFull = true;
    schedule();
  };
  document.fonts?.addEventListener('loadingdone', repaintAll);
  document.fonts?.load(textFont(40)).catch(() => {});

  const readyTimer = setTimeout(() => {
    ready = true;
    updateHint();
  }, 700);

  fit();
  schedule();

  return {
    get state() {
      return state();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTool,
    setColor,
    setSize,
    undo,
    setAbility,
    setOwner,
    exportPng,
    clear: () => clearBoard(code),
    destroy,
  };
}
