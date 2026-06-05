import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
  PDFFindController,
  ScrollMode,
  SpreadMode,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./style.css";
import { fetchWord, suggestWords } from "./dictionary.js";
import { saveRecent, listRecent, touchRecent, removeRecent } from "./recent.js";
import { readText, readDocx, readEpub } from "./readers/reflow.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const { AnnotationEditorType, AnnotationEditorParamsType } = pdfjsLib;

/* ---------- Elements ---------- */
const fileInput = document.querySelector("#file-input");
const container = document.querySelector("#viewer-container");
const viewer = document.querySelector("#viewer");
const docReader = document.querySelector("#doc-reader");
const welcome = document.querySelector("#welcome");
const recentFiles = document.querySelector("#recent-files");
const recentList = document.querySelector("#recent-list");
const docTitle = document.querySelector("#doc-title");
const menuStatus = document.querySelector("#menu-status");
const zoomLabel = document.querySelector("#zoom-label");
const zoomInButton = document.querySelector("#zoom-in");
const zoomOutButton = document.querySelector("#zoom-out");
const fitWidthButton = document.querySelector("#fit-width");
const themeToggleButton = document.querySelector("#theme-toggle");
const themeIcon = document.querySelector("#theme-icon");
const themeLabel = document.querySelector("#theme-label");
const menuButton = document.querySelector("#menu-button");
const menu = document.querySelector("#menu");
const dictionaryContent = document.querySelector("#dictionary-content");
const searchInput = document.querySelector("#search-input");
const suggestionsBox = document.querySelector("#suggestions");
const dictionaryPanel = document.querySelector(".dictionary-panel");
const dictResizer = document.querySelector("#dict-resizer");
const sheetGrabber = document.querySelector("#sheet-grabber");
const scrim = document.querySelector("#scrim");
const dictButton = document.querySelector("#dict-button");
const toolsToggle = document.querySelector("#tools-toggle");
const annotationsToggle = document.querySelector("#toggle-annotations");

const annotationTools = document.querySelector("#annotation-tools");
const toolSelect = document.querySelector("#tool-select");
const toolHighlight = document.querySelector("#tool-highlight");
const toolNote = document.querySelector("#tool-note");
const highlightColors = document.querySelector("#highlight-colors");
const swatches = [...document.querySelectorAll(".swatch")];

const continuousButton = document.querySelector("#toggle-continuous");
const spreadButton = document.querySelector("#cycle-spread");
const spreadState = document.querySelector("#spread-state");
const rotateLeftButton = document.querySelector("#rotate-left");
const rotateRightButton = document.querySelector("#rotate-right");
const fullscreenButton = document.querySelector("#fullscreen");
const fullscreenLabel = document.querySelector("#fullscreen-label");
const savePdfButton = document.querySelector("#save-pdf");
const propertiesButton = document.querySelector("#properties");
const shortcutsButton = document.querySelector("#shortcuts");

const editUndo = document.querySelector("#edit-undo");
const editRedo = document.querySelector("#edit-redo");
const editDelete = document.querySelector("#edit-delete");
const sheetClose = document.querySelector("#sheet-close");

const findButton = document.querySelector("#find-button");
const findBar = document.querySelector("#find-bar");
const findInput = document.querySelector("#find-input");
const findCount = document.querySelector("#find-count");
const findPrev = document.querySelector("#find-prev");
const findNext = document.querySelector("#find-next");
const findClose = document.querySelector("#find-close");

const modal = document.querySelector("#modal");
const modalTitle = document.querySelector("#modal-title");
const modalBody = document.querySelector("#modal-body");
const modalClose = document.querySelector("#modal-close");

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
});
linkService.setViewer(pdfViewer);

let loadingTask = null;
let currentDocument = null;
let currentDocName = "";
let currentFileSize = 0;
let viewMode = "none"; // "none" | "pdf" | "reflow"
let reflowCleanup = null; // releases blob URLs etc. for the open reflow doc

