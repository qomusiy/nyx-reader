// Wisdom dictionary API (English → Uzbek, with examples, collocations and IPA).
//
// The API only allows CORS from its own site, so the browser cannot call it
// directly. Requests go to same-origin "/wisdom-api/..." and the Vite server
// proxies them to https://new-api.wisdomedu.uz/api/v1 (see vite.config.js).
const API_BASE = "/wisdom-api";

function normalize(word) {
  return String(word ?? "").trim().replace(/^["']+|["']+$/g, "").toLowerCase();
}

// Decode HTML entities (e.g. &nbsp;) and strip tags, collapsing whitespace.
function decodeHtml(value) {
  if (value == null) return "";
  const text = String(value);
  if (!text.includes("<") && !text.includes(">") && !text.includes("&")) {
    return text.replace(/\s+/g, " ").trim();
  }
  // textContent glues block elements together ("…windows.Quyosh…"), so turn
  // line-breaking tags into real whitespace before extracting the text.
  const spaced = text.replace(/<(br|\/p|\/li|\/div|\/h[1-6])\b[^>]*>/gi, " $& ");
  const doc = new DOMParser().parseFromString(spaced, "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

function cleanText(value) {
  return decodeHtml(value);
}

// Example sentences arrive as HTML with a leading "•" bullet — strip both.
function cleanExample(value) {
  return decodeHtml(value).replace(/^[•·▪◦\-–—\s]+/, "").trim();
}

// "<p>move,&nbsp;travel,…</p>" -> ["move", "travel", …] (deduped, capped).
function synonymList(html) {
  const raw = String(html ?? "");
  if (!raw.trim()) return [];

  // The API now returns synonyms as rich HTML — each term in <b>, followed by a
  // gloss and examples. Take the bolded headwords when they are there; fall back
  // to the old comma-separated format otherwise.
  const bolded = [...raw.matchAll(/<(?:b|strong)\b[^>]*>(.*?)<\/(?:b|strong)>/gis)]
    .map((m) => decodeHtml(m[1]))
    .filter(Boolean);

  const parts = bolded.length
    ? bolded
    : decodeHtml(raw).split(/[,;]/);

  const seen = new Set();
  const out = [];
  for (const part of parts) {
    // Drop trailing glosses ("opening – ochiq joy") and bracketed notes.
    const word = String(part).split(/[–—-]/)[0].replace(/\[[^\]]*\]/g, "").trim();
    const key = word.toLowerCase();
    if (word && !seen.has(key)) { seen.add(key); out.push(word); }
  }
  return out.slice(0, 10);
}

// `examples` arrives as an array holding ONE big HTML string with many <p>
// blocks. Split it so each block becomes its own example, as the UI expects.
function exampleList(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of arr) {
    const blocks = String(entry ?? "").split(/<\/p>|<\/li>/i);
    for (const block of blocks) {
      const text = cleanExample(block);
      const key = text.toLowerCase();
      if (text.length > 1 && !seen.has(key)) { seen.add(key); out.push(text); }
    }
  }
  return out.slice(0, 12);
}

// Pull the IPA between slashes out of word_class_body ("[A1, Rank 35] /ɡəʊ/ …").
function parseIpa(body) {
  const match = String(body ?? "").match(/\/[^/]+\//);
  return match ? match[0] : "";
}

// Pull irregular forms out of the bracket list: [goes, went, gone] / [lit, lit].
//
// A body can carry several brackets — "[B1, Rank 2411] /laɪt/ [lit, lit]
// [lighted ham ishlatilishi mumkin, …]" — so scan them all and take the first
// that actually looks like a form list rather than a level tag or a usage note.
function parseForms(body, word) {
  const brackets = [...String(body ?? "").matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());

  for (const inner of brackets) {
    if (/rank|^[a-c][12]\b/i.test(inner)) continue;               // "[A1, Rank 464]"
    if (/^(pl|sing)\./i.test(inner)) return inner;                // "pl. goes"
    if (/^[uc]$/i.test(inner)) continue;                          // [U] / [C]
    // Register / usage labels ("[especially AmE, informal]") are not forms.
    if (/before noun|after|not |only |usually|with|[+~]/i.test(inner)) continue;
    if (/\b(especially|informal|formal|spoken|written|slang|literary|technical|humorous|disapproving|approving|old-fashioned|dated|offensive|BrE|AmE|NAmE|figurative)\b/i.test(inner)) continue;

    let tokens = inner.split(/[,\s]+/).filter(Boolean);
    // Real form lists are short ("goes went gone", "better best"). Anything
    // longer is prose — usually an Uzbek usage note.
    if (tokens.length < 2 || tokens.length > 4) continue;
    if (!tokens.every((t) => /^[A-Za-z'’-]+$/.test(t))) continue;
    if (word && tokens[0].toLowerCase() === word.toLowerCase()) tokens = tokens.slice(1);

    const seen = new Set();
    const forms = tokens.filter((t) => {
      const key = t.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (forms.length) return forms.join(" · ");
  }
  return "";
}

// word_class_body is metadata on a headword ([Rank…] /ipa/ [forms]) but a short
// disambiguation hint on a child sense ("(chiqib)", "[informal]").
function isMetaBody(body) {
  return /rank|\/[^/]+\//i.test(String(body ?? ""));
}
function senseNote(body) {
  const text = String(body ?? "").trim();
  if (!text || isMetaBody(text)) return "";
  return cleanText(text);
}

function findItems(obj) {
  if (Array.isArray(obj)) return obj.filter((x) => x && typeof x === "object");
  if (obj && typeof obj === "object") {
    for (const key of ["items", "data", "results", "words", "catalogue"]) {
      if (key in obj) {
        const found = findItems(obj[key]);
        if (found.length) return found;
      }
    }
    for (const value of Object.values(obj)) {
      const found = findItems(value);
      if (found.length) return found;
    }
  }
  return [];
}

async function apiGet(path, params) {
  const url = new URL(API_BASE + path, location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json, text/plain, */*" },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

function classNameOf(wordClass) {
  if (wordClass && typeof wordClass === "object") return wordClass.word_class || "";
  return "";
}

function translationsOf(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) =>
      item && typeof item === "object"
        ? cleanText(item.word || item.translation || item.translate || item.meaning || item.body)
        : cleanText(item)
    )
    .filter(Boolean);
}

function idOf(item) {
  return item && (item.id || item._id || item.word_id);
}

// Idioms/phrasal verbs. The API repeats a lot of empty sub-entries — keep only
// real phrases (those with a `word`) and dedupe.
function phraseList(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const p of arr) {
    const term = cleanText(p && p.word);
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    const translation = Array.isArray(p.translate)
      ? p.translate.map((t) => cleanText(t && t.value)).filter(Boolean).join(", ")
      : "";
    const example = Array.isArray(p.examples)
      ? cleanExample(p.examples.find((e) => e && e.value)?.value)
      : "";
    out.push({ term, translation, example, star: Number(p.star) || 0 });
  }
  out.sort((a, b) => b.star - a.star);
  return out.slice(0, 12);
}

async function searchApi(word) {
  const json = await apiGet("/catalogue/search", { page: 1, per_page: 100, search: word, order: "asc" });
  return findItems(json);
}

async function detailApi(entryId) {
  const json = await apiGet(`/words/${entryId}/view`);
  return (json && json.data) || {};
}

export async function suggestWords(prefix) {
  const items = await searchApi(prefix);
  const seen = new Set();
  const words = [];
  for (const item of items) {
    const word = normalize(item.word);
    if (word && !seen.has(word)) { seen.add(word); words.push(word); }
  }
  return words.slice(0, 8);
}

/**
 * Returns the word grouped by part of speech — the same shape dictionary.js
 * produces for the free API, so the UI needs no changes:
 *   [{ word_class, pronunciation, forms, senses: [...], phrases: [...] }]
 */
export async function fetchWord(rawWord) {
  const word = normalize(rawWord);
  if (!word) return [];

  const items = await searchApi(word);
  const matches = items.filter((it) => normalize(it.word) === word && idOf(it));
  const searchById = new Map(matches.map((m) => [idOf(m), m]));

  // Highest-importance senses first; cap so a giant word stays bounded.
  const ids = [...new Set(matches.map(idOf))]
    .sort((a, b) => (Number(searchById.get(b)?.star) || 0) - (Number(searchById.get(a)?.star) || 0))
    .slice(0, 40);

  const details = await Promise.all(
    ids.map((id) => detailApi(id).catch((error) => { console.error("detail failed", id, error); return {}; }))
  );
  const detailById = new Map(ids.map((id, i) => [id, details[i]]));

  // Resolve each entry's part of speech (children inherit from their parent).
  function classOf(id, depth = 0) {
    const data = detailById.get(id);
    const own = classNameOf(data?.word?.word_class);
    if (own) return own;
    const parent = data?.word?.parent_word;
    if (parent && detailById.has(parent) && depth < 4) return classOf(parent, depth + 1);
    return classNameOf(searchById.get(id)?.word_class) || "Other";
  }

  const groups = new Map();
  ids.forEach((id) => {
    const data = detailById.get(id) || {};
    const wordObj = data.word || {};
    const searchItem = searchById.get(id) || {};

    let translations = translationsOf(data.translations);
    if (!translations.length) translations = translationsOf(searchItem.translation);
    if (!translations.length) return;

    const cls = classOf(id);
    if (!groups.has(cls)) {
      groups.set(cls, { word_class: cls, pronunciation: "", forms: "", senses: [], phrases: [], _maxStar: -1 });
    }
    const group = groups.get(cls);

    // Headword metadata (pronunciation / forms) comes from the parent body.
    if (isMetaBody(wordObj.word_class_body)) {
      if (!group.pronunciation) group.pronunciation = parseIpa(wordObj.word_class_body);
      if (!group.forms) group.forms = parseForms(wordObj.word_class_body, word);
    }

    const star = Number(wordObj.star ?? searchItem.star) || 0;
    group._maxStar = Math.max(group._maxStar, star);
    group.senses.push({
      translations,
      examples: exampleList(wordObj.examples),
      synonyms: synonymList(wordObj.synonyms),
      note: senseNote(wordObj.word_class_body),
      star,
    });
    group.phrases.push(...phraseList(data.phrases));
  });

  const result = [...groups.values()];
  result.forEach((group) => {
    group.senses.sort((a, b) => b.star - a.star);
    const seen = new Set();
    group.phrases = group.phrases.filter((p) => {
      const key = p.term.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 12);
  });
  result.sort((a, b) => b._maxStar - a._maxStar);
  return result;
}
