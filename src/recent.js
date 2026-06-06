// Recent documents, persisted in IndexedDB so a file can be reopened with one
// click — including offline and on mobile. Browsers can't re-read a file from
// its disk path for security reasons, so we keep a copy of the bytes instead.

const DB_NAME = "nyx-reader";
const STORE = "docs";
const MAX_ITEMS = 8; // keep the most-recent few; evict older ones
const MAX_BYTES = 60 * 1024 * 1024; // don't cache very large files (60 MB)

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("IndexedDB unavailable")); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("openedAt", "openedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function tx(mode) {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function asPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// A stable id for the same file across sessions (name + size + mtime).
export function fileId(file) {
  return `${file.name}::${file.size}::${file.lastModified || 0}`;
}

// Store a copy of the bytes. `buffer` must be a detached-safe clone — pdf.js
// transfers the original ArrayBuffer to its worker, so callers pass a slice.
export async function saveRecent(file, buffer, kind) {
  try {
    if (!buffer || buffer.byteLength > MAX_BYTES) {
      // Still record metadata-only so it shows in the list (re-pick needed).
      await put({ id: fileId(file), name: file.name, size: file.size,
        lastModified: file.lastModified || 0, kind, openedAt: Date.now(), data: null });
    } else {
      await put({ id: fileId(file), name: file.name, size: file.size,
        lastModified: file.lastModified || 0, kind, openedAt: Date.now(), data: buffer });
    }
    await evictOld();
  } catch (error) {
    console.warn("Could not save recent file", error);
  }
}

async function put(record) {
  const store = await tx("readwrite");
  await asPromise(store.put(record));
}

export async function listRecent() {
  try {
    const store = await tx("readonly");
    const all = await asPromise(store.getAll());
    return all.sort((a, b) => b.openedAt - a.openedAt);
  } catch {
    return [];
  }
}

export async function getRecent(id) {
  const store = await tx("readonly");
  return asPromise(store.get(id));
}

export async function removeRecent(id) {
  try {
    const store = await tx("readwrite");
    await asPromise(store.delete(id));
  } catch (error) {
    console.warn("Could not remove recent file", error);
  }
}

// Bump the open time when a recent file is reopened, so it sorts to the top.
export async function touchRecent(id) {
  try {
    const record = await getRecent(id);
    if (record) { record.openedAt = Date.now(); await put(record); }
  } catch { /* non-fatal */ }
}

async function evictOld() {
  const all = await listRecent();
  for (const record of all.slice(MAX_ITEMS)) await removeRecent(record.id);
}
