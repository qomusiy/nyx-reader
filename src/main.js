import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
  PDFFindController,
  SpreadMode,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./style.css";
import { fetchWord, suggestWords } from "./dictionary.js";
import { saveRecent, listRecent, touchRecent, removeRecent, getRecent, fileId } from "./recent.js";
import { BUILTIN_BOOKS } from "./library.js";
import { readText, readDocx, readEpub } from "./readers/reflow.js";
import {
  saveVocab, removeVocab, listVocab, hasVocab, vocabId, getVocab, moveVocab, setVocabSrs,
  listFolders, saveFolder, getFolder, removeFolder, updateFolder,
  getHighlights, setHighlights,
} from "./store.js";
import { GUIDE_HTML } from "./welcome.js";
import { t, getLang, setLang, applyI18n, onLangChange } from "./i18n.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
const { AnnotationEditorType, AnnotationEditorParamsType } = pdfjsLib;

/* ---------- Elements ---------- */
const $ = (sel) => document.querySelector(sel);
const app = $("#app");
const fileInput = $("#file-input");
const container = $("#viewer-container");
const viewer = $("#viewer");
const docReader = $("#doc-reader");
const library = $("#library");
const vocabView = $("#vocab");
const vocabListEl = $("#vocab-list");
const vocabCount = $("#vocab-count");
const vocabEmpty = $("#vocab-empty");
const recentFiles = $("#recent-files");
const recentList = $("#recent-list");
const recentMore = $("#recent-more");
const builtinList = $("#builtin-list");
const docTitle = $("#doc-title");
const docSub = $("#doc-sub");

const railNav = [...document.querySelectorAll(".rail [data-nav]")];
const railToggle = $("#rail-toggle");
const focusBtn = $("#focus-btn");
const gearBtn = $("#gear-btn");
const openBtn = $("#open-btn");
const libOpen = $("#lib-open");
const tocBtn = $("#toc-btn");


const annotationTools = $("#annotation-tools");
const toolHighlight = $("#tool-highlight");
const toolNote = $("#tool-note");
const annotbar = $("#annotbar");
const highlightColors = $("#highlight-colors");
const swatches = [...document.querySelectorAll(".swatch[data-color]")];
const editUndo = $("#edit-undo");
const editRedo = $("#edit-redo");
const editDelete = $("#edit-delete");
const savePdfButton = $("#save-pdf");

const findButton = $("#find-button");
const findBar = $("#find-bar");
const findInput = $("#find-input");
const findCount = $("#find-count");
const findPrev = $("#find-prev");
const findNext = $("#find-next");
const findClose = $("#find-close");

const dictButton = $("#dict-button");
const dict = $("#dict");
const dictX = $("#dict-x");
const dictionaryContent = $("#dictionary-content");
const searchInput = $("#search-input");
const suggestionsBox = $("#suggestions");

const toc = $("#toc");
const tocList = $("#toc-list");
const tocX = $("#toc-x");

const scrim = $("#scrim");
const sheet = $("#sheet");
const sheetX = $("#sheet-x");
const aaBtn = $("#aa-btn");
const aaPanel = $("#aa-panel");
const aaX = $("#aa-x");
const readingGroup = $("#reading-group");
const pdfGroup = $("#pdf-group");
const langSeg = $("#lang-seg");
const themeSegs = [...document.querySelectorAll(".theme-seg")];
const fontSel = $("#font-sel");
const sizeR = $("#size-r");
const leadR = $("#lead-r");
const measR = $("#meas-r");
const sizeVal = $("#size-val");
const leadVal = $("#lead-val");
const measVal = $("#meas-val");
const spreadButton = $("#cycle-spread");
const spreadState = $("#spread-state");
const annotationsToggle = $("#toggle-annotations");
const annotState = $("#annot-state");
const focusMenu = $("#focus-menu");
const menuFocus = $("#menu-focus");
const menuFullscreen = $("#menu-fullscreen");
const fullscreenLabel = $("#fullscreen-label");
const propertiesButton = $("#properties");
const shortcutsButton = $("#shortcuts");

const footPos = $("#foot-pos");
const footStat = $("#foot-stat");
const progressFill = $("#progress-fill");
const prevPage = $("#prev-page");
const nextPage = $("#next-page");

const pop = $("#pop");
const popWord = $("#pop-word");
const popPh = $("#pop-ph");
const popGloss = $("#pop-gloss");
const popMore = $("#pop-more");
const popAudio = $("#pop-audio");
const popSave = $("#pop-save");
const popClose = $("#pop-close");
const focusExit = $("#focus-exit");
const triggerSeg = $("#trigger-seg");

const toastEl = $("#toast");

const modal = $("#modal");
const modalTitle = $("#modal-title");
const modalBody = $("#modal-body");
const modalClose = $("#modal-close");

/* ---------- Viewer setup ---------- */
const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const findController = new PDFFindController({ eventBus, linkService });
const pdfViewer = new PDFViewer({
  container,
  viewer,
  eventBus,
  linkService,
  findController,
  annotationEditorMode: AnnotationEditorType.NONE,
  // Register our swatch palette so the chosen highlight colour is accepted as
  // the default for new highlights (otherwise pdf.js can fall back to yellow).
  annotationEditorHighlightColors: "yellow=#fff066,green=#9ce28b,pink=#ffb3c8,blue=#9fd2ff",
});
linkService.setViewer(pdfViewer);

let loadingTask = null;
let currentDocument = null;
let currentDocName = "";
let currentFileSize = 0;
let viewMode = "none"; // "none" | "pdf" | "reflow"
let reflowCleanup = null;
let currentTool = "select";
let currentFileId = "";
let currentKind = "";
let reflowCleanHTML = "";   // sanitized doc HTML, before highlight wrapping
let reflowHighlights = [];  // [{ start, end, color }] absolute char offsets
let currentLookup = null;   // { word, context, rows } for the active lookup
let triggerMode = localStorage.getItem("nyx-trigger") === "double" ? "double" : "single";

const DEFAULT_HIGHLIGHT = "#fff066";
const spreadCycle = [SpreadMode.NONE, SpreadMode.ODD, SpreadMode.EVEN];
const SPREAD_KEYS = ["spread.off", "spread.odd", "spread.even"];
let spreadIndex = 0;
let currentQuery = "";

const mobileMedia = window.matchMedia("(max-width: 780px)");
function isMobile() { return mobileMedia.matches; }

/* ---------- View switching (reader / library) ---------- */
function showView(name) {
  container.hidden = name !== "read";
  library.hidden = name !== "lib";
  vocabView.hidden = name !== "vocab";
  document.body.dataset.view = name;
  railNav.forEach((b) => b.classList.toggle("on", b.dataset.nav === name));
  hidePopover();
  closeCtxMenu();
  if (name !== "read") { closeFind(); closeDict(); closeToc(); closeNoteEditor(); closeAa(); }
}
railNav.forEach((b) => b.addEventListener("click", () => {
  closeRail();
  if (b.dataset.nav === "lib") { renderBuiltin(); refreshRecent(); showView("lib"); }
  else if (b.dataset.nav === "vocab") { openDeckId = null; refreshVocab(); showView("vocab"); }
  else showView("read");
}));

// The Reader is never blank: with no document open it shows the guide. The
// guide is reflow HTML, so it honours the reading-typography settings — we flag
// it as such so the "Aa" panel exposes those controls (not just the theme).
let guideShown = false;
function showGuide() {
  reflowCleanHTML = "";
  reflowHighlights = [];
  currentFileId = "";
  docReader.innerHTML = GUIDE_HTML;
  docReader.hidden = false;
  viewer.hidden = true;
  guideShown = true;
  docTitle.textContent = "Nyx Reader";
  docSub.textContent = "Guide";
}

/* ---------- File open (routes by type) ---------- */
fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  await openFile(file);
  fileInput.value = "";
});
openBtn.addEventListener("click", () => fileInput.click());
libOpen.addEventListener("click", () => fileInput.click());

const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".text"];
function detectKind(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".epub")) return "epub";
  if (name.endsWith(".docx")) return "docx";
  if (TEXT_EXTENSIONS.some((ext) => name.endsWith(ext)) || file.type.startsWith("text/")) return "text";
  return null;
}
function mimeFor(kind) {
  return kind === "pdf" ? "application/pdf"
    : kind === "epub" ? "application/epub+zip"
    : kind === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "text/plain";
}

async function openFile(file, { fromRecent = false } = {}) {
  const kind = detectKind(file);
  if (!kind) { toast(t("toast.unsupported")); return; }
  closeRail();
  if (kind === "pdf") await openPdf(file, fromRecent);
  else await openReflow(file, kind, fromRecent);
}

async function closeCurrent() {
  if (currentDocument || loadingTask) {
    try { pdfViewer.setDocument(null); linkService.setDocument(null); } catch { /* not initialised */ }
    if (loadingTask) { try { await loadingTask.destroy(); } catch { /* already gone */ } }
  }
  loadingTask = null;
  currentDocument = null;
  if (reflowCleanup) { try { reflowCleanup(); } catch { /* non-fatal */ } reflowCleanup = null; }
  docReader.replaceChildren();
  docReader.hidden = true;
  reflowHighlights = [];
  reflowCleanHTML = "";
  currentFileId = "";
  currentKind = "";
  document.body.classList.remove("has-annotations");
  setTool("select");
}

async function openPdf(file, fromRecent = false) {
  docTitle.textContent = file.name;
  docSub.textContent = t("doc.opening");
  closeFind();
  showView("read");

  try {
    await closeCurrent();

    const data = await file.arrayBuffer();
    const forCache = data.slice(0); // pdf.js detaches the buffer; keep a clone to cache
    loadingTask = pdfjsLib.getDocument({ data, isEvalSupported: false });
    currentDocument = await loadingTask.promise;
    currentDocName = file.name;
    currentFileSize = file.size;
    currentFileId = fileId(file);
    currentKind = "pdf";
    viewMode = "pdf";
    guideShown = false;
    document.body.classList.remove("reflow-mode");
    viewer.hidden = false;
    pdfViewer.setDocument(currentDocument);
    linkService.setDocument(currentDocument);

    toolNote.style.display = "";
    annotationTools.hidden = !annotationsEnabled;
    findButton.hidden = false;

    if (!fromRecent) saveRecentSafe(file, "pdf", forCache);
    refreshRecent();
  } catch (error) {
    console.error(error);
    failOpen(t("toast.pdfOpenFail"));
  }
}

async function openReflow(file, kind, fromRecent = false) {
  docTitle.textContent = file.name;
  docSub.textContent = t("doc.opening");
  closeFind();
  showView("read");

  try {
    await closeCurrent();

    let html;
    if (kind === "text") html = await readText(file);
    else if (kind === "docx") html = await readDocx(file);
    else { const result = await readEpub(file); html = result.html; reflowCleanup = result.cleanup; }

    reflowCleanHTML = html; // sanitized inside the readers
    docReader.innerHTML = html;
    docReader.hidden = false;
    viewer.hidden = true;
    container.scrollTop = 0;

    currentDocName = file.name;
    currentFileSize = file.size;
    currentFileId = fileId(file);
    currentKind = kind;
    viewMode = "reflow";
    guideShown = false;
    document.body.classList.add("reflow-mode");
    // Highlighting + notes work on reflow text too.
    toolNote.style.display = "";
    annotationTools.hidden = !annotationsEnabled;
    findButton.hidden = false;
    docSub.textContent = readerLabel(kind);

    reflowHighlights = await getHighlights(currentFileId);
    renderReflowHighlights();
    buildTOC();
    updateProgress();
    restoreReadingProgress();
    if (!fromRecent) saveRecentSafe(file, kind);
    refreshRecent();
  } catch (error) {
    console.error(error);
    failOpen(t("toast.fileOpenFail"));
  }
}

function readerLabel(kind) {
  return t(kind === "epub" ? "doc.epub" : kind === "docx" ? "doc.docx" : "doc.text");
}
// Re-derive the header subtitle from current state (used on language change too).
function refreshDocSub() {
  if (viewMode === "pdf" && currentDocument) {
    const n = currentDocument.numPages;
    docSub.textContent = getLang() === "en" && n === 1 ? "1 page" : t("doc.pages", { n });
  } else if (viewMode === "reflow") {
    docSub.textContent = readerLabel(currentKind);
  } else if (viewMode === "none") {
    docSub.textContent = t("doc.openToBegin");
  }
}

function failOpen(message) {
  loadingTask = null;
  currentDocument = null;
  reflowCleanup = null;
  viewMode = "none";
  viewer.hidden = false;
  docReader.hidden = true;
  docTitle.textContent = "Nyx Reader";
  docSub.textContent = "";
  document.body.classList.remove("reflow-mode");
  annotationTools.hidden = true;
  annotbar.hidden = true;
  findButton.hidden = true;
  showView("lib");
  toast(message);
}

/* ---------- Recent files (IndexedDB, one-click reopen) ---------- */
async function saveRecentSafe(file, kind, buffer) {
  try {
    const bytes = buffer || (await file.arrayBuffer());
    await saveRecent(file, bytes, kind);
  } catch (error) {
    console.warn("Could not cache recent file", error);
  }
}

const RECENT_PREVIEW = 3; // how many recents to show before "Show all"
let recentExpanded = false;
let recentItems = [];

async function refreshRecent() {
  try { recentItems = await listRecent(); } catch { recentItems = []; }
  if (!recentItems.length) { recentFiles.hidden = true; recentMore.hidden = true; return; }
  recentFiles.hidden = false;
  renderRecentList();
}

function renderRecentList() {
  recentList.replaceChildren();
  const shown = recentExpanded ? recentItems : recentItems.slice(0, RECENT_PREVIEW);
  shown.forEach((record) => recentList.append(recentRow(record)));

  if (recentItems.length > RECENT_PREVIEW) {
    recentMore.hidden = false;
    recentMore.textContent = recentExpanded
      ? t("lib.showLess")
      : t("lib.showAll", { n: recentItems.length });
  } else {
    recentMore.hidden = true;
  }
}
recentMore.addEventListener("click", () => { recentExpanded = !recentExpanded; renderRecentList(); });

