// Property panel metadata for the designer. Each field maps to one key in step.config.
// kind: text | textarea | number | checkbox | select | selector | connection | credential |
//       desktopSelector | list | json
// The JSON editor under the panel still shows every argument, so advanced options that have no
// field here can be set there.

export const SELECTOR_TYPES = [
  ['auto', 'Auto (CSS or XPath)'],
  ['css', 'CSS'],
  ['xpath', 'XPath'],
  ['text', 'Text'],
  ['role', 'Role (button[name="Save"])'],
  ['label', 'Label'],
  ['placeholder', 'Placeholder'],
  ['testid', 'Test id'],
];

export const CONTROL_TYPES = ['Button', 'CheckBox', 'ComboBox', 'Custom', 'DataGrid', 'DataItem', 'Document', 'Edit', 'Group', 'Hyperlink', 'List', 'ListItem', 'Menu', 'MenuItem', 'Pane', 'RadioButton', 'Tab', 'TabItem', 'Table', 'Text', 'Tree', 'TreeItem', 'Window'];

const selector = { key: 'selector', label: 'Target element', kind: 'selector' };
const session = { key: 'session', label: 'Browser session', kind: 'text', placeholder: 'default', advanced: true };
const timeout = { key: 'timeoutMs', label: 'Timeout (ms)', kind: 'number', placeholder: '15000' };
const desktopWindow = { key: 'timeoutMs', label: 'Timeout (ms)', kind: 'number', placeholder: '10000' };

