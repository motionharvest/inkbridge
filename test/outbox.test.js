import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Outbox } from '../public/js/outbox.js';

test('changes are numbered in order and leave the queue when confirmed', () => {
  const outbox = new Outbox({ client: 'device' });
  const numbers = ['a', 'b', 'c'].map((type) => outbox.add({ type }).seq);
  assert.deepEqual(numbers, [1, 2, 3]);
  outbox.confirm(2);
  assert.deepEqual(outbox.queue.map((entry) => entry.op.type), ['c']);
  assert.equal(outbox.add({ type: 'd' }).seq, 4);
});

test('a saved outbox keeps counting where it stopped', () => {
  const outbox = new Outbox({ client: 'device' });
  outbox.add({ type: 'a' });
  const restored = new Outbox(JSON.parse(JSON.stringify(outbox)));
  assert.equal(restored.client, 'device');
  assert.equal(restored.add({ type: 'b' }).seq, 2);
  assert.equal(restored.queue.length, 2);
});
