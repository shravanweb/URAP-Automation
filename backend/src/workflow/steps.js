import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import { AppError } from '../lib/errors.js';
import { resolveInside } from '../lib/paths.js';
import { extractPdfLiteralText } from '../lib/pdfText.js';
import { extractPdfText } from '../automation/documents/pdf.js';
import { extractFields } from '../automation/documents/extraction.js';
import { DESKTOP_STEP_TYPES, SHEETS_STEP_TYPES, WEB_STEP_TYPES } from './constants.js';
import { compareValues, resolveTemplates } from './expressions.js';

function suspendFor(taskId) {
  const error = new Error('Waiting for an Action Center task');
  error.suspend = { taskId };
  return error;
}

function rowsFromSheet(sheet) {
  const rows = [];
  let headers = [];
  sheet.eachRow((row, index) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    if (index === 1) {
      headers = values.map((value) => String(value ?? '').trim());
      return;
    }
    const record = {};
    headers.forEach((header, headerIndex) => {
      if (header) record[header] = values[headerIndex] ?? null;
    });
    rows.push(record);
  });
  return rows;
}

function applyTransform(rows, operations) {
  let current = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  for (const operation of operations || []) {
    if (operation.op === 'filter') {
      current = current.filter((row) => compareValues(row?.[operation.field], operation.operator || 'eq', operation.value));
    } else if (operation.op === 'pick') {
      current = current.map((row) => {
        const next = {};
        for (const field of operation.fields || []) next[field] = row[field];
        return next;
      });
    } else if (operation.op === 'rename') {
      current = current.map((row) => {
        const next = { ...row };
        next[operation.to] = next[operation.from];
        delete next[operation.from];
        return next;
      });
    } else if (operation.op === 'map') {
      current = current.map((row) => {
        const next = { ...row };
        const value = next[operation.field];
        if (operation.fn === 'trim') next[operation.field] = String(value ?? '').trim();
        else if (operation.fn === 'upper') next[operation.field] = String(value ?? '').toUpperCase();
        else if (operation.fn === 'lower') next[operation.field] = String(value ?? '').toLowerCase();
        else if (operation.fn === 'number') next[operation.field] = Number(value);
        else if (operation.fn === 'string') next[operation.field] = value == null ? '' : String(value);
        else throw new AppError(400, 'VALIDATION', `Unsupported transform function ${operation.fn}`);
        return next;
      });
    } else {
      throw new AppError(400, 'VALIDATION', `Unsupported transform operation ${operation.op}`);
    }
  }
  return current;
}

function checkValue(value, check, rule) {
  if (check === 'required') return !(value == null || value === '');
  if (check === 'number') return typeof value === 'number' && !Number.isNaN(value);
  if (check === 'string') return typeof value === 'string';
  if (check === 'boolean') return typeof value === 'boolean';
  if (check === 'email') return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (check === 'min') return Number(value) >= Number(rule.min);
  if (check === 'max') return Number(value) <= Number(rule.max);
  if (check === 'minLength') return String(value ?? '').length >= Number(rule.minLength);
  if (check === 'maxLength') return String(value ?? '').length <= Number(rule.maxLength);
  if (check === 'enum') return (rule.values || []).includes(value);
  if (check === 'pattern') {
    if (typeof rule.pattern !== 'string' || rule.pattern.length > 80) {
      throw new AppError(400, 'VALIDATION', 'Validation patterns are limited to 80 characters');
    }
    const pattern = new RegExp(rule.pattern);
    return pattern.test(String(value ?? ''));
  }
  throw new AppError(400, 'VALIDATION', `Unsupported validation check ${check}`);
}

async function readWorkbook(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  return workbook;
}

