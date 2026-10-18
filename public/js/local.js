// This device's saved copy of its space, in IndexedDB: the space itself and
// the changes the server has not yet confirmed. With it the app opens and
// works without the server, and it sends the waiting changes when the server
// is back.
//
// IndexedDB holds far more than local storage, which a space with many
// strokes could exceed. Every function resolves instead of throwing, because
// a browser can refuse IndexedDB (private browsing); the app then works as
// it did before, online only.

const DB = 'inkbridge';
const STORE = 'state';
const KEY = 'current';

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, action) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

// Returns { space, outbox } or null.
export async function loadLocal() {
  try {
    return (await run('readonly', (store) => store.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

export async function saveLocal(record) {
  try {
    await run('readwrite', (store) => store.put(record, KEY));
  } catch {
    // Not saved. The server still has everything it was sent.
  }
}

export async function clearLocal() {
  try {
    await run('readwrite', (store) => store.delete(KEY));
  } catch {
    // Nothing to clear.
  }
}
