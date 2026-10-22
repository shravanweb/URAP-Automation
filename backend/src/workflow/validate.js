import { z } from 'zod';
import { DESKTOP_STEP_TYPES, MAX_LOOP_ITERATIONS, SHEETS_STEP_TYPES, STEP_TYPES, WEB_STEP_TYPES } from './constants.js';
import { SELECTOR_TYPES } from '../automation/web/selectors.js';
import { parseHotkey } from '../automation/desktop/keys.js';
import { TEMPLATES } from '../automation/documents/extraction.js';
import { normalizeFormSchema, TASK_PRIORITIES, TASK_TYPES } from '../services/taskService.js';

const hasTemplate = (value) => typeof value === 'string' && value.includes('{{');
const badPath = (value) => typeof value === 'string' && !hasTemplate(value) && (value.split(/[\\/]/).includes('..') || /^([A-Za-z]:|[\\/])/.test(value));

const FORBIDDEN_CONFIG = ['script', 'sql', 'command', 'shell', 'code', 'eval', 'expression'];

const stepSchema = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,78}$/),
  type: z.string(),
  name: z.string().trim().min(1).max(200),
  config: z.record(z.any()).optional().default({}),
  timeoutMs: z.number().int().positive().max(600000).optional(),
  errorPolicy: z.enum(['fail', 'continue']).optional().default('fail'),
  next: z.string().nullable().optional(),
}).strict();

const definitionSchema = z.object({
  schemaVersion: z.literal('1.0'),
  retryPolicy: z.object({
    maxAttempts: z.number().int().min(1).max(5).default(1),
    backoffSeconds: z.number().int().min(0).max(3600).default(0),
  }).default({ maxAttempts: 1, backoffSeconds: 0 }),
  timeoutMs: z.number().int().positive().max(3600000).optional(),
  steps: z.array(stepSchema).min(2).max(200),
}).strict();

function push(errors, path, message) {
  errors.push({ path, message });
}

function references(steps) {
  return new Set(steps.map((step) => step.id));
}

export function validateDefinition(definition, options = {}) {
  const errors = [];
  const parsed = definitionSchema.safeParse(definition);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      push(errors, issue.path.join('.'), issue.message);
    }
    return { valid: false, errors, definition: null };
  }
  const value = parsed.data;
  const ids = references(value.steps);
  if (new Set(value.steps.map((step) => step.id)).size !== value.steps.length) {
    push(errors, 'steps', 'Step ids must be unique');
  }
  const starts = value.steps.filter((step) => step.type === 'start');
  const ends = value.steps.filter((step) => step.type === 'end');
  if (starts.length !== 1) push(errors, 'steps', 'A workflow must contain exactly one start step');
  if (ends.length < 1) push(errors, 'steps', 'A workflow must contain an end step');

  for (const step of value.steps) {
    if (!STEP_TYPES.includes(step.type)) {
      push(errors, step.id, `Unknown step type ${step.type}`);
    }
    for (const key of FORBIDDEN_CONFIG) {
      if (Object.prototype.hasOwnProperty.call(step.config, key)) {
        push(errors, `${step.id}.config.${key}`, 'Arbitrary code and SQL are not allowed');
      }
    }
    if (step.next && !ids.has(step.next)) push(errors, `${step.id}.next`, 'Next step does not exist');
    validateStepConfig(step, ids, errors, options);
  }

  if (starts.length === 1) {
    const visiting = new Set();
    const visited = new Set();
    const walk = (id) => {
      if (!id || visited.has(id)) return;
      if (visiting.has(id)) {
        push(errors, id, 'Workflow graph contains a cycle outside a bounded loop');
        return;
      }
      const step = value.steps.find((item) => item.id === id);
      if (!step) return;
      visiting.add(id);
      if (step.type === 'if_else') {
        walk(step.config.whenTrue);
        walk(step.config.whenFalse);
      } else if (step.type === 'for_each') {
        walk(step.config.bodyStart);
        walk(step.next);
      } else {
        walk(step.next);
      }
      visiting.delete(id);
      visited.add(id);
    };
    walk(starts[0].id);
    if (!ends.some((step) => visited.has(step.id)) && errors.length === 0) {
      push(errors, 'steps', 'No end step is reachable from start');
    }
  }

  return { valid: errors.length === 0, errors, definition: errors.length === 0 ? value : null };
}

