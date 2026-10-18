import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { Route, Routes } from 'react-router-dom';
import { StaticRouter } from 'react-router-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppPageView, ComponentBody, formatCell, statusTone } from '../components/AppRenderer.jsx';
import { AccessDialog, ComponentProperties, DataPanel, Palette } from '../components/AppDesignerPanels.jsx';
import { emptyDefinition, newAction, newComponent, newDataSource, validateAppDefinition } from '../lib/appDefinition.js';
import { bindingSuggestions, duplicateComponent, findInPage, insertComponent, moveComponent, removeComponent, updateComponent } from '../lib/appDesign.js';
import { actionPayload, defaultValues, runActionChain, settleResult, validateForm } from '../lib/useAppEngine.js';
import AppDesignerPage from './AppDesignerPage.jsx';
import AppRuntimePage from './AppRuntimePage.jsx';
import AppsPage, { AppCard } from './AppsPage.jsx';
import { AppsTable, NewAppDialog, START_OPTIONS, StartBuildingModal } from './StudioPage.jsx';

beforeAll(() => {
  const store = new Map([['urap.user', JSON.stringify({ id: 'u1', role: 'administrator', displayName: 'Shravan' })], ['urap.access', 'token']]);
  globalThis.sessionStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) };
});

const WORKFLOW = 'c259ae39-9831-4586-b758-3ca2a5331b17';
const lookups = {
  workflows: new Map([[WORKFLOW, { id: WORKFLOW, name: 'Score invoice', status: 'published' }], ['draft-wf', { id: 'draft-wf', name: 'Draft one', status: 'draft' }]]),
  flows: new Map(), agents: new Map(), queues: new Map(), connections: new Map(),
};

function intakeApp() {
  const definition = emptyDefinition('Invoice intake');
  const page = definition.pages[0];
  const form = { ...newComponent('form', ['heading1', 'text1']), span: 8 };
  const invoice = { ...newComponent('text_input', ['heading1', 'text1', form.id]), id: 'invoice1', props: { ...newComponent('text_input', []).props, name: 'invoiceId', label: 'Invoice number', required: true, pattern: 'INV-[0-9]+', patternMessage: 'Use INV-123' } };
  const amount = { ...newComponent('number', []), id: 'amount1', props: { ...newComponent('number', []).props, name: 'amount', label: 'Amount', min: 0 } };
  const owner = { ...newComponent('text_input', []), id: 'owner1', props: { ...newComponent('text_input', []).props, name: 'owner', label: 'Owner', defaultValue: '{{app.user.name}}' } };
  const hidden = { ...newComponent('text_input', []), id: 'reason1', visibleWhen: { path: 'inputs.amount', op: 'gt', value: '1000' }, props: { ...newComponent('text_input', []).props, name: 'reason', label: 'Reason', required: true } };
  form.children = [invoice, amount, owner, hidden];
  form.events.onSubmit = [
    { ...newAction('run_workflow', []), config: { workflowId: WORKFLOW, inputs: [{ key: 'invoiceId', value: '{{inputs.invoiceId}}' }, { key: 'amount', value: '{{inputs.amount}}' }], wait: true, timeoutSeconds: 60 }, resultVar: 'score' },
    { ...newAction('show_toast', ['a1']), config: { message: 'Scored {{vars.score.output.invoiceId}}', tone: 'success' } },
  ];
  const source = newDataSource('jobs', []);
  const table = { ...newComponent('table', []), props: { ...newComponent('table', []).props, title: 'Recent jobs', rows: `{{data.${source.name}.rows}}`, columns: [{ key: 'workflow', label: 'Workflow' }, { key: 'status', label: 'Status', format: 'status' }] } };
  const details = { ...newComponent('details', []), span: 4, props: { title: 'Result', value: '{{vars.score.output}}' } };
  page.components.push(form, details, table);
  definition.dataSources = [source];
  return definition;
}

function fakeEngine(overrides = {}) {
  return {
    interactive: true, values: {}, errors: {}, busy: {}, data: {}, chats: {}, isVisible: () => true,
    setValue: () => {}, submitForm: async () => true, runActions: async () => true, sendChat: async () => {}, uploadFile: async () => {},
    context: { app: { name: 'Invoice intake', user: { name: 'Shravan' } }, page: { inputs: {} }, inputs: {}, vars: {}, data: {} },
    ...overrides,
  };
}

