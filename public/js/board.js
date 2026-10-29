import { PAGE } from './shared/ops.js';
import { penLog } from './penlog.js';
import { DOT_RADIUS, dotStep, drawItems, drawPaper, drawStroke, drawStrokes, homeRegion } from './render.js';

const SWIPE_DISTANCE = 70;
const SWIPE_VELOCITY = 0.5; // px per ms
const PEN_QUIET_MS = 500;
const SLIDE_MS = 180;
const PAD = 12;
// Zoom is measured against the scale that fits the opening frame in the
// stage. Canvas drawing keeps coordinates in single precision, so lines
// begin to wobble past about a thousand times; the limits sit there.
const MIN_ZOOM = 1e-4;
const MAX_ZOOM = 1e3;
const DOT_MIN_PX = 16; // closest the dot grid gets on screen before it thins out
const TAP_MS = 300;
const TAP_SLOP = 12; // px a finger may move and still count as a tap
const PULL_DISTANCE = 140; // px of finger travel that arms a new page
const DOUBLE_TAP_MS = 400; // longest gap between the two taps of a double tap
const LONG_PRESS_MS = 500; // how long a still press lasts before it is a long press
// A Pencil held lightly can lose contact for a few milliseconds mid-line, and
// the line breaks into dots. A Pencil that lands again within JOIN_MS of
// lifting and within JOIN_PX of where it lifted continues the same stroke.
const JOIN_MS = 100;
const JOIN_PX = 48;

// The board shows one page and turns pointer input into strokes, swipes,
// and zoom. A page has no edges: the view can move any distance and zoom
// far in or out. A pen or a mouse draws. Fingers never draw, so a palm never
// leaves ink while the Pencil is in use:
//   one finger swipes between pages;
//   two fingers pinch to zoom and move the page;
//   two quick two-finger taps in a row undo once.
// On a computer, Ctrl with the scroll wheel or a trackpad pinch zooms, and
// scrolling moves the page.
//
// A palm can still reach the glass before the Pencil does and pass for a
// finger. Three rules keep it from moving the view: a touch is ignored while
// the Pencil hovers or within PEN_QUIET_MS of it; a finger must travel
// TAP_SLOP before it pans or zooms; and a Pencil that lands while fingers are
// down puts the view back where it was when the first of them landed.
//
// The canvases cover the whole stage. The view is a scale and an offset
// that place page units on the stage; every draw call goes through it,
// so zooming redraws sharp ink instead of stretching pixels.
export class Board {
  constructor(stage, { onStrokeStart, onStrokeExtend, onStrokeEnd, onSwipe, onTwoFingerDoubleTap, onHover, onLongPress, onTap }) {
    this.stage = stage;
    this.sheet = stage.querySelector('.sheet');
    this.paperCanvas = stage.querySelector('.paper');
    this.inkCanvas = stage.querySelector('.ink');
    this.paperCtx = this.paperCanvas.getContext('2d');
    this.inkCtx = this.inkCanvas.getContext('2d');
    this.callbacks = { onStrokeStart, onStrokeExtend, onStrokeEnd, onSwipe, onTwoFingerDoubleTap, onHover, onLongPress, onTap };
    this.press = null; // a press that may become a long press; see startPress
    this.page = null;
    this.fit = 1; // scale that fits the opening frame in the stage
    this.view = null; // { scale, x, y }: px per page unit, and the stage px of page point 0,0
    this.size = { w: 0, h: 0 };
    this.dpr = 1;
    this.drawing = null;
    this.lifted = null; // a Pencil stroke that may continue; see up
    this.touches = new Map();
    this.gesture = null;
    this.viewBeforeTouch = null; // the view when the first finger landed
    this.lastPenAt = 0;
    this.lastTwoFingerTapAt = 0;
    this.eraserRadius = 0;
    this.edges = { first: true, last: true };
    this.pull = createPullIndicator();
    stage.append(this.pull);
    this.selection = null;
    this.selectionSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.selectionSvg.setAttribute('class', 'selection');
    this.selectionSvg.innerHTML = '<path />';
    this.selectionSvg.style.display = 'none';
    stage.append(this.selectionSvg);
    this.ring = document.createElement('div');
    this.ring.className = 'eraser-ring';
    this.ring.hidden = true;
    stage.append(this.ring);
    stage.addEventListener('pointerleave', () => (this.ring.hidden = true));

    new ResizeObserver(() => this.layout()).observe(stage);
    stage.addEventListener('pointerdown', (e) => this.down(e));
    stage.addEventListener('pointermove', (e) => this.move(e));
    stage.addEventListener('pointerup', (e) => this.up(e));
    stage.addEventListener('pointercancel', (e) => this.up(e, true));
    stage.addEventListener('lostpointercapture', (e) => this.up(e, true));
    stage.addEventListener('wheel', (e) => this.wheel(e), { passive: false });

    // iPad Safari reads quick Pencil strokes as taps it may own, such as a
    // double tap, and then sends no pointerdown for the stroke. Cancelling
    // the touch events keeps every stroke on the pointer path. It also stops
    // Safari from zooming the whole web page on a pinch.
    for (const type of ['touchstart', 'touchmove', 'touchend']) {
      stage.addEventListener(type, (e) => e.cancelable && e.preventDefault(), { passive: false });
    }
  }

