// A color picker built from plain elements, so it opens at once on every
// device. Its parts, top to bottom:
//   a square where left to right is saturation and bottom to top is
//   brightness, for the current hue;
//   a preview circle and a hue slider;
//   three fields for red, green, and blue, which a button switches to one
//   hex field.
// The picker works in HSV (hue, saturation, value), because the square and
// the slider map straight onto those three numbers. `onInput` runs at most
// once per frame while a value changes; `onChange` runs when a drag ends or
// a field is committed.
export function createColorPicker(color, { onInput, onChange }) {
  let [h, s, v] = hexToHsv(color);
  let format = 'rgb';

  const root = el('div', 'cp');
  const square = el('div', 'cp-square');
  const squareThumb = el('div', 'cp-thumb');
  square.append(squareThumb);

  const row = el('div', 'cp-row');
  const preview = el('div', 'cp-preview');
  const hue = el('div', 'cp-hue');
  const hueThumb = el('div', 'cp-thumb');
  hue.append(hueThumb);
  row.append(preview, hue);

  const fields = el('div', 'cp-fields');
  const toggle = el('button', 'cp-toggle');
  toggle.type = 'button';
  toggle.title = 'Switch between RGB and hex';
  toggle.setAttribute('aria-label', 'Switch between RGB and hex');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9l4-4 4 4M8 15l4 4 4-4" /></svg>';
  root.append(square, row, fields);

  const hex = () => hsvToHex(h, s, v);

  function paint() {
    square.style.setProperty('--hue', `hsl(${h} 100% 50%)`);
    squareThumb.style.left = `${s * 100}%`;
    squareThumb.style.top = `${(1 - v) * 100}%`;
    squareThumb.style.background = hex();
    hueThumb.style.left = `${(h / 360) * 100}%`;
    hueThumb.style.background = `hsl(${h} 100% 50%)`;
    preview.style.background = hex();
  }

  function renderFields() {
    const make = (label, value, max) => {
      const box = el('label', 'cp-field');
      const input = el('input');
      input.value = value;
      input.inputMode = format === 'rgb' ? 'numeric' : 'text';
      input.spellcheck = false;
      input.setAttribute('aria-label', label);
      if (max) input.maxLength = max;
      // The fields stay read-only until a finger or a mouse taps one. iPadOS
      // Scribble only wakes near editable fields, so the Apple Pencil never
      // brings up handwriting input anywhere in the picker.
      input.readOnly = true;
      input.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'pen') return e.preventDefault();
        input.readOnly = false;
      });
      input.addEventListener('blur', () => (input.readOnly = true));
      const name = el('span');
      name.textContent = label;
      box.append(input, name);
      return { box, input };
    };
    if (format === 'rgb') {
      const parts = hexToRgb(hex()).map((n, i) => make('RGB'[i], n, 3));
      const commit = () => {
        const rgb = parts.map((p) => clamp(parseInt(p.input.value, 10) || 0, 0, 255));
        setHex(rgbToHex(rgb), { fields: true });
      };
      for (const p of parts) p.input.onchange = commit;
      fields.replaceChildren(...parts.map((p) => p.box), toggle);
    } else {
      const part = make('HEX', hex(), 7);
      part.box.classList.add('wide');
      part.input.onchange = () => {
        const value = part.input.value.trim().replace(/^#?/, '#');
        if (/^#[0-9a-f]{6}$/i.test(value)) setHex(value.toLowerCase(), { fields: true });
        else renderFields();
      };
      fields.replaceChildren(part.box, toggle);
    }
  }

  toggle.onclick = () => {
    format = format === 'rgb' ? 'hex' : 'rgb';
    renderFields();
  };

  function setHex(value, { fields: fromFields = false } = {}) {
    [h, s, v] = hexToHsv(value);
    paint();
    if (fromFields) renderFields();
    onInput(hex());
    onChange(hex());
  }

  // While a value changes, the screen updates once per frame.
  let frame = 0;
  function changed() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
      updateFields();
      onInput(hex());
    });
  }

  function updateFields() {
    const inputs = fields.querySelectorAll('input');
    if (format === 'rgb') hexToRgb(hex()).forEach((n, i) => (inputs[i].value = n));
    else inputs[0].value = hex();
  }

  // A drag on the square or the slider follows the pointer, even outside
  // the element, until it lifts.
  function drag(element, update) {
    // Cancelling the touch events keeps iPadOS from treating a drag as a
    // scroll or a Scribble stroke. The pointer events still arrive.
    for (const type of ['touchstart', 'touchmove']) {
      element.addEventListener(type, (e) => e.cancelable && e.preventDefault(), { passive: false });
    }
    element.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      element.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const r = element.getBoundingClientRect();
        update(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
        changed();
      };
      const end = () => {
        element.removeEventListener('pointermove', move);
        element.removeEventListener('pointerup', end);
        element.removeEventListener('pointercancel', end);
        cancelAnimationFrame(frame);
        frame = 0;
        paint();
        updateFields();
        onInput(hex());
        onChange(hex());
      };
      move(e);
      element.addEventListener('pointermove', move);
      element.addEventListener('pointerup', end);
      element.addEventListener('pointercancel', end);
    });
  }

  drag(square, (x, y) => {
    s = x;
    v = 1 - y;
  });
  drag(hue, (x) => {
    h = Math.min(359.9, x * 360);
  });

  paint();
  renderFields();
  return root;
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

export function rgbToHex(rgb) {
  return `#${rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
}

export function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(hex).map((n) => n / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max ? d / max : 0, max];
}

export function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgbToHex([f(5), f(3), f(1)].map((x) => x * 255));
}
