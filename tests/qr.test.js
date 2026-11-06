import assert from 'node:assert/strict';
import { test } from 'node:test';
import { qrMatrix, qrSvg } from '../js/qr.js';

const LINK = 'https://example.github.io/whiteboard/student.html?code=K7P3QM';

// The 7 x 7 square that marks a corner of every QR code: dark ring, light ring, dark 3 x 3 centre.
function hasFinder(matrix, top, left) {
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 7; col++) {
      const edge = row === 0 || row === 6 || col === 0 || col === 6;
      const centre = row >= 2 && row <= 4 && col >= 2 && col <= 4;
      if (matrix[top + row][left + col] !== (edge || centre)) return false;
    }
  }
  return true;
}

test('the matrix is square and a legal QR size', () => {
  const matrix = qrMatrix(LINK);
  assert.ok(matrix.every((row) => row.length === matrix.length));
  assert.equal((matrix.length - 17) % 4, 0, 'sizes run 21, 25, 29 …');
  assert.ok(matrix.length >= 21 && matrix.length <= 177);
});

test('all three corner finder patterns are in place', () => {
  const matrix = qrMatrix(LINK);
  const last = matrix.length - 7;
  assert.ok(hasFinder(matrix, 0, 0), 'top left');
  assert.ok(hasFinder(matrix, 0, last), 'top right');
  assert.ok(hasFinder(matrix, last, 0), 'bottom left');
});

test('the timing patterns alternate between the finders', () => {
  const matrix = qrMatrix(LINK);
  for (let i = 8; i < matrix.length - 8; i++) {
    assert.equal(matrix[6][i], i % 2 === 0, `row 6, column ${i}`);
    assert.equal(matrix[i][6], i % 2 === 0, `column 6, row ${i}`);
  }
});

test('more text needs a bigger code, and the same text always gives the same code', () => {
  assert.ok(qrMatrix(`${LINK}&extra=${'x'.repeat(80)}`).length > qrMatrix('ABC').length);
  assert.deepEqual(qrMatrix(LINK), qrMatrix(LINK));
});

test('stronger error correction makes a bigger code for the same text', () => {
  assert.ok(qrMatrix(LINK, 'H').length >= qrMatrix(LINK, 'L').length);
});

test('text that cannot fit in any QR code is refused', () => {
  assert.throws(() => qrMatrix('x'.repeat(5000)));
});

test('the SVG draws exactly the matrix, inside a four-module border', () => {
  const matrix = qrMatrix(LINK);
  const svg = qrSvg(LINK, { label: 'Join "this" board' });
  const full = matrix.length + 8;

  assert.match(svg, new RegExp(`viewBox="0 0 ${full} ${full}"`));
  assert.equal(svg.match(/<path /g).length, 1, 'one path for all dark modules');
  assert.match(svg, /aria-label="Join &quot;this&quot; board"/, 'the label is escaped');

  // Replay the path and rebuild the grid from it.
  const drawn = Array.from({ length: matrix.length }, () => Array(matrix.length).fill(false));
  for (const [x, y, run] of Array.from(svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g), (m) => [Number(m[1]), Number(m[2]), Number(m[3])])) {
    for (let i = 0; i < run; i++) drawn[y - 4][x - 4 + i] = true;
  }
  assert.deepEqual(drawn, matrix);
});
