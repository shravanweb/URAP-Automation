// App definitions: pages of components on a 12-column grid, data sources, variables, and the
// actions that buttons and forms run. Pure functions only (no database), so the designer, the
// runtime renderer, and the backend publish checks share the same rules. The frontend keeps a
// copy in frontend/src/lib/appDefinition.js.
//
// { pages: [{ id, name, inputs: [name], components: [Component] }],
//   dataSources: [{ id, name, type, config, autoLoad }],
//   variables: [{ name, defaultValue }] }
// Component: { id, type, span, props, visibleWhen?: { path, op, value }, children?: [Component],
//              events?: { onClick | onSubmit: [Action] } }
// Action: { id, type, config, resultVar? }
// Bindings: "{{app.user.name}}", "{{page.inputs.invoiceId}}", "{{data.recentJobs.rows}}",
//           "{{inputs.amount}}", "{{vars.score.output}}", "{{result.status}}" (previous action).

export const NAME = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
export const SPANS = [3, 4, 6, 8, 12];
export const LIMITS = { pages: 30, componentsPerPage: 120, actions: 20, dataSources: 30, variables: 50 };
export const ACCESS_MODES = ['project', 'tenant', 'roles', 'users'];
export const APP_ROLES = ['administrator', 'project_manager', 'automation_developer', 'operator', 'viewer'];

export const COMPONENTS = {
  heading: { label: 'Heading', group: 'Display', icon: 'heading' },
  text: { label: 'Text', group: 'Display', icon: 'text' },
  image: { label: 'Image', group: 'Display', icon: 'image' },
  stat: { label: 'Metric', group: 'Display', icon: 'gauge' },
  status_badge: { label: 'Status badge', group: 'Display', icon: 'badge' },
  details: { label: 'Details', group: 'Display', icon: 'list' },
  divider: { label: 'Divider', group: 'Display', icon: 'divider' },
  text_input: { label: 'Text input', group: 'Inputs', icon: 'textInput', input: true },
  number: { label: 'Number', group: 'Inputs', icon: 'hash', input: true },
  date: { label: 'Date', group: 'Inputs', icon: 'calendar', input: true },
  dropdown: { label: 'Dropdown', group: 'Inputs', icon: 'chevronDown', input: true },
  checkbox: { label: 'Checkbox', group: 'Inputs', icon: 'check', input: true },
  file_upload: { label: 'File upload', group: 'Inputs', icon: 'upload', input: true },
  button: { label: 'Button', group: 'Actions', icon: 'cursor' },
  table: { label: 'Table', group: 'Data', icon: 'table' },
  agent_chat: { label: 'Agent chat', group: 'Data', icon: 'agent' },
  form: { label: 'Form', group: 'Layout', icon: 'form', container: true },
  card: { label: 'Card', group: 'Layout', icon: 'card', container: true },
};
export const COMPONENT_TYPES = Object.keys(COMPONENTS);
export const INPUT_TYPES = COMPONENT_TYPES.filter((type) => COMPONENTS[type].input);
export const CONTAINER_TYPES = COMPONENT_TYPES.filter((type) => COMPONENTS[type].container);

export const ACTIONS = {
  run_workflow: { label: 'Run workflow', server: true, icon: 'robot' },
  start_flow: { label: 'Start flow', server: true, icon: 'flow' },
  run_agent: { label: 'Run agent', server: true, icon: 'agent' },
  add_queue_item: { label: 'Add queue item', server: true, icon: 'queue' },
  create_task: { label: 'Create Action Center task', server: true, icon: 'tasks' },
  create_case: { label: 'Create case', server: true, icon: 'briefcase' },
  call_http: { label: 'Call REST connection', server: true, icon: 'api' },
  navigate: { label: 'Go to page', icon: 'arrow' },
  set_variable: { label: 'Set variable', icon: 'variable' },
  refresh_data: { label: 'Refresh data', icon: 'refresh' },
  show_toast: { label: 'Show message', icon: 'bell' },
};
export const ACTION_TYPES = Object.keys(ACTIONS);
export const SERVER_ACTIONS = ACTION_TYPES.filter((type) => ACTIONS[type].server);

