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

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const { AnnotationEditorType, AnnotationEditorParamsType } = pdfjsLib;

/* ---------- Elements ---------- */
const fileInput = document.querySelector("#file-input");
const container = document.querySelector("#viewer-container");
const viewer = document.querySelector("#viewer");
const welcome = document.querySelector("#welcome");
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
const sheetGrabber = document.querySelector("#sheet-grabber");
const scrim = document.querySelector("#scrim");
const dictButton = document.querySelector("#dict-button");
const toolsToggle = document.querySelector("#tools-toggle");

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

/* ---------- PDF open ---------- */
fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) { menuStatus.textContent = "Please choose a PDF file"; return; }
  closeMenu();
  await openPdf(file);
  fileInput.value = "";
});

async function openPdf(file) {
  docTitle.textContent = file.name;
  menuStatus.textContent = "Opening…";
  closeFind();

  try {
    if (currentDocument) { pdfViewer.setDocument(null); linkService.setDocument(null); }
    if (loadingTask) { await loadingTask.destroy(); loadingTask = null; currentDocument = null; }

    const data = await file.arrayBuffer();
    loadingTask = pdfjsLib.getDocument({ data, isEvalSupported: false });
    currentDocument = await loadingTask.promise;
    currentDocName = file.name;
    currentFileSize = file.size;
    welcome.hidden = true;
    pdfViewer.setDocument(currentDocument);
    linkService.setDocument(currentDocument);

    annotationTools.hidden = false;
    toolsToggle.hidden = false;
    findButton.hidden = false;
  } catch (error) {
    console.error(error);
    loadingTask = null;
    currentDocument = null;
    welcome.hidden = false;
    docTitle.textContent = "";
    annotationTools.hidden = true;
    toolsToggle.hidden = true;
    findButton.hidden = true;
    document.body.classList.remove("tools-open");
    menuStatus.textContent = "This PDF could not be opened";
  }
}

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
  if (!event.target.closest(".textLayer")) return;
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

function renderDictionaryResult(word, rows) {
  dictionaryContent.replaceChildren();
  if (rows.length === 0) { showDictionaryMessage("Word not found."); return; }

  const groups = new Map();
  rows.forEach((row) => {
    const cls = (row.word_class || "Other").trim() || "Other";
    if (!groups.has(cls)) groups.set(cls, []);
    groups.get(cls).push(row);
  });
  const classes = [...groups.keys()];

  const head = document.createElement("div");
  head.className = "result-head";
  head.append(createTextElement("h2", word, "result-word"));
  const pron = createTextElement("div", "", "result-pron");
  head.append(pron);
  dictionaryContent.append(head);

  const tabs = document.createElement("div");
  tabs.className = "pos-tabs";
  dictionaryContent.append(tabs);

  const sensesWrap = document.createElement("div");
  sensesWrap.className = "senses";
  dictionaryContent.append(sensesWrap);

  function selectClass(cls) {
    [...tabs.children].forEach((tab) => tab.classList.toggle("active", tab.dataset.cls === cls));
    const entries = groups.get(cls);
    pron.textContent = entries.find((row) => row.pronunciation)?.pronunciation ?? "";
    sensesWrap.replaceChildren();
    entries.forEach((row, index) => sensesWrap.append(buildSense(row, index + 1)));
  }

  classes.forEach((cls) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "pos-tab";
    tab.dataset.cls = cls;
    tab.textContent = capitalize(cls);
    tab.addEventListener("click", () => selectClass(cls));
    tabs.append(tab);
  });
  if (classes.length <= 1) tabs.hidden = true;
  selectClass(classes[0]);
}

function buildSense(row, number) {
  const sense = document.createElement("section");
  sense.className = "sense";

  const headRow = document.createElement("div");
  headRow.className = "sense-head";
  headRow.append(createTextElement("span", `${number}.`, "sense-num"));

  const translations = String(row.translations ?? "").split("\x1f").map((v) => v.trim()).filter(Boolean);
  headRow.append(createTextElement("span", translations.join(", "), "sense-translation"));
  if (row.word_level) headRow.append(createTextElement("span", row.word_level, "sense-level"));
  sense.append(headRow);

  const examples = String(row.examples ?? "").split("\n").map((v) => v.trim()).filter(Boolean);
  if (examples.length > 0) {
    sense.append(createTextElement("div", "Examples", "examples-label"));
    const VISIBLE = 2;
    examples.forEach((example, index) => {
      const el = createTextElement("p", example, "example");
      if (index >= VISIBLE) el.hidden = true;
      sense.append(el);
    });
    if (examples.length > VISIBLE) {
      const hiddenCount = examples.length - VISIBLE;
      const moreButton = document.createElement("button");
      moreButton.type = "button";
      moreButton.className = "more-examples";
      moreButton.textContent = `More examples (${hiddenCount})`;
      moreButton.addEventListener("click", () => {
        const collapsed = sense.querySelector(".example[hidden]");
        if (collapsed) {
          sense.querySelectorAll(".example").forEach((el) => (el.hidden = false));
          moreButton.textContent = "Show fewer examples";
        } else {
          sense.querySelectorAll(".example").forEach((el, index) => (el.hidden = index >= VISIBLE));
          moreButton.textContent = `More examples (${hiddenCount})`;
        }
      });
      sense.append(moreButton);
    }
  }
  return sense;
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
  if (!node || node.nodeType !== 3 || !node.parentElement?.closest(".textLayer")) return null;
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

// Returning to desktop layout: clear any mobile-only state.
mobileMedia.addEventListener("change", () => {
  if (!mobileMedia.matches) {
    setSheetState("hidden");
    document.body.classList.remove("chrome-hidden", "tools-open", "sheet-full");
    dictionaryPanel.style.transform = "";
    dictionaryPanel.style.transition = "";
  }
});