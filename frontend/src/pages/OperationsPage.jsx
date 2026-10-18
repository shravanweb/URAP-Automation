import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, currentUser, download } from '../services/api.js';
import { EmptyState, ErrorText, Modal, StatusBadge, buttonClass, inputClass, quietClass } from '../components/ui.jsx';

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
  credential: '{ "username": "ana", "password": "…" }',
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
  if (!data) return <><ErrorText>{error}</ErrorText><p className="text-sm text-muted">Loading…</p></>;
  return (
    <>
      <ErrorText>{error}</ErrorText>
      {write && (
        <form className="grid gap-2 md:grid-cols-4" onSubmit={async (event) => {
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
      <details className="rounded-lg border border-line bg-white p-3 text-sm"><summary className="cursor-pointer font-medium">Connector catalog ({data.connectors.length})</summary>
        <ul className="mt-2 space-y-1">{data.connectors.map((item) => <li key={item.id}><span className="font-mono">{item.id}</span> · {item.displayName} · {item.description} · <StatusBadge status={item.availability} /></li>)}</ul>
      </details>
      {data.connections.length === 0 ? <EmptyState title="No connections" body="Add a connector configuration for a project. Secrets are not shown again after saving." /> : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-white">{data.connections.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span>{row.projectName} · <span className="font-medium">{row.name}</span> · {row.connectorType} · secret {row.hasSecret ? 'stored' : 'none'} <StatusBadge status={row.status} />{row.lastError && <span className="block text-danger">{row.lastError}</span>}<span className="block font-mono text-xs text-muted">id {row.id}</span></span>
            {write && <button className={quietClass} type="button" onClick={async () => { try { const result = await api(`/api/connections/${row.id}/test`, { method: 'POST' }); setError(result.data.error || ''); await reload(); } catch (err) { setError(err.message); } }}>Test</button>}
          </li>
        ))}</ul>
      )}
    </>
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
      {!data ? <p className="text-sm text-muted">Loading…</p> : data.data.length === 0 ? <EmptyState title="No jobs" body="Queue a published workflow. A queued job is not a completed run." /> : (
        <div className="overflow-auto rounded-lg border border-line bg-white"><table className="min-w-full text-sm"><thead className="bg-cream2 text-muted"><tr><th className="px-3 py-2 text-left">Job</th><th className="px-3 py-2 text-left">Project</th><th className="px-3 py-2 text-left">Target</th><th className="px-3 py-2 text-left">Trigger</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Attempt</th><th className="px-3 py-2 text-left">Queued</th><th className="px-3 py-2 text-left">Error</th></tr></thead>
          <tbody>{data.data.map((job) => <tr key={job.id} className="border-t border-line"><td className="px-3 py-2"><Link className="font-mono text-emberdark" to={`/jobs/${job.id}`}>{job.id.slice(0, 8)}</Link></td><td className="px-3 py-2">{projectName(job.projectId)}</td><td className="px-3 py-2">{job.executionTarget}</td><td className="px-3 py-2">{job.triggerSource}</td><td className="px-3 py-2"><StatusBadge status={job.status} /></td><td className="px-3 py-2">{job.attempt}/{job.maxAttempts}</td><td className="px-3 py-2">{job.queuedAt}</td><td className="max-w-xs truncate px-3 py-2 text-danger">{job.errorSummary}</td></tr>)}</tbody></table>
          <p className="px-3 py-2 text-xs text-muted">{data.meta.total} job(s)</p></div>
      )}
    </>
  );
}

