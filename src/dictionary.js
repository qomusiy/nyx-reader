const API_BASE = "https://new-api.wisdomedu.uz/api/v1";

function normalize(word) {
  return String(word ?? "").trim().replace(/^["']+|["']+$/g, "").toLowerCase();
}

function cleanText(value) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text || (!text.includes("<") && !text.includes(">"))) return text;
  const doc = new DOMParser().parseFromString(text, "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
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
    headers: {
      Accept: "application/json, text/plain, */*",
    },
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

export async function fetchWord(rawWord) {
  const word = normalize(rawWord);
  if (!word) return [];

  const items = await searchApi(word);
  const matches = items.filter((it) => normalize(it.word) === word && idOf(it));
  const ids = [...new Set(matches.map(idOf))];

  const rows = [];
  for (const id of ids) {
    let data = {};
    try {
      data = await detailApi(id);
    } catch (error) {
      console.error("detail failed", id, error);
    }
    const wordObj = data.word || {};
    const searchItem = matches.find((m) => idOf(m) === id) || {};

    let translations = translationsOf(data.translations);
    if (!translations.length) translations = translationsOf(searchItem.translation);
    if (!translations.length) continue;

    const examples = (Array.isArray(wordObj.examples) ? wordObj.examples : [])
      .map(cleanText)
      .filter(Boolean);

    rows.push({
      entry_id: id,
      word_class: classNameOf(wordObj.word_class) || classNameOf(searchItem.word_class) || "Other",
      word_level: wordObj.word_level || searchItem.word_level || "",
      pronunciation:
        wordObj.pronunciation || wordObj.transcription || wordObj.phonetics || wordObj.ipa || "",
      translations: translations.join("\x1f"),
      examples: examples.join("\n"),
    });
  }
  return rows;
}
