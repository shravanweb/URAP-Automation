// Document Understanding: rule-based key field extraction with confidence scores.
//
// A field is found by label-anchored patterns ("Invoice No: INV-1"), then generic patterns.
// confidence = patternScore x ocrFactor x validationFactor x ambiguityFactor, from 0 to 1:
//   patternScore      0.95 for the first label, a little lower for later labels, 0.6 for fallbacks
//   ocrFactor         OCR confidence of the line the value came from (1 for PDF text layers)
//   validationFactor  1 when the value parses as its type (date, amount...), 0.6 when it does not
//   ambiguityFactor   0.85 when labelled matches disagree
import { AppError } from '../../lib/errors.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const CURRENCY_SYMBOLS = { '₹': 'INR', 'rs': 'INR', 'rs.': 'INR', '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
const CURRENCY_CODES = ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'AED', 'JPY', 'CHF', 'CNY', 'NZD', 'ZAR'];

export const VALUE_PATTERNS = {
  id: String.raw`(?=[A-Z0-9\-/_.#]*\d)[A-Z0-9][A-Z0-9\-/_.#]{0,40}`,
  string: String.raw`[^\n]{1,120}`,
  amount: String.raw`(?:(?:[A-Z]{3}|Rs\.?|[₹$€£¥])\s?)?-?\d{1,3}(?:[,\s]\d{2,3})*(?:\.\d{1,2})?(?!\d)|(?:(?:[A-Z]{3}|Rs\.?|[₹$€£¥])\s?)?-?\d+(?:[.,]\d{1,2})?`,
  number: String.raw`-?\d+(?:[.,]\d+)?`,
  date: String.raw`\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?[\s\-]+[A-Za-z]{3,9}\.?,?[\s\-]+\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}`,
  email: String.raw`[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}`,
  gstin: String.raw`\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]`,
  percent: String.raw`\d{1,3}(?:\.\d{1,2})?\s?%`,
};

const FIELD_LIBRARY = {
  invoiceNumber: { type: 'id', labels: ['invoice number', 'invoice no', 'invoice #', 'inv no', 'inv #', 'bill number', 'bill no', 'invoice'] },
  invoiceDate: { type: 'date', labels: ['invoice date', 'date of issue', 'issue date', 'bill date', 'dated', 'date'] },
  dueDate: { type: 'date', labels: ['due date', 'payment due', 'due by', 'pay by'] },
  poNumber: { type: 'id', labels: ['purchase order number', 'purchase order', 'po number', 'po no', 'p.o. no', 'p.o.', 'order number', 'order no'] },
  totalAmount: { type: 'amount', pick: 'last', labels: ['grand total', 'total amount due', 'amount due', 'balance due', 'total due', 'invoice total', 'total amount', 'net payable', 'amount payable', 'total'] },
  subtotal: { type: 'amount', labels: ['sub total', 'subtotal', 'sub-total', 'taxable value', 'taxable amount', 'net amount'] },
  taxAmount: { type: 'amount', labels: ['total tax', 'tax amount', 'total gst', 'igst', 'cgst', 'sgst', 'gst', 'vat', 'tax'] },
  vendorName: { type: 'string', labels: ['vendor', 'supplier', 'seller', 'sold by', 'billed by', 'from'], fallback: 'firstLine' },
  merchantName: { type: 'string', labels: ['merchant', 'store', 'shop'], fallback: 'firstLine' },
  receiptDate: { type: 'date', labels: ['date', 'txn date', 'transaction date'] },
  vendorGstin: { type: 'gstin', labels: ['supplier gstin', 'seller gstin', 'gstin', 'gst no', 'gst number'], fallback: 'pattern' },
  email: { type: 'email', labels: ['email', 'e-mail'], fallback: 'pattern' },
  currency: { type: 'currency' },
};

