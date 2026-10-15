import { io } from '/socket.io/socket.io.esm.min.js';
import { Board } from './board.js';
import { cutStrokes } from './erase.js';
import { renderPage } from './render.js';
import { applyOp, DEFAULT_PAPER, findNotebook, findStroke, newId } from './shared/ops.js';

// The pen and the eraser each have three size slots, and the pen has color
// slots. Tapping a slot selects it. Tapping the selected size slot opens a
// slider that changes that slot's size. Tapping the selected color slot
// opens a color picker for that slot, and the plus button adds a slot. Slots keep their
// values, so the toolbar stays the same and becomes a personal palette.
// Sizes are in page units: line width for the pen, circle radius for the
// eraser.
const SIZES = {
  pen: { min: 1, max: 24, step: 0.5, defaults: [2, 4, 8] },
  erase: { min: 4, max: 60, step: 1, defaults: [8, 16, 32] },
};
const DEFAULT_COLORS = ['#f4f1ea', '#ffd166', '#ff6b8b', '#6ee7b7', '#7cc4ff'];
const NEW_COLORS = ['#c4a7ff', '#ff8a5c', '#a9a6b0', '#5eead4', '#f9a8d4', '#fde68a'];
const MAX_COLORS = 12;
const PAPERS = [
  { name: 'Plum night', color: '#231f29', dots: '#9b99a1' },
  { name: 'Graphite', color: '#1d1e21', dots: '#7d7f85' },
  { name: 'Ink blue', color: '#1a2030', dots: '#7f8aa3' },
  { name: 'Paper', color: '#f6f3ec', dots: '#b9b4aa' },
];

const KEY = {
  code: 'inkbridge.code',
  tool: 'inkbridge.tools',
  paper: 'inkbridge.paper',
  follow: 'inkbridge.follow',
  lastPages: 'inkbridge.lastPages',
};

const $ = (selector) => document.querySelector(selector);
const els = {
  pair: $('#pair'),
  pairError: $('#pair-error'),
  joinForm: $('#join-form'),
  joinCode: $('#join-code'),
  createSpace: $('#create-space'),
  library: $('#library'),
  notebooks: $('#notebooks'),
  spaceCode: $('#space-code'),
  peers: $('#peers'),
  leave: $('#leave'),
  notebook: $('#notebook'),
  back: $('#back'),
  title: $('#title'),
  penTool: $('#pen-tool'),
  eraserTool: $('#eraser-tool'),
  sizeSlots: $('#size-slots'),
  colorSlots: $('#color-slots'),
  addColor: $('#add-color'),
  sizeMenu: $('#size-menu'),
  sizeSlider: $('#size-slider'),
  undo: $('#undo'),
  stage: $('#stage'),
  paperButton: $('#paper-button'),
  paperMenu: $('#paper-menu'),
  copy: $('#copy'),
  prev: $('#prev'),
  next: $('#next'),
  pageNumber: $('#page-number'),
  follow: $('#follow'),
  status: $('#status'),
  toast: $('#toast'),
};

let space = null;
let current = { notebookId: null, pageId: null };
let tool = loadTool();
let follow = localStorage.getItem(KEY.follow) !== 'off';
let peers = 1;
const undoSteps = new Map(); // pageId -> this device's undo steps on that page
let live = null; // the stroke this device is drawing: { pageId, strokeId, unsent: [] }
let erasing = null; // the eraser pass in progress; see startErase

const board = new Board(els.stage, {
  onStrokeStart: startStroke,
  onStrokeExtend: extendStroke,
  onStrokeEnd: endStroke,
  onSwipe: (direction) => go(direction),
  onTwoFingerTap: () => undo(),
});

// --- Connection ------------------------------------------------------------

// The space code lives in local storage and in the address (?space=123456).
// The address copy matters on the iPad: a Home Screen icon has its own
// storage, but it keeps the address it was added with, so it opens the same
// space with no code to type.
const codeInAddress = new URLSearchParams(location.search).get('space');
if (/^\d{6}$/.test(codeInAddress ?? '')) localStorage.setItem(KEY.code, codeInAddress);

const socket = io({ auth: (cb) => cb({ code: localStorage.getItem(KEY.code) }) });

socket.on('connect', () => {
  setStatus();
  const code = localStorage.getItem(KEY.code);
  if (!code) return show('pair');
  socket.emit('space:join', { code }, (res) => {
    if (res.ok) return loadSpace(res.space, res.view);
    forgetSpace();
    show('pair', res.error);
  });
});

