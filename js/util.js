// Small pure helpers shared by the pages. No DOM and no Firebase in here, so Node can import it for tests.

// The board is a fixed logical space that every screen scales to fit.
export const BOARD_W = 1920;
export const BOARD_H = 1080;

// Same alphabet and length the mindmaps and worlds rules enforce: no 0/O or 1/I/L look-alikes.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export const CODE_PATTERN = /^[A-HJKMNP-Z2-9]{6}$/;

// Limits mirrored by database.rules.json.
export const NAME_MAX = 24;
export const TITLE_MAX = 80;
export const TEXT_MAX = 300;
export const TEXT_MAX_LINES = 8;

export const COLOR_PATTERN = /^#[0-9a-f]{6}$/;

// Marker colors, in tray order. The first is the default ink.
export const MARKERS = [
  { name: 'Black', color: '#1b1f27' },
  { name: 'Blue', color: '#2b4fd8' },
  { name: 'Red', color: '#d92d3a' },
  { name: 'Green', color: '#1f9d57' },
  { name: 'Orange', color: '#f08a1c' },
  { name: 'Purple', color: '#7b3fd1' },
  { name: 'Pink', color: '#e9498f' },
  { name: 'Teal', color: '#0f9aa8' },
  { name: 'Brown', color: '#8a5a3b' },
  { name: 'Yellow', color: '#e6b800' },
];

// Three sizes per tool, small to large, in board units.
export const PEN_WIDTHS = [3, 7, 14];
export const TEXT_SIZES = [32, 48, 72];
export const ERASER_RADII = [16, 32, 56];

// Colors for avatars and cursors, picked per person.
export const PEOPLE_COLORS = ['#2b4fd8', '#d92d3a', '#1f9d57', '#7b3fd1', '#0f9aa8', '#8a5a3b', '#e9498f', '#f08a1c'];

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Uniform random integer in [0, max) without modulo bias.
function randomInt(max) {
  const range = 0x100000000;
  const limit = range - (range % max);
  const buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer); while (buffer[0] >= limit);
  return buffer[0] % max;
}

export function generateCode(pick = randomInt) {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[pick(CODE_ALPHABET.length)];
  return code;
}

// Accepts what people paste or type: any case, with spaces or dashes in it.
export function normalizeCode(input) {
  return String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export const isValidCode = (code) => CODE_PATTERN.test(code);

// Cuts to `max` UTF-16 units without splitting a surrogate pair, which is how the rules count length.
export function truncate(text, max) {
  let out = '';
  for (const char of String(text)) {
    if (out.length + char.length > max) break;
    out += char;
  }
  return out;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export function sanitizeName(raw) {
  return truncate(String(raw ?? '').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim(), NAME_MAX).trim();
}

export function sanitizeTitle(raw) {
  return truncate(String(raw ?? '').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim(), TITLE_MAX).trim();
}

// Board text keeps its line breaks but nothing else odd.
export function sanitizeText(raw) {
  const lines = String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .slice(0, TEXT_MAX_LINES);
  return truncate(lines.join('\n').trim(), TEXT_MAX);
}

function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function colorForUid(uid) {
  return PEOPLE_COLORS[hash(String(uid)) % PEOPLE_COLORS.length];
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Whichever of white or dark ink reads better on the given color.
export function inkOn(hex) {
  const L = luminance(hex);
  const darkInk = luminance('#17202b');
  const againstWhite = 1.05 / (L + 0.05);
  const againstDark = (L + 0.05) / (darkInk + 0.05);
  return againstWhite >= againstDark ? '#ffffff' : '#17202b';
}

export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = Array.from(words[0])[0];
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : '';
  return (first + last).toUpperCase();
}

// Runs at most once per `ms`, with a trailing call so the final value always goes out.
export function throttle(fn, ms) {
  let last = -Infinity;
  let timer = null;
  let args = null;
  const run = () => {
    timer = null;
    last = Date.now();
    const pending = args;
    args = null;
    fn(...pending);
  };
  const throttled = (...next) => {
    args = next;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) {
      clearTimeout(timer);
      run();
    } else if (!timer) {
      timer = setTimeout(run, wait);
    }
  };
  throttled.cancel = () => {
    clearTimeout(timer);
    timer = null;
    args = null;
  };
  return throttled;
}
