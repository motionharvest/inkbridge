import { GRID, PAGE } from './shared/ops.js';

const DOT_RADIUS = 1.7;

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
export function renderPage(page, scale = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(PAGE.width * scale);
  canvas.height = Math.round(PAGE.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawPaper(ctx, page.paper);
  drawStrokes(ctx, page);
  return canvas;
}

function widthAt(stroke, pressure) {
  return stroke.width * (0.35 + 0.9 * pressure);
}

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