  // --- View --------------------------------------------------------------

  get scale() {
    return this.view?.scale ?? this.fit;
  }

  // How far the view is zoomed, where 1 fits the opening frame in the stage.
  get zoom() {
    return this.scale / this.fit;
  }

  // The stage position, in CSS px, of page point 0,0.
  origin() {
    return { x: this.view?.x ?? 0, y: this.view?.y ?? 0 };
  }

  // Fits everything on the page, and at least the opening frame, in the
  // stage. Before the stage has a size, the view waits for layout.
  resetView() {
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    if (!this.page || w <= 0 || h <= 0) return (this.view = null);
    const home = homeRegion(this.page);
    const scale = Math.min((w - PAD * 2) / home.width, (h - PAD * 2) / home.height);
    this.view = {
      scale,
      x: w / 2 - (home.x + home.width / 2) * scale,
      y: h / 2 - (home.y + home.height / 2) * scale,
    };
  }

  // Zooms to `zoom`, keeping the page point under stage point `at` fixed.
  zoomAt(zoom, at, from = { view: { ...this.view }, at }) {
    if (!this.view) return;
    const scale = this.fit * Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const pageX = (from.at.x - from.view.x) / from.view.scale;
    const pageY = (from.at.y - from.view.y) / from.view.scale;
    this.view = { scale, x: at.x - pageX * scale, y: at.y - pageY * scale };
    this.scheduleRedraw();
  }

  panBy(dx, dy) {
    if (!this.view) return;
    this.view.x += dx;
    this.view.y += dy;
    this.scheduleRedraw();
  }

  // --- Drawing -----------------------------------------------------------

  // A radius above zero shows a ring of that size at the pointer. The radius
  // is in page units at zoom 1, and the ring keeps its screen size at any
  // zoom, as the eraser does. Zero hides it.
  setEraser(radius) {
    this.eraserRadius = radius;
    this.stage.classList.toggle('erasing', radius > 0);
    if (!radius) this.ring.hidden = true;
  }

  setSelecting(on) {
    this.stage.classList.toggle('selecting', on);
  }

  // Shows a lasso outline, a list of [x, y] points in page units, over the
  // page. `closed` joins the last point to the first. Null hides it. The
  // outline is placed again on every redraw, so it stays put through zoom.
  setSelection(lasso, { closed = true } = {}) {
    this.selection = lasso;
    this.selectionClosed = closed;
    this.placeSelection();
  }

  placeSelection() {
    const lasso = this.selection;
    // SVG elements ignore the hidden property, so display does the hiding.
    this.selectionSvg.style.display = lasso?.length ? '' : 'none';
    if (!lasso?.length) return;
    const s = this.scale;
    const o = this.origin();
    const d = lasso.map(([x, y], i) => `${i ? 'L' : 'M'}${(o.x + x * s).toFixed(1)} ${(o.y + y * s).toFixed(1)}`).join('');
    this.selectionSvg.firstChild.setAttribute('d', this.selectionClosed ? `${d}Z` : d);
    this.selectionSvg.classList.toggle('open', !this.selectionClosed);
  }

  // The cursor shows a move arrow over a finished selection.
  setOverSelection(over) {
    this.stage.classList.toggle('over-selection', over);
  }

  showRing(e) {
    if (!this.eraserRadius || e.pointerType === 'touch') return;
    const size = this.eraserRadius * 2 * this.fit;
    const stageRect = this.stage.getBoundingClientRect();
    this.ring.style.width = this.ring.style.height = `${size}px`;
    this.ring.style.transform = `translate(${e.clientX - stageRect.left - size / 2}px, ${e.clientY - stageRect.top - size / 2}px)`;
    this.ring.hidden = false;
  }

