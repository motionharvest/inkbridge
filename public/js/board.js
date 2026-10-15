import { PAGE } from './shared/ops.js';
import { drawPaper, drawStroke, drawStrokes } from './render.js';

const SWIPE_DISTANCE = 70;
const SWIPE_VELOCITY = 0.5; // px per ms
const PEN_QUIET_MS = 500;
const SLIDE_MS = 180;
const PAD = 12;
const MAX_ZOOM = 6;
const PAN_MARGIN = 60; // px of empty stage allowed past a zoomed page edge
const TAP_MS = 300;
const TAP_SLOP = 12; // px a finger may move and still count as a tap

// The board shows one page and turns pointer input into strokes, swipes,
// and zoom. A pen or a mouse draws. Fingers never draw, so a palm never
// leaves ink while the Pencil is in use:
//   one finger swipes between pages, or pans when the page is zoomed in;
//   two fingers pinch to zoom and move the page;
//   a quick tap with two fingers, with no movement, undoes.
// On a computer, Ctrl with the scroll wheel or a trackpad pinch zooms, and
// scrolling pans a zoomed page.
//
// The canvases cover the whole stage. The view is a scale and an offset
// that place the page inside the stage; every draw call goes through it,
// so zooming redraws sharp ink instead of stretching pixels.
export class Board {
  constructor(stage, { onStrokeStart, onStrokeExtend, onStrokeEnd, onSwipe, onTwoFingerTap }) {
    this.stage = stage;
    this.sheet = stage.querySelector('.sheet');
    this.paperCanvas = stage.querySelector('.paper');
    this.inkCanvas = stage.querySelector('.ink');
    this.paperCtx = this.paperCanvas.getContext('2d');
    this.inkCtx = this.inkCanvas.getContext('2d');
    this.callbacks = { onStrokeStart, onStrokeExtend, onStrokeEnd, onSwipe, onTwoFingerTap };
    this.page = null;
    this.fit = 1; // scale that fits the whole page in the stage
    this.zoom = 1;
    this.pan = { x: 0, y: 0 }; // px from the centred position
    this.dpr = 1;
    this.drawing = null;
    this.touches = new Map();
    this.gesture = null;
    this.lastPenAt = 0;
    this.eraserRadius = 0;
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
    return this.fit * this.zoom;
  }

  // The stage position, in CSS px, of the page's top left corner.
  origin() {
    const s = this.scale;
    return {
      x: this.stage.clientWidth / 2 + this.pan.x - (PAGE.width * s) / 2,
      y: this.stage.clientHeight / 2 + this.pan.y - (PAGE.height * s) / 2,
    };
  }

  resetView() {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
  }

  // Zooms to `zoom`, keeping the page point under stage point `at` fixed.
  zoomAt(zoom, at, from = { zoom: this.zoom, origin: this.origin(), at }) {
    const next = Math.min(MAX_ZOOM, Math.max(1, zoom));
    const pageX = (from.at.x - from.origin.x) / (this.fit * from.zoom);
    const pageY = (from.at.y - from.origin.y) / (this.fit * from.zoom);
    this.zoom = next;
    const s = this.scale;
    this.pan.x = at.x - pageX * s - this.stage.clientWidth / 2 + (PAGE.width * s) / 2;
    this.pan.y = at.y - pageY * s - this.stage.clientHeight / 2 + (PAGE.height * s) / 2;
    this.clampPan();
    this.scheduleRedraw();
  }

  panBy(dx, dy) {
    this.pan.x += dx;
    this.pan.y += dy;
    this.clampPan();
    this.scheduleRedraw();
  }

  // A page smaller than the stage stays centred. A larger page can move
  // until its edge is PAN_MARGIN px inside the stage.
  clampPan() {
    const s = this.scale;
    for (const [axis, size, room] of [
      ['x', PAGE.width * s, this.stage.clientWidth],
      ['y', PAGE.height * s, this.stage.clientHeight],
    ]) {
      const limit = Math.max(0, (size - room) / 2 + PAN_MARGIN);
      this.pan[axis] = size + PAD * 2 <= room ? 0 : Math.min(limit, Math.max(-limit, this.pan[axis]));
    }
  }

  // --- Drawing -----------------------------------------------------------

  // A radius above zero shows a ring of that size, in page units, at the
  // pointer. Zero hides it.
  setEraser(radius) {
    this.eraserRadius = radius;
    this.stage.classList.toggle('erasing', radius > 0);
    if (!radius) this.ring.hidden = true;
  }

  showRing(e) {
    if (!this.eraserRadius || e.pointerType === 'touch') return;
    const size = this.eraserRadius * 2 * this.scale;
    const stageRect = this.stage.getBoundingClientRect();
    this.ring.style.width = this.ring.style.height = `${size}px`;
    this.ring.style.transform = `translate(${e.clientX - stageRect.left - size / 2}px, ${e.clientY - stageRect.top - size / 2}px)`;
    this.ring.hidden = false;
  }

  // A different page starts unzoomed. The same page keeps its view.
  setPage(page) {
    if (page?.id !== this.page?.id) this.resetView();
    this.page = page;
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
    this.inkClipped = false;
    this.clampPan();
    this.redraw();
  }

