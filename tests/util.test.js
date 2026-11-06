import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CODE_ALPHABET,
  MARKERS,
  PEOPLE_COLORS,
  colorForUid,
  generateCode,
  initials,
  inkOn,
  isValidCode,
  normalizeCode,
  sanitizeName,
  sanitizeText,
  sanitizeTitle,
  throttle,
  truncate,
} from '../js/util.js';

test('generated codes are six characters from the look-alike-free alphabet', () => {
  for (let i = 0; i < 300; i++) {
    const code = generateCode();
    assert.equal(code.length, 6);
    assert.ok(isValidCode(code), code);
    assert.ok([...code].every((char) => CODE_ALPHABET.includes(char)));
  }
});

test('generateCode uses the picker it is given', () => {
  assert.equal(generateCode(() => 0), 'AAAAAA');
  assert.equal(generateCode((n) => n - 1), '999999');
});

test('isValidCode rejects look-alikes, wrong lengths and lowercase', () => {
  for (const bad of ['', 'ABC12', 'ABC1234', 'ABCDE0', 'ABCDE1', 'ABCDEI', 'ABCDEL', 'ABCDEO', 'abcdef', 'ABC DE']) {
    assert.equal(isValidCode(bad), false, bad);
  }
  assert.equal(isValidCode('K7P3QM'), true);
});

test('normalizeCode accepts pasted codes with spaces, dashes and lowercase', () => {
  assert.equal(normalizeCode(' k7p-3qm '), 'K7P3QM');
  assert.equal(normalizeCode('K7P 3QM'), 'K7P3QM');
  assert.equal(normalizeCode(null), '');
});

test('truncate never splits a surrogate pair and counts UTF-16 units', () => {
  assert.equal(truncate('abcdef', 3), 'abc');
  const cut = truncate('😀'.repeat(30), 24);
  assert.equal(cut, '😀'.repeat(12));
  assert.equal(cut.length, 24);
  assert.equal(truncate('😀😀', 3), '😀');
});

test('sanitizeName collapses whitespace, drops control characters and caps the length', () => {
  assert.equal(sanitizeName('  Alex   Tan \n'), 'Alex Tan');
  assert.equal(sanitizeName('A\u0000B\u0007C'), 'A B C');
  assert.equal(sanitizeName('x'.repeat(40)).length, 24);
  assert.equal(sanitizeName(undefined), '');
  assert.equal(sanitizeName('王小明'), '王小明');
});

test('sanitizeTitle caps at 80', () => {
  assert.equal(sanitizeTitle('  Maths 3B  '), 'Maths 3B');
  assert.equal(sanitizeTitle('t'.repeat(200)).length, 80);
});

test('sanitizeText keeps line breaks, trims trailing space and limits size', () => {
  assert.equal(sanitizeText('  Hello  \r\nworld\u0000 '), 'Hello\nworld');
  assert.equal(sanitizeText('a\n'.repeat(20)).split('\n').length <= 8, true);
  assert.equal(sanitizeText('x'.repeat(500)).length, 300);
  assert.equal(sanitizeText('   '), '');
});

test('every marker color is lowercase hex, which is what the rules accept', () => {
  for (const { color } of MARKERS) assert.match(color, /^#[0-9a-f]{6}$/);
});

test('colorForUid is stable and picks from the people palette', () => {
  assert.equal(colorForUid('abc'), colorForUid('abc'));
  assert.ok(PEOPLE_COLORS.includes(colorForUid('someone-else')));
  const seen = new Set(Array.from({ length: 200 }, (_, i) => colorForUid(`user-${i}`)));
  assert.ok(seen.size > 4, 'colors should spread across people');
});

test('inkOn picks the more readable of white and dark ink', () => {
  assert.equal(inkOn('#ffffff'), '#17202b');
  assert.equal(inkOn('#e6b800'), '#17202b');
  assert.equal(inkOn('#1b1f27'), '#ffffff');
  assert.equal(inkOn('#2b4fd8'), '#ffffff');
});

test('initials use the first letter of the first and last word', () => {
  assert.equal(initials('alex tan'), 'AT');
  assert.equal(initials('Priya'), 'P');
  assert.equal(initials('  mary  jane  watson '), 'MW');
  assert.equal(initials('王小明'), '王');
  assert.equal(initials(''), '?');
});

test('throttle runs at once, then at most once per interval, ending on the latest value', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const calls = [];
  const send = throttle((value) => calls.push(value), 100);

  send(1);
  send(2);
  send(3);
  assert.deepEqual(calls, [1]);

  t.mock.timers.tick(100);
  assert.deepEqual(calls, [1, 3]);

  t.mock.timers.tick(500);
  send(4);
  assert.deepEqual(calls, [1, 3, 4]);
});

test('a cancelled throttle drops its pending call', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const calls = [];
  const send = throttle((value) => calls.push(value), 100);

  send('first');
  send('second');
  send.cancel();
  t.mock.timers.tick(1000);
  assert.deepEqual(calls, ['first']);
});
