import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../components/brand.jsx';
import { api, currentUser, download } from '../services/api.js';
import { EmptyState, ErrorText, Modal, StatusBadge, buttonClass, inputClass, quietClass } from '../components/ui.jsx';
import { SkeletonRows } from '../components/Loader.jsx';
import AuditLog from '../components/AuditLog.jsx';
import ReportsDashboard from '../components/ReportsDashboard.jsx';
import SettingsTabs from '../components/SettingsTabs.jsx';
import ConnectorCatalog from '../components/ConnectorCatalog.jsx';

const ACTIVE = ['QUEUED', 'CLAIMED', 'RUNNING', 'RETRY_WAIT', 'CANCEL_REQUESTED', 'SUSPENDED'];
const JOB_STATUSES = ['QUEUED', 'CLAIMED', 'RUNNING', 'SUSPENDED', 'SUCCEEDED', 'FAILED', 'RETRY_WAIT', 'CANCEL_REQUESTED', 'CANCELLED', 'SKIPPED'];
const TITLES = { connections: 'Connections', jobs: 'Jobs & runs', job: 'Job detail', schedules: 'Schedules', reports: 'Reports', audit: 'Audit logs', settings: 'Settings' };
const CONNECTION_HINTS = {
  rest_api: '{ "baseUrl": "https://api.example.com", "healthPath": "/health" }',
  mysql: '{ "host": "127.0.0.1", "port": 3306, "database": "erp", "user": "reader", "allowedTables": ["orders"] }',
  file_storage: '{ "rootRelative": "shared" }',
  email: '{ "host": "smtp.example.com", "port": 587, "from": "robot@example.com" }',
  browser_uipath: '{ "applicationName": "Portal", "startUrl": "https://portal.example.com" }',
  postgres: '{ "host": "127.0.0.1", "port": 5432, "database": "erp", "user": "reader", "allowedTables": ["orders"], "allowCustomQueries": false, "readOnly": true }',
  google_sheets: '{ "spreadsheetId": "1AbC…from the sheet URL" }',
  credential: '{ "description": "ERP portal login" }',
};
const SECRET_HINTS = {
  rest_api: '{ "token": "…" } or { "username": "…", "password": "…" } or { "apiKey": "…" }',
  mysql: '{ "password": "…" }',
  postgres: '{ "password": "…" }',
  email: '{ "user": "…", "password": "…" }',
  google_sheets: 'Paste the service account key JSON (client_email, private_key, token_uri)',
  credential: '{ "username": "…", "password": "…" }',
};

