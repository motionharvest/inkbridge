import { pageItems } from './shared/ops.js';

// The lasso is a closed freehand outline in page units: a list of [x, y]
// points, with the last point joined back to the first.

// Even-odd ray casting: a point is inside when a ray from it crosses the
// outline an odd number of times.
export function insideLasso(lasso, x, y) {
  let inside = false;
  for (let i = 0, j = lasso.length - 1; i < lasso.length; j = i++) {
    const [xi, yi] = lasso[i];
    const [xj, yj] = lasso[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function lassoBounds(lasso) {
  const xs = lasso.map((p) => p[0]);
  const ys = lasso.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

// A stroke is selected when at least half of its points are inside, so a
// lasso that clips the end of a line still takes the line. An item is
// selected when its center is inside.
export function lassoContents(page, lasso) {
  const strokeIds = page.strokes
    .filter((s) => s.points.filter((p) => insideLasso(lasso, p[0], p[1])).length * 2 >= s.points.length)
    .map((s) => s.id);
  const itemIds = pageItems(page)
    .filter((item) => insideLasso(lasso, item.x + item.width / 2, item.y + (item.height ?? item.size) / 2))
    .map((item) => item.id);
  return { strokeIds, itemIds };
}

