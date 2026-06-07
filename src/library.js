// Built-in starter library. This module is the ONLY thing about these books
// that loads on page start — just titles and metadata (a few hundred bytes).
// The actual .epub bytes live in public/ebooks/ and are fetched lazily, one at
// a time, the moment a reader clicks a book (see openBuiltin in main.js). No
// book is downloaded until it is opened; the others stay untouched.
//
// `size` is the exact byte length of each file. It lets us recognise a book we
// already cached in IndexedDB (recent.js keys by name::size::lastModified) and
// reopen it straight from local storage — offline, with zero re-download.

const BASE = `${import.meta.env.BASE_URL}ebooks/`;
const PICS = `${import.meta.env.BASE_URL}book-pics/`;

export const BUILTIN_BOOKS = [
  { file: "almanack-of-naval-ravikant.epub", size: 1042074, kind: "epub",
    title: "The Almanack of Naval Ravikant", author: "Eric Jorgenson", pic: "Almanak.jpg" },
  { file: "crime-and-punishment.epub", size: 783869, kind: "epub",
    title: "Crime and Punishment", author: "Fyodor Dostoyevsky", pic: "crime_and_panishment.jpeg" },
  { file: "nineteen-eighty-four.epub", size: 945054, kind: "epub",
    title: "Nineteen Eighty-Four", author: "George Orwell", pic: "1984.jpg" },
  { file: "frankenstein.epub", size: 690825, kind: "epub",
    title: "Frankenstein", author: "Mary Shelley", pic: "frankenshtain.jpeg" },
  { file: "the-time-machine.epub", size: 307152, kind: "epub",
    title: "The Time Machine", author: "H. G. Wells", pic: "time_machine2.jpeg" },
  { file: "meditations.epub", size: 273387, kind: "epub",
    title: "Meditations", author: "Marcus Aurelius", pic: "meditations.jpg" },
].map((b) => ({
  ...b,
  url: BASE + encodeURIComponent(b.file),
  cover: PICS + encodeURIComponent(b.pic),
}));
