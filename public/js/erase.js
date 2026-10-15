// Cuts strokes with a round eraser. A stroke's centre line is clipped
// against a circle, and the parts outside the circle become new strokes.
// Points are [x, y, pressure] in page units.

const boxes = new WeakMap(); // stroke -> { length, box }

// Returns one entry for each stroke the circle touches, with the point lists
// of the pieces that remain. A stroke the circle removes entirely has no
// pieces. The reach grows by half the line width, so the circle erases ink
// it touches at the line's edge, not only at its centre.
export function cutStrokes(page, center, radius) {
  const cuts = [];
  for (const stroke of page.strokes) {
    const reach = radius + stroke.width / 2;
    const box = boundsOf(stroke);
    if (center[0] < box.minX - reach || center[0] > box.maxX + reach) continue;
    if (center[1] < box.minY - reach || center[1] > box.maxY + reach) continue;
    const pieces = cutPoints(stroke.points, center, reach);
    if (pieces) cuts.push({ stroke, pieces });
  }
  return cuts;
}

// Returns the point lists left after removing the parts of a line inside the
// circle, or null when the circle does not touch the line.
export function cutPoints(points, center, reach) {
  const inside = (p) => Math.hypot(p[0] - center[0], p[1] - center[1]) <= reach;
  if (points.length === 1) return inside(points[0]) ? [] : null;

  const pieces = [];
  let touched = inside(points[0]);
  let piece = touched ? [] : [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const span = insideSpan(a, b, center, reach);
    if (!span) {
      piece.push(b);
      continue;
    }
    touched = true;
    const [enter, leave] = span;
    if (piece.length) {
      piece.push(lerp(a, b, enter));
      pieces.push(piece);
    }
    piece = leave < 1 ? [lerp(a, b, leave), b] : [];
  }
  if (!touched) return null;
  pieces.push(piece);
  return pieces.filter((p) => p.length >= 2);
}

// The part of segment ab, as fractions from 0 to 1, that lies inside the
// circle. Returns null when no part of the segment is inside.
function insideSpan(a, b, center, reach) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const fx = a[0] - center[0];
  const fy = a[1] - center[1];
  const qa = dx * dx + dy * dy;
  const qc = fx * fx + fy * fy - reach * reach;
  if (qa === 0) return qc <= 0 ? [0, 1] : null;
  const qb = 2 * (fx * dx + fy * dy);
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const enter = Math.max(0, (-qb - root) / (2 * qa));
  const leave = Math.min(1, (-qb + root) / (2 * qa));
  return enter < leave ? [enter, leave] : null;
}

function lerp(a, b, t) {
  return [
    Math.round((a[0] + (b[0] - a[0]) * t) * 10) / 10,
    Math.round((a[1] + (b[1] - a[1]) * t) * 10) / 10,
    a[2] + (b[2] - a[2]) * t,
  ];
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