  // A different page starts with everything on it in view. The same page
  // keeps its view.
  setPage(page) {
    const changed = page?.id !== this.page?.id;
    this.page = page;
    if (changed || !this.view) this.resetView();
    this.redraw();
  }

  layout() {
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    if (w <= 0 || h <= 0) return;
    this.fit = Math.min((w - PAD * 2) / PAGE.width, (h - PAD * 2) / PAGE.height);
    this.dpr = window.devicePixelRatio || 1;
    for (const canvas of [this.paperCanvas, this.inkCanvas]) {
      canvas.width = Math.round(w * this.dpr);
      canvas.height = Math.round(h * this.dpr);
    }
    // A resized stage keeps the same page point at its center.
    if (this.view) {
      this.view.x += (w - this.size.w) / 2;
      this.view.y += (h - this.size.h) / 2;
    } else this.resetView();
    this.size = { w, h };
    this.redraw();
  }

  redraw() {
    if (!this.page || !this.view) return;
    const { dpr } = this;
    const s = this.scale;
    const o = this.origin();
    const toPageSpace = [s * dpr, 0, 0, s * dpr, o.x * dpr, o.y * dpr];

    // The paper covers the whole stage. The dot grid keeps its dots
    // between DOT_MIN_PX and twice that apart on screen: zooming out fades
    // every other dot away, then the grid doubles its spacing. Dots keep
    // the size they have when the opening frame fits the stage.
    const paper = this.paperCtx;
    paper.setTransform(...toPageSpace);
    const step = dotStep(s, DOT_MIN_PX);
    const fade = Math.min(1, Math.max(0, (step * s - DOT_MIN_PX) / DOT_MIN_PX));
    drawPaper(paper, this.page.paper, { region: this.visibleRect(), step, radius: (DOT_RADIUS * this.fit) / s, fade });
    drawItems(paper, this.page);

    // The ink context keeps the page transform between redraws, so new
    // points can draw straight onto it.
    const ink = this.inkCtx;
    ink.setTransform(1, 0, 0, 1, 0, 0);
    ink.clearRect(0, 0, this.inkCanvas.width, this.inkCanvas.height);
    ink.setTransform(...toPageSpace);
    drawStrokes(ink, this.page);
    penLog('redraw', {
      zoom: Math.round(this.zoom * 1000) / 1000,
      strokes: this.page.strokes.length,
      canvas: [this.inkCanvas.width, this.inkCanvas.height],
      origin: [Math.round(o.x), Math.round(o.y)],
    });
    this.placeSelection();
  }

  // Redraws once before the next frame, however many times it is asked.
  scheduleRedraw() {
    if (this.redrawPending) return;
    this.redrawPending = true;
    requestAnimationFrame(() => {
      this.redrawPending = false;
      this.redraw();
    });
  }

  // Draws the points of `stroke` from index `from` onward, without a redraw.
  drawStroke(stroke, from = 0) {
    drawStroke(this.inkCtx, stroke, from);
  }

  // Slides the sheet out in `direction` (+1 next, -1 previous), calls
  // `swap` to change the page, then slides the new page in.
  slide(direction, swap) {
    const sheet = this.sheet;
    this.sliding = true;
    sheet.style.transition = `transform ${SLIDE_MS}ms ease-in`;
    sheet.style.transform = `translateX(${-direction * 110}%)`;
    setTimeout(() => {
      swap();
      sheet.style.transition = 'none';
      sheet.style.transform = `translateX(${direction * 110}%)`;
      sheet.getBoundingClientRect();
      sheet.style.transition = `transform ${SLIDE_MS}ms ease-out`;
      sheet.style.transform = 'translateX(0)';
      this.sliding = false;
    }, SLIDE_MS);
  }

  snapBack() {
    this.sheet.style.transition = `transform ${SLIDE_MS}ms ease-out`;
    this.sheet.style.transform = 'translateX(0)';
    this.setPull(0);
  }

  // Tells the board whether the page is the first or the last, which
  // changes what a swipe past that edge does.
  setEdges(edges) {
    this.edges = edges;
  }

  // Shows how far a swipe past the last page has pulled, from 0 to 1. At 1
  // the indicator is armed, and lifting the finger adds a page.
  setPull(progress) {
    const p = Math.min(1, Math.max(0, progress));
    this.pull.style.setProperty('--pull', p);
    this.pull.classList.toggle('armed', p >= 1);
    this.pull.classList.toggle('visible', p > 0);
  }

