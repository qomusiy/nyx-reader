import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
  PDFFindController,
  ScrollMode,
  SpreadMode,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import initSqlJs from "sql.js";

import "pdfjs-dist/web/pdf_viewer.css";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import "./style.css";

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

const annotationTools = document.querySelector("#annotation-tools");
const toolSelect = document.querySelector("#tool-select");
const toolHighlight = document.querySelector("#tool-highlight");
const toolNote = document.querySelector("#tool-note");
const highlightColors = document.querySelector("#highlight-colors");
const swatches = [...document.querySelectorAll(".swatch")];

const continuousButton = document.querySelector("#toggle-continuous");
const spreadButton = document.querySelector("#cycle-spread");
const spreadState = document.querySelector("#spread-state");
const rotateButton = document.querySelector("#rotate");
const invertButton = document.querySelector("#toggle-invert");
const savePdfButton = document.querySelector("#save-pdf");
const propertiesButton = document.querySelector("#properties");
const shortcutsButton = document.querySelector("#shortcuts");

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
let dictionaryDatabase = null;
let dictionaryError = null;

const DEFAULT_HIGHLIGHT = "#fff066";
const spreadCycle = [SpreadMode.NONE, SpreadMode.ODD, SpreadMode.EVEN];
const spreadLabels = ["Off", "Odd left", "Even left"];
let spreadIndex = 0;
let continuous = true;
let inverted = false;
let currentQuery = "";

const dictionaryReady = loadDictionary();
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
    findButton.hidden = false;
  } catch (error) {
    console.error(error);
    loadingTask = null;
    currentDocument = null;
    welcome.hidden = false;
    docTitle.textContent = "";
    annotationTools.hidden = true;
    findButton.hidden = true;
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
zoomInButton.addEventListener("click", () => { if (currentDocument) pdfViewer.currentScale *= 1.1; });
zoomOutButton.addEventListener("click", () => { if (currentDocument) pdfViewer.currentScale /= 1.1; });
fitWidthButton.addEventListener("click", () => { if (currentDocument) pdfViewer.currentScaleValue = "page-width"; closeMenu(); });

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

rotateButton.addEventListener("click", () => {
  if (!currentDocument) return;
  pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 90) % 360;
  closeMenu();
});

invertButton.addEventListener("click", () => {
  inverted = !inverted;
  container.classList.toggle("invert-pages", inverted);
  invertButton.classList.toggle("on", inverted);
});

/* ---------- Annotation tools ---------- */
function setTool(tool) {
  toolSelect.classList.toggle("active", tool === "select");
  toolHighlight.classList.toggle("active", tool === "highlight");
  toolNote.classList.toggle("active", tool === "note");
  highlightColors.hidden = tool !== "highlight";

  const mode =
    tool === "highlight" ? AnnotationEditorType.HIGHLIGHT :
    tool === "note" ? AnnotationEditorType.FREETEXT :
    AnnotationEditorType.NONE;

  try { pdfViewer.annotationEditorMode = { mode }; } catch (error) { console.error(error); }
}

function setHighlightColor(color) {
  eventBus.dispatch("switchannotationeditorparams", {
    source: window,
    type: AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR,
    value: color,
  });
}

toolSelect.addEventListener("click", () => setTool("select"));
toolHighlight.addEventListener("click", () => setTool("highlight"));
toolNote.addEventListener("click", () => setTool("note"));

swatches.forEach((swatch) => {
  swatch.addEventListener("click", () => {
    swatches.forEach((other) => other.classList.toggle("active", other === swatch));
    setHighlightColor(swatch.dataset.color);
    setTool("highlight");
  });
});

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
    ["Zoom in / out", "Menu → + / −"],
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
  if (event.key === "Escape") {
    if (!modal.hidden) { closeModal(); return; }
    if (!findBar.hidden) { closeFind(); return; }
    closeMenu();
  }
});

/* ---------- Dictionary lookup ---------- */
container.addEventListener("dblclick", async (event) => {
  if (!event.target.closest(".textLayer")) return;
  const selectedText = window.getSelection()?.toString() ?? "";
  const word = extractLookupWord(selectedText);
  if (!word) return;
  searchInput.value = word;
  hideSuggestions();
  await lookup(word);
});

