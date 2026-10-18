// Pure helpers for the workflow designer. Kept free of React so they can be unit tested.

export const ACTIVITIES = [
  ['start', 'Start', 'Control'],
  ['for_each', 'For Each Row', 'Control'],
  ['if_else', 'Flow Decision', 'Control'],
  ['call_subworkflow', 'Invoke Workflow', 'Control'],
  ['log_message', 'Log Message', 'Control'],
  ['read_excel', 'Read Range (Excel)', 'Data'],
  ['write_excel', 'Write Range (Excel)', 'Data'],
  ['read_csv', 'Read CSV', 'Data'],
  ['write_csv', 'Write CSV', 'Data'],
  ['read_pdf_text', 'Read PDF Text', 'Data'],
  ['transform_data', 'Transform Data Table', 'Data'],
  ['validate_data', 'Validate Data', 'Data'],
  ['find_duplicates', 'Find Duplicates', 'Data'],
  ['add_queue_item', 'Add Queue Item', 'Orchestrator'],
  ['get_queue_item', 'Get Transaction Item', 'Orchestrator'],
  ['set_queue_item_status', 'Set Transaction Status', 'Orchestrator'],
  ['http_request', 'HTTP Request', 'Integration'],
  ['database_query', 'Database Query', 'Integration'],
  ['file_operation', 'File Operation', 'Integration'],
  ['send_notification', 'Send Notification', 'Integration'],
  ['sheets_read_range', 'Read Range (Google Sheets)', 'Integration'],
  ['sheets_append_rows', 'Append Rows (Google Sheets)', 'Integration'],
  ['sheets_update_range', 'Write Range (Google Sheets)', 'Integration'],
  ['browser_open', 'Open Browser', 'Web'],
  ['browser_navigate', 'Navigate To', 'Web'],
  ['browser_click', 'Click', 'Web'],
  ['browser_type', 'Type Into', 'Web'],
  ['browser_select_option', 'Select Item', 'Web'],
  ['browser_get_text', 'Get Text', 'Web'],
  ['browser_extract_table', 'Extract Table Data', 'Web'],
  ['browser_wait_for', 'Wait For Element', 'Web'],
  ['browser_screenshot', 'Take Screenshot', 'Web'],
  ['browser_close', 'Close Browser', 'Web'],
  ['desktop_open_app', 'Open Application', 'Desktop'],
  ['desktop_attach_window', 'Attach Window', 'Desktop'],
  ['desktop_click', 'Click (desktop)', 'Desktop'],
  ['desktop_type', 'Type Into (desktop)', 'Desktop'],
  ['desktop_hotkey', 'Send Hotkey', 'Desktop'],
  ['desktop_get_text', 'Get Text (desktop)', 'Desktop'],
  ['desktop_close_window', 'Close Window', 'Desktop'],
  ['ocr_extract', 'OCR (image / PDF)', 'Documents'],
  ['extract_document_fields', 'Extract Document Fields', 'Documents'],
  ['create_task', 'Create Form Task', 'Action Center'],
  ['wait_for_task', 'Wait For Task', 'Action Center'],
  ['browser_ui_action', 'Browser Action (robot)', 'Robot'],
  ['uipath_workflow', 'UiPath Workflow (robot)', 'Robot'],
  ['end', 'End', 'Control'],
];

export const ACTIVITY_GROUPS = ['Control', 'Data', 'Web', 'Desktop', 'Documents', 'Action Center', 'Orchestrator', 'Integration', 'Robot'];

export function activityLabel(type) {
  return ACTIVITIES.find(([key]) => key === type)?.[1] || type;
}

const DEFAULT_CONFIG = {
  if_else: { operator: 'eq', left: '', right: '', whenTrue: null, whenFalse: null },
  for_each: { source: '{{input.rows}}', maxIterations: 100, bodyStart: null, bodyEnd: null },
  http_request: { connectionId: '', method: 'GET', path: '/' },
  database_query: { connectionId: '', operation: 'select_rows', table: '', filters: [] },
  file_operation: { connectionId: '', action: 'list', path: '.' },
  read_excel: { path: 'in/data.xlsx' },
  write_excel: { path: 'out/result.xlsx', rows: '{{steps.previous.rows}}' },
  read_csv: { path: 'in/data.csv' },
  write_csv: { path: 'out/result.csv', rows: '{{steps.previous.rows}}' },
  read_pdf_text: { path: 'in/document.pdf' },
  transform_data: { source: '{{input.rows}}', operations: [] },
  validate_data: { source: '{{input.rows}}', mode: 'split', rules: [] },
  find_duplicates: { source: '{{input.rows}}', keys: [] },
  send_notification: { channel: 'in_app', subject: 'Notification', message: '' },
  call_subworkflow: { workflowId: '', input: {} },
  browser_ui_action: { task: 'BrowserTask', input: {} },
  uipath_workflow: { task: 'ExecuteSupportedTask', input: {} },
  log_message: { level: 'info', message: 'Reached this step' },
  add_queue_item: { queueName: '', reference: '', priority: 'normal', specificContent: {} },
  get_queue_item: { queueName: '', maxItems: 1 },
  set_queue_item_status: { itemId: '{{item.id}}', status: 'SUCCESSFUL', output: {} },
  sheets_read_range: { connectionId: '', range: 'Sheet1!A1:Z1000', headerRow: true },
  sheets_append_rows: { connectionId: '', range: 'Sheet1!A1', rows: '{{steps.previous.rows}}' },
  sheets_update_range: { connectionId: '', range: 'Sheet1!A2', values: [['value']] },
  browser_open: { url: 'https://example.com', browser: 'chromium' },
  browser_navigate: { url: 'https://example.com/next' },
  browser_click: { selector: '', selectorType: 'auto' },
  browser_type: { selector: '', selectorType: 'auto', text: '' },
  browser_select_option: { selector: '', selectorType: 'auto', value: '' },
  browser_get_text: { selector: '', selectorType: 'auto' },
  browser_extract_table: { selector: 'table', selectorType: 'css', mode: 'table', maxRows: 500 },
  browser_wait_for: { selector: '', selectorType: 'auto', state: 'visible', timeoutMs: 10000 },
  browser_screenshot: { fullPage: true },
  browser_close: {},
  desktop_open_app: { path: 'notepad.exe', windowTitle: 'Notepad' },
  desktop_attach_window: { title: '', match: 'contains' },
  desktop_click: { selector: { name: '', controlType: 'Button' } },
  desktop_type: { selector: { controlType: 'Edit' }, text: '' },
  desktop_hotkey: { keys: 'Ctrl+S' },
  desktop_get_text: { selector: { automationId: '' } },
  desktop_close_window: {},
  ocr_extract: { path: 'uploads/invoice.png', language: 'eng' },
  extract_document_fields: { source: '{{steps.previous}}', documentType: 'invoice', minConfidence: 0.8 },
  create_task: { taskType: 'approval', title: 'Please review', priority: 'medium', outcomes: ['approve', 'reject'], formFields: [], data: {} },
  wait_for_task: { taskId: '{{steps.previous.taskId}}' },
  end: { summaryFrom: [] },
};

