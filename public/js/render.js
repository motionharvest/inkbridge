import { GRID, PAGE, pageItems } from './shared/ops.js';

const DOT_RADIUS = 1.7;
const TEXT_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const LINE_HEIGHT = 1.3;

// All drawing functions work in page units. The caller sets the canvas
// transform that maps page units to device pixels.

export function drawPaper(ctx, paper) {
  ctx.fillStyle = paper.color;
  ctx.fillRect(0, 0, PAGE.width, PAGE.height);
  ctx.fillStyle = paper.dots;
  ctx.beginPath();
  for (let y = GRID; y < PAGE.height; y += GRID) {
    for (let x = GRID; x < PAGE.width; x += GRID) {
      ctx.moveTo(x + DOT_RADIUS, y);
      ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
    }
  }
  ctx.fill();
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

// Renders a page, paper included, onto a new canvas `scale` times page size.
// With a region { x, y, width, height } in page units, it renders only that
// part of the page.
export function renderPage(page, scale = 1, region = { x: 0, y: 0, width: PAGE.width, height: PAGE.height }) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(region.width * scale));
  canvas.height = Math.max(1, Math.round(region.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
  drawPaper(ctx, page.paper);
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
function wrapText(ctx, text, width) {
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

function widthAt(stroke, pressure) {
  return stroke.width * (0.35 + 0.9 * pressure);
}

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
