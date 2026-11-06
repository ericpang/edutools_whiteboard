import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BACKGROUND_MAX_CHARS,
  fitContain,
  isBackgroundDataUrl,
  kindOfFile,
  parseBackground,
  scaleToFit,
} from '../js/background.js';
import { BOARD_H, BOARD_W } from '../js/util.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('scaleToFit shrinks to fit, never enlarges unless asked, and copes with nonsense sizes', () => {
  assert.equal(scaleToFit(4000, 2000, 2000, 2000), 0.5);
  assert.equal(scaleToFit(500, 500, 2000, 2000), 1);
  assert.equal(scaleToFit(500, 500, 2000, 2000, true), 4);
  assert.equal(scaleToFit(0, 100, 10, 10), 0);
  assert.equal(scaleToFit(100, -1, 10, 10), 0);
  assert.equal(scaleToFit(Number.NaN, 100, 10, 10), 0);
});

test('fitContain fills the board for a 16:9 picture', () => {
  assert.deepEqual(fitContain(1600, 900), { x: 0, y: 0, w: BOARD_W, h: BOARD_H });
});

test('fitContain centers a tall page with space either side', () => {
  const page = fitContain(595, 842); // A4 portrait
  assert.equal(page.h, BOARD_H);
  assert.ok(page.w < BOARD_W / 2);
  assert.ok(Math.abs(page.x * 2 + page.w - BOARD_W) < 1e-9, 'equal margins left and right');
  assert.equal(page.y, 0);
});

test('fitContain centers a wide picture with space above and below', () => {
  const strip = fitContain(3000, 500);
  assert.equal(strip.w, BOARD_W);
  assert.ok(strip.h < BOARD_H);
  assert.ok(Math.abs(strip.y * 2 + strip.h - BOARD_H) < 1e-9);
});

test('fitContain also works for another box', () => {
  assert.deepEqual(fitContain(100, 100, 400, 200), { x: 100, y: 0, w: 200, h: 200 });
});

test('kindOfFile goes by type first, then by file name', () => {
  assert.equal(kindOfFile({ name: 'sheet.pdf', type: 'application/pdf' }), 'pdf');
  assert.equal(kindOfFile({ name: 'SHEET.PDF', type: '' }), 'pdf');
  assert.equal(kindOfFile({ name: 'photo', type: 'image/jpeg' }), 'image');
  assert.equal(kindOfFile({ name: 'diagram.PNG', type: '' }), 'image');
  assert.equal(kindOfFile({ name: 'phone.heic', type: '' }), 'image');
  assert.equal(kindOfFile({ name: 'notes.txt', type: 'text/plain' }), null);
  assert.equal(kindOfFile({ name: 'archive.zip' }), null);
  assert.equal(kindOfFile(), null);
});

test('only PNG and JPEG data URLs are accepted as a background', () => {
  assert.equal(isBackgroundDataUrl(PNG), true);
  assert.equal(isBackgroundDataUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), true);
  for (const bad of [
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
    'data:text/html;base64,PGgxPjwvaDE+',
    'https://example.com/picture.png',
    'javascript:alert(1)',
    'data:image/png;base64,',
    'data:image/png;base64,not base64!',
    'data:image/png;base64,AAAA"onerror="alert(1)',
    '',
    null,
    42,
  ]) {
    assert.equal(isBackgroundDataUrl(bad), false, String(bad));
  }
});

test('a data URL over the length the rules allow is refused', () => {
  const fits = `data:image/png;base64,${'A'.repeat(BACKGROUND_MAX_CHARS - 22)}`;
  assert.equal(fits.length, BACKGROUND_MAX_CHARS);
  assert.equal(isBackgroundDataUrl(fits), true);
  assert.equal(isBackgroundDataUrl(`${fits}A`), false);
});

test('parseBackground reads a good value and trims the name', () => {
  assert.deepEqual(parseBackground({ img: PNG, w: 1600, h: 900, name: 'Maths worksheet (page 2)' }), { img: PNG, w: 1600, h: 900, name: 'Maths worksheet (page 2)' });
  assert.equal(parseBackground({ img: PNG, w: 10, h: 10, name: 'n'.repeat(200) }).name.length, 80);
  assert.equal(parseBackground({ img: PNG, w: 10, h: 10 }).name, '');
});

test('parseBackground rejects anything another browser might have made up', () => {
  assert.equal(parseBackground(null), null);
  assert.equal(parseBackground('x'), null);
  assert.equal(parseBackground({ w: 10, h: 10 }), null);
  assert.equal(parseBackground({ img: 'data:image/svg+xml;base64,AAAA', w: 10, h: 10 }), null);
  assert.equal(parseBackground({ img: PNG, w: 0, h: 10 }), null);
  assert.equal(parseBackground({ img: PNG, w: 10, h: 5000 }), null);
  assert.equal(parseBackground({ img: PNG, w: 'wide', h: 10 }), null);
});