// One recent as a horizontal list row: thumbnail, name, meta, progress, remove.
function recentRow(record) {
  const builtin = builtinFor(record);
  const name = builtin ? builtin.title : record.name;

  const row = document.createElement("div");
  row.className = "rrow";

  const open = document.createElement("button");
  open.type = "button";
  open.className = "rrow-open";
  open.setAttribute("aria-label", name);

  // Thumbnail — a real cover for built-ins, a tinted initial otherwise.
  const thumb = document.createElement("div");
  thumb.className = "rrow-thumb";
  if (builtin) {
    const img = document.createElement("img");
    img.src = builtin.cover; img.alt = ""; img.loading = "lazy"; img.decoding = "async";
    thumb.append(img);
  } else {
    thumb.style.background = coverColor(record.name);
    thumb.append(createTextElement("span", coverLetter(record.name), "rrow-letter"));
  }
  open.append(thumb);

  const main = document.createElement("div");
  main.className = "rrow-main";
  main.append(createTextElement("div", name, "rrow-name"));
  const meta = [recentBadge(record.kind), formatBytes(record.size), relativeTime(record.openedAt)];
  main.append(createTextElement("div", meta.join(" · "), "rrow-meta"));
  open.append(main);

  // Reading progress (the "how much read" line).
  const fraction = readingFraction(record.id);
  const side = document.createElement("div");
  side.className = "rrow-side";
  const bar = document.createElement("div");
  bar.className = "rrow-progress";
  const fill = document.createElement("div");
  fill.className = "rrow-progress-fill";
  fill.style.width = `${Math.round(fraction * 100)}%`;
  bar.append(fill);
  side.append(bar);
  side.append(createTextElement("div",
    fraction > 0.01 ? t("recent.read", { n: Math.round(fraction * 100) }) : t("recent.notStarted"),
    "rrow-pct"));
  open.append(side);

  open.addEventListener("click", () => openRecent(record));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "rrow-x";
  remove.setAttribute("aria-label", t("vocab.remove", { word: name }));
  remove.innerHTML = `<svg class="ic"><use href="#i-close" /></svg>`;
  remove.addEventListener("click", async (event) => {
    event.stopPropagation();
    await removeRecent(record.id);
    localStorage.removeItem(`nyx-prog::${record.id}`);
    refreshRecent();
  });

  row.append(open, remove);
  return row;
}

// Match a recent record back to a built-in book (so opened built-ins show their
// proper title + cover in the recents list).
function builtinFor(record) {
  return BUILTIN_BOOKS.find((b) => b.file === record.name && b.size === record.size) || null;
}

// Compact "time since last opened" using the i18n unit strings.
function relativeTime(ms) {
  if (!ms) return "";
  const secs = Math.max(0, (Date.now() - ms) / 1000);
  if (secs < 60) return t("time.now");
  const mins = Math.floor(secs / 60);
  if (mins < 60) return t("time.min", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("time.hour", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("time.day", { n: days });
  return t("time.week", { n: Math.floor(days / 7) });
}

/* ---------- Built-in starter library (lazy: fetched only on click) ---------- */
// Stable cache id for a built-in book — matches what saveRecent() stores once
// the book has been opened, so a downloaded book reopens from IndexedDB.
function builtinId(book) { return `${book.file}::${book.size}::0`; }

function renderBuiltin() {
  builtinList.replaceChildren();
  BUILTIN_BOOKS.forEach((book) => {
    const item = document.createElement("div");
    item.className = "recent-item";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "recent-open";

    const cover = document.createElement("div");
    cover.className = "recent-cover";
    if (book.cover) {
      const img = document.createElement("img");
      img.src = book.cover; img.alt = ""; img.loading = "lazy"; img.decoding = "async";
      img.className = "recent-cover-img";
      cover.append(img);
    } else {
      cover.style.background = coverColor(book.title);
      cover.append(createTextElement("span", coverLetter(book.title), "recent-letter"));
    }
    open.append(cover);

    open.append(createTextElement("div", book.title, "recent-name"));
    open.append(createTextElement("div", book.author, "recent-meta-line"));

    const fraction = readingFraction(builtinId(book));
    const bar = document.createElement("div");
    bar.className = "recent-progress";
    const fill = document.createElement("div");
    fill.className = "recent-progress-fill";
    fill.style.width = `${Math.round(fraction * 100)}%`;
    bar.append(fill);
    open.append(bar);
    open.append(createTextElement("div", fraction > 0.01 ? `${Math.round(fraction * 100)}% read` : "Not started", "recent-progress-label"));

    open.addEventListener("click", () => openBuiltin(book, open));
    item.append(open);
    builtinList.append(item);
  });
}

async function openBuiltin(book, button) {
  // 1) Already downloaded once? Open straight from the local cache — offline,
  //    no network. This is what makes the others "not download unless chosen".
  try {
    const cached = await getRecent(builtinId(book));
    if (cached?.data) {
      const file = new File([cached.data], book.file, { type: mimeFor(book.kind), lastModified: 0 });
      await touchRecent(cached.id);
      await openFile(file, { fromRecent: true });
      return;
    }
  } catch { /* fall through to fetch */ }

  // 2) First time: fetch this one book only. The browser caches the response,
  //    and openFile() persists the bytes to IndexedDB for next time.
  if (button) button.classList.add("loading");
  try {
    const response = await fetch(book.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const file = new File([blob], book.file, { type: mimeFor(book.kind), lastModified: 0 });
    await openFile(file);
  } catch (error) {
    console.warn("Could not open built-in book", error);
    toast(t("toast.unsupported"));
  } finally {
    if (button) button.classList.remove("loading");
  }
}

function recentBadge(kind) {
  return kind === "pdf" ? "PDF" : kind === "epub" ? "EPUB" : kind === "docx" ? "DOC" : "TXT";
}
function coverLetter(name) { const m = name.match(/[A-Za-z0-9]/); return (m ? m[0] : "·").toUpperCase(); }
const COVERS = ["#3f7d5e", "#7a5230", "#2f6f7a", "#8a3a52", "#5b5ea6", "#6a7a2f", "#9a5a2c"];
function coverColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return COVERS[hash % COVERS.length];
}

/* ---------- Reading progress (per file, localStorage) ---------- */
function readingFraction(id) { return parseFloat(localStorage.getItem(`nyx-prog::${id}`) || "0") || 0; }
let progressSaveTimer = null;
function saveReadingProgress() {
  if (!currentFileId || viewMode === "none") return;
  clearTimeout(progressSaveTimer);
  progressSaveTimer = setTimeout(() => {
    const max = container.scrollHeight - container.clientHeight;
    const fraction = max > 0 ? container.scrollTop / max : 0;
    localStorage.setItem(`nyx-prog::${currentFileId}`, fraction.toFixed(4));
  }, 500);
}
function restoreReadingProgress() {
  const fraction = readingFraction(currentFileId);
  if (fraction <= 0.01) return;
  requestAnimationFrame(() => {
    const max = container.scrollHeight - container.clientHeight;
    if (max > 0) container.scrollTop = fraction * max;
  });
}

/* ---------- Vocabulary view (decks grid + deck detail) ---------- */
const deckGrid = $("#deck-grid");
const deckNewBtn = $("#deck-new");
const deckBackBtn = $("#deck-back");
const deckTitleEl = $("#deck-title");
const deckDotEl = $("#deck-dot");
const deckStudyBtn = $("#deck-study");
const deckPdfBtn = $("#deck-pdf");
const deckCsvBtn = $("#deck-csv");
const decksView = $("#vocab-decks");
const detailView = $("#vocab-detail");
const detailEmpty = $("#detail-empty");

const DECK_COLORS = ["#3f7d5e", "#2f6f7a", "#5b5ea6", "#8a3a52", "#7a5230", "#6a7a2f", "#9a5a2c", "#4a6da7"];
function nextDeckColor(list) { return DECK_COLORS[list.length % DECK_COLORS.length]; }
function folderColor(folder) {
  if (folder?.color) return folder.color;
  const name = folder?.name || "";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return DECK_COLORS[h % DECK_COLORS.length];
}

let vocabItems = [];       // all saved senses, newest first
let vocabFolderList = [];  // all folders
let openDeckId = null;     // null = grid; "all" or folderId = detail

function folderName(id) {
  const f = vocabFolderList.find((x) => x.id === id);
  return f ? f.name : t("folder.default");
}
function deckItems(id) {
  return id === "all" ? vocabItems : vocabItems.filter((r) => r.folderId === id);
}

/* ---------- Spaced repetition (SM-2-lite) ---------- */
const DAY = 86400000;
function isDue(r) { return !r.srs || (r.srs.due || 0) <= Date.now(); }
function isLearned(r) { return !!(r.srs && r.srs.interval >= 7); }
function dueCount(items) { return items.filter(isDue).length; }
function learnedFraction(items) { return items.length ? items.filter(isLearned).length / items.length : 0; }
function reviewCard(srs, grade) {
  let { ease = 2.5, interval = 0, reps = 0, lapses = 0 } = srs || {};
  if (grade === "again") {
    reps = 0; lapses += 1; interval = 0; ease = Math.max(1.3, ease - 0.2);
  } else {
    reps += 1;
    if (reps === 1) interval = grade === "easy" ? 4 : 1;
    else if (reps === 2) interval = grade === "easy" ? 7 : 3;
    else interval = Math.max(1, Math.round(interval * ease * (grade === "easy" ? 1.3 : 1)));
    if (grade === "easy") ease += 0.15;
    ease = Math.max(1.3, ease);
  }
  return { ease, interval, reps, lapses, due: Date.now() + interval * DAY, last: Date.now() };
}
function intervalLabel(days) { return days < 1 ? t("min.lt") : t("min.day", { n: days }); }

async function refreshVocab() {
  [vocabItems, vocabFolderList] = await Promise.all([listVocab(), listFolders()]);
  // Every word must live in a real folder (there is no "All" bucket). Sweep any
  // orphans — e.g. v1-migrated words — into a default folder so they stay visible.
  if (await rehomeOrphans()) [vocabItems, vocabFolderList] = await Promise.all([listVocab(), listFolders()]);
  if (openDeckId && !vocabFolderList.some((f) => f.id === openDeckId)) openDeckId = null;
  if (openDeckId) { decksView.hidden = true; detailView.hidden = false; renderDeckDetail(); }
  else { detailView.hidden = true; decksView.hidden = false; renderDeckGrid(); }
}

async function rehomeOrphans() {
  const folderIds = new Set(vocabFolderList.map((f) => f.id));
  const orphans = vocabItems.filter((r) => !r.folderId || !folderIds.has(r.folderId));
  if (!orphans.length) return false;
  let home = vocabFolderList[0];
  if (!home) home = await saveFolder({ name: t("folder.default"), color: nextDeckColor([]) });
  for (const r of orphans) await moveVocab(r.id, home.id);
  return true;
}

/* ---------- Progress ring ---------- */
function ringEl(fraction) {
  const r = 15, c = 2 * Math.PI * r, off = c * (1 - fraction), pct = Math.round(fraction * 100);
  const wrap = document.createElement("div");
  wrap.innerHTML = `<svg class="ring" viewBox="0 0 36 36"><circle class="ring-bg" cx="18" cy="18" r="${r}"/><circle class="ring-fill" cx="18" cy="18" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/><text x="18" y="18" text-anchor="middle" dominant-baseline="central">${pct}</text></svg>`;
  return wrap.firstElementChild;
}

/* ---------- Decks grid + stats ---------- */
function renderDeckGrid() {
  deckGrid.replaceChildren();
  vocabEmpty.hidden = vocabItems.length > 0;
  vocabFolderList.forEach((f) => {
    deckGrid.append(deckTile({ id: f.id, name: f.name, color: folderColor(f), items: deckItems(f.id), folder: f }));
  });
  const add = document.createElement("button");
  add.type = "button";
  add.className = "deck deck-add";
  add.innerHTML = `<svg class="ic"><use href="#i-plus" /></svg><span>${t("vocab.newFolder")}</span>`;
  add.addEventListener("click", async () => { const f = await editFolderDialog({}); if (f) openDeck(f.id); });
  deckGrid.append(add);
  renderStats();
}

const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
function renderStats() {
  const stats = $("#vocab-stats");
  stats.replaceChildren();
  if (!vocabItems.length) { stats.hidden = true; return; }
  stats.hidden = false;

  const todayStart = startOfDay();
  const yestStart = todayStart - DAY;
  const learnedAt = (r) => r.srs && r.srs.learnedAt;
  const learnedToday = vocabItems.filter((r) => learnedAt(r) >= todayStart).length;
  const learnedYesterday = vocabItems.filter((r) => learnedAt(r) >= yestStart && learnedAt(r) < todayStart).length;
  const due = dueCount(vocabItems);

  // Daily streak: consecutive days (ending today) with at least one review.
  const studiedDays = new Set(vocabItems.filter((r) => r.srs?.last).map((r) => startOfDay(new Date(r.srs.last))));
  let streak = 0;
  for (let day = todayStart; studiedDays.has(day); day -= DAY) streak += 1;

  stats.append(createTextElement("div", t("stats.title"), "stats-title"));
  const grid = document.createElement("div");
  grid.className = "stats-grid";
  const cards = [
    { value: vocabItems.length, label: t("stats.totalSaved"), icon: "i-cards" },
    { value: learnedToday, label: t("stats.learnedToday"), icon: "i-check", accent: true },
    { value: learnedYesterday, label: t("stats.learnedYesterday"), icon: "i-check" },
    { value: due, label: t("stats.dueNow"), icon: "i-bookmark" },
    { value: streak, label: t("stats.streak"), icon: "i-flame" },
  ];
  cards.forEach((c) => {
    const card = document.createElement("div");
    card.className = "stat" + (c.accent ? " stat-accent" : "");
    card.innerHTML = `<div class="stat-ic"><svg class="ic"><use href="#${c.icon}" /></svg></div>`;
    const body = document.createElement("div");
    body.append(createTextElement("div", String(c.value), "stat-num"));
    body.append(createTextElement("div", c.label, "stat-lbl"));
    card.append(body);
    grid.append(card);
  });
  stats.append(grid);
}

function deckTile({ id, name, color, items, folder }) {
  const count = items.length, due = dueCount(items);
  const el = document.createElement("div");
  el.className = "deck";
  el.tabIndex = 0;
  el.setAttribute("role", "button");

  if (folder) {
    const kebab = document.createElement("button");
    kebab.className = "deck-kebab";
    kebab.setAttribute("aria-label", t("vocab.options"));
    kebab.innerHTML = `<svg class="ic"><use href="#i-more" /></svg>`;
    kebab.addEventListener("click", (e) => { e.stopPropagation(); openDeckMenu(folder, kebab.getBoundingClientRect()); });
    el.append(kebab);
  }

  const top = document.createElement("div");
  top.className = "deck-top";
  const icon = document.createElement("div");
  icon.className = "deck-icon";
  icon.style.background = color;
  icon.innerHTML = `<svg class="ic"><use href="#${folder ? "i-folder" : "i-cards"}" /></svg>`;
  const meta = document.createElement("div");
  meta.append(createTextElement("div", name, "deck-name"));
  meta.append(createTextElement("div", t("vocab.count", { n: count }), "deck-count"));
  top.append(icon, meta);
  el.append(top);

  const foot = document.createElement("div");
  foot.className = "deck-foot";
  foot.append(ringEl(learnedFraction(items)));
  if (due > 0) foot.append(createTextElement("span", t("vocab.due", { n: due }), "deck-due"));
  el.append(foot);

  el.addEventListener("click", () => openDeck(id));
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDeck(id); } });
  return el;
}