describe('app definition', () => {
  it('keeps the frontend copy in sync with the backend validator', () => {
    const strip = (text) => text.replace(/\r\n/g, '\n').split('\n').filter((line) => !line.startsWith('// Copy of backend') && !line.startsWith('// Keep the two files')).join('\n').trim();
    const backend = readFileSync(new URL('../../../backend/src/app/definition.js', import.meta.url), 'utf8');
    const frontend = readFileSync(new URL('../lib/appDefinition.js', import.meta.url), 'utf8');
    expect(strip(frontend)).toBe(strip(backend));
  });

  it('validates an app the same way publish does', () => {
    const definition = intakeApp();
    expect(validateAppDefinition(definition, lookups).errors).toEqual([]);
    const form = findInPage(definition.pages[0], 'form1').component;
    form.events.onSubmit[0].config.workflowId = 'draft-wf';
    form.children[1].props.name = 'invoiceId';
    const messages = validateAppDefinition(definition, lookups).errors.map((item) => item.message);
    expect(messages.some((message) => message.includes('Draft one must be published before the app can run it'))).toBe(true);
    expect(messages).toContain('Two fields on Home are named invoiceId');
  });
});

describe('designer operations', () => {
  it('inserts, moves, duplicates, updates and removes components', () => {
    const definition = intakeApp();
    let page = definition.pages[0];
    const button = newComponent('button', ['heading1']);
    page = insertComponent(page, button, 'form1', 1);
    expect(findInPage(page, button.id).parent.id).toBe('form1');
    const card = newComponent('card', ['form1']);
    page = insertComponent(page, card, 'form1', 0);
    expect(findInPage(page, card.id).parent).toBe(null);
    page = moveComponent(page, button.id, null, 0);
    expect(page.components[0].id).toBe(button.id);
    const copy = duplicateComponent(page, 'invoice1', { pages: [page] });
    expect(findInPage(copy.page, copy.id).component.props.name).not.toBe('invoiceId');
    page = updateComponent(copy.page, button.id, { span: 6 });
    expect(findInPage(page, button.id).component.span).toBe(6);
    page = removeComponent(page, button.id);
    expect(findInPage(page, button.id)).toBe(null);
  });

  it('suggests bindings from fields, data sources and result variables', () => {
    const definition = intakeApp();
    const paths = bindingSuggestions(definition, definition.pages[0]).map((item) => item.path);
    expect(paths).toEqual(expect.arrayContaining(['app.user.name', 'inputs.invoiceId', 'data.recentJobs.rows', 'vars.score']));
  });
});

