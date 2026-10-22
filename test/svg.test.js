import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageSvg } from '../public/js/svg.js';
import { contentBounds } from '../public/js/shared/ops.js';

const paper = { color: '#1d1e21', dots: '#7d7f85' };
const stroke = { id: 's1', color: '#ff0000', width: 4, points: [[10, 10, 0.5], [20, 20, 0.5], [30, 10, 0.5]] };
// Each character measures 10 units, so wrapping is predictable.
const measure = { font: '', measureText: (s) => ({ width: s.length * 10 }) };

test('pageSvg writes the paper, the dot grid, and each stroke as vector shapes', () => {
  const svg = pageSvg({ paper, strokes: [stroke], items: [] });
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 1600 1120"/);
  assert.match(svg, /<pattern id="dots"/);
  assert.match(svg, /<g fill="none" stroke="#ff0000"/);
  // Every curve has the same pressure, so the curves and the straight tail
  // share one path after the starting dot.
  assert.match(svg, /<circle cx="10" cy="10" r="1.6" fill="#ff0000" stroke="none"\/><path d="M10 10Q10 10 15 15Q20 20 25 15L30 10" stroke-width="3"\/>/);
  assert.ok(svg.endsWith('</svg>'));
});

test('pageSvg crops to a region, sizes a small region up to 800 px, drops the dots, and skips strokes outside it', () => {
  const far = { ...stroke, id: 's2', points: [[1000, 1000, 0.5]] };
  const svg = pageSvg({ paper, strokes: [stroke, far], items: [] }, { region: { x: 0, y: 0, width: 50, height: 50 }, dots: false });
  assert.match(svg, /viewBox="0 0 50 50" width="800" height="800"/);
  assert.doesNotMatch(svg, /pattern/);
  assert.equal(svg.match(/<g /g).length, 1);
});

test('pageSvg embeds pasted images as data URLs and escapes text', () => {
  const items = [
    { id: 'i1', kind: 'image', asset: 'a.png', x: 0, y: 0, width: 100, height: 50 },
    { id: 't1', kind: 'text', text: 'a <b> & c', size: 20, color: '#fff', x: 0, y: 0, width: 50, height: 52 },
  ];
  const svg = pageSvg({ paper, strokes: [], items }, { images: new Map([['a.png', 'data:image/png;base64,AAAA']]), measure });
  assert.match(svg, /<image x="0" y="0" width="100" height="50" preserveAspectRatio="none" href="data:image\/png;base64,AAAA"\/>/);
  assert.match(svg, /<tspan x="0" y="0">a &lt;b&gt;<\/tspan><tspan x="0" y="26">&amp; c<\/tspan>/);
});

test('contentBounds covers ink and items, and an empty page has none', () => {
  assert.equal(contentBounds({ strokes: [], items: [] }), null);
  const page = { strokes: [{ ...stroke, points: [[-500, 10, 0.5], [30, 9000, 0.5]] }], items: [{ x: 100, y: -40, width: 10, height: 10 }] };
  assert.deepEqual(contentBounds(page), { x: -502.5, y: -40, width: 612.5, height: 9042.5 });
});

test('pageSvg keeps detail for a drawing made far zoomed in', () => {
  const tiny = { id: 't', color: '#ffffff', width: 0.004, points: [[5000, 5000, 0.5], [5000.012, 5000.034, 0.5]] };
  const svg = pageSvg({ paper, strokes: [tiny], items: [] }, { region: { x: 4999.99, y: 4999.99, width: 0.06, height: 0.06 }, dots: false });
  assert.match(svg, /L5000\.012 5000\.034/);
  assert.doesNotMatch(svg, /stroke-width="0"/);
});