const DEFAULT_HIGHLIGHT = "#fff066";
const spreadCycle = [SpreadMode.NONE, SpreadMode.ODD, SpreadMode.EVEN];
const spreadLabels = ["Off", "Odd left", "Even left"];
let spreadIndex = 0;
let continuous = true;
let currentQuery = "";

startTheme();

/* ---------- Menu ---------- */
menuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  menu.hidden ? openMenu() : closeMenu();
});
document.addEventListener("click", (event) => {
  if (!menu.hidden && !menu.contains(event.target) && event.target !== menuButton) closeMenu();
});
function openMenu() { menu.hidden = false; menuButton.setAttribute("aria-expanded", "true"); }
function closeMenu() { menu.hidden = true; menuButton.setAttribute("aria-expanded", "false"); }

/* ---------- File open (routes by type) ---------- */
fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  await openFile(file);
  fileInput.value = "";
});

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
  if (!kind) { menuStatus.textContent = "Unsupported file type"; return; }
  closeMenu();
  if (kind === "pdf") await openPdf(file, fromRecent);
  else await openReflow(file, kind, fromRecent);
}

// Tear down whichever document is currently open before loading a new one.
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
}

async function openPdf(file, fromRecent = false) {
  docTitle.textContent = file.name;
  menuStatus.textContent = "Opening…";
  closeFind();

  try {
    await closeCurrent();

    const data = await file.arrayBuffer();
    // pdf.js transfers `data` to its worker (detaching it), so keep a clone for
    // the recent-files cache before handing the original off.
    const forCache = data.slice(0);
    loadingTask = pdfjsLib.getDocument({ data, isEvalSupported: false });
    currentDocument = await loadingTask.promise;
    currentDocName = file.name;
    currentFileSize = file.size;
    viewMode = "pdf";
    document.body.classList.remove("reflow-mode");
    welcome.hidden = true;
    viewer.hidden = false;
    pdfViewer.setDocument(currentDocument);
    linkService.setDocument(currentDocument);

    annotationTools.hidden = !annotationsEnabled;
    toolsToggle.hidden = !annotationsEnabled;
    findButton.hidden = false;

    if (!fromRecent) saveRecentSafe(file, "pdf", forCache);
    refreshRecent();
  } catch (error) {
    console.error(error);
    failOpen("This PDF could not be opened");
  }
}

async function openReflow(file, kind, fromRecent = false) {
  docTitle.textContent = file.name;
  menuStatus.textContent = "Opening…";
  closeFind();

  try {
    await closeCurrent();

    let html;
    if (kind === "text") html = await readText(file);
    else if (kind === "docx") html = await readDocx(file);
    else { const result = await readEpub(file); html = result.html; reflowCleanup = result.cleanup; }

    docReader.innerHTML = html; // sanitized inside the readers
    docReader.hidden = false;
    viewer.hidden = true;
    welcome.hidden = true;
    container.scrollTop = 0;

    currentDocName = file.name;
    currentFileSize = file.size;
    viewMode = "reflow";
    document.body.classList.add("reflow-mode");
    document.body.classList.remove("tools-open");
    annotationTools.hidden = true;
    toolsToggle.hidden = true;
    findButton.hidden = true;
    menuStatus.textContent = readerLabel(kind);

    if (!fromRecent) saveRecentSafe(file, kind);
    refreshRecent();
  } catch (error) {
    console.error(error);
    failOpen("This file could not be opened");
  }
}

function readerLabel(kind) {
  return kind === "epub" ? "EPUB document"
    : kind === "docx" ? "Word document"
    : "Text document";
}