describe('runtime', () => {
  it('fills defaults and validates only the visible fields', () => {
    const definition = intakeApp();
    const form = findInPage(definition.pages[0], 'form1').component;
    const values = defaultValues(definition.pages[0], { app: { user: { name: 'Shravan' } } });
    expect(values).toMatchObject({ invoiceId: '', amount: '', owner: 'Shravan' });
    const isVisible = (field) => field.id !== 'reason1';
    expect(validateForm(form, values, { isVisible })).toEqual({ invoice1: 'Invoice number is required' });
    expect(validateForm(form, { ...values, invoiceId: 'abc' }, { isVisible }).invoice1).toBe('Use INV-123');
    expect(validateForm(form, { ...values, invoiceId: 'INV-7' }, { isVisible })).toEqual({});
    expect(validateForm(form, { ...values, invoiceId: 'INV-7' }).reason1).toBe('Reason is required');
  });

  it('submits: runs the workflow with mapped inputs, waits for the result, then shows it', async () => {
    const definition = intakeApp();
    const form = findInPage(definition.pages[0], 'form1').component;
    const state = { inputs: { invoiceId: 'INV-7', amount: 250 }, vars: {} };
    const calls = [];
    const toasts = [];
    const polls = [];
    await runActionChain(form.events.onSubmit, {
      getContext: (extra) => ({ app: {}, page: {}, inputs: state.inputs, vars: state.vars, data: {}, ...extra }),
      runServer: async (action, payload) => {
        calls.push({ type: action.type, payload });
        return settleResult(action, { kind: 'job', id: 'j1', status: 'QUEUED', done: false }, async (kind, id) => {
          polls.push(`${kind}:${id}`);
          return polls.length < 2 ? { kind, id, status: 'RUNNING', done: false } : { kind, id, status: 'SUCCEEDED', done: true, output: { invoiceId: 'INV-7', score: 82 } };
        }, { wait: async () => {} });
      },
      navigate: () => {}, refresh: async () => null,
      setVariable: (name, value) => { state.vars = { ...state.vars, [name]: value }; },
      toast: (message, tone) => toasts.push([message, tone]),
    });
    expect(calls).toEqual([{ type: 'run_workflow', payload: { inputs: { invoiceId: 'INV-7', amount: 250 } } }]);
    expect(polls).toEqual(['job:j1', 'job:j1']);
    expect(state.vars.score.output.score).toBe(82);
    expect(toasts).toEqual([['Scored INV-7', 'success']]);
  });

  it('stops the chain and reports a failed run', async () => {
    const action = { ...newAction('run_workflow', []), config: { workflowId: WORKFLOW, inputs: [] } };
    await expect(settleResult(action, { kind: 'job', id: 'j2', status: 'FAILED', done: true, error: 'Bad input' }, async () => null)).rejects.toThrow('Run workflow failed: Bad input');
    const toasts = [];
    await expect(runActionChain([action, { ...newAction('show_toast', ['a1']), config: { message: 'never' } }], {
      getContext: () => ({}), runServer: async () => { throw new Error('nope'); }, toast: (message) => toasts.push(message), setVariable: () => {},
    })).rejects.toThrow('nope');
    expect(toasts).toEqual([]);
    expect(actionPayload({ type: 'create_task', config: { title: 'Review {{inputs.id}}', data: [{ key: 'id', value: '{{inputs.id}}' }] } }, { inputs: { id: 7 } })).toEqual({ title: 'Review 7', description: '', data: { id: 7 } });
  });

  it('renders the page: form fields, results, and a bound table', () => {
    const definition = intakeApp();
    const engine = fakeEngine({
      values: { invoiceId: 'INV-7', amount: 250, owner: 'Shravan' },
      errors: { amount1: 'Amount must be at least 0' },
      context: { app: { user: { name: 'Shravan' } }, page: { inputs: {} }, inputs: {}, vars: { score: { output: { invoiceId: 'INV-7', score: 82 } } }, data: { recentJobs: { rows: [{ id: 'j1', workflow: 'Score invoice', status: 'SUCCEEDED' }], count: 1, loadedAt: 'now' } } },
      isVisible: (component) => component.id !== 'reason1',
    });
    const html = renderToStaticMarkup(<AppPageView page={definition.pages[0]} engine={engine} />);
    expect(html).toContain('Invoice number');
    expect(html).toContain('value="INV-7"');
    expect(html).toContain('Amount must be at least 0');
    expect(html).not.toContain('Reason');
    expect(html).toContain('Score invoice');
    expect(html).toContain('82');
    expect(html).toContain('Recent jobs');
    const design = renderToStaticMarkup(<AppPageView page={definition.pages[0]} engine={fakeEngine()} design={{ selectedId: 'form1', onSelect: () => {}, dropTarget: null, setDropTarget: () => {}, dragging: false, onDragStart: () => {}, onDragEnd: () => {}, onDrop: () => {} }} />);
    expect(design).toContain('Reason');
    expect(design).toContain('Conditional');
    const badge = renderToStaticMarkup(<ComponentBody component={{ id: 'b', type: 'status_badge', props: { label: 'Status', value: 'FAILED' } }} engine={fakeEngine()} ctx={{}} values={{}} />);
    expect(badge).toContain('Failed');
    expect(statusTone('SUCCEEDED')).not.toBe(statusTone('FAILED'));
    expect(formatCell('2026-10-18 08:00:00', 'datetime')).not.toBe('2026-10-18 08:00:00');
  });
});