export async function executeStep(step, context, services) {
  const config = resolveTemplates(step.config || {}, context);
  const storage = services.storageRoot;
  if (step.type === 'start') return { input: context.input };
  if (step.type === 'end') {
    const selected = config.summaryFrom || Object.keys(context.steps);
    const summary = {};
    for (const id of selected) summary[id] = context.steps[id];
    return { summary };
  }
  if (step.type === 'read_csv') {
    const file = resolveInside(storage, config.path);
    const text = await fs.readFile(file);
    const rows = parse(text, { columns: true, skip_empty_lines: true, bom: true, delimiter: config.delimiter || ',' });
    return { rows, count: rows.length };
  }
  if (step.type === 'read_excel') {
    const file = resolveInside(storage, config.path);
    const workbook = await readWorkbook(file);
    const sheet = config.sheet ? workbook.getWorksheet(config.sheet) : workbook.worksheets[0];
    if (!sheet) throw new AppError(400, 'SHEET_NOT_FOUND', 'Workbook sheet was not found');
    const rows = rowsFromSheet(sheet);
    return { rows, count: rows.length, sheet: sheet.name };
  }
  if (step.type === 'read_pdf_text') {
    const file = resolveInside(storage, config.path);
    const data = await fs.readFile(file);
    let text;
    let pageCount = null;
    try {
      const result = await extractPdfText(data, { pages: config.pages });
      text = result.text;
      pageCount = result.pageCount;
    } catch {
      text = extractPdfLiteralText(data);
    }
    return { text, length: text.length, pageCount };
  }
  if (step.type === 'transform_data') {
    const rows = applyTransform(config.source, config.operations);
    return { rows, count: rows.length };
  }
  if (step.type === 'validate_data') {
    const source = Array.isArray(config.source) ? config.source : [];
    const valid = [];
    const invalid = [];
    for (const row of source) {
      const failures = [];
      for (const rule of config.rules || []) {
        for (const check of rule.checks || []) {
          if (!checkValue(row?.[rule.field], check, rule)) failures.push({ field: rule.field, check });
        }
      }
      if (failures.length) invalid.push({ row, failures });
      else valid.push(row);
    }
    if (config.mode === 'fail_workflow' && invalid.length) {
      throw new AppError(422, 'VALIDATION_FAILED', `${invalid.length} row(s) failed validation`);
    }
    return { valid, invalid, validCount: valid.length, invalidCount: invalid.length };
  }
  if (step.type === 'find_duplicates') {
    const source = Array.isArray(config.source) ? config.source : [];
    const seen = new Map();
    const duplicates = [];
    const rows = source.map((row) => {
      const key = (config.keys || []).map((field) => String(row?.[field] ?? '')).join('|');
      const duplicate = seen.has(key);
      seen.set(key, (seen.get(key) || 0) + 1);
      const next = { ...row, _duplicate: duplicate };
      if (duplicate) duplicates.push(next);
      return next;
    });
    return { rows, duplicates, duplicateCount: duplicates.length };
  }
  if (step.type === 'if_else') {
    const passed = compareValues(config.left, config.operator, config.right);
    return { passed, next: passed ? step.config.whenTrue : step.config.whenFalse };
  }
  if (step.type === 'for_each') return { count: Array.isArray(config.source) ? config.source.length : 0 };
  if (step.type === 'http_request') return services.httpRequest(config);
  if (step.type === 'database_query') return services.databaseQuery(config);
  if (step.type === 'file_operation') return services.fileOperation(config);
  if (step.type === 'browser_ui_action' || step.type === 'uipath_workflow') {
    return services.robotTask({
      task: config.task,
      input: config.input || {},
      connectionId: config.connectionId || null,
    });
  }
  if (step.type === 'write_excel') {
    const file = resolveInside(storage, config.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const workbook = new ExcelJS.Workbook();
    const sheets = config.sheets?.length ? config.sheets : [{ name: 'Data', rows: config.rows || [] }];
    for (const item of sheets) {
      const sheet = workbook.addWorksheet(String(item.name || 'Data').slice(0, 31));
      const rows = Array.isArray(item.rows) ? item.rows : [];
      const headers = rows.length ? Object.keys(rows[0]) : [];
      sheet.addRow(headers);
      for (const row of rows) sheet.addRow(headers.map((header) => row[header]));
    }
    await workbook.xlsx.writeFile(file);
    return { path: config.path, bytes: (await fs.stat(file)).size };
  }
  if (step.type === 'write_csv') {
    const file = resolveInside(storage, config.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const rows = Array.isArray(config.rows) ? config.rows : [];
    const headers = config.columns?.length ? config.columns : (rows.length ? Object.keys(rows[0]) : []);
    const safe = (value) => {
      const text = value == null ? '' : (typeof value === 'object' ? JSON.stringify(value) : String(value));
      return /^[=+\-@]/.test(text) ? `'${text}` : text;
    };
    const text = stringify(rows.map((row) => headers.map((header) => safe(row?.[header]))), {
      header: true, columns: headers, delimiter: config.delimiter || ',',
    });
    await fs.writeFile(file, text, 'utf8');
    return { path: config.path, rows: rows.length, bytes: Buffer.byteLength(text) };
  }
  if (step.type === 'log_message') {
    const level = ['trace', 'info', 'warn', 'error'].includes(config.level) ? config.level : 'info';
    const message = typeof config.message === 'string' ? config.message : JSON.stringify(config.message ?? '');
    return { level, message: message.slice(0, 4000) };
  }
  if (WEB_STEP_TYPES.includes(step.type)) return services.web(step.type, config);
  if (DESKTOP_STEP_TYPES.includes(step.type)) return services.desktop(step.type, config);
  if (step.type === 'ocr_extract') return services.ocr(config);
  if (step.type === 'extract_document_fields') {
    let source = config.source && typeof config.source === 'object' ? config.source : null;
    if (!source && config.path) source = await services.ocr({ path: config.path, language: config.language, pages: config.pages });
    const text = typeof config.text === 'string' && config.text ? config.text : (source?.text ?? (typeof config.source === 'string' ? config.source : ''));
    if (!text) throw new AppError(400, 'VALIDATION', 'extract_document_fields needs text, a source (OCR output), or a path');
    return extractFields(text, {
      documentType: config.documentType,
      fields: config.fields,
      ocrConfidence: config.ocrConfidence ?? source?.confidence,
      lines: source?.lines,
      minConfidence: config.minConfidence,
      dateOrder: config.dateOrder,
    });
  }
  if (step.type === 'create_task' || step.type === 'wait_for_task') {
    const wait = step.type === 'wait_for_task' || config.waitForCompletion !== false;
    if (wait && ((context.__loopDepth || 0) > 0 || (context.__depth || 0) > 0)) {
      throw new AppError(400, 'SUSPEND_NOT_ALLOWED', 'Waiting for an Action Center task only works at the top level of a workflow, not inside a loop or sub-workflow. Create the task with waitForCompletion: false and use Wait For Task after the loop.');
    }
    const task = step.type === 'create_task' ? await services.createTask(config, step.id) : await services.getTask(config.taskId);
    if (!wait) return { taskId: task.taskId, status: task.status };
    if (task.status === 'completed') return task;
    if (task.status === 'cancelled') throw new AppError(409, 'TASK_CANCELLED', 'The Action Center task was cancelled');
    throw suspendFor(task.taskId);
  }
  if (SHEETS_STEP_TYPES.includes(step.type)) return services.sheets(step.type, config);
  if (step.type === 'add_queue_item') return services.queueAdd(config);
  if (step.type === 'get_queue_item') return services.queueGet(config);
  if (step.type === 'set_queue_item_status') return services.queueSetStatus(config);
  if (step.type === 'send_notification') return services.notify(config);
  if (step.type === 'call_subworkflow') return services.subworkflow(config);
  throw new AppError(400, 'UNKNOWN_STEP', `Unsupported step type ${step.type}`);
}

export { applyTransform };
