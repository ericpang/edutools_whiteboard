// The picture or PDF page behind the board. Pure helpers, so Node can test them.
//
// The prepared picture is stored in the database as one data URL at whiteboards/{CODE}/background.
// database.rules.json caps it at the same length (BACKGROUND_MAX_CHARS), so the two must change together.
import { BOARD_H, BOARD_W } from './util.js';

export const BACKGROUND_MAX_CHARS = 1_500_000;
export const BACKGROUND_NAME_MAX = 80;

// Pictures are prepared to fit inside this, a little larger than the board so they stay sharp on big screens.
export const STORED_MAX_W = 2560;
export const STORED_MAX_H = 1440;

export const MAX_FILE_BYTES = 30 * 1024 * 1024;

const DATA_URL = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

// Only PNG and JPEG data URLs of a sane length are ever shown or stored.
export const isBackgroundDataUrl = (value) => typeof value === 'string' && value.length <= BACKGROUND_MAX_CHARS && DATA_URL.test(value);

// The factor that makes a w by h picture fit inside maxW by maxH. It never enlarges unless `grow` is set.
export function scaleToFit(w, h, maxW, maxH, grow = false) {
  if (!(w > 0 && h > 0)) return 0;
  const factor = Math.min(maxW / w, maxH / h);
  return grow ? factor : Math.min(1, factor);
}

// Where a picture lands when it is shown whole and centered inside the board (what CSS calls "contain").
export function fitContain(srcW, srcH, boxW = BOARD_W, boxH = BOARD_H) {
  const factor = scaleToFit(srcW, srcH, boxW, boxH, true);
  const w = srcW * factor;
  const h = srcH * factor;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

// What a chosen file is, going by its type and then its name: 'image', 'pdf' or null.
export function kindOfFile({ name = '', type = '' } = {}) {
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp|heic|heif)$/i.test(name)) return 'image';
  return null;
}

// Turns a database value into a background, or null if it isn't one. Never trust what another browser wrote.
export function parseBackground(raw) {
  if (!raw || typeof raw !== 'object' || !isBackgroundDataUrl(raw.img)) return null;
  const w = Number(raw.w);
  const h = Number(raw.h);
  if (!(w >= 1 && w <= 4096 && h >= 1 && h <= 4096)) return null;
  return { img: raw.img, w, h, name: typeof raw.name === 'string' ? raw.name.slice(0, BACKGROUND_NAME_MAX) : '' };
}
