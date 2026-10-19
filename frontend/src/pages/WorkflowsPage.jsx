import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, currentUser } from '../services/api.js';
import { EmptyState, ErrorText, StatusBadge, buttonClass, inputClass, quietClass } from '../components/ui.jsx';
import { ACTIVITIES, ACTIVITY_GROUPS, activityLabel, buildDefinition, edges, insertActivity, insertSteps, place, removeStep } from '../lib/workflowGraph.js';
import PropertyPanel from '../components/PropertyPanel.jsx';
import RecorderModal from '../components/RecorderModal.jsx';
import { ActivityIcon, CodeField, DropIllustration, Glyph } from '../components/DesignerChrome.jsx';
import { Icon } from '../components/brand.jsx';
import { templateByKey } from '../lib/workflowTemplates.js';

const START_STEPS = [
  { id: 'start', type: 'start', name: 'Start', config: { designer: { x: 48, y: 36 } }, errorPolicy: 'fail', next: 'end' },
  { id: 'end', type: 'end', name: 'End', config: { summaryFrom: [], designer: { x: 48, y: 168 } }, errorPolicy: 'fail', next: null },
];

const canWrite = (role) => ['administrator', 'project_manager', 'automation_developer'].includes(role);
const canRun = (role) => role !== 'viewer';