export const TEMPLATES = {
  invoice: {
    label: 'Invoice',
    fields: [
      { name: 'invoiceNumber', required: true },
      { name: 'invoiceDate', required: true },
      { name: 'dueDate' },
      { name: 'poNumber' },
      { name: 'vendorName' },
      { name: 'vendorGstin' },
      { name: 'subtotal' },
      { name: 'taxAmount' },
      { name: 'totalAmount', required: true },
      { name: 'currency' },
      { name: 'email' },
    ],
  },
  receipt: {
    label: 'Receipt',
    fields: [
      { name: 'merchantName', required: true },
      { name: 'receiptDate', required: true },
      { name: 'taxAmount' },
      { name: 'totalAmount', required: true },
      { name: 'currency' },
    ],
  },
  purchase_order: {
    label: 'Purchase order',
    fields: [
      { name: 'poNumber', required: true },
      { name: 'invoiceDate', required: true, alias: 'orderDate' },
      { name: 'vendorName' },
      { name: 'totalAmount', required: true },
      { name: 'currency' },
    ],
  },
};

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function labelRegex(label) {
  // Words may be separated by spaces, dots, or hyphens; "sub total" must not match plain "total".
  const words = String(label).trim().split(/\s+/).map(escapeRegex);
  const body = words.join(String.raw`[\s.\-]*`);
  const guard = /^total/i.test(label) ? String.raw`(?<!sub[\s\-]?)` : '';
  return `${guard}(?<![A-Za-z])${body}(?![A-Za-z])`;
}

export function parseAmount(raw) {
  if (raw == null) return null;
  let text = String(raw).trim().replace(/^(?:[A-Z]{3}|Rs\.?|[₹$€£¥])\s?/i, '').replace(/\s/g, '');
  const negative = text.startsWith('-') || /^\(.*\)$/.test(text);
  text = text.replace(/[()\-]/g, '');
  if (!/^\d[\d.,]*$/.test(text)) return null;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastDot > lastComma) text = text.replace(/,/g, '');
    else text = text.replace(/\./g, '').replace(',', '.');
  } else if (lastComma > -1) {
    if (/^\d{1,3}(,\d{2,3})+$/.test(text) && !/,\d{2}$/.test(text.replace(/^\d{1,3}(,\d{3})+$/, ''))) text = text.replace(/,/g, '');
    else if (/,\d{1,2}$/.test(text) && text.split(',').length === 2) text = text.replace(',', '.');
    else text = text.replace(/,/g, '');
  }
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

export function parseDate(raw, order = 'DMY') {
  if (!raw) return null;
  const text = String(raw).trim().replace(/(\d)(st|nd|rd|th)/i, '$1');
  let year; let month; let day;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) [, year, month, day] = match.map(Number);
  if (!match) {
    match = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
    if (match) {
      const a = Number(match[1]); const b = Number(match[2]);
      year = Number(match[3]);
      if (order === 'MDY' && a <= 12) { month = a; day = b; } else if (a > 12) { day = a; month = b; } else if (b > 12) { month = a; day = b; } else { day = a; month = b; }
    }
  }
  if (!match) {
    match = text.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3,9})\.?,?[\s\-]+(\d{2,4})$/);
    if (match) { day = Number(match[1]); month = MONTHS[match[2].slice(0, 4).toLowerCase()] || MONTHS[match[2].slice(0, 3).toLowerCase()]; year = Number(match[3]); }
  }
  if (!match) {
    match = text.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
    if (match) { month = MONTHS[match[1].slice(0, 4).toLowerCase()] || MONTHS[match[1].slice(0, 3).toLowerCase()]; day = Number(match[2]); year = Number(match[3]); }
  }
  if (!match || !month || !day || !year) return null;
  if (year < 100) year += 2000;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function normalize(type, raw, options) {
  const text = String(raw ?? '').trim();
  if (type === 'amount') { const value = parseAmount(text); return { value, valid: value !== null }; }
  if (type === 'number') { const value = Number(text.replace(',', '.')); return { value: Number.isFinite(value) ? value : null, valid: Number.isFinite(value) }; }
  if (type === 'date') { const value = parseDate(text, options.dateOrder); return { value: value || text, valid: Boolean(value) }; }
  if (type === 'email') return { value: text.toLowerCase(), valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) };
  if (type === 'gstin') return { value: text.toUpperCase(), valid: new RegExp(`^${VALUE_PATTERNS.gstin}$`).test(text.toUpperCase()) };
  if (type === 'id') return { value: text.replace(/[.,;:]+$/, ''), valid: /\d/.test(text) };
  return { value: text.replace(/\s{2,}/g, ' '), valid: text.length > 0 };
}

