import { renderToStaticMarkup } from 'react-dom/server';
import { Route, Routes } from 'react-router-dom';
import { StaticRouter } from 'react-router-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import DashboardPage from './DashboardPage.jsx';
import ProjectsPage from './ProjectsPage.jsx';
import WorkflowsPage from './WorkflowsPage.jsx';
import OperationsPage from './OperationsPage.jsx';
import QueuesPage from './QueuesPage.jsx';
import ActionCenterPage, { initialValues } from './ActionCenterPage.jsx';
import PropertyPanel from '../components/PropertyPanel.jsx';
import { api } from '../services/api.js';

beforeAll(() => {
  const store = new Map([['urap.user', JSON.stringify({ id: 'u1', role: 'administrator', displayName: 'Admin' })], ['urap.access', 'token']]);
  globalThis.sessionStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
});

function render(path, routePath, element) {
  return renderToStaticMarkup(<StaticRouter location={path}><Routes><Route path={routePath} element={element} /></Routes></StaticRouter>);
}

describe('pages render for a signed-in administrator', () => {
  it('renders dashboard, projects, library, designer, and queues', () => {
    expect(render('/dashboard', '/dashboard', <DashboardPage />)).toContain('Dashboard');
    expect(render('/projects', '/projects', <ProjectsPage />)).toContain('New project');
    expect(render('/workflows', '/workflows', <WorkflowsPage mode="library" />)).toContain('Workflow library');
    const designer = render('/workflows/new', '/workflows/new', <WorkflowsPage mode="builder" />);
    expect(designer).toContain('Get Transaction Item');
    expect(designer).toContain('Publish');
    expect(render('/queues', '/queues', <QueuesPage />)).toContain('Create queue');
  });

  it('pre-fills the designer from a template and filters the palette to a pack', () => {
    const designer = render('/workflows/new?template=purchase-approval', '/workflows/new', <WorkflowsPage mode="builder" />);
    for (const text of ['Route a purchase request for approval', 'Manager approval', 'Approved?', 'Notify approved', 'Notify rejected', 'Started from the']) expect(designer).toContain(text);
    expect(designer).toContain('&quot;requestedBy&quot;');
    const web = render('/workflows/new?palette=Web', '/workflows/new', <WorkflowsPage mode="builder" />);
    expect(web).toContain('Extract Table Data');
    expect(web).not.toContain('Send Hotkey');
    const unknown = render('/workflows/new?template=nope', '/workflows/new', <WorkflowsPage mode="builder" />);
    expect(unknown).not.toContain('Started from the');
  });

  it('renders the new activity groups, recorder button, and Action Center', () => {
    const designer = render('/workflows/new', '/workflows/new', <WorkflowsPage mode="builder" />);
    for (const label of ['Open Browser', 'Type Into', 'Extract Table Data', 'Send Hotkey', 'OCR (image / PDF)', 'Extract Document Fields', 'Create Form Task', 'Read Range (Google Sheets)', 'Record web']) {
      expect(designer).toContain(label);
    }
    const tasks = render('/tasks', '/tasks', <ActionCenterPage />);
    expect(tasks).toContain('Action Center');
    expect(tasks).toContain('Only tasks for me');
  });

  it('renders property panels for web, desktop, and connector activities', () => {
    const connections = [{ id: 'c1', name: 'Portal login', connectorType: 'credential' }, { id: 'c2', name: 'Sheet', connectorType: 'google_sheets' }];
    const web = renderToStaticMarkup(<PropertyPanel step={{ id: 'type_1', type: 'browser_type', config: { selector: '#user', selectorType: 'css' } }} connections={connections} onConfig={() => {}} />);
    expect(web).toContain('Target element');
    expect(web).toContain('value="#user"');
    expect(web).toContain('Portal login (credential)');
    expect(web).not.toContain('Sheet (google_sheets)');
    const desktop = renderToStaticMarkup(<PropertyPanel step={{ id: 'click_1', type: 'desktop_click', config: { selector: { automationId: 'okButton' } } }} onConfig={() => {}} />);
    expect(desktop).toContain('value="okButton"');
    expect(desktop).toContain('Double click');
    const sheets = renderToStaticMarkup(<PropertyPanel step={{ id: 's1', type: 'sheets_read_range', config: {} }} connections={connections} onConfig={() => {}} />);
    expect(sheets).toContain('Sheet (google_sheets)');
    expect(renderToStaticMarkup(<PropertyPanel step={{ id: 'x', type: 'start', config: {} }} onConfig={() => {}} />)).toBe('');
  });

  it('prefills task forms from defaults and task data', () => {
    expect(initialValues({ formFields: [{ name: 'amount', type: 'number' }, { name: 'ok', type: 'checkbox' }, { name: 'note', type: 'text', default: 'n/a' }], data: { amount: 1200 } })).toEqual({ amount: 1200, ok: false, note: 'n/a' });
  });

  it('renders every operations section header', () => {
    for (const [section, title] of [['connections', 'Connections'], ['jobs', 'Jobs &amp; runs'], ['schedules', 'Schedules'], ['reports', 'Reports'], ['audit', 'Audit logs'], ['settings', 'Settings']]) {
      expect(render(`/${section}`, `/${section}`, <OperationsPage section={section} />)).toContain(title);
    }
    expect(render('/jobs/abc', '/jobs/:id', <OperationsPage section="job" />)).toContain('Job detail');
  });
});

describe('api client', () => {
  it('sends the bearer token and surfaces validation details', async () => {
    const calls = [];
    globalThis.fetch = async (path, init) => {
      calls.push({ path, init });
      return new Response(JSON.stringify({ error: { code: 'VALIDATION', message: 'Request validation failed', details: [{ message: 'name is required' }] } }), { status: 400, headers: { 'content-type': 'application/json' } });
    };
    await expect(api('/api/projects', { method: 'POST', body: {} })).rejects.toThrow('name is required');
    expect(calls[0].init.headers.Authorization).toBe('Bearer token');
    expect(calls[0].init.headers['Content-Type']).toBe('application/json');
  });
});