function WorkflowLibrary() {
  const navigate = useNavigate();
  const user = currentUser();
  const [rows, setRows] = useState([]);
  const [projects, setProjects] = useState([]);
  // ?projectId= (from Studio's "Open") pre-filters the library to one project.
  const query = new URLSearchParams(useLocation().search);
  const [filters, setFilters] = useState({ projectId: query.get('projectId') || '', status: '', search: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load(next = filters) {
    const params = new URLSearchParams({ limit: '100' });
    for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
    const result = await api(`/api/workflows?${params.toString()}`);
    setRows(result.data);
  }

  useEffect(() => {
    api('/api/projects?limit=100').then((result) => setProjects(result.data)).catch((err) => setError(err.message));
    load().catch((err) => setError(err.message));
  }, []);

  async function act(label, work) {
    try {
      setError('');
      const result = await work();
      setMessage(label);
      await load();
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }

  const projectName = (id) => projects.find((project) => project.id === id)?.name || '—';

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Workflow library</h1>{canWrite(user?.role) && <Link className={buttonClass} to="/workflows/new">New workflow</Link>}</div>
      <form className="grid gap-2 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); load().catch((err) => setError(err.message)); }}>
        <input className={inputClass} placeholder="Search name" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
        <select className={inputClass} value={filters.projectId} onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}><option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
        <select className={inputClass} value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Any status</option><option value="draft">Draft</option><option value="published">Published</option><option value="disabled">Disabled</option></select>
        <button className={buttonClass} type="submit">Apply</button>
      </form>
      <ErrorText>{error}</ErrorText>
      {message && <p className="text-sm text-success" role="status">{message}</p>}
      {rows.length === 0 ? <EmptyState title="No workflows" body="Build a workflow, validate it, and publish a version before running it." /> : (
        <div className="overflow-auto rounded-lg border border-line bg-white">
          <table className="min-w-full text-sm"><thead className="bg-cream2 text-muted"><tr><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Project</th><th className="px-3 py-2 text-left">Execution</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Updated</th><th className="px-3 py-2" /></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="px-3 py-2"><Link className="font-medium text-emberdark" to={`/workflows/${row.id}`}>{row.name}</Link><p className="text-muted">{row.description}</p></td>
                <td className="px-3 py-2">{projectName(row.project_id)}</td>
                <td className="px-3 py-2">{row.execution_type}</td>
                <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                <td className="px-3 py-2">{row.updated_at}</td>
                <td className="px-3 py-2"><div className="flex flex-wrap justify-end gap-1">
                  {row.status === 'published' && canRun(user?.role) && <button className={quietClass} type="button" onClick={() => act('Job queued', async () => { const job = await api(`/api/workflows/${row.id}/run`, { method: 'POST', body: { input: {} } }); navigate(`/jobs/${job.data.id}`); })}>Run</button>}
                  {canWrite(user?.role) && <button className={quietClass} type="button" onClick={() => act('Cloned as a new draft', () => api(`/api/workflows/${row.id}/clone`, { method: 'POST' }))}>Clone</button>}
                  {canWrite(user?.role) && row.status === 'published' && <button className={quietClass} type="button" onClick={() => act('Disabled', () => api(`/api/workflows/${row.id}/disable`, { method: 'POST' }))}>Disable</button>}
                  {canWrite(user?.role) && row.status === 'disabled' && <button className={quietClass} type="button" onClick={() => act('Enabled', () => api(`/api/workflows/${row.id}/enable`, { method: 'POST' }))}>Enable</button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function WorkflowDesigner() {
  const params = useParams();
  const navigate = useNavigate();
  const user = currentUser();
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [workflowId, setWorkflowId] = useState(params.id || '');
  const [workflow, setWorkflow] = useState(null);
  // Studio entry points: ?projectId= preselects the project, ?palette= pre-filters the activity
  // palette, ?import=codegen opens the recorder on its Playwright codegen import tab, and
  // ?template=<key> pre-fills a new workflow from lib/workflowTemplates.js (Home / Studio cards).
  const query = new URLSearchParams(useLocation().search);
  const [template] = useState(() => (params.id ? null : templateByKey(query.get('template'))));
  const [form, setForm] = useState({ projectId: params.id ? '' : (query.get('projectId') || ''), name: template?.title || '', description: template?.body || '', executionType: 'native' });
  const [retryPolicy, setRetryPolicy] = useState(template ? { ...template.retryPolicy } : { maxAttempts: 1, backoffSeconds: 0 });
  const [configText, setConfigText] = useState('{}');
  const [steps, setSteps] = useState(() => (template ? structuredClone(template.steps) : START_STEPS));
  const [selected, setSelected] = useState(0);
  const [loadKey, setLoadKey] = useState(0);
  const [input, setInput] = useState(template ? JSON.stringify(template.input || {}, null, 2) : '{\n  "rows": []\n}');
  const [validation, setValidation] = useState([]);
  const [connections, setConnections] = useState([]);
  const [picks, setPicks] = useState([]);
  const [recorderOpen, setRecorderOpen] = useState(!params.id && query.get('import') === 'codegen' && canWrite(user?.role));
  const [paletteFilter, setPaletteFilter] = useState(query.get('palette') || '');
  const [savedTick, setSavedTick] = useState(0);
  const zoomRef = useRef(1);

  async function loadWorkflow(id) {
    const result = await api(`/api/workflows/${id}`);
    const data = result.data;
    setWorkflow(data);
    setWorkflowId(data.id);
    setForm({ projectId: data.project_id, name: data.name, description: data.description || '', executionType: data.execution_type });
    const latest = data.versions?.[0]?.definition_json;
    if (latest?.steps) {
      setSteps(latest.steps.map((item, index) => ({ ...item, config: { ...(item.config || {}), designer: item.config?.designer || { x: 48, y: 36 + index * 108 } } })));
      setRetryPolicy(latest.retryPolicy || { maxAttempts: 1, backoffSeconds: 0 });
      setSelected(0);
      setLoadKey((key) => key + 1);
    }
  }

  useEffect(() => {
    api('/api/projects?limit=100&status=active').then((result) => setProjects(result.data)).catch((err) => setError(err.message));
    if (params.id) loadWorkflow(params.id).catch((err) => setError(err.message));
  }, [params.id]);

  useEffect(() => {
    if (!form.projectId) { setConnections([]); return; }
    api(`/api/projects/${form.projectId}/connections`).then((result) => setConnections(result.data)).catch(() => setConnections([]));
  }, [form.projectId]);

  const step = steps[selected];

  function applyConfig(config) {
    const next = { ...config, designer: step.config?.designer };
    updateStep({ config: next });
    const { designer, ...rest } = next;
    setConfigText(JSON.stringify(rest, null, 2));
  }

  function insertRecorded(items) {
    const result = insertSteps(steps, items);
    setSteps(result.steps);
    setSelected(result.index);
    setLoadKey((key) => key + 1);
    setRecorderOpen(false);
    setMessage(`Inserted ${items.length} recorded steps`);
  }

  useEffect(() => {
    if (!step) return;
    const { designer, ...rest } = step.config || {};
    setConfigText(JSON.stringify(rest, null, 2));
  }, [selected, step?.id, loadKey]);

  function updateStep(patch) {
    setSteps((current) => current.map((item, index) => (index === selected ? { ...item, ...patch } : item)));
  }

  function dragStep(index, event) {
    event.preventDefault();
    const origin = place(steps[index], index);
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (ev) => {
      const x = Math.max(16, Math.round(origin.x + (ev.clientX - startX) / zoomRef.current));
      const y = Math.max(16, Math.round(origin.y + (ev.clientY - startY) / zoomRef.current));
      setSteps((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, config: { ...item.config, designer: { x, y } } } : item)));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function addActivity(type) {
    const result = insertActivity(steps, type);
    setSteps(result.steps);
    setSelected(result.index);
  }

  const definition = useMemo(() => buildDefinition(steps, retryPolicy), [steps, retryPolicy]);
  const lines = useMemo(() => edges(steps), [steps]);

  async function ensureWorkflow() {
    if (workflowId) {
      if (workflow && (workflow.name !== form.name || (workflow.description || '') !== form.description || workflow.execution_type !== form.executionType)) {
        const updated = await api(`/api/workflows/${workflowId}`, { method: 'PATCH', body: { name: form.name, description: form.description, executionType: form.executionType } });
        setWorkflow((current) => ({ ...current, ...updated.data }));
      }
      return workflowId;
    }
    if (!form.projectId || !form.name) throw new Error('Choose a project and name the workflow');
    const created = await api('/api/workflows', { method: 'POST', body: form });
    setWorkflowId(created.data.id);
    setWorkflow({ ...created.data, versions: [] });
    window.history.replaceState(window.history.state, '', `/workflows/${created.data.id}`);
    return created.data.id;
  }

  function showValidation(result) {
    setValidation(result.errors || []);
    setError(result.valid ? '' : 'Validation failed. See the list in the properties panel.');
  }

  async function save() {
    const id = await ensureWorkflow();
    const result = await api(`/api/workflows/${id}/draft`, { method: 'POST', body: { definition } });
    showValidation(result.data.validation);
    setMessage(result.data.validation.valid ? 'Draft saved' : 'Draft saved with validation errors');
    return { id, valid: result.data.validation.valid };
  }

  async function guarded(work) {
    try { setMessage(''); await work(); } catch (err) { setError(err.message); }
  }

  const versions = workflow?.versions || [];
  const published = workflow?.status === 'published' && workflow?.current_version_id;

  // ----- Canvas view: pan + zoom, fit, fullscreen -------------------------------------------
  const NODE_W = 208;
  const NODE_H = 60;
  const sectionRef = useRef(null);
  const viewportRef = useRef(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  zoomRef.current = view.zoom;
  const [fullscreen, setFullscreen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [wideProps, setWideProps] = useState(false);
  const [menuFor, setMenuFor] = useState('');
  const [dropActive, setDropActive] = useState(false);

  const fit = useCallback((maxZoom = 1) => {
    const box = viewportRef.current;
    if (!box || !steps.length) return;
    const points = steps.map((item, index) => place(item, index));
    const minX = Math.min(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxX = Math.max(...points.map((p) => p.x)) + NODE_W;
    const maxY = Math.max(...points.map((p) => p.y)) + NODE_H;
    const width = box.clientWidth;
    const height = box.clientHeight;
    const zoom = Math.min(maxZoom, Math.max(0.4, Math.min((width - 96) / (maxX - minX), (height - 96) / (maxY - minY))));
    // Center horizontally; keep a short diagram near the top so the empty-state hint fits below it.
    const top = Math.max(48, Math.min((height - (maxY - minY) * zoom) / 2, 72));
    setView({ zoom, x: Math.round((width - (maxX - minX) * zoom) / 2 - minX * zoom), y: Math.round(top - minY * zoom) });
  }, [steps]);

  // Fit when a workflow loads or recorded steps are inserted.
  const fitKey = useRef(-1);
  useEffect(() => {
    if (fitKey.current === loadKey) return;
    // Mark the key as fitted inside the callback: StrictMode runs effects twice and cancels the
    // first frame, so marking it up front would skip the fit entirely.
    const frame = requestAnimationFrame(() => { fitKey.current = loadKey; fit(1); });
    // On first mount (a template or a blank workflow) the shell may still be settling; fit again.
    const settle = loadKey === 0 ? setTimeout(() => fit(1), 300) : null;
    return () => { cancelAnimationFrame(frame); clearTimeout(settle); };
  }, [loadKey, fit]);

  const zoomBy = (factor) => setView((current) => {
    const box = viewportRef.current;
    const zoom = Math.min(2, Math.max(0.3, Math.round(current.zoom * factor * 100) / 100));
    const cx = (box?.clientWidth || 0) / 2;
    const cy = (box?.clientHeight || 0) / 2;
    return { zoom, x: cx - ((cx - current.x) * zoom) / current.zoom, y: cy - ((cy - current.y) * zoom) / current.zoom };
  });

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === sectionRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else sectionRef.current?.requestFullscreen?.().catch(() => {});
  };

  function panStart(event) {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    setMenuFor('');
    const start = { x: event.clientX, y: event.clientY, view };
    const move = (ev) => setView({ ...start.view, x: start.view.x + ev.clientX - start.x, y: start.view.y + ev.clientY - start.y });
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function onWheel(event) {
    if (event.ctrlKey || event.metaKey) { zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1); return; }
    setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
  }

  function dropActivity(event) {
    event.preventDefault();
    setDropActive(false);
    const type = event.dataTransfer.getData('application/x-urap-activity');
    if (!type || !canWrite(user?.role)) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const x = Math.max(16, Math.round((event.clientX - rect.left - view.x) / view.zoom - NODE_W / 2));
    const y = Math.max(16, Math.round((event.clientY - rect.top - view.y) / view.zoom - NODE_H / 2));
    const result = insertActivity(steps, type);
    setSteps(result.steps.map((item, index) => (index === result.index ? { ...item, config: { ...item.config, designer: { x, y } } } : item)));
    setSelected(result.index);
  }

  // ----- Undo / redo over step edits (bursts of typing or dragging count as one change) ------
  const history = useRef({ past: [], future: [], committed: START_STEPS, pending: null, skip: false });
  const [, setHistoryTick] = useState(0);
  useEffect(() => {
    const h = history.current;
    if (h.skip) { h.skip = false; h.committed = steps; return; }
    if (h.pending) clearTimeout(h.pending.timer);
    const before = h.pending ? h.pending.before : h.committed;
    h.pending = { before, timer: setTimeout(() => { h.past.push(before); if (h.past.length > 100) h.past.shift(); h.future = []; h.committed = stepsRef.current; h.pending = null; setHistoryTick((n) => n + 1); }, 350) };
  }, [steps]);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  useEffect(() => { // a loaded workflow starts a fresh history
    const h = history.current;
    if (h.pending) clearTimeout(h.pending.timer);
    history.current = { past: [], future: [], committed: stepsRef.current, pending: null, skip: false };
    setHistoryTick((n) => n + 1);
  }, [workflow?.id]);
  function flushHistory() {
    const h = history.current;
    if (!h.pending) return;
    clearTimeout(h.pending.timer);
    h.past.push(h.pending.before); h.future = []; h.committed = stepsRef.current; h.pending = null;
  }
  function travel(direction) {
    flushHistory();
    const h = history.current;
    const from = direction === 'undo' ? h.past : h.future;
    if (!from.length) return;
    const target = from.pop();
    (direction === 'undo' ? h.future : h.past).push(h.committed);
    h.committed = target;
    h.skip = true;
    setSteps(target);
    setSelected((current) => Math.min(current, target.length - 1));
    setLoadKey((key) => key + 1);
    fitKey.current = loadKey + 1; // keep the current view
    setHistoryTick((n) => n + 1);
  }
  const canUndo = history.current.past.length > 0 || Boolean(history.current.pending);
  const canRedo = history.current.future.length > 0 && !history.current.pending;

  const removable = (item) => item && item.type !== 'start' && !(item.type === 'end' && steps.filter((s) => s.type === 'end').length === 1);
  function deleteStep(id) {
    const next = removeStep(steps, id);
    if (next !== steps) { setSteps(next); setSelected(0); }
  }
  function duplicateStep(index) {
    const source = steps[index];
    if (!source || source.type === 'start' || source.type === 'end') return;
    const result = insertActivity(steps, source.type);
    const { designer, ...config } = source.config || {};
    const at = place(source, index);
    setSteps(result.steps.map((item, i) => (i === result.index ? { ...item, name: `${source.name} (copy)`, errorPolicy: source.errorPolicy, timeoutMs: source.timeoutMs, config: { ...structuredClone(config), designer: { x: at.x + 32, y: at.y + 32 } } } : item)));
    setSelected(result.index);
    setLoadKey((key) => key + 1);
    fitKey.current = loadKey + 1;
  }

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') { setMenuFor(''); return; }
      const tag = document.activeElement?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || document.activeElement?.isContentEditable) return;
      if (!canWrite(user?.role)) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); travel(event.shiftKey ? 'redo' : 'undo'); }
      else if ((event.ctrlKey || event.metaKey) && key === 'y') { event.preventDefault(); travel('redo'); }
      else if (key === 'delete' && removable(step)) { event.preventDefault(); deleteStep(step.id); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!menuFor) return undefined;
    const close = (event) => { if (!event.target.closest?.('[role=menu],[aria-haspopup=menu]')) setMenuFor(''); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuFor]);

  // Unsaved marker for the tab: compares against the last saved or loaded definition.
  const savedSnapshot = useRef(null);
  const snapshot = JSON.stringify({ definition, name: form.name, description: form.description, executionType: form.executionType });
  if (savedSnapshot.current === null) savedSnapshot.current = snapshot;
  useEffect(() => { savedSnapshot.current = snapshot; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workflow?.id, versions[0]?.id, savedTick]);
  const dirty = snapshot !== savedSnapshot.current;

  const writable = canWrite(user?.role);
  const onlyEnds = steps.every((item) => item.type === 'start' || item.type === 'end');
  // ?palette=Web (an exact group name, as Home's activity-pack cards link) shows that whole group.
  const paletteGroup = ACTIVITY_GROUPS.find((group) => group.toLowerCase() === paletteFilter.trim().toLowerCase()) || '';
  const visibleGroups = ACTIVITY_GROUPS.map((group) => [group, ACTIVITIES.filter(([type, label, g]) => g === group && type !== 'start' && (paletteGroup ? g === paletteGroup : label.toLowerCase().includes(paletteFilter.toLowerCase())))]).filter(([, items]) => items.length);
  const field = 'h-8 rounded-lg border border-[#E2DCD5] bg-white px-2.5 text-[13px] text-[#172125] focus:border-[#E9521F] focus:outline-none focus:ring-2 focus:ring-[#E9521F]/15 disabled:bg-[#FAF9F7] disabled:text-slate-500';
  const toolBtn = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E2DCD5] bg-white px-2.5 text-[13px] font-semibold text-[#172125] shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-[#D6CFC7] hover:bg-[#F6F4F1] disabled:cursor-not-allowed disabled:opacity-50';
  const iconBtn = 'grid h-8 w-8 place-items-center rounded-lg text-[#4A555C] transition-colors hover:bg-[#F6F4F1] hover:text-[#172125] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent';
  const label = 'block text-[12px] font-medium text-[#4A555C]';
  const propInput = 'mt-1 h-9 w-full rounded-lg border border-[#E2DCD5] bg-white px-2.5 text-[13px] text-[#172125] focus:border-[#E9521F] focus:outline-none focus:ring-2 focus:ring-[#E9521F]/15';
  const panelHead = 'flex h-11 shrink-0 items-center justify-between border-b border-[#ECE8E3] px-4';

  return (
    <section ref={sectionRef} className={`flex flex-col bg-[#F7F5F2] text-[#172125] ${fullscreen ? 'h-screen' : 'min-h-[calc(100vh-3.5rem)] lg:h-[calc(100vh-3.5rem)]'}`}>
      <div className="flex shrink-0 flex-wrap items-end gap-x-2.5 gap-y-2 border-b border-[#ECE8E3] bg-white px-4 py-2">
        <nav className="flex h-8 items-center gap-1.5 text-[13px]" aria-label="Breadcrumb">
          <Link to="/workflows" className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-[#F6F4F1] hover:text-[#172125]" aria-label="Back to the library"><Glyph name="collapse" /></Link>
          <Link to="/workflows" className="hidden text-slate-500 hover:text-[#172125] 2xl:inline">Library</Link>
          <span className="hidden text-slate-300 2xl:inline">/</span>
          <span className="font-semibold">Designer</span>
        </nav>
        <label className="relative">
          <span className="sr-only">Workflow name</span>
          <input className={`${field} w-44 pr-8 font-medium`} placeholder="Workflow name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Glyph name="pencil" className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        </label>
        {workflow && <span className="flex h-8 items-center"><StatusBadge status={workflow.status} /></span>}
        <label className="flex flex-col gap-0.5"><span className="text-[11px] font-medium text-slate-500">Project</span>
          <select className={`${field} w-36`} value={form.projectId} disabled={Boolean(workflowId)} onChange={(event) => setForm({ ...form, projectId: event.target.value })}><option value="">Project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}{workflowId && !projects.some((project) => project.id === form.projectId) && <option value={form.projectId}>Current project</option>}</select>
        </label>
        <label className="flex flex-col gap-0.5"><span className="text-[11px] font-medium text-slate-500">Execution worker</span>
          <select className={`${field} w-40`} title="Native: the server worker runs every step. Robot: a UiPath robot or the URAP robot agent (npm run robot) runs the job on its machine. Hybrid: worker, with robot steps handed off." value={form.executionType} onChange={(event) => setForm({ ...form, executionType: event.target.value })}><option value="native">Native (worker)</option><option value="uipath">Robot (UiPath / URAP agent)</option><option value="hybrid">Hybrid</option></select>
        </label>
        <label className="flex flex-col gap-0.5"><span className="text-[11px] font-medium text-slate-500">Attempts</span><input type="number" min="1" max="5" className={`${field} w-16 px-2 tabular-nums`} value={retryPolicy.maxAttempts} onChange={(event) => setRetryPolicy({ ...retryPolicy, maxAttempts: Number(event.target.value) })} /></label>
        <label className="flex flex-col gap-0.5"><span className="text-[11px] font-medium text-slate-500">Backoff (s)</span><input type="number" min="0" max="3600" className={`${field} w-[72px] px-2 tabular-nums`} value={retryPolicy.backoffSeconds} onChange={(event) => setRetryPolicy({ ...retryPolicy, backoffSeconds: Number(event.target.value) })} /></label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {writable && <button className={toolBtn} type="button" onClick={() => setRecorderOpen(true)}><span className="grid h-3.5 w-3.5 place-items-center rounded-full border-[1.5px] border-[#E9521F]"><span className="h-1.5 w-1.5 rounded-full bg-[#E9521F]" /></span>Record web</button>}
          {writable && <button className={toolBtn} type="button" onClick={() => guarded(async () => { await save(); setSavedTick((n) => n + 1); })}><Glyph name="save" className="h-3.5 w-3.5" />Save</button>}
          <button className={toolBtn} type="button" onClick={() => guarded(async () => { const id = await ensureWorkflow(); const result = await api(`/api/workflows/${id}/validate`, { method: 'POST', body: { definition } }); showValidation(result.data); setMessage(result.data.valid ? 'Valid' : ''); })}><Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.2} />Validate</button>
          {writable && <button className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#F2B79F] bg-white px-3 text-[13px] font-semibold text-[#D63A0C] transition-colors hover:border-[#E9521F] hover:bg-[#FFF6F2] disabled:opacity-50" type="button" onClick={() => guarded(async () => { const saved = await save(); if (!saved.valid) return; await api(`/api/workflows/${saved.id}/publish`, { method: 'POST' }); await loadWorkflow(saved.id); setSavedTick((n) => n + 1); setMessage('Published'); })}><Icon name="upload" className="h-3.5 w-3.5" />Publish</button>}
          {canRun(user?.role) && <button className="u-btn-primary inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={!published} title={published ? 'Queue a test run' : 'Publish a version first'} onClick={() => guarded(async () => { const job = await api(`/api/workflows/${workflowId}/run`, { method: 'POST', body: { testRun: true, input: JSON.parse(input) } }); navigate(`/jobs/${job.data.id}`); })}><Icon name="play" className="h-3.5 w-3.5" />Run</button>}
        </div>
      </div>
      {error && <p className="shrink-0 border-b border-[#F4C7C1] bg-[#FEF3F2] px-4 py-1.5 text-[13px] text-[#B42318]" role="alert">{error}</p>}
      {message && <p className="shrink-0 border-b border-[#CDE9D6] bg-[#F2FAF4] px-4 py-1.5 text-[13px] text-[#1F6B3A]" role="status">{message}</p>}
      {template && !workflowId && !message && <p className="shrink-0 border-b border-[#F6DCCF] bg-[#FFF6F2] px-4 py-1.5 text-[13px] text-[#8A3412]" data-testid="template-note">Started from the “{template.title}” template. Choose a project, review the steps, then Save.</p>}

      <div className={`grid min-h-0 flex-1 gap-3 p-3 grid-rows-[auto_minmax(420px,1fr)_auto] lg:grid-rows-1 ${paletteOpen ? (wideProps ? 'lg:grid-cols-[248px_minmax(0,1fr)_440px]' : 'lg:grid-cols-[248px_minmax(0,1fr)_330px]') : (wideProps ? 'lg:grid-cols-[44px_minmax(0,1fr)_440px]' : 'lg:grid-cols-[44px_minmax(0,1fr)_330px]')}`}>
        {/* Activities */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[#ECE8E3] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]" aria-label="Activities">
          {paletteOpen ? (
            <>
              <div className={panelHead}>
                <h2 className="text-[14px] font-semibold text-[#D63A0C]">Activities</h2>
                <button type="button" className="hidden h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-[#F6F4F1] hover:text-[#172125] lg:grid" aria-label="Collapse activities" onClick={() => setPaletteOpen(false)}><Glyph name="collapse" /></button>
              </div>
              <div className="shrink-0 px-3 pt-3">
                <label className="relative block">
                  <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input className="h-8 w-full rounded-lg border border-[#E2DCD5] bg-[#FCFBFA] pl-8 pr-2.5 text-[13px] placeholder:text-slate-400 focus:border-[#E9521F] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E9521F]/15" placeholder="Search activities" aria-label="Search activities" value={paletteFilter} onChange={(event) => setPaletteFilter(event.target.value)} />
                </label>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {visibleGroups.length === 0 && <p className="px-2 py-6 text-center text-[12.5px] text-slate-500">No activities match “{paletteFilter}”.</p>}
                {visibleGroups.map(([group, items]) => (
                  <div key={group} className="mt-3">
                    <p className="px-2 pb-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#E0631F]">{group}</p>
                    <div className="flex gap-1 overflow-x-auto lg:block lg:space-y-0.5">
                      {items.map(([type, text]) => (
                        <button
                          key={type}
                          type="button"
                          draggable={writable}
                          onDragStart={(event) => { event.dataTransfer.setData('application/x-urap-activity', type); event.dataTransfer.effectAllowed = 'copy'; }}
                          title={writable ? 'Click to add, or drag onto the canvas' : undefined}
                          className="group flex shrink-0 items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left text-[13px] text-[#172125] transition-colors hover:border-[#ECE8E3] hover:bg-[#FAF9F7] lg:w-full"
                          onClick={() => addActivity(type)}
                        >
                          <ActivityIcon type={type} />
                          <span className="min-w-0 flex-1 truncate">{text}</span>
                          <Icon name="grip" className="hidden h-4 w-4 shrink-0 text-slate-300 group-hover:text-slate-500 lg:block" strokeWidth={2.6} />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <button type="button" className="flex h-full flex-col items-center gap-3 pt-3 text-slate-500 hover:text-[#172125]" aria-label="Expand activities" onClick={() => setPaletteOpen(true)}>
              <Glyph name="collapse" className="h-4 w-4 rotate-180" />
              <span className="text-[12px] font-semibold text-[#D63A0C] [writing-mode:vertical-rl]">Activities</span>
            </button>
          )}
        </aside>

        {/* Canvas */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[#ECE8E3] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="flex h-10 shrink-0 items-end gap-1 border-b border-[#ECE8E3] bg-[#FAF9F7] px-2">
            <div className="flex h-9 items-center gap-2 rounded-t-lg border border-b-0 border-[#ECE8E3] bg-white px-3 text-[13px] font-semibold" role="tab" aria-selected="true">
              <ActivityIcon type="if_else" round className="h-4 w-4" iconClassName="h-2.5 w-2.5" />
              <span className="max-w-[220px] truncate">{form.name || 'New workflow'}</span>
              {dirty && <span className="h-2 w-2 rounded-full bg-[#E9521F]" title="Unsaved changes" aria-label="Unsaved changes" />}
            </div>
            <Link to="/workflows/new" className="mb-1 grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-white hover:text-[#172125]" aria-label="New workflow" title="New workflow"><Glyph name="plus" /></Link>
          </div>
          <div className="flex h-11 shrink-0 items-center gap-1 border-b border-[#ECE8E3] px-2" role="toolbar" aria-label="Canvas">
            <button type="button" className={iconBtn} aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!writable || !canUndo} onClick={() => travel('undo')}><Icon name="undo" className="h-4 w-4" /></button>
            <button type="button" className={iconBtn} aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!writable || !canRedo} onClick={() => travel('redo')}><Glyph name="redo" className="h-4 w-4" strokeWidth={1.7} /></button>
            <span className="mx-1 h-5 w-px bg-[#ECE8E3]" aria-hidden="true" />
            <button type="button" className={iconBtn} aria-label="Duplicate activity" title="Duplicate the selected activity" disabled={!writable || !step || step.type === 'start' || step.type === 'end'} onClick={() => duplicateStep(selected)}><Icon name="copy" className="h-4 w-4" /></button>
            <button type="button" className={iconBtn} aria-label="Delete activity" title="Delete the selected activity (Delete)" disabled={!writable || !removable(step)} onClick={() => deleteStep(step.id)}><Icon name="trash" className="h-4 w-4" /></button>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold text-[#4A555C] hover:bg-[#F6F4F1] hover:text-[#172125]" onClick={() => fit(1.25)}><Glyph name="fit" className="h-4 w-4" />Fit to view</button>
              <span className="mx-1 h-5 w-px bg-[#ECE8E3]" aria-hidden="true" />
              <div className="flex items-center rounded-lg border border-[#ECE8E3]">
                <button type="button" className="grid h-7 w-7 place-items-center text-[#4A555C] hover:bg-[#F6F4F1]" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}><Glyph name="minus" /></button>
                <button type="button" className="h-7 min-w-[52px] border-x border-[#ECE8E3] px-1 text-[12px] font-semibold tabular-nums text-[#172125] hover:bg-[#F6F4F1]" title="Reset to 100%" onClick={() => setView((current) => ({ ...current, zoom: 1 }))}>{Math.round(view.zoom * 100)}%</button>
                <button type="button" className="grid h-7 w-7 place-items-center text-[#4A555C] hover:bg-[#F6F4F1]" aria-label="Zoom in" onClick={() => zoomBy(1.2)}><Glyph name="plus" /></button>
              </div>
              <button type="button" className={iconBtn} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen}><Glyph name={fullscreen ? 'exitFullscreen' : 'fullscreen'} /></button>
            </div>
          </div>
          <div
            ref={viewportRef}
            className={`relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing ${dropActive ? 'bg-[#FFF8F4]' : 'bg-[#FCFBFA]'}`}
            style={{ backgroundImage: 'radial-gradient(#DAD5CF 1px, transparent 1px)', backgroundSize: `${18 * view.zoom}px ${18 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
            onMouseDown={panStart}
            onWheel={onWheel}
            onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-urap-activity')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropActive(true); } }}
            onDragLeave={(event) => { if (event.currentTarget === event.target) setDropActive(false); }}
            onDrop={dropActivity}
            aria-label="Workflow canvas"
          >
            <div className="pointer-events-none absolute left-0 top-0 h-[1400px] w-[1400px] origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
              <svg className="absolute left-0 top-0 h-[1400px] w-[1400px] overflow-visible">
                <defs><marker id="wf-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M1,1 L9,5 L1,9 z" fill="#B8B2AB" /></marker></defs>
                {lines.map((edge) => {
                  const fromIndex = steps.findIndex((item) => item.id === edge.from);
                  const toIndex = steps.findIndex((item) => item.id === edge.to);
                  const from = place(steps[fromIndex], fromIndex);
                  const to = place(steps[toIndex], toIndex);
                  const color = { next: '#B8B2AB', true: '#3F8A57', false: '#C2463A', body: '#E07A3D' }[edge.kind];
                  let x1 = from.x + NODE_W / 2;
                  let y1 = from.y + NODE_H;
                  let x2 = to.x + NODE_W / 2;
                  let y2 = to.y - 2;
                  let mid = (y1 + y2) / 2;
                  let path = `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`;
                  if (y2 <= y1 + 8) {
                    // Target is level with or above the source: join the facing sides instead.
                    const right = to.x >= from.x + NODE_W / 2;
                    x1 = right ? from.x + NODE_W : from.x;
                    y1 = from.y + NODE_H / 2;
                    x2 = right ? to.x - 2 : to.x + NODE_W + 2;
                    y2 = to.y + NODE_H / 2;
                    const bend = Math.max(40, Math.abs(x2 - x1) / 2) * (right ? 1 : -1);
                    path = `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`;
                    mid = (y1 + y2) / 2;
                  }
                  return (
                    <g key={`${edge.from}-${edge.to}-${edge.kind}`}>
                      <path d={path} fill="none" stroke={color} strokeWidth="1.6" markerEnd="url(#wf-arrow)" strokeDasharray={edge.kind === 'body' ? '5 4' : undefined} />
                      {edge.kind !== 'next' && <text x={(x1 + x2) / 2 + 6} y={mid} fontSize="11" fontWeight="600" fill={color}>{edge.kind}</text>}
                    </g>
                  );
                })}
              </svg>
              {steps.map((item, index) => {
                const at = place(item, index);
                const isSelected = index === selected;
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`${item.name} (${activityLabel(item.type)})`}
                    className={`pointer-events-auto absolute flex cursor-pointer items-center gap-3 rounded-xl border bg-white pl-3 pr-1.5 text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E9521F]/40 ${isSelected ? 'border-[#E9521F] shadow-[0_0_0_3px_rgba(233,82,31,0.14),0_6px_16px_-8px_rgba(23,33,37,0.25)]' : 'border-[#E4DFD9] shadow-[0_1px_2px_rgba(16,24,40,0.05),0_4px_12px_-8px_rgba(23,33,37,0.18)] hover:border-[#D6CFC7]'}`}
                    style={{ left: at.x, top: at.y, width: NODE_W, height: NODE_H }}
                    onMouseDown={(event) => { setMenuFor(''); dragStep(index, event); }}
                    onClick={() => setSelected(index)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(index); } }}
                  >
                    <ActivityIcon type={item.type} round className="h-8 w-8" iconClassName="h-4 w-4" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold leading-[18px]">{item.name}</span>
                      <span className="block truncate text-[11.5px] leading-4 text-slate-500">{activityLabel(item.type)}</span>
                    </span>
                    <span className="relative">
                      <button type="button" className="grid h-7 w-6 place-items-center rounded-md text-slate-500 hover:bg-[#F6F4F1] hover:text-[#172125]" aria-label={`Actions for ${item.name}`} aria-haspopup="menu" aria-expanded={menuFor === item.id} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelected(index); setMenuFor(menuFor === item.id ? '' : item.id); }}><Glyph name="kebab" className="h-4 w-4" strokeWidth={2.6} /></button>
                      {menuFor === item.id && (
                        <span role="menu" className="absolute right-0 top-8 z-20 block w-40 rounded-xl border border-[#ECE8E3] bg-white p-1 shadow-[0_16px_40px_-16px_rgba(23,33,37,0.28)]" onMouseDown={(event) => event.stopPropagation()}>
                          <button type="button" role="menuitem" disabled={!writable || item.type === 'start' || item.type === 'end'} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-[#F6F4F1] disabled:cursor-not-allowed disabled:opacity-40" onClick={(event) => { event.stopPropagation(); setMenuFor(''); duplicateStep(index); }}><Icon name="copy" className="h-3.5 w-3.5" />Duplicate</button>
                          <button type="button" role="menuitem" disabled={!writable || !removable(item)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-[#B42318] hover:bg-[#FEF3F2] disabled:cursor-not-allowed disabled:opacity-40" onClick={(event) => { event.stopPropagation(); setMenuFor(''); deleteStep(item.id); }}><Icon name="trash" className="h-3.5 w-3.5" />Delete</button>
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            {onlyEnds && (
              <div className="pointer-events-none absolute inset-x-0 bottom-[12%] flex flex-col items-center px-6 text-center">
                <DropIllustration />
                <p className="mt-3 text-[15px] font-semibold text-[#172125]">Drag and drop activities here</p>
                <p className="mt-1 max-w-[300px] text-[12.5px] leading-5 text-slate-500">Start building your workflow by dragging activities from the left panel.</p>
              </div>
            )}
          </div>
        </div>

        {/* Properties */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[#ECE8E3] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]" aria-label="Properties">
          <div className={panelHead}>
            <h2 className="text-[14px] font-semibold text-[#D63A0C]">Properties</h2>
            <button type="button" className="hidden h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-[#F6F4F1] hover:text-[#172125] lg:grid" aria-label={wideProps ? 'Narrow the properties panel' : 'Widen the properties panel'} aria-pressed={wideProps} onClick={() => setWideProps((value) => !value)}><Glyph name="expand" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-3 [&_[data-testid=property-panel]_input]:rounded-lg [&_[data-testid=property-panel]_input]:border-[#E2DCD5] [&_[data-testid=property-panel]_select]:rounded-lg [&_[data-testid=property-panel]_select]:border-[#E2DCD5] [&_[data-testid=property-panel]_textarea]:rounded-lg [&_[data-testid=property-panel]_textarea]:border-[#E2DCD5] [&_[data-testid=property-panel]_label]:text-[#4A555C]">
            {step && (
              <>
                <div className="flex items-center gap-2.5 border-b border-[#F1EEEA] pb-3">
                  <ActivityIcon type={step.type} round className="h-7 w-7" iconClassName="h-3.5 w-3.5" />
                  <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{activityLabel(step.type)} <span className="font-mono text-[12px] font-normal text-slate-400">#{step.id}</span></p>
                  <span title="Use {{input.x}}, {{steps.id.field}}, and {{item.x}} in values" className="text-slate-400"><Glyph name="help" /></span>
                </div>
                <label className={`${label} mt-3`}>DisplayName<input className={propInput} value={step.name} onChange={(event) => updateStep({ name: event.target.value })} /></label>
                {step.type !== 'end' && step.type !== 'if_else' && (
                  <label className={`${label} mt-3`}>Next<select className={propInput} value={step.next || ''} onChange={(event) => updateStep({ next: event.target.value || null })}><option value="">None (ends this chain)</option>{steps.filter((item) => item.id !== step.id).map((item) => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}</select></label>
                )}
                {step.type === 'if_else' && ['whenTrue', 'whenFalse'].map((branch) => (
                  <label key={branch} className={`${label} mt-3`}>{branch === 'whenTrue' ? 'True' : 'False'}<select className={propInput} value={step.config[branch] || ''} onChange={(event) => { const config = { ...step.config, [branch]: event.target.value || null }; updateStep({ config }); const { designer, ...rest } = config; setConfigText(JSON.stringify(rest, null, 2)); }}><option value="">None</option>{steps.filter((item) => item.id !== step.id).map((item) => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}</select></label>
                ))}
                {step.type === 'for_each' && ['bodyStart', 'bodyEnd'].map((key) => (
                  <label key={key} className={`${label} mt-3`}>{key === 'bodyStart' ? 'Body first step' : 'Body last step'}<select className={propInput} value={step.config[key] || ''} onChange={(event) => { const config = { ...step.config, [key]: event.target.value || null }; updateStep({ config }); const { designer, ...rest } = config; setConfigText(JSON.stringify(rest, null, 2)); }}><option value="">None</option>{steps.filter((item) => item.id !== step.id).map((item) => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}</select></label>
                ))}
                {step.type !== 'start' && step.type !== 'end' && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className={label}>On error<select className={propInput} value={step.errorPolicy || 'fail'} onChange={(event) => updateStep({ errorPolicy: event.target.value })}><option value="fail">Fail job</option><option value="continue">Continue</option></select></label>
                    <label className={label}>Timeout ms<input type="number" min="1" max="600000" className={propInput} value={step.timeoutMs || ''} onChange={(event) => updateStep({ timeoutMs: event.target.value ? Number(event.target.value) : undefined })} /></label>
                  </div>
                )}
                <PropertyPanel key={`${step.id}-${loadKey}`} step={step} connections={connections} picks={picks} onConfig={applyConfig} />
                <div className="mt-4">
                  <p className={`${label} mb-1 flex items-center gap-1.5`}>All arguments (JSON)<span title="Use {{input.x}}, {{steps.id.field}}, {{item.x}}" className="text-slate-400"><Glyph name="help" className="h-3.5 w-3.5" /></span></p>
                  <CodeField ariaLabel="All arguments (JSON)" rows={8} value={configText} invalid={error === 'Arguments must be valid JSON'} onChange={(event) => { setConfigText(event.target.value); try { updateStep({ config: { ...JSON.parse(event.target.value), designer: step.config?.designer } }); setError(''); } catch { setError('Arguments must be valid JSON'); } }} />
                  <p className="mt-1 text-[11.5px] text-slate-400">Use {'{{input.x}}'}, {'{{steps.id.field}}'}, {'{{item.x}}'}</p>
                </div>
                {step.type !== 'start' && <button className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#ECE8E3] px-3 text-[12.5px] font-semibold text-[#B42318] hover:border-[#F4C7C1] hover:bg-[#FEF3F2] disabled:opacity-50" type="button" disabled={!removable(step)} onClick={() => deleteStep(step.id)}><Icon name="trash" className="h-3.5 w-3.5" />Delete activity</button>}
              </>
            )}
            {validation.length > 0 && (
              <div className="mt-4 rounded-lg border border-[#F4C7C1] bg-[#FEF3F2] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#B42318]">Validation</p>
                <ul className="mt-1 space-y-1 text-[12px] text-[#7A271A]">{validation.map((item, index) => <li key={`${item.path}-${index}`}><span className="font-mono">{item.path}</span>: {item.message}</li>)}</ul>
              </div>
            )}
            <div className="mt-4">
              <p className={`${label} mb-1 flex items-center gap-1.5`}>Test input (JSON)<span title="The input of a test run started with Run" className="text-slate-400"><Glyph name="help" className="h-3.5 w-3.5" /></span></p>
              <CodeField ariaLabel="Test input (JSON)" rows={4} value={input} onChange={(event) => setInput(event.target.value)} />
            </div>
            {versions.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Versions</p>
                <ul className="mt-1.5 space-y-1.5 text-[12px] text-slate-600">{versions.map((version) => <li key={version.id} className="flex items-center gap-2">v{version.version_number} <StatusBadge status={version.status} /> <span className="truncate text-slate-400">{version.published_at || version.created_at}</span></li>)}</ul>
              </div>
            )}
          </div>
        </aside>
      </div>
      {recorderOpen && <RecorderModal initialTab={!params.id && query.get('import') === 'codegen' ? 'codegen' : 'record'} onInsert={insertRecorded} onPicks={setPicks} onClose={() => setRecorderOpen(false)} />}
    </section>
  );
}

export default function WorkflowsPage({ mode }) {
  const { id } = useParams();
  return mode === 'library' ? <WorkflowLibrary /> : <WorkflowDesigner key={id || 'new'} />;
}