function failOpen(message) {
  loadingTask = null;
  currentDocument = null;
  reflowCleanup = null;
  viewMode = "none";
  welcome.hidden = false;
  viewer.hidden = false;
  docReader.hidden = true;
  docTitle.textContent = "";
  document.body.classList.remove("reflow-mode", "tools-open");
  annotationTools.hidden = true;
  toolsToggle.hidden = true;
  findButton.hidden = true;
  menuStatus.textContent = message;
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

async function refreshRecent() {
  let items = [];
  try { items = await listRecent(); } catch { /* ignore */ }
  recentList.replaceChildren();
  if (!items.length) { recentFiles.hidden = true; return; }
  recentFiles.hidden = false;

  items.forEach((record) => {
    const row = document.createElement("div");
    row.className = "recent-item";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "recent-open";
    open.append(createTextElement("span", recentBadge(record.kind), "recent-badge"));
    const meta = document.createElement("span");
    meta.className = "recent-meta";
    meta.append(createTextElement("span", record.name, "recent-name"));
    meta.append(createTextElement("span", formatBytes(record.size) + (record.data ? "" : " · re-open needed"), "recent-size"));
    open.append(meta);
    open.addEventListener("click", () => openRecent(record));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "recent-remove";
    remove.setAttribute("aria-label", `Remove ${record.name}`);
    remove.textContent = "✕";
    remove.addEventListener("click", async (event) => {
      event.stopPropagation();
      await removeRecent(record.id);
      refreshRecent();
    });

    row.append(open, remove);
    recentList.append(row);
  });
}

function recentBadge(kind) {
  return kind === "pdf" ? "PDF" : kind === "epub" ? "EPUB" : kind === "docx" ? "DOC" : "TXT";
}

async function openRecent(record) {
  if (!record.data) {
    // File was too large to cache — fall back to the picker.
    menuStatus.textContent = "This file is too large to remember — please choose it again";
    fileInput.click();
    return;
  }
  const file = new File([record.data], record.name, { type: mimeFor(record.kind), lastModified: record.lastModified });
  await touchRecent(record.id);
  await openFile(file, { fromRecent: true });
}

refreshRecent();

eventBus.on("pagesinit", () => {
  if (!currentDocument) return;
  pdfViewer.currentScaleValue = "page-width";
  const pageWord = currentDocument.numPages === 1 ? "page" : "pages";
  menuStatus.textContent = `${currentDocument.numPages} ${pageWord}`;
  setTool("select");
  setHighlightColor(DEFAULT_HIGHLIGHT);
});

eventBus.on("scalechanging", ({ scale, presetValue }) => {
  zoomLabel.textContent = presetValue === "page-width" ? "Fit width" : `${Math.round(scale * 100)}%`;
});

/* ---------- Zoom & view modes ---------- */
const MIN_SCALE = 0.25;
const MAX_SCALE = 6;
function zoomBy(factor) {
  if (!currentDocument) return;
  pdfViewer.currentScale = Math.min(Math.max(pdfViewer.currentScale * factor, MIN_SCALE), MAX_SCALE);
}
zoomInButton.addEventListener("click", () => zoomBy(1.1));
zoomOutButton.addEventListener("click", () => zoomBy(1 / 1.1));
fitWidthButton.addEventListener("click", () => { if (currentDocument) pdfViewer.currentScaleValue = "page-width"; closeMenu(); });

// Desktop: Ctrl/⌘ + wheel zooms the PDF (also covers trackpad pinch, which
// the browser reports as a ctrl-wheel event). Plain scrolling is untouched.
container.addEventListener("wheel", (event) => {
  if (!(event.ctrlKey || event.metaKey) || !currentDocument) return;
  event.preventDefault();
  zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
}, { passive: false });

continuousButton.addEventListener("click", () => {
  continuous = !continuous;
  pdfViewer.scrollMode = continuous ? ScrollMode.VERTICAL : ScrollMode.PAGE;
  continuousButton.classList.toggle("on", continuous);
});

spreadButton.addEventListener("click", () => {
  spreadIndex = (spreadIndex + 1) % spreadCycle.length;
  pdfViewer.spreadMode = spreadCycle[spreadIndex];
  spreadState.textContent = spreadLabels[spreadIndex];
});

// Rotate stays inside the open menu so you can tap repeatedly.
rotateRightButton.addEventListener("click", () => {
  if (!currentDocument) return;
  pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 90) % 360;
});
rotateLeftButton.addEventListener("click", () => {
  if (!currentDocument) return;
  pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 270) % 360;
});