function Json({ value }) {
  if (value == null) return null;
  return <pre className="mt-1 max-h-64 overflow-auto rounded bg-mist p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

function useLoader(load, deps) {
  const [error, setError] = useState('');
  const run = () => load().then(() => setError('')).catch((err) => setError(err.message));
  useEffect(() => { run(); }, deps);
  return [error, setError, run];
}

function Connections() {
  const user = currentUser();
  const [data, setData] = useState(null);
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({});
  const [error, setError, reload] = useLoader(async () => {
    const [projectResult, connectorResult] = await Promise.all([api('/api/projects?limit=100'), api('/api/connectors')]);
    setProjects(projectResult.data);
    const lists = await Promise.all(projectResult.data.map((project) => api(`/api/projects/${project.id}/connections`)));
    setData({ connectors: connectorResult.data, connections: lists.flatMap((item, index) => item.data.map((row) => ({ ...row, projectName: projectResult.data[index].name }))) });
  }, []);
  const write = ['administrator', 'project_manager', 'automation_developer'].includes(user?.role);
  if (!data) return <><ErrorText>{error}</ErrorText>{!error && <SkeletonRows rows={5} cols={4} />}</>;
  return (
    <>
      <ErrorText>{error}</ErrorText>
      {write && (
        <form id="connection-form" className="grid gap-2 md:grid-cols-4" onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api(`/api/projects/${form.projectId}/connections`, { method: 'POST', body: { connectorType: form.connectorType, name: form.name, config: JSON.parse(form.config || '{}'), secret: form.secret ? JSON.parse(form.secret) : undefined } });
            setForm({});
            await reload();
          } catch (err) { setError(err.message); }
        }}>
          <select className={inputClass} value={form.projectId || ''} onChange={(event) => setForm({ ...form, projectId: event.target.value })}><option value="">Project</option>{projects.filter((project) => project.status === 'active').map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
          <select className={inputClass} value={form.connectorType || ''} onChange={(event) => setForm({ ...form, connectorType: event.target.value })}><option value="">Connector</option>{data.connectors.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select>
          <input className={inputClass} placeholder="Name" value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <button className={buttonClass} type="submit">Save connection</button>
          <textarea className={`${inputClass} font-mono md:col-span-2`} rows="3" placeholder={CONNECTION_HINTS[form.connectorType] || 'Config JSON, without secrets'} value={form.config || ''} onChange={(event) => setForm({ ...form, config: event.target.value })} />
          <textarea className={`${inputClass} font-mono md:col-span-2`} rows="3" placeholder={SECRET_HINTS[form.connectorType] ? `Secret JSON, stored encrypted: ${SECRET_HINTS[form.connectorType]}` : 'Secret JSON, stored encrypted, e.g. { "token": "..." } or { "password": "..." }'} value={form.secret || ''} onChange={(event) => setForm({ ...form, secret: event.target.value })} />
        </form>
      )}
      <ConnectorCatalog connectors={data.connectors} canAdd={write} onUse={(connectorType) => {
        setForm((current) => ({ ...current, connectorType }));
        const form = document.getElementById('connection-form');
        form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        form?.querySelector('input[placeholder="Name"]')?.focus({ preventScroll: true });
      }} />
      {data.connections.length === 0 ? <EmptyState title="No connections" body="Add a connector configuration for a project. Secrets are not shown again after saving." /> : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-white">{data.connections.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span>{row.projectName} · <span className="font-medium">{row.name}</span> · {row.connectorType} · secret {row.hasSecret ? 'stored' : 'none'} <StatusBadge status={row.status} />{row.lastError && <span className="block text-danger">{row.lastError}</span>}<span className="block font-mono text-xs text-muted">id {row.id}</span></span>
            {write && row.connectorType === 'credential' && <SetPassword row={row} onSaved={reload} onError={setError} />}
            {write && <button className={quietClass} type="button" onClick={async () => { try { const result = await api(`/api/connections/${row.id}/test`, { method: 'POST' }); setError(result.data.error || ''); await reload(); } catch (err) { setError(err.message); } }}>Test</button>}
          </li>
        ))}</ul>
      )}
    </>
  );
}

// Enter or replace the password of a Credential connection (for example REWAHR_PASSWORD).
// The value goes straight to the API, is stored encrypted, and is never shown again.
export function SetPassword({ row, onSaved, onError }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return <button className={quietClass} type="button" onClick={() => setOpen(true)}>{row.hasSecret ? 'Change password' : 'Set password'}</button>;
  return (
    <form className="flex items-center gap-2" onSubmit={async (event) => {
      event.preventDefault();
      if (!value) return;
      setBusy(true);
      try {
        await api(`/api/connections/${row.id}/secret`, { method: 'PUT', body: { secret: { ...(row.config?.username ? { username: row.config.username } : {}), password: value } } });
        setValue(''); setOpen(false); onError?.('');
        await onSaved?.();
      } catch (err) { onError?.(err.message); } finally { setBusy(false); }
    }}>
      <input className={inputClass} type="password" autoComplete="new-password" aria-label={`Password for ${row.name}`} placeholder={`Password for ${row.name}`} value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
      <button className={buttonClass} type="submit" disabled={busy || !value}>Save</button>
      <button className={quietClass} type="button" onClick={() => { setValue(''); setOpen(false); }}>Cancel</button>
    </form>
  );
}

