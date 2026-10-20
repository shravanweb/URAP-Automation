import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, currentUser } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import { timeAgo } from '../layouts/CloudLayout.jsx';
import { ShowcaseCard, StatusPill, TEMPLATES } from './HomePage.jsx';

// Studio projects page (Cloud Workspace / Local Workspace / Templates), in the light Automation
// Cloud shell. Projects and workflows are real API data. "Create New" opens a Start building
// dialog; every option creates something real (options without an action would say "Coming soon").
// Flows (process orchestration), Agents (AI agents), Apps, Case types, and BPMN processes are listed in the Cloud Workspace next to projects.

const TABS = [['cloud', 'Cloud Workspace'], ['local', 'Local Workspace'], ['templates', 'Templates']];

const canCreateProject = (role) => ['administrator', 'project_manager'].includes(role);
const canWriteWorkflow = (role) => ['administrator', 'project_manager', 'automation_developer'].includes(role);

/** Start building options. `action` is set only for what URAP really supports. */
export const START_OPTIONS = [
  { group: null, items: [
    { key: 'project', icon: 'folder', title: 'Project', body: 'Create a project to group workflows, connections, files, and members.', action: 'project' },
    { key: 'case', icon: 'briefcase', title: 'Case', body: 'Build a dynamic case management solution with stages, tasks, and SLAs.', action: 'case' },
    { key: 'flow', icon: 'flow', title: 'Flow', body: 'Orchestrate a business process across agents, humans, and systems.', action: 'flow' },
    { key: 'bpmn', icon: 'bpmn', title: 'BPMN', body: 'Design and build a business process on a BPMN canvas.', action: 'bpmn' },
  ] },
  { group: 'Orchestration', items: [
    { key: 'agentic-flow', icon: 'orchestrator', title: 'Flow', body: 'Bring APIs, robots, and people together. Starts from an API-call template.', action: 'flow-api' },
  ] },
  { group: 'RPA', items: [
    { key: 'rpa', icon: 'studio', title: 'RPA Workflow', body: 'Automate a repetitive task across your web and desktop apps.', action: 'rpa' },
    { key: 'import', icon: 'upload', title: 'Import recording', body: 'Turn a Playwright codegen script or recorded workflow JSON into steps.', action: 'import' },
  ] },
  { group: 'Building blocks', items: [
    { key: 'agent', icon: 'agent', title: 'Agent', body: 'Build an autonomous or conversational AI agent that uses your workflows, people, and APIs as tools.', action: 'agent' },
    { key: 'api', icon: 'api', title: 'API Workflow', body: 'Automate a task by calling REST APIs and databases with HTTP and Database activities.', action: 'api' },
    { key: 'app', icon: 'app', title: 'App', body: 'Build a custom interface for your automated use cases.', action: 'app' },
  ] },
];

const ROUTES = { rpa: '/workflows/new', api: '/workflows/new?palette=HTTP', import: '/workflows/new?import=codegen' };

function focusables(root) {
  return [...root.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.offsetParent !== null);
}

/** Traps Tab inside the dialog, closes on Escape, restores focus to the opener. */
function useDialog(ref, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement;
    const root = ref.current;
    const first = root?.querySelector('[data-autofocus]') || (root && focusables(root)[0]);
    first?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab' || !root) return;
      const items = focusables(root);
      if (!items.length) return;
      const index = items.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && index === items.length - 1) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus?.(); };
  }, [ref]);
}

const ACCESS_LABELS = { project: 'Project members', tenant: 'Everyone', roles: 'Specific roles', users: 'Specific people' };