/* ---------- Annotation tools ---------- */
let annotationActive = false; // true for highlight or note — taps belong to the editor
function setTool(tool) {
  toolSelect.classList.toggle("active", tool === "select");
  toolHighlight.classList.toggle("active", tool === "highlight");
  toolNote.classList.toggle("active", tool === "note");
  highlightColors.hidden = tool !== "highlight";

  // Highlighting needs real text selection; reading uses tap-to-define, so we
  // keep the text layer unselectable except in highlight mode (no OS callout).
  annotationActive = tool !== "select";
  container.classList.toggle("select-mode", tool === "highlight");

  const mode =
    tool === "highlight" ? AnnotationEditorType.HIGHLIGHT :
    tool === "note" ? AnnotationEditorType.FREETEXT :
    AnnotationEditorType.NONE;

  try { pdfViewer.annotationEditorMode = { mode }; } catch (error) { console.error(error); }
}

let highlightColor = DEFAULT_HIGHLIGHT;
function setHighlightColor(color) {
  // HIGHLIGHT_COLOR sets the default for new highlights and recolors any
  // currently-selected one. (HIGHLIGHT_DEFAULT_COLOR doesn't exist in pdfjs 5.)
  highlightColor = color;
  eventBus.dispatch("switchannotationeditorparams", {
    source: window,
    type: AnnotationEditorParamsType.HIGHLIGHT_COLOR,
    value: color,
  });
}

// Switching INTO highlight mode from read mode is async (pdfjs defers it), so a
// color set in the same click is dropped. Re-apply it once the mode is live.
eventBus.on("annotationeditormodechanged", ({ mode }) => {
  if (mode === AnnotationEditorType.HIGHLIGHT) setHighlightColor(highlightColor);
});

toolSelect.addEventListener("click", () => setTool("select"));
toolHighlight.addEventListener("click", () => setTool("highlight"));
toolNote.addEventListener("click", () => setTool("note"));

swatches.forEach((swatch) => {
  swatch.addEventListener("click", () => {
    swatches.forEach((other) => other.classList.toggle("active", other === swatch));
    setTool("highlight");
    setHighlightColor(swatch.dataset.color);
  });
});

/* ---------- Annotation undo / redo / delete ---------- */
function editingAction(name) {
  if (!currentDocument) return;
  eventBus.dispatch("editingaction", { source: window, name });
}
editUndo.addEventListener("click", () => editingAction("undo"));
editRedo.addEventListener("click", () => editingAction("redo"));
editDelete.addEventListener("click", () => editingAction("delete"));

/* ---------- Save annotated copy ---------- */
savePdfButton.addEventListener("click", async () => {
  closeMenu();
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
  } catch (error) {
    console.error(error);
    menuStatus.textContent = "Could not save the document";
  }
});

/* ---------- Properties & shortcuts ---------- */
propertiesButton.addEventListener("click", async () => {
  closeMenu();
  if (!currentDocument) return;
  const { info = {} } = await currentDocument.getMetadata();
  const rows = [
    ["Title", info.Title],
    ["Author", info.Author],
    ["Subject", info.Subject],
    ["Keywords", info.Keywords],
    ["Creator", info.Creator],
    ["Producer", info.Producer],
    ["PDF version", info.PDFFormatVersion],
    ["Pages", String(currentDocument.numPages)],
    ["File size", formatBytes(currentFileSize)],
    ["Created", formatPdfDate(info.CreationDate)],
    ["Modified", formatPdfDate(info.ModDate)],
  ];

  const fragment = document.createDocumentFragment();
  rows.forEach(([key, value]) => {
    if (!value) return;
    const row = document.createElement("div");
    row.className = "prop-row";
    row.append(createTextElement("span", key, "prop-key"));
    row.append(createTextElement("span", String(value), "prop-val"));
    fragment.append(row);
  });
  openModal("Document properties", fragment);
});

