const API_BASE = "https://new-api.wisdomedu.uz/api/v1";

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
  const doc = new DOMParser().parseFromString(text, "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

function cleanText(value) {
  return decodeHtml(value);
}

// Example sentences arrive as HTML with a leading "•" bullet — strip both.
function cleanExample(value) {
  return decodeHtml(value).replace(/^[•·▪◦\-–—\s]+/, "").trim();
}

// "<p>move,&nbsp;travel,&nbsp;…</p>" -> ["move", "travel", …] (deduped, capped).
function synonymList(html) {
  const text = decodeHtml(html);
  if (!text) return [];
  const seen = new Set();
  const out = [];
  for (const raw of text.split(/[,;]/)) {
    const word = raw.replace(/\[[^\]]*\]/g, "").trim();
    const key = word.toLowerCase();
    if (word && !seen.has(key)) { seen.add(key); out.push(word); }
  }
  return out.slice(0, 10);
}

// Pull the IPA between slashes out of word_class_body ("[A1, Rank 35] /ɡəʊ/ …").
function parseIpa(body) {
  const match = String(body ?? "").match(/\/[^/]+\//);
  return match ? match[0] : "";
}

// Pull irregular forms out of the trailing bracket: [goes, went, gone] / [better, best].
function parseForms(body, word) {
  const match = String(body ?? "").match(/\[([^\]]+)\]\s*$/);
  if (!match) return "";
  const inner = match[1].trim();
  if (/^(pl|sing)\./i.test(inner)) return inner;                 // "pl. goes"
  if (/^[uc]$/i.test(inner)) return "";                          // [U] / [C]
  if (/before noun|after|not |only |usually|with|[+~]/i.test(inner)) return ""; // usage notes
  let tokens = inner.split(/[,\s]+/).filter(Boolean);
  if (tokens.length < 2) return "";
  if (!tokens.every((t) => /^[A-Za-z'’-]+$/.test(t))) return ""; // forms are plain words
  if (word && tokens[0].toLowerCase() === word.toLowerCase()) tokens = tokens.slice(1);
  return tokens.join(" · ");
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
  const url = new URL(API_BASE + path);
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
  const json = await apiGet("/catalogue/search", {
    page: 1,
    per_page: 100,
    search: word,
    order: "asc",
  });
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
    if (word && !seen.has(word)) {
      seen.add(word);
      words.push(word);
    }
  }
  return words.slice(0, 8);
}

/**
 * Returns the word grouped by part of speech:
 *   [{ word_class, pronunciation, forms, senses: [{translations, examples, synonyms, note}], phrases: [...] }]
 *
 * A headword (e.g. "go" verb) is a parent; its child senses share the parent's
 * part of speech, so we fetch every exact match and regroup children under their
 * parent's class via `parent_word`.
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
      examples: (Array.isArray(wordObj.examples) ? wordObj.examples : []).map(cleanExample).filter(Boolean),
      synonyms: synonymList(wordObj.synonyms),
      note: senseNote(wordObj.word_class_body),
      star,
    });
    group.phrases.push(...phraseList(data.phrases));
  });

  const result = [...groups.values()];
  result.forEach((group) => {
    group.senses.sort((a, b) => b.star - a.star);
    // Dedupe phrases gathered across the group's senses.
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
