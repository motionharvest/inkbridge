import express from 'express';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { applyOp } from '../public/js/shared/ops.js';
import { AssetStore } from './assets.js';
import { copyImageToClipboard, readClipboard } from './clipboard.js';
import { SpaceStore } from './store.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function startServer({ port = 5180, host = '0.0.0.0', dataDir = path.join(root, 'data') } = {}) {
  const store = new SpaceStore(dataDir);
  const assets = new AssetStore(path.join(dataDir, 'assets'));
  const app = express();
  app.use(express.static(path.join(root, 'public')));
  // An asset's name is a hash of its bytes, so its contents never change.
  app.use('/assets', express.static(assets.dir, { immutable: true, maxAge: '1y' }));

  const http = createServer(app);
  const io = new Server(http, { maxHttpBufferSize: 12e6 });

  async function announcePeers(code) {
    const sockets = await io.in(code).fetchSockets();
    io.to(code).emit('peers', sockets.length);
  }

  function attach(socket, code) {
    const previous = socket.data.code;
    if (previous === code) return;
    if (previous) {
      socket.leave(previous);
      announcePeers(previous);
    }
    socket.data.code = code;
    socket.join(code);
    announcePeers(code);
  }

  io.on('connection', (socket) => {
    // A reconnecting device sends its code in the handshake. Joining here,
    // before any event runs, means ops it buffered while offline land in
    // the right space.
    const code = socket.handshake.auth?.code;
    if (store.get(code)) attach(socket, code);

    socket.on('space:create', (ack) => {
      const space = store.create();
      attach(socket, space.code);
      ack?.({ ok: true, space, view: null });
    });

    socket.on('space:join', (request, ack) => {
      const space = store.get(request?.code);
      if (!space) return ack?.({ ok: false, error: 'No space has that code.' });
      attach(socket, space.code);
      ack?.({ ok: true, space, view: store.views.get(space.code) ?? null });
    });

    socket.on('op', (op) => {
      const code = socket.data.code;
      const space = code && store.get(code);
      if (!space || !applyOp(space, op)) return;
      store.changed(code);
      socket.to(code).emit('op', op);
    });

    // The view a device is showing: the notebook list or one page. Every
    // other device opens the same view, and a device that joins later
    // starts on it.
    socket.on('view', (view) => {
      const code = socket.data.code;
      if (!code) return;
      let clean;
      if (view?.screen === 'library') clean = { screen: 'library' };
      else if (view?.screen === 'grid' && typeof view.pageId === 'string') clean = { screen: 'grid', notebookId: String(view.notebookId), pageId: view.pageId };
      else if (typeof view?.pageId === 'string') clean = { screen: 'page', notebookId: String(view.notebookId), pageId: view.pageId };
      else return;
      store.views.set(code, clean);
      socket.to(code).emit('view', clean);
    });

    // A device sends a page as PNG bytes. The server puts it on this
    // computer's clipboard and tells the other devices it happened.
    socket.on('clipboard:image', async (png, ack) => {
      try {
        await copyImageToClipboard(Buffer.isBuffer(png) ? png : Buffer.from(png ?? []));
        ack?.({ ok: true });
        if (socket.data.code) socket.to(socket.data.code).emit('clipboard:copied');
      } catch (error) {
        ack?.({ ok: false, error: error.message });
      }
    });

    // A device pastes an image: the server stores the bytes and answers with
    // the asset name, which the device then puts on a page with item.add.
    socket.on('asset:put', (bytes, ack) => {
      try {
        ack?.({ ok: true, asset: assets.put(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? [])) });
      } catch (error) {
        ack?.({ ok: false, error: error.message });
      }
    });

    // Paste from the computer: the server reads this computer's clipboard.
    // An image is stored as an asset. Text comes back as text.
    socket.on('clipboard:read', async (ack) => {
      try {
        const clip = await readClipboard();
        if (clip.kind === 'image') ack?.({ ok: true, kind: 'image', asset: assets.put(clip.bytes) });
        else ack?.({ ok: true, kind: 'text', text: clip.text });
      } catch (error) {
        ack?.({ ok: false, error: error.message });
      }
    });

    socket.on('disconnect', () => {
      if (socket.data.code) announcePeers(socket.data.code);
    });
  });

  return new Promise((resolve) => {
    http.listen(port, host, () => {
      resolve({
        port: http.address().port,
        store,
        close: () => new Promise((done) => {
          store.flush();
          io.close(() => done());
        }),
      });
    });
  });
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startServer({ port: Number(process.env.PORT) || 5180 });
  console.log(`Inkbridge is running.`);
  console.log(`  This computer:  http://localhost:${server.port}`);
  for (const address of lanAddresses()) console.log(`  Other devices:  http://${address}:${server.port}`);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