function lineConfidence(raw, lines, fallback) {
  if (!lines?.length) return fallback;
  const needle = String(raw).trim().toLowerCase();
  const line = lines.find((item) => String(item.text).toLowerCase().includes(needle));
  return line && Number.isFinite(line.confidence) ? line.confidence : fallback;
}

function compileCustom(pattern) {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 300) throw new AppError(400, 'VALIDATION', 'Custom patterns must be 1 to 300 characters');
  try {
    return new RegExp(pattern, 'gim');
  } catch (error) {
    throw new AppError(400, 'VALIDATION', `Invalid pattern ${pattern}: ${error.message}`);
  }
}

function detectCurrency(text) {
  const code = new RegExp(`\\b(${CURRENCY_CODES.join('|')})\\b`).exec(text);
  if (code) return { raw: code[1], value: code[1], score: 0.9 };
  const symbol = /(₹|Rs\.?(?=\s?\d)|\$|€|£|¥)/i.exec(text);
  if (symbol) {
    const value = CURRENCY_SYMBOLS[symbol[1].toLowerCase()] || CURRENCY_SYMBOLS[symbol[1]];
    // ₹ and Rs only mean INR; $ and ¥ are shared by several currencies.
    return { raw: symbol[1], value, score: value === 'INR' || value === 'EUR' || value === 'GBP' ? 0.88 : 0.7 };
  }
  return null;
}

function findField(text, field, options) {
  const type = field.type || 'string';
  if (type === 'currency') {
    const found = detectCurrency(text);
    return found ? { ...found, valid: true, label: null, ambiguous: false } : null;
  }
  const valuePattern = VALUE_PATTERNS[type] || VALUE_PATTERNS.string;
  const candidates = [];
  if (field.pattern) {
    const regex = compileCustom(field.pattern);
    for (const match of text.matchAll(regex)) {
      const raw = match.groups?.value ?? match[1] ?? match[0];
      if (raw) candidates.push({ raw, score: 0.9, label: 'pattern', index: match.index });
      if (candidates.length > 50) break;
    }
  }
  const labels = field.labels || (field.label ? [field.label] : []);
  labels.forEach((label, position) => {
    const separator = type === 'amount'
      ? String.raw`\s*(?:@?\s*\(?\d{1,2}(?:\.\d{1,2})?\s?%\)?)?\s*[:#\-–]?\s*`
      : String.raw`\s*(?:no\.?|number|#)?\s*[:#\-–]?\s*`;
    const regex = new RegExp(`${labelRegex(label)}${type === 'string' ? String.raw`[ \t]*[:\-–][ \t]*` : separator}(${valuePattern})`, 'gim');
    for (const match of text.matchAll(regex)) {
      // Earlier labels are more specific; a bare one-word label such as "total" or "tax" scores lowest.
      const generic = !/\s/.test(label) && labels.length > 1 && position === labels.length - 1;
      candidates.push({ raw: match[1], score: generic ? 0.8 : 0.95 - Math.min(position, 5) * 0.02, label, index: match.index });
      if (candidates.length > 50) break;
    }
  });
  if (!candidates.length && field.fallback === 'pattern') {
    const regex = new RegExp(`(${valuePattern})`, 'gi');
    const match = regex.exec(text);
    if (match) candidates.push({ raw: match[1], score: 0.7, label: null, index: match.index });
  }
  if (!candidates.length && field.fallback === 'firstLine') {
    const line = text.split('\n').map((item) => item.trim()).find((item) => /[A-Za-z]{3,}/.test(item) && !/^(tax\s+)?(invoice|receipt|bill|purchase order|statement)\b/i.test(item));
    if (line) candidates.push({ raw: line.slice(0, 120), score: 0.5, label: null, index: text.indexOf(line) });
  }
  if (!candidates.length) return null;
  const best = Math.max(...candidates.map((item) => item.score));
  let pool = candidates.filter((item) => item.score === best);
  if (field.pick === 'last') pool = [pool.sort((a, b) => b.index - a.index)[0]];
  const chosen = pool.sort((a, b) => a.index - b.index)[0];
  const parsed = normalize(type, chosen.raw, options);
  const distinct = new Set(candidates.filter((item) => item.label && item.score === best).map((item) => JSON.stringify(normalize(type, item.raw, options).value)));
  return { raw: chosen.raw.trim(), value: parsed.value, valid: parsed.valid, score: chosen.score, label: chosen.label, ambiguous: distinct.size > 1 };
}

