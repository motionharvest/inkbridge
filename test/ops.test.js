import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOp, emptySpace, newId } from '../public/js/shared/ops.js';

function spaceWithNotebook() {
  const space = emptySpace('123456');
  const notebook = { id: newId(), title: 'Ideas' };
  const page = { id: newId(), paper: { color: '#111111', dots: '#999999' } };
  assert.ok(applyOp(space, { type: 'notebook.create', notebook, page }));
  return { space, notebookId: notebook.id, pageId: page.id };
}

test('a new notebook starts with one page that keeps its paper', () => {
  const { space, notebookId, pageId } = spaceWithNotebook();
  assert.deepEqual(space.notebooks[0].pageIds, [pageId]);
  assert.equal(space.notebooks[0].id, notebookId);
  assert.deepEqual(space.pages[pageId].paper, { color: '#111111', dots: '#999999' });
});

test('page.create appends at the end and rejects duplicate ids', () => {
  const { space, notebookId } = spaceWithNotebook();
  const page = { id: newId(), paper: { color: '#222222', dots: '#888888' } };
  assert.ok(applyOp(space, { type: 'page.create', notebookId, page }));
  assert.equal(space.notebooks[0].pageIds.at(-1), page.id);
  assert.equal(applyOp(space, { type: 'page.create', notebookId, page }), false);
});

test('strokes start, extend, and are removed', () => {
  const { space, pageId } = spaceWithNotebook();
  const stroke = { id: newId(), color: '#ffd166', width: 4, points: [[1, 2, 0.5]] };
  assert.ok(applyOp(space, { type: 'stroke.start', pageId, stroke }));
  assert.ok(applyOp(space, { type: 'stroke.extend', pageId, strokeId: stroke.id, points: [[3, 4, 0.6], ['bad']] }));
  assert.deepEqual(space.pages[pageId].strokes[0].points, [[1, 2, 0.5], [3, 4, 0.6]]);
  assert.ok(applyOp(space, { type: 'stroke.remove', pageId, strokeId: stroke.id }));
  assert.equal(space.pages[pageId].strokes.length, 0);
});

test('stored state does not share arrays with the op', () => {
  const { space, pageId } = spaceWithNotebook();
  const stroke = { id: newId(), color: '#ffffff', width: 4, points: [[1, 1, 1]] };
  applyOp(space, { type: 'stroke.start', pageId, stroke });
  stroke.points.push([9, 9, 1]);
  assert.equal(space.pages[pageId].strokes[0].points.length, 1);
});

test('invalid input is rejected or cleaned', () => {
  const { space, notebookId, pageId } = spaceWithNotebook();
  assert.equal(applyOp(space, { type: 'nope' }), false);
  assert.equal(applyOp(space, null), false);
  assert.equal(applyOp(space, { type: 'page.create', notebookId, page: { id: '../etc' } }), false);
  applyOp(space, { type: 'page.paper', pageId, paper: { color: 'red', dots: '#123456' } });
  assert.deepEqual(space.pages[pageId].paper, { color: '#231f29', dots: '#123456' });
});

test('deleting a notebook deletes its pages', () => {
  const { space, notebookId, pageId } = spaceWithNotebook();
  assert.ok(applyOp(space, { type: 'notebook.delete', id: notebookId }));
  assert.equal(space.notebooks.length, 0);
  assert.equal(space.pages[pageId], undefined);
});

test('stroke.replace swaps a stroke for its pieces in the same place', () => {
  const { space, pageId } = spaceWithNotebook();
  const ids = [newId(), newId(), newId()];
  for (const id of ids) applyOp(space, { type: 'stroke.start', pageId, stroke: { id, color: '#ffffff', width: 4, points: [[0, 0, 1]] } });
  const pieces = [newId(), newId()].map((id) => ({ id, color: '#ffffff', width: 4, points: [[1, 1, 1], [2, 2, 1]] }));
  assert.ok(applyOp(space, { type: 'stroke.replace', pageId, remove: [ids[1]], add: pieces }));
  assert.deepEqual(space.pages[pageId].strokes.map((s) => s.id), [ids[0], pieces[0].id, pieces[1].id, ids[2]]);
  assert.equal(applyOp(space, { type: 'stroke.replace', pageId, remove: ['missing1'], add: [] }), false);
});