export function uniqueStepId(type, steps) {
  const base = type.replace(/[^A-Za-z0-9_-]/g, '_');
  const taken = new Set(steps.map((step) => step.id));
  let index = 1;
  while (taken.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

export function blankStep(type, steps, at) {
  return {
    id: uniqueStepId(type, steps),
    type,
    name: activityLabel(type),
    config: { ...structuredClone(DEFAULT_CONFIG[type] || {}), designer: at },
    errorPolicy: 'fail',
    timeoutMs: 30000,
    next: null,
  };
}

export function place(step, index) {
  return step.config?.designer || { x: 48, y: 36 + index * 108 };
}

const REF_FIELDS = ['whenTrue', 'whenFalse', 'bodyStart', 'bodyEnd'];

/** Removes a step and every reference to it. Start and the last End cannot be removed. */
export function removeStep(steps, id) {
  const target = steps.find((step) => step.id === id);
  if (!target) return steps;
  if (target.type === 'start') return steps;
  if (target.type === 'end' && steps.filter((step) => step.type === 'end').length === 1) return steps;
  return steps
    .filter((step) => step.id !== id)
    .map((step) => {
      const config = { ...(step.config || {}) };
      for (const field of REF_FIELDS) if (config[field] === id) config[field] = target.next || null;
      return { ...step, next: step.next === id ? (target.next || null) : step.next, config };
    });
}

/** Inserts a new activity before the first End step and wires it into the main chain. */
export function insertActivity(steps, type) {
  const foundEnd = steps.findIndex((item) => item.type === 'end');
  const endIndex = foundEnd < 0 ? steps.length : foundEnd;
  const previous = steps[endIndex - 1];
  const prevAt = previous ? place(previous, endIndex - 1) : { x: 48, y: 36 };
  const added = blankStep(type, steps, { x: prevAt.x, y: prevAt.y + 110 });
  const next = steps.map((item, index) => {
    if (index < endIndex) return item;
    const pos = place(item, index);
    return { ...item, config: { ...item.config, designer: { x: pos.x, y: pos.y + 110 } } };
  });
  if (previous && previous.type !== 'end' && previous.type !== 'if_else') {
    added.next = previous.next;
    next[endIndex - 1] = { ...previous, next: added.id };
  } else if (foundEnd >= 0) {
    added.next = steps[foundEnd].id;
  }
  next.splice(endIndex, 0, added);
  return { steps: next, index: endIndex };
}

/** Edges for the designer canvas, including loop bodies. */
export function edges(steps) {
  const list = [];
  for (const step of steps) {
    const targets = [
      [step.next, 'next'],
      [step.config?.whenTrue, 'true'],
      [step.config?.whenFalse, 'false'],
      [step.config?.bodyStart, 'body'],
    ];
    for (const [to, kind] of targets) if (to && steps.some((item) => item.id === to)) list.push({ from: step.id, to, kind });
  }
  return list;
}

export function buildDefinition(steps, retryPolicy) {
  return {
    schemaVersion: '1.0',
    retryPolicy: {
      maxAttempts: Math.min(Math.max(Number(retryPolicy?.maxAttempts) || 1, 1), 5),
      backoffSeconds: Math.min(Math.max(Number(retryPolicy?.backoffSeconds) || 0, 0), 3600),
    },
    steps: steps.map((item) => ({ ...item, config: typeof item.config === 'string' ? JSON.parse(item.config || '{}') : item.config })),
  };
}

/**
 * Inserts several activities (from the recorder or a codegen import) before End, in order.
 * Each item is { type, name?, config? }.
 */
export function insertSteps(steps, items) {
  let current = steps;
  let index = -1;
  for (const item of items) {
    const result = insertActivity(current, item.type);
    const added = result.steps[result.index];
    result.steps[result.index] = {
      ...added,
      name: item.name || added.name,
      config: { ...structuredClone(item.config || {}), designer: added.config.designer },
    };
    current = result.steps;
    if (index < 0) index = result.index;
  }
  return { steps: current, index: index < 0 ? 0 : index };
}
