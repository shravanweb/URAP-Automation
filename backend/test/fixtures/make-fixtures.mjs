// Regenerates the OCR / document fixtures: node test/fixtures/make-fixtures.mjs
// invoice-sample.png  rendered invoice image (OCR input)
// invoice-text.pdf    PDF with a text layer (read without OCR)
// invoice-scan.pdf    image-only PDF (needs OCR)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
export const INVOICE_LINES = [
  'ACME TRADERS PVT LTD',
  'TAX INVOICE',
  'Invoice No: INV-2026-0042',
  'Invoice Date: 15/09/2026',
  'Due Date: 15/10/2026',
  'GSTIN: 29ABCDE1234F1Z5',
  'Bill To: Globex Retail',
  'Subtotal: 10,000.00',
  'GST 18%: 1,800.00',
  'Total Amount: Rs 11,800.00',
];

const canvas = createCanvas(900, 40 + INVOICE_LINES.length * 46);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.fillStyle = '#000000';
ctx.font = '30px sans-serif';
INVOICE_LINES.forEach((line, index) => ctx.fillText(line, 30, 50 + index * 46));
const png = canvas.toBuffer('image/png');
await fs.writeFile(path.join(here, 'invoice-sample.png'), png);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<html><body style="font-family:sans-serif;font-size:18px">${INVOICE_LINES.map((line) => `<p>${line}</p>`).join('')}</body></html>`);
await fs.writeFile(path.join(here, 'invoice-text.pdf'), await page.pdf({ format: 'A4' }));
await page.setContent(`<html><body style="margin:0"><img style="width:100%" src="data:image/png;base64,${png.toString('base64')}"></body></html>`);
await fs.writeFile(path.join(here, 'invoice-scan.pdf'), await page.pdf({ format: 'A4' }));
await browser.close();
console.log('fixtures written');
