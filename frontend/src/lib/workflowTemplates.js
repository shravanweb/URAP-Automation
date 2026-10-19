// Ready-made workflows shown on Home and in Studio's Templates tab. Each template is a complete
// workflow definition built only from activities the engine runs (see ACTIVITIES in
// workflowGraph.js and STEP_TYPES in the backend). backend/test/templates.test.js checks every
// definition with the real validator and runs it against mocked services, so a card can only
// promise what the steps actually do. "Try it" opens /workflows/new?template=<key>.
import { ACTIVITIES, ACTIVITY_GROUPS } from './workflowGraph.js';

const X = 48;
const BRANCH = 300;
const ROW = 108;

function step(id, type, name, config, next, at) {
  return { id, type, name, config: { ...config, designer: at }, errorPolicy: 'fail', timeoutMs: 30000, next };
}
const row = (index, x = X) => ({ x, y: 36 + index * ROW });

export const WORKFLOW_TEMPLATES = [
  {
    key: 'invoice-to-csv',
    tag: 'Template',
    title: 'Extract invoice fields into a CSV',
    body: 'OCR an invoice PDF or image, extract the number, dates, vendor, and total, ask a person to check low-confidence results in Action Center, then write the fields to a CSV.',
    apps: [['document', 'Document Understanding'], ['tasks', 'Action Center'], ['table', 'CSV']],
    input: {},
    retryPolicy: { maxAttempts: 1, backoffSeconds: 0 },
    steps: [
      step('start', 'start', 'Start', {}, 'ocr', row(0)),
      step('ocr', 'ocr_extract', 'OCR invoice', { path: 'in/invoice.pdf', language: 'eng' }, 'extract', row(1)),
      step('extract', 'extract_document_fields', 'Extract invoice fields', { source: '{{steps.ocr}}', documentType: 'invoice', minConfidence: 0.8 }, 'needs_review', row(2)),
      step('needs_review', 'if_else', 'Needs review?', { left: '{{steps.extract.needsReview}}', operator: 'eq', right: true, whenTrue: 'review', whenFalse: 'save' }, null, row(3)),
      step('review', 'create_task', 'Check invoice fields', {
        taskType: 'validation',
        title: 'Check invoice {{steps.extract.values.invoiceNumber}}',
        priority: 'medium',
        outcomes: ['approve', 'reject'],
        formFields: [{ name: 'note', label: 'Reviewer note', type: 'textarea' }],
        data: '{{steps.extract.values}}',
      }, 'save', row(4, X + BRANCH)),
      step('save', 'write_csv', 'Write fields to CSV', {
        path: 'out/invoice-fields.csv',
        rows: [{
          invoiceNumber: '{{steps.extract.values.invoiceNumber}}',
          invoiceDate: '{{steps.extract.values.invoiceDate}}',
          dueDate: '{{steps.extract.values.dueDate}}',
          vendorName: '{{steps.extract.values.vendorName}}',
          totalAmount: '{{steps.extract.values.totalAmount}}',
          currency: '{{steps.extract.values.currency}}',
          confidence: '{{steps.extract.confidence}}',
        }],
      }, 'end', row(5)),
      step('end', 'end', 'End', { summaryFrom: ['extract', 'save'] }, null, row(6)),
    ],
  },
  {
    key: 'web-table-to-csv',
    tag: 'Template',
    title: 'Scrape a web table into a CSV',
    body: 'Open a page in a headless browser, wait for a table, extract its rows, and save them to a CSV file in project storage.',
    apps: [['globe', 'Web automation'], ['table', 'CSV']],
    input: {},
    retryPolicy: { maxAttempts: 2, backoffSeconds: 10 },
    steps: [
      step('start', 'start', 'Start', {}, 'open', row(0)),
      step('open', 'browser_open', 'Open page', { url: 'https://www.w3schools.com/html/html_tables.asp', browser: 'chromium', headless: true }, 'wait', row(1)),
      step('wait', 'browser_wait_for', 'Wait for table', { selector: '#customers', selectorType: 'css', state: 'visible', timeoutMs: 15000 }, 'extract', row(2)),
      step('extract', 'browser_extract_table', 'Extract table rows', { selector: '#customers', selectorType: 'css', mode: 'table', maxRows: 500 }, 'save', row(3)),
      step('save', 'write_csv', 'Save rows to CSV', { path: 'out/web-table.csv', rows: '{{steps.extract.rows}}' }, 'close', row(4)),
      step('close', 'browser_close', 'Close browser', {}, 'end', row(5)),
      step('end', 'end', 'End', { summaryFrom: ['extract', 'save'] }, null, row(6)),
    ],
  },
  {
    key: 'purchase-approval',
    tag: 'Template',
    title: 'Route a purchase request for approval',
    body: 'Create an Action Center approval task with the request details, pause the job until a manager approves or rejects, then post an in-app notification with the outcome.',
    apps: [['tasks', 'Action Center'], ['bell', 'Notifications']],
    input: { item: 'Laptop', amount: 1200, requestedBy: 'alex@example.com' },
    retryPolicy: { maxAttempts: 1, backoffSeconds: 0 },
    steps: [
      step('start', 'start', 'Start', {}, 'approval', row(0)),
      step('approval', 'create_task', 'Manager approval', {
        taskType: 'approval',
        title: 'Approve purchase: {{input.item}}',
        priority: 'medium',
        outcomes: ['approve', 'reject'],
        formFields: [{ name: 'approvedAmount', label: 'Approved amount', type: 'number', required: true }],
        data: { item: '{{input.item}}', amount: '{{input.amount}}', requestedBy: '{{input.requestedBy}}' },
      }, 'decision', row(1)),
      step('decision', 'if_else', 'Approved?', { left: '{{steps.approval.outcome}}', operator: 'eq', right: 'approve', whenTrue: 'approved', whenFalse: 'rejected' }, null, row(2)),
      step('approved', 'send_notification', 'Notify approved', { channel: 'in_app', subject: 'Purchase approved', message: '{{input.item}} approved for {{steps.approval.data.approvedAmount}}' }, 'end', row(3)),
      step('rejected', 'send_notification', 'Notify rejected', { channel: 'in_app', subject: 'Purchase rejected', message: '{{input.item}} was rejected' }, 'end', row(3, X + BRANCH)),
      step('end', 'end', 'End', { summaryFrom: ['approval', 'decision'] }, null, row(4)),
    ],
  },
  {
    key: 'queue-transactions',
    tag: 'Ready to go',
    title: 'Process queue items',
    body: 'Get up to 10 transaction items from an Orchestrator queue, check each amount, and mark items successful or failed as a business exception. The job retries up to 3 times.',
    apps: [['queue', 'Queues'], ['orchestrator', 'Orchestrator']],
    input: {},
    retryPolicy: { maxAttempts: 3, backoffSeconds: 30 },
    steps: [
      step('start', 'start', 'Start', {}, 'get', row(0)),
      step('get', 'get_queue_item', 'Get transaction items', { queueName: 'Invoices', maxItems: 10 }, 'loop', row(1)),
      step('loop', 'for_each', 'Each item', { source: '{{steps.get.items}}', bodyStart: 'check', bodyEnd: 'ok', maxIterations: 10 }, 'log', row(2)),
      step('check', 'if_else', 'Amount positive?', { left: '{{item.specificContent.amount}}', operator: 'gt', right: 0, whenTrue: 'ok', whenFalse: 'bad' }, null, row(2, X + BRANCH)),
      step('ok', 'set_queue_item_status', 'Mark successful', { itemId: '{{item.id}}', status: 'SUCCESSFUL', output: { amount: '{{item.specificContent.amount}}' } }, null, row(3, X + BRANCH)),
      step('bad', 'set_queue_item_status', 'Business exception', { itemId: '{{item.id}}', status: 'FAILED', errorType: 'business', errorMessage: 'Amount must be positive' }, null, row(4, X + BRANCH)),
      step('log', 'log_message', 'Log summary', { level: 'info', message: 'Processed {{steps.get.count}} items' }, 'end', row(3)),
      step('end', 'end', 'End', { summaryFrom: ['get', 'log'] }, null, row(4)),
    ],
  },
  {
    key: 'clean-customer-csv',
    tag: 'Template',
    title: 'Clean and de-duplicate a customer CSV',
    body: 'Read a CSV, trim and lower-case emails, split out rows that fail required and email checks, drop duplicate emails, and write clean and rejected CSV files.',
    apps: [['table', 'CSV'], ['check', 'Validate Data']],
    input: {},
    retryPolicy: { maxAttempts: 1, backoffSeconds: 0 },
    steps: [
      step('start', 'start', 'Start', {}, 'read', row(0)),
      step('read', 'read_csv', 'Read customers', { path: 'in/customers.csv' }, 'normalize', row(1)),
      step('normalize', 'transform_data', 'Normalize emails', { source: '{{steps.read.rows}}', operations: [{ op: 'map', field: 'email', fn: 'trim' }, { op: 'map', field: 'email', fn: 'lower' }] }, 'validate', row(2)),
      step('validate', 'validate_data', 'Check required fields', { source: '{{steps.normalize.rows}}', mode: 'split', rules: [{ field: 'name', checks: ['required'] }, { field: 'email', checks: ['required', 'email'] }] }, 'dedupe', row(3)),
      step('dedupe', 'find_duplicates', 'Find duplicate emails', { source: '{{steps.validate.valid}}', keys: ['email'] }, 'unique', row(4)),
      step('unique', 'transform_data', 'Keep first of each email', { source: '{{steps.dedupe.rows}}', operations: [{ op: 'filter', field: '_duplicate', operator: 'eq', value: false }] }, 'write_clean', row(5)),
      step('write_clean', 'write_csv', 'Write clean CSV', { path: 'out/customers-clean.csv', rows: '{{steps.unique.rows}}', columns: ['name', 'email'] }, 'write_rejected', row(6)),
      step('write_rejected', 'write_csv', 'Write rejected CSV', { path: 'out/customers-rejected.csv', rows: '{{steps.validate.invalid}}', columns: ['row', 'failures'] }, 'end', row(7)),
      step('end', 'end', 'End', { summaryFrom: ['validate', 'dedupe', 'write_clean'] }, null, row(8)),
    ],
  },
  {
    key: 'notepad-note',
    tag: 'Desktop',
    title: 'Type a note into Notepad',
    body: 'Windows only: open Notepad on a Windows worker or robot machine, type the note from the job input, and log how many characters were typed.',
    apps: [['monitor', 'Windows desktop']],
    input: { note: 'Hello from URAP' },
    retryPolicy: { maxAttempts: 1, backoffSeconds: 0 },
    steps: [
      step('start', 'start', 'Start', {}, 'open', row(0)),
      step('open', 'desktop_open_app', 'Open Notepad', { path: 'notepad.exe', windowTitle: 'Notepad', match: 'contains' }, 'type', row(1)),
      step('type', 'desktop_type', 'Type the note', { text: '{{input.note}}' }, 'log', row(2)),
      step('log', 'log_message', 'Log result', { level: 'info', message: 'Typed {{steps.type.typedCharacters}} characters' }, 'end', row(3)),
      step('end', 'end', 'End', { summaryFrom: ['type', 'log'] }, null, row(4)),
    ],
  },
];