function Jobs() {
  const [data, setData] = useState(null);
  const [projects, setProjects] = useState([]);
  const [filters, setFilters] = useState({ status: '', projectId: '', triggerSource: '' });
  const [auto, setAuto] = useState(true);
  const load = async () => {
    const params = new URLSearchParams({ limit: '100' });
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    setData(await api(`/api/jobs?${params.toString()}`));
  };
  const [error, , reload] = useLoader(async () => {
    setProjects((await api('/api/projects?limit=100')).data);
    await load();
  }, []);
  useEffect(() => {
    if (!auto) return undefined;
    const timer = setInterval(() => { load().catch(() => {}); }, 3000);
    return () => clearInterval(timer);
  }, [auto, filters]);
  const projectName = (id) => projects.find((project) => project.id === id)?.name || id.slice(0, 8);
  return (
    <>
      <ErrorText>{error}</ErrorText>
      <form className="grid gap-2 md:grid-cols-5" onSubmit={(event) => { event.preventDefault(); reload(); }}>
        <select className={inputClass} value={filters.projectId} onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}><option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
        <select className={inputClass} value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Any status</option>{JOB_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select>
        <select className={inputClass} value={filters.triggerSource} onChange={(event) => setFilters({ ...filters, triggerSource: event.target.value })}><option value="">Any trigger</option>{['manual', 'test', 'schedule', 'queue', 'retry', 'api'].map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} /> Auto refresh</label>
        <button className={buttonClass} type="submit">Apply</button>
      </form>
      {!data ? <SkeletonRows rows={6} cols={5} /> : data.data.length === 0 ? <EmptyState title="No jobs" body="Queue a published workflow. A queued job is not a completed run." /> : (
        <div className="overflow-auto rounded-lg border border-line bg-white"><table className="min-w-full text-sm"><thead className="bg-cream2 text-muted"><tr><th className="px-3 py-2 text-left">Job</th><th className="px-3 py-2 text-left">Project</th><th className="px-3 py-2 text-left">Target</th><th className="px-3 py-2 text-left">Trigger</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Attempt</th><th className="px-3 py-2 text-left">Queued</th><th className="px-3 py-2 text-left">Error</th></tr></thead>
          <tbody>{data.data.map((job) => <tr key={job.id} className="border-t border-line"><td className="px-3 py-2"><Link className="font-mono text-emberdark" to={`/jobs/${job.id}`}>{job.id.slice(0, 8)}</Link></td><td className="px-3 py-2">{projectName(job.projectId)}</td><td className="px-3 py-2">{job.executionTarget}</td><td className="px-3 py-2">{job.triggerSource}</td><td className="px-3 py-2"><StatusBadge status={job.status} /></td><td className="px-3 py-2">{job.attempt}/{job.maxAttempts}</td><td className="px-3 py-2">{job.queuedAt}</td><td className="max-w-xs truncate px-3 py-2 text-danger">{job.errorSummary}</td></tr>)}</tbody></table>
          <p className="px-3 py-2 text-xs text-muted">{data.meta.total} job(s)</p></div>
      )}
    </>
  );
}