async function loadDictionary() {
  try {
    const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
    const response = await fetch("/dictionary.db");
    if (!response.ok) throw new Error(`Database request failed: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    dictionaryDatabase = new SQL.Database(bytes);
  } catch (error) {
    console.error(error);
    dictionaryError = error;
    showDictionaryMessage("Dictionary database could not be loaded.", "error");
  }
}

function extractLookupWord(text) {
  const cleaned = text.replaceAll("’", "'").trim();
  const match = cleaned.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/);
  return match ? match[0].toLowerCase() : "";
}

function findWord(word) {
  const query = `
    WITH resolved_entries AS (
      SELECT
        e.id AS entry_id,
        e.parent_word,
        e.normalized_word AS word,
        COALESCE(NULLIF(TRIM(e.word_class), ''), NULLIF(TRIM(p.word_class), '')) AS word_class,
        COALESCE(NULLIF(TRIM(e.word_level), ''), NULLIF(TRIM(p.word_level), '')) AS word_level,
        COALESCE(NULLIF(TRIM(e.pronunciation), ''), NULLIF(TRIM(p.pronunciation), '')) AS pronunciation
      FROM entries AS e
      LEFT JOIN entries AS p ON e.parent_word = p.id
      WHERE e.normalized_word = :word COLLATE NOCASE
    )
    SELECT
      r.entry_id, r.parent_word, r.word, r.word_class, r.word_level, r.pronunciation,
      (
        SELECT GROUP_CONCAT(translation, CHAR(31))
        FROM (SELECT DISTINCT translation FROM translations WHERE entry_id = r.entry_id ORDER BY id)
      ) AS translations,
      COALESCE((
        SELECT GROUP_CONCAT(example, CHAR(10))
        FROM (SELECT DISTINCT example FROM examples WHERE entry_id = r.entry_id ORDER BY id)
      ), '') AS examples
    FROM resolved_entries AS r
    WHERE EXISTS (SELECT 1 FROM translations WHERE entry_id = r.entry_id)
    ORDER BY
      CASE LOWER(COALESCE(r.word_class, ''))
        WHEN 'adjective' THEN 1 WHEN 'noun' THEN 2 WHEN 'verb' THEN 3 WHEN 'adverb' THEN 4
        WHEN 'pronoun' THEN 5 WHEN 'preposition' THEN 6 WHEN 'conjunction' THEN 7 WHEN 'interjection' THEN 8
        ELSE 99
      END,
      CASE WHEN r.parent_word IS NULL THEN r.entry_id ELSE r.parent_word END,
      CASE WHEN r.parent_word IS NULL THEN 0 ELSE 1 END,
      r.entry_id
  `;
  const statement = dictionaryDatabase.prepare(query);
  const rows = [];
  try {
    statement.bind({ ":word": word });
    while (statement.step()) rows.push(statement.getAsObject());
  } finally { statement.free(); }
  return rows;
}

function suggestWords(prefix) {
  if (!dictionaryDatabase) return [];
  const query = `
    SELECT DISTINCT normalized_word AS word
    FROM entries
    WHERE normalized_word LIKE :prefix COLLATE NOCASE
      AND EXISTS (SELECT 1 FROM translations WHERE entry_id = entries.id)
    ORDER BY LENGTH(normalized_word), normalized_word
    LIMIT 8
  `;
  const statement = dictionaryDatabase.prepare(query);
  const words = [];
  try {
    statement.bind({ ":prefix": `${prefix}%` });
    while (statement.step()) words.push(statement.getAsObject().word);
  } finally { statement.free(); }
  return words;
}

let suggestTimer = null;
searchInput.addEventListener("input", () => {
  const prefix = searchInput.value.trim().toLowerCase();
  clearTimeout(suggestTimer);
  if (!prefix) { hideSuggestions(); return; }
  suggestTimer = setTimeout(async () => {
    await dictionaryReady;
    if (dictionaryError || !dictionaryDatabase) return;
    if (searchInput.value.trim().toLowerCase() !== prefix) return;
    renderSuggestions(suggestWords(prefix));
  }, 120);
});
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); hideSuggestions(); lookup(searchInput.value); }
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
      lookup(word);
    });
    suggestionsBox.append(item);
  });
  suggestionsBox.hidden = false;
}
function hideSuggestions() { suggestionsBox.hidden = true; suggestionsBox.replaceChildren(); }

async function lookup(rawWord) {
  const word = extractLookupWord(rawWord) || rawWord.trim().toLowerCase();
  if (!word) return;
  showDictionaryMessage("Searching…");
  await dictionaryReady;
  if (dictionaryError || !dictionaryDatabase) { showDictionaryMessage("Dictionary could not be loaded.", "error"); return; }
  renderDictionaryResult(word, findWord(word));
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
  localStorage.setItem("nyx-theme", theme);
}
themeToggleButton.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});