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
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

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

async function person(name, { width = 1280, height = 800, dark = false, touch = false } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
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
