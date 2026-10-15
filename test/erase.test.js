import assert from 'node:assert/strict';
import { test } from 'node:test';
import { segmentDistance, strokesTouching } from '../public/js/erase.js';

const line = (id, points) => ({ id, color: '#ffffff', width: 4, points: points.map(([x, y]) => [x, y, 0.5]) });

test('the eraser removes only the strokes its path touches', () => {
  const page = {
    strokes: [line('a', [[0, 0], [100, 0]]), line('b', [[0, 200], [100, 200]]), line('c', [[300, 300]])],
  };
  const crossing = strokesTouching(page, [50, -40], [50, 40]);
  assert.deepEqual(crossing.map((s) => s.id), ['a']);
  assert.deepEqual(strokesTouching(page, [305, 300], [305, 300]).map((s) => s.id), ['c']);
  assert.deepEqual(strokesTouching(page, [50, 100], [60, 100]), []);
});

test('segment distance is zero for crossing segments', () => {
  assert.equal(segmentDistance([0, -1], [0, 1], [-1, 0], [1, 0]), 0);
  assert.equal(segmentDistance([0, 0], [10, 0], [0, 5], [10, 5]), 5);
});