describe('designer and studio screens', () => {
  const render = (path, element, route) => renderToStaticMarkup(<StaticRouter location={path}><Routes><Route path={route} element={element} /></Routes></StaticRouter>);

  it('shows loading states for the designer, runtime and directory', () => {
    expect(render('/studio/apps/a1', <AppDesignerPage />, '/studio/apps/:id')).toContain('Loading app…');
    expect(render('/apps/a1', <AppRuntimePage />, '/apps/:id')).toContain('Opening app…');
    expect(render('/apps', <AppsPage />, '/apps')).toContain('Custom apps published for you');
  });

  it('renders the palette, property panel, data panel and access dialog', () => {
    const definition = intakeApp();
    const palette = renderToStaticMarkup(<Palette onAdd={() => {}} onDragStart={() => {}} onDragEnd={() => {}} />);
    for (const label of ['Heading', 'Text input', 'Dropdown', 'File upload', 'Table', 'Form', 'Stat', 'Status badge', 'Button']) expect(palette).toContain(label);
    const lists = { workflows: [{ id: WORKFLOW, name: 'Score invoice', status: 'published' }], flows: [], agents: [], queues: [], connections: [], members: [], users: [] };
    const form = findInPage(definition.pages[0], 'form1').component;
    const props = renderToStaticMarkup(<ComponentProperties component={form} onChange={() => {}} onDelete={() => {}} onDuplicate={() => {}} lookups={lists} definition={definition} page={definition.pages[0]} suggestions={[]} validation={{ errors: [], warnings: [] }} />);
    expect(props).toContain('When submitted');
    expect(props).toContain('Run workflow');
    expect(props).toContain('Score invoice');
    expect(props).toContain('Visibility');
    const data = renderToStaticMarkup(<DataPanel definition={definition} onChange={() => {}} lookups={lists} validation={{ errors: [], warnings: [] }} engine={{ data: {} }} savedSources={[]} onLoad={() => {}} />);
    expect(data).toContain('recentJobs');
    expect(data).toContain('Variables');
    const access = renderToStaticMarkup(<AccessDialog app={{ id: 'a1', status: 'draft', projectName: 'Finance Ops', settings: { access: 'roles', roles: ['operator'], userIds: [] } }} members={[]} users={[]} onClose={() => {}} onSave={async () => {}} />);
    expect(access).toContain('Who can open this app');
    expect(access).toContain('Operators');
    expect(access).toContain('/apps/a1');
  });

  it('enables App in Start building and lists apps in Studio', () => {
    const app = START_OPTIONS.flatMap(({ items }) => items).find((item) => item.key === 'app');
    expect(app.action).toBe('app');
    const modal = renderToStaticMarkup(<StartBuildingModal role="automation_developer" onClose={() => {}} onChoose={() => {}} />);
    expect(modal).toContain('Build a custom interface for your automated use cases.');
    expect(renderToStaticMarkup(<NewAppDialog projects={[]} onClose={() => {}} onCreated={() => {}} onNewProject={() => {}} />)).toContain('Create a project first');
    expect(renderToStaticMarkup(<NewAppDialog projects={[{ id: 'p1', name: 'Finance Ops' }]} onClose={() => {}} onCreated={() => {}} onNewProject={() => {}} />)).toContain('Finance Ops');
    const wrap = (node) => renderToStaticMarkup(<StaticRouter location="/studio">{node}</StaticRouter>);
    expect(wrap(<AppsTable apps={[]} search="" />)).toContain('No apps yet');
    const rows = wrap(<AppsTable apps={[{ id: 'a1', name: 'Invoice intake', projectName: 'Finance Ops', status: 'published', versionNumber: 2, pageCount: 1, componentCount: 6, settings: { access: 'tenant' }, updatedAt: '2026-10-18 08:00:00' }]} search="" />);
    expect(rows).toContain('Invoice intake');
    expect(rows).toContain('Everyone');
    expect(rows).toContain('/apps/a1');
    expect(wrap(<AppCard app={{ id: 'a1', name: 'Invoice intake', projectName: 'Finance Ops', versionNumber: 2, publishedAt: '2026-10-18 08:00:00' }} />)).toContain('>I<');
  });
});
