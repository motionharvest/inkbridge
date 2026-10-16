import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSmoother } from '../public/js/smooth.js';

test('smoothing flattens a zigzag and still ends at the last raw point', () => {
  const smoother = createSmoother([0, 0, 0.5]);
  const out = [];
  for (let i = 1; i <= 20; i++) out.push(smoother.push([i * 10, i % 2 ? 6 : -6, 0.5]));
  const ys = out.filter(Boolean).slice(5).map((p) => Math.abs(p[1]));
  assert.ok(Math.max(...ys) < 2, `zigzag stays within 2 units, got ${Math.max(...ys)}`);
  assert.deepEqual(smoother.end(), [200, -6, 0.5]);
});

test('points closer than the minimum step are dropped', () => {
  const smoother = createSmoother([0, 0, 0.5]);
  assert.equal(smoother.push([0.5, 0.5, 0.5]), null);
  assert.ok(smoother.push([5, 0, 0.5]));
});
