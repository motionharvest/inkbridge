import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insideLasso, lassoContents } from '../public/js/lasso.js';

const square = [[0, 0], [100, 0], [100, 100], [0, 100]];

test('a point is inside a lasso when it is within the outline', () => {
  assert.ok(insideLasso(square, 50, 50));
  assert.equal(insideLasso(square, 150, 50), false);
});

test('the lasso takes strokes mostly inside and items centered inside', () => {
  const page = {
    strokes: [
      { id: 'inside', points: [[10, 10], [20, 20], [120, 20]] },
      { id: 'outside', points: [[150, 10], [160, 20], [50, 50]] },
    ],
    items: [
      { id: 'img', kind: 'image', x: 40, y: 40, width: 40, height: 40 },
      { id: 'far', kind: 'image', x: 90, y: 90, width: 60, height: 60 },
    ],
  };
  assert.deepEqual(lassoContents(page, square), { strokeIds: ['inside'], itemIds: ['img'] });
});
