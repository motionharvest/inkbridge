import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cutPoints, cutStrokes } from '../public/js/erase.js';

const pts = (...xy) => xy.map(([x, y]) => [x, y, 0.5]);

test('a cut in the middle of a line leaves two pieces that end at the circle', () => {
  const pieces = cutPoints(pts([0, 0], [100, 0]), [50, 0], 10);
  assert.equal(pieces.length, 2);
  assert.deepEqual(pieces[0].map((p) => p[0]), [0, 40]);
  assert.deepEqual(pieces[1].map((p) => p[0]), [60, 100]);
});

test('a cut at the end of a line shortens it', () => {
  const pieces = cutPoints(pts([0, 0], [100, 0]), [100, 0], 10);
  assert.deepEqual(pieces.map((p) => p.map((q) => q[0])), [[0, 90]]);
});

test('a circle that misses the line leaves it untouched', () => {
  assert.equal(cutPoints(pts([0, 0], [100, 0]), [50, 30], 10), null);
});

test('a circle around a whole short line removes it', () => {
  assert.deepEqual(cutPoints(pts([0, 0], [4, 0]), [2, 0], 10), []);
  assert.deepEqual(cutPoints(pts([3, 3]), [0, 0], 10), []);
});

test('cutStrokes reaches the edge of wide lines', () => {
  const page = { strokes: [{ id: 'a', color: '#ffffff', width: 20, points: pts([0, 0], [100, 0]) }] };
  assert.equal(cutStrokes(page, [50, 18], 10).length, 1);
  assert.equal(cutStrokes(page, [50, 25], 10).length, 0);
});

test('a small eraser far zoomed in cuts at its own edge', () => {
  const center = [10.0051, 20.0037];
  const reach = 0.002;
  const pieces = cutPoints(pts([10.0001, 20.0007], [10.0101, 20.0067]), center, reach);
  assert.equal(pieces.length, 2);
  for (const cut of [pieces[0].at(-1), pieces[1][0]]) {
    assert.ok(Math.abs(Math.hypot(cut[0] - center[0], cut[1] - center[1]) - reach) < reach / 50);
  }
});