test('page.delete closes the gap and keeps at least one page', () => {
  const { space, notebookId, pageId } = spaceWithNotebook();
  const second = { id: newId(), paper: {} };
  applyOp(space, { type: 'page.create', notebookId, page: second });
  assert.ok(applyOp(space, { type: 'page.delete', notebookId, pageId }));
  assert.deepEqual(space.notebooks[0].pageIds, [second.id]);
  assert.equal(space.pages[pageId], undefined);
  assert.equal(applyOp(space, { type: 'page.delete', notebookId, pageId: second.id }), false);
});

test('pasted items are added, cleaned, and removed', () => {
  const { space, pageId } = spaceWithNotebook();
  const image = { id: newId(), kind: 'image', asset: `${'a'.repeat(32)}.png`, x: 10, y: 20, width: 300, height: 200 };
  assert.ok(applyOp(space, { type: 'item.add', pageId, item: image }));
  assert.equal(applyOp(space, { type: 'item.add', pageId, item: image }), false);
  assert.equal(applyOp(space, { type: 'item.add', pageId, item: { ...image, id: newId(), asset: '../secret.png' } }), false);
  const text = { id: newId(), kind: 'text', text: 'hello', x: 0, y: 0, width: 100, size: 28, color: '#ffd166', extra: 1 };
  assert.ok(applyOp(space, { type: 'item.add', pageId, item: text }));
  assert.equal(space.pages[pageId].items[1].extra, undefined);
  assert.ok(applyOp(space, { type: 'item.remove', pageId, itemId: image.id }));
  assert.deepEqual(space.pages[pageId].items.map((i) => i.id), [text.id]);
});

test('pages saved before pasting existed accept items', () => {
  const { space, pageId } = spaceWithNotebook();
  delete space.pages[pageId].items;
  const text = { id: newId(), kind: 'text', text: 'old page', x: 0, y: 0, width: 100 };
  assert.ok(applyOp(space, { type: 'item.add', pageId, item: text }));
  assert.equal(space.pages[pageId].items.length, 1);
});

test('page.move shifts the chosen strokes and items only', () => {
  const { space, pageId } = spaceWithNotebook();
  const moved = { id: newId(), color: '#ffffff', width: 4, points: [[10, 10, 0.5], [20, 20, 0.5]] };
  const kept = { id: newId(), color: '#ffffff', width: 4, points: [[50, 50, 0.5]] };
  applyOp(space, { type: 'stroke.start', pageId, stroke: moved });
  applyOp(space, { type: 'stroke.start', pageId, stroke: kept });
  const item = { id: newId(), kind: 'text', text: 'hi', x: 100, y: 100, width: 40, height: 30 };
  applyOp(space, { type: 'item.add', pageId, item });
  assert.ok(applyOp(space, { type: 'page.move', pageId, strokeIds: [moved.id], itemIds: [item.id], dx: 5, dy: -3 }));
  const page = space.pages[pageId];
  assert.deepEqual(page.strokes[0].points.map((p) => p.slice(0, 2)), [[15, 7], [25, 17]]);
  assert.deepEqual(page.strokes[1].points[0].slice(0, 2), [50, 50]);
  assert.deepEqual([page.items[0].x, page.items[0].y], [105, 97]);
  assert.equal(applyOp(space, { type: 'page.move', pageId, strokeIds: [], itemIds: [], dx: 5, dy: 0 }), false);
  assert.equal(applyOp(space, { type: 'page.move', pageId, strokeIds: [moved.id], dx: 0, dy: 0 }), false);
});