export function templateByKey(key) {
  return WORKFLOW_TEMPLATES.find((item) => item.key === key) || null;
}

/** Workflow definition in the shape POST /api/workflows/:id/versions and the validator expect. */
export function templateDefinition(template) {
  return { schemaVersion: '1.0', retryPolicy: { ...template.retryPolicy }, steps: structuredClone(template.steps) };
}

// Activity packs: the designer's own catalog grouped by category, with real counts. Start and End
// are structural and not counted.
const PACK_INFO = {
  Control: { icon: 'decision', body: 'Branch, loop over rows, invoke other workflows, and log messages.' },
  Data: { icon: 'table', body: 'Read and write Excel and CSV, read PDF text, transform, validate, and de-duplicate rows.' },
  Web: { icon: 'globe', body: 'Browser automation with Playwright: open, click, type, select, extract tables, and screenshot.' },
  Desktop: { icon: 'monitor', body: 'Windows UI Automation: open or attach to apps, click, type, send hotkeys, and read text.' },
  Documents: { icon: 'document', body: 'OCR images and PDFs with Tesseract and extract invoice, receipt, and custom fields.' },
  'Action Center': { icon: 'tasks', body: 'Create approval and form tasks for people and pause the job until they finish.' },
  Orchestrator: { icon: 'queue', body: 'Add queue items, get transactions, and set their status with retries.' },
  Integration: { icon: 'api', body: 'HTTP, database, file, and Google Sheets steps through project connections, plus email and in-app notifications.' },
  Robot: { icon: 'robot', body: 'Hand a step to a UiPath robot or the URAP robot agent on a connected machine.' },
};

export function activityPacks() {
  return ACTIVITY_GROUPS.map((group) => {
    const activities = ACTIVITIES.filter(([type, , g]) => g === group && type !== 'start' && type !== 'end');
    const info = PACK_INFO[group] || { icon: 'grid', body: '' };
    return {
      key: group,
      tag: 'Activity pack',
      title: group,
      count: activities.length,
      activities: activities.map(([, label]) => label),
      body: info.body,
      apps: [[info.icon, group]],
      to: group === 'Integration' ? '/connections' : `/workflows/new?palette=${encodeURIComponent(group)}`,
      cta: group === 'Integration' ? 'Connections' : 'Open in Designer',
    };
  }).filter((pack) => pack.count > 0);
}
