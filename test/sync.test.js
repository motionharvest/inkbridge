import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { io } from 'socket.io-client';
import { newId } from '../public/js/shared/ops.js';
import { startServer } from '../server/index.js';

let server;
let dataDir;
const clients = [];

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkbridge-'));
  server = await startServer({ port: 0, host: '127.0.0.1', dataDir });
});

after(async () => {
  for (const c of clients) c.close();
  await server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function connect(code) {
  const socket = io(`http://127.0.0.1:${server.port}`, { auth: { code }, forceNew: true });
  clients.push(socket);
  return socket;
}

const call = (socket, event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
const next = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

test('two devices share a space through its code', async () => {
  const ipad = connect();
  const created = await call(ipad, 'space:create');
  assert.match(created.space.code, /^\d{6}$/);

  const desktop = connect();
  assert.equal((await call(desktop, 'space:join', { code: '000000x' })).ok, false);
  const joined = await call(desktop, 'space:join', { code: created.space.code });
  assert.ok(joined.ok);

  const notebook = { id: newId(), title: 'Sketches' };
  const page = { id: newId(), paper: { color: '#231f29', dots: '#9b99a1' } };
  const relayed = next(desktop, 'op');
  ipad.emit('op', { type: 'notebook.create', notebook, page });
  assert.equal((await relayed).notebook.id, notebook.id);

  const viewed = next(desktop, 'view');
  ipad.emit('view', { notebookId: notebook.id, pageId: page.id });
  assert.equal((await viewed).pageId, page.id);

  const late = connect(created.space.code);
  const state = await call(late, 'space:join', { code: created.space.code });
  assert.equal(state.space.notebooks[0].title, 'Sketches');
  assert.equal(state.view.pageId, page.id);

  const toLibrary = next(late, 'view');
  desktop.emit('view', { screen: 'library' });
  assert.deepEqual(await toLibrary, { screen: 'library' });

  server.store.flush();
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, `${created.space.code}.json`), 'utf8'));
  assert.equal(saved.notebooks.length, 1);
});

test('a pasted image is stored once and served by name', async () => {
  const device = connect();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const first = await call(device, 'asset:put', png);
  const second = await call(device, 'asset:put', png);
  assert.ok(first.ok);
  assert.match(first.asset, /^[a-f0-9]{32}\.png$/);
  assert.equal(second.asset, first.asset);
  assert.equal((await call(device, 'asset:put', Buffer.from('not an image'))).ok, false);
  const served = await fetch(`http://127.0.0.1:${server.port}/assets/${first.asset}`);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);
});

test('a numbered change is confirmed, applied once, and remembered across a reconnect', async () => {
  const first = connect();
  const { space } = await call(first, 'space:create');
  const notebook = { id: newId(), title: 'Offline' };
  const page = { id: newId() };
  const client = newId();
  const stroke = { id: newId(), color: '#ffffff', width: 4, points: [[0, 0, 0.5]] };
  const changes = [
    { type: 'notebook.create', notebook, page },
    { type: 'stroke.start', pageId: page.id, stroke },
    { type: 'stroke.extend', pageId: page.id, strokeId: stroke.id, points: [[1, 1, 0.5]] },
  ];

  const watcher = connect();
  await call(watcher, 'space:join', { code: space.code });
  const relayed = [];
  watcher.on('op', (op) => relayed.push(op.type));

  for (const [index, change] of changes.entries()) await call(first, 'op', change, { client, seq: index + 1 });
  // The device lost the last confirmation, so it sends the last change again.
  await call(first, 'op', changes[2], { client, seq: 3 });
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(relayed, ['notebook.create', 'stroke.start', 'stroke.extend']);
  const returning = connect(space.code);
  const joined = await call(returning, 'space:join', { code: space.code, client });
  assert.equal(joined.applied, 3);
  assert.equal(joined.space.pages[page.id].strokes[0].points.length, 2);
  assert.equal((await call(returning, 'space:join', { code: space.code, client: newId() })).applied, 0);

  // The count survives a restart of the server's memory.
  server.store.flush();
  server.store.spaces.clear();
  server.store.applied.clear();
  assert.equal(server.store.lastApplied(space.code, client), 0);
  server.store.get(space.code);
  assert.equal(server.store.lastApplied(space.code, client), 3);
});

test('panning and zooming follow to the other devices on the page', async () => {
  const ipad = connect();
  const { space } = await call(ipad, 'space:create');
  const desktop = connect();
  await call(desktop, 'space:join', { code: space.code });

  const pageId = newId();
  const followed = next(desktop, 'camera');
  ipad.emit('camera', { pageId, cx: 812.5, cy: -40, zoom: 3.2 });
  assert.deepEqual(await followed, { pageId, cx: 812.5, cy: -40, zoom: 3.2 });

  // A camera that is not a place on a page is dropped, not relayed.
  let relayedBad = false;
  desktop.once('camera', () => (relayedBad = true));
  ipad.emit('camera', { pageId, cx: 'left', cy: 0, zoom: 1 });
  ipad.emit('camera', { pageId, cx: 0, cy: 0, zoom: 0 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(relayedBad, false);

  // A device that joins later starts where the others are looking.
  const late = connect(space.code);
  const state = await call(late, 'space:join', { code: space.code });
  assert.deepEqual(state.camera, { pageId, cx: 812.5, cy: -40, zoom: 3.2 });

  // Opening another view starts from the whole page, so the camera clears.
  ipad.emit('view', { notebookId: 'n', pageId: newId() });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const after = await call(connect(space.code), 'space:join', { code: space.code });
  assert.equal(after.camera, null);
});