shortcutsButton.addEventListener("click", () => {
  closeMenu();
  const shortcuts = [
    ["Find in document", "Ctrl / ⌘ + F"],
    ["Close find / dialog", "Esc"],
    ["Look up a word", "Double-click it"],
    ["Zoom in / out", "Ctrl / ⌘ + +  /  −"],
    ["Fit width", "Ctrl / ⌘ + 0"],
    ["Zoom with mouse", "Ctrl / ⌘ + scroll"],
  ];
  const fragment = document.createDocumentFragment();
  shortcuts.forEach(([label, keys]) => {
    const row = document.createElement("div");
    row.className = "shortcut-row";
    row.append(createTextElement("span", label));
    row.append(createTextElement("span", keys, "kbd"));
    fragment.append(row);
  });
  openModal("Keyboard shortcuts", fragment);
});

function openModal(title, bodyNode) {
  modalTitle.textContent = title;
  modalBody.replaceChildren(bodyNode);
  modal.hidden = false;
}
function closeModal() { modal.hidden = true; modalBody.replaceChildren(); }
modalClose.addEventListener("click", closeModal);
modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });

/* ---------- Find in document ---------- */
findButton.addEventListener("click", () => (findBar.hidden ? openFind() : closeFind()));
findClose.addEventListener("click", closeFind);

findInput.addEventListener("input", () => runFind(findInput.value, ""));
findInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); runFind(findInput.value, "again", event.shiftKey); }
});
findPrev.addEventListener("click", () => runFind(currentQuery || findInput.value, "again", true));
findNext.addEventListener("click", () => runFind(currentQuery || findInput.value, "again", false));

function openFind() {
  if (!currentDocument) return;
  findBar.hidden = false;
  findButton.classList.add("active");
  findInput.focus();
  findInput.select();
}
function closeFind() {
  findBar.hidden = true;
  findButton.classList.remove("active");
  currentQuery = "";
  findCount.textContent = "";
  eventBus.dispatch("find", { source: window, type: "", query: "", caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: false });
}
function runFind(query, type, findPrevious = false) {
  currentQuery = query;
  if (!query) { findCount.textContent = ""; }
  eventBus.dispatch("find", { source: window, type, query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious });
}

eventBus.on("updatefindcontrolstate", ({ matchesCount }) => renderFindCount(matchesCount));
eventBus.on("updatefindmatchescount", ({ matchesCount }) => renderFindCount(matchesCount));
function renderFindCount(matchesCount) {
  if (!currentQuery) { findCount.textContent = ""; return; }
  if (!matchesCount || !matchesCount.total) { findCount.textContent = "No results"; return; }
  findCount.textContent = `${matchesCount.current} of ${matchesCount.total}`;
}

/* ---------- Global keys ---------- */
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && currentDocument) {
    event.preventDefault();
    openFind();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && currentDocument) {
    if (event.key === "=" || event.key === "+") { event.preventDefault(); zoomBy(1.1); return; }
    if (event.key === "-") { event.preventDefault(); zoomBy(1 / 1.1); return; }
    if (event.key === "0") { event.preventDefault(); pdfViewer.currentScaleValue = "page-width"; return; }
  }
  if (event.key === "Escape") {
    if (!modal.hidden) { closeModal(); return; }
    if (!findBar.hidden) { closeFind(); return; }
    closeMenu();
  }
});

/* ---------- Dictionary lookup ---------- */
// Tint the looked-up word on the page (CSS Custom Highlight API) so it's clear
// which word the dictionary is showing. Passing null clears it.
let lookupHighlight = null;
function setLookupRange(range) {
  if (typeof Highlight === "undefined" || !CSS.highlights) return;
  if (!lookupHighlight) {
    lookupHighlight = new Highlight();
    CSS.highlights.set("lookup-word", lookupHighlight);
  }
  lookupHighlight.clear();
  if (range) lookupHighlight.add(range);
}

container.addEventListener("dblclick", async (event) => {
  if (!event.target.closest(".textLayer, .doc-reader")) return;
  const selection = window.getSelection();
  const word = extractLookupWord(selection?.toString() ?? "");
  if (!word) return;
  if (selection?.rangeCount) setLookupRange(selection.getRangeAt(0).cloneRange());
  searchInput.value = word;
  hideSuggestions();
  await lookup(word);
});

