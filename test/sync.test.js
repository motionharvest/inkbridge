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

  server.store.flush();
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, `${created.space.code}.json`), 'utf8'));
  assert.equal(saved.notebooks.length, 1);
});
