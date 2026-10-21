import { Fragment, useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api, currentUser } from '../services/api.js';
import { EmptyState, ErrorText, StatusBadge, buttonClass, inputClass, quietClass } from '../components/ui.jsx';
import { SkeletonRows } from '../components/Loader.jsx';

const PRIORITY_TONE = { critical: 'bg-danger text-white', high: 'bg-warning text-white', medium: 'bg-sand text-ink', low: 'bg-line text-ink' };
const OUTCOME_LABEL = { approve: 'Approve', reject: 'Reject', submit: 'Submit' };

function Priority({ value }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_TONE[value] || 'bg-cream2'}`}>{value}</span>;
}

/** Initial form values from the field defaults and the task data with the same names. */
export function initialValues(task) {
  const values = {};
  for (const field of task.formFields || []) {
    const fromData = task.data?.[field.name];
    if (field.default !== undefined) values[field.name] = field.default;
    else if (fromData !== undefined && typeof fromData !== 'object') values[field.name] = fromData;
    else values[field.name] = field.type === 'checkbox' ? false : '';
  }
  return values;
}

function FormField({ field, value, onChange, disabled }) {
  const id = `task-field-${field.name}`;
  const label = <label htmlFor={id} className="block text-xs font-medium">{field.label}{field.required ? ' *' : ''}</label>;
  if (field.type === 'checkbox') return <label className="flex items-center gap-2 text-sm"><input id={id} type="checkbox" disabled={disabled} checked={value === true} onChange={(event) => onChange(event.target.checked)} />{field.label}{field.required ? ' *' : ''}</label>;
  if (field.type === 'textarea') return <div>{label}<textarea id={id} className={`${inputClass} mt-1`} rows="3" disabled={disabled} value={value ?? ''} onChange={(event) => onChange(event.target.value)} /></div>;
  if (field.type === 'select') return <div>{label}<select id={id} className={`${inputClass} mt-1`} disabled={disabled} value={value ?? ''} onChange={(event) => onChange(event.target.value)}><option value="">Choose…</option>{field.options.map((item) => <option key={item}>{item}</option>)}</select></div>;
  const type = { number: 'number', date: 'date', email: 'email' }[field.type] || 'text';
  return <div>{label}<input id={id} type={type} className={`${inputClass} mt-1`} disabled={disabled} value={value ?? ''} onChange={(event) => onChange(event.target.value)} /></div>;
}

const humanize = (key) => String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()).replace(/\b(Po|Gstin|Id)\b/g, (w) => w.toUpperCase());
const asText = (value) => (value === null || value === undefined ? '' : String(value));

/** Validation tasks: the scalar data fields the reviewer can correct before approving. */
export function reviewableKeys(task) {
  if (task.type !== 'validation' || !task.data || typeof task.data !== 'object') return [];
  return Object.keys(task.data).filter((key) => task.data[key] === null || typeof task.data[key] !== 'object');
}

/** Only the fields the reviewer changed, as { key: text }. */
export function changedValues(task, edits) {
  const out = {};
  for (const key of reviewableKeys(task)) if (key in edits && edits[key] !== asText(task.data[key])) out[key] = edits[key];
  return out;
}

function ReviewFields({ task, edits, setEdits, editable }) {
  const keys = reviewableKeys(task);
  const shown = editable ? null : (task.result?.values || task.data);
  return (
    <div className="rounded-xl border border-[#E6E1DA] bg-white">
      <div className="flex items-center justify-between border-b border-[#EFE9E2] px-4 py-2.5">
        <p className="text-[13px] font-semibold text-[#1F2933]">Extracted fields</p>
        <p className="text-xs text-[#6B7280]">{editable ? 'Correct or fill in values before approving.' : task.result?.values ? 'Values as approved by the reviewer.' : 'Values sent for review.'}</p>
      </div>
      <div className="grid gap-x-4 gap-y-3 p-4 sm:grid-cols-2">
        {keys.map((key) => {
          const original = asText(task.data[key]);
          const value = editable ? (edits[key] ?? original) : asText(shown?.[key]);
          const edited = editable && value !== original;
          const missing = !value;
          const id = `review-${key}`;
          return (
            <div key={key}>
              <label htmlFor={id} className="mb-1 flex items-center gap-2 text-xs font-medium text-[#4A5568]">
                {humanize(key)}
                {edited && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#E03A0E]"><span className="h-1.5 w-1.5 rounded-full bg-[#FA4616]" />Edited</span>}
                {!edited && missing && <span className="rounded-full border border-[#EFD9B8] bg-[#FDF6EC] px-1.5 text-[10.5px] font-medium text-[#A35F0B]">Not found</span>}
              </label>
              <input id={id} className={`${inputClass} ${edited ? 'border-[#F6B59B] bg-[#FFFAF7]' : ''} ${missing && !edited ? 'border-dashed' : ''} disabled:bg-[#FBFAF8] disabled:text-[#4A5568]`}
                disabled={!editable} value={value} placeholder={editable ? 'Not found, enter a value' : '—'}
                onChange={(event) => setEdits({ ...edits, [key]: event.target.value })} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskDetail({ task, onDone }) {
  const user = currentUser();
  const [values, setValues] = useState(() => initialValues(task));
  const [edits, setEdits] = useState({});
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setValues(initialValues(task)); setEdits({}); setComment(''); setError(''); }, [task.id]);
  const reviewable = reviewableKeys(task).length > 0;
  const outcomes = task.outcomes?.length ? task.outcomes : ['submit'];
  const open = task.status === 'pending';

  async function act(path, body) {
    setBusy(true);
    setError('');
    try {
      const result = await api(path, { method: 'POST', body });
      onDone(result.data);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{task.title}</h2>
        <StatusBadge status={task.status} /> <Priority value={task.priority} />
      </div>
      <p className="text-xs text-muted">{task.type} task · {task.projectName || task.projectId} · {task.workflowName || 'workflow'} · step <span className="font-mono">{task.stepKey}</span>{task.jobId && <> · job <Link className="text-emberdark" to={`/jobs/${task.jobId}`}>{task.jobId.slice(0, 8)}</Link></>}</p>
      <p className="text-xs text-muted">Created {task.createdAt}{task.dueAt ? ` · due ${task.dueAt}` : ''} (UTC) · {task.assignedUserEmail ? `assigned to ${task.assignedUserEmail}` : task.assignedRole ? `for role ${task.assignedRole.replaceAll('_', ' ')}` : 'unassigned'}</p>
      {task.description && <p className="whitespace-pre-wrap text-sm">{task.description}</p>}
      {reviewable && <ReviewFields task={task} edits={edits} setEdits={setEdits} editable={open && task.canComplete} />}
      {!reviewable && task.data && Object.keys(task.data).length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded bg-mist p-3 text-sm">
          {Object.entries(task.data).map(([key, value]) => <Fragment key={key}><dt className="font-medium">{key}</dt><dd className="break-all">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></Fragment>)}
        </dl>
      )}
      <ErrorText>{error}</ErrorText>
      {(task.formFields || []).length > 0 && (
        <div className="space-y-2">{task.formFields.map((field) => <FormField key={field.name} field={field} disabled={!open || !task.canComplete} value={open ? values[field.name] : task.result?.data?.[field.name]} onChange={(value) => setValues({ ...values, [field.name]: value })} />)}</div>
      )}
      {open ? (
        <>
          <label className="block text-xs font-medium">Comment{task.requireCommentOnReject ? ' (required to reject)' : ''}<textarea className={`${inputClass} mt-1`} rows="2" value={comment} onChange={(event) => setComment(event.target.value)} /></label>
          <div className="flex flex-wrap gap-2">
            {task.canComplete && outcomes.map((outcome) => (
              <button key={outcome} type="button" disabled={busy} className={outcome === 'reject' ? quietClass : buttonClass} onClick={() => act(`/api/tasks/${task.id}/complete`, { outcome, data: values, ...(reviewable ? { values: changedValues(task, edits) } : {}), comment: comment || undefined })}>{OUTCOME_LABEL[outcome] || outcome}</button>
            ))}
            {task.assignedUserId !== user?.id && user?.role !== 'viewer' && <button type="button" disabled={busy} className={quietClass} onClick={() => act(`/api/tasks/${task.id}/assign`, {})}>Assign to me</button>}
            {task.assignedUserId === user?.id && <button type="button" disabled={busy} className={quietClass} onClick={() => act(`/api/tasks/${task.id}/assign`, { userId: null })}>Release</button>}
          </div>
          {!task.canComplete && <p className="text-xs text-muted">You can view this task but not complete it.</p>}
        </>
      ) : (
        <p className="text-sm">Outcome <span className="font-medium">{task.outcome || '—'}</span> by {task.completedByEmail || task.completedBy || '—'} at {task.completedAt || '—'}{task.comment ? ` · “${task.comment}”` : ''}</p>
      )}
    </div>
  );
}