function openDeck(id) { openDeckId = id; refreshVocab(); }
function closeDeck() { openDeckId = null; refreshVocab(); }
deckBackBtn.addEventListener("click", closeDeck);
deckNewBtn.addEventListener("click", async () => { const f = await editFolderDialog({}); if (f) openDeck(f.id); });

/* ---------- Deck detail (word list) ---------- */
function renderDeckDetail() {
  const items = deckItems(openDeckId);
  deckTitleEl.textContent = openDeckId === "all" ? t("vocab.allWords") : folderName(openDeckId);
  deckDotEl.style.background = openDeckId === "all" ? "var(--accent)"
    : folderColor(vocabFolderList.find((f) => f.id === openDeckId));
  vocabCount.textContent = items.length ? t("vocab.count", { n: items.length }) : "";
  deckStudyBtn.disabled = !items.length;
  deckPdfBtn.disabled = deckCsvBtn.disabled = !items.length;
  vocabListEl.replaceChildren();
  detailEmpty.hidden = items.length > 0;
  items.forEach((record) => vocabListEl.append(wordRow(record)));
}

function wordRow(record) {
  const row = document.createElement("div");
  row.className = "vocab-row";

  const head = document.createElement("div");
  head.className = "vocab-w";
  head.append(createTextElement("span", record.word, "vocab-word"));
  if (record.pronunciation) head.append(createTextElement("span", record.pronunciation, "vocab-ipa"));
  if (record.wordClass) head.append(createTextElement("span", record.wordClass, "vocab-pos"));
  row.append(head);

  const body = document.createElement("div");
  body.className = "vocab-body";
  body.append(createTextElement("div", record.translation || "—", "vocab-tr"));
  if (record.example) body.append(createTextElement("div", record.example, "vocab-ex"));
  if (record.context) body.append(createTextElement("div", `“${record.context}”`, "vocab-ctx"));
  const meta = [record.source, openDeckId === "all" ? folderName(record.folderId) : ""].filter(Boolean);
  if (meta.length) body.append(createTextElement("div", meta.join(" · "), "vocab-src"));
  row.append(body);

  const kebab = document.createElement("button");
  kebab.className = "vocab-kebab";
  kebab.setAttribute("aria-label", t("vocab.options"));
  kebab.innerHTML = `<svg class="ic"><use href="#i-more" /></svg>`;
  kebab.addEventListener("click", (e) => { e.stopPropagation(); openWordMenu(record, kebab.getBoundingClientRect()); });
  row.append(kebab);
  return row;
}

deckStudyBtn.addEventListener("click", () => startStudy(deckItems(openDeckId), deckTitleEl.textContent));
deckPdfBtn.addEventListener("click", () => openPrintSetup(deckItems(openDeckId), deckTitleEl.textContent, deckColorOf(openDeckId)));
deckCsvBtn.addEventListener("click", () => exportCsv(deckItems(openDeckId), deckTitleEl.textContent));

/* ---------- Word + deck context menus ---------- */
function openWordMenu(record, rect) {
  openCtxMenu(rect, [
    { label: t("vocab.moveTo"), icon: "i-folder", onClick: () => moveWordFlow(record) },
    { sep: true },
    { label: t("vocab.delete"), icon: "i-trash", danger: true, onClick: async () => { await removeVocab(record.id); await refreshVocab(); reflectSaveState(); } },
  ]);
}
async function moveWordFlow(record) {
  const folder = await pickFolder();
  if (!folder) return;
  await moveVocab(record.id, folder.id);
  toast(t("toast.moved", { folder: folder.name }));
  await refreshVocab();
}
function openDeckMenu(folder, rect) {
  openCtxMenu(rect, [
    { label: t("vocab.study"), icon: "i-cards", onClick: () => startStudy(deckItems(folder.id), folder.name) },
    { label: t("vocab.rename"), icon: "i-edit", onClick: async () => { await editFolderDialog({ folder }); await refreshVocab(); } },
    { colors: DECK_COLORS, current: folderColor(folder), onPick: async (color) => { await updateFolder(folder.id, { color }); await refreshVocab(); } },
    { sep: true },
    { label: t("vocab.exportPdf"), icon: "i-download", onClick: () => openPrintSetup(deckItems(folder.id), folder.name, folderColor(folder)) },
    { label: t("vocab.export"), icon: "i-download", onClick: () => exportCsv(deckItems(folder.id), folder.name) },
    { sep: true },
    { label: t("vocab.delete"), icon: "i-trash", danger: true, onClick: async () => {
      const n = deckItems(folder.id).length;
      if (!confirm(t("toast.confirmDeleteFolder", { name: folder.name, n }))) return;
      await removeFolder(folder.id);
      if (openDeckId === folder.id) openDeckId = null;
      await refreshVocab();
      reflectSaveState();
    } },
  ]);
}

const ctxmenu = $("#ctxmenu");
function closeCtxMenu() { ctxmenu.hidden = true; ctxmenu.replaceChildren(); }
function openCtxMenu(rect, entries) {
  ctxmenu.replaceChildren();
  entries.forEach((e) => {
    if (e.sep) { ctxmenu.append(Object.assign(document.createElement("div"), { className: "ctx-sep" })); return; }
    if (e.colors) {
      ctxmenu.append(createTextElement("div", t("vocab.color"), "ctx-label"));
      const row = document.createElement("div");
      row.className = "ctx-swatches";
      e.colors.forEach((col) => {
        const sw = document.createElement("button");
        sw.className = "ctx-swatch" + (col === e.current ? " on" : "");
        sw.style.background = col;
        sw.addEventListener("click", () => { closeCtxMenu(); e.onPick(col); });
        row.append(sw);
      });
      ctxmenu.append(row);
      return;
    }
    const b = document.createElement("button");
    if (e.danger) b.className = "danger";
    b.innerHTML = `<svg class="ic"><use href="#${e.icon}" /></svg>`;
    b.append(createTextElement("span", e.label));
    b.addEventListener("click", () => { closeCtxMenu(); e.onClick(); });
    ctxmenu.append(b);
  });
  ctxmenu.hidden = false;
  const menuRect = ctxmenu.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.right - menuRect.width, window.innerWidth - menuRect.width - 8));
  let top = rect.bottom + 6;
  if (top + menuRect.height > window.innerHeight - 8) top = Math.max(8, rect.top - menuRect.height - 6);
  ctxmenu.style.left = `${left}px`;
  ctxmenu.style.top = `${top}px`;
}
document.addEventListener("click", (e) => { if (!ctxmenu.hidden && !e.target.closest("#ctxmenu")) closeCtxMenu(); });
window.addEventListener("resize", closeCtxMenu);

/* ---------- Create / rename a folder (name + colour) ---------- */
function editFolderDialog({ folder = null } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 60;
    input.className = "folder-input";
    input.placeholder = t("vocab.renamePh");
    input.value = folder ? folder.name : "";

    let chosen = folder ? folderColor(folder) : nextDeckColor(vocabFolderList);
    const colorRow = document.createElement("div");
    colorRow.className = "color-row";
    DECK_COLORS.forEach((col) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "color-dot" + (col === chosen ? " on" : "");
      dot.style.background = col;
      dot.addEventListener("click", () => { chosen = col; [...colorRow.children].forEach((c) => c.classList.toggle("on", c === dot)); });
      colorRow.append(dot);
    });

    const actions = document.createElement("div");
    actions.className = "folder-create";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "pbtn primary";
    save.textContent = folder ? t("note.save") : t("folder.create");
    const submit = async () => {
      const name = input.value.trim();
      if (!name) { toast(t("toast.folderNeedsName")); input.focus(); return; }
      const result = folder ? await updateFolder(folder.id, { name, color: chosen }) : await saveFolder({ name, color: chosen });
      finishFolderPick(result);
    };
    save.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    actions.append(save);

    wrap.append(input, colorRow, actions);
    pendingFolderPick = resolve;
    openModal(folder ? t("vocab.rename") : t("vocab.newFolder"), wrap);
    setTimeout(() => input.focus(), 60);
  });
}