function validateStepConfig(step, ids, errors, options) {
  const config = step.config || {};
  const need = (field) => {
    if (config[field] === undefined || config[field] === '') {
      push(errors, `${step.id}.config.${field}`, `${field} is required`);
    }
  };
  if (['http_request', 'database_query', 'file_operation', 'send_notification'].includes(step.type)) {
    if (step.type !== 'send_notification' || config.channel === 'email') need('connectionId');
  }
  if (step.type === 'send_notification' && config.channel === 'email') {
    need('to');
    const attachments = Array.isArray(config.attachments) ? config.attachments : (config.attachments ? [config.attachments] : []);
    if (attachments.length > 10) push(errors, `${step.id}.config.attachments`, 'At most 10 attachments');
  }
  if (step.type === 'browser_ui_action' || step.type === 'uipath_workflow') need('task');
  if (step.type === 'if_else') {
    need('operator');
    need('whenTrue');
    need('whenFalse');
    for (const branch of ['whenTrue', 'whenFalse']) {
      if (config[branch] && !ids.has(config[branch])) {
        push(errors, `${step.id}.config.${branch}`, 'Branch target does not exist');
      }
    }
    const operators = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'empty', 'not_empty'];
    if (config.operator && !operators.includes(config.operator)) {
      push(errors, `${step.id}.config.operator`, 'Unsupported comparison operator');
    }
  }
  if (step.type === 'for_each') {
    need('source');
    need('bodyStart');
    need('bodyEnd');
    if (config.bodyStart && !ids.has(config.bodyStart)) {
      push(errors, `${step.id}.config.bodyStart`, 'Loop body does not exist');
    }
    if (config.bodyEnd && !ids.has(config.bodyEnd)) {
      push(errors, `${step.id}.config.bodyEnd`, 'Loop body end does not exist');
    }
    const max = config.maxIterations;
    if (!Number.isInteger(max) || max < 1 || max > MAX_LOOP_ITERATIONS) {
      push(errors, `${step.id}.config.maxIterations`, `maxIterations must be an integer from 1 to ${MAX_LOOP_ITERATIONS}`);
    }
  }
  if (step.type === 'call_subworkflow') need('workflowId');
  if (['read_csv', 'read_excel', 'read_pdf_text', 'write_excel', 'write_csv'].includes(step.type)) {
    need('path');
    if (typeof config.path === 'string' && !config.path.includes('{{') && (config.path.split(/[\\/]/).includes('..') || /^([A-Za-z]:|[\\/])/.test(config.path))) {
      push(errors, `${step.id}.config.path`, 'File paths must be relative to project storage and cannot contain ..');
    }
  }
  if (step.type === 'log_message') need('message');
  if (WEB_STEP_TYPES.includes(step.type)) validateWebStep(step, config, need, errors);
  if (DESKTOP_STEP_TYPES.includes(step.type)) validateDesktopStep(step, config, need, errors);
  if (step.type === 'ocr_extract') {
    need('path');
    if (badPath(config.path)) push(errors, `${step.id}.config.path`, 'File paths must be relative to project storage and cannot contain ..');
    if (config.language && !hasTemplate(config.language) && !/^[a-z_]{3,10}(\+[a-z_]{3,10}){0,3}$/i.test(config.language)) push(errors, `${step.id}.config.language`, 'language must look like eng or eng+hin');
  }
  if (step.type === 'extract_document_fields') {
    if (!config.text && !config.source && !config.path) push(errors, `${step.id}.config.source`, 'Give source (an OCR step output such as {{steps.ocr}}), text, or path');
    if (badPath(config.path)) push(errors, `${step.id}.config.path`, 'File paths must be relative to project storage and cannot contain ..');
    if (config.documentType && config.documentType !== 'custom' && !TEMPLATES[config.documentType]) push(errors, `${step.id}.config.documentType`, `documentType must be custom or one of ${Object.keys(TEMPLATES).join(', ')}`);
    if (config.documentType === 'custom' && !(Array.isArray(config.fields) && config.fields.length)) push(errors, `${step.id}.config.fields`, 'Custom documents need fields');
    if (config.fields !== undefined && !Array.isArray(config.fields)) push(errors, `${step.id}.config.fields`, 'fields must be an array');
    for (const [index, field] of (Array.isArray(config.fields) ? config.fields : []).entries()) {
      if (!field?.name) push(errors, `${step.id}.config.fields.${index}.name`, 'name is required');
      if (field?.pattern) {
        try { new RegExp(field.pattern); } catch { push(errors, `${step.id}.config.fields.${index}.pattern`, 'Invalid regular expression'); }
        if (String(field.pattern).length > 300) push(errors, `${step.id}.config.fields.${index}.pattern`, 'Patterns are limited to 300 characters');
      } else if (!field?.label && !field?.labels?.length) push(errors, `${step.id}.config.fields.${index}`, 'Give a label, labels, or pattern');
    }
    if (config.minConfidence !== undefined && !hasTemplate(config.minConfidence) && !(Number(config.minConfidence) >= 0 && Number(config.minConfidence) <= 1)) push(errors, `${step.id}.config.minConfidence`, 'minConfidence must be between 0 and 1');
  }
  if (step.type === 'create_task') {
    need('title');
    if (config.taskType && !TASK_TYPES.includes(config.taskType)) push(errors, `${step.id}.config.taskType`, `taskType must be one of ${TASK_TYPES.join(', ')}`);
    if (config.priority && !TASK_PRIORITIES.includes(config.priority)) push(errors, `${step.id}.config.priority`, `priority must be one of ${TASK_PRIORITIES.join(', ')}`);
    try { normalizeFormSchema(config.formFields); } catch (error) { push(errors, `${step.id}.config.formFields`, error.message); }
  }
  if (step.type === 'wait_for_task') need('taskId');
  if (SHEETS_STEP_TYPES.includes(step.type)) {
    need('connectionId');
    need('range');
    if (step.type !== 'sheets_read_range') need('rows');
  }
  if (['add_queue_item', 'get_queue_item'].includes(step.type)) {
    if (!config.queueId && !config.queueName) push(errors, `${step.id}.config.queueName`, 'queueName or queueId is required');
  }
  if (step.type === 'get_queue_item' && config.maxItems !== undefined) {
    if (!Number.isInteger(config.maxItems) || config.maxItems < 1 || config.maxItems > 100) {
      push(errors, `${step.id}.config.maxItems`, 'maxItems must be an integer from 1 to 100');
    }
  }
  if (step.type === 'add_queue_item' && config.priority !== undefined && !['low', 'normal', 'high'].includes(config.priority)) {
    push(errors, `${step.id}.config.priority`, 'priority must be low, normal, or high');
  }
  if (step.type === 'set_queue_item_status') {
    need('itemId');
    need('status');
    if (config.status && !['SUCCESSFUL', 'FAILED'].includes(config.status) && !String(config.status).includes('{{')) {
      push(errors, `${step.id}.config.status`, 'status must be SUCCESSFUL or FAILED');
    }
    if (config.errorType && !['business', 'application'].includes(config.errorType)) {
      push(errors, `${step.id}.config.errorType`, 'errorType must be business or application');
    }
  }
  if (step.type === 'database_query') {
    const operations = ['select_rows', 'count_rows', 'insert_row', 'update_rows', 'run_query'];
    if (!operations.includes(config.operation)) {
      push(errors, `${step.id}.config.operation`, 'Operation must be an approved database operation or run_query');
    }
    if (config.operation === 'run_query') {
      need('query');
      if (config.parameters !== undefined && !Array.isArray(config.parameters) && !hasTemplate(config.parameters)) push(errors, `${step.id}.config.parameters`, 'parameters must be an array');
    }
  }
  if (step.type === 'http_request') {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    if (!methods.includes(String(config.method || '').toUpperCase())) {
      push(errors, `${step.id}.config.method`, 'HTTP method is not allowed');
    }
    if (typeof config.path !== 'string' || !config.path.startsWith('/')) {
      push(errors, `${step.id}.config.path`, 'HTTP path must start with /');
    }
    if (config.bodyType && !['json', 'form', 'text'].includes(config.bodyType)) push(errors, `${step.id}.config.bodyType`, 'bodyType must be json, form, or text');
  }
  if (options.connectionIds && config.connectionId && !options.connectionIds.has(config.connectionId)) {
    push(errors, `${step.id}.config.connectionId`, 'Connection does not belong to this project');
  }
  if (['browser_type', 'desktop_type'].includes(step.type) && config.credentialId) {
    if (config.credentialField !== undefined && !/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(String(config.credentialField))) push(errors, `${step.id}.config.credentialField`, 'credentialField must be a field name such as password');
    if (!hasTemplate(config.credentialId) && options.connectionIds && !options.connectionIds.has(config.credentialId)) push(errors, `${step.id}.config.credentialId`, 'Credential does not belong to this project');
    else if (!hasTemplate(config.credentialId) && options.connectionTypes?.get(config.credentialId) && options.connectionTypes.get(config.credentialId) !== 'credential') push(errors, `${step.id}.config.credentialId`, 'Choose a Credential connection');
  }
  if (options.connectionTypes && config.connectionId && options.connectionTypes.get(config.connectionId)) {
    const expected = {
      http_request: 'rest_api',
      database_query: ['mysql', 'postgres'],
      file_operation: 'file_storage',
      browser_ui_action: 'browser_uipath',
      sheets_read_range: 'google_sheets',
      sheets_append_rows: 'google_sheets',
      sheets_update_range: 'google_sheets',
    };
    if (step.type === 'send_notification' && config.channel === 'email') expected.send_notification = 'email';
    const type = options.connectionTypes.get(config.connectionId);
    const allowedTypes = [].concat(expected[step.type] || []);
    if (allowedTypes.length && !allowedTypes.includes(type)) {
      push(errors, `${step.id}.config.connectionId`, `Connection type ${type} cannot be used by ${step.type}`);
    }
  }
}