export const SOURCES = {
  jobs: { label: 'Workflow jobs', filter: 'workflowId' },
  queue_items: { label: 'Queue items', filter: 'queueId' },
  tasks: { label: 'Action Center tasks' },
  flow_runs: { label: 'Flow runs', filter: 'flowId' },
  agent_runs: { label: 'Agent runs', filter: 'agentId' },
  http: { label: 'REST connection (GET)' },
};
export const SOURCE_TYPES = Object.keys(SOURCES);
export const CONDITION_OPS = ['truthy', 'falsy', 'eq', 'neq', 'gt', 'lt', 'contains', 'empty', 'not_empty'];
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const COLUMN_FORMATS = ['text', 'status', 'datetime', 'number', 'json'];
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'];

export function defaultSettings() {
  return { access: 'project', roles: [], userIds: [] };
}

export function emptyDefinition(name = 'My app') {
  return {
    pages: [{
      id: 'home',
      name: 'Home',
      inputs: [],
      components: [
        { id: 'heading1', type: 'heading', span: 12, props: { text: name, level: 1, align: 'left' } },
        { id: 'text1', type: 'text', span: 12, props: { text: 'Hi {{app.user.name}}. Add components from the left to build this page.', tone: 'muted', align: 'left' } },
      ],
    }],
    dataSources: [],
    variables: [],
  };
}

const INPUT_BASE = { text_input: 'text', number: 'number', date: 'date', dropdown: 'choice', checkbox: 'check', file_upload: 'file' };

/** Every component of a page (or definition), including the children of forms and cards. */
export function allComponents(target) {
  const pages = target?.pages ? target.pages : [target];
  const out = [];
  for (const page of pages) {
    for (const component of page?.components || []) {
      out.push(component);
      for (const child of component.children || []) out.push(child);
    }
  }
  return out;
}

export function uniqueId(base, taken) {
  const used = new Set(taken);
  for (let n = 1; ; n += 1) if (!used.has(`${base}${n}`)) return `${base}${n}`;
}