socket.on('disconnect', () => setStatus());

socket.on('peers', (count) => {
  peers = count;
  setStatus();
});

socket.on('op', (op) => {
  if (space && applyOp(space, op)) afterOp(op);
});

socket.on('view', (view) => {
  if (follow && space && current.pageId) openPage(view.notebookId, view.pageId, { broadcast: false });
});

function loadSpace(nextSpace, view) {
  space = nextSpace;
  localStorage.setItem(KEY.code, space.code);
  history.replaceState(null, '', `/?space=${space.code}`);
  els.spaceCode.textContent = formatCode(space.code);
  const stillThere = current.pageId && space.pages[current.pageId];
  if (stillThere) return openPage(current.notebookId, current.pageId, { broadcast: false, animate: false });
  if (view && space.pages[view.pageId]) return openPage(view.notebookId, view.pageId, { broadcast: false, animate: false });
  showLibrary();
}

function commit(op) {
  if (!applyOp(space, op)) return false;
  socket.emit('op', op);
  afterOp(op);
  return true;
}

// Updates the screen after an op, from this device or another.
function afterOp(op) {
  const onPage = op.pageId && op.pageId === current.pageId;
  switch (op.type) {
    case 'stroke.start':
      if (onPage) board.drawStroke(findStroke(space.pages[op.pageId], op.stroke.id));
      break;
    case 'stroke.extend':
      if (onPage) {
        const stroke = findStroke(space.pages[op.pageId], op.strokeId);
        board.drawStroke(stroke, stroke.points.length - op.points.length);
      }
      break;
    case 'stroke.remove':
    case 'stroke.replace':
    case 'page.paper':
      if (onPage) board.scheduleRedraw();
      break;
    default:
      if (current.notebookId && !findNotebook(space, current.notebookId)) return showLibrary();
      renderChrome();
  }
  if (!current.pageId) scheduleLibrary();
}

// --- Views -----------------------------------------------------------------

function show(name, error = '') {
  for (const view of ['pair', 'library', 'notebook']) els[view].hidden = view !== name;
  els.pairError.textContent = error;
  if (name === 'pair') els.joinCode.focus();
}

function showLibrary() {
  current = { notebookId: null, pageId: null };
  show('library');
  renderLibrary();
}

let libraryTimer = null;
function scheduleLibrary() {
  clearTimeout(libraryTimer);
  libraryTimer = setTimeout(() => !current.pageId && renderLibrary(), 300);
}

