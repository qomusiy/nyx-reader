const API_BASE = "https://api.dictionaryapi.dev/api/v2/entries/en/";

function normalize(word) {
  return String(word ?? "").trim().replace(/^['"]+|['"]+$/g, "").toLowerCase();
}

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

function cleanExample(value) {
  return decodeHtml(value).replace(/^[•·▪◦\-–—\s]+/, "").trim();
}

function synonymList(arr) {
  const values = Array.isArray(arr) ? arr : [];
  const seen = new Set();
  const out = [];
  for (const item of values) {
    const word = cleanText(item);
    const key = word.toLowerCase();
    if (word && !seen.has(key)) {
      seen.add(key);
      out.push(word);
    }
  }
  return out.slice(0, 10);
}

function cleanPronunciation(entry) {
  if (!entry) return "";
  if (entry.phonetic) return String(entry.phonetic).trim();
  if (Array.isArray(entry.phonetics)) {
    for (const phon of entry.phonetics) {
      if (phon && phon.text) return String(phon.text).trim();
    }
  }
  return "";
}

async function apiGet(word) {
  const url = API_BASE + encodeURIComponent(word);
  const res = await fetch(url, {
    headers: { Accept: "application/json, text/plain, */*" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function suggestWords(prefix) {
  // dictionaryapi.dev does not expose a prefix autocomplete endpoint.
  // Keep the UI working by returning no suggestion list.
  return [];
}

export async function fetchWord(rawWord) {
  const word = normalize(rawWord);
  if (!word) return [];

  const entries = await apiGet(word);
  if (!entries || !Array.isArray(entries)) return [];

  const groups = new Map();

  for (const entry of entries) {
    const pronunciation = cleanPronunciation(entry);
    const meanings = Array.isArray(entry.meanings) ? entry.meanings : [];

    for (const meaning of meanings) {
      const cls = typeof meaning.partOfSpeech === "string" && meaning.partOfSpeech.trim()
        ? meaning.partOfSpeech.trim()
        : "Other";
      if (!groups.has(cls)) {
        groups.set(cls, { word_class: cls, pronunciation, forms: entry.word || "", senses: [], phrases: [], _maxStar: 0 });
      }
      const group = groups.get(cls);
      if (!group.pronunciation) group.pronunciation = pronunciation;

      const meaningSynonyms = synonymList(meaning.synonyms);
      const definitions = Array.isArray(meaning.definitions) ? meaning.definitions : [];
      for (const def of definitions) {
        const translation = cleanText(def.definition || "");
        if (!translation) continue;
        const examples = def.example ? [cleanExample(def.example)] : [];
        const synonyms = [...meaningSynonyms, ...synonymList(def.synonyms)].filter(Boolean).slice(0, 10);
        group.senses.push({
          translations: [translation],
          examples,
          synonyms,
          note: "",
          star: 0,
        });
      }
    }
  }

  return [...groups.values()];
}