/* ---------- Export helpers ---------- */
function safeName(name) { return String(name || "vocabulary").replace(/[\\/:*?"<>|]+/g, "-").trim() || "vocabulary"; }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
// Render print-ready HTML in a hidden iframe and open the print dialog (where the
// user picks "Save as PDF"). An iframe avoids popup blockers, which broke the
// previous new-window approach.
function printDocument(html) {
  const old = document.getElementById("print-frame");
  if (old) old.remove();
  const iframe = document.createElement("iframe");
  iframe.id = "print-frame";
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = win.document;
  doc.open(); doc.write(html); doc.close();
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    try { win.focus(); win.print(); } catch (e) { console.error(e); }
    setTimeout(() => iframe.remove(), 1500);
  };
  // Give the iframe a tick to lay out before printing (whichever signal lands first).
  iframe.onload = () => setTimeout(fire, 250);
  if (doc.readyState === "complete") setTimeout(fire, 350);
}
function deckColorOf(id) { const f = vocabFolderList.find((x) => x.id === id); return f ? folderColor(f) : "#3f7d5e"; }
function exportCsv(items, title) {
  if (!items.length) { toast(t("toast.noExport")); return; }
  const esc = (s) => `"${String(s || "").replace(/"/g, '""')}"`;
  let csv = "Word,Pronunciation,Part of speech,Translation,Example,Context,Source,Folder\n";
  items.forEach((r) => {
    csv += [esc(r.word), esc(r.pronunciation), esc(r.wordClass), esc(r.translation), esc(r.example), esc(r.context), esc(r.source), esc(folderName(r.folderId))].join(",") + "\n";
  });
  downloadBlob(new Blob([csv], { type: "text/csv" }), `${safeName(title)}.csv`);
  toast(t("toast.exported", { n: items.length }));
}

/* ---------- Printable cut-out cards (fold / double-sided / reference) ---------- */
const PRINT_DEFAULTS = { style: "fold", cols: 3, front: "en", ex: true, ipa: true, ctx: false, src: true };
function loadPrintOpts() { try { return { ...PRINT_DEFAULTS, ...JSON.parse(localStorage.getItem("nyx-print") || "{}") }; } catch { return { ...PRINT_DEFAULTS }; } }
function savePrintOpts(o) { localStorage.setItem("nyx-print", JSON.stringify(o)); }

function openPrintSetup(items, title, color = "#3f7d5e") {
  if (!items.length) { toast(t("toast.noPrint")); return; }
  const opts = loadPrintOpts();
  const wrap = document.createElement("div");
  wrap.className = "print-setup";

  const field = (labelKey, control) => {
    const f = document.createElement("div");
    f.className = "field";
    f.append(createTextElement("label", t(labelKey)));
    f.append(control);
    return f;
  };
  const seg = (options, get, set) => {
    const s = document.createElement("div");
    s.className = "seg print-seg";
    options.forEach((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = o.label;
      b.className = o.value === get() ? "on" : "";
      b.addEventListener("click", () => { set(o.value); [...s.children].forEach((c) => c.classList.toggle("on", c === b)); });
      s.append(b);
    });
    return s;
  };

  wrap.append(field("print.style", seg(
    [{ label: t("print.fold"), value: "fold" }, { label: t("print.duplex"), value: "duplex" }, { label: t("print.reference"), value: "reference" }],
    () => opts.style, (v) => { opts.style = v; },
  )));
  wrap.append(field("print.size", seg(
    [{ label: t("print.large"), value: 2 }, { label: t("print.standard"), value: 3 }, { label: t("print.compact"), value: 4 }],
    () => opts.cols, (v) => { opts.cols = v; },
  )));
  wrap.append(field("print.direction", seg(
    [{ label: t("print.frontEN"), value: "en" }, { label: t("print.frontNative"), value: "native" }],
    () => opts.front, (v) => { opts.front = v; },
  )));

  const inc = document.createElement("div");
  inc.className = "print-incl";
  [["ipa", "print.ipa"], ["ex", "print.example"], ["ctx", "print.context"], ["src", "print.source"]].forEach(([key, labelKey]) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "incl-chip" + (opts[key] ? " on" : "");
    chip.textContent = t(labelKey);
    chip.addEventListener("click", () => { opts[key] = !opts[key]; chip.classList.toggle("on", opts[key]); });
    inc.append(chip);
  });
  wrap.append(field("print.include", inc));

  const gen = document.createElement("button");
  gen.type = "button";
  gen.className = "pbtn primary print-go";
  gen.innerHTML = `<svg class="ic"><use href="#i-download" /></svg><span>${t("print.generate")}</span>`;
  gen.addEventListener("click", () => { savePrintOpts(opts); closeModal(); buildCardsPrint(items, opts, title, color); });
  wrap.append(gen);

  openModal(t("print.title"), wrap);
}

function buildCardsPrint(items, opts, heading, color = "#3f7d5e") {
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const num = new Map(items.map((r, i) => [r, i + 1]));
  const big = opts.cols === 4 ? 0 : opts.cols === 3 ? 1 : 2; // size step

  const wordFace = (r) => `<div class="fc">`
    + `<div class="f-word">${esc(r.word)}</div>`
    + (opts.ipa && r.pronunciation ? `<div class="f-ipa">${esc(r.pronunciation)}</div>` : "")
    + (r.wordClass ? `<div class="f-pos">${esc(r.wordClass)}</div>` : "")
    + `</div>`;
  const meaningFace = (r) => `<div class="fc">`
    + `<div class="f-tr">${esc(r.translation) || "—"}</div>`
    + (opts.ex && r.example ? `<div class="f-ex">${esc(r.example)}</div>` : "")
    + (opts.ctx && r.context ? `<div class="f-ctx">“${esc(r.context)}”</div>` : "")
    + (opts.src && r.source ? `<div class="f-src">${esc(r.source)}</div>` : "")
    + `</div>`;
  const front = (r) => opts.front === "en" ? wordFace(r) : meaningFace(r);
  const back = (r) => opts.front === "en" ? meaningFace(r) : wordFace(r);

  // Chunk into rows of `cols` so layout — and duplex back-page mirroring — is exact.
  const rows = [];
  for (let i = 0; i < items.length; i += opts.cols) rows.push(items.slice(i, i + opts.cols));
  const cell = (inner, r) => `<div class="card">${r ? `<span class="num">${num.get(r)}</span>` : ""}${inner}</div>`;
  const blank = `<div class="card blank"></div>`;
  const rowHtml = (cells) => `<div class="row">${cells.join("")}</div>`;

  const cardH = opts.style === "fold"
    ? [150, 178, 224][big] : opts.style === "reference"
    ? [104, 132, 168][big] : [120, 150, 188][big];
  const wordSize = [15, 19, 23][big];
  const trSize = [12.5, 14.5, 16][big];
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  const hint = opts.style === "fold" ? t("print.foldHint") : opts.style === "duplex" ? t("print.duplexHint") : t("print.refHint");
  const headerHtml = `<header><span class="dot"></span><h1>${esc(heading)}</h1><span class="meta">${esc(t("vocab.count", { n: items.length }))} · ${esc(date)}</span></header><p class="hint">${esc(hint)}</p>`;

  let body;
  if (opts.style === "fold") {
    body = headerHtml + rows.map((row) => rowHtml(row.map((r) =>
      `<div class="card fold"><span class="num">${num.get(r)}</span><div class="half top">${front(r)}</div><div class="fold-line"></div><div class="half bot">${back(r)}</div></div>`))).join("");
  } else if (opts.style === "reference") {
    body = headerHtml + rows.map((row) => rowHtml(row.map((r) =>
      cell(`<div class="ref">${wordFace(r)}<div class="ref-sep"></div>${meaningFace(r)}</div>`, r)))).join("");
  } else {
    // Duplex: paginate, then emit front/back sheet pairs so each printed sheet's
    // back holds the answers for its front (works across many pages, not just one).
    const frontRow = (row) => { const cells = []; for (let c = 0; c < opts.cols; c++) cells.push(row[c] ? cell(front(row[c]), row[c]) : blank); return rowHtml(cells); };
    const backRow = (row) => { const cells = new Array(opts.cols).fill(blank); row.forEach((r, c) => { cells[opts.cols - 1 - c] = cell(back(r), r); }); return rowHtml(cells); };
    const rowsPerPage = Math.max(1, Math.floor(760 / (cardH + 26)));
    const pages = [];
    for (let i = 0; i < rows.length; i += rowsPerPage) pages.push(rows.slice(i, i + rowsPerPage));
    body = pages.map((p) =>
      `<section class="sheet">${headerHtml}${p.map(frontRow).join("")}</section>`
      + `<section class="sheet">${headerHtml}${p.map(backRow).join("")}</section>`).join("");
  }

  const html = `<!doctype html><html><head><meta charset="utf-8" /><title>${esc(heading)}</title><style>
    @page { margin: 11mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: "Hanken Grotesk", -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f1c17; margin: 0; --c: ${color}; }
    header { display: flex; align-items: center; gap: 10px; border-bottom: 2px solid var(--c); padding-bottom: 9px; margin-bottom: 4px; }
    header .dot { width: 13px; height: 13px; border-radius: 50%; background: var(--c); flex: none; }
    header h1 { font-size: 18px; margin: 0; font-weight: 700; flex: 1; }
    header .meta { font-size: 11px; color: #8a8579; }
    .hint { font-size: 10.5px; color: #a8a294; margin: 7px 0 13px; }
    .sheet { break-after: page; }
    .sheet:last-child { break-after: auto; }
    .row { display: grid; grid-template-columns: repeat(${opts.cols}, 1fr); gap: 7mm; break-inside: avoid; margin-bottom: 7mm; }
    .card { position: relative; height: ${cardH}px; padding: 13px 14px; overflow: hidden; display: flex; flex-direction: column; text-align: center;
      border: 1px solid #d7d2c7; border-top: 3px solid var(--c); border-radius: 11px; background: #fff; }
    .card.blank { border: 1px dashed #e7e3da; border-top: 1px dashed #e7e3da; }
    .num { position: absolute; top: 7px; right: 10px; font-size: 9px; color: #c4bfb3; font-variant-numeric: tabular-nums; }
    .fc { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; flex: 1; min-height: 0; }
    .fold .half { flex: 1; display: flex; flex-direction: column; }
    .fold-line { border-top: 1.5px dashed var(--c); opacity: 0.55; margin: 0 -14px; position: relative; }
    .fold-line::after { content: "✂"; position: absolute; left: 4px; top: -8px; font-size: 10px; color: var(--c); opacity: 0.6; }
    .f-word { font-family: "Iowan Old Style", Georgia, "Times New Roman", serif; font-size: ${wordSize}px; font-weight: 700; line-height: 1.12; color: #1a1712; }
    .f-ipa { font-size: 11.5px; color: #9a9384; }
    .f-pos { font-size: 9.5px; letter-spacing: .03em; color: #fff; background: var(--c); border-radius: 999px; padding: 2px 9px; }
    .f-tr { font-size: ${trSize}px; font-weight: 600; line-height: 1.3; color: #2a2620; }
    .f-ex { font-size: 11px; font-style: italic; color: #6a6459; line-height: 1.45; }
    .f-ctx { font-size: 10px; font-style: italic; color: #a39c8e; line-height: 1.4; }
    .f-src { font-size: 9.5px; color: #b8b1a3; margin-top: 1px; }
    .ref { display: flex; flex-direction: column; gap: 6px; flex: 1; justify-content: center; }
    .ref-sep { width: 38%; border-top: 1px solid #ece8df; margin: 1px auto; }
  </style></head><body>
    ${body}
  </body></html>`;

  printDocument(html);
}

/* ---------- Flashcard study mode (SRS) ---------- */
const study = $("#study");
const studyCloseBtn = $("#study-close");
const studyDirBtn = $("#study-dir");
const studyTitleEl = $("#study-title");
const studyLeftEl = $("#study-left");
const studyProgFill = $("#study-prog-fill");
const flashcard = $("#flashcard");
const fcInner = $("#fc-inner");
const fcFront = $("#fc-front");
const fcBack = $("#fc-back");
const studyReveal = $("#study-reveal");
const gradeRow = $("#grade-row");
const studyDone = $("#study-done");
const studyDoneSub = $("#study-done-sub");
const studyRestartBtn = $("#study-restart");

let studyQueue = [], studyPos = 0, studyReviewed = 0, studyFlipped = false;
let studyDir = localStorage.getItem("nyx-study-dir") === "native" ? "native" : "en";
let studySource = [], studyTitleText = "";

function startStudy(items, title) {
  studySource = items.slice();
  studyTitleText = title || t("vocab.title");
  let queue = items.filter(isDue);
  if (!queue.length) queue = items.slice(); // nothing due → free review of the whole deck
  if (!queue.length) { toast(t("study.empty")); return; }
  studyQueue = shuffle(queue);
  studyPos = 0; studyReviewed = 0;
  study.hidden = false;
  studyDone.hidden = true;
  flashcard.hidden = false;
  studyFoot().hidden = false;
  studyTitleEl.textContent = studyTitleText;
  applyStudyDirUI();
  showCard();
}
function studyFoot() { return $("#study-foot"); }
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Fill a stable face container with the word side or the meaning side.
function fillWordFace(el, r) {
  el.replaceChildren();
  el.append(createTextElement("div", r.word, "fc-word"));
  if (r.pronunciation) el.append(createTextElement("div", r.pronunciation, "fc-ipa"));
  if (r.wordClass) el.append(createTextElement("span", r.wordClass, "fc-pos"));
  const speak = document.createElement("button");
  speak.className = "fc-speak";
  speak.setAttribute("aria-label", t("pop.pronounce"));
  speak.innerHTML = `<svg class="ic"><use href="#i-volume" /></svg>`;
  speak.addEventListener("click", (e) => { e.stopPropagation(); speak(r.word); });
  el.append(speak);
}
function fillMeaningFace(el, r) {
  el.replaceChildren();
  el.append(createTextElement("div", r.translation || "—", "fc-tr"));
  if (r.example) el.append(createTextElement("div", r.example, "fc-ex"));
  if (r.context) el.append(createTextElement("div", `“${r.context}”`, "fc-ctx"));
  if (r.source) el.append(createTextElement("div", r.source, "fc-src"));
}

function showCard() {
  const card = studyQueue[studyPos];
  if (!card) { finishStudy(); return; }
  studyFlipped = false;
  // Reset the flip with no animation so the next card starts face-up.
  fcInner.classList.add("no-anim");
  fcInner.classList.remove("flipped");
  void fcInner.offsetWidth; // force reflow so the class change is committed
  fcInner.classList.remove("no-anim");
  (studyDir === "en" ? fillWordFace : fillMeaningFace)(fcFront, card);
  (studyDir === "en" ? fillMeaningFace : fillWordFace)(fcBack, card);
  studyReveal.hidden = false;
  gradeRow.hidden = true;
  studyLeftEl.textContent = t("study.left", { n: studyQueue.length - studyPos });
  studyProgFill.style.width = `${Math.round((studyPos / studyQueue.length) * 100)}%`;
}

function flipCard() {
  if (studyFlipped) return;
  studyFlipped = true;
  fcInner.classList.add("flipped");
  studyReveal.hidden = true;
  gradeRow.hidden = false;
  const card = studyQueue[studyPos];
  $("#ghint-again").textContent = intervalLabel(reviewCard(card.srs, "again").interval);
  $("#ghint-good").textContent = intervalLabel(reviewCard(card.srs, "good").interval);
  $("#ghint-easy").textContent = intervalLabel(reviewCard(card.srs, "easy").interval);
}

async function gradeCard(grade) {
  if (!studyFlipped) return;
  const card = studyQueue[studyPos];
  const wasLearned = isLearned(card);
  const srs = reviewCard(card.srs, grade);
  // Stamp the moment a card first reaches "learned" — drives the stats panel.
  srs.learnedAt = (srs.interval >= 7 && !wasLearned) ? Date.now() : (card.srs && card.srs.learnedAt) || null;
  card.srs = srs;
  await setVocabSrs(card.id, srs);
  if (grade === "again") {
    studyQueue.push(card); // see it again later this session
  } else {
    studyReviewed += 1;
  }
  studyPos += 1;
  showCard();
}

function finishStudy() {
  flashcard.hidden = true;
  studyFoot().hidden = true;
  studyProgFill.style.width = "100%";
  studyLeftEl.textContent = "";
  studyDoneSub.textContent = t("study.doneSub", { n: studyReviewed });
  studyDone.hidden = false;
}
function closeStudy() {
  study.hidden = true;
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
  refreshVocab(); // reflect new due counts / progress rings
}
function applyStudyDirUI() { studyDirBtn.classList.toggle("on", studyDir === "native"); }

flashcard.addEventListener("click", flipCard);
studyReveal.addEventListener("click", flipCard);
gradeRow.addEventListener("click", (e) => { const b = e.target.closest("[data-grade]"); if (b) gradeCard(b.dataset.grade); });
studyCloseBtn.addEventListener("click", closeStudy);
studyRestartBtn.addEventListener("click", () => startStudy(studySource, studyTitleText));
studyDirBtn.addEventListener("click", () => {
  studyDir = studyDir === "en" ? "native" : "en";
  localStorage.setItem("nyx-study-dir", studyDir);
  applyStudyDirUI();
  showCard();
});
document.addEventListener("keydown", (e) => {
  if (study.hidden) return;
  if (e.key === "Escape") { closeStudy(); return; }
  if (!studyDone.hidden) return;
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); flipCard(); return; }
  if (studyFlipped) {
    if (e.key === "1") gradeCard("again");
    else if (e.key === "2") gradeCard("good");
    else if (e.key === "3") gradeCard("easy");
  }
}, true);

/* ---------- Lookup trigger setting ---------- */
function applyTriggerUI() { [...triggerSeg.children].forEach((b) => b.classList.toggle("on", b.dataset.trig === triggerMode)); }
triggerSeg.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  triggerMode = button.dataset.trig;
  localStorage.setItem("nyx-trigger", triggerMode);
  applyTriggerUI();
});

