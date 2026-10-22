// Every change to a space is an op. A device applies the op to its own copy,
// then sends it. The server applies the same function to its copy and relays
// the op to the other devices. Because both sides run this one file, they
// cannot disagree about what an op means.
//
// Handlers copy and validate everything they keep, so a caller can reuse or
// mutate the op afterwards without touching stored state.

// A page has no edges. PAGE is the frame a new page opens on, and the
// smallest area a page shows when its view is reset; the drawing itself
// can reach any distance from it.
export const PAGE = { width: 1600, height: 1120 };
export const GRID = 32;

// Coordinates and sizes are kept finite but otherwise free. Pen widths and
// text sizes scale with zoom, so they range over many orders of magnitude.
const FAR = 1e9;

// Graphite: a near-black gray with a mid-gray dot grid.
export const DEFAULT_PAPER = { color: '#1d1e21', dots: '#7d7f85' };

const MAX_POINTS_PER_STROKE = 20000;
const MAX_TITLE = 80;
const MAX_TEXT = 5000;
const MAX_FILL_POINTS = 20000;

// Pasted images live as files on the server, named by a hash of their bytes.
// An image item refers to its file by that name.
export const ASSET = /^[a-f0-9]{32}\.(png|jpg|gif|webp)$/;

export function emptySpace(code) {
  return { code, notebooks: [], pages: {} };
}

// Returns true when the op changed the space.
export function applyOp(space, op) {
  const handler = handlers[op?.type];
  if (!handler) return false;
  return handler(space, op) !== false;
}

export function newId() {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('');
}

export function findNotebook(space, id) {
  return space.notebooks.find((n) => n.id === id);
}

// Pages saved before pasting existed have no items list.
export function pageItems(page) {
  return page.items ?? [];
}

export function findStroke(page, id) {
  for (let i = page.strokes.length - 1; i >= 0; i--) {
    if (page.strokes[i].id === id) return page.strokes[i];
  }
  return undefined;
}

