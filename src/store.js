// Persistent stores for saved vocabulary and reflow-document highlights, kept
// in a dedicated IndexedDB database (separate from the recent-files cache).

const DB_NAME = "nyx-data";
const VERSION = 1;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("IndexedDB unavailable")); return; }
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("vocab")) db.createObjectStore("vocab", { keyPath: "word" });
      if (!db.objectStoreNames.contains("highlights")) db.createObjectStore("highlights", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function store(name, mode) {
  return openDb().then((db) => db.transaction(name, mode).objectStore(name));
}
function asPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ---------- Vocabulary (one record per word) ---------- */
export async function saveVocab(record) {
  const s = await store("vocab", "readwrite");
  await asPromise(s.put({ ...record, word: record.word.toLowerCase(), addedAt: record.addedAt || Date.now() }));
}
export async function removeVocab(word) {
  const s = await store("vocab", "readwrite");
  await asPromise(s.delete(word.toLowerCase()));
}
export async function listVocab() {
  try {
    const s = await store("vocab", "readonly");
    const all = await asPromise(s.getAll());
    return all.sort((a, b) => b.addedAt - a.addedAt);
  } catch { return []; }
}
export async function hasVocab(word) {
  try {
    const s = await store("vocab", "readonly");
    return !!(await asPromise(s.get(word.toLowerCase())));
  } catch { return false; }
}

/* ---------- Reflow highlights (one record per document) ---------- */
export async function getHighlights(id) {
  try {
    const s = await store("highlights", "readonly");
    const record = await asPromise(s.get(id));
    return record?.items || [];
  } catch { return []; }
}
export async function setHighlights(id, items) {
  try {
    const s = await store("highlights", "readwrite");
    if (items.length) await asPromise(s.put({ id, items }));
    else await asPromise(s.delete(id));
  } catch (error) { console.warn("Could not persist highlights", error); }
}
