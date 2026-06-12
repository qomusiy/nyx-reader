// Persistent stores for saved vocabulary, vocabulary folders, and reflow-document
// highlights, kept in a dedicated IndexedDB database (separate from the
// recent-files cache).

const DB_NAME = "nyx-data";
const VERSION = 2;
let dbPromise = null;

// A vocabulary record is now one *sense* (translation), not one word — so the
// same headword can be saved several times (e.g. "run" the verb and the noun).
// The id is derived from word + part of speech + translation so re-saving the
// same sense updates it instead of duplicating.
export function vocabId(word, wordClass, translation) {
  return [String(word ?? "").toLowerCase().trim(), String(wordClass ?? "").toLowerCase().trim(), String(translation ?? "").trim()].join("::");
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("IndexedDB unavailable")); return; }
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction; // the active versionchange transaction
      if (!db.objectStoreNames.contains("highlights")) db.createObjectStore("highlights", { keyPath: "id" });
      if (!db.objectStoreNames.contains("folders")) db.createObjectStore("folders", { keyPath: "id" });

      if (!db.objectStoreNames.contains("vocab")) {
        db.createObjectStore("vocab", { keyPath: "id" });
      } else if (event.oldVersion < 2) {
        // v1 keyed vocab by `word`; migrate every record to the new id scheme so
        // existing saved words survive the upgrade.
        const oldStore = tx.objectStore("vocab");
        const getAll = oldStore.getAll();
        getAll.onsuccess = () => {
          const records = getAll.result || [];
          db.deleteObjectStore("vocab");
          const store = db.createObjectStore("vocab", { keyPath: "id" });
          records.forEach((r) => {
            const id = vocabId(r.word, r.wordClass, r.translation);
            store.put({ ...r, id, folderId: r.folderId || null });
          });
        };
      }
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

/* ---------- Vocabulary (one record per saved sense) ---------- */
export async function saveVocab(record) {
  const s = await store("vocab", "readwrite");
  const id = record.id || vocabId(record.word, record.wordClass, record.translation);
  await asPromise(s.put({ ...record, id, word: String(record.word).toLowerCase(), addedAt: record.addedAt || Date.now() }));
  return id;
}
export async function removeVocab(id) {
  const s = await store("vocab", "readwrite");
  await asPromise(s.delete(id));
}
export async function listVocab() {
  try {
    const s = await store("vocab", "readonly");
    const all = await asPromise(s.getAll());
    return all.sort((a, b) => b.addedAt - a.addedAt);
  } catch { return []; }
}
export async function hasVocab(id) {
  try {
    const s = await store("vocab", "readonly");
    return !!(await asPromise(s.get(id)));
  } catch { return false; }
}
export async function getVocab(id) {
  try {
    const s = await store("vocab", "readonly");
    return (await asPromise(s.get(id))) || null;
  } catch { return null; }
}
// Move a saved card to a different folder.
export async function moveVocab(id, folderId) {
  const s = await store("vocab", "readwrite");
  const record = await asPromise(s.get(id));
  if (record) await asPromise(s.put({ ...record, folderId }));
}
// Persist a card's spaced-repetition state after a review.
export async function setVocabSrs(id, srs) {
  const s = await store("vocab", "readwrite");
  const record = await asPromise(s.get(id));
  if (record) await asPromise(s.put({ ...record, srs }));
}

/* ---------- Vocabulary folders ---------- */
export async function listFolders() {
  try {
    const s = await store("folders", "readonly");
    const all = await asPromise(s.getAll());
    return all.sort((a, b) => a.createdAt - b.createdAt);
  } catch { return []; }
}
export async function saveFolder(folder) {
  const s = await store("folders", "readwrite");
  const record = { ...folder, id: folder.id || `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: folder.createdAt || Date.now() };
  await asPromise(s.put(record));
  return record;
}
// Update mutable folder fields (name, color) in place.
export async function updateFolder(id, patch) {
  const s = await store("folders", "readwrite");
  const record = await asPromise(s.get(id));
  if (record) { await asPromise(s.put({ ...record, ...patch, id })); return { ...record, ...patch, id }; }
  return null;
}
export async function getFolder(id) {
  if (!id) return null;
  try {
    const s = await store("folders", "readonly");
    return (await asPromise(s.get(id))) || null;
  } catch { return null; }
}
// Removing a folder also removes the words inside it (one transaction).
export async function removeFolder(id) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["folders", "vocab"], "readwrite");
    tx.objectStore("folders").delete(id);
    const vocab = tx.objectStore("vocab");
    const cursorReq = vocab.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      if (cursor.value.folderId === id) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
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