/* ---------- "Always show popover" + two-page (columns) toggles ---------- */
let alwaysPopover = localStorage.getItem("nyx-pop-both") === "on";
const popoverToggle = $("#toggle-popover");
const popoverState = $("#popover-state");
function applyPopoverToggle() { popoverState.textContent = t(alwaysPopover ? "state.on" : "state.off"); popoverToggle.classList.toggle("on", alwaysPopover); }
popoverToggle.addEventListener("click", () => {
  alwaysPopover = !alwaysPopover;
  localStorage.setItem("nyx-pop-both", alwaysPopover ? "on" : "off");
  applyPopoverToggle();
});

let columnsOn = localStorage.getItem("nyx-columns") === "on";
const columnsToggle = $("#toggle-columns");
const columnsState = $("#columns-state");
function applyColumns() {
  document.body.classList.toggle("reflow-columns", columnsOn);
  columnsState.textContent = t(columnsOn ? "state.on" : "state.off");
  columnsToggle.classList.toggle("on", columnsOn);
}
columnsToggle.addEventListener("click", () => {
  columnsOn = !columnsOn;
  localStorage.setItem("nyx-columns", columnsOn ? "on" : "off");
  applyColumns();
});

async function openRecent(record) {
  if (!record.data) {
    toast(t("toast.tooLarge"));
    fileInput.click();
    return;
  }
  const file = new File([record.data], record.name, { type: mimeFor(record.kind), lastModified: record.lastModified });
  await touchRecent(record.id);
  await openFile(file, { fromRecent: true });
}

/* ---------- pdf.js events ---------- */
eventBus.on("pagesinit", () => {
  if (!currentDocument) return;
  pdfViewer.currentScaleValue = "page-width";
  refreshDocSub();
  setTool("select");
  setHighlightColor(DEFAULT_HIGHLIGHT);
  buildTOC();
  updateProgress();
  setTimeout(restoreReadingProgress, 250);
});
eventBus.on("pagechanging", updateProgress);

/* ---------- Zoom (wheel / keys / pinch) ---------- */
const MIN_SCALE = 0.25;
const MAX_SCALE = 6;
function zoomBy(factor) {
  if (!currentDocument) return;
  pdfViewer.currentScale = Math.min(Math.max(pdfViewer.currentScale * factor, MIN_SCALE), MAX_SCALE);
}
// Map-style zoom: scale by `factor` while keeping the point under the cursor
// fixed (so the PDF zooms toward wherever you're pointing).
function zoomAtPointer(event, factor) {
  const oldScale = pdfViewer.currentScale;
  const newScale = Math.min(Math.max(oldScale * factor, MIN_SCALE), MAX_SCALE);
  if (newScale === oldScale) return;
  const rect = container.getBoundingClientRect();
  const offsetX = event.clientX - rect.left;
  const offsetY = event.clientY - rect.top;
  const contentX = container.scrollLeft + offsetX;
  const contentY = container.scrollTop + offsetY;
  const ratio = newScale / oldScale;
  pdfViewer.currentScale = newScale;          // pdf.js updates page dimensions synchronously
  container.scrollLeft = contentX * ratio - offsetX;
  container.scrollTop = contentY * ratio - offsetY;
}
// Reflow "zoom" scales the reading text size instead of the page.
const READ_MIN = 12, READ_MAX = 40;
function currentReadingSize() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--reading-size")) || 19;
}
function setReadingSize(px) {
  const size = Math.round(Math.min(Math.max(px, READ_MIN), READ_MAX));
  document.documentElement.style.setProperty("--reading-size", `${size}px`);
  sizeR.value = String(size);
  sizeVal.textContent = `${size}px`;
  setRangeFill(sizeR);
  localStorage.setItem("nyx-read-size", String(size));
}
// Standard PDF-reader behaviour: plain wheel / two-finger scroll scrolls the
// document; a trackpad pinch or Ctrl/⌘+wheel zooms toward the cursor (browsers
// report a pinch as a ctrl-wheel event). Proportional + clamped for a smooth feel.
container.addEventListener("wheel", (event) => {
  if (!(event.ctrlKey || event.metaKey)) return; // no modifier -> let it scroll
  event.preventDefault();
  if (viewMode === "pdf" && currentDocument) {
    const delta = Math.max(-60, Math.min(60, event.deltaY));
    zoomAtPointer(event, Math.exp(-delta * 0.0022));
  } else if (viewMode === "reflow") {
    setReadingSize(currentReadingSize() + (event.deltaY < 0 ? 1 : -1));
  }
}, { passive: false });

spreadButton.addEventListener("click", () => {
  spreadIndex = (spreadIndex + 1) % spreadCycle.length;
  pdfViewer.spreadMode = spreadCycle[spreadIndex];
  spreadState.textContent = t(SPREAD_KEYS[spreadIndex]);
});

/* ---------- Annotation tools ---------- */
let annotationActive = false;
function setTool(tool) {
  currentTool = tool;
  toolHighlight.classList.toggle("active", tool === "highlight");
  toolNote.classList.toggle("active", tool === "note");
  annotbar.hidden = tool === "select" || viewMode === "none";
  highlightColors.style.display = tool === "highlight" ? "" : "none";
  // redo / delete are pdf-editor actions; hide them while highlighting reflow text
  editRedo.style.display = viewMode === "reflow" ? "none" : "";
  editDelete.style.display = viewMode === "reflow" ? "none" : "";

  annotationActive = tool !== "select";
  // Text selection is needed for highlighting, and for notes on reflow text —
  // but NOT for PDF notes (free-text boxes are click-placed).
  container.classList.toggle("select-mode", tool === "highlight" || (tool === "note" && viewMode === "reflow"));

  if (viewMode === "pdf") {
    const mode =
      tool === "highlight" ? AnnotationEditorType.HIGHLIGHT :
      tool === "note" ? AnnotationEditorType.FREETEXT :
      AnnotationEditorType.NONE;
    try { pdfViewer.annotationEditorMode = { mode }; } catch (error) { console.error(error); }
  }
}

let highlightColor = DEFAULT_HIGHLIGHT;
function setHighlightColor(color) {
  highlightColor = color;
  eventBus.dispatch("switchannotationeditorparams", {
    source: window, type: AnnotationEditorParamsType.HIGHLIGHT_COLOR, value: color,
  });
}
eventBus.on("annotationeditormodechanged", ({ mode }) => {
  if (mode === AnnotationEditorType.HIGHLIGHT) setHighlightColor(highlightColor);
});
eventBus.on("editingstateschanged", ({ details }) => {
  if (details && "isEmpty" in details) {
    document.body.classList.toggle("has-annotations", details.isEmpty === false);
  }
});

toolHighlight.addEventListener("click", () => setTool(currentTool === "highlight" ? "select" : "highlight"));
toolNote.addEventListener("click", () => setTool(currentTool === "note" ? "select" : "note"));
swatches.forEach((swatch) => {
  swatch.addEventListener("click", () => {
    swatches.forEach((other) => other.classList.toggle("on", other === swatch));
    if (currentTool !== "highlight") setTool("highlight");
    setHighlightColor(swatch.dataset.color);
  });
});

function editingAction(name) {
  if (!currentDocument) return;
  eventBus.dispatch("editingaction", { source: window, name });
}
editUndo.addEventListener("click", () => {
  if (viewMode === "reflow") { reflowHighlights.pop(); persistReflowHighlights(); renderReflowHighlights(); }
  else editingAction("undo");
});
editRedo.addEventListener("click", () => editingAction("redo"));
editDelete.addEventListener("click", () => editingAction("delete"));

/* ---------- Reflow highlights (offset-based, persisted) ---------- */
function reflowTextNodes() {
  const walker = document.createTreeWalker(docReader, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  return nodes;
}
// Absolute character offset of a (textNode, offset) within the reader.
function globalOffset(node, offset) {
  let total = 0;
  for (const t of reflowTextNodes()) {
    if (t === node) return total + offset;
    total += t.textContent.length;
  }
  return total;
}
function persistReflowHighlights() {
  if (currentFileId) setHighlights(currentFileId, reflowHighlights);
}
// Rebuild the reader from clean HTML, then wrap every saved highlight range.
function renderReflowHighlights() {
  if (!reflowCleanHTML) return;
  docReader.innerHTML = reflowCleanHTML;
  for (const hl of [...reflowHighlights].sort((a, b) => a.start - b.start)) wrapReflowRange(hl);
  // Rebuilding the DOM detaches any live find ranges — re-run the search to rebind.
  if (findBar.classList.contains("open") && currentQuery && viewMode === "reflow") runReflowFind(currentQuery, "");
}
function wrapReflowRange(hl) {
  const { start, end, color, note } = hl;
  let pos = 0;
  for (const t of reflowTextNodes()) {
    const len = t.textContent.length;
    const nodeStart = pos;
    const nodeEnd = pos + len;
    pos = nodeEnd;
    if (nodeEnd <= start || nodeStart >= end) continue;
    if (t.parentElement?.classList.contains("rf-hl")) continue;
    const from = Math.max(start, nodeStart) - nodeStart;
    const to = Math.min(end, nodeEnd) - nodeStart;
    const range = document.createRange();
    range.setStart(t, from);
    range.setEnd(t, to);
    const span = document.createElement("span");
    span.className = note != null ? "rf-hl rf-note" : "rf-hl";
    span.style.background = color;
    span.dataset.s = String(start);
    span.dataset.e = String(end);
    if (note) span.title = note;
    try { range.surroundContents(span); } catch { /* crosses a boundary — skip this piece */ }
  }
}
function addReflowHighlight(range, withNote = false) {
  const start = globalOffset(range.startContainer, range.startOffset);
  const end = globalOffset(range.endContainer, range.endOffset);
  if (end <= start) return null;
  const item = { start, end, color: highlightColor };
  if (withNote) item.note = "";
  reflowHighlights.push(item);
  persistReflowHighlights();
  renderReflowHighlights();
  return item;
}
function findReflowHighlight(span) {
  const start = Number(span.dataset.s), end = Number(span.dataset.e);
  return reflowHighlights.find((h) => h.start === start && h.end === end) || null;
}
function removeReflowHighlightSpan(span) {
  const start = Number(span.dataset.s);
  const end = Number(span.dataset.e);
  reflowHighlights = reflowHighlights.filter((h) => !(h.start === start && h.end === end));
  persistReflowHighlights();
  renderReflowHighlights();
}
// Selecting text with Highlight or Note adds an annotation; Note opens an editor.
container.addEventListener("mouseup", () => {
  if (viewMode !== "reflow" || (currentTool !== "highlight" && currentTool !== "note")) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!docReader.contains(range.commonAncestorContainer)) return;
  const rect = range.getBoundingClientRect();
  const item = addReflowHighlight(range, currentTool === "note");
  selection.removeAllRanges();
  if (item && currentTool === "note") openNoteEditor(item, rect);
});

/* ---------- Reflow note editor ---------- */
const notePop = $("#note-pop");
const noteText = $("#note-text");
const noteSave = $("#note-save");
const noteDel = $("#note-del");
let editingNote = null;
function openNoteEditor(item, rect) {
  editingNote = item;
  noteText.value = item.note || "";
  placeFloating(notePop, rect, 264);
  notePop.classList.add("show");
  setTimeout(() => noteText.focus(), 40);
}
function closeNoteEditor() { notePop.classList.remove("show"); editingNote = null; }
noteSave.addEventListener("click", () => {
  if (!editingNote) return;
  editingNote.note = noteText.value.trim();
  persistReflowHighlights();
  renderReflowHighlights();
  closeNoteEditor();
});
noteDel.addEventListener("click", () => {
  if (!editingNote) return;
  reflowHighlights = reflowHighlights.filter((h) => h !== editingNote);
  persistReflowHighlights();
  renderReflowHighlights();
  closeNoteEditor();
});