function extractLookupWord(text) {
  const cleaned = text.replaceAll("’", "'").trim();
  const match = cleaned.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/);
  return match ? match[0].toLowerCase() : "";
}

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
    } catch (error) {
      hideSuggestions();
    }
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

async function lookup(rawWord) {
  const word = (rawWord || "").trim();
  if (!word) return;
  // On mobile, a fresh lookup (e.g. from tapping a word) opens the compact peek.
  // If the sheet is already open (user searched), leave its state alone.
  if (isMobile() && sheetState === "hidden") setSheetState("peek");
  showDictionaryLoading();
  try {
    const rows = await fetchWord(word);
    renderDictionaryResult(word.toLowerCase(), rows);
  } catch (error) {
    console.error(error);
    showDictionaryMessage("Could not reach the dictionary. Check your connection and try again.", "error");
  }
}

function renderDictionaryResult(word, groups) {
  dictionaryContent.replaceChildren();
  if (!groups || groups.length === 0) { showDictionaryMessage("Word not found."); return; }

  const head = document.createElement("div");
  head.className = "result-head";
  head.append(createTextElement("h2", word, "result-word"));
  const pron = createTextElement("div", "", "result-pron");
  const forms = createTextElement("div", "", "word-forms");
  head.append(pron, forms);
  dictionaryContent.append(head);

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
    group.senses.forEach((sense, index) => body.append(buildSense(sense, index + 1)));
    if (group.phrases.length) body.append(buildPhrases(group.phrases));
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

function buildSense(sense, number) {
  const section = document.createElement("section");
  section.className = "sense";

  const headRow = document.createElement("div");
  headRow.className = "sense-head";
  headRow.append(createTextElement("span", `${number}.`, "sense-num"));
  headRow.append(createTextElement("span", sense.translations.join(", "), "sense-translation"));
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
  toggle.addEventListener("click", () => {
    list.hidden = !list.hidden;
    toggle.classList.toggle("open", !list.hidden);
  });

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
  wrap.append(spinner, createTextElement("span", "Searching…"));
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

/* ---------- Theme ---------- */
function startTheme() {
  const saved = localStorage.getItem("nyx-theme");
  if (saved === "light" || saved === "dark") { setTheme(saved); return; }
  setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
function setTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = theme;
  themeIcon.textContent = isDark ? "☀" : "☾";
  themeLabel.textContent = isDark ? "Day mode" : "Night mode";
  // One switch: night mode darkens the UI *and* the pages, day restores both.
  container.classList.toggle("invert-pages", isDark);
  localStorage.setItem("nyx-theme", theme);
}
themeToggleButton.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

/* ---------- Fullscreen ---------- */
fullscreenButton.addEventListener("click", () => {
  closeMenu();
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen?.().catch((error) => console.error(error));
  }
});
document.addEventListener("fullscreenchange", () => {
  fullscreenLabel.textContent = document.fullscreenElement ? "Exit fullscreen" : "Enter fullscreen";
});

/* ---------- Mobile bottom sheet ---------- */
const mobileMedia = window.matchMedia("(max-width: 920px)");
const PEEK_HIDDEN_RATIO = 0.62; // must match `.state-peek` translateY(62%) in CSS
let sheetState = "hidden"; // "hidden" | "peek" | "full"

function isMobile() { return mobileMedia.matches; }

function setSheetState(state) {
  sheetState = state;
  dictionaryPanel.style.transform = "";
  dictionaryPanel.classList.toggle("state-peek", state === "peek");
  dictionaryPanel.classList.toggle("state-full", state === "full");
  document.body.classList.toggle("sheet-full", state === "full");
}

// Dictionary button: toggle the sheet open (full) / closed.
dictButton.addEventListener("click", () => {
  if (!isMobile()) return;
  if (sheetState === "full") {
    setSheetState("hidden");
  } else {
    setSheetState("full");
    setTimeout(() => searchInput.focus(), 60);
  }
});

// Pen button: reveal / hide the annotation tool strip.
toolsToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = document.body.classList.toggle("tools-open");
  toolsToggle.classList.toggle("active", open);
});

