import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_PAIRS,
  chunkPoints,
  decodePoints,
  distToSegment,
  encodePoints,
  itemHits,
  parseItem,
  strokeHits,
  thinPoints,
} from '../js/strokes.js';
import { BOARD_H, BOARD_W } from '../js/util.js';

test('points survive an encode and decode round trip, rounded to whole units', () => {
  assert.equal(encodePoints([1, 2, 3.6, 4.4]), '1,2 4,4');
  assert.deepEqual(decodePoints('1,2 4,4'), [1, 2, 4, 4]);
  assert.deepEqual(decodePoints(encodePoints([10, 20, 30, 40, 50, 60])), [10, 20, 30, 40, 50, 60]);
});

test('decodePoints skips garbage instead of throwing', () => {
  assert.deepEqual(decodePoints('1,2 x,y  3,4 5 ,6 7,'), [1, 2, 3, 4]);
  assert.deepEqual(decodePoints(undefined), []);
  assert.deepEqual(decodePoints(42), []);
  assert.deepEqual(decodePoints(''), []);
});

test('thinPoints drops points that are too close but keeps the first and last', () => {
  assert.deepEqual(thinPoints([0, 0, 1, 0, 2, 0, 10, 0], 2), [0, 0, 2, 0, 10, 0]);
  assert.deepEqual(thinPoints([5, 5, 5, 6, 6, 5], 3), [5, 5, 6, 5]);
  assert.deepEqual(thinPoints([5, 5], 3), [5, 5]);
  assert.deepEqual(thinPoints([], 3), []);
});

test('chunkPoints leaves short strokes alone', () => {
  const flat = Array.from({ length: 20 }, (_, i) => i);
  assert.deepEqual(chunkPoints(flat, 10), [flat]);
});

test('chunkPoints splits long strokes into pieces that join up', () => {
  const pairs = 3500;
  const flat = [];
  for (let i = 0; i < pairs; i++) flat.push(i, i * 2);
  const chunks = chunkPoints(flat);

  assert.equal(chunks.length, 3);
  for (const chunk of chunks) assert.ok(chunk.length / 2 <= MAX_PAIRS);
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1];
    assert.deepEqual(chunks[i].slice(0, 2), prev.slice(-2), 'a piece starts where the last one ended');
  }
  assert.deepEqual(chunks.at(-1).slice(-2), flat.slice(-2), 'the last point is kept');
});

test('a stroke of the maximum size still fits in the 20000 characters the rules allow', () => {
  const flat = [];
  for (let i = 0; i < MAX_PAIRS; i++) flat.push(BOARD_W, BOARD_H);
  assert.ok(encodePoints(flat).length <= 20000);
});

test('distToSegment measures to the nearest point on the segment', () => {
  assert.equal(distToSegment(5, 5, 0, 0, 10, 0), 5);
  assert.equal(distToSegment(-3, 4, 0, 0, 10, 0), 5);
  assert.equal(distToSegment(13, 4, 0, 0, 10, 0), 5);
  assert.equal(distToSegment(3, 4, 0, 0, 0, 0), 5);
});

test('strokeHits accounts for the pen width and the eraser radius', () => {
  const line = [0, 0, 100, 0];
  assert.equal(strokeHits(line, 10, 50, 5, 0), true);
  assert.equal(strokeHits(line, 10, 50, 6, 0), false);
  assert.equal(strokeHits(line, 10, 50, 20, 16), true);
  assert.equal(strokeHits(line, 10, 50, 40, 16), false);
});

test('a single-point stroke is a dot', () => {
  assert.equal(strokeHits([50, 50], 10, 54, 50, 0), true);
  assert.equal(strokeHits([50, 50], 10, 60, 50, 0), false);
});

test('parseItem reads a stroke and works out its bounds', () => {
  const item = parseItem('a1', { type: 'stroke', uid: 'u1', color: '#2b4fd8', size: 6, pts: '10,20 30,40' });
  assert.equal(item.id, 'a1');
  assert.equal(item.type, 'stroke');
  assert.deepEqual(item.pts, [10, 20, 30, 40]);
  assert.deepEqual(item.bounds, { minX: 7, minY: 17, maxX: 33, maxY: 43 });
});

test('parseItem corrects what other browsers might have written', () => {
  const item = parseItem('a2', { type: 'stroke', uid: 'u1', color: 'red', size: 9999, pts: '-50,5000 10,10' });
  assert.equal(item.color, '#1b1f27');
  assert.equal(item.size, 120);
  assert.deepEqual(item.pts, [0, BOARD_H, 10, 10]);
});

test('parseItem reads text and caps it', () => {
  const item = parseItem('t1', { type: 'text', uid: 'u1', color: '#d92d3a', size: 48, text: `${'x'.repeat(400)}`, x: 100, y: 200 });
  assert.equal(item.type, 'text');
  assert.equal(item.text.length, 300);
  assert.equal(item.x, 100);
  assert.ok(item.bounds.maxX > item.bounds.minX);
});

test('parseItem rejects things that are not drawable', () => {
  assert.equal(parseItem('x', null), null);
  assert.equal(parseItem('x', 'stroke'), null);
  assert.equal(parseItem('x', { type: 'stroke', pts: '1,2 3,4' }), null, 'no author');
  assert.equal(parseItem('x', { type: 'stroke', uid: 'u', pts: 'nope' }), null, 'no points');
  assert.equal(parseItem('x', { type: 'text', uid: 'u', text: '' }), null, 'empty text');
  assert.equal(parseItem('x', { type: 'circle', uid: 'u' }), null, 'unknown type');
});

test('itemHits checks the bounding box before the stroke', () => {
  const stroke = parseItem('s', { type: 'stroke', uid: 'u', color: '#1b1f27', size: 6, pts: '0,0 100,0' });
  assert.equal(itemHits(stroke, 50, 2, 10), true);
  assert.equal(itemHits(stroke, 50, 200, 10), false);

  const text = parseItem('t', { type: 'text', uid: 'u', color: '#1b1f27', size: 40, text: 'Hello', x: 300, y: 300 });
  assert.equal(itemHits(text, 320, 320, 4), true);
  assert.equal(itemHits(text, 900, 900, 4), false);
});
