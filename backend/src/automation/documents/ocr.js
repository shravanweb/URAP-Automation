// OCR with tesseract.js. PDFs use their text layer when a page has one and are rendered and
// OCRed page by page when it does not (scanned documents). Workers are cached per language and
// stopped after a minute without use.
//
// Language data: tesseract.js downloads <lang>.traineddata on first use and caches it in
// OCR_CACHE_PATH (default data/ocr-cache). For offline machines, put the .traineddata files in a
// folder and set OCR_LANG_PATH to it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../lib/errors.js';
import { openPdf } from './pdf.js';

const IMAGE_TYPES = ['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.webp', '.gif', '.pbm'];
const workers = new Map();

function normalizeLanguage(value) {
  const language = String(value || 'eng').trim();
  if (!/^[a-z_]{3,10}(\+[a-z_]{3,10}){0,3}$/i.test(language)) throw new AppError(400, 'VALIDATION', 'language must be like eng or eng+hin');
  return language;
}

async function getWorker(language, options) {
  let entry = workers.get(language);
  if (!entry) {
    const { createWorker } = await import('tesseract.js');
    const workerOptions = { cachePath: options.cachePath };
    if (options.langPath) workerOptions.langPath = options.langPath;
    entry = { promise: createWorker(language, 1, workerOptions), timer: null };
    workers.set(language, entry);
  }
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => { stopWorker(language).catch(() => {}); }, 60_000);
  entry.timer.unref?.();
  try {
    return await entry.promise;
  } catch (error) {
    workers.delete(language);
    throw new AppError(500, 'OCR_UNAVAILABLE', `OCR engine could not start for ${language}: ${error.message}. If this machine is offline, set OCR_LANG_PATH to a folder with ${language}.traineddata.`);
  }
}

async function stopWorker(language) {
  const entry = workers.get(language);
  if (!entry) return;
  workers.delete(language);
  clearTimeout(entry.timer);
  const worker = await entry.promise.catch(() => null);
  await worker?.terminate();
}

export async function stopOcrWorkers() {
  for (const language of [...workers.keys()]) await stopWorker(language);
}

async function recognize(image, language, options) {
  const worker = await getWorker(language, options);
  const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
  const lines = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        lines.push({ text: line.text.trim(), confidence: Math.round(line.confidence), bbox: line.bbox });
      }
    }
  }
  return { text: String(data.text || '').trim(), confidence: Math.round(data.confidence ?? 0), lines: lines.filter((line) => line.text) };
}

/**
 * OCR an image or PDF file. Returns
 * { text, confidence (0-100), pageCount, pages: [{ page, text, confidence, source }], lines }.
 * source is "text-layer" for PDF pages with embedded text and "ocr" otherwise.
 */
export async function ocrFile(file, config = {}, options = {}) {
  const language = normalizeLanguage(config.language);
  const extension = path.extname(file).toLowerCase();
  const data = await fs.readFile(file);
  const ocrOptions = { cachePath: options.cachePath, langPath: options.langPath };
  const pages = [];
  const lines = [];
  let pageCount = 1;
  if (extension === '.pdf') {
    const pdf = await openPdf(data, { pages: config.pages });
    pageCount = pdf.pageCount;
    const minChars = Number.isFinite(Number(config.minTextChars)) ? Number(config.minTextChars) : 20;
    try {
      for (const page of pdf.selected) {
        const text = config.forceOcr ? '' : await pdf.text(page);
        if (text.replace(/\s/g, '').length >= minChars) {
          pages.push({ page, text, confidence: 99, source: 'text-layer' });
        } else {
          const image = await pdf.renderPng(page, Math.min(Math.max(Number(config.scale) || 2, 1), 4));
          const result = await recognize(image, language, ocrOptions);
          pages.push({ page, text: result.text, confidence: result.confidence, source: 'ocr' });
          lines.push(...result.lines.map((line) => ({ ...line, page })));
        }
      }
    } finally {
      await pdf.close();
    }
  } else if (IMAGE_TYPES.includes(extension)) {
    const result = await recognize(data, language, ocrOptions);
    pages.push({ page: 1, text: result.text, confidence: result.confidence, source: 'ocr' });
    lines.push(...result.lines.map((line) => ({ ...line, page: 1 })));
  } else {
    throw new AppError(400, 'UNSUPPORTED_FILE', `OCR supports PDF and ${IMAGE_TYPES.join(', ')} files`);
  }
  const totalChars = pages.reduce((sum, page) => sum + page.text.length, 0);
  const confidence = totalChars
    ? Math.round(pages.reduce((sum, page) => sum + page.confidence * page.text.length, 0) / totalChars)
    : 0;
  return {
    text: pages.map((page) => page.text).join('\n\n'),
    confidence,
    language,
    pageCount,
    pages,
    lines: lines.slice(0, 2000),
  };
}