/* ---------- Save annotated copy ---------- */
savePdfButton.addEventListener("click", async () => {
  if (!currentDocument) return;
  try {
    const data = await currentDocument.saveDocument();
    const blob = new Blob([data], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${currentDocName.replace(/\.pdf$/i, "") || "document"} (annotated).pdf`;
    link.click();
    URL.revokeObjectURL(url);
    toast(t("toast.savedCopy"));
  } catch (error) {
    console.error(error);
    toast(t("toast.saveFailed"));
  }
});

/* ---------- Settings (centered modal) ---------- */
function openSheet() { sheet.hidden = false; }
function closeSheet() { sheet.hidden = true; }
function sheetOpen() { return !sheet.hidden; }
gearBtn.addEventListener("click", openSheet);
sheetX.addEventListener("click", closeSheet);
sheet.addEventListener("click", (event) => { if (event.target === sheet) closeSheet(); });

/* ---------- Reading controls ("Aa") — no backdrop, live preview ---------- */
function openAa() { applyReadingMode(); aaPanel.hidden = false; }
function closeAa() { aaPanel.hidden = true; }
function aaOpen() { return !aaPanel.hidden; }
// Show only the controls that apply to the open document (typography vs PDF
// spread). The guide reflows like a text file, so it gets the typography group.
function applyReadingMode() {
  readingGroup.hidden = !(viewMode === "reflow" || guideShown);
  pdfGroup.hidden = viewMode !== "pdf";
}
aaBtn.addEventListener("click", () => (aaOpen() ? closeAa() : openAa()));
aaX.addEventListener("click", closeAa);
// Light dismiss: any click outside the panel or its button closes it.
document.addEventListener("pointerdown", (event) => {
  if (aaOpen() && !event.target.closest("#aa-panel, #aa-btn")) closeAa();
});

/* ---------- Language ---------- */
function applyLangUI() { [...langSeg.children].forEach((b) => b.classList.toggle("on", b.dataset.lang === getLang())); }
langSeg.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button) setLang(button.dataset.lang);
});
// When the language changes, re-render every dynamic string we control.
onLangChange(() => {
  applyLangUI();
  applyPopoverToggle();
  applyColumns();
  applyAnnotations();
  applyTriggerUI();
  spreadState.textContent = t(SPREAD_KEYS[spreadIndex]);
  fullscreenLabel.textContent = t(document.fullscreenElement ? "set.exitFullscreen" : "set.enterFullscreen");
  refreshDocSub();
  if (currentQuery) findCount.textContent = "";
  if (document.body.dataset.view === "vocab") refreshVocab();
  if (document.body.dataset.view === "lib") { renderBuiltin(); if (recentItems.length) renderRecentList(); }
  refreshInstallUI();
});

/* ---------- Install (PWA) ---------- */
const installBtn = $("#install-app");
const installState = $("#install-state");
const installHint = $("#install-hint");
let deferredInstall = null;

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function refreshInstallUI() {
  if (isStandalone()) {
    installState.textContent = t("set.installed");
    installState.hidden = false;
    installBtn.disabled = true;
    installHint.hidden = true;
    return;
  }
  installBtn.disabled = false;
  if (deferredInstall) {
    installState.textContent = t("set.installAvailable");
    installState.hidden = false;
    installHint.hidden = true;
  } else {
    installState.hidden = true;
    installHint.textContent = t(isIos() ? "set.installIos" : "set.installManual");
  }
}
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstall = event;
  refreshInstallUI();
});
window.addEventListener("appinstalled", () => { deferredInstall = null; refreshInstallUI(); });
installBtn.addEventListener("click", async () => {
  if (deferredInstall) {
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    if (outcome === "accepted") deferredInstall = null;
    refreshInstallUI();
  } else {
    installHint.textContent = t(isIos() ? "set.installIos" : "set.installManual");
    installHint.hidden = !installHint.hidden;
  }
});

/* ---------- Properties & shortcuts ---------- */
propertiesButton.addEventListener("click", async () => {
  closeSheet();
  if (viewMode === "none") { toast(t("toast.openFirst")); return; }
  let rows;
  if (viewMode === "pdf" && currentDocument) {
    const { info = {} } = await currentDocument.getMetadata();
    rows = [
      [t("prop.title"), info.Title], [t("prop.author"), info.Author], [t("prop.subject"), info.Subject],
      [t("prop.keywords"), info.Keywords], [t("prop.creator"), info.Creator], [t("prop.producer"), info.Producer],
      [t("prop.pdfVersion"), info.PDFFormatVersion], [t("prop.pages"), String(currentDocument.numPages)],
      [t("prop.fileSize"), formatBytes(currentFileSize)], [t("prop.created"), formatPdfDate(info.CreationDate)],
      [t("prop.modified"), formatPdfDate(info.ModDate)],
    ];
  } else {
    const text = docReader.textContent || "";
    const words = (text.trim().match(/\S+/g) || []).length;
    rows = [
      [t("prop.name"), currentDocName],
      [t("prop.format"), readerLabel(currentKind)],
      [t("prop.fileSize"), formatBytes(currentFileSize)],
      [t("prop.words"), words.toLocaleString()],
      [t("prop.characters"), text.length.toLocaleString()],
    ];
  }
  const fragment = document.createDocumentFragment();
  rows.forEach(([key, value]) => {
    if (!value) return;
    const row = document.createElement("div");
    row.className = "prop-row";
    row.append(createTextElement("span", key, "prop-key"));
    row.append(createTextElement("span", String(value), "prop-val"));
    fragment.append(row);
  });
  openModal(t("set.properties"), fragment);
});

shortcutsButton.addEventListener("click", () => {
  closeSheet();
  const shortcuts = [
    [t("sc.find"), t("sc.findKeys")], [t("sc.focus"), t("sc.focusKeys")], [t("sc.close"), t("sc.closeKeys")],
    [t("sc.lookup"), t("sc.lookupKeys")], [t("sc.zoom"), t("sc.zoomKeys")],
    [t("sc.fit"), t("sc.fitKeys")], [t("sc.paging"), t("sc.pagingKeys")],
  ];
  const fragment = document.createDocumentFragment();
  shortcuts.forEach(([label, keys]) => {
    const row = document.createElement("div");
    row.className = "shortcut-row";
    row.append(createTextElement("span", label));
    row.append(createTextElement("span", keys, "kbd"));
    fragment.append(row);
  });
  openModal(t("set.shortcuts"), fragment);
});

function openModal(title, bodyNode) { modalTitle.textContent = title; modalBody.replaceChildren(bodyNode); modal.hidden = false; }
function closeModal() {
  modal.hidden = true;
  modalBody.replaceChildren();
  // Dismissing the modal cancels an in-flight folder pick.
  if (pendingFolderPick) { const resolve = pendingFolderPick; pendingFolderPick = null; resolve(null); }
}
modalClose.addEventListener("click", closeModal);
modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });

/* ---------- Find in document ---------- */
findButton.addEventListener("click", () => (findBar.classList.contains("open") ? closeFind() : openFind()));
findClose.addEventListener("click", closeFind);
findInput.addEventListener("input", () => runFind(findInput.value, ""));
findInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); runFind(findInput.value, "again", event.shiftKey); }
});
findPrev.addEventListener("click", () => runFind(currentQuery || findInput.value, "again", true));
findNext.addEventListener("click", () => runFind(currentQuery || findInput.value, "again", false));

function openFind() {
  if (viewMode === "none") return;
  findBar.classList.add("open");
  findButton.classList.add("on");
  findInput.focus();
  findInput.select();
}
function closeFind() {
  findBar.classList.remove("open");
  findButton.classList.remove("on");
  currentQuery = "";
  findCount.textContent = "";
  clearReflowFind();
  eventBus.dispatch("find", { source: window, type: "", query: "", caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: false });
}
function runFind(query, type, findPrevious = false) {
  currentQuery = query;
  // Reflow formats (TXT/MD/EPUB/DOCX) have no pdf.js find controller — search the
  // rendered text directly with the CSS Custom Highlight API instead.
  if (viewMode === "reflow") { runReflowFind(query, type, findPrevious); return; }
  if (!query) findCount.textContent = "";
  eventBus.dispatch("find", { source: window, type, query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious });
}
eventBus.on("updatefindcontrolstate", ({ matchesCount }) => renderFindCount(matchesCount));
eventBus.on("updatefindmatchescount", ({ matchesCount }) => renderFindCount(matchesCount));
function renderFindCount(matchesCount) {
  if (!currentQuery) { findCount.textContent = ""; return; }
  if (!matchesCount || !matchesCount.total) { findCount.textContent = t("find.none"); return; }
  findCount.textContent = t("find.count", { current: matchesCount.current, total: matchesCount.total });
}

/* ---------- In-document find for reflow formats (Custom Highlight API) ---------- */
let reflowMatches = [];      // Range[] for every occurrence of the query
let reflowMatchIndex = -1;   // which one is "current"
let findAllHL = null, findCurrentHL = null;
function ensureFindHighlights() {
  if (findAllHL) return;
  findAllHL = new Highlight();
  findCurrentHL = new Highlight();
  CSS.highlights.set("find-all", findAllHL);
  CSS.highlights.set("find-current", findCurrentHL);
}
function buildReflowMatches(query) {
  const matches = [];
  const needle = query.toLowerCase();
  for (const node of reflowTextNodes()) {
    const hay = node.textContent.toLowerCase();
    let from = 0, idx;
    while ((idx = hay.indexOf(needle, from)) !== -1) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + needle.length);
      matches.push(range);
      from = idx + needle.length;
    }
  }
  return matches;
}
function runReflowFind(query, type, findPrevious = false) {
  if (!query) { clearReflowFind(); return; }
  ensureFindHighlights();
  if (type === "again" && reflowMatches.length) {
    const n = reflowMatches.length;
    reflowMatchIndex = findPrevious ? (reflowMatchIndex - 1 + n) % n : (reflowMatchIndex + 1) % n;
  } else {
    reflowMatches = buildReflowMatches(query);
    reflowMatchIndex = reflowMatches.length ? 0 : -1;
  }
  findAllHL.clear();
  findCurrentHL.clear();
  reflowMatches.forEach((range, i) => { if (i !== reflowMatchIndex) findAllHL.add(range); });
  if (reflowMatchIndex >= 0) {
    const current = reflowMatches[reflowMatchIndex];
    findCurrentHL.add(current);
    scrollRangeIntoView(current);
  }
  renderReflowFindCount();
}
function renderReflowFindCount() {
  if (!currentQuery) { findCount.textContent = ""; return; }
  if (!reflowMatches.length) { findCount.textContent = t("find.none"); return; }
  findCount.textContent = t("find.count", { current: reflowMatchIndex + 1, total: reflowMatches.length });
}
function clearReflowFind() {
  reflowMatches = [];
  reflowMatchIndex = -1;
  if (findAllHL) findAllHL.clear();
  if (findCurrentHL) findCurrentHL.clear();
  findCount.textContent = "";
}
function scrollRangeIntoView(range) {
  const rect = range.getBoundingClientRect();
  const view = container.getBoundingClientRect();
  if (rect.top < view.top + 60 || rect.bottom > view.bottom - 60) {
    container.scrollTop += rect.top - view.top - view.height / 3;
  }
}

/* ---------- Contents (TOC) ---------- */
async function buildTOC() {
  tocList.replaceChildren();
  let hasContents = false;
  try {
    if (viewMode === "pdf" && currentDocument) {
      const outline = await currentDocument.getOutline();
      if (outline && outline.length) {
        hasContents = true;
        outline.forEach((item, index) => tocList.append(makeTocRow(index + 1, item.title, () => {
          try { linkService.goToDestination(item.dest); } catch { /* ignore */ }
          closeToc();
        })));
      }
    } else if (viewMode === "reflow") {
      const heads = [...docReader.querySelectorAll("h1, h2, h3")];
      if (heads.length > 1) {
        hasContents = true;
        heads.forEach((h, index) => makeTocAnchor(h, index));
        heads.forEach((h, index) => tocList.append(makeTocRow(index + 1, h.textContent.trim() || `Section ${index + 1}`, () => {
          h.scrollIntoView({ behavior: "smooth", block: "start" });
          closeToc();
        })));
      }
    }
  } catch { /* outline not available */ }
  tocBtn.hidden = !hasContents;
  if (!hasContents) closeToc();
}
function makeTocAnchor(h, index) { if (!h.id) h.id = `nyx-h-${index}`; }
function makeTocRow(num, title, onClick) {
  const row = document.createElement("div");
  row.className = "toc-row";
  row.append(createTextElement("span", String(num), "n"));
  const wrap = document.createElement("div");
  wrap.append(createTextElement("div", title || "Untitled", "t"));
  row.append(wrap);
  row.addEventListener("click", onClick);
  return row;
}
function openToc() { toc.classList.add("open"); }
function closeToc() { toc.classList.remove("open"); }
tocBtn.addEventListener("click", () => (toc.classList.contains("open") ? closeToc() : openToc()));
tocX.addEventListener("click", closeToc);

/* ---------- Footer progress + paging ---------- */
function updateProgress() {
  const max = container.scrollHeight - container.clientHeight;
  const pct = max > 0 ? Math.round((container.scrollTop / max) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  if (viewMode === "pdf" && currentDocument) {
    footPos.textContent = `${pdfViewer.currentPageNumber} / ${currentDocument.numPages}`;
    prevPage.disabled = pdfViewer.currentPageNumber <= 1;
    nextPage.disabled = pdfViewer.currentPageNumber >= currentDocument.numPages;
  } else {
    footPos.textContent = "";
    prevPage.disabled = nextPage.disabled = viewMode === "none";
  }
  footStat.textContent = viewMode === "none" ? "" : `${pct}%`;
  saveReadingProgress();
}
container.addEventListener("scroll", updateProgress);
prevPage.addEventListener("click", () => {
  if (viewMode === "pdf" && currentDocument) { if (pdfViewer.currentPageNumber > 1) pdfViewer.currentPageNumber -= 1; }
  else container.scrollBy({ top: -container.clientHeight * 0.9, behavior: "smooth" });
});
nextPage.addEventListener("click", () => {
  if (viewMode === "pdf" && currentDocument) { if (pdfViewer.currentPageNumber < currentDocument.numPages) pdfViewer.currentPageNumber += 1; }
  else container.scrollBy({ top: container.clientHeight * 0.9, behavior: "smooth" });
});

/* ---------- Dictionary lookup ---------- */
let lookupHighlight = null;
function setLookupRange(range) {
  if (typeof Highlight === "undefined" || !CSS.highlights) return;
  if (!lookupHighlight) { lookupHighlight = new Highlight(); CSS.highlights.set("lookup-word", lookupHighlight); }
  lookupHighlight.clear();
  if (range) lookupHighlight.add(range);
}

function extractLookupWord(text) {
  const cleaned = text.replaceAll("’", "'").trim();
  const match = cleaned.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/);
  return match ? match[0].toLowerCase() : "";
}

// The sentence a looked-up word appeared in — saved with the word in vocab.
function sentenceAround(node, offset) {
  if (!node || node.nodeType !== 3) return "";
  const text = node.textContent || "";
  let s = offset, e = offset;
  while (s > 0 && !/[.!?]/.test(text[s - 1])) s--;
  while (e < text.length && !/[.!?]/.test(text[e])) e++;
  return text.slice(s, e + 1).trim();
}

// Single click: remove a reflow highlight (highlight mode), or look up the word
// under the pointer when the lookup trigger is "single".
container.addEventListener("click", async (event) => {
  if (viewMode === "reflow" && currentTool === "highlight") {
    const span = event.target.closest(".rf-hl");
    const selection = window.getSelection();
    if (span && (!selection || selection.isCollapsed)) removeReflowHighlightSpan(span);
    return;
  }
  // In read mode, clicking a noted highlight opens its note.
  if (viewMode === "reflow" && currentTool === "select") {
    const noteSpan = event.target.closest(".rf-hl.rf-note");
    if (noteSpan) { const item = findReflowHighlight(noteSpan); if (item) { openNoteEditor(item, noteSpan.getBoundingClientRect()); return; } }
  }
  if (triggerMode !== "single" || event.detail > 1 || annotationActive) return;
  if (!event.target.closest(".textLayer, .doc-reader")) return;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.toString().trim().split(/\s+/).length > 1) return;
  const hit = wordAtPoint(event.clientX, event.clientY);
  if (!hit) return;
  setLookupRange(hit.range);
  await lookup(hit.word, hit.range.getBoundingClientRect(), sentenceAround(hit.range.startContainer, hit.range.startOffset));
});

// Double click: look up when the trigger is "double".
container.addEventListener("dblclick", async (event) => {
  if (triggerMode !== "double" || annotationActive) return;
  if (!event.target.closest(".textLayer, .doc-reader")) return;
  const selection = window.getSelection();
  const word = extractLookupWord(selection?.toString() ?? "");
  if (!word) return;
  let rect = null, context = "";
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0);
    setLookupRange(range.cloneRange());
    rect = range.getBoundingClientRect();
    context = sentenceAround(range.startContainer, range.startOffset);
  }
  await lookup(word, rect, context);
});

/* Dictionary panel toggle */
function openDict() { dict.classList.add("open"); }
function closeDict() { dict.classList.remove("open"); }
dictButton.addEventListener("click", () => (dict.classList.contains("open") ? closeDict() : (openDict(), setTimeout(() => searchInput.focus(), 60))));
dictX.addEventListener("click", closeDict);

/* Search box (inside the dictionary drawer) */
let suggestTimer = null;
searchInput.addEventListener("input", () => {
  const prefix = searchInput.value.trim().toLowerCase();
  clearTimeout(suggestTimer);
  if (!prefix) { hideSuggestions(); return; }
  suggestTimer = setTimeout(async () => {
    try {
      const words = await suggestWords(prefix);
      if (searchInput.value.trim().toLowerCase() !== prefix) return;
      renderSuggestions(words);
    } catch { hideSuggestions(); }
  }, 200);
});
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); hideSuggestions(); setLookupRange(null); lookup(searchInput.value); }
  else if (event.key === "Escape") { hideSuggestions(); }
});
searchInput.addEventListener("blur", () => setTimeout(hideSuggestions, 150));

function renderSuggestions(words) {
  suggestionsBox.replaceChildren();
  if (words.length === 0) { hideSuggestions(); return; }
  words.forEach((word) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "suggestion-item";
    item.textContent = word;
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      searchInput.value = word;
      hideSuggestions();
      setLookupRange(null);
      lookup(word);
    });
    suggestionsBox.append(item);
  });
  suggestionsBox.hidden = false;
}
function hideSuggestions() { suggestionsBox.hidden = true; suggestionsBox.replaceChildren(); }

async function lookup(rawWord, anchorRect = null, context = "") {
  const word = (rawWord || "").trim();
  if (!word) return;
  searchInput.value = word;
  hideSuggestions();
  currentLookup = { word: word.toLowerCase(), context, rows: null };
  // When the full panel is already open, just update it (no duplicate popover) —
  // unless the user has turned on "Always show popover".
  const drawerOpen = dict.classList.contains("open");
  const usePopover = !!anchorRect && (alwaysPopover || !drawerOpen);
  showDictionaryLoading();
  if (usePopover) showPopoverLoading(word, anchorRect);
  else if (!drawerOpen) openDict();
  try {
    const rows = await fetchWord(word);
    currentLookup.rows = rows;
    renderDictionaryResult(word.toLowerCase(), rows);
    if (usePopover) fillPopover(word, rows, anchorRect);
    reflectSaveState();
  } catch (error) {
    console.error(error);
    showDictionaryMessage(t("dict.error"), "error");
    if (usePopover) { popGloss.textContent = t("dict.error"); popMore.hidden = true; }
  }
}

/* ---------- Saving words (vocabulary) ----------
   Each *sense* (translation) is its own saveable card, so one headword can be
   saved several times. Cards land in a folder chosen per book. */
function buildSenseRecord(group, sense) {
  const translation = (sense?.translations || []).join(", ");
  return {
    id: vocabId(currentLookup.word, group?.word_class, translation),
    word: currentLookup.word,
    translation,
    pronunciation: group?.pronunciation || "",
    wordClass: group?.word_class || "",
    example: sense?.examples?.[0] || "",
    context: currentLookup.context || "",
    source: currentDocName || "",
    addedAt: Date.now(),
  };
}

/* ---------- Folders: which folder this book's words go into ---------- */
let currentFolderId = null;
function bookFolderKey() { return `nyx-book-folder::${currentFileId || "_"}`; }

// Resolve the folder for the current book — using the remembered choice if it
// still exists, otherwise prompting. `force` always re-prompts (the "change"
// affordance). Returns the folder, or null if the user cancelled.
async function ensureFolder({ force = false } = {}) {
  const key = bookFolderKey();
  const id = force ? null : (localStorage.getItem(key) || currentFolderId);
  if (id) {
    const existing = await getFolder(id);
    if (existing) { currentFolderId = existing.id; return existing; }
  }
  const folder = await pickFolder();
  if (!folder) return null;
  localStorage.setItem(key, folder.id);
  currentFolderId = folder.id;
  return folder;
}

// Folder picker built inside the shared modal; resolves with the chosen/created
// folder, or null if dismissed.
let pendingFolderPick = null;
function pickFolder() {
  return new Promise(async (resolve) => {
    const folders = await listFolders();
    const wrap = document.createElement("div");
    wrap.className = "folder-pick";
    wrap.append(createTextElement("p", t("folder.subtitle"), "folder-sub"));

    if (folders.length) {
      const list = document.createElement("div");
      list.className = "folder-list";
      folders.forEach((f) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "folder-opt";
        b.innerHTML = `<svg class="ic"><use href="#i-cards" /></svg>`;
        b.append(createTextElement("span", f.name, "folder-opt-name"));
        b.addEventListener("click", () => finishFolderPick(f));
        list.append(b);
      });
      wrap.append(list);
    }

    const create = document.createElement("div");
    create.className = "folder-create";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = t("folder.placeholder");
    input.maxLength = 60;
    const add = document.createElement("button");
    add.type = "button";
    add.className = "pbtn primary";
    add.textContent = t("folder.create");
    const submit = async () => {
      const name = input.value.trim();
      if (!name) { toast(t("toast.folderNeedsName")); input.focus(); return; }
      const folder = await saveFolder({ name, color: nextDeckColor(folders) });
      finishFolderPick(folder);
    };
    add.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    create.append(input, add);
    wrap.append(create);

    pendingFolderPick = resolve;
    openModal(t("folder.title"), wrap);
    setTimeout(() => input.focus(), 60);
  });
}
function finishFolderPick(folder) {
  const resolve = pendingFolderPick;
  pendingFolderPick = null;
  closeModal();
  if (resolve) resolve(folder || null);
}

async function saveSense(record) {
  if (!record || !currentLookup) return;
  if (await hasVocab(record.id)) {
    await removeVocab(record.id);
    toast(t("toast.removedWord", { word: record.word }));
  } else {
    const folder = await ensureFolder();
    if (!folder) return; // cancelled the folder picker
    await saveVocab({ ...record, folderId: folder.id });
    toast(t("toast.savedTo", { word: record.word, folder: folder.name }));
    updateFolderChip();
  }
  reflectSaveState();
}

// Popover quick-save targets the first sense of the first part of speech.
async function toggleSaveCurrent() {
  const group = currentLookup?.rows?.[0];
  const sense = group?.senses?.[0];
  if (!sense) return;
  await saveSense(buildSenseRecord(group, sense));
}

async function reflectSaveState() {
  // Popover bookmark mirrors the first sense.
  const group = currentLookup?.rows?.[0];
  const sense = group?.senses?.[0];
  if (sense) {
    const saved = await hasVocab(buildSenseRecord(group, sense).id);
    popSave.classList.toggle("on", saved);
    popSave.querySelector("use").setAttribute("href", saved ? "#i-check" : "#i-bookmark");
  }
  // Each per-sense button reflects its own saved state.
  const buttons = [...dictionaryContent.querySelectorAll(".sense-save")];
  await Promise.all(buttons.map(async (b) => {
    const saved = await hasVocab(b.dataset.id);
    b.classList.toggle("on", saved);
    b.querySelector("use").setAttribute("href", saved ? "#i-check" : "#i-bookmark");
  }));
}

// "Saving to: <folder>" chip in the dictionary header — shows the target and
// lets the reader switch it for this book.
async function updateFolderChip() {
  const chip = document.querySelector("#dict-folder");
  if (!chip) return;
  const id = localStorage.getItem(bookFolderKey()) || currentFolderId;
  const folder = id ? await getFolder(id) : null;
  const label = chip.querySelector(".dict-folder-name");
  label.textContent = folder ? folder.name : t("folder.default");
}
popSave.addEventListener("click", toggleSaveCurrent);

/* ---------- Word popover ---------- */
function placeFloating(el, rect, width = 256) {
  const main = document.querySelector(".main").getBoundingClientRect();
  let left = rect.left - main.left + rect.width / 2 - width / 2;
  left = Math.max(12, Math.min(left, main.width - width - 12));
  let top = rect.bottom - main.top + 8;
  if (top > main.height - 180) top = Math.max(12, rect.top - main.top - 170);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
function placePopover(rect) { placeFloating(pop, rect, 256); }
function showPopoverLoading(word, rect) {
  popWord.textContent = word;
  popPh.textContent = "";
  popGloss.textContent = t("dict.searching");
  popMore.hidden = true;
  placePopover(rect);
  pop.classList.add("show");
}
function fillPopover(word, rows, rect) {
  const first = rows && rows[0];
  popWord.textContent = word;
  popPh.textContent = first?.pronunciation || (first?.word_class ? `· ${first.word_class}` : "");
  const sense = first?.senses?.[0];
  popGloss.textContent = sense ? sense.translations.join(", ") : t("dict.notFound");
  popMore.hidden = !rows || rows.length === 0;
  placePopover(rect);
  pop.classList.add("show");
}
function hidePopover() { pop.classList.remove("show"); }
popMore.addEventListener("click", () => { openDict(); hidePopover(); });
popClose.addEventListener("click", hidePopover);
popAudio.addEventListener("click", () => speak(popWord.textContent));
container.addEventListener("scroll", () => { hidePopover(); closeNoteEditor(); });
document.addEventListener("click", (event) => {
  if (!event.target.closest("#pop, .w, .textLayer, .doc-reader")) hidePopover();
  if (!event.target.closest("#note-pop, .rf-note")) closeNoteEditor();
});

/* ---------- Dictionary rendering (rich API result) ---------- */
function renderDictionaryResult(word, groups) {
  dictionaryContent.replaceChildren();
  if (!groups || groups.length === 0) { showDictionaryMessage(t("dict.notFound")); return; }

  const head = document.createElement("div");
  head.className = "result-head";
  head.append(createTextElement("h2", word, "result-word"));
  const pron = createTextElement("div", "", "result-pron");
  const forms = createTextElement("div", "", "word-forms");
  head.append(pron, forms);
  dictionaryContent.append(head);

  const actions = document.createElement("div");
  actions.className = "dict-actions";
  const folderChip = document.createElement("button");
  folderChip.type = "button";
  folderChip.id = "dict-folder";
  folderChip.className = "dict-chip";
  folderChip.title = t("folder.change");
  folderChip.innerHTML = `<svg class="ic"><use href="#i-cards" /></svg><span class="dict-folder-lbl">${t("folder.savingTo")}</span> <span class="dict-folder-name"></span> <svg class="ic chev"><use href="#i-down" /></svg>`;
  folderChip.addEventListener("click", async () => { const f = await ensureFolder({ force: true }); if (f) updateFolderChip(); });
  const listenChip = document.createElement("button");
  listenChip.type = "button";
  listenChip.className = "dict-chip";
  listenChip.innerHTML = `<svg class="ic"><use href="#i-volume" /></svg><span>${t("dict.listen")}</span>`;
  listenChip.addEventListener("click", () => speak(word));
  actions.append(folderChip, listenChip);
  dictionaryContent.append(actions);
  updateFolderChip();

  const tabs = document.createElement("div");
  tabs.className = "pos-tabs";
  dictionaryContent.append(tabs);

  const body = document.createElement("div");
  body.className = "senses";
  dictionaryContent.append(body);

  function selectGroup(group) {
    [...tabs.children].forEach((tab) => tab.classList.toggle("active", tab.dataset.cls === group.word_class));
    pron.textContent = group.pronunciation || "";
    pron.hidden = !group.pronunciation;
    forms.textContent = group.forms || "";
    forms.hidden = !group.forms;
    body.replaceChildren();
    group.senses.forEach((sense, index) => body.append(buildSense(group, sense, index + 1)));
    if (group.phrases.length) body.append(buildPhrases(group.phrases));
    reflectSaveState();
  }

  groups.forEach((group) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "pos-tab";
    tab.dataset.cls = group.word_class;
    tab.textContent = capitalize(group.word_class);
    tab.addEventListener("click", () => selectGroup(group));
    tabs.append(tab);
  });
  if (groups.length <= 1) tabs.hidden = true;
  selectGroup(groups[0]);
}

function buildSense(group, sense, number) {
  const section = document.createElement("section");
  section.className = "sense";
  const headRow = document.createElement("div");
  headRow.className = "sense-head";
  headRow.append(createTextElement("span", `${number}.`, "sense-num"));
  headRow.append(createTextElement("span", sense.translations.join(", "), "sense-translation"));
  // Each translation gets its own bookmark — save this exact sense as a card.
  const save = document.createElement("button");
  save.type = "button";
  save.className = "sense-save";
  save.dataset.id = buildSenseRecord(group, sense).id;
  save.title = t("pop.saveWord");
  save.setAttribute("aria-label", t("pop.saveWord"));
  save.innerHTML = `<svg class="ic"><use href="#i-bookmark" /></svg>`;
  save.addEventListener("click", () => saveSense(buildSenseRecord(group, sense)));
  headRow.append(save);
  section.append(headRow);
  if (sense.note) section.append(createTextElement("div", sense.note, "sense-note"));

  if (sense.examples.length > 0) {
    section.append(createTextElement("div", "Examples", "examples-label"));
    const VISIBLE = 2;
    sense.examples.forEach((example, index) => {
      const el = createTextElement("p", example, "example");
      if (index >= VISIBLE) el.hidden = true;
      section.append(el);
    });
    if (sense.examples.length > VISIBLE) {
      const hiddenCount = sense.examples.length - VISIBLE;
      const moreButton = document.createElement("button");
      moreButton.type = "button";
      moreButton.className = "more-examples";
      moreButton.textContent = `More examples (${hiddenCount})`;
      moreButton.addEventListener("click", () => {
        const collapsed = section.querySelector(".example[hidden]");
        if (collapsed) {
          section.querySelectorAll(".example").forEach((el) => (el.hidden = false));
          moreButton.textContent = "Show fewer examples";
        } else {
          section.querySelectorAll(".example").forEach((el, index) => (el.hidden = index >= VISIBLE));
          moreButton.textContent = `More examples (${hiddenCount})`;
        }
      });
      section.append(moreButton);
    }
  }

  if (sense.synonyms.length > 0) {
    const syn = document.createElement("div");
    syn.className = "sense-syn";
    syn.append(createTextElement("span", "Synonyms", "syn-label"));
    syn.append(createTextElement("span", sense.synonyms.join(", "), "syn-list"));
    section.append(syn);
  }
  return section;
}

function buildPhrases(phrases) {
  const wrap = document.createElement("section");
  wrap.className = "phrases";
  const list = document.createElement("div");
  list.className = "phrase-list";
  list.hidden = true;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "phrases-toggle";
  toggle.textContent = `Phrases (${phrases.length})`;
  toggle.addEventListener("click", () => { list.hidden = !list.hidden; toggle.classList.toggle("open", !list.hidden); });
  phrases.forEach((phrase) => {
    const item = document.createElement("div");
    item.className = "phrase";
    item.append(createTextElement("span", phrase.term, "phrase-term"));
    if (phrase.translation) item.append(createTextElement("span", phrase.translation, "phrase-tr"));
    if (phrase.example) item.append(createTextElement("p", phrase.example, "phrase-ex"));
    list.append(item);
  });
  wrap.append(toggle, list);
  return wrap;
}

function showDictionaryMessage(message, kind = "normal") {
  dictionaryContent.replaceChildren();
  dictionaryContent.append(createTextElement("div", message, `dictionary-message ${kind}`));
}
function showDictionaryLoading() {
  dictionaryContent.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "dictionary-loading";
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  wrap.append(spinner, createTextElement("span", t("dict.searching")));
  dictionaryContent.append(wrap);
}

function createTextElement(tagName, text, className = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}
function capitalize(text) { return text ? text.charAt(0).toUpperCase() + text.slice(1) : text; }

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(unit > 0 && value < 10 ? 1 : 0)} ${units[unit]}`;
}
function formatPdfDate(value) {
  if (!value) return "";
  const match = String(value).match(/^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!match) return String(value);
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00"] = match;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/* ---------- Theme (paper / sepia / night) ---------- */
const THEMES = ["paper", "white", "night"];
function startTheme() {
  const saved = localStorage.getItem("nyx-theme");
  let theme = THEMES.includes(saved) ? saved
    : saved === "sepia" ? "white"   // the old sepia theme is now "white"
    : saved === "dark" ? "night"
    : saved === "light" ? "paper"
    : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "paper");
  setTheme(theme);
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("nyx-theme", theme);
  // Keep every theme segment (Settings + the Aa panel) in sync.
  themeSegs.forEach((seg) => [...seg.children].forEach((b) => b.classList.toggle("on", b.dataset.theme === theme)));
}
themeSegs.forEach((seg) => seg.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button) setTheme(button.dataset.theme);
}));

