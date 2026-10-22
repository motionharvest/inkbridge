import { contentBounds, GRID, PAGE, pageItems } from './shared/ops.js';

export const DOT_RADIUS = 1.7;
export const TEXT_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const LINE_HEIGHT = 1.3;

// All drawing functions work in page units. The caller sets the canvas
// transform that maps page units to device pixels.

// Fills `region` with the paper color and, unless `dots` is false, the dot
// grid. Dots sit at every multiple of `step` page units, with radius
// `radius`. Dots that are not also on the grid twice as wide are drawn at
// `fade` opacity, so a view can thin the grid out gradually as it zooms.
export function drawPaper(ctx, paper, { region = PAGE_REGION, dots = true, step = GRID, radius = DOT_RADIUS, fade = 1 } = {}) {
  ctx.fillStyle = paper.color;
  ctx.fillRect(region.x, region.y, region.width, region.height);
  if (!dots) return;
  ctx.fillStyle = paper.dots;
  const x0 = Math.ceil(region.x / step);
  const y0 = Math.ceil(region.y / step);
  const x1 = Math.floor((region.x + region.width) / step);
  const y1 = Math.floor((region.y + region.height) / step);
  for (const [coarse, alpha] of [[true, 1], [false, fade]]) {
    if (alpha <= 0) continue;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        if ((i % 2 === 0 && j % 2 === 0) !== coarse) continue;
        ctx.moveTo(i * step + radius, j * step);
        ctx.arc(i * step, j * step, radius, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const PAGE_REGION = { x: 0, y: 0, width: PAGE.width, height: PAGE.height };

// The dot spacing for a drawing at `scale` px per page unit: GRID times a
// power of two, the smallest whose dots are at least `minPx` px apart.
export function dotStep(scale, minPx) {
  return GRID * 2 ** Math.ceil(Math.log2(minPx / (GRID * scale)));
}

// The area Copy takes from a whole page: everything on it, with a margin of
// a twentieth of its longest side, so a drawing fills the copy at any size.
// An empty page gives the frame a new page opens on.
export function copyRegion(page) {
  const b = contentBounds(page);
  if (!b) return PAGE_REGION;
  const pad = Math.max(b.width, b.height) * 0.05;
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}

// The px per page unit a copy renders at: `base`, with the longest side
// then kept between 800 and 4096 px, so a drawing made far zoomed in or out
// still copies at a readable size.
export function copyScale(region, base = 1) {
  const longest = Math.max(region.width, region.height);
  return Math.min(4096 / longest, Math.max(800 / longest, base));
}

// The area a reset view shows: the opening frame together with the area
// Copy takes.
export function homeRegion(page) {
  const b = copyRegion(page);
  const x = Math.min(0, b.x);
  const y = Math.min(0, b.y);
  return { x, y, width: Math.max(PAGE.width, b.x + b.width) - x, height: Math.max(PAGE.height, b.y + b.height) - y };
}

// Grows `region` around its center to the width-to-height ratio `aspect`.
export function fitAspect(region, aspect) {
  const width = Math.max(region.width, region.height * aspect);
  const height = width / aspect;
  return { x: region.x + (region.width - width) / 2, y: region.y + (region.height - height) / 2, width, height };
}

// Draws a stroke from point index `from` onward. Each curve depends only on
// points up to its own index, so drawing new points as they arrive gives
// nearly the same pixels as redrawing the whole stroke later.
export function drawStroke(ctx, stroke, from = 0) {
  const pts = stroke.points;
  if (!pts.length) return;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (from === 0) {
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], widthAt(stroke, pts[0][2]) / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = Math.max(1, from); i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const start = i === 1 ? a : midpoint(pts[i - 2], a);
    const end = midpoint(a, b);
    ctx.lineWidth = widthAt(stroke, (a[2] + b[2]) / 2);
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.quadraticCurveTo(a[0], a[1], end[0], end[1]);
    ctx.stroke();
  }

  // The curves above end halfway along the last segment. This straight
  // tail reaches the final point, so a cut line ends exactly at the cut.
  if (pts.length > 1) {
    const a = pts.at(-2);
    const b = pts.at(-1);
    const start = midpoint(a, b);
    ctx.lineWidth = widthAt(stroke, b[2]);
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
}

export function drawStrokes(ctx, page) {
  for (const stroke of page.strokes) drawStroke(ctx, stroke);
}

// The page's ink inside `region` alone as a grid of cells, `scale` cells
// per page unit, nonzero where any ink touches the cell. The fill tool uses
// it as the walls a fill cannot cross.
export function inkWall(page, region, scale) {
  const width = Math.max(1, Math.round(region.width * scale));
  const height = Math.max(1, Math.round(region.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
  drawStrokes(ctx, page);
  const { data } = ctx.getImageData(0, 0, width, height);
  const wall = new Uint8Array(width * height);
  for (let i = 0; i < wall.length; i++) wall[i] = data[i * 4 + 3] > 0 ? 1 : 0;
  return { wall, width, height };
}

// Renders the part of a page inside `region`, { x, y, width, height } in
// page units, paper included, onto a new canvas `scale` px per page unit.
// With `dots: false`, the paper has no dot grid. The dots sit at least
// `dotPx` px apart on the canvas, so a region of any size shows a similar
// number of them; see dotStep.
export function renderPage(page, scale = 1, region = PAGE_REGION, { dots = true, dotPx = 32 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(region.width * scale));
  canvas.height = Math.max(1, Math.round(region.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
  const step = dotStep(scale, dotPx);
  drawPaper(ctx, page.paper, { region, dots, step, radius: (DOT_RADIUS * step) / GRID });
  drawItems(ctx, page);
  drawStrokes(ctx, page);
  return canvas;
}

// Pasted images load from the server once and stay cached. An image that
// is still loading is skipped; when it arrives, the listeners redraw.
const images = new Map();
const loadListeners = new Set();

export function onImageLoad(listener) {
  loadListeners.add(listener);
}

export function loadImage(asset) {
  let img = images.get(asset);
  if (!img) {
    img = new Image();
    img.onload = () => loadListeners.forEach((listener) => listener(asset));
    img.src = `/assets/${asset}`;
    images.set(asset, img);
  }
  return img;
}

export function drawItems(ctx, page) {
  for (const item of pageItems(page)) {
    if (item.kind === 'image') {
      const img = loadImage(item.asset);
      if (img.complete && img.naturalWidth) ctx.drawImage(img, item.x, item.y, item.width, item.height);
    } else if (item.kind === 'fill') {
      ctx.fillStyle = item.color;
      ctx.beginPath();
      for (const ring of item.rings) {
        ring.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, item.x + x, item.y + y));
        ctx.closePath();
      }
      ctx.fill('evenodd');
    } else if (item.kind === 'text') {
      ctx.fillStyle = item.color;
      ctx.font = `${item.size}px ${TEXT_FONT}`;
      ctx.textBaseline = 'top';
      const lines = wrapText(ctx, item.text, item.width);
      lines.forEach((line, i) => ctx.fillText(line, item.x, item.y + i * item.size * LINE_HEIGHT));
    }
  }
}

// Measures a text block before it is placed: the width it needs, up to
// `maxWidth`, and the height of its wrapped lines.
export function measureText(text, size, maxWidth) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${size}px ${TEXT_FONT}`;
  const natural = Math.max(...text.split('\n').map((line) => ctx.measureText(line).width));
  const width = Math.min(maxWidth, Math.ceil(natural) + 2);
  return { width, height: wrapText(ctx, text, width).length * size * LINE_HEIGHT };
}

// Breaks text at newlines, then at spaces so no line is wider than `width`.
// A single word wider than `width` stays on its own line.
export function wrapText(ctx, text, width) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > width) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

export function widthAt(stroke, pressure) {
  return stroke.width * (0.35 + 0.9 * pressure);
}

export function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