/* ---------- Annotation tools on/off (menu, persisted) ---------- */
let annotationsEnabled = localStorage.getItem("nyx-annotations") !== "off";
function applyAnnotations() {
  document.body.classList.toggle("annotations-off", !annotationsEnabled);
  annotationsToggle.classList.toggle("on", annotationsEnabled);
  if (!annotationsEnabled) {
    document.body.classList.remove("tools-open");
    toolsToggle.classList.remove("active");
    setTool("select"); // drop out of highlight/note mode when hiding the tools
  }
}
annotationsToggle.addEventListener("click", () => {
  annotationsEnabled = !annotationsEnabled;
  localStorage.setItem("nyx-annotations", annotationsEnabled ? "on" : "off");
  applyAnnotations();
});
applyAnnotations();

/* ---------- Resizable dictionary panel (desktop) ---------- */
const DICT_MIN = 280;
const DICT_MAX = 720;
function clampDictWidth(value) { return Math.min(Math.max(value, DICT_MIN), DICT_MAX); }
function applyDictWidth() {
  const saved = Number(localStorage.getItem("nyx-dict-w"));
  if (!isMobile() && saved) {
    document.documentElement.style.setProperty("--dictionary-width", `${clampDictWidth(saved)}px`);
  } else {
    document.documentElement.style.removeProperty("--dictionary-width"); // fall back to the stylesheet (incl. mobile 100%)
  }
}
function refitPdf() {
  if (!currentDocument) return;
  pdfViewer.currentScaleValue = pdfViewer.currentScaleValue; // refit page-width; numeric scales stay put
}

let dictDragWidth = null;
dictResizer.addEventListener("pointerdown", (event) => {
  if (isMobile()) return;
  event.preventDefault();
  dictDragWidth = dictionaryPanel.offsetWidth;
  dictResizer.setPointerCapture(event.pointerId);
  document.body.classList.add("dict-resizing");
});
dictResizer.addEventListener("pointermove", (event) => {
  if (dictDragWidth === null) return;
  dictDragWidth = clampDictWidth(window.innerWidth - event.clientX);
  document.documentElement.style.setProperty("--dictionary-width", `${dictDragWidth}px`);
});
function endDictDrag() {
  if (dictDragWidth === null) return;
  localStorage.setItem("nyx-dict-w", String(dictDragWidth));
  dictDragWidth = null;
  document.body.classList.remove("dict-resizing");
  refitPdf();
}
dictResizer.addEventListener("pointerup", endDictDrag);
dictResizer.addEventListener("pointercancel", endDictDrag);
applyDictWidth();

// Tap the dimmed backdrop, or the ✕ in the sheet header, to close the sheet.
scrim.addEventListener("click", () => setSheetState("hidden"));
sheetClose.addEventListener("click", () => setSheetState("hidden"));

// Tap the compact peek to expand it to full detail.
dictionaryContent.addEventListener("click", (event) => {
  if (isMobile() && sheetState === "peek" && !event.target.closest("button, a")) {
    setSheetState("full");
  }
});

/* ----- Grabber: tap to toggle, drag to snap between states ----- */
function stateTranslate(state, height) {
  if (state === "full") return 0;
  if (state === "peek") return height * PEEK_HIDDEN_RATIO;
  return height; // hidden
}

