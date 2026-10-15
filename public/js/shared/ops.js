// Every change to a space is an op. A device applies the op to its own copy,
// then sends it. The server applies the same function to its copy and relays
// the op to the other devices. Because both sides run this one file, they
// cannot disagree about what an op means.
//
// Handlers copy and validate everything they keep, so a caller can reuse or
// mutate the op afterwards without touching stored state.

export const PAGE = { width: 1600, height: 1120 };
export const GRID = 32;

export const DEFAULT_PAPER = { color: '#231f29', dots: '#9b99a1' };

const MAX_POINTS_PER_STROKE = 20000;
const MAX_TITLE = 80;

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

export function findStroke(page, id) {
  for (let i = page.strokes.length - 1; i >= 0; i--) {
    if (page.strokes[i].id === id) return page.strokes[i];
  }
  return undefined;
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
    width: clamp(Number(stroke.width) || 4, 0.5, 80),
    points,
  };
}

function newPage(page) {
  return { id: page.id, paper: cleanPaper(page.paper), strokes: [] };
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