  redraw() {
    if (!this.page) return;
    const { dpr } = this;
    const s = this.scale;
    const o = this.origin();
    const toPageSpace = [s * dpr, 0, 0, s * dpr, o.x * dpr, o.y * dpr];

    const paper = this.paperCtx;
    paper.setTransform(1, 0, 0, 1, 0, 0);
    paper.clearRect(0, 0, this.paperCanvas.width, this.paperCanvas.height);
    paper.setTransform(...toPageSpace);
    paper.save();
    paper.shadowColor = 'rgb(0 0 0 / 0.45)';
    paper.shadowBlur = 30 * dpr;
    paper.shadowOffsetY = 10 * dpr;
    paper.fillStyle = this.page.paper.color;
    paper.fillRect(0, 0, PAGE.width, PAGE.height);
    paper.restore();
    drawPaper(paper, this.page.paper);

    // The ink context keeps the page transform and a clip to the page edge
    // between redraws, so new points can draw straight onto it.
    const ink = this.inkCtx;
    if (this.inkClipped) ink.restore();
    ink.setTransform(1, 0, 0, 1, 0, 0);
    ink.clearRect(0, 0, this.inkCanvas.width, this.inkCanvas.height);
    ink.save();
    ink.setTransform(...toPageSpace);
    ink.beginPath();
    ink.rect(0, 0, PAGE.width, PAGE.height);
    ink.clip();
    this.inkClipped = true;
    drawStrokes(ink, this.page);
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
  }

  toPage(e) {
    const rect = this.stage.getBoundingClientRect();
    const o = this.origin();
    const x = (e.clientX - rect.left - o.x) / this.scale;
    const y = (e.clientY - rect.top - o.y) / this.scale;
    const pressure = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.6;
    return [round(x, 10), round(y, 10), round(pressure, 100)];
  }

  stagePoint(e) {
    const rect = this.stage.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // --- Input -------------------------------------------------------------

  down(e) {
    if (!this.page) return;
    if (e.pointerType === 'touch') return this.touchDown(e);
    if (e.button !== 0) return;
    // A new stroke can start before the last stroke's pointerup arrives.
    // End the old stroke so the new one is never dropped.
    if (this.drawing) {
      this.drawing = null;
      this.callbacks.onStrokeEnd();
    }
    this.endGesture();
    this.drawing = { id: e.pointerId };
    if (e.pointerType === 'pen') this.lastPenAt = Date.now();
    this.stage.setPointerCapture(e.pointerId);
    this.showRing(e);
    this.callbacks.onStrokeStart(this.toPage(e));
  }

  move(e) {
    this.showRing(e);
    if (this.drawing?.id === e.pointerId) {
      if (e.pointerType === 'pen') this.lastPenAt = Date.now();
      const events = e.getCoalescedEvents?.() ?? [];
      const points = (events.length ? events : [e]).map((ev) => this.toPage(ev));
      this.callbacks.onStrokeExtend(points);
      return;
    }
    if (this.touches.has(e.pointerId)) this.touchMove(e);
  }

  up(e, cancelled = false) {
    if (this.drawing?.id === e.pointerId) {
      this.drawing = null;
      if (e.pointerType === 'pen') this.ring.hidden = true;
      this.callbacks.onStrokeEnd();
      return;
    }
    if (this.touches.has(e.pointerId)) this.touchUp(e, cancelled);
  }

  // Touch gestures. `gesture.kind` is one of:
  //   swipe  one finger on an unzoomed page; drags the sheet sideways
  //   pan    one finger on a zoomed page; moves the page
  //   pinch  two fingers; zooms around their midpoint and follows it
  //   done   the gesture ended early; waits for every finger to lift
  touchDown(e) {
    if (this.drawing || Date.now() - this.lastPenAt < PEN_QUIET_MS) return;
    this.touches.set(e.pointerId, this.stagePoint(e));
    this.stage.setPointerCapture(e.pointerId);
    if (this.touches.size === 1) {
      const at = this.stagePoint(e);
      this.gesture =
        this.zoom > 1.01
          ? { kind: 'pan', last: at }
          : { kind: 'swipe', id: e.pointerId, x: at.x, y: at.y, t: performance.now(), dx: 0, dy: 0 };
      this.sheet.style.transition = 'none';
    } else if (this.touches.size === 2) {
      if (this.gesture?.kind === 'swipe') this.snapBack();
      const [a, b] = [...this.touches.values()];
      const at = midpoint(a, b);
      this.gesture = {
        kind: 'pinch',
        distance: distance(a, b),
        from: { zoom: this.zoom, origin: this.origin(), at, pan: { ...this.pan } },
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
      this.sheet.style.transform = `translateX(${g.dx}px)`;
    } else if (g?.kind === 'pan') {
      this.panBy(point.x - g.last.x, point.y - g.last.y);
      g.last = point;
    } else if (g?.kind === 'pinch' && this.touches.size >= 2) {
      const start = g.starts.get(e.pointerId);
      if (start && distance(start, point) > TAP_SLOP) g.moved = true;
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
      if (!cancelled && horizontal && far) this.callbacks.onSwipe(g.dx < 0 ? 1 : -1);
      else this.snapBack();
      return;
    }
    if (g?.kind === 'pinch') {
      // Two fingers that lift quickly without moving are a tap. The view
      // returns to where it was, since any zoom was only finger jitter.
      if (!cancelled && !g.moved && performance.now() - g.t < TAP_MS) {
        this.zoom = g.from.zoom;
        this.pan = { ...g.from.pan };
        this.scheduleRedraw();
        this.gesture = { kind: 'done' };
        if (!this.touches.size) this.gesture = null;
        this.callbacks.onTwoFingerTap?.();
        return;
      }
      // A zoom that ends close to the whole page settles on the whole page.
      if (this.zoom < 1.08) {
        this.resetView();
        this.scheduleRedraw();
      }
      this.gesture = { kind: 'done' };
    }
    if (!this.touches.size) this.gesture = null;
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
      if (this.zoom < 1.02) {
        this.resetView();
        this.scheduleRedraw();
      }
    } else if (this.zoom > 1.01) {
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

function round(n, factor) {
  return Math.round(n * factor) / factor;
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