let drag = null;
sheetGrabber.addEventListener("pointerdown", (event) => {
  if (!isMobile()) return;
  const height = dictionaryPanel.offsetHeight;
  drag = { startY: event.clientY, height, lastT: stateTranslate(sheetState, height), moved: false };
  dictionaryPanel.style.transition = "none";
  sheetGrabber.setPointerCapture(event.pointerId);
});
sheetGrabber.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const dy = event.clientY - drag.startY;
  if (Math.abs(dy) > 4) drag.moved = true;
  drag.lastT = Math.min(Math.max(stateTranslate(sheetState, drag.height) + dy, 0), drag.height);
  dictionaryPanel.style.transform = `translateY(${drag.lastT}px)`;
});
function endDrag() {
  if (!drag) return;
  const { height, lastT, moved } = drag;
  drag = null;
  dictionaryPanel.style.transition = "";
  if (!moved) {
    setSheetState(sheetState === "full" ? "peek" : "full");
    return;
  }
  const candidates = [["full", 0], ["peek", height * PEEK_HIDDEN_RATIO], ["hidden", height]];
  let best = candidates[0];
  for (const candidate of candidates) {
    if (Math.abs(candidate[1] - lastT) < Math.abs(best[1] - lastT)) best = candidate;
  }
  setSheetState(best[0]);
}
sheetGrabber.addEventListener("pointerup", endDrag);
sheetGrabber.addEventListener("pointercancel", endDrag);

function toggleChrome() {
  if (!isMobile()) return;
  const hidden = document.body.classList.toggle("chrome-hidden");
  if (hidden) {
    document.body.classList.remove("tools-open");
    toolsToggle.classList.remove("active");
  }
}

/* ----- Touch: tap a word to define it; tap empty space to toggle chrome ----- */
// Find the word under a screen point without creating a text selection,
// so Android's selection callout / Circle-to-Search never fires while reading.
function wordAtPoint(x, y) {
  let range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(x, y);
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); }
  }
  const node = range && range.startContainer;
  if (!node || node.nodeType !== 3 || !node.parentElement?.closest(".textLayer, .doc-reader")) return null;
  const text = node.textContent || "";
  const isWordChar = (ch) => ch && /[A-Za-z'’-]/.test(ch);
  let start = range.startOffset;
  let end = range.startOffset;
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
container.addEventListener("pointerup", (event) => {
  if (event.pointerType !== "touch" || !tapStart) return;
  const movedX = Math.abs(event.clientX - tapStart.x);
  const movedY = Math.abs(event.clientY - tapStart.y);
  const elapsed = Date.now() - tapStart.time;
  tapStart = null;
  if (movedX > 10 || movedY > 10 || elapsed > 500) return; // scroll/hold, not a tap
  if (annotationActive) return; // highlight/note mode: taps belong to the annotation editor
  const hit = wordAtPoint(event.clientX, event.clientY);
  if (hit) {
    setLookupRange(hit.range);
    searchInput.value = hit.word;
    lookup(hit.word);
  } else if (sheetState === "hidden") {
    toggleChrome();
  }
}, { passive: true });

/* ----- Touch: pinch to zoom the PDF (not the whole page) ----- */
function touchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

let pinch = null;
let pendingScale = null;
let scaleRaf = null;
function applyPendingScale() {
  scaleRaf = null;
  if (pendingScale != null) { pdfViewer.currentScale = pendingScale; pendingScale = null; }
}
container.addEventListener("touchstart", (event) => {
  if (event.touches.length === 2 && currentDocument) {
    pinch = { startDistance: touchDistance(event.touches), startScale: pdfViewer.currentScale };
  }
}, { passive: false });
container.addEventListener("touchmove", (event) => {
  if (!pinch || event.touches.length !== 2) return;
  event.preventDefault(); // stop the browser from zooming the whole page
  const ratio = touchDistance(event.touches) / pinch.startDistance;
  pendingScale = Math.min(Math.max(pinch.startScale * ratio, 0.25), 6);
  if (!scaleRaf) scaleRaf = requestAnimationFrame(applyPendingScale);
}, { passive: false });
container.addEventListener("touchend", (event) => {
  if (event.touches.length < 2) pinch = null;
}, { passive: true });

// Switching between mobile/desktop: re-apply the saved panel width (desktop only).
mobileMedia.addEventListener("change", () => {
  applyDictWidth();
  if (!mobileMedia.matches) {
    setSheetState("hidden");
    document.body.classList.remove("chrome-hidden", "tools-open", "sheet-full");
    dictionaryPanel.style.transform = "";
    dictionaryPanel.style.transition = "";
  }
});