// The rectangle that holds everything drawn or pasted on a page, in page
// units, or null for an empty page. A line reaches past its points by half
// its widest pressure width.
export function contentBounds(page) {
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const stroke of page.strokes) {
    const reach = stroke.width * 0.625;
    for (const [x, y] of stroke.points) {
      left = Math.min(left, x - reach);
      top = Math.min(top, y - reach);
      right = Math.max(right, x + reach);
      bottom = Math.max(bottom, y + reach);
    }
  }
  for (const item of pageItems(page)) {
    left = Math.min(left, item.x);
    top = Math.min(top, item.y);
    right = Math.max(right, item.x + item.width);
    bottom = Math.max(bottom, item.y + item.height);
  }
  if (left > right) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const handlers = {
  'notebook.create'(space, { notebook, page }) {
    if (!isId(notebook?.id) || !isId(page?.id)) return false;
    if (findNotebook(space, notebook.id) || space.pages[page.id]) return false;
    space.pages[page.id] = newPage(page);
    space.notebooks.push({
      id: notebook.id,
      title: cleanTitle(notebook.title),
      createdAt: Number(notebook.createdAt) || Date.now(),
      pageIds: [page.id],
    });
  },

  'notebook.rename'(space, { id, title }) {
    const notebook = findNotebook(space, id);
    if (!notebook) return false;
    notebook.title = cleanTitle(title);
  },

  'notebook.delete'(space, { id }) {
    const notebook = findNotebook(space, id);
    if (!notebook) return false;
    for (const pageId of notebook.pageIds) delete space.pages[pageId];
    space.notebooks = space.notebooks.filter((n) => n !== notebook);
  },

  'page.create'(space, { notebookId, page, index }) {
    const notebook = findNotebook(space, notebookId);
    if (!notebook || !isId(page?.id) || space.pages[page.id]) return false;
    space.pages[page.id] = newPage(page);
    const at = Number.isInteger(index) ? clamp(index, 0, notebook.pageIds.length) : notebook.pageIds.length;
    notebook.pageIds.splice(at, 0, page.id);
  },

  // Removes a page and closes the gap. A notebook always keeps one page.
  'page.delete'(space, { notebookId, pageId }) {
    const notebook = findNotebook(space, notebookId);
    if (!notebook || notebook.pageIds.length <= 1 || !notebook.pageIds.includes(pageId)) return false;
    notebook.pageIds = notebook.pageIds.filter((id) => id !== pageId);
    delete space.pages[pageId];
  },

  'page.paper'(space, { pageId, paper }) {
    const page = space.pages[pageId];
    if (!page) return false;
    page.paper = cleanPaper(paper);
  },

  'stroke.start'(space, { pageId, stroke }) {
    const page = space.pages[pageId];
    const clean = page && cleanStroke(page, stroke);
    if (!clean) return false;
    page.strokes.push(clean);
  },

  // Removes some strokes and inserts others in one step. The eraser uses
  // it to swap a line for the pieces left after a cut, and undo uses it to
  // swap the pieces back for the line. New strokes go in at `index`, or
  // where the first removed stroke was, or at the end.
  'stroke.replace'(space, { pageId, remove = [], add = [], index }) {
    const page = space.pages[pageId];
    if (!page || !Array.isArray(remove) || !Array.isArray(add)) return false;
    const removing = new Set(remove);
    const first = page.strokes.findIndex((s) => removing.has(s.id));
    const kept = page.strokes.filter((s) => !removing.has(s.id));
    const before = page.strokes;
    page.strokes = kept;
    const added = [];
    for (const stroke of add) {
      const clean = cleanStroke(page, stroke);
      if (clean && !added.some((s) => s.id === clean.id)) added.push(clean);
    }
    if (kept.length === before.length && !added.length) return false;
    const at = Number.isInteger(index) ? index : first >= 0 ? first : kept.length;
    kept.splice(clamp(at, 0, kept.length), 0, ...added);
  },

  // A pasted image or block of text. Items sit under the ink, so a pasted
  // picture can be drawn on.
  'item.add'(space, { pageId, item }) {
    const page = space.pages[pageId];
    const clean = page && cleanItem(item);
    if (!clean || pageItems(page).some((i) => i.id === clean.id)) return false;
    page.items = [...pageItems(page), clean];
  },

  'item.remove'(space, { pageId, itemId }) {
    const page = space.pages[pageId];
    if (!page || !pageItems(page).some((i) => i.id === itemId)) return false;
    page.items = page.items.filter((i) => i.id !== itemId);
  },

  // Moves strokes and items by the same offset. The lasso uses it while a
  // selection is dragged, and undo uses it to move them back.
  'page.move'(space, { pageId, strokeIds = [], itemIds = [], dx, dy }) {
    const page = space.pages[pageId];
    if (!page || !Array.isArray(strokeIds) || !Array.isArray(itemIds)) return false;
    dx = clamp(Number(dx), -FAR, FAR);
    dy = clamp(Number(dy), -FAR, FAR);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return false;
    const strokes = new Set(strokeIds);
    const items = new Set(itemIds);
    let moved = false;
    for (const stroke of page.strokes) {
      if (!strokes.has(stroke.id)) continue;
      for (const p of stroke.points) {
        p[0] += dx;
        p[1] += dy;
      }
      moved = true;
    }
    for (const item of pageItems(page)) {
      if (!items.has(item.id)) continue;
      item.x = clamp(item.x + dx, -FAR, FAR);
      item.y = clamp(item.y + dy, -FAR, FAR);
      moved = true;
    }
    if (!moved) return false;
  },

  // Removes strokes and items in one step. Removing a lasso selection uses
  // it; undo puts them back with stroke.replace and item.add.
  'page.remove'(space, { pageId, strokeIds = [], itemIds = [] }) {
    const page = space.pages[pageId];
    if (!page || !Array.isArray(strokeIds) || !Array.isArray(itemIds)) return false;
    const strokes = new Set(strokeIds);
    const items = new Set(itemIds);
    const before = page.strokes.length + pageItems(page).length;
    page.strokes = page.strokes.filter((s) => !strokes.has(s.id));
    page.items = pageItems(page).filter((i) => !items.has(i.id));
    if (page.strokes.length + page.items.length === before) return false;
  },

  'stroke.extend'(space, { pageId, strokeId, points }) {
    const page = space.pages[pageId];
    const stroke = page && findStroke(page, strokeId);
    if (!stroke) return false;
    const room = MAX_POINTS_PER_STROKE - stroke.points.length;
    const added = cleanPoints(points).slice(0, Math.max(0, room));
    if (!added.length) return false;
    stroke.points.push(...added);
  },

  'stroke.remove'(space, { pageId, strokeId }) {
    const page = space.pages[pageId];
    if (!page) return false;
    const before = page.strokes.length;
    page.strokes = page.strokes.filter((s) => s.id !== strokeId);
    if (page.strokes.length === before) return false;
  },
};