function renderLibrary() {
  els.notebooks.replaceChildren();
  const add = document.createElement('button');
  add.className = 'card new';
  add.innerHTML = '<span class="plus">+</span><span>New notebook</span>';
  add.onclick = createNotebook;
  els.notebooks.append(add);

  for (const notebook of space.notebooks) {
    const card = document.createElement('div');
    card.className = 'card';
    const cover = renderPage(space.pages[notebook.pageIds[0]], 0.16);
    cover.className = 'cover';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = notebook.title;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${notebook.pageIds.length} ${notebook.pageIds.length === 1 ? 'page' : 'pages'}`;
    const rename = iconButton('Rename', '✎', () => {
      const title = prompt('Rename notebook', notebook.title);
      if (title !== null) commit({ type: 'notebook.rename', id: notebook.id, title });
    });
    const remove = iconButton('Delete', '✕', () => {
      if (confirm(`Delete “${notebook.title}” and all its pages?`)) commit({ type: 'notebook.delete', id: notebook.id });
    });
    meta.append(name, count, rename, remove);
    card.append(cover, meta);
    cover.onclick = () => openNotebook(notebook);
    els.notebooks.append(card);
  }
}

function createNotebook() {
  const title = prompt('Notebook name', `Notebook ${space.notebooks.length + 1}`);
  if (title === null) return;
  const notebook = { id: newId(), title, createdAt: Date.now() };
  const page = { id: newId(), paper: readJson(KEY.paper) ?? DEFAULT_PAPER };
  if (commit({ type: 'notebook.create', notebook, page })) openPage(notebook.id, page.id, { animate: false });
}

function openNotebook(notebook) {
  const last = readJson(KEY.lastPages)?.[notebook.id];
  const pageId = notebook.pageIds.includes(last) ? last : notebook.pageIds[0];
  openPage(notebook.id, pageId, { animate: false });
}

// Shows a page. When the page is in the open notebook, the sheet slides in
// the direction of travel.
function openPage(notebookId, pageId, { broadcast = true, animate = true } = {}) {
  const notebook = findNotebook(space, notebookId);
  if (!notebook || !space.pages[pageId]) return;
  if (pageId === current.pageId) return;
  const from = current.notebookId === notebookId ? notebook.pageIds.indexOf(current.pageId) : -1;
  const to = notebook.pageIds.indexOf(pageId);
  const swap = () => {
    current = { notebookId, pageId };
    board.setPage(space.pages[pageId]);
    renderChrome();
  };
  if (els.notebook.hidden) {
    show('notebook');
    board.layout();
  }
  if (animate && from >= 0) board.slide(Math.sign(to - from), swap);
  else swap();
  const lastPages = readJson(KEY.lastPages) ?? {};
  lastPages[notebookId] = pageId;
  localStorage.setItem(KEY.lastPages, JSON.stringify(lastPages));
  if (broadcast) socket.emit('view', { notebookId, pageId });
}

// Moves one page forward or back. Moving forward from the last page adds a
// new page with the same paper as the page it follows.
function go(direction) {
  const notebook = findNotebook(space, current.notebookId);
  if (!notebook || board.sliding) return;
  const index = notebook.pageIds.indexOf(current.pageId) + direction;
  if (index < 0) return board.snapBack();
  if (index >= notebook.pageIds.length) {
    const page = { id: newId(), paper: { ...space.pages[current.pageId].paper } };
    commit({ type: 'page.create', notebookId: notebook.id, page, index });
  }
  openPage(notebook.id, notebook.pageIds[index]);
}

function renderChrome() {
  const notebook = findNotebook(space, current.notebookId);
  if (!notebook) return;
  els.title.textContent = notebook.title;
  const index = notebook.pageIds.indexOf(current.pageId);
  els.pageNumber.textContent = `${index + 1} / ${notebook.pageIds.length}`;
  els.prev.disabled = index <= 0;
  els.follow.classList.toggle('on', follow);
  els.follow.setAttribute('aria-pressed', String(follow));
  renderTools();
}

function renderTools() {
  const erasing = tool.mode === 'erase';
  els.penTool.classList.toggle('on', !erasing);
  els.penTool.setAttribute('aria-pressed', String(!erasing));
  els.eraserTool.classList.toggle('on', erasing);
  els.eraserTool.setAttribute('aria-pressed', String(erasing));
  board.setEraser(erasing ? eraserSize() : 0);
  renderSizeSlots();
  renderColorSlots();
}

// Each size slot previews its size: a dot of ink for the pen, and the
// eraser's circle, a dark fill with a light gray outline, for the eraser.
function renderSizeSlots() {
  const erasing = tool.mode === 'erase';
  const slots = tool[tool.mode];
  els.sizeSlots.replaceChildren(
    ...slots.sizes.map((size, index) => {
      const button = document.createElement('button');
      button.className = 'slot size-slot';
      button.classList.toggle('active', index === slots.slot);
      button.title = `${erasing ? 'Eraser' : 'Pen'} size ${size}. Tap again to change it.`;
      const dot = document.createElement('span');
      dot.className = 'size-dot';
      dot.classList.toggle('eraser', erasing);
      const diameter = erasing ? 6 + size * 0.42 : 4 + size * 1.1;
      dot.style.width = dot.style.height = `${diameter}px`;
      dot.style.background = erasing ? '#0d0b10' : penColor();
      button.append(dot);
      button.onclick = () => {
        if (index === slots.slot) return toggleSizeMenu(button);
        els.sizeMenu.hidden = true;
        setSlots(tool.mode, { slot: index });
      };
      return button;
    }),
  );
  const range = SIZES[tool.mode];
  Object.assign(els.sizeSlider, { min: range.min, max: range.max, step: range.step });
  els.sizeSlider.value = slots.sizes[slots.slot];
}

// The selected color slot carries a chevron, and a color input covers the
// whole swatch, so a second tap anywhere on it opens the picker.
function renderColorSlots() {
  const erasing = tool.mode === 'erase';
  els.colorSlots.hidden = erasing;
  els.addColor.hidden = erasing || tool.colors.length >= MAX_COLORS;
  els.colorSlots.replaceChildren(
    ...tool.colors.map((color, index) => {
      const slot = document.createElement('div');
      slot.className = 'slot color-slot';
      const active = index === tool.colorSlot;
      slot.classList.toggle('active', active);
      const swatch = document.createElement(active ? 'label' : 'button');
      swatch.className = 'swatch';
      swatch.style.background = color;
      swatch.title = active ? 'Change this color' : color;
      if (!active) {
        swatch.onclick = () => setTool({ colorSlot: index });
      } else {
        swatch.innerHTML = '<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>';
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.value = color;
        picker.setAttribute('aria-label', 'Change this color');
        picker.oninput = () => {
          const colors = [...tool.colors];
          colors[index] = picker.value;
          setTool({ colors }, { keepColorSlots: true });
          swatch.style.background = picker.value;
        };
        picker.onchange = () => renderTools();
        swatch.append(picker);
      }
      slot.append(swatch);
      return slot;
    }),
  );
}

function addColor() {
  if (tool.colors.length >= MAX_COLORS) return;
  const unused = NEW_COLORS.find((c) => !tool.colors.includes(c)) ?? penColor();
  setTool({ colors: [...tool.colors, unused], colorSlot: tool.colors.length });
}

function penColor() {
  return tool.colors[tool.colorSlot];
}

function penSize() {
  return tool.pen.sizes[tool.pen.slot];
}

function eraserSize() {
  return tool.erase.sizes[tool.erase.slot];
}

function chooseTool(mode) {
  els.sizeMenu.hidden = true;
  setTool({ mode });
}

function toggleSizeMenu(anchor) {
  if (!els.sizeMenu.hidden) return (els.sizeMenu.hidden = true);
  els.paperMenu.hidden = true;
  const rect = anchor.getBoundingClientRect();
  els.sizeMenu.style.left = `${Math.min(rect.left + rect.width / 2, window.innerWidth - 132)}px`;
  els.sizeMenu.style.top = `${rect.bottom + 10}px`;
  els.sizeMenu.hidden = false;
}

// Changes the size slots of one tool: `slot` selects, `size` resizes the
// selected slot.
function setSlots(mode, { slot, size }) {
  const slots = { ...tool[mode], sizes: [...tool[mode].sizes] };
  if (slot !== undefined) slots.slot = slot;
  if (size !== undefined) slots.sizes[slots.slot] = size;
  setTool({ [mode]: slots });
}

// While a color picker is open, re-rendering the color slots would remove
// the picker, so color edits skip that step until the picker closes.
function setTool(change, { keepColorSlots = false } = {}) {
  tool = { ...tool, ...change };
  localStorage.setItem(KEY.tool, JSON.stringify(tool));
  if (keepColorSlots) return renderSizeSlots();
  renderTools();
}

function loadTool() {
  const saved = readJson(KEY.tool) ?? {};
  const slotsFor = (mode) => {
    const sizes = Array.isArray(saved[mode]?.sizes) && saved[mode].sizes.length === 3 ? saved[mode].sizes : SIZES[mode].defaults;
    return { sizes, slot: [0, 1, 2].includes(saved[mode]?.slot) ? saved[mode].slot : 1 };
  };
  const valid = Array.isArray(saved.colors) && saved.colors.length >= 1 && saved.colors.length <= MAX_COLORS;
  const colors = valid ? saved.colors : DEFAULT_COLORS;
  return {
    mode: saved.mode === 'erase' ? 'erase' : 'pen',
    pen: slotsFor('pen'),
    erase: slotsFor('erase'),
    colors,
    colorSlot: Number.isInteger(saved.colorSlot) && saved.colorSlot < colors.length ? saved.colorSlot : 0,
  };
}

function renderPaperMenu() {
  const page = space.pages[current.pageId];
  els.paperMenu.replaceChildren(
    ...PAPERS.map((paper) => {
      const button = document.createElement('button');
      button.className = 'paper-option';
      const active = page.paper.color === paper.color && page.paper.dots === paper.dots;
      button.classList.toggle('active', active);
      const preview = document.createElement('span');
      preview.className = 'paper-preview';
      preview.style.background = `radial-gradient(${paper.dots} 1px, transparent 1.5px) 0 0 / 8px 8px, ${paper.color}`;
      const label = document.createElement('span');
      label.textContent = paper.name;
      button.append(preview, label);
      button.onclick = () => {
        const chosen = { color: paper.color, dots: paper.dots };
        localStorage.setItem(KEY.paper, JSON.stringify(chosen));
        commit({ type: 'page.paper', pageId: current.pageId, paper: chosen });
        els.paperMenu.hidden = true;
      };
      return button;
    }),
  );
}

// --- Drawing ---------------------------------------------------------------

function startStroke(point) {
  if (!current.pageId) return;
  if (tool.mode === 'erase') return startErase(point);
  const stroke = { id: newId(), color: penColor(), width: penSize(), points: [point] };
  live = { pageId: current.pageId, strokeId: stroke.id, unsent: [] };
  if (commit({ type: 'stroke.start', pageId: current.pageId, stroke })) {
    pushHistory(current.pageId, { kind: 'draw', strokeId: stroke.id });
  }
}

// New points draw at once on this device and go to the others once per
// animation frame, so a fast Pencil does not send one message per sample.
function extendStroke(points) {
  if (erasing) return extendErase(points);
  if (!live) return;
  const op = { type: 'stroke.extend', pageId: live.pageId, strokeId: live.strokeId, points };
  if (!applyOp(space, op)) return;
  afterOp(op);
  if (!live.unsent.length) requestAnimationFrame(flushStroke);
  live.unsent.push(...points);
}

function flushStroke() {
  if (!live?.unsent.length) return;
  socket.emit('op', { type: 'stroke.extend', pageId: live.pageId, strokeId: live.strokeId, points: live.unsent });
  live.unsent = [];
}

function endStroke() {
  if (erasing) return endErase();
  flushStroke();
  live = null;
}

// The eraser cuts away the ink inside a small circle and leaves the rest of
// each line in place. One pass is one undo step. The pass remembers each
// line as it was before the first cut, and which pieces came from it, so
// undo can swap the surviving pieces back for the original lines.
function startErase(point) {
  erasing = { pageId: current.pageId, radius: eraserSize(), last: point, originals: new Map(), rootOf: new Map() };
  eraseAt(point);
}

function extendErase(points) {
  for (const point of points) {
    const [x0, y0] = erasing.last;
    const steps = Math.ceil(Math.hypot(point[0] - x0, point[1] - y0) / (erasing.radius / 2));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      eraseAt([x0 + (point[0] - x0) * t, y0 + (point[1] - y0) * t]);
    }
    erasing.last = point;
  }
}

function eraseAt(center) {
  const page = space.pages[erasing.pageId];
  if (!page) return;
  for (const { stroke, pieces } of cutStrokes(page, center, erasing.radius)) {
    const root = erasing.rootOf.get(stroke.id) ?? stroke.id;
    if (!erasing.originals.has(root)) {
      erasing.originals.set(root, { stroke, index: page.strokes.indexOf(stroke) });
    }
    const add = pieces.map((points) => ({ id: newId(), color: stroke.color, width: stroke.width, points }));
    for (const piece of add) erasing.rootOf.set(piece.id, root);
    commit({ type: 'stroke.replace', pageId: page.id, remove: [stroke.id], add });
  }
}

function endErase() {
  const { pageId, originals, rootOf } = erasing;
  erasing = null;
  if (!originals.size) return;
  const pieces = [...rootOf.keys()];
  const restore = [...originals.values()].sort((a, b) => a.index - b.index);
  pushHistory(pageId, { kind: 'erase', pieces, restore });
}

function pushHistory(pageId, step) {
  if (!undoSteps.has(pageId)) undoSteps.set(pageId, []);
  undoSteps.get(pageId).push(step);
}

// Undoes this device's last step on the current page. A step that another
// device already reversed, such as a stroke it erased, is skipped.
function undo() {
  const pageId = current.pageId;
  const steps = undoSteps.get(pageId);
  while (steps?.length) {
    const step = steps.pop();
    if (step.kind === 'draw') {
      if (commit({ type: 'stroke.remove', pageId, strokeId: step.strokeId })) return;
    } else {
      const op = {
        type: 'stroke.replace',
        pageId,
        remove: step.pieces,
        add: step.restore.map((r) => r.stroke),
        index: step.restore[0].index,
      };
      if (commit(op)) return;
    }
  }
}

// --- Copy ------------------------------------------------------------------

async function copyPage() {
  const page = space?.pages[current.pageId];
  if (!page) return;
  const canvas = renderPage(page, 1);
  const blob = new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  try {
    if (!navigator.clipboard?.write || !window.ClipboardItem) throw new Error('no clipboard');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Page copied. Paste it anywhere.');
  } catch {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await blob);
    link.download = `inkbridge-${current.pageId}.png`;
    link.click();
    toast('Clipboard is not available here, so the page downloaded as a PNG.');
  }
}

// --- Chrome and input wiring -----------------------------------------------

function setStatus() {
  const online = socket.connected;
  els.status.classList.toggle('online', online);
  const text = online ? `${peers} ${peers === 1 ? 'device' : 'devices'}` : 'Offline';
  els.status.textContent = text;
  els.peers.textContent = text;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (els.toast.hidden = true), 2200);
}

els.createSpace.onclick = () => {
  socket.emit('space:create', (res) => res.ok && loadSpace(res.space, null));
};

els.joinForm.onsubmit = (e) => {
  e.preventDefault();
  const code = els.joinCode.value.replace(/\D/g, '');
  socket.emit('space:join', { code }, (res) => {
    if (res.ok) loadSpace(res.space, res.view);
    else show('pair', res.error);
  });
};

els.leave.onclick = () => {
  if (!confirm('Leave this space on this device? The notebooks stay on the server.')) return;
  forgetSpace();
  location.reload();
};

els.back.onclick = showLibrary;
els.undo.onclick = undo;
els.addColor.onclick = addColor;
els.penTool.onclick = () => chooseTool('pen');
els.eraserTool.onclick = () => chooseTool('erase');
els.sizeSlider.oninput = () => setSlots(tool.mode, { size: Number(els.sizeSlider.value) });
els.copy.onclick = copyPage;
els.prev.onclick = () => go(-1);
els.next.onclick = () => go(1);
els.follow.onclick = () => {
  follow = !follow;
  localStorage.setItem(KEY.follow, follow ? 'on' : 'off');
  renderChrome();
};
els.title.onclick = () => {
  const notebook = findNotebook(space, current.notebookId);
  const title = prompt('Rename notebook', notebook.title);
  if (title !== null) commit({ type: 'notebook.rename', id: notebook.id, title });
};
els.paperButton.onclick = (e) => {
  e.stopPropagation();
  renderPaperMenu();
  els.paperMenu.hidden = !els.paperMenu.hidden;
};
// A tap outside an open menu closes it. A tap on the page that closes a
// menu does not also draw.
document.addEventListener(
  'pointerdown',
  (e) => {
    let closed = false;
    if (!els.paperMenu.hidden && !els.paperMenu.contains(e.target) && !els.paperButton.contains(e.target)) {
      els.paperMenu.hidden = true;
      closed = true;
    }
    const onSizeControl = [els.sizeMenu, els.sizeSlots].some((el) => el.contains(e.target));
    if (!els.sizeMenu.hidden && !onSizeControl) {
      els.sizeMenu.hidden = true;
      closed = true;
    }
    if (closed && els.stage.contains(e.target)) e.stopPropagation();
  },
  { capture: true },
);

document.addEventListener('keydown', (e) => {
  if (!current.pageId || e.target.closest('input, textarea')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') return e.preventDefault(), undo();
  if (mod && e.key.toLowerCase() === 'c' && !String(getSelection())) return e.preventDefault(), copyPage();
  if (e.key === 'ArrowRight' || e.key === 'PageDown') return go(1);
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') return go(-1);
  if (e.key.toLowerCase() === 'e' && !mod) return setTool({ mode: tool.mode === 'erase' ? 'pen' : 'erase' });
  if (e.key === '[' || e.key === ']') {
    const range = SIZES[tool.mode];
    const current = tool.mode === 'erase' ? eraserSize() : penSize();
    const size = Math.min(range.max, Math.max(range.min, current + (e.key === ']' ? 1 : -1) * range.step * 2));
    return setSlots(tool.mode, { size });
  }
  if (['1', '2', '3'].includes(e.key) && !mod) return setSlots(tool.mode, { slot: Number(e.key) - 1 });
  if (mod && (e.key === '=' || e.key === '+')) return e.preventDefault(), board.zoomBy(1.25);
  if (mod && e.key === '-') return e.preventDefault(), board.zoomBy(0.8);
  if (mod && e.key === '0') return e.preventDefault(), board.zoomReset();
  if (e.key === 'Escape') return showLibrary();
});

function iconButton(label, text, onclick) {
  const button = document.createElement('button');
  button.className = 'icon';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.textContent = text;
  button.onclick = (e) => {
    e.stopPropagation();
    onclick();
  };
  return button;
}

function forgetSpace() {
  localStorage.removeItem(KEY.code);
  history.replaceState(null, '', '/');
}

function formatCode(code) {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}
