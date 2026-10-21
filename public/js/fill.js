// A fill colors the area that ink closes off around a point. It works on a
// grid of cells, one per page unit: a cell is a wall when any ink touches
// it. The fill spreads from the dropped point through open cells. When it
// reaches the edge of the page, the ink does not close the area, and there
// is no fill.
//
// The filled cells grow by one cell, so the fill reaches under the faint
// edge of the ink and no paper shows between them. Their outline becomes
// rings of [x, y] points, and the fill is drawn with the even-odd rule, so
// a closed shape inside the area, such as an eye inside a face, stays a
// hole.

const MAX_CELLS = 4_000_000;

// `wall` is a Uint8Array of width * height cells, nonzero where ink is.
// Returns the filled cells as a Uint8Array, or null when the area is open.
export function floodRegion(wall, width, height, x, y) {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= width || y >= height || width * height > MAX_CELLS) return null;
  const start = y * width + x;
  if (wall[start]) return null;
  const region = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;
  stack[top++] = start;
  region[start] = 1;
  while (top) {
    const i = stack[--top];
    const cx = i % width;
    const cy = (i - cx) / width;
    if (cx === 0 || cy === 0 || cx === width - 1 || cy === height - 1) return null;
    for (const j of [i - 1, i + 1, i - width, i + width]) {
      if (!region[j] && !wall[j]) {
        region[j] = 1;
        stack[top++] = j;
      }
    }
  }
  return region;
}

// Adds every cell that touches a filled cell, diagonals included.
export function grow(region, width, height) {
  const out = region.slice();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!region[y * width + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) out[ny * width + nx] = 1;
        }
      }
    }
  }
  return out;
}

// The outline of the filled cells as closed rings of cell corners. Each
// side between a filled cell and an empty one is one edge. Under the
// even-odd rule, a point's inside or outside depends only on which edges
// exist, not on how they are joined, so where two rings touch at a corner
// either joining is correct.
export function traceRings(region, width, height) {
  const filled = (x, y) => x >= 0 && y >= 0 && x < width && y < height && region[y * width + x];
  const key = (x, y) => y * (width + 1) + x;
  const next = new Map(); // corner -> corners an edge leaves it for
  const add = (x0, y0, x1, y1) => {
    const k = key(x0, y0);
    if (!next.has(k)) next.set(k, []);
    next.get(k).push([x1, y1]);
  };
  // Edges run clockwise around each filled cell, so the fill is on the right.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) add(x, y, x + 1, y);
      if (!filled(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!filled(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!filled(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const rings = [];
  for (const [k, outs] of next) {
    while (outs.length) {
      const first = [k % (width + 1), Math.floor(k / (width + 1))];
      const ring = [first];
      let at = outs.pop();
      while (at[0] !== first[0] || at[1] !== first[1]) {
        ring.push(at);
        at = next.get(key(at[0], at[1])).pop();
      }
      rings.push(ring);
    }
  }
  return rings.map(straighten);
}

// Drops corners that sit on a straight run, then removes the stair steps
// that pixel corners leave on a slanted side, keeping every point within
// `tolerance` of the outline.
export function simplify(ring, tolerance = 0.75) {
  if (ring.length < 4) return ring;
  // Split the ring at its first point and the point farthest from it, so
  // each half is an open line.
  let far = 0;
  let best = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > best) [far, best] = [i, d];
  }
  const a = reduce(ring.slice(0, far + 1), tolerance);
  const b = reduce([...ring.slice(far), ring[0]], tolerance);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function straighten(ring) {
  return ring.filter((p, i) => {
    const a = ring.at(i - 1);
    const b = ring[(i + 1) % ring.length];
    return (b[0] - a[0]) * (p[1] - a[1]) !== (b[1] - a[1]) * (p[0] - a[0]);
  });
}

// Ramer-Douglas-Peucker: keeps the point farthest from the line between the
// ends when it is farther than `tolerance`, and repeats on each side.
function reduce(points, tolerance) {
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const spans = [[0, points.length - 1]];
  while (spans.length) {
    const [from, to] = spans.pop();
    const [ax, ay] = points[from];
    const [bx, by] = points[to];
    const length = Math.hypot(bx - ax, by - ay);
    let index = -1;
    let most = tolerance;
    for (let i = from + 1; i < to; i++) {
      const [px, py] = points[i];
      const d = length ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length : Math.hypot(px - ax, py - ay);
      if (d > most) [index, most] = [i, d];
    }
    if (index < 0) continue;
    keep[index] = 1;
    spans.push([from, index], [index, to]);
  }
  return points.filter((_, i) => keep[i]);
}

// The fill for the area around (x, y), given the ink as a wall grid, or null
// when the ink does not close that area. The result is the shape a fill
// item stores: its bounding box and its rings, with points relative to the
// box's top left corner.
export function fillShape(wall, width, height, x, y) {
  const region = floodRegion(wall, width, height, x, y);
  if (!region) return null;
  const rings = traceRings(grow(region, width, height), width, height)
    .map((ring) => simplify(ring))
    .filter((ring) => ring.length >= 3);
  if (!rings.length) return null;
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [px, py] of rings.flat()) {
    left = Math.min(left, px);
    top = Math.min(top, py);
    right = Math.max(right, px);
    bottom = Math.max(bottom, py);
  }
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    rings: rings.map((ring) => ring.map(([px, py]) => [px - left, py - top])),
  };
}
