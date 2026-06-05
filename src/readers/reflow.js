// Reflowable readers for non-PDF formats. Each one resolves to a sanitized
// HTML string that gets dropped into the in-page reader (#doc-reader), so the
// dictionary tap-to-define, theming and browser find all keep working without
// any format-specific wiring. Heavy parsers (mammoth, epubjs) are imported
// dynamically, so PDF-only users never download them.

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// Plain text / Markdown: keep it simple and safe — split on blank lines into
// paragraphs and preserve single line breaks. (No Markdown formatting, by
// design: zero dependencies and no surprises.)
function textToHtml(text) {
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  return blocks
    .map((block) => `<p>${escapeHtml(block).replaceAll("\n", "<br>")}</p>`)
    .join("\n");
}

// Strip anything executable or external from parsed HTML before we trust it.
function sanitize(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, link, meta, iframe, object, embed").forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((node) => {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) node.removeAttribute(attr.name);
      else if ((name === "href" || name === "src") && value.startsWith("javascript:")) node.removeAttribute(attr.name);
    }
  });
  return doc.body.innerHTML;
}

export async function readText(file) {
  return textToHtml(await file.text());
}

export async function readDocx(file) {
  const mod = await import("mammoth");
  const mammoth = mod.convertToHtml ? mod : mod.default; // CJS interop
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.convertToHtml({ arrayBuffer });
  return sanitize(value || "<p>(This document has no readable text.)</p>");
}

// EPUB: render every spine section to a string, re-parse it as HTML (so the
// XHTML namespace is dropped and `.body` is reliable), inline its images as
// blob URLs, and concatenate into one scrolled document.
export async function readEpub(file) {
  const ePub = (await import("epubjs")).default;
  const book = ePub(await file.arrayBuffer());
  await book.ready;
  const request = book.load.bind(book);

  const blobUrls = [];
  const chapters = [];

  for (const item of book.spine.spineItems) {
    let serialized;
    try {
      // render() resolves with the section serialized as an XML string.
      serialized = await item.render(request);
    } catch (error) {
      console.warn("Skipped EPUB section", item.href, error);
      continue;
    }
    const body = new DOMParser().parseFromString(serialized, "text/html").body;
    if (body && body.textContent.trim()) {
      await inlineImages(book, item, body, blobUrls);
      chapters.push(`<section class="epub-chapter">${body.innerHTML}</section>`);
    }
    if (typeof item.unload === "function") item.unload();
  }

  book.destroy();
  if (!chapters.length) throw new Error("This EPUB has no readable text");
  return { html: sanitize(chapters.join("\n")), cleanup: () => blobUrls.forEach(URL.revokeObjectURL) };
}

async function inlineImages(book, item, body, blobUrls) {
  if (!book.archived || !book.archive) return; // only zip-backed EPUBs have an archive
  const images = [...body.querySelectorAll("img, image")];
  await Promise.all(images.map(async (img) => {
    const raw = img.getAttribute("src") || img.getAttribute("xlink:href") || img.getAttribute("href");
    if (!raw || raw.startsWith("data:") || /^https?:/i.test(raw)) return;
    try {
      // Resolve the image relative to the chapter, as a leading-slash archive
      // path — which is what archive.createUrl/getBlob expects.
      const base = "https://epub.local/" + item.href.replace(/^\//, "");
      const absolute = new URL(raw, base).pathname;
      const url = await book.archive.createUrl(absolute, { base64: false });
      if (url) {
        blobUrls.push(url);
        if (img.tagName.toLowerCase() === "image") { img.removeAttribute("xlink:href"); img.setAttribute("href", url); }
        else img.setAttribute("src", url);
      }
    } catch (error) {
      console.warn("Could not inline EPUB image", raw, error);
    }
  }));
}