/* ---------- Reading typography (text formats) ---------- */
// Paint the accent-filled portion of a slider (the WebKit track has no native
// progress fill — Firefox uses ::-moz-range-progress automatically).
function setRangeFill(el) {
  const min = +el.min, max = +el.max;
  const pct = max > min ? ((+el.value - min) / (max - min)) * 100 : 0;
  el.style.setProperty("--fill", `${pct}%`);
}
function startTypography() {
  const root = document.documentElement.style;
  const font = localStorage.getItem("nyx-read-font");
  const size = localStorage.getItem("nyx-read-size");
  const lead = localStorage.getItem("nyx-read-lead");
  const meas = localStorage.getItem("nyx-read-meas");
  if (font) { root.setProperty("--reading-font", font); fontSel.value = font; }
  if (size) { root.setProperty("--reading-size", `${size}px`); sizeR.value = size; sizeVal.textContent = `${size}px`; }
  if (lead) { root.setProperty("--reading-leading", lead); leadR.value = lead; leadVal.textContent = lead; }
  if (meas) { root.setProperty("--reading-measure", `${meas}rem`); measR.value = meas; measVal.textContent = `${meas}rem`; }
  [sizeR, leadR, measR].forEach(setRangeFill);
}
fontSel.addEventListener("change", function () {
  document.documentElement.style.setProperty("--reading-font", this.value);
  localStorage.setItem("nyx-read-font", this.value);
});
sizeR.addEventListener("input", function () {
  document.documentElement.style.setProperty("--reading-size", `${this.value}px`);
  sizeVal.textContent = `${this.value}px`; localStorage.setItem("nyx-read-size", this.value); setRangeFill(this); updateProgress();
});
leadR.addEventListener("input", function () {
  const v = (+this.value).toFixed(2);
  document.documentElement.style.setProperty("--reading-leading", v);
  leadVal.textContent = v; localStorage.setItem("nyx-read-lead", v); setRangeFill(this); updateProgress();
});
measR.addEventListener("input", function () {
  document.documentElement.style.setProperty("--reading-measure", `${this.value}rem`);
  measVal.textContent = `${this.value}rem`; localStorage.setItem("nyx-read-meas", this.value); setRangeFill(this); updateProgress();
});

