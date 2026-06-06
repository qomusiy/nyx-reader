// The document shown in the Reader when nothing is open — an "about + how to"
// guide that doubles as a live demo of the reader itself (try double-tapping a
// word in it). Rendered into the reflow reader, so it picks up your theme and
// reading-typography settings.

export const GUIDE_HTML = `
<h1>Welcome to Nyx Reader</h1>
<p>A calm, focused place to read — and to learn the language as you go. Open a
PDF, EPUB, Word document or plain text file, and look up any English word the
moment you’re curious about it. This page is itself a document: try
double-tapping a word like <em>serendipity</em> or <em>ephemeral</em> to see it
in action.</p>

<h2>Open a document</h2>
<p>Use <strong>Open</strong> in the left rail, or pick one from your
<strong>Library</strong>. Nyx reads <strong>PDF</strong>, <strong>EPUB</strong>,
<strong>Word (.docx)</strong>, <strong>Markdown</strong> and <strong>text</strong>
files. Everything stays on your device — nothing is uploaded. Your recent files
and where you left off are remembered automatically.</p>

<h2>Look up a word</h2>
<p>Tap a word to see its translation in a small card. Press
<em>Full entry &amp; examples</em> to open the Dictionary panel with senses,
examples, synonyms and phrases — or type a word into the panel’s search box. You
can choose <strong>single&#8209;tap</strong> or <strong>double&#8209;tap</strong>
lookup in <strong>Settings</strong>.</p>

<h2>Highlight &amp; take notes</h2>
<p>Turn on the <strong>highlighter</strong> in the toolbar, pick a color, and
select text to mark it. Your highlights are saved with the document and come
back when you reopen it. It works across formats, not just PDF.</p>

<h2>Build your vocabulary</h2>
<p>When a word is worth keeping, tap the <strong>bookmark</strong> to save it.
Each saved word keeps its translation <em>and</em> the sentence it came from, so
it stays meaningful. Find them all in the <strong>Vocab</strong> section, and
export them to CSV (ready for Anki) whenever you like.</p>

<h2>Make it yours</h2>
<p>In <strong>Settings</strong> you can switch between <strong>Paper</strong>,
<strong>Sepia</strong> and <strong>Night</strong> themes, and — for text formats —
adjust the reading font, size, line spacing and column width until it feels
right. Pinch to zoom on touch devices. Enter <strong>Focus</strong> mode to hide
everything but the page.</p>

<p><em>Ready when you are — open something and start reading.</em></p>
`;