function checkSelector(step, config, errors, field = 'selector') {
  if (config[field] === undefined || config[field] === '') {
    push(errors, `${step.id}.config.${field}`, `${field} is required`);
    return;
  }
  const typeKey = field === 'selector' ? 'selectorType' : `${field}Type`;
  if (config[typeKey] && !SELECTOR_TYPES.includes(config[typeKey])) push(errors, `${step.id}.config.${typeKey}`, `selectorType must be one of ${SELECTOR_TYPES.join(', ')}`);
}

function checkUrlValue(step, config, errors) {
  if (config.url === undefined || config.url === '' || hasTemplate(config.url)) return;
  if (!/^https?:\/\//i.test(String(config.url))) push(errors, `${step.id}.config.url`, 'URL must start with http:// or https://');
}

function validateWebStep(step, config, need, errors) {
  if (config.session !== undefined && !/^[A-Za-z0-9_-]{1,40}$/.test(String(config.session))) push(errors, `${step.id}.config.session`, 'session must be letters, digits, _ or -');
  if (step.type === 'browser_open') {
    checkUrlValue(step, config, errors);
    if (config.browser && !['chromium', 'firefox', 'webkit'].includes(config.browser)) push(errors, `${step.id}.config.browser`, 'browser must be chromium, firefox, or webkit');
  }
  if (step.type === 'browser_navigate') {
    if (!['back', 'forward', 'reload'].includes(config.action)) need('url');
    checkUrlValue(step, config, errors);
  }
  if (['browser_click', 'browser_type', 'browser_get_text', 'browser_wait_for', 'browser_select_option', 'browser_extract_table'].includes(step.type)) checkSelector(step, config, errors);
  if (config.selectorType === 'image' && step.type !== 'browser_click') push(errors, `${step.id}.config.selectorType`, 'Image targeting is only available on Click');
  if (config.selectorType === 'image' && badPath(config.selector)) push(errors, `${step.id}.config.selector`, 'The template image path must be relative to project storage and cannot contain ..');
  if (step.type === 'browser_screenshot' && config.selector) checkSelector(step, config, errors);
  if (step.type === 'browser_type' && (config.text === undefined || config.text === '') && !config.credentialId && !config.key && !config.pressEnter) push(errors, `${step.id}.config.text`, 'text, a credential, or key is required');
  if (step.type === 'browser_wait_for' && config.state && !['visible', 'hidden', 'attached', 'detached'].includes(config.state)) push(errors, `${step.id}.config.state`, 'state must be visible, hidden, attached, or detached');
  if (step.type === 'browser_select_option' && [config.value, config.label, config.optionIndex].every((value) => value === undefined || value === '')) push(errors, `${step.id}.config.value`, 'value, label, or optionIndex is required');
  if (step.type === 'browser_extract_table') {
    if (config.mode && !['table', 'list'].includes(config.mode)) push(errors, `${step.id}.config.mode`, 'mode must be table or list');
    if (config.mode === 'list' && !(Array.isArray(config.fields) && config.fields.length && config.fields.every((field) => field?.name))) push(errors, `${step.id}.config.fields`, 'List extraction needs fields with a name and an optional selector and attribute');
    if (config.maxPages !== undefined && !(Number.isInteger(config.maxPages) && config.maxPages >= 1 && config.maxPages <= 50)) push(errors, `${step.id}.config.maxPages`, 'maxPages must be 1 to 50');
  }
  if (step.type === 'browser_screenshot' && config.path) {
    if (badPath(config.path)) push(errors, `${step.id}.config.path`, 'File paths must be relative to project storage and cannot contain ..');
    if (!hasTemplate(config.path) && !/\.png$/i.test(config.path)) push(errors, `${step.id}.config.path`, 'Screenshot path must end with .png');
  }
}

function validateDesktopStep(step, config, need, errors) {
  const hasSelector = config.selector && typeof config.selector === 'object' && ['name', 'automationId', 'className', 'controlType'].some((key) => config.selector[key]);
  if (config.selector !== undefined && config.selector !== null && typeof config.selector !== 'object') push(errors, `${step.id}.config.selector`, 'A desktop selector is an object: { name, automationId, className, controlType, index }');
  if (step.type === 'desktop_open_app') need('path');
  if (step.type === 'desktop_attach_window' && !config.title && !config.processName) push(errors, `${step.id}.config.title`, 'title or processName is required');
  if (['desktop_open_app', 'desktop_attach_window'].includes(step.type) && config.match && !['exact', 'contains', 'regex'].includes(config.match)) push(errors, `${step.id}.config.match`, 'match must be exact, contains, or regex');
  if (step.type === 'desktop_click' && !hasSelector && (config.x === undefined || config.y === undefined)) push(errors, `${step.id}.config.selector`, 'Give a selector or x and y');
  if (step.type === 'desktop_type' && config.text === undefined && !config.credentialId) push(errors, `${step.id}.config.text`, 'text or a credential is required');
  if (step.type === 'desktop_get_text' && !hasSelector) push(errors, `${step.id}.config.selector`, 'selector is required');
  if (step.type === 'desktop_hotkey') {
    need('keys');
    if (config.keys && !hasTemplate(config.keys)) {
      try { parseHotkey(config.keys); } catch (error) { push(errors, `${step.id}.config.keys`, error.message); }
    }
  }
}