function JobDetail() {
  const params = useParams();
  const user = currentUser();
  const [data, setData] = useState(null);
  const timer = useRef(null);
  const load = async () => { setData(await api(`/api/jobs/${params.id}`)); };
  const [error, setError, reload] = useLoader(load, [params.id]);
  useEffect(() => {
    clearInterval(timer.current);
    if (data && ACTIVE.includes(data.data.status)) timer.current = setInterval(() => { load().catch(() => {}); }, 2000);
    return () => clearInterval(timer.current);
  }, [data?.data?.status]);
  if (!data) return <><ErrorText>{error}</ErrorText><p className="text-sm text-muted">Loading…</p></>;
  const job = data.data;
  const control = ['administrator', 'project_manager', 'operator'].includes(user?.role);
  const finishedSteps = job.steps.filter((step) => step.status !== 'RUNNING');
  return (
    <div className="space-y-3">
      <ErrorText>{error}</ErrorText>
      <div className="rounded-lg border border-line bg-white p-3 text-sm">
        <p>Status <StatusBadge status={job.status} /> · attempt {job.attempt} of {job.maxAttempts} · trigger {job.triggerSource} · target {job.executionTarget}{ACTIVE.includes(job.status) && <span className="text-muted"> · refreshing</span>}</p>
        <p className="mt-1 text-muted">Queued {job.queuedAt} · started {job.startedAt || '—'} · finished {job.finishedAt || '—'} (UTC)</p>
        <p className="mt-1 text-muted">Workflow <Link className="text-emberdark" to={`/workflows/${job.workflowId}`}>{job.workflowId.slice(0, 8)}</Link> · correlation <span className="font-mono">{job.correlationId}</span></p>
        {job.errorSummary && <div className="mt-2"><ErrorText>{job.errorSummary}</ErrorText></div>}
        {job.status === 'SUSPENDED' && <p className="mt-2 rounded bg-cream2 px-3 py-2">This job is waiting for a person. <Link className="font-medium text-emberdark" to="/tasks">Open the Action Center</Link> to complete its task; the job resumes automatically.</p>}
        {control && (
          <div className="mt-2 flex gap-2">
            {['FAILED', 'CANCELLED'].includes(job.status) && <button className={quietClass} type="button" onClick={async () => { try { await api(`/api/jobs/${params.id}/retry`, { method: 'POST' }); await reload(); } catch (err) { setError(err.message); } }}>Retry</button>}
            {ACTIVE.includes(job.status) && job.status !== 'CANCEL_REQUESTED' && <button className={quietClass} type="button" onClick={async () => { try { await api(`/api/jobs/${params.id}/cancel`, { method: 'POST' }); await reload(); } catch (err) { setError(err.message); } }}>Cancel</button>}
          </div>
        )}
        <details className="mt-2"><summary className="cursor-pointer text-xs text-muted">Input</summary><Json value={job.input} /></details>
      </div>
      <h2 className="font-semibold">Attempts</h2>
      {job.attempts.length === 0 ? <EmptyState title="No attempts yet" body="An attempt starts when a worker or robot claims the job." /> : (
        <ul className="space-y-2">{job.attempts.map((attempt) => <li key={attempt.id} className="rounded-md border border-line bg-white px-3 py-2 text-sm">Attempt {attempt.attempt_number} <StatusBadge status={attempt.status} /> · {attempt.worker_id || '—'} · {attempt.started_at} → {attempt.finished_at || '…'} {attempt.error_code && <span className="text-danger">· {attempt.error_code}: {attempt.error_message}</span>}</li>)}</ul>
      )}
      <h2 className="font-semibold">Execution log (step timeline)</h2>
      {finishedSteps.length === 0 ? <EmptyState title="No step results" body="Step rows are written while the worker executes the job." /> : (
        <ol className="space-y-2">{finishedSteps.map((step) => (
          <li key={step.id} className="rounded-md border border-line bg-white px-3 py-2 text-sm">
            <StatusBadge status={step.status} /> <span className="font-medium">{step.step_key}</span> · {step.step_type}{step.iteration_index != null ? ` · iteration ${step.iteration_index}` : ''} · {step.duration_ms ?? '—'} ms · {step.started_at}
            {step.error_message && <p className="text-danger">{step.error_message}</p>}
            {step.output_json && <details><summary className="cursor-pointer text-xs text-muted">Output</summary><Json value={step.output_json} /></details>}
          </li>
        ))}</ol>
      )}
      <h2 className="font-semibold">Artifacts</h2>
      {job.artifacts.length === 0 ? <EmptyState title="No artifacts" body="Files produced by a run are linked here." /> : job.artifacts.map((artifact) => <button key={artifact.id} className="block text-sm text-emberdark" type="button" onClick={() => download(`/api/artifacts/${artifact.id}/download`, artifact.file_name).catch((err) => setError(err.message))}>{artifact.file_name} ({artifact.size_bytes} bytes)</button>)}
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
  if (!data) return <><ErrorText>{error}</ErrorText><p className="text-sm text-muted">Loading…</p></>;
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
  const [rows, setRows] = useState(null);
  const [projects, setProjects] = useState([]);
  const [filters, setFilters] = useState({ projectId: '', status: '' });
  const query = () => { const params = new URLSearchParams(); for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value); return params.toString(); };
  const [error, setError, reload] = useLoader(async () => {
    setProjects((await api('/api/projects?limit=100')).data);
    setRows((await api(`/api/reports/executions?${query()}`)).data);
  }, []);
  const counts = (rows || []).reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), {});
  return (
    <>
      <ErrorText>{error}</ErrorText>
      <form className="grid gap-2 md:grid-cols-5" onSubmit={(event) => { event.preventDefault(); reload(); }}>
        <select className={inputClass} value={filters.projectId} onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}><option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
        <select className={inputClass} value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Any status</option>{JOB_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select>
        <button className={buttonClass} type="submit">Apply</button>
        <button className={quietClass} type="button" onClick={() => download(`/api/reports/export.csv?${query()}`, 'executions.csv').catch((err) => setError(err.message))}>Download CSV</button>
        <button className={quietClass} type="button" onClick={() => download(`/api/reports/export.xlsx?${query()}`, 'executions.xlsx').catch((err) => setError(err.message))}>Download Excel</button>
      </form>
      {rows && <p className="text-sm text-muted">{Object.entries(counts).map(([status, count]) => `${status}: ${count}`).join(' · ') || 'No rows'}</p>}
      {!rows ? <p className="text-sm text-muted">Loading…</p> : rows.length === 0 ? <EmptyState title="No executions" body="Reports list jobs that have actually been queued or completed." /> : (
        <div className="overflow-auto rounded-lg border border-line bg-white"><table className="min-w-full text-sm"><thead className="bg-cream2 text-muted"><tr><th className="px-3 py-2 text-left">Job</th><th className="px-3 py-2 text-left">Project</th><th className="px-3 py-2 text-left">Workflow</th><th className="px-3 py-2 text-left">Version</th><th className="px-3 py-2 text-left">Trigger</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Finished</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id} className="border-t border-line"><td className="px-3 py-2"><Link className="font-mono text-emberdark" to={`/jobs/${row.id}`}>{row.id.slice(0, 8)}</Link></td><td className="px-3 py-2">{row.project_name}</td><td className="px-3 py-2">{row.workflow_name}</td><td className="px-3 py-2">{row.version_number}</td><td className="px-3 py-2">{row.trigger_source}</td><td className="px-3 py-2"><StatusBadge status={row.status} /></td><td className="px-3 py-2">{row.finished_at || '—'}</td></tr>)}</tbody></table></div>
      )}
    </>
  );
}

