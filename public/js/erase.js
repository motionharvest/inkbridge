// Finds the strokes an eraser touches as it moves from one point to the next.
// Points are [x, y, pressure] in page units.

const ERASER_RADIUS = 10;

const boxes = new WeakMap(); // stroke -> { length, box }

export function strokesTouching(page, from, to) {
  const hits = [];
  for (const stroke of page.strokes) {
    const reach = ERASER_RADIUS + stroke.width / 2;
    const box = boundsOf(stroke);
    if (Math.max(from[0], to[0]) < box.minX - reach || Math.min(from[0], to[0]) > box.maxX + reach) continue;
    if (Math.max(from[1], to[1]) < box.minY - reach || Math.min(from[1], to[1]) > box.maxY + reach) continue;
    if (touches(stroke.points, from, to, reach)) hits.push(stroke);
  }
  return hits;
}

function touches(points, from, to, reach) {
  if (points.length === 1) return segmentDistance(from, to, points[0], points[0]) <= reach;
  for (let i = 1; i < points.length; i++) {
    if (segmentDistance(from, to, points[i - 1], points[i]) <= reach) return true;
  }
  return false;
}

// The bounding box is cached and rebuilt when the stroke gains points.
function boundsOf(stroke) {
  const cached = boxes.get(stroke);
  if (cached?.length === stroke.points.length) return cached.box;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of stroke.points) {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  boxes.set(stroke, { length: stroke.points.length, box });
  return box;
}

// The shortest distance between segment ab and segment cd.
export function segmentDistance(a, b, c, d) {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(pointToSegment(a, c, d), pointToSegment(b, c, d), pointToSegment(c, a, b), pointToSegment(d, a, b));
}

function pointToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function segmentsCross(a, b, c, d) {
  const side = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
