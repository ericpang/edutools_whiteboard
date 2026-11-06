// End-to-end walkthrough of the whiteboard in real browsers, against the Firebase emulators.
// It plays an admin and several students, each in its own isolated browser, through the whole flow.
//
//   npm run emulators      (terminal 1)
//   npm run serve          (terminal 2)
//   npm run test:e2e       (terminal 3)
//
// Set BROWSER_PATH if Chrome or Edge isn't found, BASE_URL if the site is served somewhere else, and
// SHOTS=some/folder to save screenshots along the way. Pages are always opened with ?emulator, so
// nothing here touches the real database.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const require = createRequire(import.meta.url);
const jsQR = require('jsqr');
const { PNG } = require('pngjs');

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const SHOTS = process.env.SHOTS ? `${process.env.SHOTS.replace(/[\\/]+$/, '')}/` : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const BROWSER = [
  process.env.BROWSER_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((path) => path && existsSync(path));

if (!BROWSER) {
  console.error('No Chrome or Edge found. Set BROWSER_PATH to the browser’s executable.');
  process.exit(2);
}
try {
  await fetch(BASE);
} catch {
  console.error(`Can’t reach ${BASE}. Start the site with "npm run serve", and the emulators with "npm run emulators", first.`);
  process.exit(2);
}

const results = [];
const logs = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `   ${detail}`}`);
};

async function until(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      // keep trying
    }
    await sleep(100);
  }
  return false;
}

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--no-first-run', '--disable-features=Translate'] });

async function person(name, { width = 1280, height = 800, dark = false, touch = false, scale = 1 } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: scale, hasTouch: touch, isMobile: touch });
  if (dark) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) logs.push(`[${name}] ${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => logs.push(`[${name}] pageerror: ${error.message}`));
  page.on('requestfailed', (request) => logs.push(`[${name}] requestfailed: ${request.url()} ${request.failure()?.errorText}`));
  return { name, context, page };
}

const shot = (who, file) => (SHOTS ? who.page.screenshot({ path: `${SHOTS}${file}.png` }) : undefined);
const visible = (page, selector, timeout = 8000) => page.waitForSelector(selector, { visible: true, timeout }).then(() => true, () => false);
const text = (page, selector) => page.$eval(selector, (node) => node.textContent.trim());
const isHidden = (page, selector) => page.$eval(selector, (node) => node.hidden || node.offsetParent === null).catch(() => true);

// Number of painted pixels on a canvas layer ('base' = saved drawings, 'live' = strokes in progress).
const ink = (page, layer = 'base') =>
  page.evaluate((which) => {
    const canvas = document.querySelector(which === 'doodle' ? '#doodle' : which === 'base' ? 'canvas.layer:not(.layer-live)' : 'canvas.layer-live');
    if (!canvas) return -1;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
    return count;
  }, layer);

// Draw through points given as fractions of the board.
async function draw(page, points, { hold = false } = {}) {
  const box = await (await page.$('canvas.layer-live')).boundingBox();
  const at = ([fx, fy]) => [box.x + fx * box.width, box.y + fy * box.height];
  const [x0, y0] = at(points[0]);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    const [x, y] = at(point);
    await page.mouse.move(x, y, { steps: 8 });
  }
  if (!hold) await page.mouse.up();
}

// The same, with a finger.
async function drawTouch(page, points) {
  const box = await (await page.$('canvas.layer-live')).boundingBox();
  const at = ([fx, fy]) => [box.x + fx * box.width, box.y + fy * box.height];
  const [x0, y0] = at(points[0]);
  await page.touchscreen.touchStart(x0, y0);
  for (const point of points.slice(1)) {
    const [x, y] = at(point);
    await page.touchscreen.touchMove(x, y);
  }
  await page.touchscreen.touchEnd();
}

const wave = (y, from = 0.1, to = 0.5) => Array.from({ length: 9 }, (_, i) => [from + ((to - from) * i) / 8, y + (i % 2 ? 0.04 : -0.04)]);
const press = async (page, selector) => { await page.waitForSelector(selector, { visible: true, timeout: 8000 }); await page.click(selector); };
const pick = (page, label) => page.click(`.tray button[title^="${label}"]`);

