import { PAGE } from './shared/ops.js';
import { drawPaper, drawStroke, drawStrokes } from './render.js';

const SWIPE_DISTANCE = 70;
const SWIPE_VELOCITY = 0.5; // px per ms
const PEN_QUIET_MS = 500;
const SLIDE_MS = 180;

// The board shows one page and turns pointer input into strokes and swipes.
// A pen or a mouse draws. A single finger swipes between pages, so a palm or
// finger never leaves ink while the Pencil is in use.
export class Board {
  constructor(stage, { onStrokeStart, onStrokeExtend, onStrokeEnd, onSwipe }) {
    this.stage = stage;
    this.sheet = stage.querySelector('.sheet');
    this.paperCanvas = stage.querySelector('.paper');
    this.inkCanvas = stage.querySelector('.ink');
    this.paperCtx = this.paperCanvas.getContext('2d');
    this.inkCtx = this.inkCanvas.getContext('2d');
    this.callbacks = { onStrokeStart, onStrokeExtend, onStrokeEnd, onSwipe };
    this.page = null;
    this.scale = 1;
    this.drawing = null;
    this.swipe = null;
    this.lastPenAt = 0;

    new ResizeObserver(() => this.layout()).observe(stage);
    stage.addEventListener('pointerdown', (e) => this.down(e));
    stage.addEventListener('pointermove', (e) => this.move(e));
    stage.addEventListener('pointerup', (e) => this.up(e));
    stage.addEventListener('pointercancel', (e) => this.up(e, true));
  }

  setPage(page) {
    this.page = page;
    this.redraw();
  }

  layout() {
    const pad = 12;
    const w = this.stage.clientWidth - pad * 2;
    const h = this.stage.clientHeight - pad * 2;
    if (w <= 0 || h <= 0) return;
    this.scale = Math.min(w / PAGE.width, h / PAGE.height);
    const cssW = Math.round(PAGE.width * this.scale);
    const cssH = Math.round(PAGE.height * this.scale);
    const dpr = window.devicePixelRatio || 1;
    this.sheet.style.width = `${cssW}px`;
    this.sheet.style.height = `${cssH}px`;
    for (const canvas of [this.paperCanvas, this.inkCanvas]) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.getContext('2d').setTransform(this.scale * dpr, 0, 0, this.scale * dpr, 0, 0);
    }
    this.redraw();
  }

  redraw() {
    if (!this.page) return;
    drawPaper(this.paperCtx, this.page.paper);
    this.inkCtx.save();
    this.inkCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.inkCtx.clearRect(0, 0, this.inkCanvas.width, this.inkCanvas.height);
    this.inkCtx.restore();
    drawStrokes(this.inkCtx, this.page);
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
    const rect = this.inkCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.scale;
    const y = (e.clientY - rect.top) / this.scale;
    const pressure = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.6;
    return [round(x, 10), round(y, 10), round(pressure, 100)];
  }

  down(e) {
    if (!this.page) return;
    if (e.pointerType === 'touch') {
      if (this.drawing || Date.now() - this.lastPenAt < PEN_QUIET_MS) return;
      if (this.swipe) return this.cancelSwipe();
      this.swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), dx: 0 };
      this.sheet.style.transition = 'none';
      this.stage.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0 || this.drawing) return;
    if (this.swipe) this.cancelSwipe();
    this.drawing = { id: e.pointerId };
    if (e.pointerType === 'pen') this.lastPenAt = Date.now();
    this.stage.setPointerCapture(e.pointerId);
    this.callbacks.onStrokeStart(this.toPage(e));
  }

  move(e) {
    if (this.drawing?.id === e.pointerId) {
      if (e.pointerType === 'pen') this.lastPenAt = Date.now();
      const events = e.getCoalescedEvents?.() ?? [];
      const points = (events.length ? events : [e]).map((ev) => this.toPage(ev));
      this.callbacks.onStrokeExtend(points);
      return;
    }
    if (this.swipe?.id === e.pointerId) {
      this.swipe.dx = e.clientX - this.swipe.x;
      this.swipe.dy = e.clientY - this.swipe.y;
      this.sheet.style.transform = `translateX(${this.swipe.dx}px)`;
    }
  }

  up(e, cancelled = false) {
    if (this.drawing?.id === e.pointerId) {
      this.drawing = null;
      this.callbacks.onStrokeEnd();
      return;
    }
    if (this.swipe?.id !== e.pointerId) return;
    const { dx = 0, dy = 0, t } = this.swipe;
    this.swipe = null;
    const velocity = Math.abs(dx) / Math.max(1, performance.now() - t);
    const horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
    const far = Math.abs(dx) > SWIPE_DISTANCE || (velocity > SWIPE_VELOCITY && Math.abs(dx) > 20);
    if (!cancelled && horizontal && far) this.callbacks.onSwipe(dx < 0 ? 1 : -1);
    else this.snapBack();
  }

  cancelSwipe() {
    this.swipe = null;
    this.snapBack();
  }
}

function round(n, factor) {
  return Math.round(n * factor) / factor;
}