function Audit() {
  const [data, setData] = useState(null);
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, , reload] = useLoader(async () => {
    const params = new URLSearchParams({ limit: '50', offset: String(offset) });
    if (action) params.set('action', action);
    setData(await api(`/api/audit?${params.toString()}`));
  }, [offset]);
  return (
    <>
      <ErrorText>{error}</ErrorText>
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (offset) setOffset(0); else reload(); }}>
        <input className={inputClass} placeholder="Filter action, e.g. job. or workflow.publish" value={action} onChange={(event) => setAction(event.target.value)} />
        <button className={buttonClass} type="submit">Apply</button>
      </form>
      {!data ? <p className="text-sm text-muted">Loading…</p> : data.data.length === 0 ? <EmptyState title="No audit events" body="Sign-in, project changes, publishes, and job actions are recorded." /> : (
        <>
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">{data.data.map((row) => <li key={row.id} className="px-3 py-2 text-sm">{row.created_at} · <span className="font-medium">{row.action}</span> · {row.entity_type} {row.entity_id ? row.entity_id.slice(0, 8) : ''} · {row.actor_email || (row.actor_robot_name ? `robot ${row.actor_robot_name}` : 'system')}</li>)}</ul>
          <div className="flex items-center gap-2 text-sm"><button className={quietClass} type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><span>{offset + 1}–{Math.min(offset + 50, data.meta.total)} of {data.meta.total}</span><button className={quietClass} type="button" disabled={offset + 50 >= data.meta.total} onClick={() => setOffset(offset + 50)}>Next</button></div>
        </>
      )}
    </>
  );
}