/**
 * Extracts fields from text.
 * options: { documentType: 'invoice'|'receipt'|'purchase_order'|'custom', fields: [...custom],
 *            ocrConfidence (0-100), lines (OCR lines with confidence), minConfidence (0-1), dateOrder }
 * A custom field: { name, type, labels | label | pattern, required, pick: 'first'|'last' }.
 */
export function extractFields(text, options = {}) {
  const source = String(text || '').slice(0, 200000);
  const documentType = options.documentType || (options.fields?.length ? 'custom' : 'invoice');
  if (documentType !== 'custom' && !TEMPLATES[documentType]) throw new AppError(400, 'VALIDATION', `Unknown documentType ${documentType}`);
  const minConfidence = Number.isFinite(Number(options.minConfidence)) ? Number(options.minConfidence) : 0.8;
  const ocrConfidence = Number.isFinite(Number(options.ocrConfidence)) ? Number(options.ocrConfidence) : 100;
  const definitions = [];
  if (documentType !== 'custom') {
    for (const item of TEMPLATES[documentType].fields) definitions.push({ ...FIELD_LIBRARY[item.name], name: item.alias || item.name, required: Boolean(item.required) });
  }
  for (const field of options.fields || []) {
    if (!field?.name || !/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(field.name)) throw new AppError(400, 'VALIDATION', 'Each custom field needs a name made of letters, digits, or _');
    if (!field.pattern && !field.label && !field.labels?.length) throw new AppError(400, 'VALIDATION', `Field ${field.name} needs a label, labels, or pattern`);
    if (field.type && !['string', 'id', 'amount', 'number', 'date', 'email', 'gstin', 'percent', 'currency'].includes(field.type)) throw new AppError(400, 'VALIDATION', `Field ${field.name} has unknown type ${field.type}`);
    const index = definitions.findIndex((item) => item.name === field.name);
    const definition = { type: 'string', ...field, required: Boolean(field.required) };
    if (index >= 0) definitions[index] = definition; else definitions.push(definition);
  }
  const fields = {};
  const values = {};
  const missing = [];
  const lowConfidence = [];
  for (const definition of definitions) {
    const found = findField(source, definition, { dateOrder: options.dateOrder === 'MDY' ? 'MDY' : 'DMY' });
    if (!found || found.value === null || found.value === '') {
      fields[definition.name] = null;
      values[definition.name] = null;
      if (definition.required) missing.push(definition.name);
      continue;
    }
    const ocr = lineConfidence(found.raw, options.lines, ocrConfidence) / 100;
    const confidence = Math.round(found.score * Math.min(Math.max(ocr, 0), 1) * (found.valid ? 1 : 0.6) * (found.ambiguous ? 0.85 : 1) * 100) / 100;
    fields[definition.name] = { value: found.value, raw: found.raw, confidence, label: found.label, valid: found.valid };
    values[definition.name] = found.value;
    if (confidence < minConfidence) lowConfidence.push(definition.name);
  }
  const scored = definitions.filter((item) => item.required && fields[item.name]).map((item) => fields[item.name].confidence);
  const confidence = scored.length ? Math.round((scored.reduce((sum, value) => sum + value, 0) / scored.length) * 100) / 100 : 0;
  return {
    documentType,
    fields,
    values,
    missing,
    lowConfidence,
    confidence,
    minConfidence,
    needsReview: missing.length > 0 || lowConfidence.some((name) => definitions.find((item) => item.name === name)?.required),
  };
}
