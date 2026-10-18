import { newId } from './shared/ops.js';

// The changes this device has made and the server has not yet confirmed.
//
// Each change gets the next number in this device's own sequence. The server
// remembers the highest number it has applied for each device, so a change
// sent twice, because a confirmation was lost with the connection, is applied
// once. A change leaves the queue when the server confirms it.
export class Outbox {
  constructor({ client = newId(), seq = 0, queue = [] } = {}) {
    this.client = client;
    this.seq = seq;
    this.queue = queue;
  }

  add(op) {
    const entry = { seq: ++this.seq, op };
    this.queue.push(entry);
    return entry;
  }

  // Drops every change numbered `seq` or lower.
  confirm(seq) {
    this.queue = this.queue.filter((entry) => entry.seq > seq);
  }

  toJSON() {
    return { client: this.client, seq: this.seq, queue: this.queue };
  }
}
