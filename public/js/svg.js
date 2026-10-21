import { GRID, PAGE, pageItems } from './shared/ops.js';
import { DOT_RADIUS, LINE_HEIGHT, TEXT_FONT, midpoint, widthAt, wrapText } from './render.js';

// Writes a page as SVG source, drawn the same way the canvas draws it.
// The paper, the ink, and text are vectors. A pasted image is a bitmap, so
// it travels inside the SVG as a data URL.
//
// `images` maps an asset name to its data URL; an image missing from it is
// left out. `measure` is a 2D context used only to measure text, so text
// wraps at the same words as on the canvas.
export function pageSvg(page, { region = { x: 0, y: 0, width: PAGE.width, height: PAGE.height }, dots = true, images = new Map(), measure } = {}) {
  const { x, y, width, height } = region;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x)} ${n(y)} ${n(width)} ${n(height)}" width="${n(width)}" height="${n(height)}">`,
  ];

  out.push(`<rect x="0" y="0" width="${PAGE.width}" height="${PAGE.height}" fill="${attr(page.paper.color)}"/>`);
  if (dots) {
    // The canvas puts a dot at every multiple of GRID strictly inside the
    // page. A pattern tile centered on each of those points draws the same
    // dots, and the rectangle it fills stops half a tile short of the edges.
    out.push(
      `<defs><pattern id="dots" patternUnits="userSpaceOnUse" x="${GRID / 2}" y="${GRID / 2}" width="${GRID}" height="${GRID}">` +
        `<circle cx="${GRID / 2}" cy="${GRID / 2}" r="${DOT_RADIUS}" fill="${attr(page.paper.dots)}"/></pattern></defs>`,
      `<rect x="${GRID / 2}" y="${GRID / 2}" width="${PAGE.width - GRID}" height="${PAGE.height - GRID}" fill="url(#dots)"/>`,
    );
  }

  for (const item of pageItems(page)) {
    if (!overlaps(item, region)) continue;
    if (item.kind === 'image') {
      const href = images.get(item.asset);
      if (href) out.push(`<image x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" preserveAspectRatio="none" href="${href}"/>`);
    } else if (item.kind === 'text' && measure) {
      measure.font = `${item.size}px ${TEXT_FONT}`;
      const lines = wrapText(measure, item.text, item.width)
        .map((line, i) => `<tspan x="${n(item.x)}" y="${n(item.y + i * item.size * LINE_HEIGHT)}">${text(line)}</tspan>`)
        .join('');
      out.push(
        `<text font-family="${attr(TEXT_FONT)}" font-size="${n(item.size)}" fill="${attr(item.color)}" dominant-baseline="text-before-edge" xml:space="preserve">${lines}</text>`,
      );
    }
  }

  for (const stroke of page.strokes) {
    if (stroke.points.length && overlaps(strokeBounds(stroke), region)) out.push(strokeSvg(stroke));
  }

  out.push('</svg>');
  return out.join('\n');
}

// The canvas draws a stroke as one dot and then one curve per point, each
// curve with its own width from the pressure. The SVG draws the same curves.
// Neighboring curves whose widths round to the same half unit share one
// path, which keeps a pressure line's shape while making the source many
// times shorter.
function strokeSvg(stroke) {
  const pts = stroke.points;
  const parts = [`<circle cx="${n(pts[0][0])}" cy="${n(pts[0][1])}" r="${n(widthAt(stroke, pts[0][2]) / 2)}" fill="${attr(stroke.color)}" stroke="none"/>`];
  let width = null;
  let d = '';
  const segment = (w, from, draw) => {
    w = Math.round(w * 2) / 2;
    if (w !== width) {
      if (d) parts.push(`<path d="${d}" stroke-width="${n(width)}"/>`);
      width = w;
      d = `M${n(from[0])} ${n(from[1])}`;
    }
    d += draw;
  };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const start = i === 1 ? a : midpoint(pts[i - 2], a);
    const end = midpoint(a, b);
    segment(widthAt(stroke, (a[2] + b[2]) / 2), start, `Q${n(a[0])} ${n(a[1])} ${n(end[0])} ${n(end[1])}`);
  }
  // The curves end halfway along the last segment. This straight tail
  // reaches the final point, as it does on the canvas.
  if (pts.length > 1) {
    const b = pts.at(-1);
    segment(widthAt(stroke, b[2]), midpoint(pts.at(-2), b), `L${n(b[0])} ${n(b[1])}`);
  }
  if (d) parts.push(`<path d="${d}" stroke-width="${n(width)}"/>`);
  const color = attr(stroke.color);
  return `<g fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round">${parts.join('')}</g>`;
}

// The rectangle a stroke covers, widened by its thickest possible line.
function strokeBounds(stroke) {
  const xs = stroke.points.map((p) => p[0]);
  const ys = stroke.points.map((p) => p[1]);
  const pad = widthAt(stroke, 1);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y };
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// Numbers keep one decimal at most, a tenth of a page unit, which is below a pixel and keeps
// the source short.
function n(value) {
  return String(Math.round(value * 10) / 10);
}

function text(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attr(value) {
  return text(value).replace(/"/g, '&quot;');
}
