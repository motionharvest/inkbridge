import fs from 'node:fs';
import path from 'node:path';
import { emptySpace } from '../public/js/shared/ops.js';

const CODE = /^\d{6}$/;
const SAVE_DELAY_MS = 400;

// Holds every space in memory and writes each one to data/<code>.json shortly
// after it changes. A space is loaded from disk the first time a device asks
// for its code.
export class SpaceStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.spaces = new Map();
    this.views = new Map();
    // For each space, the highest change number applied from each device.
    this.applied = new Map();
    this.timers = new Map();
    fs.mkdirSync(dataDir, { recursive: true });
  }

  create() {
    let code;
    do code = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    while (this.get(code));
    const space = emptySpace(code);
    this.spaces.set(code, space);
    this.applied.set(code, new Map());
    this.changed(code);
    return space;
  }

  get(code) {
    if (!CODE.test(String(code))) return undefined;
    if (this.spaces.has(code)) return this.spaces.get(code);
    const file = this.file(code);
    if (!fs.existsSync(file)) return undefined;
    const { applied = {}, ...space } = JSON.parse(fs.readFileSync(file, 'utf8'));
    this.spaces.set(code, space);
    this.applied.set(code, new Map(Object.entries(applied)));
    return space;
  }

  // The number of the last change from `client` that this space has applied.
  lastApplied(code, client) {
    return this.applied.get(code)?.get(client) ?? 0;
  }

  noteApplied(code, client, seq) {
    this.applied.get(code)?.set(client, seq);
    this.changed(code);
  }

  changed(code) {
    clearTimeout(this.timers.get(code));
    this.timers.set(code, setTimeout(() => this.save(code), SAVE_DELAY_MS));
  }

  save(code) {
    this.timers.delete(code);
    const space = this.spaces.get(code);
    if (!space) return;
    const file = this.file(code);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...space, applied: Object.fromEntries(this.applied.get(code) ?? []) }));
    fs.renameSync(`${file}.tmp`, file);
  }

  flush() {
    for (const [code, timer] of this.timers) {
      clearTimeout(timer);
      this.save(code);
    }
  }

  file(code) {
    return path.join(this.dataDir, `${code}.json`);
  }
}
