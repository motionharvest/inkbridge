import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillShape, floodRegion } from '../public/js/fill.js';

// A 40 by 40 grid with a square of wall from 10 to 30, one cell thick.
function boxWall({ gap = false } = {}) {
  const size = 40;
  const wall = new Uint8Array(size * size);
  for (let i = 10; i <= 30; i++) {
    wall[10 * size + i] = wall[30 * size + i] = wall[i * size + 10] = wall[i * size + 30] = 1;
  }
  if (gap) wall[10 * size + 20] = 0;
  return { wall, size };
}

test('a point inside closed ink fills the inside and grows one cell under the ink', () => {
  const { wall, size } = boxWall();
  const shape = fillShape(wall, size, size, 20, 20);
  assert.deepEqual({ x: shape.x, y: shape.y, width: shape.width, height: shape.height }, { x: 10, y: 10, width: 21, height: 21 });
  assert.equal(shape.rings.length, 1);
  const corners = shape.rings[0].map((p) => p.join(',')).sort();
  assert.deepEqual(corners, ['0,0', '0,21', '21,0', '21,21']);
});

test('a gap in the ink leaves the area open, so nothing fills', () => {
  const { wall, size } = boxWall({ gap: true });
  assert.equal(fillShape(wall, size, size, 20, 20), null);
});

test('a point outside every shape reaches the page edge and does not fill', () => {
  const { wall, size } = boxWall();
  assert.equal(floodRegion(wall, size, size, 2, 2), null);
});

test('a closed shape inside the area stays a hole', () => {
  const { wall, size } = boxWall();
  for (let i = 18; i <= 22; i++) {
    wall[18 * size + i] = wall[22 * size + i] = wall[i * size + 18] = wall[i * size + 22] = 1;
  }
  const shape = fillShape(wall, size, size, 13, 13);
  assert.equal(shape.rings.length, 2);
});
