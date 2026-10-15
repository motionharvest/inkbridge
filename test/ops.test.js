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

test('stroke.add restores a stroke at its old position', () => {
  const { space, pageId } = spaceWithNotebook();
  const first = { id: newId(), color: '#ffffff', width: 4, points: [[0, 0, 1]] };
  const second = { id: newId(), color: '#ffffff', width: 4, points: [[5, 5, 1]] };
  applyOp(space, { type: 'stroke.start', pageId, stroke: first });
  applyOp(space, { type: 'stroke.start', pageId, stroke: second });
  applyOp(space, { type: 'stroke.remove', pageId, strokeId: first.id });
  assert.ok(applyOp(space, { type: 'stroke.add', pageId, stroke: first, index: 0 }));
  assert.deepEqual(space.pages[pageId].strokes.map((s) => s.id), [first.id, second.id]);
  assert.equal(applyOp(space, { type: 'stroke.add', pageId, stroke: first, index: 0 }), false);
});