export default function ActionCenterPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [projects, setProjects] = useState([]);
  const [filters, setFilters] = useState({ status: 'pending', mine: false, projectId: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState(null);

  async function load(next = filters) {
    const query = new URLSearchParams({ status: next.status, limit: '100' });
    if (next.mine) query.set('mine', 'true');
    if (next.projectId) query.set('projectId', next.projectId);
    const result = await api(`/api/tasks?${query.toString()}`);
    setTasks(result.data);
    setLoaded(true);
    return result.data;
  }

  useEffect(() => {
    api('/api/projects?limit=100').then((result) => setProjects(result.data)).catch(() => {});
    load().catch((err) => setError(err.message));
    const timer = setInterval(() => { load().catch(() => {}); }, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!params.id) { setSelected(null); return; }
    api(`/api/tasks/${params.id}`).then((result) => setSelected(result.data)).catch((err) => setError(err.message));
  }, [params.id]);

  return (
    <section className="space-y-4">
      <div><h1 className="text-2xl font-semibold">Action Center</h1><p className="text-sm text-muted">Approvals, forms, and validations that paused a workflow. Completing a task resumes its job.</p></div>
      <form className="grid gap-2 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); load().catch((err) => setError(err.message)); }}>
        <select className={inputClass} aria-label="Task status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="pending">Pending</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="all">All</option></select>
        <select className={inputClass} aria-label="Project" value={filters.projectId} onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}><option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={filters.mine} onChange={(event) => setFilters({ ...filters, mine: event.target.checked })} /> Only tasks for me</label>
        <button className={buttonClass} type="submit">Apply</button>
      </form>
      <ErrorText>{error}</ErrorText>
      {message && <p className="text-sm text-success" role="status">{message}</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {!loaded && !error ? <SkeletonRows rows={5} cols={3} label="Loading tasks" /> : tasks.length === 0 ? <EmptyState title="No tasks" body="Tasks appear here when a workflow reaches a Create Form Task activity." /> : (
          <ul className="space-y-2">
            {tasks.map((task) => (
              <li key={task.id}>
                <button type="button" className={`w-full rounded-lg border bg-white px-3 py-2 text-left text-sm ${selected?.id === task.id ? 'border-ember' : 'border-line'}`} onClick={() => navigate(`/tasks/${task.id}`)}>
                  <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{task.title}</span><StatusBadge status={task.status} /><Priority value={task.priority} /></span>
                  <span className="mt-1 block text-xs text-muted">{task.type} · {task.projectName} · {task.workflowName || '—'} · {task.createdAt}{task.assignedUserEmail ? ` · ${task.assignedUserEmail}` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div>
          {selected ? <TaskDetail task={selected} onDone={async (data) => {
            setMessage(data.resumedJobId ? 'Task completed. The job was queued to resume.' : data.status === 'completed' ? 'Task completed.' : 'Task updated.');
            const fresh = await api(`/api/tasks/${selected.id}`).catch(() => null);
            if (fresh) setSelected(fresh.data);
            load().catch(() => {});
          }} /> : <EmptyState title="Select a task" body="Open a task to see its data and form." />}
        </div>
      </div>
    </section>
  );
}