function cleanStroke(page, stroke) {
  if (!isId(stroke?.id) || findStroke(page, stroke.id)) return null;
  const points = cleanPoints(stroke.points).slice(0, MAX_POINTS_PER_STROKE);
  if (!points.length) return null;
  return {
    id: stroke.id,
    color: isColor(stroke.color) ? stroke.color : '#ffffff',
    width: clamp(Number(stroke.width) || 4, 1e-6, 1e6),
    points,
  };
}

// An item is an image { kind: 'image', asset, x, y, width, height }, a
// text block { kind: 'text', text, x, y, width, height, size, color }, or a
// fill { kind: 'fill', x, y, width, height, color, rings }, in page units.
// Text wraps to `width`; `height` is the wrapped height when pasted. A
// fill's rings are closed outlines of [x, y] points relative to (x, y),
// drawn with the even-odd rule.
function cleanItem(item) {
  if (!isId(item?.id)) return null;
  const x = clamp(Number(item.x) || 0, -FAR, FAR);
  const y = clamp(Number(item.y) || 0, -FAR, FAR);
  const width = clamp(Number(item.width) || 0, 1e-6, FAR);
  if (item.kind === 'image' && ASSET.test(item.asset)) {
    const height = clamp(Number(item.height) || 0, 1e-6, FAR);
    return { id: item.id, kind: 'image', asset: item.asset, x, y, width, height };
  }
  if (item.kind === 'text' && typeof item.text === 'string' && item.text.trim()) {
    return {
      id: item.id,
      kind: 'text',
      text: item.text.slice(0, MAX_TEXT),
      x,
      y,
      width,
      size: clamp(Number(item.size) || 28, 1e-6, 1e6),
      height: clamp(Number(item.height) || 28, 1e-6, FAR),
      color: isColor(item.color) ? item.color : '#ffffff',
    };
  }
  if (item.kind === 'fill' && isColor(item.color) && Array.isArray(item.rings)) {
    let room = MAX_FILL_POINTS;
    const rings = [];
    for (const ring of item.rings) {
      const points = cleanPoints(Array.isArray(ring) ? ring.map((p) => (Array.isArray(p) ? [p[0], p[1], 0] : p)) : [])
        .slice(0, room)
        .map(([px, py]) => [px, py]);
      room -= points.length;
      if (points.length >= 3) rings.push(points);
    }
    if (!rings.length) return null;
    const height = clamp(Number(item.height) || 0, 1e-6, FAR);
    return { id: item.id, kind: 'fill', x, y, width, height, color: item.color, rings };
  }
  return null;
}

function newPage(page) {
  return { id: page.id, paper: cleanPaper(page.paper), strokes: [], items: [] };
}

function cleanPaper(paper) {
  return {
    color: isColor(paper?.color) ? paper.color : DEFAULT_PAPER.color,
    dots: isColor(paper?.dots) ? paper.dots : DEFAULT_PAPER.dots,
  };
}

// A point is [x, y, pressure] in page units, with pressure from 0 to 1.
function cleanPoints(points) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (const p of points) {
    if (!Array.isArray(p)) continue;
    const [x, y, pressure] = p.map(Number);
    if (![x, y, pressure].every(Number.isFinite)) continue;
    out.push([x, y, clamp(pressure, 0, 1)]);
  }
  return out;
}

function cleanTitle(title) {
  const text = String(title ?? '').trim().slice(0, MAX_TITLE);
  return text || 'Untitled';
}

function isId(value) {
  return typeof value === 'string' && /^[a-z0-9]{6,32}$/.test(value);
}

function isColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