// Random temporary password for an administrator reset: 16 characters from an unambiguous
// alphabet plus a digit, so it always meets the 12-character letters-and-numbers rule.
function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12)}7`;
}

function Settings() {
  const user = currentUser();
  const isAdmin = user?.role === 'administrator';
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [robots, setRobots] = useState([]);
  const [newUser, setNewUser] = useState({ role: 'operator' });
  const [robotForm, setRobotForm] = useState({ adapter: 'local_file_handoff', projectIds: [] });
  const [token, setToken] = useState(null);
  const [resetInfo, setResetInfo] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError, reload] = useLoader(async () => {
    setData(await api('/api/settings'));
    if (isAdmin) {
      const [userResult, projectResult, robotResult] = await Promise.all([api('/api/users'), api('/api/projects?limit=100&status=active'), api('/api/robots')]);
      setUsers(userResult.data);
      setProjects(projectResult.data);
      setRobots(robotResult.data);
    }
  }, []);
  async function act(work, done) {
    try { await work(); setError(''); setMessage(done); await reload(); } catch (err) { setError(err.message); }
  }
  if (!data) return <><ErrorText>{error}</ErrorText><p className="text-sm text-muted">Loading…</p></>;
  return (
    <div className="space-y-4">
      <ErrorText>{error}</ErrorText>
      {message && <p className="text-sm text-success">{message}</p>}
      <div className="space-y-2 rounded-lg border border-line bg-white p-4 text-sm">
        <h2 className="font-semibold">Tenant and orchestration</h2>
        <p>Tenant: {data.data.tenant.name}. Isolation is {data.data.tenant.isolation_enabled ? 'enabled' : 'disabled'}.</p>
        <p>UiPath Orchestrator is {data.data.orchestratorConfigured ? 'configured in the environment' : 'not configured. Robot work uses the local file handoff and the robot API until a real Orchestrator token and release key are set.'}</p>
      </div>
      <div className="space-y-2 rounded-lg border border-line bg-white p-4 text-sm">
        <h2 className="font-semibold">Robots</h2>
        {data.data.robots.length === 0 ? <EmptyState title="No robots registered" body="A robot is available only after it authenticates and sends a heartbeat. Registration does not mean it is connected." /> : (
          <ul className="divide-y divide-line">{(isAdmin ? robots : data.data.robots).map((robot) => (
            <li key={robot.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><span className="font-medium">{robot.name}</span> · {robot.adapter} · <StatusBadge status={robot.reportedAvailable ? 'available' : 'unknown'} /> {robot.reportedAvailable ? 'heartbeat in the last minute' : `no recent heartbeat${robot.lastHeartbeatAt ? ` (last ${robot.lastHeartbeatAt} UTC)` : ''}`}{robot.projectIds && <span className="block text-xs text-muted">projects: {robot.projectIds.map((id) => projects.find((project) => project.id === id)?.name || id.slice(0, 8)).join(', ')}</span>}</span>
              {isAdmin && <button className={quietClass} type="button" onClick={() => act(async () => { const result = await api(`/api/robots/${robot.id}/rotate-token`, { method: 'POST' }); setToken({ name: robot.name, token: result.data.token }); }, 'Token rotated')}>Rotate token</button>}
            </li>
          ))}</ul>
        )}
        {isAdmin && (
          <form className="grid gap-2 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); act(async () => { const result = await api('/api/robots', { method: 'POST', body: robotForm }); setToken({ name: robotForm.name, token: result.data.token }); }, 'Robot registered'); }}>
            <input className={inputClass} placeholder="Robot name" value={robotForm.name || ''} onChange={(event) => setRobotForm({ ...robotForm, name: event.target.value })} />
            <select className={inputClass} value={robotForm.adapter} onChange={(event) => setRobotForm({ ...robotForm, adapter: event.target.value })}><option value="local_file_handoff">UiPath file handoff</option><option value="orchestrator">UiPath Orchestrator</option><option value="contract_simulator">Contract robot (npm run robot-simulator)</option></select>
            <select multiple className={`${inputClass} h-20`} value={robotForm.projectIds} onChange={(event) => setRobotForm({ ...robotForm, projectIds: [...event.target.selectedOptions].map((option) => option.value) })}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
            <button className={buttonClass} type="submit">Register robot</button>
          </form>
        )}
      </div>
      {isAdmin && (
        <div className="space-y-2 rounded-lg border border-line bg-white p-4 text-sm">
          <h2 className="font-semibold">Users</h2>
          <ul className="divide-y divide-line">{users.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><span className="font-medium">{item.displayName}</span> · {item.email} · <StatusBadge status={item.status === 'active' ? 'active' : 'disabled'} /></span>
              <span className="flex gap-1">
                <select className={inputClass} value={item.role} disabled={item.id === user.id} onChange={(event) => act(() => api(`/api/users/${item.id}`, { method: 'PATCH', body: { role: event.target.value } }), 'Role updated')}>{['administrator', 'project_manager', 'automation_developer', 'operator', 'viewer'].map((role) => <option key={role} value={role}>{role.replaceAll('_', ' ')}</option>)}</select>
                {item.id !== user.id && <button className={quietClass} type="button" onClick={() => act(() => api(`/api/users/${item.id}`, { method: 'PATCH', body: { status: item.status === 'active' ? 'disabled' : 'active' } }), 'User updated')}>{item.status === 'active' ? 'Disable' : 'Enable'}</button>}
                {item.id !== user.id && <button className={`${quietClass} whitespace-nowrap`} type="button" onClick={() => { const password = temporaryPassword(); act(async () => { await api(`/api/users/${item.id}`, { method: 'PATCH', body: { password } }); setResetInfo({ email: item.email, password }); }, 'Password reset'); }}>Reset password</button>}
              </span>
            </li>
          ))}</ul>
          <form className="grid gap-2 md:grid-cols-5" onSubmit={(event) => { event.preventDefault(); act(async () => { await api('/api/users', { method: 'POST', body: newUser }); setNewUser({ role: 'operator' }); }, 'User created'); }}>
            <input className={inputClass} placeholder="Email" value={newUser.email || ''} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} />
            <input className={inputClass} placeholder="Display name" value={newUser.displayName || ''} onChange={(event) => setNewUser({ ...newUser, displayName: event.target.value })} />
            <input className={inputClass} placeholder="Temporary password, 12+ characters" type="password" value={newUser.password || ''} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} />
            <select className={inputClass} value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}><option value="project_manager">Project manager</option><option value="automation_developer">Automation developer</option><option value="operator">Operator</option><option value="viewer">Viewer</option><option value="administrator">Administrator</option></select>
            <button className={buttonClass} type="submit">Create user</button>
          </form>
        </div>
      )}
      {resetInfo && (
        <Modal title={`Temporary password · ${resetInfo.email}`} onClose={() => setResetInfo(null)}>
          <p className="text-sm">Share this password with the user over a trusted channel. It is not shown again. Their existing sessions were signed out.</p>
          <pre className="mt-2 select-all break-all rounded bg-mist p-2 font-mono text-sm">{resetInfo.password}</pre>
        </Modal>
      )}
      {token && (
        <Modal title={`Robot token · ${token.name}`} onClose={() => setToken(null)}>
          <p className="text-sm">Copy this token now. It is stored only as a hash and will not be shown again.</p>
          <pre className="mt-2 select-all break-all rounded bg-mist p-2 font-mono text-xs">{token.token}</pre>
          <p className="mt-2 text-xs text-muted">Contract robot: set ROBOT_TOKEN to this value and run npm run robot-simulator in backend.</p>
        </Modal>
      )}
    </div>
  );
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