// ----- Job detail: restrained Automation Cloud styling (neutral tiles, one orange accent) -----
const utc = (value) => (value ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${String(value).replace(' ', 'T')}Z`) : null);
function when(value) {
  const date = utc(value);
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
}
function span(from, to) {
  const a = utc(from); const b = utc(to);
  if (!a || !b) return null;
  return b - a;
}
function ms(value) {
  if (value == null || Number.isNaN(value)) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(value < 10000 ? 2 : 1)} s`;
  const minutes = Math.floor(value / 60000);
  return `${minutes} min ${Math.round((value % 60000) / 1000)} s`;
}
const JOB_TONE = {
  SUCCEEDED: ['Succeeded', 'bg-[#EEF7F1] text-[#256B42] border-[#D3EBDC]', '#3E9B63'],
  FAILED: ['Failed', 'bg-[#FDF1F0] text-[#A8352B] border-[#F6D5D1]', '#D2493C'],
  RUNNING: ['Running', 'bg-[#FFF4EE] text-[#C2410C] border-[#FBDCCB]', '#FA4616'],
  CLAIMED: ['Starting', 'bg-[#FFF4EE] text-[#C2410C] border-[#FBDCCB]', '#FA4616'],
  SUSPENDED: ['Waiting for task', 'bg-[#FBF6EC] text-[#8A5A0B] border-[#EFE1C4]', '#C89220'],
  RETRY_WAIT: ['Retry wait', 'bg-[#FBF6EC] text-[#8A5A0B] border-[#EFE1C4]', '#C89220'],
};
function JobPill({ status }) {
  const [label, tone, dot] = JOB_TONE[status] || [String(status || '').toLowerCase().replace(/_/g, ' '), 'bg-[#F5F2EE] text-[#4A5568] border-[#ECE6DF]', '#94A3B8'];
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium capitalize ${tone}`}><span className={`h-1.5 w-1.5 rounded-full ${status === 'RUNNING' ? 'animate-pulse' : ''}`} style={{ background: dot }} aria-hidden="true" />{label}</span>;
}
const neutralChip = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#ECE6DF] bg-[#F7F5F2] px-2.5 py-0.5 text-[12px] font-medium text-[#5B6474]';
const panel = 'rounded-2xl border border-[#ECE8E3] bg-white shadow-[0_1px_2px_rgba(20,33,61,0.04),0_8px_24px_-18px_rgba(20,33,61,0.18)]';
const STEP_ICON = { start: 'play', end: 'check', if_else: 'decision', for_each: 'refresh', create_task: 'tasks', send_notification: 'bell', log_message: 'list', ocr_extract: 'document', extract_document_fields: 'document', http_request: 'api', database_query: 'database' };
const stepIcon = (type = '') => STEP_ICON[type] || (/csv|excel|sheet|transform|validate|duplicate/.test(type) ? 'table' : /browser/.test(type) ? 'globe' : /desktop/.test(type) ? 'monitor' : /queue/.test(type) ? 'queue' : /pdf|file/.test(type) ? 'document' : 'bolt');

function CodeBlock({ value }) {
  if (value == null) return null;
  let parsed = value;
  if (typeof value === 'string') { try { parsed = JSON.parse(value); } catch { parsed = value; } }
  const text = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
  return <pre className="mt-2 max-h-72 overflow-auto rounded-xl border border-[#EEE9E3] bg-[#FBFAF8] px-3.5 py-3 font-mono text-[12px] leading-5 text-[#334155]">{text}</pre>;
}

function Disclosure({ label, meta, children, defaultOpen = false }) {
  return (
    <details className="group/d" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-medium text-slate-500 hover:text-[#E03A0E] [&::-webkit-details-marker]:hidden">
        <Icon name="chevronRight" className="h-3.5 w-3.5 transition-transform group-open/d:rotate-90" />{label}{meta && <span className="font-normal text-slate-400">{meta}</span>}
      </summary>
      {children}
    </details>
  );
}

function StatTile({ icon, label, value, sub }) {
  return (
    <div className="rounded-xl border border-[#EEE9E3] bg-[#FBFAF8] px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500"><Icon name={icon} className="h-3.5 w-3.5 text-slate-400" />{label}</p>
      <p className="mt-1.5 text-[20px] font-semibold tabular-nums leading-none tracking-tight text-ink">{value}</p>
      {sub && <p className="mt-1.5 truncate text-[11.5px] text-slate-500">{sub}</p>}
    </div>
  );
}

function SectionTitle({ icon, title, meta }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-lg border border-[#ECE6DF] bg-[#F5F2EE] text-[#3B4A5E]"><Icon name={icon} className="h-4 w-4" /></span>
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      {meta && <span className="text-[12.5px] text-slate-500">{meta}</span>}
    </div>
  );
}

function JobDetail() {
  const params = useParams();
  const user = currentUser();
  const [data, setData] = useState(null);
  const [workflowName, setWorkflowName] = useState('');
  const timer = useRef(null);
  const load = async () => { setData(await api(`/api/jobs/${params.id}`)); };
  const [error, setError, reload] = useLoader(load, [params.id]);
  useEffect(() => {
    clearInterval(timer.current);
    if (data && ACTIVE.includes(data.data.status)) timer.current = setInterval(() => { load().catch(() => {}); }, 2000);
    return () => clearInterval(timer.current);
  }, [data?.data?.status]);
  const workflowId = data?.data?.workflowId;
  useEffect(() => {
    if (!workflowId) return;
    api(`/api/workflows/${workflowId}`).then((result) => setWorkflowName(result.data?.name || '')).catch(() => {});
  }, [workflowId]);
  if (!data) return <><ErrorText>{error}</ErrorText>{!error && <SkeletonRows rows={5} cols={4} />}</>;
  const job = data.data;
  const control = ['administrator', 'project_manager', 'operator'].includes(user?.role);
  const finishedSteps = job.steps.filter((step) => step.status !== 'RUNNING');
  const total = span(job.startedAt, job.finishedAt);
  const wait = span(job.queuedAt, job.startedAt);
  const longest = Math.max(1, ...finishedSteps.map((step) => Number(step.duration_ms) || 0));
  const failedSteps = finishedSteps.filter((step) => step.status === 'FAILED').length;
  const hasInput = job.input && (typeof job.input !== 'object' || Object.keys(job.input).length > 0);
  const act = (path) => async () => { try { await api(`/api/jobs/${params.id}/${path}`, { method: 'POST' }); await reload(); } catch (err) { setError(err.message); } };
  const secondaryBtn = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E2DCD5] bg-white px-3 text-[13px] font-semibold text-ink transition-colors hover:border-[#FBDCCB] hover:text-[#E03A0E]';
  return (
    <div className="space-y-6">
      <ErrorText>{error}</ErrorText>

      <section className={`${panel} p-5 sm:p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <JobPill status={job.status} />
              {ACTIVE.includes(job.status) && <span className="text-[12px] text-slate-500">Refreshing every 2 s</span>}
            </div>
            <h2 className="mt-2.5 truncate text-[20px] font-semibold tracking-[-0.02em] text-ink">
              <Link className="hover:text-[#E03A0E]" to={`/workflows/${job.workflowId}`}>{workflowName || `Workflow ${job.workflowId.slice(0, 8)}`}</Link>
            </h2>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className={`${neutralChip} capitalize`}><Icon name="bolt" className="h-3.5 w-3.5 text-slate-400" />Trigger: {job.triggerSource}</span>
              <span className={`${neutralChip} capitalize`}><Icon name="robot" className="h-3.5 w-3.5 text-slate-400" />Target: {job.executionTarget}</span>
              <span className={neutralChip}><Icon name="refresh" className="h-3.5 w-3.5 text-slate-400" />Attempt {job.attempt} of {job.maxAttempts}</span>
            </div>
          </div>
          {control && (['FAILED', 'CANCELLED'].includes(job.status) || (ACTIVE.includes(job.status) && job.status !== 'CANCEL_REQUESTED')) && (
            <div className="flex gap-2">
              {['FAILED', 'CANCELLED'].includes(job.status) && <button className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#FA4616] px-3.5 text-[13px] font-semibold text-white hover:bg-[#E23D12]" type="button" onClick={act('retry')}><Icon name="refresh" className="h-3.5 w-3.5" />Retry</button>}
              {ACTIVE.includes(job.status) && job.status !== 'CANCEL_REQUESTED' && <button className={secondaryBtn} type="button" onClick={act('cancel')}><Icon name="close" className="h-3.5 w-3.5" />Cancel</button>}
            </div>
          )}
        </div>

        {job.errorSummary && <div className="mt-4"><ErrorText>{job.errorSummary}</ErrorText></div>}
        {job.status === 'SUSPENDED' && <p className="mt-4 rounded-xl border border-[#FBDCCB] bg-[#FFF7F2] px-4 py-3 text-[13px] text-ink">This job is waiting for a person. <Link className="font-semibold text-[#E03A0E] hover:underline" to="/tasks">Open the Action Center</Link> to complete its task; the job resumes automatically.</p>}

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile icon="clock" label="Duration" value={total != null ? ms(total) : ACTIVE.includes(job.status) ? 'Running…' : '—'} sub={wait != null ? `Waited ${ms(wait)} in queue` : 'Not started yet'} />
          <StatTile icon="list" label="Steps" value={finishedSteps.length} sub={failedSteps ? `${failedSteps} failed` : finishedSteps.length ? 'All completed' : 'None yet'} />
          <StatTile icon="refresh" label="Attempt" value={`${job.attempt} / ${job.maxAttempts}`} sub={`${job.attempts.length} recorded`} />
          <StatTile icon="calendar" label="Queued → finished" value={when(job.finishedAt) !== '—' ? when(job.finishedAt) : '—'} sub={`Queued ${when(job.queuedAt)}`} />
        </div>

        <dl className="mt-5 grid gap-x-8 gap-y-2 border-t border-[#F1EEEA] pt-4 text-[12.5px] sm:grid-cols-3">
          <div><dt className="text-slate-500">Queued</dt><dd className="font-medium text-ink">{when(job.queuedAt)}</dd></div>
          <div><dt className="text-slate-500">Started</dt><dd className="font-medium text-ink">{when(job.startedAt)}</dd></div>
          <div><dt className="text-slate-500">Finished</dt><dd className="font-medium text-ink">{when(job.finishedAt)}</dd></div>
          <div className="sm:col-span-3"><dt className="text-slate-500">Correlation ID</dt><dd className="truncate font-mono text-[12px] text-[#4A5568]">{job.correlationId}</dd></div>
        </dl>

        <div className="mt-4 rounded-xl border border-[#EEE9E3] bg-[#FBFAF8] px-4 py-3">
          <Disclosure label="Input" meta={hasInput ? ` · ${typeof job.input === 'object' ? Object.keys(job.input).length : 1} field(s)` : ' · none'}>
            {hasInput ? <CodeBlock value={job.input} /> : <p className="mt-2 text-[12.5px] text-slate-500">This run had no input.</p>}
          </Disclosure>
        </div>
      </section>

      <section>
        <SectionTitle icon="list" title="Execution log" meta={finishedSteps.length ? `${finishedSteps.length} step${finishedSteps.length === 1 ? '' : 's'}` : null} />
        {finishedSteps.length === 0 ? <JobEmpty icon="list" title="No step results" body="Step rows are written while the worker executes the job." /> : (
          <ol className={`${panel} relative px-5 py-4`}>
            {finishedSteps.map((step, index) => {
              const failed = step.status === 'FAILED';
              const width = Math.max(4, Math.round(((Number(step.duration_ms) || 0) / longest) * 100));
              return (
                <li key={step.id} className="relative flex gap-4 pb-5 last:pb-1">
                  {index < finishedSteps.length - 1 && <span className="absolute left-[17px] top-10 bottom-0 w-px bg-[#ECE6DF]" aria-hidden="true" />}
                  <span className={`relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${failed ? 'border-[#F6D5D1] bg-[#FDF1F0] text-[#A8352B]' : 'border-[#ECE6DF] bg-[#F5F2EE] text-[#3B4A5E]'}`}><Icon name={stepIcon(step.step_type)} className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="text-[14px] font-semibold text-ink">{step.step_key}</span>
                      <span className="rounded-md border border-[#ECE6DF] bg-[#F7F5F2] px-1.5 py-px font-mono text-[11px] text-[#5B6474]">{step.step_type}</span>
                      {step.iteration_index != null && <span className="text-[12px] text-slate-500">iteration {step.iteration_index}</span>}
                      <JobPill status={step.status} />
                      <span className="ml-auto text-[12px] tabular-nums text-slate-500">{when(step.started_at)}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#F1EEEA]"><div className={`h-full rounded-full ${failed ? 'bg-[#D2493C]' : 'bg-[#FA4616]/80'}`} style={{ width: `${width}%` }} /></div>
                      <span className="w-16 text-right text-[12px] font-medium tabular-nums text-ink">{ms(step.duration_ms)}</span>
                    </div>
                    {step.error_message && <p className="mt-2 rounded-lg border border-[#F6D5D1] bg-[#FDF1F0] px-3 py-2 text-[12.5px] text-[#A8352B]">{step.error_message}</p>}
                    {step.output_json && <div className="mt-2"><Disclosure label="Output"><CodeBlock value={step.output_json} /></Disclosure></div>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle icon="refresh" title="Attempts" meta={job.attempts.length ? `${job.attempts.length}` : null} />
          {job.attempts.length === 0 ? <JobEmpty icon="refresh" title="No attempts yet" body="An attempt starts when a worker or robot claims the job." /> : (
            <ul className={`${panel} divide-y divide-[#F1EEEA]`}>{job.attempts.map((attempt) => (
              <li key={attempt.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-lg border border-[#ECE6DF] bg-[#F5F2EE] text-[12px] font-semibold text-[#3B4A5E]">{attempt.attempt_number}</span>
                  <JobPill status={attempt.status} />
                  <span className={neutralChip}><Icon name="robot" className="h-3.5 w-3.5 text-slate-400" />{attempt.worker_id || '—'}</span>
                  <span className="ml-auto text-[12px] font-medium tabular-nums text-ink">{attempt.finished_at ? ms(span(attempt.started_at, attempt.finished_at)) : 'In progress'}</span>
                </div>
                <p className="mt-1.5 text-[12px] text-slate-500">{when(attempt.started_at)} → {attempt.finished_at ? when(attempt.finished_at) : '…'}</p>
                {attempt.error_code && <p className="mt-1.5 text-[12.5px] text-[#A8352B]">{attempt.error_code}: {attempt.error_message}</p>}
              </li>
            ))}</ul>
          )}
        </section>
        <section>
          <SectionTitle icon="download" title="Artifacts" meta={job.artifacts.length ? `${job.artifacts.length}` : null} />
          {job.artifacts.length === 0 ? <JobEmpty icon="folder" title="No artifacts" body="Files produced by a run are linked here." /> : (
            <ul className={`${panel} divide-y divide-[#F1EEEA]`}>{job.artifacts.map((artifact) => (
              <li key={artifact.id}>
                <button className="group flex w-full items-center gap-3 px-5 py-3 text-left" type="button" onClick={() => download(`/api/artifacts/${artifact.id}/download`, artifact.file_name).catch((err) => setError(err.message))}>
                  <span className="grid h-8 w-8 place-items-center rounded-lg border border-[#ECE6DF] bg-[#F5F2EE] text-[#3B4A5E]"><Icon name="document" className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium text-ink group-hover:text-[#E03A0E]">{artifact.file_name}</span><span className="text-[12px] text-slate-500">{artifact.size_bytes} bytes</span></span>
                  <Icon name="download" className="h-4 w-4 text-slate-400 group-hover:text-[#E03A0E]" />
                </button>
              </li>
            ))}</ul>
          )}
        </section>
      </div>
    </div>
  );
}

function JobEmpty({ icon, title, body }) {
  return (
    <div className={`${panel} flex flex-col items-center px-6 py-10 text-center`}>
      <span className="relative grid h-16 w-16 place-items-center" aria-hidden="true">
        <span className="absolute inset-0 rounded-full border border-dashed border-[#ECE6DF]" />
        <span className="grid h-10 w-10 place-items-center rounded-xl border border-[#ECE6DF] bg-[#F5F2EE] text-[#3B4A5E]"><Icon name={icon} className="h-5 w-5" /></span>
      </span>
      <p className="mt-3 text-[14px] font-semibold text-ink">{title}</p>
      <p className="mt-1 text-[12.5px] text-slate-500">{body}</p>
    </div>
  );
}

function Schedules() {
  const user = currentUser();
  const [data, setData] = useState(null);
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({ scheduleType: 'recurring', overlapPolicy: 'skip', timezone: 'Asia/Kolkata', input: '{}' });
  const [runs, setRuns] = useState(null);
  const [error, setError, reload] = useLoader(async () => {
    const [projectResult, workflowResult, scheduleResult] = await Promise.all([api('/api/projects?limit=100&status=active'), api('/api/workflows?limit=100&status=published'), api('/api/schedules')]);
    setProjects(projectResult.data);
    setData({ workflows: workflowResult.data, schedules: scheduleResult.data });
  }, []);
  const write = ['administrator', 'project_manager'].includes(user?.role);
  if (!data) return <><ErrorText>{error}</ErrorText>{!error && <SkeletonRows rows={5} cols={4} />}</>;
  const workflowName = (id) => data.workflows.find((item) => item.id === id)?.name || id.slice(0, 8);
  return (
    <>
      <ErrorText>{error}</ErrorText>
      {write && (
        <form className="grid gap-2 md:grid-cols-4" onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api('/api/schedules', { method: 'POST', body: {
              projectId: form.projectId, workflowId: form.workflowId, name: form.name, scheduleType: form.scheduleType,
              cronExpression: form.scheduleType === 'recurring' ? form.cronExpression : undefined,
              runAt: form.scheduleType === 'once' && form.runAt ? new Date(form.runAt).toISOString() : undefined,
              timezone: form.timezone || 'UTC', overlapPolicy: form.overlapPolicy, input: JSON.parse(form.input || '{}'),
            } });
            setError('');
            await reload();
          } catch (err) { setError(err.message); }
        }}>
          <select className={inputClass} value={form.projectId || ''} onChange={(event) => setForm({ ...form, projectId: event.target.value, workflowId: '' })}><option value="">Project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
          <select className={inputClass} value={form.workflowId || ''} onChange={(event) => setForm({ ...form, workflowId: event.target.value })}><option value="">Published workflow</option>{data.workflows.filter((item) => !form.projectId || item.project_id === form.projectId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <input className={inputClass} placeholder="Schedule name" value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <select className={inputClass} value={form.scheduleType} onChange={(event) => setForm({ ...form, scheduleType: event.target.value })}><option value="recurring">Recurring (cron)</option><option value="once">Once</option><option value="manual">Manual record</option></select>
          {form.scheduleType === 'recurring' && <input className={inputClass} placeholder="Cron, e.g. */15 * * * *" value={form.cronExpression || ''} onChange={(event) => setForm({ ...form, cronExpression: event.target.value })} />}
          {form.scheduleType === 'once' && <input className={inputClass} type="datetime-local" value={form.runAt || ''} onChange={(event) => setForm({ ...form, runAt: event.target.value })} />}
          <input className={inputClass} placeholder="Time zone, e.g. Asia/Kolkata" value={form.timezone || ''} onChange={(event) => setForm({ ...form, timezone: event.target.value })} />
          <select className={inputClass} value={form.overlapPolicy} onChange={(event) => setForm({ ...form, overlapPolicy: event.target.value })}><option value="skip">Skip if previous run is active</option><option value="queue">Queue anyway</option></select>
          <textarea className={`${inputClass} font-mono md:col-span-3`} rows="2" placeholder="Input JSON" value={form.input} onChange={(event) => setForm({ ...form, input: event.target.value })} />
          <button className={buttonClass} type="submit">Save schedule</button>
        </form>
      )}
      {data.schedules.length === 0 ? <EmptyState title="No schedules" body="A schedule stores its next run in the database. The worker creates the job when it is due." /> : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-white">{data.schedules.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span><span className="font-medium">{row.name}</span> · {workflowName(row.workflow_id)} · {row.schedule_type}{row.cron_expression ? ` "${row.cron_expression}"` : ''} · {row.timezone} · overlap {row.overlap_policy} · next {row.next_run_at ? `${row.next_run_at} UTC` : 'not scheduled'} · last {row.last_run_at || '—'} · {row.enabled ? 'enabled' : 'disabled'}</span>
            <span className="flex gap-1">
              <button className={quietClass} type="button" onClick={async () => { try { setRuns({ schedule: row, rows: (await api(`/api/schedules/${row.id}/runs`)).data }); } catch (err) { setError(err.message); } }}>History</button>
              {write && <button className={quietClass} type="button" onClick={async () => { try { await api(`/api/schedules/${row.id}/${row.enabled ? 'disable' : 'enable'}`, { method: 'POST' }); await reload(); } catch (err) { setError(err.message); } }}>{row.enabled ? 'Disable' : 'Enable'}</button>}
            </span>
          </li>
        ))}</ul>
      )}
      {runs && (
        <Modal title={`Runs · ${runs.schedule.name}`} onClose={() => setRuns(null)}>
          {runs.rows.length === 0 ? <EmptyState title="No runs" body="The worker records each trigger, skip, or failure here." /> : (
            <ul className="space-y-1 text-sm">{runs.rows.map((run) => <li key={run.id}><StatusBadge status={run.status} /> {run.triggered_at} {run.job_id && <Link className="text-emberdark" to={`/jobs/${run.job_id}`}>job {run.job_id.slice(0, 8)}</Link>} {run.reason}</li>)}</ul>
          )}
        </Modal>
      )}
    </>
  );
}

function Reports() {
  return <ReportsDashboard />;
}

function Audit() {
  return <AuditLog />;
}

function Settings() {
  return <SettingsTabs />;
}

export default function OperationsPage({ section }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const body = {
    connections: <Connections key={refreshKey} />,
    jobs: <Jobs key={refreshKey} />,
    job: <JobDetail key={refreshKey} />,
    schedules: <Schedules key={refreshKey} />,
    reports: <Reports key={refreshKey} />,
    audit: <Audit key={refreshKey} />,
    settings: <Settings key={refreshKey} />,
  }[section];
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{TITLES[section]}</h1>
        <button className={quietClass} type="button" onClick={() => setRefreshKey((key) => key + 1)}>Refresh</button>
      </div>
      {body}
    </section>
  );
}