/* ---------- Annotation tools on/off ---------- */
let annotationsEnabled = localStorage.getItem("nyx-annotations") !== "off";
function applyAnnotations() {
  annotState.textContent = t(annotationsEnabled ? "state.on" : "state.off");
  annotationsToggle.classList.toggle("on", annotationsEnabled);
  if (viewMode === "pdf") annotationTools.hidden = !annotationsEnabled;
  if (!annotationsEnabled) setTool("select");
}
annotationsToggle.addEventListener("click", () => {
  annotationsEnabled = !annotationsEnabled;
  localStorage.setItem("nyx-annotations", annotationsEnabled ? "on" : "off");
  applyAnnotations();
});

/* ---------- Focus / fullscreen menu + rail (mobile) ---------- */
function openFocusMenu() { focusMenu.hidden = false; focusBtn.classList.add("on"); }
function closeFocusMenu() { focusMenu.hidden = true; focusBtn.classList.remove("on"); }
function focusMenuOpen() { return !focusMenu.hidden; }
focusBtn.addEventListener("click", () => (focusMenuOpen() ? closeFocusMenu() : openFocusMenu()));
menuFocus.addEventListener("click", () => { closeFocusMenu(); toggleFocus(); });
menuFullscreen.addEventListener("click", () => { closeFocusMenu(); toggleFullscreen(); });
document.addEventListener("pointerdown", (event) => {
  if (focusMenuOpen() && !event.target.closest("#focus-menu, #focus-btn")) closeFocusMenu();
});

focusExit.addEventListener("click", toggleFocus);
function toggleFocus() {
  app.classList.toggle("focus");
  hidePopover();
}
function openRail() { app.classList.add("rail-open"); scrim.classList.add("open"); }
function closeRail() { app.classList.remove("rail-open"); scrim.classList.remove("open"); }
railToggle.addEventListener("click", () => (app.classList.contains("rail-open") ? closeRail() : openRail()));
scrim.addEventListener("click", closeRail);

/* ---------- Fullscreen ---------- */
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch((error) => console.error(error));
}
document.addEventListener("fullscreenchange", () => {
  fullscreenLabel.textContent = t(document.fullscreenElement ? "set.exitFullscreen" : "set.enterFullscreen");
});

/* ---------- Speech + toast ---------- */
function speak(text) {
  try {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-GB"; utter.rate = 0.92;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  } catch { toast(t("toast.audioUnavailable")); }
}
let toastTimer = null;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
}

/* ---------- Global keys ---------- */
document.addEventListener("keydown", (event) => {
  const typing = event.target.tagName === "INPUT" || event.target.tagName === "SELECT" || event.target.isContentEditable;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && viewMode !== "none") { event.preventDefault(); openFind(); return; }
  if ((event.ctrlKey || event.metaKey) && currentDocument) {
    if (event.key === "=" || event.key === "+") { event.preventDefault(); zoomBy(1.1); return; }
    if (event.key === "-") { event.preventDefault(); zoomBy(1 / 1.1); return; }
    if (event.key === "0") { event.preventDefault(); pdfViewer.currentScaleValue = "page-width"; return; }
  }
  if (typing) {
    if (event.key === "Escape") event.target.blur();
    return;
  }
  if (event.key === "Escape") {
    if (!modal.hidden) { closeModal(); return; }
    if (focusMenuOpen()) { closeFocusMenu(); return; }
    if (pop.classList.contains("show")) { hidePopover(); return; }
    if (findBar.classList.contains("open")) { closeFind(); return; }
    if (sheetOpen()) { closeSheet(); return; }
    if (aaOpen()) { closeAa(); return; }
    if (dict.classList.contains("open")) { closeDict(); return; }
    if (toc.classList.contains("open")) { closeToc(); return; }
    if (app.classList.contains("rail-open")) { closeRail(); return; }
    if (app.classList.contains("focus")) { toggleFocus(); return; }
  }
  if (event.key === "f") { toggleFocus(); return; }
  if (event.key === "ArrowRight" && !container.hidden) { nextPage.click(); }
  if (event.key === "ArrowLeft" && !container.hidden) { prevPage.click(); }
});

/* ---------- Touch: tap a word to define; tap empty space toggles focus ---------- */
function wordAtPoint(x, y) {
  let range = null;
  if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
  else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); }
  }
  const node = range && range.startContainer;
  if (!node || node.nodeType !== 3 || !node.parentElement?.closest(".textLayer, .doc-reader")) return null;
  const text = node.textContent || "";
  const isWordChar = (ch) => ch && /[A-Za-z'’-]/.test(ch);
  let start = range.startOffset, end = range.startOffset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  const word = extractLookupWord(text.slice(start, end));
  if (!word) return null;
  const wordRange = document.createRange();
  wordRange.setStart(node, start);
  wordRange.setEnd(node, end);
  return { word, range: wordRange };
}

let tapStart = null;
container.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch") return;
  tapStart = { x: event.clientX, y: event.clientY, time: Date.now() };
}, { passive: true });
let lastTap = 0, lastTapXY = null;
container.addEventListener("pointerup", (event) => {
  if (event.pointerType !== "touch" || !tapStart) return;
  const movedX = Math.abs(event.clientX - tapStart.x);
  const movedY = Math.abs(event.clientY - tapStart.y);
  const elapsed = Date.now() - tapStart.time;
  const x = event.clientX, y = event.clientY;
  tapStart = null;
  if (movedX > 10 || movedY > 10 || elapsed > 500) return;
  if (annotationActive) return;

  const define = () => {
    const hit = wordAtPoint(x, y);
    if (!hit) return false;
    setLookupRange(hit.range);
    lookup(hit.word, hit.range.getBoundingClientRect(), sentenceAround(hit.range.startContainer, hit.range.startOffset));
    return true;
  };

  if (triggerMode === "double") {
    const now = Date.now();
    if (now - lastTap < 350 && lastTapXY && Math.hypot(x - lastTapXY.x, y - lastTapXY.y) < 28) {
      lastTap = 0;
      if (!define() && pop.classList.contains("show")) hidePopover();
    } else { lastTap = now; lastTapXY = { x, y }; }
    return;
  }
  if (define()) return;
  if (pop.classList.contains("show")) hidePopover();
  else if (isMobile()) toggleFocus();
}, { passive: true });

/* ---------- Touch: pinch to zoom the PDF ---------- */
function touchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}
let pinch = null, pendingScale = null, pendingSize = null, scaleRaf = null;
function applyPending() {
  scaleRaf = null;
  if (pendingScale != null) { pdfViewer.currentScale = pendingScale; pendingScale = null; }
  if (pendingSize != null) { setReadingSize(pendingSize); pendingSize = null; }
}
container.addEventListener("touchstart", (event) => {
  if (event.touches.length !== 2) return;
  if (viewMode === "pdf" && currentDocument) {
    pinch = { mode: "pdf", startDistance: touchDistance(event.touches), startScale: pdfViewer.currentScale };
  } else if (viewMode === "reflow") {
    pinch = { mode: "reflow", startDistance: touchDistance(event.touches), startSize: currentReadingSize() };
  }
}, { passive: false });
container.addEventListener("touchmove", (event) => {
  if (!pinch || event.touches.length !== 2) return;
  event.preventDefault();
  const ratio = touchDistance(event.touches) / pinch.startDistance;
  if (pinch.mode === "pdf") pendingScale = Math.min(Math.max(pinch.startScale * ratio, 0.25), 6);
  else pendingSize = pinch.startSize * ratio;
  if (!scaleRaf) scaleRaf = requestAnimationFrame(applyPending);
}, { passive: false });
container.addEventListener("touchend", (event) => { if (event.touches.length < 2) pinch = null; }, { passive: true });

mobileMedia.addEventListener("change", () => { if (!isMobile()) closeRail(); });

/* ---------- Init ---------- */
document.documentElement.lang = getLang();
applyI18n(document);
applyLangUI();
startTheme();
startTypography();
applyTriggerUI();
applyPopoverToggle();
applyColumns();
applyAnnotations();
refreshInstallUI();
renderBuiltin();
refreshRecent();
showGuide();
showView("lib");
updateProgress();