  // The part of the page on screen, in page units.
  visibleRect() {
    const s = this.scale;
    const o = this.origin();
    return { x: -o.x / s, y: -o.y / s, width: this.stage.clientWidth / s, height: this.stage.clientHeight / s };
  }

  toPage(e) {
    const rect = this.stage.getBoundingClientRect();
    const o = this.origin();
    const x = (e.clientX - rect.left - o.x) / this.scale;
    const y = (e.clientY - rect.top - o.y) / this.scale;
    // A Pencil reports 0 on the sample where it lifts. That is a real
    // reading, so the line thins there instead of ending in a blob.
    const pressure = e.pointerType === 'pen' ? e.pressure : 0.6;
    // A tenth of a page unit at zoom 1, and finer as the view zooms in.
    const digits = Math.max(1, 1 + Math.ceil(Math.log10(this.zoom)));
    return [Number(x.toFixed(digits)), Number(y.toFixed(digits)), round(pressure, 100)];
  }

  // Pointer capture fails for a pointer the browser no longer tracks. The
  // gesture still works without it, so the failure is ignored.
  capture(pointerId) {
    try {
      this.stage.setPointerCapture(pointerId);
    } catch {}
  }

  stagePoint(e) {
    const rect = this.stage.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // --- Input -------------------------------------------------------------

  down(e) {
    if (!this.page) return;
    penLog('down', { ...this.describe(e), drawing: this.drawing?.id ?? null, lifted: this.liftedGap(e) });
    if (e.pointerType === 'touch') return this.touchDown(e);
    if (e.button !== 0) return;
    if (this.rejoin(e)) return;
    this.endLifted();
    // A new stroke can start before the last stroke's pointerup arrives.
    // End the old stroke so the new one is never dropped.
    if (this.drawing) {
      this.drawing = null;
      this.callbacks.onStrokeEnd();
    }
    if (e.pointerType === 'pen') {
      this.lastPenAt = Date.now();
      this.restoreViewBeforeTouch();
    }
    this.endGesture();
    this.drawing = { id: e.pointerId, moves: 0, samples: 0 };
    this.capture(e.pointerId);
    this.showRing(e);
    this.callbacks.onStrokeStart(this.toPage(e));
    this.startPress(e);
  }

  // A pen, mouse, or single finger that stays within TAP_SLOP for
  // LONG_PRESS_MS is a long press. The board reports it with the page point
  // and the screen point. When the listener returns true, it took the press,
  // and a finger gesture in progress ends.
  startPress(e) {
    this.cancelPress();
    const point = this.toPage(e);
    const at = { x: e.clientX, y: e.clientY };
    const timer = setTimeout(() => {
      this.press = null;
      if (!this.callbacks.onLongPress?.(point, at)) return;
      if (e.pointerType === 'touch') {
        if (this.gesture?.kind === 'swipe') this.snapBack();
        this.gesture = { kind: 'done' };
      }
    }, LONG_PRESS_MS);
    this.press = { id: e.pointerId, at, timer };
  }

  cancelPress(e) {
    if (!this.press || (e && e.pointerId !== this.press.id)) return;
    clearTimeout(this.press.timer);
    this.press = null;
  }

  move(e) {
    this.showRing(e);
    if (this.press?.id === e.pointerId && distance(this.press.at, { x: e.clientX, y: e.clientY }) > TAP_SLOP) this.cancelPress();
    if (this.drawing?.id === e.pointerId) {
      if (e.pointerType === 'pen') this.lastPenAt = Date.now();
      const events = e.getCoalescedEvents?.() ?? [];
      const points = (events.length ? events : [e]).map((ev) => this.toPage(ev));
      this.drawing.moves++;
      this.drawing.samples += points.length;
      const zero = points.filter((p) => p[2] === 0).length;
      if (zero) penLog('zero-pressure', { id: e.pointerId, zero, of: points.length });
      this.callbacks.onStrokeExtend(points);
      return;
    }
    if (this.touches.has(e.pointerId)) return this.touchMove(e);
    // A Pencil hovering above the glass means a palm is about to land.
    if (e.pointerType === 'pen') this.lastPenAt = Date.now();
    if (e.pointerType !== 'touch' && this.page) this.callbacks.onHover?.(this.toPage(e));
  }

  up(e, cancelled = false) {
    this.cancelPress(e);
    const d = this.drawing?.id === e.pointerId ? this.drawing : null;
    penLog(e.type, { ...this.describe(e), drawing: Boolean(d), moves: d?.moves, samples: d?.samples, touch: this.touches.has(e.pointerId) });
    if (this.drawing?.id === e.pointerId) {
      this.drawing = null;
      if (e.pointerType === 'pen') this.ring.hidden = true;
      if (e.pointerType === 'pen' && !cancelled) {
        // The stroke ends only once JOIN_MS passes with no landing nearby.
        const timer = setTimeout(() => this.endLifted(), JOIN_MS);
        this.lifted = { at: this.stagePoint(e), t: e.timeStamp, timer };
      } else this.callbacks.onStrokeEnd();
      return;
    }
    if (this.touches.has(e.pointerId)) this.touchUp(e, cancelled);
  }

  // Continues the lifted stroke when the Pencil lands again soon and close
  // by. The gap between the two points is drawn as part of the line.
  rejoin(e) {
    const lifted = this.lifted;
    if (!lifted || e.pointerType !== 'pen') return false;
    if (e.timeStamp - lifted.t > JOIN_MS || distance(lifted.at, this.stagePoint(e)) > JOIN_PX) return false;
    clearTimeout(lifted.timer);
    this.lifted = null;
    penLog('rejoin', this.liftedGap(e, lifted));
    this.lastPenAt = Date.now();
    this.drawing = { id: e.pointerId, moves: 0, samples: 0 };
    this.capture(e.pointerId);
    this.showRing(e);
    this.callbacks.onStrokeExtend([this.toPage(e)]);
    return true;
  }

  endLifted() {
    if (!this.lifted) return;
    penLog('end', {});
    clearTimeout(this.lifted.timer);
    this.lifted = null;
    this.callbacks.onStrokeEnd();
  }

  // The parts of a pointer event the pen log records.
  describe(e) {
    const at = this.stagePoint(e);
    return { type: e.pointerType, id: e.pointerId, x: Math.round(at.x), y: Math.round(at.y), p: e.pressure, buttons: e.buttons, et: Math.round(e.timeStamp * 10) / 10 };
  }

  // How long ago and how far away the last Pencil lift was, for the log.
  liftedGap(e, lifted = this.lifted) {
    if (!lifted) return null;
    return { ms: Math.round((e.timeStamp - lifted.t) * 10) / 10, px: Math.round(distance(lifted.at, this.stagePoint(e))) };
  }

  // Touch gestures. `gesture.kind` is one of:
  //   swipe  one finger; drags the sheet sideways
  //   pinch  two fingers; zooms around their midpoint and follows it
  //   done   the gesture ended early; waits for every finger to lift
  touchDown(e) {
    if (this.drawing || Date.now() - this.lastPenAt < PEN_QUIET_MS) return penLog('touch-ignored', { id: e.pointerId });
    this.touches.set(e.pointerId, this.stagePoint(e));
    this.capture(e.pointerId);
    if (this.touches.size === 1) {
      this.viewBeforeTouch = this.view && { ...this.view };
      const at = this.stagePoint(e);
      this.gesture = { kind: 'swipe', id: e.pointerId, x: at.x, y: at.y, t: performance.now(), dx: 0, dy: 0, point: this.toPage(e) };
      this.sheet.style.transition = 'none';
      this.startPress(e);
    } else if (this.touches.size === 2) {
      this.cancelPress();
      if (this.gesture?.kind === 'swipe') this.snapBack();
      const [a, b] = [...this.touches.values()];
      const at = midpoint(a, b);
      this.gesture = {
        kind: 'pinch',
        distance: distance(a, b),
        from: { zoom: this.zoom, view: this.view && { ...this.view }, at },
        starts: new Map(this.touches),
        t: performance.now(),
        moved: false,
      };
    }
  }

  touchMove(e) {
    const point = this.stagePoint(e);
    this.touches.set(e.pointerId, point);
    const g = this.gesture;
    if (g?.kind === 'swipe' && g.id === e.pointerId) {
      g.dx = point.x - g.x;
      g.dy = point.y - g.y;
      // Past the last page, the sheet resists and the pull indicator fills.
      // Past the first page, the sheet only resists.
      const pastLast = g.dx < 0 && this.edges.last;
      const pastFirst = g.dx > 0 && this.edges.first;
      const shown = pastLast || pastFirst ? rubberBand(g.dx) : g.dx;
      this.sheet.style.transform = `translateX(${shown}px)`;
      this.setPull(pastLast ? -g.dx / PULL_DISTANCE : 0);
    } else if (g?.kind === 'pinch' && this.touches.size >= 2) {
      const start = g.starts.get(e.pointerId);
      if (start && distance(start, point) > TAP_SLOP) g.moved = true;
      if (!g.moved) return;
      const [a, b] = [...this.touches.values()];
      this.zoomAt(g.from.zoom * (distance(a, b) / g.distance), midpoint(a, b), g.from);
    }
  }

  touchUp(e, cancelled) {
    this.touches.delete(e.pointerId);
    const g = this.gesture;
    if (g?.kind === 'swipe' && g.id === e.pointerId) {
      const velocity = Math.abs(g.dx) / Math.max(1, performance.now() - g.t);
      const horizontal = Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
      const far = Math.abs(g.dx) > SWIPE_DISTANCE || (velocity > SWIPE_VELOCITY && Math.abs(g.dx) > 20);
      this.gesture = null;
      if (!cancelled && Math.hypot(g.dx, g.dy) <= TAP_SLOP && performance.now() - g.t < TAP_MS) {
        this.snapBack();
        this.callbacks.onTap?.(g.point);
        return;
      }
      // Past the last page, only a pull that armed the indicator adds a
      // page. A flick or a short pull springs back.
      const direction = g.dx < 0 ? 1 : -1;
      const allowed =
        direction === 1 && this.edges.last ? -g.dx >= PULL_DISTANCE : !(direction === -1 && this.edges.first) && far;
      if (!cancelled && horizontal && allowed) {
        this.setPull(0);
        this.callbacks.onSwipe(direction);
      } else this.snapBack();
      return;
    }
    if (g?.kind === 'pinch') {
      // Two fingers that lift quickly without moving are a tap. The view
      // returns to where it was, since any zoom was only finger jitter.
      if (!cancelled && !g.moved && performance.now() - g.t < TAP_MS) {
        this.view = g.from.view;
        this.scheduleRedraw();
        this.gesture = { kind: 'done' };
        if (!this.touches.size) this.gesture = null;
        this.twoFingerTap();
        return;
      }
      this.gesture = { kind: 'done' };
    }
    if (!this.touches.size) this.gesture = null;
  }

  // One two-finger tap does nothing on its own. A second one within
  // DOUBLE_TAP_MS makes a double tap, which undoes once and starts over.
  twoFingerTap() {
    const now = performance.now();
    if (now - this.lastTwoFingerTapAt < DOUBLE_TAP_MS) {
      this.lastTwoFingerTapAt = 0;
      this.callbacks.onTwoFingerDoubleTap?.();
    } else {
      this.lastTwoFingerTapAt = now;
    }
  }

  // Fingers that were down when the Pencil landed were most likely a palm,
  // so whatever they did to the view is undone.
  restoreViewBeforeTouch() {
    if (!this.touches.size || !this.viewBeforeTouch) return;
    this.view = this.viewBeforeTouch;
    this.viewBeforeTouch = null;
    this.scheduleRedraw();
  }

  endGesture() {
    if (this.gesture?.kind === 'swipe') this.snapBack();
    this.gesture = this.touches.size ? { kind: 'done' } : null;
  }

  wheel(e) {
    if (!this.page) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      this.zoomAt(this.zoom * Math.exp(-e.deltaY * 0.01), this.stagePoint(e));
    } else {
      e.preventDefault();
      this.panBy(-e.deltaX, -e.deltaY);
    }
  }

  zoomBy(factor) {
    this.zoomAt(this.zoom * factor, { x: this.stage.clientWidth / 2, y: this.stage.clientHeight / 2 });
  }

  zoomReset() {
    this.resetView();
    this.scheduleRedraw();
  }
}

// Moves less the further it is pulled, so an edge feels elastic.
function rubberBand(dx) {
  const limit = 160;
  return Math.sign(dx) * limit * (1 - Math.exp(-Math.abs(dx) / (limit * 1.2)));
}

// A ring that fills as the swipe pulls, around a plus that grows. When the ring closes, the button fills with the accent color.
function createPullIndicator() {
  const el = document.createElement('div');
  el.className = 'pull';
  el.innerHTML = `
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle class="pull-track" cx="24" cy="24" r="20" />
      <circle class="pull-progress" cx="24" cy="24" r="20" pathLength="1" />
      <path class="pull-plus" d="M24 16v16M16 24h16" />
    </svg>
    <span class="pull-label">New page</span>`;
  return el;
}

function round(n, factor) {
  return Math.round(n * factor) / factor;
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