export function newComponent(type, takenIds = []) {
  const id = uniqueId(INPUT_BASE[type] || type.replace(/_(\w)/g, (_, c) => c.toUpperCase()), takenIds);
  const input = (label, extra = {}) => ({ name: id, label, defaultValue: '', required: false, helpText: '', ...extra });
  const props = {
    heading: { text: 'Heading', level: 2, align: 'left' },
    text: { text: 'Write something here. Use {{bindings}} to show data.', tone: 'default', align: 'left' },
    image: { src: '', alt: '', height: 180, fit: 'cover' },
    stat: { label: 'Metric', value: '0', hint: '', tone: 'default' },
    status_badge: { label: 'Status', value: 'SUCCEEDED' },
    details: { title: 'Details', value: '' },
    divider: {},
    text_input: input('Text', { placeholder: '', multiline: false, format: 'text', minLength: null, maxLength: null, pattern: '', patternMessage: '' }),
    number: input('Number', { placeholder: '', min: null, max: null, step: 1 }),
    date: input('Date'),
    dropdown: input('Choose one', { placeholder: 'Select…', optionsMode: 'static', options: [{ label: 'Option 1', value: 'option1' }, { label: 'Option 2', value: 'option2' }], optionsFrom: '', labelKey: 'name', valueKey: 'id' }),
    checkbox: input('I confirm', { defaultValue: false }),
    file_upload: input('Attachment', { accept: '.pdf,.png,.jpg,.jpeg,.csv,.xlsx,.txt,.json' }),
    button: { label: 'Button', variant: 'primary', align: 'left' },
    table: { title: '', rows: '', columns: [{ key: 'id', label: 'ID', format: 'text' }], pageSize: 10, emptyText: 'Nothing to show yet' },
    agent_chat: { agentId: '', title: 'Assistant', placeholder: 'Ask a question…', height: 420 },
    form: { title: 'Form', description: '', submitLabel: 'Submit', resetOnSubmit: true },
    card: { title: 'Card', description: '' },
  }[type];
  const component = { id, type, span: type === 'stat' ? 3 : 12, props: props ? structuredCloneSafe(props) : {} };
  if (COMPONENTS[type]?.container) component.children = [];
  if (type === 'button') component.events = { onClick: [] };
  if (type === 'form') component.events = { onSubmit: [] };
  return component;
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

export function newAction(type, takenIds = []) {
  const id = uniqueId('a', takenIds);
  const config = {
    run_workflow: { workflowId: '', inputs: [], wait: true, timeoutSeconds: 120 },
    start_flow: { flowId: '', inputs: [], wait: false, timeoutSeconds: 120 },
    run_agent: { agentId: '', inputs: [], message: '', wait: true, timeoutSeconds: 120 },
    add_queue_item: { queueId: '', reference: '', content: [], priority: 'medium' },
    create_task: { title: 'Review request', description: '', priority: 'medium', assignedRole: '', data: [] },
    create_case: { caseTypeId: '', title: '', fields: [], priority: '' },
    call_http: { connectionId: '', method: 'GET', path: '/', query: [], body: [] },
    navigate: { pageId: '', inputs: [] },
    set_variable: { name: '', value: '' },
    refresh_data: { sourceId: '' },
    show_toast: { message: 'Done', tone: 'success' },
  }[type] || {};
  return { id, type, config: structuredCloneSafe(config), resultVar: '' };
}

export function newDataSource(type, existing = []) {
  const base = { jobs: 'recentJobs', queue_items: 'queueItems', tasks: 'tasks', flow_runs: 'flowRuns', agent_runs: 'agentRuns', http: 'apiData' }[type] || 'source';
  const names = existing.map((item) => item.name);
  const name = names.includes(base) ? uniqueId(base, names) : base;
  const config = type === 'http' ? { connectionId: '', path: '/', query: [] } : { status: '', limit: 10, ...(SOURCES[type]?.filter ? { [SOURCES[type].filter]: '' } : {}) };
  return { id: uniqueId('ds', existing.map((item) => item.id)), name, type, config, autoLoad: true };
}

/** All actions of a component, by event. */
export function componentActions(component) {
  return Object.entries(component?.events || {}).flatMap(([event, actions]) => (Array.isArray(actions) ? actions.map((action) => ({ event, action })) : []));
}

/** Finds an action in a definition: { page, component, action } or null. */
export function findAction(definition, componentId, event, actionId) {
  for (const page of definition?.pages || []) {
    for (const component of allComponents(page)) {
      if (component.id !== componentId) continue;
      const action = (component.events?.[event] || []).find((item) => item.id === actionId);
      return action ? { page, component, action } : null;
    }
  }
  return null;
}

export function findComponent(definition, componentId) {
  for (const page of definition?.pages || []) {
    const component = allComponents(page).find((item) => item.id === componentId);
    if (component) return { page, component };
  }
  return null;
}

// ---- Bindings -----------------------------------------------------------------------------

const WHOLE = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;
const ANY = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function stripBraces(path) {
  const match = String(path ?? '').match(WHOLE);
  return (match ? match[1] : String(path ?? '')).trim();
}

export function resolvePath(context, path) {
  const parts = stripBraces(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let value = context;
  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
    value = value[part];
  }
  return value;
}

/** "{{a.b}}" returns the raw value (object, array, number); mixed text interpolates strings. */
export function renderTemplate(template, context) {
  if (typeof template !== 'string') return template;
  const whole = template.match(WHOLE);
  if (whole) return resolvePath(context, whole[1]);
  if (!template.includes('{{')) return template;
  return template.replace(ANY, (_, path) => {
    const value = resolvePath(context, path);
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

/** [{ key, value }] mapping -> { key: rendered value }. */
export function renderMapping(mapping, context) {
  const out = {};
  for (const row of Array.isArray(mapping) ? mapping : []) {
    if (row && NAME.test(String(row.key || ''))) out[row.key] = renderTemplate(row.value ?? '', context);
  }
  return out;
}

export function isEmptyValue(value) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0) || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

export function evaluateCondition(condition, context) {
  if (!condition || !condition.path) return true;
  const left = resolvePath(context, condition.path);
  const right = renderTemplate(condition.value ?? '', context);
  switch (condition.op || 'truthy') {
    case 'truthy': return Boolean(left) && !isEmptyValue(left);
    case 'falsy': return !left || isEmptyValue(left);
    case 'eq': return String(left ?? '') === String(right ?? '');
    case 'neq': return String(left ?? '') !== String(right ?? '');
    case 'gt': return Number(left) > Number(right);
    case 'lt': return Number(left) < Number(right);
    case 'contains': return Array.isArray(left) ? left.map(String).includes(String(right)) : String(left ?? '').toLowerCase().includes(String(right ?? '').toLowerCase());
    case 'empty': return isEmptyValue(left);
    case 'not_empty': return !isEmptyValue(left);
    default: return true;
  }
}

/** Validation message for an input component's value, or null when it is fine. */
export function validateFieldValue(component, value) {
  const props = component?.props || {};
  const label = props.label || props.name || 'This field';
  const empty = component.type === 'checkbox' ? value !== true : isEmptyValue(value);
  if (props.required && empty) return component.type === 'checkbox' ? `${label} must be checked` : `${label} is required`;
  if (empty) return null;
  if (component.type === 'text_input') {
    const text = String(value);
    if (props.minLength && text.length < Number(props.minLength)) return `${label} needs at least ${props.minLength} characters`;
    if (props.maxLength && text.length > Number(props.maxLength)) return `${label} can have at most ${props.maxLength} characters`;
    if (props.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return `${label} must be an email address`;
    if (props.pattern) {
      let regex = null;
      try { regex = new RegExp(`^(?:${props.pattern})$`); } catch { regex = null; }
      if (regex && !regex.test(text)) return props.patternMessage || `${label} is not in the expected format`;
    }
  }
  if (component.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) return `${label} must be a number`;
    if (props.min !== null && props.min !== '' && props.min !== undefined && number < Number(props.min)) return `${label} must be at least ${props.min}`;
    if (props.max !== null && props.max !== '' && props.max !== undefined && number > Number(props.max)) return `${label} must be at most ${props.max}`;
  }
  if (component.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return `${label} must be a date`;
  return null;
}

/** Names of the data sources a template refers to ("{{data.recentJobs.rows}}" -> recentJobs). */
export function referencedSources(text) {
  const names = new Set();
  for (const match of String(text ?? '').matchAll(/\{\{\s*data\.([A-Za-z][A-Za-z0-9_]*)/g)) names.add(match[1]);
  return [...names];
}

// ---- Validation ---------------------------------------------------------------------------

/**
 * Returns { errors, warnings }; items are { pageId?, componentId?, actionId?, sourceId?, field?, message }.
 * `lookups` (optional; the backend always passes it on publish) adds existence checks:
 * { workflows, flows, agents, queues, connections: Map(id -> row with name/status) }.
 */
export function validateAppDefinition(definition, lookups = null) {
  const errors = [];
  const warnings = [];
  const add = (list, message, ref = {}) => list.push({ ...ref, message });
  if (!definition || !Array.isArray(definition.pages)) return { errors: [{ message: 'The app has no pages' }], warnings };
  const pages = definition.pages;
  const sources = Array.isArray(definition.dataSources) ? definition.dataSources : [];
  const variables = Array.isArray(definition.variables) ? definition.variables : [];
  if (!pages.length) add(errors, 'Add at least one page');
  if (pages.length > LIMITS.pages) add(errors, `An app can have at most ${LIMITS.pages} pages`);
  if (sources.length > LIMITS.dataSources) add(errors, `An app can have at most ${LIMITS.dataSources} data sources`);
  if (variables.length > LIMITS.variables) add(errors, `An app can have at most ${LIMITS.variables} variables`);

  const pageIds = new Set();
  for (const page of pages) {
    if (!ID.test(String(page.id || ''))) add(errors, 'A page has an invalid id', { pageId: page.id });
    if (pageIds.has(page.id)) add(errors, `Two pages share the id ${page.id}`, { pageId: page.id });
    pageIds.add(page.id);
    if (!String(page.name || '').trim()) add(errors, 'Every page needs a name', { pageId: page.id, field: 'name' });
    for (const name of page.inputs || []) if (!NAME.test(String(name))) add(errors, `Page input "${name}" must start with a letter and use letters, digits, or _`, { pageId: page.id, field: 'inputs' });
  }

  const sourceNames = new Set();
  const sourceIds = new Set();
  for (const source of sources) {
    const ref = { sourceId: source.id };
    const label = source.name || 'A data source';
    if (!ID.test(String(source.id || '')) || sourceIds.has(source.id)) add(errors, `${label} has a missing or duplicate id`, ref);
    sourceIds.add(source.id);
    if (!NAME.test(String(source.name || ''))) add(errors, `Data source name "${source.name || ''}" must start with a letter and use letters, digits, or _`, { ...ref, field: 'name' });
    else if (sourceNames.has(source.name)) add(errors, `Two data sources are named ${source.name}`, { ...ref, field: 'name' });
    sourceNames.add(source.name);
    if (!SOURCE_TYPES.includes(source.type)) { add(errors, `${label}: unknown type ${source.type}`, ref); continue; }
    const config = source.config || {};
    if (source.type === 'http') {
      if (!config.connectionId) add(errors, `${label}: pick a REST connection`, { ...ref, field: 'connectionId' });
      else if (lookups?.connections && !lookups.connections.has(config.connectionId)) add(errors, `${label}: pick a REST API connection from this project`, { ...ref, field: 'connectionId' });
      if (!safePath(config.path)) add(errors, `${label}: the path must start with / and stay on the connection's host`, { ...ref, field: 'path' });
    } else {
      const limit = Number(config.limit ?? 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) add(errors, `${label}: show 1 to 100 rows`, { ...ref, field: 'limit' });
      const filter = SOURCES[source.type].filter;
      const map = filter && lookups ? { workflowId: lookups.workflows, queueId: lookups.queues, flowId: lookups.flows, agentId: lookups.agents }[filter] : null;
      if (filter && config[filter] && map && !map.has(config[filter])) add(errors, `${label}: the selected item is not in this project`, { ...ref, field: filter });
    }
  }

  const variableNames = new Set();
  for (const variable of variables) {
    if (!NAME.test(String(variable.name || ''))) add(errors, `Variable "${variable.name || ''}" must start with a letter and use letters, digits, or _`, { field: 'variables' });
    else if (variableNames.has(variable.name)) add(errors, `Two variables are named ${variable.name}`, { field: 'variables' });
    variableNames.add(variable.name);
  }

  const componentIds = new Set();
  const actionIds = new Set();
  for (const page of pages) {
    const inputNames = new Set();
    const components = Array.isArray(page.components) ? page.components : [];
    if (allComponents(page).length > LIMITS.componentsPerPage) add(errors, `${page.name}: at most ${LIMITS.componentsPerPage} components per page`, { pageId: page.id });
    const visit = (component, parent) => {
      const ref = { pageId: page.id, componentId: component.id };
      const meta = COMPONENTS[component.type];
      const label = componentLabel(component);
      if (!ID.test(String(component.id || ''))) add(errors, 'A component has an invalid id', ref);
      if (componentIds.has(component.id)) add(errors, `Two components share the id ${component.id}`, ref);
      componentIds.add(component.id);
      if (!meta) { add(errors, `Unknown component type ${component.type}`, ref); return; }
      if (parent && meta.container) add(errors, `${label}: forms and cards cannot be placed inside ${componentLabel(parent)}`, ref);
      if (component.children && !meta.container) add(errors, `${label} cannot hold other components`, ref);
      if (component.span !== undefined && !SPANS.includes(Number(component.span))) add(errors, `${label}: width must be one of ${SPANS.join(', ')} columns`, { ...ref, field: 'span' });
      const props = component.props || {};
      if (meta.input) {
        if (!NAME.test(String(props.name || ''))) add(errors, `${label}: the field name must start with a letter and use letters, digits, or _`, { ...ref, field: 'name' });
        else if (inputNames.has(props.name)) add(errors, `Two fields on ${page.name} are named ${props.name}`, { ...ref, field: 'name' });
        inputNames.add(props.name);
      }
      switch (component.type) {
        case 'image': if (!String(props.src || '').trim()) add(errors, `${label}: add an image URL`, { ...ref, field: 'src' }); break;
        case 'button': if (!String(props.label || '').trim()) add(errors, `${label}: add a label`, { ...ref, field: 'label' }); if (!(component.events?.onClick || []).length) add(warnings, `${label} does nothing yet: add an action`, { ...ref, field: 'events' }); break;
        case 'table': if (!String(props.rows || '').trim()) add(errors, `${label}: bind the rows, e.g. {{data.recentJobs.rows}}`, { ...ref, field: 'rows' }); if (!(props.columns || []).length) add(warnings, `${label} has no columns`, { ...ref, field: 'columns' }); break;
        case 'dropdown':
          if ((props.optionsMode || 'static') === 'static' && !(props.options || []).length) add(errors, `${label}: add at least one option`, { ...ref, field: 'options' });
          if (props.optionsMode === 'bound' && !String(props.optionsFrom || '').trim()) add(errors, `${label}: bind the options, e.g. {{data.queueItems.rows}}`, { ...ref, field: 'optionsFrom' });
          break;
        case 'number': if (props.min !== null && props.min !== '' && props.max !== null && props.max !== '' && props.min !== undefined && props.max !== undefined && Number(props.min) > Number(props.max)) add(errors, `${label}: minimum is greater than maximum`, { ...ref, field: 'min' }); break;
        case 'text_input': if (props.pattern) { try { new RegExp(props.pattern); } catch { add(errors, `${label}: the pattern is not a valid regular expression`, { ...ref, field: 'pattern' }); } } break;
        case 'form': if (!(component.children || []).some((child) => COMPONENTS[child.type]?.input)) add(warnings, `${label} has no input fields`, ref); if (!(component.events?.onSubmit || []).length) add(warnings, `${label} does nothing on submit yet`, { ...ref, field: 'events' }); break;
        case 'agent_chat': {
          if (!props.agentId) { add(errors, `${label}: pick an agent`, { ...ref, field: 'agentId' }); break; }
          const agent = lookups?.agents?.get(props.agentId);
          if (lookups?.agents && !agent) add(errors, `${label}: the agent is not in this project`, { ...ref, field: 'agentId' });
          else if (agent && agent.status !== 'published') add(errors, `${label}: ${agent.name} must be published before the app can use it`, { ...ref, field: 'agentId' });
          else if (agent && agent.agent_type && agent.agent_type !== 'conversational') add(errors, `${label}: ${agent.name} is not a conversational agent`, { ...ref, field: 'agentId' });
          break;
        }
        default: break;
      }
      if (component.visibleWhen && component.visibleWhen.path) {
        if (!CONDITION_OPS.includes(component.visibleWhen.op || 'truthy')) add(errors, `${label}: unknown visibility operator`, { ...ref, field: 'visibleWhen' });
      }
      for (const text of Object.values(props)) {
        if (typeof text !== 'string') continue;
        for (const name of referencedSources(text)) if (!sourceNames.has(name)) add(warnings, `${label} refers to an unknown data source "${name}"`, ref);
      }
      for (const [event, actions] of Object.entries(component.events || {})) {
        if (!Array.isArray(actions)) continue;
        if (actions.length > LIMITS.actions) add(errors, `${label}: at most ${LIMITS.actions} actions per event`, ref);
        for (const action of actions) validateAction(action, { ...ref, event, actionId: action.id }, { errors, warnings, add, lookups, pageIds, sourceIds, actionIds, label });
      }
      for (const child of component.children || []) visit(child, component);
    };
    for (const component of components) visit(component, null);
  }
  return { errors, warnings };
}

export function componentLabel(component) {
  const props = component?.props || {};
  const name = COMPONENTS[component?.type]?.label || component?.type || 'Component';
  const text = props.label || props.title || (component?.type === 'heading' ? props.text : '');
  return text ? `${name} “${String(text).slice(0, 40)}”` : `${name} ${component?.id || ''}`.trim();
}

export function safePath(path) {
  const text = String(path ?? '');
  const head = text.split('{{')[0];
  return head.startsWith('/') && !head.startsWith('//') && !/:\/\/|\.\.|\\/.test(head);
}

function validateMapping(mapping, ref, ctx, field) {
  const keys = new Set();
  for (const row of Array.isArray(mapping) ? mapping : []) {
    if (!NAME.test(String(row?.key || ''))) ctx.add(ctx.errors, `${ctx.label}: "${row?.key || ''}" is not a valid field name`, { ...ref, field });
    else if (keys.has(row.key)) ctx.add(ctx.errors, `${ctx.label}: ${row.key} is mapped twice`, { ...ref, field });
    keys.add(row?.key);
  }
}

function validateAction(action, ref, ctx) {
  const { errors, warnings, add, lookups } = ctx;
  if (!action || !ID.test(String(action.id || ''))) { add(errors, `${ctx.label}: an action has an invalid id`, ref); return; }
  if (ctx.actionIds.has(`${ref.componentId}:${ref.event}:${action.id}`)) add(errors, `${ctx.label}: two actions share the id ${action.id}`, ref);
  ctx.actionIds.add(`${ref.componentId}:${ref.event}:${action.id}`);
  if (!ACTION_TYPES.includes(action.type)) { add(errors, `${ctx.label}: unknown action ${action.type}`, ref); return; }
  if (action.resultVar && !NAME.test(action.resultVar)) add(errors, `${ctx.label}: result variable "${action.resultVar}" must start with a letter and use letters, digits, or _`, { ...ref, field: 'resultVar' });
  const config = action.config || {};
  const what = `${ctx.label} → ${ACTIONS[action.type].label}`;
  const published = (map, id, noun, field) => {
    if (!id) { add(errors, `${what}: pick a ${noun}`, { ...ref, field }); return; }
    if (!map) return;
    const row = map.get(id);
    if (!row) add(errors, `${what}: the ${noun} is not in this project`, { ...ref, field });
    else if (row.status !== 'published') add(errors, `${what}: ${row.name} must be published before the app can run it`, { ...ref, field });
  };
  switch (action.type) {
    case 'run_workflow': published(lookups?.workflows, config.workflowId, 'workflow', 'workflowId'); validateMapping(config.inputs, ref, { ...ctx, label: what }, 'inputs'); break;
    case 'start_flow': published(lookups?.flows, config.flowId, 'flow', 'flowId'); validateMapping(config.inputs, ref, { ...ctx, label: what }, 'inputs'); break;
    case 'run_agent': {
      published(lookups?.agents, config.agentId, 'agent', 'agentId');
      const agent = lookups?.agents?.get(config.agentId);
      if (agent?.agent_type === 'conversational' && !String(config.message || '').trim()) add(errors, `${what}: write the message to send`, { ...ref, field: 'message' });
      validateMapping(config.inputs, ref, { ...ctx, label: what }, 'inputs');
      break;
    }
    case 'add_queue_item':
      if (!config.queueId) add(errors, `${what}: pick a queue`, { ...ref, field: 'queueId' });
      else if (lookups?.queues && !lookups.queues.has(config.queueId)) add(errors, `${what}: the queue is not in this project`, { ...ref, field: 'queueId' });
      validateMapping(config.content, ref, { ...ctx, label: what }, 'content');
      break;
    case 'create_task':
      if (!String(config.title || '').trim()) add(errors, `${what}: add a task title`, { ...ref, field: 'title' });
      if (config.priority && !TASK_PRIORITIES.includes(config.priority)) add(errors, `${what}: unknown priority`, { ...ref, field: 'priority' });
      validateMapping(config.data, ref, { ...ctx, label: what }, 'data');
      break;
    case 'create_case':
      published(lookups?.caseTypes, config.caseTypeId, 'case type', 'caseTypeId');
      if (config.priority && !TASK_PRIORITIES.includes(config.priority)) add(errors, `${what}: unknown priority`, { ...ref, field: 'priority' });
      validateMapping(config.fields, ref, { ...ctx, label: what }, 'fields');
      break;
    case 'call_http':
      if (!config.connectionId) add(errors, `${what}: pick a REST connection`, { ...ref, field: 'connectionId' });
      else if (lookups?.connections && !lookups.connections.has(config.connectionId)) add(errors, `${what}: pick a REST API connection from this project`, { ...ref, field: 'connectionId' });
      if (!HTTP_METHODS.includes(config.method || 'GET')) add(errors, `${what}: unknown method`, { ...ref, field: 'method' });
      if (!safePath(config.path)) add(errors, `${what}: the path must start with / and stay on the connection's host`, { ...ref, field: 'path' });
      validateMapping(config.query, ref, { ...ctx, label: what }, 'query');
      validateMapping(config.body, ref, { ...ctx, label: what }, 'body');
      break;
    case 'navigate':
      if (!config.pageId) add(errors, `${what}: pick a page`, { ...ref, field: 'pageId' });
      else if (!ctx.pageIds.has(config.pageId)) add(errors, `${what}: the page no longer exists`, { ...ref, field: 'pageId' });
      validateMapping(config.inputs, ref, { ...ctx, label: what }, 'inputs');
      break;
    case 'set_variable': if (!NAME.test(String(config.name || ''))) add(errors, `${what}: name the variable (letters, digits, _)`, { ...ref, field: 'name' }); break;
    case 'refresh_data':
      if (!config.sourceId) add(errors, `${what}: pick a data source`, { ...ref, field: 'sourceId' });
      else if (!ctx.sourceIds.has(config.sourceId)) add(errors, `${what}: the data source no longer exists`, { ...ref, field: 'sourceId' });
      break;
    case 'show_toast': if (!String(config.message || '').trim()) add(warnings, `${what}: the message is empty`, { ...ref, field: 'message' }); break;
    default: break;
  }
}

/** Who may open a published app. `membership` is the user's project role or null. */
export function canOpenApp(user, settings, membership) {
  if (!user) return false;
  if (user.role === 'administrator') return true;
  if (membership && ['project_manager', 'automation_developer'].includes(user.role)) return true;
  const access = settings?.access || 'project';
  if (access === 'tenant') return true;
  if (access === 'project') return Boolean(membership);
  if (access === 'roles') return (settings.roles || []).includes(user.role);
  if (access === 'users') return (settings.userIds || []).includes(user.id);
  return false;
}