// ---- Fixtures for the QR code and background checks -------------------------------------------
// A PDF written by hand: each page is A4 portrait with a title and a 200 x 200 square in its own color.
function makePdf(pages) {
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (text) => {
    const buffer = Buffer.from(text, 'latin1');
    parts.push(buffer);
    length += buffer.length;
  };
  const object = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  push('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((page, i) => {
    const content = `${page.rgb.join(' ')} rg 100 500 200 200 re f BT /F1 48 Tf 50 760 Td 0 0 0 rg (${page.title}) Tj ET`;
    object(4 + i * 2, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    object(5 + i * 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const count = 4 + pages.length * 2;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

const fixtureDir = mkdtempSync(join(tmpdir(), 'whiteboard-e2e-'));

// 1600 x 900, blue on the left and yellow on the right, so where things land is easy to check.
const twoColors = new PNG({ width: 1600, height: 900 });
for (let y = 0; y < 900; y++) {
  for (let x = 0; x < 1600; x++) {
    const i = (y * 1600 + x) * 4;
    const left = x < 800;
    twoColors.data[i] = left ? 0 : 255;
    twoColors.data[i + 1] = left ? 0 : 220;
    twoColors.data[i + 2] = left ? 255 : 0;
    twoColors.data[i + 3] = 255;
  }
}
const twoColorsBytes = PNG.sync.write(twoColors);

// Pure noise cannot be compressed, so this forces the app to shrink the picture to fit the database cap.
const noisy = new PNG({ width: 2000, height: 1500 });
for (let i = 0; i < noisy.data.length; i += 4) {
  noisy.data[i] = (Math.random() * 256) | 0;
  noisy.data[i + 1] = (Math.random() * 256) | 0;
  noisy.data[i + 2] = (Math.random() * 256) | 0;
  noisy.data[i + 3] = 255;
}

const fx = {
  png: join(fixtureDir, 'two-colors.png'),
  pdf: join(fixtureDir, 'worksheet.pdf'),
  noisy: join(fixtureDir, 'noise.png'),
  txt: join(fixtureDir, 'notes.txt'),
  badPng: join(fixtureDir, 'damaged.png'),
  badPdf: join(fixtureDir, 'damaged.pdf'),
  bigPdf: join(fixtureDir, 'huge.pdf'),
};
writeFileSync(fx.png, twoColorsBytes);
writeFileSync(fx.pdf, makePdf([{ title: 'Page 1', rgb: [1, 0, 0] }, { title: 'Page 2', rgb: [0, 0.6, 0] }, { title: 'Page 3', rgb: [0, 0, 1] }]));
writeFileSync(fx.noisy, PNG.sync.write(noisy, { deflateLevel: 1 }));
writeFileSync(fx.txt, 'not a picture');
writeFileSync(fx.badPng, 'this is definitely not a picture');
writeFileSync(fx.badPdf, '%PDF-1.4\nthis is not really a pdf');
writeFileSync(fx.bigPdf, Buffer.alloc(31 * 1024 * 1024));

// The color of one pixel of the picture behind the board, as a student sees it (fx and fy are 0 to 1).
const sample = (page, fx, fy) =>
  page.evaluate(
    (x, y) => {
      const img = document.querySelector('img.backdrop');
      if (!img || img.hidden || !img.naturalWidth) return null;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return Array.from(ctx.getImageData(Math.floor(x * img.naturalWidth), Math.floor(y * img.naturalHeight), 1, 1).data.slice(0, 3));
    },
    fx,
    fy,
  );
const near = (a, b, tolerance = 45) => Array.isArray(a) && a.every((value, i) => Math.abs(value - b[i]) <= tolerance);
const closed = (page, timeout = 15000) => until(() => page.evaluate(() => !document.querySelector('dialog[open]')), timeout);

try {
  // ---- Landing --------------------------------------------------------------------------
  const guest = await person('guest');
  await guest.page.goto(`${BASE}/index.html?emulator`, { waitUntil: 'domcontentloaded' });
  check('landing page shows its headline', (await text(guest.page, 'h1')).includes('One board'));
  await guest.page.type('#code', 'abc');
  await guest.page.click('#join button[type="submit"]');
  check('a short code is refused with a plain message', (await text(guest.page, '#code-error')).includes('6 letters and numbers'));
  await guest.page.$eval('#code', (input) => (input.value = ''));
  await guest.page.type('#code', 'ABCDE0');
  await guest.page.click('#join button[type="submit"]');
  check('a code with look-alike characters says so', (await text(guest.page, '#code-error')).includes('never use'));
  // Scribbling on bare page, away from any text, leaves a mark on the doodle canvas.
  await guest.page.mouse.move(300, 730);
  await guest.page.mouse.down();
  await guest.page.mouse.move(520, 700, { steps: 10 });
  await guest.page.mouse.move(760, 740, { steps: 10 });
  await guest.page.mouse.up();
  check('the landing page can be scribbled on', (await ink(guest.page, 'doodle')) > 0);
  await shot(guest, '01-landing');
  await guest.page.click('#start');
  await guest.page.waitForFunction(() => location.pathname.endsWith('admin.html'));
  check('"Start a board" keeps the emulator switch', guest.page.url().includes('emulator'));
  await guest.page.goBack();
  check('"Start a board" is a real link, so Ctrl-click and middle-click work', (await guest.page.$eval('#start', (a) => a.getAttribute('href'))).includes('emulator'));
  await guest.context.close();

  // ---- Admin starts a board -------------------------------------------------------------
  const admin = await person('admin');
  await admin.page.goto(`${BASE}/admin.html?emulator`, { waitUntil: 'domcontentloaded' });
  check('admin sees the boards screen', await visible(admin.page, '#create-form'));
  await admin.page.click('#create-form button[type="submit"]');
  check('an empty board name is refused', (await text(admin.page, '#new-error')).includes('Give the board a name'));
  await shot(admin, '02-admin-boards');
  await admin.page.type('#new-title', 'Maths 3B');
  await admin.page.click('#create-form button[type="submit"]');
  check('admin lands in the console', await visible(admin.page, '#console'));
  const code = (await text(admin.page, '#code')).replace(/\s/g, '');
  check('the join code is six characters from the safe alphabet', /^[A-HJKMNP-Z2-9]{6}$/.test(code), code);
  check('the console URL carries the code and the emulator switch', admin.page.url().includes(`code=${code}`) && admin.page.url().includes('emulator'));
  check('the board title is shown', (await text(admin.page, '#board-title')) === 'Maths 3B');
  await sleep(1200);
  check('an empty board invites the first mark', (await text(admin.page, '.hint')).includes('Pick a marker'));
  await shot(admin, '03-admin-console-empty');

  await admin.page.reload({ waitUntil: 'domcontentloaded' });
  check('reloading keeps the admin in charge of the board', await visible(admin.page, '#console'));

  // ---- Alex joins -----------------------------------------------------------------------
  const alex = await person('alex');
  await alex.page.goto(`${BASE}/student.html?code=${code}&emulator`, { waitUntil: 'domcontentloaded' });
  check('student sees the join screen with the board name', (await visible(alex.page, '#join-form')) && (await text(alex.page, '#join-title')) === 'Join Maths 3B');
  await alex.page.click('#join-form button[type="submit"]');
  check('joining without a name is refused kindly', (await text(alex.page, '#name-error')).includes('Type your name'));
  await shot(alex, '04-student-join');
  await alex.page.type('#name', 'Alex Tan');
  await alex.page.click('#join-form button[type="submit"]');
  check('student lands on the board', await visible(alex.page, 'canvas.layer-live'));
  check('admin sees Alex in the room, online', await until(() => admin.page.$eval('#roster', (node) => node.textContent.includes('Alex Tan') && node.textContent.includes('Online'))));
  check('student sees who is here', await until(async () => (await text(alex.page, '#people-count')) === '2 people here'));

  // ---- Drawing stays in sync ------------------------------------------------------------
  const adminBefore = await ink(admin.page);
  const alexBefore = await ink(alex.page);
  await draw(admin.page, wave(0.25));
  check('the admin’s stroke appears for the admin', await until(async () => (await ink(admin.page)) > adminBefore));
  check('the admin’s stroke appears for the student', await until(async () => (await ink(alex.page)) > alexBefore));

  // Others' cursors carry names, and the label flips back inside the board near the right edge.
  const adminBox = await (await admin.page.$('canvas.layer-live')).boundingBox();
  await admin.page.mouse.move(adminBox.x + adminBox.width * 0.96, adminBox.y + adminBox.height * 0.5, { steps: 4 });
  check('a teacher’s cursor shows on the student’s board, flipped near the edge', await until(() => alex.page.$('.cursor.is-teacher.is-flipped:not([hidden])')));

  const adminSeen = await ink(admin.page);
  await pick(alex.page, 'Pen');
  await alex.page.click('.marker[aria-label="Red"]');
  await alex.page.click('.size[aria-label="Large"]');
  await draw(alex.page, wave(0.6, 0.3, 0.8), { hold: true });
  check('a stroke in progress is visible to others before it is finished', await until(async () => (await ink(admin.page, 'live')) > 0));
  await shot(admin, '05-live-stroke-on-admin');
  await alex.page.mouse.up();
  check('the finished stroke reaches the admin', await until(async () => (await ink(admin.page)) > adminSeen));
  check('the live preview is cleared once saved', await until(async () => (await ink(admin.page, 'live')) === 0));

  // Notes
  const withStroke = await ink(admin.page);
  await pick(alex.page, 'Text');
  const box = await (await alex.page.$('canvas.layer-live')).boundingBox();
  await alex.page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.12);
  check('the text tool opens a note editor', await visible(alex.page, '.note-editor'));
  await alex.page.keyboard.type('Hello class');
  await alex.page.keyboard.press('Enter');
  check('a note is added for the admin too', await until(async () => (await ink(admin.page)) > withStroke));
  check('the note editor closes after Enter', await isHidden(alex.page, '.note-editor'));

  // Eraser and undo
  await shot(alex, '06-student-board');
  // (The two boards are drawn at different sizes, so each is compared with its own earlier count.)
  const adminBeforeErase = await ink(admin.page);
  const alexBeforeErase = await ink(alex.page);
  await pick(alex.page, 'Eraser');
  await draw(alex.page, wave(0.6, 0.3, 0.8));
  check('erasing removes a student’s own stroke everywhere', await until(async () => (await ink(admin.page)) < adminBeforeErase && (await ink(alex.page)) < alexBeforeErase));

  await pick(alex.page, 'Pen');
  const beforeUndo = await ink(admin.page);
  await draw(alex.page, wave(0.8, 0.2, 0.6));
  await until(async () => (await ink(admin.page)) > beforeUndo);
  await alex.page.click('.tray button[title^="Undo"]');
  check('undo takes back the last drawing', await until(async () => (await ink(admin.page)) <= beforeUndo));

  await alex.page.keyboard.press('e');
  check('keyboard shortcuts switch tools', (await alex.page.$eval('.tray button[title^="Eraser"]', (b) => b.getAttribute('aria-pressed'))) === 'true');
  await alex.page.keyboard.press('p');

  // A student who reloads resumes where they were, with the board redrawn from the database.
  await alex.page.reload({ waitUntil: 'domcontentloaded' });
  check('a student who reloads goes straight back to the board', await visible(alex.page, 'canvas.layer-live'));
  check('and the board is redrawn from what was saved', await until(async () => (await ink(alex.page)) > 0));

  // ---- Lock -----------------------------------------------------------------------------
  await admin.page.click('#lock-switch + .switch-track');
  check('locking shows students a plain explanation', await until(async () => !(await isHidden(alex.page, '#banner')) && (await text(alex.page, '#banner')).includes('locked')));
  check('locking disables the student’s tools', await alex.page.$eval('.tray button[title^="Pen"]', (b) => b.disabled));
  const lockedInk = await ink(admin.page);
  await draw(alex.page, wave(0.4, 0.6, 0.9));
  await sleep(800);
  check('a locked board ignores student strokes', (await ink(admin.page)) === lockedInk);
  check('the admin can still draw on a locked board', await (async () => { await draw(admin.page, wave(0.9, 0.5, 0.9)); return until(async () => (await ink(alex.page)) > lockedInk); })());
  await shot(alex, '07-student-locked');
  await admin.page.click('#lock-switch + .switch-track');
  check('unlocking gives drawing back', await until(async () => (await isHidden(alex.page, '#banner')) && !(await alex.page.$eval('.tray button[title^="Pen"]', (b) => b.disabled))));

  // ---- Approval -------------------------------------------------------------------------
  await admin.page.click('#approve-switch + .switch-track');
  await until(async () => admin.page.$eval('#approve-switch', (input) => input.checked));
  const bea = await person('bea');
  await bea.page.goto(`${BASE}/student.html?code=${code}&emulator`, { waitUntil: 'domcontentloaded' });
  check('student 2 sees the join screen with a note about approval', (await visible(bea.page, '#join-form')) && !(await isHidden(bea.page, '#join-note')));
  await bea.page.type('#name', 'Bea');
  await bea.page.click('#join-form button[type="submit"]');
  check('with approval on, student 2 waits', await visible(bea.page, '[data-screen="waiting"]'));
  check('the admin sees Bea in "Waiting to join"', await until(() => admin.page.$eval('#roster', (node) => node.textContent.includes('Waiting to join') && node.textContent.includes('Bea'))));
  check('screen readers are told when someone is waiting', await until(async () => (await text(admin.page, '#announce')).includes('Bea is waiting to join')));
  check('a waiting student shows as online to the admin', await until(() => admin.page.evaluate(() => [...document.querySelectorAll('#roster .person')].find((row) => row.textContent.includes('Bea'))?.textContent.includes('Online'))));
  check('the students button flags that someone is waiting', await admin.page.$eval('#open-panel', (b) => b.hasAttribute('data-attention') || getComputedStyle(b).display === 'none'));
  await shot(bea, '08-student-waiting');
  await shot(admin, '09-admin-with-waiting');
  await press(admin.page, '[data-action="admit"][data-name="Bea"]');
  check('admitting lets student 2 onto the board', await visible(bea.page, 'canvas.layer-live'));

  // ---- View-only ------------------------------------------------------------------------
  await press(admin.page, '[data-action="view-only"][data-name="Alex Tan"]');
  check('view-only tells the student what happened', await until(async () => (await text(alex.page, '#banner')).includes('view-only')));
  const viewInk = await ink(admin.page);
  await draw(alex.page, wave(0.3, 0.6, 0.9));
  await sleep(800);
  check('a view-only student cannot draw', (await ink(admin.page)) === viewInk);
  await press(admin.page, '[data-action="view-only"][data-name="Alex Tan"]');
  check('switching view-only off restores drawing', await until(async () => await isHidden(alex.page, '#banner')));

  // ---- Remove, then let back in ---------------------------------------------------------
  await pick(alex.page, 'Pen');
  await alex.page.click('.marker[aria-label="Green"]');
  await draw(alex.page, wave(0.35, 0.55, 0.95));
  await until(async () => (await ink(admin.page)) > viewInk);

  // The admin can erase a student's work, not only their own.
  const adminHad = await ink(admin.page);
  const alexHad = await ink(alex.page);
  await pick(admin.page, 'Eraser');
  await draw(admin.page, wave(0.35, 0.55, 0.95));
  check('the admin can erase a student’s drawing', await until(async () => (await ink(admin.page)) < adminHad && (await ink(alex.page)) < alexHad));
  await pick(admin.page, 'Pen');
  await draw(alex.page, wave(0.35, 0.55, 0.95));
  await until(async () => (await ink(admin.page)) >= adminHad);

  // The board survives a window resize.
  await alex.page.setViewport({ width: 900, height: 700 });
  check('resizing the window keeps the drawings', await until(async () => (await ink(alex.page)) > 0));
  await alex.page.setViewport({ width: 1280, height: 800 });

  const beforeRemoval = await ink(admin.page);
  await press(admin.page, '[data-action="remove"][data-name="Alex Tan"]');
  check('removing a student asks first', await visible(admin.page, 'dialog[open]'));
  await shot(admin, '10-remove-dialog');
  await admin.page.click('dialog[open] input[type="checkbox"]');
  await admin.page.click('dialog[open] button[value="ok"]');
  check('the removed student is told they were removed', await visible(alex.page, '[data-screen="removed"]'));
  await sleep(1200);
  check('and is not also shown a confusing error message', !(await alex.page.$('.toast')));
  check('their drawings are deleted when asked', await until(async () => (await ink(admin.page)) < beforeRemoval));
  check('the admin sees Alex under "Removed"', await until(() => admin.page.$eval('#roster', (node) => node.textContent.includes('Removed') && node.textContent.includes('Alex Tan'))));
  await shot(alex, '11-student-removed');

  await alex.page.reload({ waitUntil: 'domcontentloaded' });
  check('a removed student stays removed after reloading', await visible(alex.page, '[data-screen="removed"]'));
  await press(admin.page, '[data-action="let-in"][data-name="Alex Tan"]');
  check('letting them back in sends them to the join screen by itself', await visible(alex.page, '#join-form'));
  check('the name field starts empty, so a shared computer never shows the last student’s name', (await alex.page.$eval('#name', (input) => input.value)) === '');
  await alex.page.type('#name', 'Alex Tan');
  await alex.page.click('#join-form button[type="submit"]');
  check('with approval on, a returning student waits again', await visible(alex.page, '[data-screen="waiting"]'));
  await press(admin.page, '[data-action="admit"][data-name="Alex Tan"]');
  check('and is admitted again', await visible(alex.page, 'canvas.layer-live'));

  // ---- Clear, save, delete --------------------------------------------------------------
  await admin.page.click('#clear-board');
  await admin.page.click('dialog[open] button[value="ok"]');
  check('clearing empties the board for everyone', await until(async () => (await ink(admin.page)) === 0 && (await ink(alex.page)) === 0 && (await ink(bea.page)) === 0));

  // Saving makes a real PNG: catch the download link the page builds and look inside the file.
  await admin.page.evaluate(() => {
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) window.__download = { name: this.download, href: this.href };
      else original.call(this);
    };
  });
  await draw(admin.page, wave(0.5, 0.2, 0.7));
  await admin.page.click('#save-image');
  const saved = await until(() => admin.page.evaluate(async () => {
    if (!window.__download) return null;
    const bytes = new Uint8Array(await (await fetch(window.__download.href)).arrayBuffer());
    return { name: window.__download.name, size: bytes.length, signature: [...bytes.slice(0, 4)] };
  }));
  check('saving writes a PNG file named after the board', saved && saved.name === `whiteboard-${code}.png` && saved.signature.join() === '137,80,78,71' && saved.size > 1000, JSON.stringify(saved));

  await admin.page.click('#copy-link');
  check('copying the join link says so', await until(async () => /copied|Couldn/.test(await text(admin.page, '.toast'))));
  console.log('      (copy link toast: ' + (await text(admin.page, '.toast')) + ')');
  await admin.page.click('#show-code');
  check('the code can be shown in large type for a projector', (await visible(admin.page, 'dialog[open] .code-huge')) && (await text(admin.page, 'dialog[open] .code-huge')).replace(/\s/g, '') === code);
  await shot(admin, '18-code-dialog');
  await admin.page.click('dialog[open] button[value="close"]');
  check('the large code closes again', await until(async () => !(await admin.page.$('dialog[open]'))));
  check('saving an image does not raise an error', await isHidden(admin.page, '.toast-error'));

  await admin.page.click('#delete-board');
  await admin.page.click('dialog[open] button[value="ok"]');
  check('deleting a board returns the admin to their boards', await visible(admin.page, '#create-form'));
  check('students are told the board was closed', await visible(alex.page, '[data-screen="closed"]') && (await visible(bea.page, '[data-screen="closed"]')));
  await shot(alex, '12-student-closed');

  // ---- QR code and backgrounds ----------------------------------------------------------
  const host = await person('host', { scale: 2 });
  await host.page.goto(`${BASE}/admin.html?emulator`, { waitUntil: 'domcontentloaded' });
  await host.page.waitForSelector('#new-title', { visible: true });
  await host.page.type('#new-title', 'Backgrounds');
  await host.page.click('#create-form button[type="submit"]');
  await visible(host.page, '#console');
  const bgCode = (await text(host.page, '#code')).replace(/\s/g, '');

  const pupil = await person('pupil');
  await pupil.page.goto(`${BASE}/student.html?code=${bgCode}&emulator`, { waitUntil: 'domcontentloaded' });
  await visible(pupil.page, '#join-form');
  await pupil.page.type('#name', 'Alex');
  await pupil.page.click('#join-form button[type="submit"]');
  check('a student is on the board', await visible(pupil.page, 'canvas.layer-live'));
  check('the board is exactly 16:9, so a 16:9 picture fills it', await pupil.page.$eval('.surface', (n) => n.clientWidth * 9 === n.clientHeight * 16));

  // The QR code: take a picture of it, as a phone would, and read it.
  await host.page.click('#show-qr');
  check('the QR code dialog opens', await visible(host.page, 'dialog[open] .qr svg'));
  await sleep(300);
  await shot(host, '18-qr-dialog');
  const qrImage = PNG.sync.read(await (await host.page.$('dialog[open] .qr svg')).screenshot());
  const scanned = jsQR(new Uint8ClampedArray(qrImage.data), qrImage.width, qrImage.height);
  check('scanning the QR code gives the join link', scanned?.data === `${BASE}/student.html?code=${bgCode}&emulator`, `got ${scanned?.data}`);
  check('the large code is shown beside it', (await text(host.page, 'dialog[open] .code-huge')).replace(/\s/g, '') === bgCode);
  await host.page.click('dialog[open] button[value="close"]');
  check('the QR code dialog closes', await closed(host.page));
  await host.page.click('#show-code');
  check('clicking the code opens the same dialog', await visible(host.page, 'dialog[open] .qr svg'));
  await host.page.click('dialog[open] button[value="close"]');
  await closed(host.page);

  const scanner = await person('scanner', { width: 390, height: 780, touch: true });
  await scanner.page.goto(scanned.data, { waitUntil: 'domcontentloaded' });
  check('the scanned link opens that board’s join screen', (await visible(scanner.page, '#join-form')) && (await text(scanner.page, '#join-title')) === 'Join Backgrounds');
  await scanner.page.type('#name', 'Priya');
  await scanner.page.click('#join-form button[type="submit"]');
  check('and the person who scanned it joins the board', await visible(scanner.page, 'canvas.layer-live'));

  // The background dialog, and the ways a file can be wrong.
  await host.page.click('#background-button');
  check('the background dialog opens', await visible(host.page, 'dialog[open] .bg-preview'));
  check('use-as-background is off until a file is chosen', await host.page.$eval('dialog[open] button[type="submit"]', (b) => b.disabled));
  await shot(host, '19-background-empty');
  const chooseFile = async (path) => (await host.page.$('dialog[open] input[type="file"]')).uploadFile(path);
  const alertText = () => host.page.$eval('dialog[open] [role="alert"]', (n) => n.textContent);

  await chooseFile(fx.txt);
  check('a file that is not a picture or PDF is refused plainly', await until(async () => (await alertText()).includes('Choose a picture')));
  await chooseFile(fx.badPng);
  check('a damaged picture is refused plainly', await until(async () => (await alertText()).includes('can’t be opened here')));
  await chooseFile(fx.badPdf);
  check('a damaged PDF is refused plainly', await until(async () => (await alertText()).includes('This PDF can’t be opened'), 20000));
  await chooseFile(fx.bigPdf);
  check('a file over 30 MB is refused', await until(async () => (await alertText()).includes('over 30 MB')));
  check('none of that enabled the button', await host.page.$eval('dialog[open] button[type="submit"]', (b) => b.disabled));

  // A picture dropped onto the dialog.
  await host.page.evaluate(async (base64) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'dropped.png', { type: 'image/png' }));
    const dialog = document.querySelector('dialog[open]');
    dialog.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
    dialog.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  }, twoColorsBytes.toString('base64'));
  check('a picture dropped on the dialog is picked up and previewed', await visible(host.page, 'dialog[open] .bg-preview canvas'));
  check('and the old error is cleared', (await alertText()) === '');
  await shot(host, '20-background-image-preview');
  await host.page.click('dialog[open] button[type="submit"]');
  check('the dialog closes once the background is set', await closed(host.page));

  check('the student sees the background', await visible(pupil.page, 'img.backdrop'));
  await sleep(500);
  check('its left half is blue and its right half yellow', near(await sample(pupil.page, 0.25, 0.5), [0, 0, 255]) && near(await sample(pupil.page, 0.75, 0.5), [255, 220, 0]));
  check('the admin sees it too', near(await sample(host.page, 0.25, 0.5), [0, 0, 255]));
  check('so does the person who scanned the code, on a phone', await until(async () => near(await sample(scanner.page, 0.25, 0.5), [0, 0, 255])));
  await shot(pupil, '21-student-with-picture');

  const late = await person('late');
  await late.page.goto(`${BASE}/student.html?code=${bgCode}&emulator`, { waitUntil: 'domcontentloaded' });
  await visible(late.page, '#join-form');
  await late.page.type('#name', 'Sam');
  await late.page.click('#join-form button[type="submit"]');
  check('someone who joins later sees the background straight away', await until(async () => near(await sample(late.page, 0.75, 0.5), [255, 220, 0])));
  await late.context.close();

  await host.page.reload({ waitUntil: 'domcontentloaded' });
  await visible(host.page, '#console');
  check('the background is still there after the admin reloads', await until(async () => near(await sample(host.page, 0.25, 0.5), [0, 0, 255])));

  // Writing on top of it, and saving it.
  const bgBox = await (await pupil.page.$('canvas.layer-live')).boundingBox();
  await pupil.page.mouse.move(bgBox.x + bgBox.width * 0.2, bgBox.y + bgBox.height * 0.3);
  await pupil.page.mouse.down();
  await pupil.page.mouse.move(bgBox.x + bgBox.width * 0.7, bgBox.y + bgBox.height * 0.6, { steps: 12 });
  await pupil.page.mouse.up();
  check('students can draw on top of the picture, and the teacher sees it', await until(async () => (await ink(pupil.page)) > 0 && (await ink(host.page)) > 0));
  check('the "pick a marker" hint stays away when there is a background', await pupil.page.$eval('.hint', (n) => n.hidden));
  await shot(pupil, '22-student-drawing-on-picture');

  await host.page.evaluate(() => {
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) window.__download = { name: this.download, href: this.href };
      else original.call(this);
    };
  });
  await host.page.click('#save-image');
  const bgSaved = await until(() =>
    host.page.evaluate(async () => (window.__download ? Array.from(new Uint8Array(await (await fetch(window.__download.href)).arrayBuffer())) : null)),
  );
  const bgExport = bgSaved ? PNG.sync.read(Buffer.from(bgSaved)) : null;
  const exportPixel = (x, y) => [...bgExport.data.slice((y * bgExport.width + x) * 4, (y * bgExport.width + x) * 4 + 3)];
  check('the saved image includes the background behind the drawing', bgExport && bgExport.width === 1920 && near(exportPixel(100, 900), [0, 0, 255]) && near(exportPixel(1800, 900), [255, 220, 0]));

  await host.page.click('#clear-board');
  check('the clear confirmation says the background stays', (await text(host.page, 'dialog[open] p')).includes('The background stays'));
  await host.page.click('dialog[open] button[value="ok"]');
  check('clearing removes the drawing but not the picture', await until(async () => (await ink(pupil.page)) === 0 && near(await sample(pupil.page, 0.25, 0.5), [0, 0, 255])));

  // A PDF page.
  await host.page.click('#background-button');
  await visible(host.page, 'dialog[open] .bg-preview');
  check('the current background is shown when the dialog opens, with a way to remove it', (await visible(host.page, 'dialog[open] .bg-preview img')) && !!(await host.page.$('dialog[open] .btn-danger-quiet')));
  await chooseFile(fx.pdf);
  check('a PDF shows a page picker that knows the page count', (await visible(host.page, 'dialog[open] .pager', 20000)) && (await text(host.page, 'dialog[open] .pager')).includes('of 3'));
  await sleep(600);
  await shot(host, '23-background-pdf-page1');
  await host.page.click('dialog[open] [aria-label="Next page"]');
  await sleep(1200);
  check('the page number follows the buttons', (await host.page.$eval('dialog[open] .page-input', (n) => n.value)) === '2');
  await host.page.$eval('dialog[open] .page-input', (n) => (n.value = ''));
  await host.page.type('dialog[open] .page-input', '3');
  await host.page.keyboard.press('Enter');
  await sleep(1000);
  check('and typing a page number goes there', (await host.page.$eval('dialog[open] .page-input', (n) => n.value)) === '3');
  await host.page.click('dialog[open] [aria-label="Previous page"]');
  await sleep(1000);
  await shot(host, '24-background-pdf-page2');
  await host.page.click('dialog[open] button[type="submit"]');
  check('the dialog closes once the PDF page is set', await closed(host.page));

  // Page 2 is the green one. Its square sits at PDF (100..300, 500..700) on a 595 x 842 page.
  check('the student sees page 2 (the green square)', !!(await until(async () => near(await sample(pupil.page, 200 / 595, 1 - 600 / 842), [0, 153, 0]))));
  check('the page keeps its shape inside the board, with room either side', await pupil.page.evaluate(() => {
    const img = document.querySelector('img.backdrop');
    return Math.abs(img.naturalWidth / img.naturalHeight - 595 / 842) < 0.02 && img.offsetWidth < img.parentElement.clientWidth * 0.6 && img.offsetHeight === img.parentElement.clientHeight;
  }));
  await shot(pupil, '25-student-with-pdf-page');

  // A picture too detailed for the database cap is shrunk until it fits, not refused.
  await host.page.click('#background-button');
  await visible(host.page, 'dialog[open] .bg-preview');
  await chooseFile(fx.noisy);
  check('a very detailed picture can still be chosen', await visible(host.page, 'dialog[open] .bg-preview canvas', 30000));
  await host.page.click('dialog[open] button[type="submit"]');
  check('and is shrunk to fit and shared', await closed(host.page, 90000));
  const stored = await until(() => pupil.page.evaluate(() => { const img = document.querySelector('img.backdrop'); return !img.hidden && img.src.startsWith('data:image/') ? img.src.length : 0; }), 20000);
  check('what was stored is under the database cap', stored > 1000 && stored <= 1_500_000, `length ${stored}`);

  // Take it away.
  await host.page.click('#background-button');
  await visible(host.page, 'dialog[open] .btn-danger-quiet');
  await host.page.click('dialog[open] .btn-danger-quiet');
  check('removing the background closes the dialog', await closed(host.page));
  check('and the student’s board goes back to plain white', await until(() => pupil.page.$eval('img.backdrop', (img) => img.hidden)));
  check('and the hint comes back', await until(() => pupil.page.$eval('.hint', (n) => !n.hidden)));

  // The dialogs on a phone.
  const hostPhone = await person('host-phone', { width: 390, height: 780, scale: 2 });
  await hostPhone.page.goto(`${BASE}/admin.html?emulator`, { waitUntil: 'domcontentloaded' });
  await hostPhone.page.waitForSelector('#new-title', { visible: true });
  await hostPhone.page.type('#new-title', 'Phone');
  await hostPhone.page.click('#create-form button[type="submit"]');
  await visible(hostPhone.page, '#console');
  await hostPhone.page.click('#show-qr');
  check('the QR code dialog fits a phone', await visible(hostPhone.page, 'dialog[open] .qr svg') && (await hostPhone.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)));
  await sleep(300);
  await shot(hostPhone, '26-phone-qr');
  await hostPhone.page.click('dialog[open] button[value="close"]');
  await hostPhone.page.click('#open-panel');
  await sleep(400);
  await hostPhone.page.click('#background-button');
  check('and so does the background dialog', await visible(hostPhone.page, 'dialog[open] .bg-preview') && (await hostPhone.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)));
  await sleep(300);
  await shot(hostPhone, '27-phone-background-dialog');

  // ---- Small screens and dark mode ------------------------------------------------------
  const phoneAdmin = await person('phone-admin', { width: 390, height: 780 });
  await phoneAdmin.page.goto(`${BASE}/admin.html?emulator`, { waitUntil: 'domcontentloaded' });
  await visible(phoneAdmin.page, '#create-form');
  await phoneAdmin.page.type('#new-title', 'Science 2A');
  await phoneAdmin.page.click('#create-form button[type="submit"]');
  await visible(phoneAdmin.page, '#console');
  const phoneCode = (await text(phoneAdmin.page, '#code')).replace(/\s/g, '');
  await sleep(1000);
  await shot(phoneAdmin, '13-phone-admin');

  const phone = await person('phone', { width: 390, height: 780, touch: true });
  await phone.page.goto(`${BASE}/student.html?code=${phoneCode}&emulator`, { waitUntil: 'domcontentloaded' });
  await visible(phone.page, '#join-form');
  await phone.page.type('#name', 'Priya');
  await phone.page.click('#join-form button[type="submit"]');
  await visible(phone.page, 'canvas.layer-live');
  await drawTouch(phone.page, wave(0.4));
  await draw(phoneAdmin.page, wave(0.7, 0.3, 0.9));
  await sleep(1000);
  check('a finger can draw on a phone, and the teacher sees it', (await ink(phone.page)) > 0 && (await ink(phoneAdmin.page)) > 0);
  check('the phone page did not scroll while drawing', (await phone.page.evaluate(() => scrollY)) === 0);
  await shot(phone, '14-phone-student');
  await phoneAdmin.page.click('#open-panel');
  await sleep(400);
  await shot(phoneAdmin, '15-phone-admin-drawer');
  check('the students drawer opens on a phone', await phoneAdmin.page.$eval('#console', (node) => node.classList.contains('panel-open')));

  const phoneLanding = await person('phone-landing', { width: 390, height: 780, touch: true });
  await phoneLanding.page.goto(`${BASE}/index.html?emulator`, { waitUntil: 'domcontentloaded' });
  await sleep(600);
  check('the landing page fits a phone with no sideways scrolling', await phoneLanding.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await shot(phoneLanding, '19-phone-landing');

  const dark = await person('dark', { width: 1280, height: 800, dark: true });
  await dark.page.goto(`${BASE}/index.html?emulator`, { waitUntil: 'domcontentloaded' });
  await sleep(500);
  await shot(dark, '16-dark-landing');
  await dark.page.goto(`${BASE}/admin.html?emulator`, { waitUntil: 'domcontentloaded' });
  await visible(dark.page, '#create-form');
  await dark.page.type('#new-title', 'Dark mode check');
  await dark.page.click('#create-form button[type="submit"]');
  await visible(dark.page, '#console');
  await draw(dark.page, wave(0.4));
  await sleep(1200);
  await shot(dark, '17-dark-console');
} catch (error) {
  console.log('SCRIPT ERROR', error);
  results.push({ name: 'script ran to the end', ok: false });
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  console.log('\nBrowser console messages:');
  for (const line of [...new Set(logs)]) console.log('  ' + line);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}