export const ACTIVITY_FIELDS = {
  browser_open: [
    { key: 'url', label: 'URL', kind: 'text', placeholder: 'https://portal.example.com' },
    { key: 'browser', label: 'Browser', kind: 'select', options: [['chromium', 'Chromium / Chrome / Edge'], ['firefox', 'Firefox'], ['webkit', 'WebKit']] },
    { key: 'headless', label: 'Headless (no window)', kind: 'checkbox', help: 'Leave unset to use BROWSER_HEADLESS from the worker settings.' },
    timeout,
    session,
  ],
  browser_navigate: [
    { key: 'url', label: 'URL', kind: 'text' },
    { key: 'action', label: 'Or go', kind: 'select', options: [['', '—'], ['back', 'Back'], ['forward', 'Forward'], ['reload', 'Reload']] },
    session,
  ],
  browser_click: [
    selector,
    { key: 'button', label: 'Mouse button', kind: 'select', options: [['left', 'Left'], ['right', 'Right'], ['middle', 'Middle']] },
    { key: 'clickCount', label: 'Click count', kind: 'number', placeholder: '1' },
    { key: 'waitForNavigation', label: 'Wait for page load after click', kind: 'checkbox' },
    timeout,
    session,
  ],
  browser_type: [
    selector,
    { key: 'text', label: 'Text', kind: 'text', placeholder: '{{input.customer}}' },
    { key: 'credentialId', label: 'Or type from credential', kind: 'credential' },
    { key: 'clearBefore', label: 'Clear field first', kind: 'checkbox', defaultValue: true },
    { key: 'pressEnter', label: 'Press Enter after typing', kind: 'checkbox' },
    { key: 'key', label: 'Press key', kind: 'text', placeholder: 'Tab, Enter, Control+A', advanced: true },
    timeout,
    session,
  ],
  browser_select_option: [
    selector,
    { key: 'value', label: 'Option value', kind: 'text' },
    { key: 'label', label: 'Or option label', kind: 'text' },
    timeout,
    session,
  ],
  browser_get_text: [
    selector,
    { key: 'attribute', label: 'Attribute (empty = visible text)', kind: 'text', placeholder: 'href' },
    { key: 'all', label: 'All matching elements', kind: 'checkbox' },
    timeout,
    session,
  ],
  browser_extract_table: [
    selector,
    { key: 'mode', label: 'Mode', kind: 'select', options: [['table', 'HTML table'], ['list', 'Repeated elements (list)']] },
    { key: 'fields', label: 'List fields', kind: 'json', placeholder: '[{ "name": "title", "selector": "h3" }, { "name": "link", "selector": "a", "attribute": "href" }]', help: 'List mode: the target selects each row; fields are read inside it.' },
    { key: 'nextSelector', label: 'Next page button (pagination)', kind: 'text', placeholder: 'a.next' },
    { key: 'maxPages', label: 'Max pages', kind: 'number', placeholder: '1' },
    { key: 'maxRows', label: 'Max rows', kind: 'number', placeholder: '500' },
    session,
  ],
  browser_wait_for: [
    selector,
    { key: 'state', label: 'Wait until', kind: 'select', options: [['visible', 'Visible'], ['hidden', 'Hidden'], ['attached', 'In the page'], ['detached', 'Removed']] },
    timeout,
    { key: 'failIfNotFound', label: 'Fail if not found', kind: 'checkbox', defaultValue: true },
    session,
  ],
  browser_screenshot: [
    { key: 'path', label: 'File (.png, project storage)', kind: 'text', placeholder: 'screenshots/result.png' },
    { key: 'fullPage', label: 'Full page', kind: 'checkbox' },
    { key: 'selector', label: 'Only this element (optional)', kind: 'text' },
    session,
  ],
  browser_close: [session],
  browser_flutter_attendance: [
    { key: 'phase', label: 'Stage', kind: 'select', options: [['login', 'Log in'], ['attendance', 'Go to Attendance'], ['punch', 'Punch (click IN / OUT)'], ['verify', 'Verify'], ['all', 'All stages in one step']] },
    { key: 'action', label: 'Punch', kind: 'select', options: [['in', 'Punch In'], ['out', 'Punch Out']] },
    { key: 'email', label: 'Email (Log in)', kind: 'text', placeholder: '{{input.email}}' },
    { key: 'credentialId', label: 'Password credential (Log in)', kind: 'credential', help: 'A Credential connection; enter the password with Set password on the Connections page.' },
    { key: 'punchInText', label: 'Punch In button', kind: 'text', placeholder: 'IN', help: 'Whole label, ignoring case. Log out controls are never clicked.' },
    { key: 'punchOutText', label: 'Punch Out button', kind: 'text', placeholder: 'OUT', help: 'Whole label, ignoring case, so OUT never matches Log Out.' },
    { key: 'successTexts', label: 'Success texts', kind: 'list', placeholder: 'success, punched, marked' },
    { key: 'screenshotFolder', label: 'Screenshot folder', kind: 'text', placeholder: 'screenshots/attendance' },
    { key: 'timeoutMs', label: 'Timeout per step (ms)', kind: 'number', placeholder: '30000' },
    session,
  ],
  desktop_open_app: [
    { key: 'path', label: 'Application', kind: 'text', placeholder: 'notepad.exe or C:\\Apps\\erp.exe' },
    { key: 'args', label: 'Arguments', kind: 'list', placeholder: 'comma separated' },
    { key: 'windowTitle', label: 'Window title', kind: 'text', placeholder: 'Notepad' },
    { key: 'match', label: 'Title match', kind: 'select', options: [['contains', 'Contains'], ['exact', 'Exact'], ['regex', 'Regular expression']] },
    { key: 'timeoutMs', label: 'Wait for window (ms)', kind: 'number', placeholder: '20000' },
  ],
  desktop_attach_window: [
    { key: 'title', label: 'Window title', kind: 'text' },
    { key: 'processName', label: 'Or process name', kind: 'text', placeholder: 'notepad' },
    { key: 'match', label: 'Title match', kind: 'select', options: [['contains', 'Contains'], ['exact', 'Exact'], ['regex', 'Regular expression']] },
    desktopWindow,
  ],
  desktop_click: [
    { key: 'selector', label: 'Target element', kind: 'desktopSelector' },
    { key: 'x', label: 'Or X (window pixels)', kind: 'number' },
    { key: 'y', label: 'Y', kind: 'number' },
    { key: 'button', label: 'Mouse button', kind: 'select', options: [['left', 'Left'], ['right', 'Right'], ['middle', 'Middle']] },
    { key: 'double', label: 'Double click', kind: 'checkbox' },
    desktopWindow,
  ],
  desktop_type: [
    { key: 'selector', label: 'Target element (empty = focused)', kind: 'desktopSelector' },
    { key: 'text', label: 'Text', kind: 'text' },
    { key: 'credentialId', label: 'Or type from credential', kind: 'credential' },
    { key: 'method', label: 'Input method', kind: 'select', options: [['keys', 'Keystrokes (SendKeys)'], ['value', 'Set value (UI Automation)']] },
    { key: 'clearBefore', label: 'Clear field first', kind: 'checkbox', defaultValue: true },
    desktopWindow,
  ],
  desktop_hotkey: [{ key: 'keys', label: 'Keys', kind: 'text', placeholder: 'Ctrl+S, Alt+F4, Win+R, Enter' }],
  desktop_get_text: [{ key: 'selector', label: 'Target element', kind: 'desktopSelector' }, desktopWindow],
  desktop_close_window: [],
  ocr_extract: [
    { key: 'path', label: 'Image or PDF (project storage)', kind: 'text', placeholder: 'uploads/invoice.png or {{input.file}}' },
    { key: 'language', label: 'Language', kind: 'text', placeholder: 'eng, eng+hin' },
    { key: 'pages', label: 'PDF pages', kind: 'text', placeholder: '1-3,5' },
    { key: 'forceOcr', label: 'OCR even if the PDF has text', kind: 'checkbox' },
  ],
  extract_document_fields: [
    { key: 'source', label: 'OCR result or text', kind: 'text', placeholder: '{{steps.ocr_extract_1}}' },
    { key: 'path', label: 'Or file (runs OCR first)', kind: 'text' },
    { key: 'documentType', label: 'Template', kind: 'select', options: [['invoice', 'Invoice'], ['receipt', 'Receipt'], ['purchase_order', 'Purchase order'], ['', 'Custom fields only']] },
    { key: 'fields', label: 'Custom fields', kind: 'json', placeholder: '[{ "name": "reference", "label": "Ref", "type": "id", "required": true }]', help: 'type: string, id, amount, date, number, email, gstin. Use label(s) or a regex pattern.' },
    { key: 'minConfidence', label: 'Minimum confidence (0–1)', kind: 'number', placeholder: '0.8' },
    { key: 'dateOrder', label: 'Date order', kind: 'select', options: [['DMY', 'Day/Month/Year'], ['MDY', 'Month/Day/Year']] },
  ],
  create_task: [
    { key: 'taskType', label: 'Task type', kind: 'select', options: [['approval', 'Approval'], ['form', 'Form'], ['validation', 'Validation']] },
    { key: 'title', label: 'Title', kind: 'text', placeholder: 'Approve invoice {{input.invoice}}' },
    { key: 'description', label: 'Instructions', kind: 'textarea' },
    { key: 'priority', label: 'Priority', kind: 'select', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']] },
    { key: 'outcomes', label: 'Outcome buttons', kind: 'list', placeholder: 'approve, reject' },
    { key: 'formFields', label: 'Form fields', kind: 'json', placeholder: '[{ "name": "amount", "label": "Approved amount", "type": "number", "required": true }]', help: 'Field types: text, textarea, number, date, select (with options), checkbox, email.' },
    { key: 'data', label: 'Data shown to the user', kind: 'json', placeholder: '{ "invoice": "{{input.invoice}}" }' },
    { key: 'assignedRole', label: 'Assign to role', kind: 'select', options: [['', 'Anyone who can complete tasks'], ['operator', 'Operator'], ['automation_developer', 'Automation developer'], ['project_manager', 'Project manager']] },
    { key: 'assignee', label: 'Or assign to user (email)', kind: 'text' },
    { key: 'dueInHours', label: 'Due in (hours)', kind: 'number' },
    { key: 'requireCommentOnReject', label: 'Require a comment to reject', kind: 'checkbox' },
    { key: 'waitForCompletion', label: 'Pause the job until completed', kind: 'checkbox', defaultValue: true },
  ],
  wait_for_task: [{ key: 'taskId', label: 'Task id', kind: 'text', placeholder: '{{steps.create_task_1.taskId}}' }],
  http_request: [
    { key: 'connectionId', label: 'Connection', kind: 'connection', connectorTypes: ['rest_api'] },
    { key: 'method', label: 'Method', kind: 'select', options: [['GET', 'GET'], ['POST', 'POST'], ['PUT', 'PUT'], ['PATCH', 'PATCH'], ['DELETE', 'DELETE']] },
    { key: 'path', label: 'Path', kind: 'text', placeholder: '/orders' },
    { key: 'query', label: 'Query parameters', kind: 'json', placeholder: '{ "page": 1 }' },
    { key: 'headers', label: 'Headers', kind: 'json', placeholder: '{ "X-Trace": "{{input.id}}" }' },
    { key: 'bodyType', label: 'Body type', kind: 'select', options: [['json', 'JSON'], ['form', 'Form (urlencoded)'], ['text', 'Text']] },
    { key: 'body', label: 'Body', kind: 'json' },
    { key: 'failOnError', label: 'Fail on HTTP error status', kind: 'checkbox', defaultValue: true },
  ],
  database_query: [
    { key: 'connectionId', label: 'Connection', kind: 'connection', connectorTypes: ['mysql', 'postgres'] },
    { key: 'operation', label: 'Operation', kind: 'select', options: [['select_rows', 'Select rows'], ['count_rows', 'Count rows'], ['insert_row', 'Insert row'], ['update_rows', 'Update rows'], ['run_query', 'Run query (SQL)']] },
    { key: 'table', label: 'Table', kind: 'text' },
    { key: 'filters', label: 'Filters', kind: 'json', placeholder: '[{ "column": "status", "op": "eq", "value": "open" }]' },
    { key: 'row', label: 'Row values', kind: 'json' },
    { key: 'query', label: 'SQL (run_query)', kind: 'textarea', placeholder: 'SELECT * FROM orders WHERE id = ?' },
    { key: 'parameters', label: 'Parameters', kind: 'json', placeholder: '["{{input.id}}"]' },
  ],
  sheets_read_range: [
    { key: 'connectionId', label: 'Connection', kind: 'connection', connectorTypes: ['google_sheets'] },
    { key: 'range', label: 'Range', kind: 'text', placeholder: 'Sheet1!A1:D100' },
    { key: 'headerRow', label: 'First row is a header', kind: 'checkbox', defaultValue: true },
  ],
  sheets_append_rows: [
    { key: 'connectionId', label: 'Connection', kind: 'connection', connectorTypes: ['google_sheets'] },
    { key: 'range', label: 'Range', kind: 'text', placeholder: 'Sheet1!A1' },
    { key: 'rows', label: 'Rows', kind: 'text', placeholder: '{{steps.previous.rows}}' },
    { key: 'columns', label: 'Columns (order)', kind: 'list' },
  ],
  sheets_update_range: [
    { key: 'connectionId', label: 'Connection', kind: 'connection', connectorTypes: ['google_sheets'] },
    { key: 'range', label: 'Range', kind: 'text', placeholder: 'Sheet1!B2' },
    { key: 'values', label: 'Values', kind: 'json', placeholder: '[["Done"]]' },
  ],
};

export function fieldsFor(type) {
  return ACTIVITY_FIELDS[type] || null;
}

/** Applies one field change and drops empty values so the JSON stays small. */
export function setConfigValue(config, key, value) {
  const next = { ...config };
  if (value === '' || value === undefined || (Array.isArray(value) && value.length === 0 && key !== 'formFields')) delete next[key];
  else next[key] = value;
  return next;
}

export function parseList(text) {
  return String(text || '').split(',').map((item) => item.trim()).filter(Boolean);
}
