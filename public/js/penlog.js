// A temporary recorder for finding why Pencil lines break into dots and why
// ink blinks while zooming. Each entry is one input or drawing event with
// the time it happened. Entries collect here and go to the server about
// once a second, which appends them to data/pen.log on the computer.

let send = null;
const waiting = [];

// `emit` sends a batch of entries; until it is set, entries wait.
export function startPenLog(emit) {
  send = emit;
  setInterval(flush, 1000);
}

export function penLog(kind, fields = {}) {
  waiting.push({ t: Math.round(performance.now() * 10) / 10, kind, ...fields });
  if (waiting.length > 5000) waiting.splice(0, waiting.length - 5000);
}

function flush() {
  if (!send || !waiting.length) return;
  send({ at: Date.now(), now: performance.now(), entries: waiting.splice(0) });
}