export function AppsTable({ apps, search }) {
  const rows = apps.filter((app) => !search || `${app.name} ${app.projectName || ''} ${app.description || ''}`.toLowerCase().includes(search.toLowerCase()));
  if (!apps.length) {
    return (
      <div className="flex flex-col items-center rounded-xl u-card px-6 py-14 text-center">
        <span className="u-tile grid h-12 w-12 place-items-center rounded-xl bg-[#FFF1EB] text-ember"><Icon name="app" className="h-6 w-6" /></span>
        <h3 className="mt-4 text-[16px] font-semibold tracking-tight text-ink">No apps yet</h3>
        <p className="mt-1.5 max-w-md text-[13.5px] leading-6 text-slate-500">An app is a simple interface for the people who use your automations: a form that runs a workflow, a table of queue items, a button that starts a flow, or a chat with an agent.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl u-card">
      <table className="w-full min-w-[860px] text-left text-[13px]">
        <thead className="border-b border-[#ECE8E3] bg-[#FBFAF8] text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
          <tr>
            <th scope="col" className="py-2.5 pl-5 pr-3 font-semibold">App</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Project</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Pages</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Access</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Updated</th>
            <th scope="col" className="py-2.5 pl-3 pr-5 text-right font-semibold"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F1EEEA]">
          {rows.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">No apps match “{search}”.</td></tr>}
          {rows.map((app) => (
            <tr key={app.id} className="transition-colors hover:bg-[#FCFBFA]">
              <td className="py-3 pl-5 pr-3">
                <div className="flex items-center gap-3">
                  <span className="u-tile grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#FFF1EB] text-ember"><Icon name="app" className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <Link to={`/studio/apps/${app.id}`} className="block max-w-[280px] truncate font-semibold text-ink hover:text-ember">{app.name}</Link>
                    <p className="max-w-[280px] truncate text-xs text-slate-500">{app.description || `${app.componentCount} component${app.componentCount === 1 ? '' : 's'}`}</p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 text-slate-600">{app.projectName}</td>
              <td className="px-3 py-3"><div className="flex items-center gap-2"><StatusPill status={app.status} />{app.versionNumber ? <span className="text-xs tabular-nums text-slate-400">v{app.versionNumber}</span> : null}</div></td>
              <td className="px-3 py-3 tabular-nums text-slate-600">{app.pageCount}</td>
              <td className="px-3 py-3 text-slate-600">{ACCESS_LABELS[app.settings?.access] || 'Project members'}</td>
              <td className="whitespace-nowrap px-3 py-3 text-slate-600">{timeAgo(app.updatedAt)}</td>
              <td className="py-3 pl-3 pr-5 text-right">
                <div className="flex justify-end gap-2">
                  {app.status === 'published' && <Link to={`/apps/${app.id}`} className="rounded-md px-2.5 py-1 text-[13px] font-medium text-slate-600 hover:bg-[#F6F4F1] hover:text-ink">Open app</Link>}
                  <Link to={`/studio/apps/${app.id}`} className="rounded-md border border-[#ECE8E3] px-2.5 py-1 text-[13px] font-medium text-ink hover:border-[#E2DCD5] hover:bg-[#F6F4F1]">Edit</Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CaseTypesTable({ caseTypes, search }) {
  const rows = caseTypes.filter((item) => !search || `${item.name} ${item.projectName || ''} ${item.description || ''}`.toLowerCase().includes(search.toLowerCase()));
  if (!caseTypes.length) {
    return (
      <div className="flex flex-col items-center rounded-xl u-card px-6 py-14 text-center">
        <span className="u-tile grid h-12 w-12 place-items-center rounded-xl bg-[#FDF2EC] text-[#B4471B]"><Icon name="briefcase" className="h-6 w-6" /></span>
        <h3 className="mt-4 text-[16px] font-semibold tracking-tight text-ink">No case types yet</h3>
        <p className="mt-1.5 max-w-md text-[13.5px] leading-6 text-slate-500">A case type describes long-running work such as vendor onboarding or a customer claim: its fields, the stages it moves through, the human and robot tasks in each stage, and the SLAs that keep it on time.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl u-card">
      <table className="w-full min-w-[900px] text-left text-[13px]">
        <thead className="border-b border-[#ECE8E3] bg-[#FBFAF8] text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
          <tr>
            <th scope="col" className="py-2.5 pl-5 pr-3 font-semibold">Case type</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Project</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Stages</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Open cases</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Updated</th>
            <th scope="col" className="py-2.5 pl-3 pr-5 text-right font-semibold"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F1EEEA]">
          {rows.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">No case types match “{search}”.</td></tr>}
          {rows.map((item) => (
            <tr key={item.id} className="transition-colors hover:bg-[#FCFBFA]">
              <td className="py-3 pl-5 pr-3">
                <div className="flex items-center gap-3">
                  <span className="u-tile grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#FDF2EC] text-[#B4471B]"><Icon name="briefcase" className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <Link to={`/studio/cases/${item.id}`} className="block max-w-[280px] truncate font-semibold text-ink hover:text-ember">{item.name}</Link>
                    <p className="max-w-[280px] truncate text-xs text-slate-500"><span className="font-mono">{item.prefix}</span>{item.description ? ` · ${item.description}` : ''}</p>
                  </div>
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-slate-600">{item.projectName}</td>
              <td className="px-3 py-3"><div className="flex items-center gap-2"><StatusPill status={item.status} />{item.versionNumber ? <span className="text-xs tabular-nums text-slate-400">v{item.versionNumber}</span> : null}</div></td>
              <td className="px-3 py-3 text-slate-600"><span className="block max-w-[200px] truncate">{(item.definition?.stages || []).map((stage) => stage.name).join(' → ')}</span></td>
              <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-600">{item.openCases || 0}{item.atRiskCases ? <span className="ml-2 rounded-full bg-[#FDF5E6] px-2 py-px text-[11px] font-medium text-[#8A5A0B]">{item.atRiskCases} at risk</span> : null}</td>
              <td className="whitespace-nowrap px-3 py-3 text-slate-600">{timeAgo(item.updatedAt)}</td>
              <td className="py-3 pl-3 pr-5 text-right">
                <div className="flex justify-end gap-2">
                  {item.status === 'published' && <Link to={`/cases?type=${item.id}&view=board`} className="whitespace-nowrap rounded-md px-2.5 py-1 text-[13px] font-medium text-slate-600 hover:bg-[#F6F4F1] hover:text-ink">Open cases</Link>}
                  <Link to={`/studio/cases/${item.id}`} className="rounded-md border border-[#ECE8E3] px-2.5 py-1 text-[13px] font-medium text-ink hover:border-[#E2DCD5] hover:bg-[#F6F4F1]">Edit</Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StartBuildingModal({ onClose, onChoose, role }) {
  const ref = useRef(null);
  useDialog(ref, onClose);
  const allowed = (option) => option.action && (option.action === 'project' ? canCreateProject(role) : canWriteWorkflow(role));
  const onArrow = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...ref.current.querySelectorAll('[data-option]')];
    const index = items.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/35 p-4 pt-[8vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="start-title" aria-describedby="start-sub" className="w-full max-w-[600px] rounded-2xl u-card shadow-[0_24px_64px_-20px_rgba(23,33,37,0.35)]">
        <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-5">
          <div>
            <h2 id="start-title" className="text-[17px] font-semibold tracking-tight text-ink">Start building</h2>
            <p id="start-sub" className="mt-0.5 text-[13px] text-slate-500">Choose how you'd like to begin</p>
          </div>
          <button type="button" className="-mr-2 grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Close" onClick={onClose}><Icon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[min(66vh,600px)] overflow-y-auto border-t border-[#ECE8E3] px-6 pb-6 pt-4" onKeyDown={onArrow}>
          {START_OPTIONS.map(({ group, items }) => (
            <div key={group || 'top'} className={group ? 'mt-5' : ''} role="group" aria-label={group || 'Processes'}>
              {group && <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{group}</p>}
              <ul className="space-y-1.5">
                {items.map((option, index) => {
                  const enabled = allowed(option);
                  const soon = !option.action;
                  return (
                    <li key={option.key}>
                      <button
                        type="button"
                        data-option
                        data-autofocus={!group && index === 0 ? true : undefined}
                        aria-disabled={!enabled}
                        onClick={() => enabled && onChoose(option)}
                        className={`group flex w-full items-center gap-3.5 rounded-xl border px-3.5 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/40 ${enabled ? 'border-[#ECE8E3] bg-white hover:border-[#F3B9A4] hover:bg-[#FFFAF7]' : 'cursor-not-allowed border-[#F1EEEA] bg-[#FCFBFA]'}`}
                      >
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${enabled ? 'border-[#ECE8E3] bg-[#F6F4F1] text-charcoal group-hover:text-ember' : 'border-[#F1EEEA] bg-white text-slate-400'}`}><Icon name={option.icon} className="h-[18px] w-[18px]" /></span>
                        <span className="min-w-0 flex-1">
                          <span className={`flex items-center gap-2 text-[14px] font-semibold ${enabled ? 'text-ink' : 'text-slate-500'}`}>
                            {option.title}
                            {soon && <span className="rounded-full bg-slate-100 px-2 py-px text-[10.5px] font-semibold text-slate-500">Coming soon</span>}
                            {!soon && !enabled && <span className="rounded-full bg-slate-100 px-2 py-px text-[10.5px] font-semibold text-slate-500">Needs a higher role</span>}
                          </span>
                          <span className={`mt-0.5 block text-[13px] leading-5 ${enabled ? 'text-slate-500' : 'text-slate-400'}`}>{option.body}</span>
                        </span>
                        {enabled && <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-ember" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NewProjectDialog({ onClose, onCreated }) {
  const ref = useRef(null);
  useDialog(ref, onClose);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({ name: '', category: '', description: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/categories').then((result) => { setCategories(result.data); setForm((value) => ({ ...value, category: value.category || result.data[0]?.code || '' })); }).catch(() => {}); }, []);
  const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15';
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await api('/api/projects', { method: 'POST', body: form });
      onCreated(result.data);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/35 p-4 pt-[10vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form ref={ref} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="project-title" className="w-full max-w-[480px] rounded-2xl u-card shadow-[0_24px_64px_-20px_rgba(23,33,37,0.35)]">
        <div className="flex items-start justify-between px-6 pb-4 pt-5">
          <div>
            <h2 id="project-title" className="text-[17px] font-semibold tracking-tight text-ink">New project</h2>
            <p className="mt-0.5 text-[13px] text-slate-500">Projects group workflows, connections, files, and members.</p>
          </div>
          <button type="button" className="-mr-2 grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Close" onClick={onClose}><Icon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 border-t border-[#ECE8E3] px-6 py-5">
          <label className="block text-[13px] font-medium text-ink">Name<input data-autofocus required maxLength={200} className={`${input} mt-1.5`} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Finance Ops" /></label>
          <label className="block text-[13px] font-medium text-ink">Category
            <select required className={`${input} mt-1.5`} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              {categories.length === 0 && <option value="">Loading…</option>}
              {categories.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
            </select>
          </label>
          <label className="block text-[13px] font-medium text-ink">Description <span className="font-normal text-slate-400">(optional)</span><textarea rows={3} maxLength={4000} className={`${input} mt-1.5 resize-none`} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          {error && <p className="rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#ECE8E3] px-6 py-4">
          <button type="button" className="rounded-lg border border-[#ECE8E3] px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-[#F6F4F1]" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy || !form.name.trim() || !form.category} className="rounded-lg u-btn-primary px-3.5 py-2 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-60">{busy ? 'Creating…' : 'Create project'}</button>
        </div>
      </form>
    </div>
  );
}

export function NewFlowDialog({ projects, template = 'blank', onClose, onCreated, onNewProject }) {
  const ref = useRef(null);
  useDialog(ref, onClose);
  const [form, setForm] = useState({ projectId: projects[0]?.id || '', name: '', description: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15';
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await api('/api/flows', { method: 'POST', body: { ...form, template } });
      onCreated(result.data);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/35 p-4 pt-[10vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form ref={ref} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="flow-title" className="w-full max-w-[480px] rounded-2xl u-card shadow-[0_24px_64px_-20px_rgba(23,33,37,0.35)]">
        <div className="flex items-start justify-between px-6 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <span className="u-tile grid h-9 w-9 place-items-center rounded-lg bg-[#FFF1EC] text-ember"><Icon name="flow" className="h-[18px] w-[18px]" /></span>
            <div>
              <h2 id="flow-title" className="text-[17px] font-semibold tracking-tight text-ink">New flow</h2>
              <p className="mt-0.5 text-[13px] text-slate-500">{template === 'api' ? 'Starts with an API call, a decision, and a review step.' : 'Orchestrate robots, people, and systems in one process.'}</p>
            </div>
          </div>
          <button type="button" className="-mr-2 grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Close" onClick={onClose}><Icon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 border-t border-[#ECE8E3] px-6 py-5">
          {projects.length === 0 ? (
            <div className="rounded-lg border border-[#ECE8E3] bg-[#FCFBFA] px-4 py-3 text-[13px] text-slate-600">
              A flow lives in a project. <button type="button" className="font-semibold text-ember hover:underline" onClick={onNewProject}>Create a project first</button>.
            </div>
          ) : (
            <label className="block text-[13px] font-medium text-ink">Project
              <select data-autofocus required className={`${input} mt-1.5`} value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
          )}
          <label className="block text-[13px] font-medium text-ink">Name<input required maxLength={200} className={`${input} mt-1.5`} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Invoice approval" /></label>
          <label className="block text-[13px] font-medium text-ink">Description <span className="font-normal text-slate-400">(optional)</span><textarea rows={2} maxLength={4000} className={`${input} mt-1.5 resize-none`} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          {error && <p className="rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#ECE8E3] px-6 py-4">
          <button type="button" className="rounded-lg border border-[#ECE8E3] px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-[#F6F4F1]" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy || !form.name.trim() || !form.projectId} className="rounded-lg u-btn-primary px-3.5 py-2 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-60">{busy ? 'Creating…' : 'Create and open'}</button>
        </div>
      </form>
    </div>
  );
}

export const AGENT_TYPE_OPTIONS = [
  { key: 'conversational', icon: 'users', title: 'Conversational', body: 'Chats with people and uses tools to answer and act.' },
  { key: 'autonomous', icon: 'bolt', title: 'Autonomous', body: 'Takes an input, works through the task with tools, returns an output. Usable as a flow step.' },
  { key: 'coded', icon: 'code', title: 'Coded', body: 'Your own JavaScript. It runs in a sandbox with no files, network, or secrets.' },
];

export function NewAgentDialog({ projects, onClose, onCreated, onNewProject }) {
  const ref = useRef(null);
  useDialog(ref, onClose);
  const [form, setForm] = useState({ projectId: projects[0]?.id || '', name: '', description: '', agentType: 'conversational' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15';
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await api('/api/agents', { method: 'POST', body: form });
      onCreated(result.data);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/35 p-4 pt-[8vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form ref={ref} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="agent-title" className="w-full max-w-[520px] rounded-2xl u-card shadow-[0_24px_64px_-20px_rgba(23,33,37,0.35)]">
        <div className="flex items-start justify-between px-6 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <span className="u-tile grid h-9 w-9 place-items-center rounded-lg bg-[#EEF4FF] text-[#3550B5]"><Icon name="agent" className="h-[18px] w-[18px]" /></span>
            <div>
              <h2 id="agent-title" className="text-[17px] font-semibold tracking-tight text-ink">New agent</h2>
              <p className="mt-0.5 text-[13px] text-slate-500">An AI agent that reasons and acts with your workflows, people, and APIs.</p>
            </div>
          </div>
          <button type="button" className="-mr-2 grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Close" onClick={onClose}><Icon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 border-t border-[#ECE8E3] px-6 py-5">
          {projects.length === 0 ? (
            <div className="rounded-lg border border-[#ECE8E3] bg-[#FCFBFA] px-4 py-3 text-[13px] text-slate-600">
              An agent lives in a project. <button type="button" className="font-semibold text-ember hover:underline" onClick={onNewProject}>Create a project first</button>.
            </div>
          ) : (
            <label className="block text-[13px] font-medium text-ink">Project
              <select data-autofocus required className={`${input} mt-1.5`} value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
          )}
          <fieldset>
            <legend className="text-[13px] font-medium text-ink">Type</legend>
            <div className="mt-1.5 grid gap-2">
              {AGENT_TYPE_OPTIONS.map((option) => {
                const selected = form.agentType === option.key;
                return (
                  <label key={option.key} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${option.disabled ? 'cursor-not-allowed border-[#F1EEEA] bg-[#FCFBFA]' : selected ? 'cursor-pointer border-[#F3B9A4] bg-[#FFF7F3]' : 'cursor-pointer border-[#ECE8E3] hover:border-[#E2DCD5]'}`}>
                    <input type="radio" name="agentType" className="mt-1 accent-[#FA4616]" disabled={option.disabled} checked={selected} onChange={() => setForm({ ...form, agentType: option.key })} />
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${option.disabled ? 'bg-white text-slate-300' : 'bg-[#F6F4F1] text-charcoal'}`}><Icon name={option.icon} className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0">
                      <span className={`flex items-center gap-2 text-[13.5px] font-semibold ${option.disabled ? 'text-slate-400' : 'text-ink'}`}>{option.title}{option.disabled && <span className="rounded-full bg-slate-100 px-2 py-px text-[10.5px] font-semibold text-slate-500">Later</span>}</span>
                      <span className={`block text-[12.5px] leading-5 ${option.disabled ? 'text-slate-400' : 'text-slate-500'}`}>{option.body}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className="block text-[13px] font-medium text-ink">Name<input required maxLength={200} className={`${input} mt-1.5`} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Invoice assistant" /></label>
          <label className="block text-[13px] font-medium text-ink">Description <span className="font-normal text-slate-400">(optional)</span><textarea rows={2} maxLength={4000} className={`${input} mt-1.5 resize-none`} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          {error && <p className="rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#ECE8E3] px-6 py-4">
          <button type="button" className="rounded-lg border border-[#ECE8E3] px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-[#F6F4F1]" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy || !form.name.trim() || !form.projectId} className="rounded-lg u-btn-primary px-3.5 py-2 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-60">{busy ? 'Creating…' : 'Create and open'}</button>
        </div>
      </form>
    </div>
  );
}

export function NewAppDialog({ projects, onClose, onCreated, onNewProject }) {
  const ref = useRef(null);
  useDialog(ref, onClose);
  const [form, setForm] = useState({ projectId: projects[0]?.id || '', name: '', description: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15';
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await api('/api/apps', { method: 'POST', body: form });
      onCreated(result.data);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/35 p-4 pt-[8vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form ref={ref} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="app-title" className="w-full max-w-[520px] rounded-2xl u-card shadow-[0_24px_64px_-20px_rgba(23,33,37,0.35)]">
        <div className="flex items-start justify-between px-6 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <span className="u-tile grid h-9 w-9 place-items-center rounded-lg bg-[#FFF1EB] text-ember"><Icon name="app" className="h-[18px] w-[18px]" /></span>
            <div>
              <h2 id="app-title" className="text-[17px] font-semibold tracking-tight text-ink">New app</h2>
              <p className="mt-0.5 text-[13px] text-slate-500">A custom interface with forms, tables, and buttons that run your automations.</p>
            </div>
          </div>
          <button type="button" className="-mr-2 grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Close" onClick={onClose}><Icon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 border-t border-[#ECE8E3] px-6 py-5">
          {projects.length === 0 ? (
            <div className="rounded-lg border border-[#ECE8E3] bg-[#FCFBFA] px-4 py-3 text-[13px] text-slate-600">
              An app lives in a project. <button type="button" className="font-semibold text-ember hover:underline" onClick={onNewProject}>Create a project first</button>.
            </div>
          ) : (
            <label className="block text-[13px] font-medium text-ink">Project
              <select data-autofocus required className={`${input} mt-1.5`} value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
          )}
          <label className="block text-[13px] font-medium text-ink">Name<input required maxLength={200} className={`${input} mt-1.5`} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Invoice intake" /></label>
          <label className="block text-[13px] font-medium text-ink">Description <span className="font-normal text-slate-400">(optional)</span><textarea rows={2} maxLength={4000} className={`${input} mt-1.5 resize-none`} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What people use it for" /></label>
          {error && <p className="rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#ECE8E3] px-6 py-4">
          <button type="button" className="rounded-lg border border-[#ECE8E3] px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-[#F6F4F1]" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy || !form.name.trim() || !form.projectId} className="rounded-lg u-btn-primary px-3.5 py-2 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-60">{busy ? 'Creating…' : 'Create and open'}</button>
        </div>
      </form>
    </div>
  );
}

export function NewCaseTypeDialog({ projects, onClose, onCreated, onNewProject }) {
  const ref = useRef(null);
  useDialog(ref, onClose);
  const [form, setForm] = useState({ projectId: projects[0]?.id || '', name: '', prefix: '', description: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15';
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const body = { projectId: form.projectId, name: form.name, description: form.description, ...(form.prefix.trim() ? { prefix: form.prefix.trim().toUpperCase() } : {}) };
      const result = await api('/api/case-types', { method: 'POST', body });
      onCreated(result.data);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/35 p-4 pt-[8vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form ref={ref} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="case-type-title" className="w-full max-w-[520px] rounded-2xl u-card shadow-[0_24px_64px_-20px_rgba(23,33,37,0.35)]">
        <div className="flex items-start justify-between px-6 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <span className="u-tile grid h-9 w-9 place-items-center rounded-lg bg-[#FDF2EC] text-[#B4471B]"><Icon name="briefcase" className="h-[18px] w-[18px]" /></span>
            <div>
              <h2 id="case-type-title" className="text-[17px] font-semibold tracking-tight text-ink">New case type</h2>
              <p className="mt-0.5 text-[13px] text-slate-500">Stages, tasks, and SLAs for long-running work such as onboarding or claims.</p>
            </div>
          </div>
          <button type="button" className="-mr-2 grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Close" onClick={onClose}><Icon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 border-t border-[#ECE8E3] px-6 py-5">
          {projects.length === 0 ? (
            <div className="rounded-lg border border-[#ECE8E3] bg-[#FCFBFA] px-4 py-3 text-[13px] text-slate-600">
              A case type lives in a project. <button type="button" className="font-semibold text-ember hover:underline" onClick={onNewProject}>Create a project first</button>.
            </div>
          ) : (
            <label className="block text-[13px] font-medium text-ink">Project
              <select data-autofocus required className={`${input} mt-1.5`} value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
          )}
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <label className="block text-[13px] font-medium text-ink">Name<input required maxLength={200} className={`${input} mt-1.5`} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Vendor onboarding" /></label>
            <label className="block text-[13px] font-medium text-ink">Prefix <span className="font-normal text-slate-400">(opt.)</span><input maxLength={8} className={`${input} mt-1.5 font-mono uppercase`} value={form.prefix} onChange={(event) => setForm({ ...form, prefix: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="VO" /></label>
          </div>
          <label className="block text-[13px] font-medium text-ink">Description <span className="font-normal text-slate-400">(optional)</span><textarea rows={2} maxLength={4000} className={`${input} mt-1.5 resize-none`} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What kind of work these cases track" /></label>
          {error && <p className="rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#ECE8E3] px-6 py-4">
          <button type="button" className="rounded-lg border border-[#ECE8E3] px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-[#F6F4F1]" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy || !form.name.trim() || !form.projectId} className="rounded-lg u-btn-primary px-3.5 py-2 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-60">{busy ? 'Creating…' : 'Create and open'}</button>
        </div>
      </form>
    </div>
  );
}

export function ProcessesTable({ processes, search, onCreate }) {
  const rows = processes.filter((item) => !search || `${item.name} ${item.projectName || ''} ${item.description || ''}`.toLowerCase().includes(search.toLowerCase()));
  if (!processes.length) {
    return (
      <div className="flex flex-col items-center rounded-xl u-card px-6 py-14 text-center">
        <span className="u-tile grid h-12 w-12 place-items-center rounded-xl bg-[#FFF1EC] text-ember"><Icon name="bpmn" className="h-6 w-6" /></span>
        <h3 className="mt-4 text-[16px] font-semibold tracking-tight text-ink">No BPMN processes yet</h3>
        <p className="mt-1.5 max-w-md text-[13.5px] leading-6 text-slate-500">Draw a business process in standard BPMN 2.0: pools and lanes, user and service tasks, gateways, and timers. Publish it and URAP runs it: people get Action Center tasks, robots run your workflows.</p>
        {onCreate && <button type="button" className="mt-5 inline-flex items-center gap-1.5 rounded-lg u-btn-primary px-3.5 py-2 text-[13px] font-semibold" onClick={onCreate}><Icon name="plus" className="h-4 w-4" strokeWidth={2.2} />New BPMN process</button>}
      </div>
    );
  }
  const trigger = { manual: 'Manual', schedule: 'Timer', webhook: 'Message' };
  return (
    <div className="overflow-x-auto rounded-xl u-card">
      <table className="w-full min-w-[900px] text-left text-[13px]">
        <thead className="border-b border-[#ECE8E3] bg-[#FBFAF8] text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
          <tr>
            <th scope="col" className="py-2.5 pl-5 pr-3 font-semibold">Process</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Project</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Start</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Last run</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Runs</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Updated</th>
            <th scope="col" className="py-2.5 pl-3 pr-5 text-right font-semibold"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F1EEEA]">
          {rows.length === 0 && <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-500">No processes match “{search}”.</td></tr>}
          {rows.map((item) => (
            <tr key={item.id} className="transition-colors hover:bg-[#FCFBFA]">
              <td className="py-3 pl-5 pr-3">
                <div className="flex items-center gap-3">
                  <span className="u-tile grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#FFF1EC] text-ember"><Icon name="bpmn" className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <Link to={`/studio/processes/${item.id}`} className="block max-w-[280px] truncate font-semibold text-ink hover:text-ember">{item.name}</Link>
                    <p className="max-w-[280px] truncate text-xs text-slate-500">{item.description || 'BPMN 2.0 process'}</p>
                  </div>
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-slate-600">{item.projectName}</td>
              <td className="px-3 py-3"><div className="flex items-center gap-2"><StatusPill status={item.status} />{item.versionNumber ? <span className="text-xs tabular-nums text-slate-400">v{item.versionNumber}</span> : null}</div></td>
              <td className="whitespace-nowrap px-3 py-3 text-slate-600">{item.status === 'draft' ? <span className="text-slate-400">—</span> : trigger[item.triggerType] || item.triggerType}</td>
              <td className="whitespace-nowrap px-3 py-3">{item.lastRun ? <Link to={`/studio/processes/${item.id}/runs/${item.lastRun.id}`} className="inline-flex items-center gap-2 hover:opacity-80"><StatusPill status={item.lastRun.status} /><span className="text-xs text-slate-500">{timeAgo(item.lastRun.startedAt)}</span></Link> : <span className="text-slate-400">Never run</span>}</td>
              <td className="px-3 py-3 tabular-nums text-slate-600">{item.runCount || 0}</td>
              <td className="whitespace-nowrap px-3 py-3 text-slate-600">{timeAgo(item.updatedAt)}</td>
              <td className="py-3 pl-3 pr-5 text-right"><Link to={`/studio/processes/${item.id}`} className="rounded-md border border-[#ECE8E3] px-2.5 py-1 text-[13px] font-medium text-ink hover:border-[#E2DCD5] hover:bg-[#F6F4F1]">Open</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const PROCESS_TEMPLATES = [
  ['blank', 'Blank process', 'A start event and an end event. Draw the rest.'],
  ['purchase', 'Purchase request', 'Requester, Manager, and Procurement lanes: approval, decision, and a robot that creates the order.'],
];

export function NewProcessDialog({ projects, workflows = [], onClose, onCreated, onNewProject }) {
  const ref = useRef(null);
  useDialog(ref, onClose);
  const [form, setForm] = useState({ projectId: projects[0]?.id || '', name: '', description: '', template: 'blank', workflowId: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15';
  const projectWorkflows = workflows.filter((item) => item.projectId === form.projectId && item.status === 'published');
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const body = { projectId: form.projectId, name: form.name, description: form.description, template: form.template, ...(form.template === 'purchase' && form.workflowId ? { workflowId: form.workflowId } : {}) };
      const result = await api('/api/bpmn', { method: 'POST', body });
      onCreated(result.data);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/35 p-4 pt-[8vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form ref={ref} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="process-title" className="w-full max-w-[560px] rounded-2xl u-card shadow-[0_24px_64px_-20px_rgba(23,33,37,0.35)]">
        <div className="flex items-start justify-between px-6 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <span className="u-tile grid h-9 w-9 place-items-center rounded-lg bg-[#FFF1EC] text-ember"><Icon name="bpmn" className="h-[18px] w-[18px]" /></span>
            <div>
              <h2 id="process-title" className="text-[17px] font-semibold tracking-tight text-ink">New BPMN process</h2>
              <p className="mt-0.5 text-[13px] text-slate-500">Design it on a BPMN 2.0 canvas, then publish it to run on URAP.</p>
            </div>
          </div>
          <button type="button" className="-mr-2 grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Close" onClick={onClose}><Icon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 border-t border-[#ECE8E3] px-6 py-5">
          {projects.length === 0 ? (
            <div className="rounded-lg border border-[#ECE8E3] bg-[#FCFBFA] px-4 py-3 text-[13px] text-slate-600">
              A process lives in a project. <button type="button" className="font-semibold text-ember hover:underline" onClick={onNewProject}>Create a project first</button>.
            </div>
          ) : (
            <label className="block text-[13px] font-medium text-ink">Project
              <select data-autofocus required className={`${input} mt-1.5`} value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value, workflowId: '' })}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
          )}
          <label className="block text-[13px] font-medium text-ink">Name<input required maxLength={200} className={`${input} mt-1.5`} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Purchase request" /></label>
          <fieldset>
            <legend className="text-[13px] font-medium text-ink">Start from</legend>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
              {PROCESS_TEMPLATES.map(([key, title, body]) => (
                <label key={key} className={`cursor-pointer rounded-xl border p-3 transition-colors ${form.template === key ? 'border-ember bg-[#FFF6F2]' : 'border-[#ECE8E3] hover:bg-[#FAF9F7]'}`}>
                  <input type="radio" name="template" value={key} className="sr-only" checked={form.template === key} onChange={() => setForm({ ...form, template: key, name: form.name || (key === 'purchase' ? 'Purchase request' : '') })} />
                  <span className="block text-[13px] font-semibold text-ink">{title}</span>
                  <span className="mt-0.5 block text-[12px] leading-[18px] text-slate-500">{body}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {form.template === 'purchase' && (
            <label className="block text-[13px] font-medium text-ink">Workflow that creates the order <span className="font-normal text-slate-400">(optional)</span>
              <select className={`${input} mt-1.5`} value={form.workflowId} onChange={(event) => setForm({ ...form, workflowId: event.target.value })}>
                <option value="">Choose later in the modeler</option>
                {projectWorkflows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          )}
          <label className="block text-[13px] font-medium text-ink">Description <span className="font-normal text-slate-400">(optional)</span><textarea rows={2} maxLength={4000} className={`${input} mt-1.5 resize-none`} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What this process is for" /></label>
          {error && <p className="rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#ECE8E3] px-6 py-4">
          <button type="button" className="rounded-lg border border-[#ECE8E3] px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-[#F6F4F1]" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy || !form.name.trim() || !form.projectId} className="rounded-lg u-btn-primary px-3.5 py-2 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-60">{busy ? 'Creating…' : 'Create and open'}</button>
        </div>
      </form>
    </div>
  );
}

function CreateNewButton({ onOpen, onQuick, role }) {
  const [open, setOpen] = useState(false);
  const menu = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && menu.current) {
        event.preventDefault();
        const items = [...menu.current.querySelectorAll('[role="menuitem"]')];
        const index = items.indexOf(document.activeElement);
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const quick = [
    ['project', 'folder', 'New project', canCreateProject(role)],
    ['flow', 'flow', 'Flow', canWriteWorkflow(role)],
    ['agent', 'agent', 'Agent', canWriteWorkflow(role)],
    ['app', 'app', 'App', canWriteWorkflow(role)],
    ['case', 'briefcase', 'Case type', canWriteWorkflow(role)],
    ['bpmn', 'bpmn', 'BPMN process', canWriteWorkflow(role)],
    ['rpa', 'studio', 'RPA Workflow', canWriteWorkflow(role)],
    ['import', 'upload', 'Import recording', canWriteWorkflow(role)],
  ];
  return (
    <div className="relative inline-flex">
      <div className="inline-flex rounded-lg">
        <button type="button" className="inline-flex items-center gap-1.5 u-btn-primary rounded-l-lg rounded-r-none py-2 pl-3 pr-3.5 text-[13px] font-semibold" onClick={onOpen}><Icon name="plus" className="h-4 w-4" strokeWidth={2.2} />Create New</button>
        <button type="button" className="grid w-9 place-items-center u-btn-primary rounded-l-none rounded-r-lg border-l border-white/25" aria-label="More create options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Icon name="chevronDown" className="h-4 w-4" strokeWidth={2.2} /></button>
      </div>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-30 cursor-default" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />
          <div ref={menu} role="menu" className="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl u-card p-1.5 text-left shadow-[0_16px_40px_-16px_rgba(23,33,37,0.28)]">
            {quick.map(([key, icon, label, enabled]) => (
              <button key={key} type="button" role="menuitem" aria-disabled={!enabled} onClick={() => { if (enabled) { setOpen(false); onQuick(key); } }} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] focus:bg-[#F6F4F1] focus:outline-none ${enabled ? 'text-ink hover:bg-[#F6F4F1]' : 'cursor-not-allowed text-slate-400'}`}>
                <Icon name={icon} className="h-4 w-4 text-slate-500" />{label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Original URAP illustration: an orange robot orb with a visor eye, orbited by a teal ring. */
export function StudioIllustration({ className = 'h-44 w-44' }) {
  return (
    <svg viewBox="0 0 200 200" className={className} role="img" aria-label="URAP robot illustration">
      <defs>
        <radialGradient id="orb" cx="38%" cy="32%" r="70%"><stop offset="0" stopColor="#FF8A5B" /><stop offset="0.55" stopColor="#FA4616" /><stop offset="1" stopColor="#C2330A" /></radialGradient>
        <linearGradient id="ring" x1="0" x2="1"><stop offset="0" stopColor="#1AA7AD" /><stop offset="1" stopColor="#127C81" /></linearGradient>
        <radialGradient id="lens" cx="40%" cy="35%" r="65%"><stop offset="0" stopColor="#3B4A52" /><stop offset="1" stopColor="#0F171B" /></radialGradient>
      </defs>
      <ellipse cx="100" cy="182" rx="46" ry="7" fill="#172125" opacity="0.08" />
      <path d="M38 118c-6-14 20-30 62-36s76 2 80 16" fill="none" stroke="url(#ring)" strokeWidth="9" strokeLinecap="round" opacity="0.55" />
      <path d="M84 150l-6 24M116 150l6 24" stroke="#C2330A" strokeWidth="7" strokeLinecap="round" />
      <path d="M70 175h14M116 175h14" stroke="#172125" strokeWidth="6" strokeLinecap="round" />
      <circle cx="100" cy="100" r="56" fill="url(#orb)" />
      <circle cx="82" cy="78" r="16" fill="#fff" opacity="0.16" />
      <rect x="72" y="80" width="62" height="40" rx="20" fill="#fff" />
      <circle cx="110" cy="100" r="15" fill="url(#lens)" />
      <circle cx="110" cy="100" r="6" fill="#1AA7AD" />
      <circle cx="105" cy="95" r="3" fill="#fff" opacity="0.9" />
      <circle cx="84" cy="100" r="4" fill="#172125" />
      <path d="M100 44V30" stroke="#172125" strokeWidth="4" strokeLinecap="round" />
      <circle cx="100" cy="26" r="6" fill="#1AA7AD" />
      <path d="M150 112c18 4 24 14 20 22-5 9-26 8-48 2" fill="none" stroke="url(#ring)" strokeWidth="9" strokeLinecap="round" />
      <path d="M44 104c-10 8-12 18-4 24" fill="none" stroke="#C2330A" strokeWidth="7" strokeLinecap="round" />
      <rect x="146" y="34" width="12" height="12" rx="3" fill="#FA4616" opacity="0.85" transform="rotate(12 152 40)" />
      <rect x="36" y="48" width="8" height="8" rx="2" fill="#172125" opacity="0.8" transform="rotate(-10 40 52)" />
    </svg>
  );
}

function RowMenu({ project, onClose }) {
  return (
    <>
      <button type="button" className="fixed inset-0 z-10 cursor-default" aria-hidden="true" tabIndex={-1} onClick={onClose} />
      <div role="menu" className="absolute right-4 top-11 z-20 w-52 rounded-xl u-card p-1.5 text-left shadow-[0_16px_40px_-16px_rgba(23,33,37,0.28)]">
        <Link role="menuitem" to={`/workflows?projectId=${project.id}`} className="block rounded-lg px-3 py-2 text-[13px] text-ink hover:bg-[#F6F4F1]">Open in Workflow Library</Link>
        <Link role="menuitem" to={`/workflows/new?projectId=${project.id}`} className="block rounded-lg px-3 py-2 text-[13px] text-ink hover:bg-[#F6F4F1]">New workflow</Link>
        <Link role="menuitem" to="/projects" className="block rounded-lg px-3 py-2 text-[13px] text-ink hover:bg-[#F6F4F1]">Manage project</Link>
        <Link role="menuitem" to={`/jobs`} className="block rounded-lg px-3 py-2 text-[13px] text-ink hover:bg-[#F6F4F1]">View jobs</Link>
      </div>
    </>
  );
}

function FlowsTable({ flows, search }) {
  const rows = flows.filter((flow) => !search || `${flow.name} ${flow.projectName || ''} ${flow.description || ''}`.toLowerCase().includes(search.toLowerCase()));
  if (!flows.length) {
    return (
      <div className="flex flex-col items-center rounded-xl u-card px-6 py-14 text-center">
        <span className="u-tile grid h-12 w-12 place-items-center rounded-xl bg-[#FFF1EC] text-ember"><Icon name="flow" className="h-6 w-6" /></span>
        <h3 className="mt-4 text-[16px] font-semibold tracking-tight text-ink">No flows yet</h3>
        <p className="mt-1.5 max-w-md text-[13.5px] leading-6 text-slate-500">A flow orchestrates a business process: run robots, ask people for approvals in Action Center, call APIs, branch on the results, and wait between steps.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl u-card">
      <table className="w-full min-w-[860px] text-left text-[13px]">
        <thead className="border-b border-[#ECE8E3] bg-[#FBFAF8] text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
          <tr>
            <th scope="col" className="py-2.5 pl-5 pr-3 font-semibold">Flow</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Project</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Trigger</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Last run</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Updated</th>
            <th scope="col" className="py-2.5 pl-3 pr-5 text-right font-semibold"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F1EEEA]">
          {rows.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">No flows match “{search}”.</td></tr>}
          {rows.map((flow) => (
            <tr key={flow.id} className="transition-colors hover:bg-[#FCFBFA]">
              <td className="py-3 pl-5 pr-3">
                <div className="flex items-center gap-3">
                  <span className="u-tile grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#FFF1EC] text-ember"><Icon name="flow" className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <Link to={`/studio/flows/${flow.id}`} className="block max-w-[300px] truncate font-semibold text-ink hover:text-ember">{flow.name}</Link>
                    <p className="max-w-[300px] truncate text-xs text-slate-500">{flow.description || `${flow.definition?.nodes?.length || 0} steps`}</p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 text-slate-600">{flow.projectName}</td>
              <td className="px-3 py-3"><div className="flex items-center gap-2"><StatusPill status={flow.status} />{flow.versionNumber ? <span className="text-xs tabular-nums text-slate-400">v{flow.versionNumber}</span> : null}</div></td>
              <td className="px-3 py-3 capitalize text-slate-600">{flow.triggerType}</td>
              <td className="px-3 py-3">{flow.lastRun ? <Link to={`/studio/flows/${flow.id}/runs/${flow.lastRun.id}`} className="inline-flex items-center gap-2 hover:opacity-80"><StatusPill status={flow.lastRun.status} /><span className="text-xs text-slate-500">{timeAgo(flow.lastRun.startedAt)}</span></Link> : <span className="text-slate-400">Never run</span>}</td>
              <td className="whitespace-nowrap px-3 py-3 text-slate-600">{timeAgo(flow.updatedAt)}</td>
              <td className="py-3 pl-3 pr-5 text-right"><Link to={`/studio/flows/${flow.id}`} className="rounded-md border border-[#ECE8E3] px-2.5 py-1 text-[13px] font-medium text-ink hover:border-[#E2DCD5] hover:bg-[#F6F4F1]">Open</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AgentsTable({ agents, search }) {
  const rows = agents.filter((agent) => !search || `${agent.name} ${agent.projectName || ''} ${agent.description || ''}`.toLowerCase().includes(search.toLowerCase()));
  if (!agents.length) {
    return (
      <div className="flex flex-col items-center rounded-xl u-card px-6 py-14 text-center">
        <span className="u-tile grid h-12 w-12 place-items-center rounded-xl bg-[#EEF4FF] text-[#3550B5]"><Icon name="agent" className="h-6 w-6" /></span>
        <h3 className="mt-4 text-[16px] font-semibold tracking-tight text-ink">No agents yet</h3>
        <p className="mt-1.5 max-w-md text-[13.5px] leading-6 text-slate-500">An agent uses an AI model to reason and act: it can run your workflows, ask people in Action Center, call APIs, and look up project data. Chat with it, or run it as a step in a flow.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl u-card">
      <table className="w-full min-w-[860px] text-left text-[13px]">
        <thead className="border-b border-[#ECE8E3] bg-[#FBFAF8] text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
          <tr>
            <th scope="col" className="py-2.5 pl-5 pr-3 font-semibold">Agent</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Project</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Type</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Tools</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Last run</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Updated</th>
            <th scope="col" className="py-2.5 pl-3 pr-5 text-right font-semibold"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F1EEEA]">
          {rows.length === 0 && <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-500">No agents match “{search}”.</td></tr>}
          {rows.map((agent) => (
            <tr key={agent.id} className="transition-colors hover:bg-[#FCFBFA]">
              <td className="py-3 pl-5 pr-3">
                <div className="flex items-center gap-3">
                  <span className="u-tile grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#EEF4FF] text-[#3550B5]"><Icon name="agent" className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <Link to={`/studio/agents/${agent.id}`} className="block max-w-[280px] truncate font-semibold text-ink hover:text-ember">{agent.name}</Link>
                    <p className="max-w-[280px] truncate text-xs text-slate-500">{agent.description || (agent.config?.instructions || '').slice(0, 80)}</p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 text-slate-600">{agent.projectName}</td>
              <td className="px-3 py-3 text-slate-600">{agent.agentType === 'autonomous' ? 'Autonomous' : agent.agentType === 'coded' ? 'Coded' : 'Conversational'}</td>
              <td className="px-3 py-3"><div className="flex items-center gap-2"><StatusPill status={agent.status} />{agent.versionNumber ? <span className="text-xs tabular-nums text-slate-400">v{agent.versionNumber}</span> : null}</div></td>
              <td className="px-3 py-3 tabular-nums text-slate-600">{agent.config?.tools?.length || 0}</td>
              <td className="px-3 py-3">{agent.lastRun ? <Link to={`/studio/agents/${agent.id}/runs/${agent.lastRun.id}`} className="inline-flex items-center gap-2 hover:opacity-80"><StatusPill status={agent.lastRun.status} /><span className="text-xs text-slate-500">{timeAgo(agent.lastRun.startedAt)}</span></Link> : <span className="text-slate-400">Never run</span>}</td>
              <td className="whitespace-nowrap px-3 py-3 text-slate-600">{timeAgo(agent.updatedAt)}</td>
              <td className="py-3 pl-3 pr-5 text-right"><Link to={`/studio/agents/${agent.id}`} className="rounded-md border border-[#ECE8E3] px-2.5 py-1 text-[13px] font-medium text-ink hover:border-[#E2DCD5] hover:bg-[#F6F4F1]">Open</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const VIEW_LABELS = { projects: 'Projects', flows: 'Flows', agents: 'Agents', apps: 'Apps', cases: 'Cases', processes: 'Processes' };

function CloudWorkspace({ data, createNew, onCreateProcess, view = 'projects', onView = () => {} }) {
  const user = currentUser();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState({});
  const [menu, setMenu] = useState('');
  const flows = (id) => data.workflows.filter((workflow) => workflow.project_id === id);
  const processFlows = (id) => (data.flows || []).filter((flow) => flow.projectId === id);
  const owner = (project) => data.users?.find((item) => item.id === project.created_by)?.displayName || (project.created_by === user?.id ? 'You' : '—');
  const category = (code) => data.categories.find((item) => item.code === code)?.label || code;
  const rows = useMemo(() => data.projects.filter((project) => !search || `${project.name} ${project.description || ''}`.toLowerCase().includes(search.toLowerCase())), [data.projects, search]);

  if (data.loading) {
    return <div className="mt-8 space-y-3" aria-hidden="true">{[0, 1, 2, 3].map((index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-white" />)}</div>;
  }
  if (!data.projects.length) {
    return (
      <div className="flex flex-col items-center px-6 pb-20 pt-16 text-center">
        <StudioIllustration className="h-48 w-48" />
        <h2 className="mt-8 text-[20px] font-semibold tracking-tight text-ink">No projects yet</h2>
        <p className="mt-2 max-w-md text-[14px] leading-6 text-slate-500">Projects are editable collections of automation elements like workflows and variables, which are used to automate a specific process.</p>
        <div className="mt-7">{createNew}</div>
      </div>
    );
  }
  return (
    <div className="pt-7">
      <div className="mb-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-tight text-ink">{VIEW_LABELS[view]}</h2>
            <p className="mt-0.5 text-[13px] text-slate-500">{data.projects.length} project{data.projects.length === 1 ? '' : 's'} · {data.workflows.length} workflow{data.workflows.length === 1 ? '' : 's'} · {(data.flows || []).length} flow{(data.flows || []).length === 1 ? '' : 's'} · {(data.agents || []).length} agent{(data.agents || []).length === 1 ? '' : 's'} · {(data.apps || []).length} app{(data.apps || []).length === 1 ? '' : 's'} · {(data.caseTypes || []).length} case type{(data.caseTypes || []).length === 1 ? '' : 's'} · {(data.processes || []).length} process{(data.processes || []).length === 1 ? '' : 'es'}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="relative">
              <span className="sr-only">{`Search ${VIEW_LABELS[view].toLowerCase()}`}</span>
              <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${VIEW_LABELS[view].toLowerCase()}`} className="h-9 w-56 rounded-lg border border-[#ECE8E3] bg-white pl-8 pr-3 text-[13px] text-ink placeholder:text-slate-400 focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15" />
            </label>
            {createNew}
          </div>
        </div>
        <div className="inline-flex max-w-full self-start overflow-x-auto rounded-lg border border-[#ECE8E3] bg-white p-0.5" role="tablist" aria-label="Cloud workspace view">
          {Object.entries(VIEW_LABELS).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => onView(key)} className={`rounded-md px-3 py-1 text-[12.5px] font-semibold transition-colors ${view === key ? 'bg-[#F6F4F1] text-ink shadow-[inset_0_0_0_1px_rgba(23,33,37,0.06)]' : 'text-slate-500 hover:text-ink'}`}>{label}</button>
          ))}
        </div>
      </div>
      {view === 'flows' ? <FlowsTable flows={data.flows || []} search={search} /> : view === 'agents' ? <AgentsTable agents={data.agents || []} search={search} /> : view === 'apps' ? <AppsTable apps={data.apps || []} search={search} /> : view === 'cases' ? <CaseTypesTable caseTypes={data.caseTypes || []} search={search} /> : view === 'processes' ? <ProcessesTable processes={data.processes || []} search={search} onCreate={onCreateProcess} /> : (
      <div className="overflow-x-auto rounded-xl u-card">
        <table className="w-full min-w-[820px] text-left text-[13px]">
          <thead className="border-b border-[#ECE8E3] bg-[#FBFAF8] text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
            <tr>
              <th scope="col" className="py-2.5 pl-5 pr-3 font-semibold">Name</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Workflows</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Category</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Owner</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Last updated</th>
              <th scope="col" className="py-2.5 pl-3 pr-5 text-right font-semibold"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1EEEA]">
            {rows.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">No projects match “{search}”.</td></tr>}
            {rows.map((project) => {
              const list = flows(project.id);
              const processes = processFlows(project.id);
              const published = list.filter((flow) => flow.status === 'published').length;
              const open = Boolean(expanded[project.id]);
              return (
                <Fragment key={project.id}>
                  <tr className="group transition-colors hover:bg-[#FCFBFA]">
                    <td className="py-3 pl-3 pr-3">
                      <div className="flex items-center gap-2">
                        <button type="button" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-[#F6F4F1] hover:text-ink disabled:invisible" disabled={!list.length && !processes.length} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} workflows and flows in ${project.name}`} onClick={() => setExpanded({ ...expanded, [project.id]: !open })}>
                          <Icon name="chevronRight" className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
                        </button>
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#ECE8E3] bg-[#F6F4F1] text-[13px] font-semibold text-charcoal">{project.name?.[0]?.toUpperCase()}</span>
                        <div className="min-w-0">
                          <Link to={`/workflows?projectId=${project.id}`} className="block max-w-[320px] truncate font-semibold text-ink hover:text-ember">{project.name}</Link>
                          {project.description && <p className="max-w-[320px] truncate text-xs text-slate-500">{project.description}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 tabular-nums text-slate-600">{list.length}{list.length > 0 && <span className="text-slate-400"> · {published} published</span>}{processes.length > 0 && <span className="text-slate-400"> · {processes.length} flow{processes.length === 1 ? '' : 's'}</span>}</td>
                    <td className="px-3 py-3 text-slate-600">{category(project.category)}</td>
                    <td className="px-3 py-3 text-slate-600">{owner(project)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600">{timeAgo(project.updated_at || project.created_at)}</td>
                    <td className="relative py-3 pl-3 pr-5">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link to={`/workflows?projectId=${project.id}`} className="rounded-md border border-[#ECE8E3] px-2.5 py-1 text-[13px] font-medium text-ink hover:border-[#E2DCD5] hover:bg-[#F6F4F1]">Open</Link>
                        {canWriteWorkflow(user?.role) && <Link to={`/workflows/new?projectId=${project.id}`} className="inline-flex items-center gap-1 rounded-md border border-[#ECE8E3] px-2.5 py-1 text-[13px] font-medium text-ink hover:border-[#E2DCD5] hover:bg-[#F6F4F1]"><Icon name="plus" className="h-3.5 w-3.5" />Workflow</Link>}
                        <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label={`More actions for ${project.name}`} aria-haspopup="menu" aria-expanded={menu === project.id} onClick={() => setMenu(menu === project.id ? '' : project.id)}><Icon name="more" className="h-4 w-4" strokeWidth={2.6} /></button>
                      </div>
                      {menu === project.id && <RowMenu project={project} onClose={() => setMenu('')} />}
                    </td>
                  </tr>
                  {open && list.map((flow) => (
                    <tr key={flow.id} className="bg-[#FCFBFA]">
                      <td className="py-2.5 pl-[84px] pr-3">
                        <div className="flex items-center gap-2.5"><Icon name="studio" className="h-4 w-4 text-slate-400" /><Link to={`/workflows/${flow.id}`} className="truncate font-medium text-ink hover:text-ember">{flow.name}</Link></div>
                      </td>
                      <td className="px-3 py-2.5"><StatusPill status={flow.status} /></td>
                      <td className="px-3 py-2.5 capitalize text-slate-500">{flow.execution_type || 'native'}</td>
                      <td className="px-3 py-2.5 text-slate-500">{data.users?.find((item) => item.id === flow.created_by)?.displayName || (flow.created_by === user?.id ? 'You' : '—')}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{timeAgo(flow.updated_at)}</td>
                      <td className="py-2.5 pl-3 pr-5 text-right"><Link to={`/workflows/${flow.id}`} className="text-[13px] font-medium text-slate-600 hover:text-ember">Open in Studio →</Link></td>
                    </tr>
                  ))}
                  {open && processes.map((flow) => (
                    <tr key={flow.id} className="bg-[#FCFBFA]">
                      <td className="py-2.5 pl-[84px] pr-3">
                        <div className="flex items-center gap-2.5"><Icon name="flow" className="h-4 w-4 text-ember" /><Link to={`/studio/flows/${flow.id}`} className="truncate font-medium text-ink hover:text-ember">{flow.name}</Link><span className="rounded bg-[#FFF1EC] px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide text-ember">Flow</span></div>
                      </td>
                      <td className="px-3 py-2.5"><StatusPill status={flow.status} /></td>
                      <td className="px-3 py-2.5 capitalize text-slate-500">{flow.triggerType}</td>
                      <td className="px-3 py-2.5 text-slate-500">{flow.lastRun ? <StatusPill status={flow.lastRun.status} /> : '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{timeAgo(flow.updatedAt)}</td>
                      <td className="py-2.5 pl-3 pr-5 text-right"><Link to={`/studio/flows/${flow.id}`} className="text-[13px] font-medium text-slate-600 hover:text-ember">Open editor →</Link></td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

function LocalWorkspace({ robots, loading }) {
  const steps = [
    ['Register a robot', 'In Settings, add a robot for the machine and copy its one-time token.'],
    ['Run the robot agent', 'On the Windows machine, start the URAP robot with that token. It sends a heartbeat every few seconds.'],
    ['Run desktop and attended work', 'Jobs that use desktop activities, or that you send to a robot, run on that machine.'],
  ];
  return (
    <div className="grid gap-6 pt-7 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="rounded-xl u-card p-6">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#E8F6F6] text-[#127C81]"><Icon name="monitor" className="h-5 w-5" /></span>
        <h2 className="mt-4 text-[17px] font-semibold tracking-tight text-ink">Automate on your own machine</h2>
        <p className="mt-1.5 max-w-xl text-[13.5px] leading-6 text-slate-500">Local workspace projects run on a URAP robot installed on your computer, so they can drive desktop applications and files that the cloud can't reach. You still design them here in Studio.</p>
        <ol className="mt-6 space-y-4">
          {steps.map(([title, body], index) => (
            <li key={title} className="flex gap-3.5">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[#ECE8E3] bg-[#F6F4F1] text-xs font-semibold tabular-nums text-charcoal">{index + 1}</span>
              <div><p className="text-[13.5px] font-semibold text-ink">{title}</p><p className="mt-0.5 text-[13px] leading-5 text-slate-500">{body}</p></div>
            </li>
          ))}
        </ol>
        <Link to="/settings" className="mt-6 inline-flex items-center gap-2 rounded-lg u-btn-primary px-3.5 py-2 text-[13px] font-semibold"><Icon name="robot" className="h-4 w-4" />Set up a robot</Link>
      </div>
      <div className="rounded-xl u-card">
        <div className="flex items-center justify-between border-b border-[#ECE8E3] px-5 py-3.5">
          <p className="text-[14px] font-semibold text-ink">Connected machines</p>
          <Link to="/settings" className="text-[13px] font-medium text-slate-600 hover:text-ember">Manage</Link>
        </div>
        {loading ? <div className="space-y-3 p-5" aria-hidden="true">{[0, 1].map((index) => <div key={index} className="h-4 animate-pulse rounded bg-slate-100" />)}</div> : robots.length ? (
          <ul className="divide-y divide-[#F1EEEA]">
            {robots.map((robot) => (
              <li key={robot.id} className="flex items-center gap-3 px-5 py-3">
                <span className={`h-2 w-2 rounded-full ${robot.reportedAvailable ? 'bg-[#2E9E57]' : 'bg-slate-300'}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-ink">{robot.name}</p>
                  <p className="text-xs text-slate-500">{robot.adapter || 'robot'} · {robot.lastHeartbeatAt ? `seen ${timeAgo(robot.lastHeartbeatAt)}` : 'never connected'}</p>
                </div>
                <span className={`text-xs font-medium ${robot.reportedAvailable ? 'text-[#1F6B3A]' : 'text-slate-500'}`}>{robot.reportedAvailable ? 'Online' : 'Offline'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[#F6F4F1] text-slate-400"><Icon name="monitor" className="h-5 w-5" /></span>
            <p className="mt-3 text-[13px] text-slate-500">No local machines connected yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function StudioPage() {
  const user = currentUser();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'cloud';
  const [data, setData] = useState({ loading: true, projects: [], workflows: [], flows: [], agents: [], apps: [], caseTypes: [], processes: [], categories: [], robots: [], users: null });
  const view = ['flows', 'agents', 'apps', 'cases', 'processes'].includes(params.get('view')) ? params.get('view') : 'projects';
  const [flowTemplate, setFlowTemplate] = useState('blank');
  const [dialog, setDialog] = useState('');
  const [notice, setNotice] = useState(null);

  async function load() {
    const get = (path) => api(path).catch(() => null);
    const [projects, workflows, categories, settings, users, flows, agents, apps, caseTypes, processes] = await Promise.all([
      get('/api/projects?limit=100'), get('/api/workflows?limit=100'), get('/api/categories'), get('/api/settings'),
      user?.role === 'administrator' ? get('/api/users') : Promise.resolve(null),
      get('/api/flows?limit=100'),
      get('/api/agents?limit=100'),
      get('/api/apps?limit=100'),
      get('/api/case-types?limit=100'),
      get('/api/bpmn?limit=100'),
    ]);
    setData({
      loading: false,
      projects: projects?.data || [],
      workflows: workflows?.data || [],
      flows: flows?.data || [],
      agents: agents?.data || [],
      apps: apps?.data || [],
      caseTypes: caseTypes?.data || [],
      processes: processes?.data || [],
      categories: categories?.data || [],
      robots: settings?.data?.robots || [],
      users: users?.data || null,
    });
  }
  useEffect(() => { load(); }, []);

  const choose = (key) => {
    setDialog('');
    if (key === 'project') { setDialog('project'); return; }
    if (key === 'agent') { setDialog('agent'); return; }
    if (key === 'app') { setDialog('app'); return; }
    if (key === 'case') { setDialog('case'); return; }
    if (key === 'bpmn') { setDialog('bpmn'); return; }
    if (key === 'flow' || key === 'flow-api') { setFlowTemplate(key === 'flow-api' ? 'api' : 'blank'); setDialog('flow'); return; }
    if (ROUTES[key]) navigate(ROUTES[key]);
  };
  const createNew = <CreateNewButton role={user?.role} onOpen={() => setDialog('start')} onQuick={choose} />;

  return (
    <main id="app-main" className="min-h-[calc(100vh-3.5rem)]">
      <div className="border-b border-[#ECE8E3] bg-white">
        <div className="mx-auto flex max-w-[1280px] items-end justify-between gap-4 px-5 sm:px-8 lg:px-10">
          <div className="flex gap-7" role="tablist" aria-label="Studio workspaces">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setParams(key === 'cloud' ? {} : { tab: key })} className={`-mb-px border-b-2 py-4 text-[14px] font-semibold transition-colors ${tab === key ? 'border-ember text-ink' : 'border-transparent text-slate-500 hover:text-ink'}`}>{label}</button>
            ))}
          </div>
          <Link to="/settings" className="mb-2.5 hidden items-center gap-2 rounded-lg border border-[#ECE8E3] bg-white px-3 py-1.5 text-[13px] font-semibold text-ink transition-colors hover:border-[#E2DCD5] hover:bg-[#F6F4F1] sm:inline-flex"><Icon name="download" className="h-4 w-4" />Install locally</Link>
        </div>
      </div>

      <div className="mx-auto max-w-[1280px] px-5 pb-16 sm:px-8 lg:px-10">
        {notice && (
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[#CDE9D6] bg-[#F2FAF4] px-4 py-3 text-[13px] text-ink" role="status">
            <span className="font-semibold">Project “{notice.name}” created.</span>
            {canWriteWorkflow(user?.role) && <Link to={`/workflows/new?projectId=${notice.id}`} className="font-semibold text-ember hover:underline">Create its first workflow →</Link>}
            <button type="button" className="ml-auto text-slate-500 hover:text-ink" aria-label="Dismiss" onClick={() => setNotice(null)}><Icon name="close" className="h-4 w-4" /></button>
          </div>
        )}
        {tab === 'cloud' && <CloudWorkspace data={data} createNew={createNew} onCreateProcess={canWriteWorkflow(user?.role) ? () => setDialog('bpmn') : undefined} view={view} onView={(key) => setParams(key === 'projects' ? {} : { view: key })} />}
        {tab === 'local' && <LocalWorkspace robots={data.robots} loading={data.loading} />}
        {tab === 'templates' && (
          <div className="pt-7">
            <h2 className="text-[17px] font-semibold tracking-tight text-ink">Templates</h2>
            <p className="mt-0.5 text-[13px] text-slate-500">Complete, validated workflows built from URAP activities. Try one to open it in the Workflow Designer, pick a project, and save.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{TEMPLATES.map((item) => <ShowcaseCard key={item.key} item={item} />)}</div>
          </div>
        )}
      </div>

      {dialog === 'start' && <StartBuildingModal role={user?.role} onClose={() => setDialog('')} onChoose={(option) => choose(option.action)} />}
      {dialog === 'flow' && <NewFlowDialog projects={data.projects.filter((project) => project.status !== 'archived')} template={flowTemplate} onClose={() => setDialog('')} onNewProject={() => setDialog('project')} onCreated={(flow) => navigate(`/studio/flows/${flow.id}`)} />}
      {dialog === 'agent' && <NewAgentDialog projects={data.projects.filter((project) => project.status !== 'archived')} onClose={() => setDialog('')} onNewProject={() => setDialog('project')} onCreated={(agent) => navigate(`/studio/agents/${agent.id}`)} />}
      {dialog === 'app' && <NewAppDialog projects={data.projects.filter((project) => project.status !== 'archived')} onClose={() => setDialog('')} onNewProject={() => setDialog('project')} onCreated={(app) => navigate(`/studio/apps/${app.id}`)} />}
      {dialog === 'case' && <NewCaseTypeDialog projects={data.projects.filter((project) => project.status !== 'archived')} onClose={() => setDialog('')} onNewProject={() => setDialog('project')} onCreated={(item) => navigate(`/studio/cases/${item.id}`)} />}
      {dialog === 'bpmn' && <NewProcessDialog projects={data.projects.filter((project) => project.status !== 'archived')} workflows={data.workflows} onClose={() => setDialog('')} onNewProject={() => setDialog('project')} onCreated={(item) => navigate(`/studio/processes/${item.id}`)} />}
      {dialog === 'project' && <NewProjectDialog onClose={() => setDialog('')} onCreated={(project) => { setDialog(''); setNotice(project); load(); }} />}
    </main>
  );
}
