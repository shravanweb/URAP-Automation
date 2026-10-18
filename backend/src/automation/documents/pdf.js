// PDF text extraction and page rendering with pdfjs-dist. Rendering (for OCR of scanned pages)
// uses @napi-rs/canvas, which ships prebuilt binaries for Windows, macOS, and Linux.
import { AppError } from '../../lib/errors.js';

let pdfjsPromise;
async function pdfjs() {
  pdfjsPromise ||= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

function pageList(pages, total) {
  if (!pages) return Array.from({ length: Math.min(total, 50) }, (_, index) => index + 1);
  const list = Array.isArray(pages) ? pages : String(pages).split(',');
  const result = new Set();
  for (const part of list) {
    const range = String(part).trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!range) throw new AppError(400, 'VALIDATION', `Invalid page selection ${part}`);
    const from = Number(range[1]);
    const to = Number(range[2] || range[1]);
    for (let page = from; page <= Math.min(to, total); page += 1) if (page >= 1) result.add(page);
  }
  return [...result].sort((a, b) => a - b).slice(0, 50);
}

/** Opens a PDF and returns { pageCount, pages: [{ page, text }], render(page) }. */
export async function openPdf(buffer, { pages } = {}) {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => {});
    throw new AppError(400, 'INVALID_PDF', `Could not read the PDF: ${error.message}`);
  }
  const selected = pageList(pages, doc.numPages);
  return {
    pageCount: doc.numPages,
    selected,
    async text(pageNumber) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = '';
      let lastY = null;
      for (const item of content.items) {
        const y = item.transform?.[5];
        if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) text += '\n';
        else if (text && !text.endsWith(' ') && !text.endsWith('\n') && item.str) text += ' ';
        text += item.str;
        if (item.hasEOL) text += '\n';
        lastY = y ?? lastY;
      }
      return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    },
    async renderPng(pageNumber, scale = 2) {
      const { createCanvas } = await import('@napi-rs/canvas');
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      return canvas.toBuffer('image/png');
    },
    close: () => task.destroy(),
  };
}

export async function extractPdfText(buffer, options = {}) {
  const pdf = await openPdf(buffer, options);
  try {
    const pages = [];
    for (const page of pdf.selected) pages.push({ page, text: await pdf.text(page) });
    return { pageCount: pdf.pageCount, pages, text: pages.map((item) => item.text).join('\n\n') };
  } finally {
    await pdf.close();
  }
}
