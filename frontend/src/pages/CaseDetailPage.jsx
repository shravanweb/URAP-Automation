import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, download } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import { timeAgo } from '../layouts/CloudLayout.jsx';
import {
  Avatar, CaseFieldInput, CaseStatusChip, KindTile, PriorityChip, SlaChip, StageStepper, TASK_KIND, TaskStatusChip, fieldText, formatWhen, parseUtc,
} from '../components/CaseBits.jsx';
import { PRIORITIES, describeCondition, validateCaseFields } from '../lib/caseDefinition.js';

// Case detail: header with status / priority / SLA countdowns and the actions the user may take,
// the stage stepper, current-stage tasks (start, retry, skip, links to the job / task / run),
// the fields form, comments, attachments, and the activity timeline.

const secondaryBtn = 'u-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const primaryBtn = 'u-btn-primary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-60';
const smallBtn = 'inline-flex h-7 items-center gap-1 rounded-md border border-[#E2DCD5] bg-white px-2 text-[12px] font-semibold text-slate-600 hover:border-[#D7D2CB] hover:text-ink disabled:opacity-50';
const control = 'w-full rounded-lg border border-[#E2DCD5] bg-white px-2.5 py-1.5 text-[13px] text-ink focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:bg-[#FAF9F7]';

const EVENT_ICON = {
  case: ['briefcase', 'bg-[#FFF1EC] text-ember'], stage: ['flow', 'bg-[#EAF1FB] text-[#2F5FA8]'], task: ['check', 'bg-[#ECF7EF] text-[#1F6B3A]'],
  sla: ['clock', 'bg-[#FDF5E6] text-[#8A5A0B]'], escalation: ['alert', 'bg-[#FDEEEC] text-[#A8261B]'], comment: ['mail', 'bg-[#F1EEFB] text-[#5B47B8]'],
  attachment: ['upload', 'bg-[#F6F4F1] text-slate-600'], fields: ['form', 'bg-[#F6F4F1] text-slate-600'],
};

function Card({ title, action, children, className = '' }) {
  return (
    <section className={`u-card rounded-2xl ${className}`}>
      {title && <header className="flex items-center justify-between gap-2 border-b border-[#F1EEEA] px-5 py-3"><h2 className="text-[14px] font-semibold text-ink">{title}</h2>{action}</header>}
      {children}
    </section>
  );
}

function taskLink(task, definitionTask) {
  if (task.jobId) return { to: `/jobs/${task.jobId}`, label: 'Job' };
  if (task.actionTaskId) return { to: `/tasks/${task.actionTaskId}`, label: 'Open in Action Center' };
  if (task.flowRunId && definitionTask?.config?.flowId) return { to: `/studio/flows/${definitionTask.config.flowId}/runs/${task.flowRunId}`, label: 'Flow run' };
  if (task.agentRunId && definitionTask?.config?.agentId) return { to: `/studio/agents/${definitionTask.config.agentId}/runs/${task.agentRunId}`, label: 'Agent run' };
  return null;
}

function outputText(output) {
  if (output === null || output === undefined) return '';
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function TaskRow({ task, definitionTask, canWork, canManage, caseOpen, busy, onAction }) {
  const link = taskLink(task, definitionTask);
  const done = ['completed', 'skipped', 'cancelled'].includes(task.status);
  return (
    <li className="flex items-start gap-3 px-5 py-3.5">
      <KindTile kind={task.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[13.5px] font-semibold ${done ? 'text-slate-600' : 'text-ink'}`}>{task.name}</span>
          <TaskStatusChip status={task.status} />
          <span className={`rounded px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide ${task.required ? 'bg-[#FFF1EC] text-ember' : 'bg-[#F6F4F1] text-slate-500'}`}>{task.required ? 'Required' : 'Optional'}</span>
          {task.attempt > 1 && <span className="text-[11.5px] text-slate-400">attempt {task.attempt}</span>}
        </div>
        <p className="mt-0.5 text-[12px] text-slate-500">
          {TASK_KIND[task.kind]?.label}
          {task.outcome ? <> · decision <span className="font-semibold text-ink">{task.outcome}</span></> : null}
          {task.completedAt ? ` · ${task.status === 'skipped' ? 'skipped' : 'finished'} ${timeAgo(task.completedAt)}` : task.startedAt ? ` · started ${timeAgo(task.startedAt)}` : ''}
        </p>
        {task.error && <p className="mt-1 rounded-md bg-[#FEF3F2] px-2 py-1 text-[12px] text-danger">{task.error}</p>}
        {task.status === 'completed' && outputText(task.output) && <p className="mt-1 truncate rounded-md bg-[#FAF9F7] px-2 py-1 font-mono text-[11.5px] text-slate-500" title={JSON.stringify(task.output)}>{outputText(task.output)}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {link && <Link to={link.to} className={`${smallBtn} ${task.actionTaskId && task.status === 'in_progress' ? '!border-ember !text-ember' : ''}`}><Icon name="external" className="h-3 w-3" />{link.label}</Link>}
        {caseOpen && canWork && task.status === 'not_started' && <button type="button" className={smallBtn} disabled={busy} onClick={() => onAction(task, 'start')}><Icon name="play" className="h-3 w-3" />Start</button>}
        {caseOpen && canWork && task.status === 'failed' && <button type="button" className={smallBtn} disabled={busy} onClick={() => onAction(task, 'retry')}><Icon name="refresh" className="h-3 w-3" />Retry</button>}
        {caseOpen && canWork && ['not_started', 'failed', 'in_progress'].includes(task.status) && (!task.required || canManage) && <button type="button" className={smallBtn} disabled={busy} onClick={() => onAction(task, 'skip')}>Skip</button>}
      </div>
    </li>
  );
}

function MoveDialog({ item, onClose, onMove }) {
  const stages = item.definition.stages.filter((stage) => stage.id !== item.currentStageId);
  const [stageId, setStageId] = useState(stages[0]?.id || '');
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#1F1B17]/30 px-4 py-[12vh]" role="dialog" aria-modal="true" aria-labelledby="move-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="w-full max-w-[440px] rounded-2xl border border-[#ECE8E3] bg-white p-5 shadow-[0_24px_64px_rgba(16,24,40,0.18)]" onSubmit={(event) => { event.preventDefault(); onMove(stageId, reason); }}>
        <h2 id="move-title" className="text-[16px] font-semibold text-ink">Move case</h2>
        <p className="mt-1 text-[13px] text-slate-500">Open tasks in the current stage are cancelled. Moving forward past unfinished work needs a skippable stage or a manager.</p>
        <label className="mt-4 block"><span className="mb-1 block text-[12px] font-medium text-slate-600">Move to</span>
          <select className={control} value={stageId} onChange={(event) => setStageId(event.target.value)}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select>
        </label>
        <label className="mt-3 block"><span className="mb-1 block text-[12px] font-medium text-slate-600">Reason</span><input className={control} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Optional" /></label>
        <div className="mt-5 flex justify-end gap-2"><button type="button" className={secondaryBtn} onClick={onClose}>Cancel</button><button type="submit" className={primaryBtn} disabled={!stageId}>Move</button></div>
      </form>
    </div>
  );
}

export default function CaseDetailPage() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [fieldsDirty, setFieldsDirty] = useState(false);
  const [comment, setComment] = useState('');
  const [moving, setMoving] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [showHistory, setShowHistory] = useState(false);
  const fileRef = useRef(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = fieldsDirty;

  const apply = useCallback((data) => {
    setItem(data);
    if (!dirtyRef.current) setValues(data.fields || {});
  }, []);
  const load = useCallback(() => api(`/api/cases/${id}`).then((result) => apply(result.data)).catch((err) => setError(err.message)), [id, apply]);
  useEffect(() => { setItem(null); load(); }, [load]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  const running = item?.tasks?.some((task) => task.status === 'in_progress' && task.kind !== 'human') && item.status === 'open';
  const waiting = item?.status === 'open';
  useEffect(() => {
    if (!running && !waiting) return undefined;
    // Fast while robots, flows, or agents run; slower while people work their Action Center tasks.
    const timer = setInterval(() => { if (!dirtyRef.current) load(); }, running ? 5000 : 20000);
    return () => clearInterval(timer);
  }, [running, waiting, load]);

  const act = async (path, body, message) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`/api/cases/${id}${path}`, { method: 'POST', body: body || {} });
      apply(result.data);
      if (message) setNotice(message);
      return true;
    } catch (err) { setError(err.message); return false; } finally { setBusy(false); }
  };
  const patch = async (body, message) => {
    setBusy(true); setError('');
    try {
      await api(`/api/cases/${id}`, { method: 'PATCH', body });
      const fresh = await api(`/api/cases/${id}`);
      dirtyRef.current = false;
      setFieldsDirty(false);
      apply(fresh.data);
      if (message) setNotice(message);
    } catch (err) { setError(err.message); setFieldErrors(err.fields || {}); } finally { setBusy(false); }
  };
  const saveFields = () => {
    const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(item.fields?.[key])));
    const checked = validateCaseFields(item.definition.fields, changed, { partial: true });
    if (checked.errors.length) { setFieldErrors(Object.fromEntries(checked.errors.map((entry) => [entry.path, entry.message]))); return; }
    patch({ fields: checked.values }, 'Fields saved');
  };
  const upload = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    setBusy(true); setError('');
    try { const result = await api(`/api/cases/${id}/attachments`, { method: 'POST', body: form }); apply(result.data); } catch (err) { setError(err.message); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const taskAction = async (task, action) => {
    let body = {};
    if (action === 'skip') {
      const reason = window.prompt(`Skip "${task.name}"? Reason (optional):`, '');
      if (reason === null) return;
      body = { reason };
    }
    await act(`/tasks/${task.id}/${action}`, body);
  };

  if (error && !item) return <div className="p-8"><p className="rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger" role="alert">{error}</p></div>;
  if (!item) return <div className="p-8 text-[14px] text-slate-500">Loading case…</div>;

  const { definition, permissions } = item;
  const open = item.status === 'open';
  const active = ['open', 'on_hold'].includes(item.status);
  const stage = definition.stages.find((entry) => entry.id === item.currentStageId);
  const currentTasks = item.tasks.filter((task) => task.stageId === item.currentStageId && task.visit === item.stageVisit && task.status !== 'cancelled');
  const latest = new Map();
  for (const task of currentTasks) if (!latest.has(task.taskKey) || latest.get(task.taskKey).attempt < task.attempt) latest.set(task.taskKey, task);
  const shownTasks = [...latest.values()];
  const history = item.tasks.filter((task) => !shownTasks.includes(task));
  const skipped = new Set(item.events.filter((event) => event.event === 'stage.skipped').map((event) => event.data?.stageId).filter(Boolean));
  const defTask = (task) => definition.stages.flatMap((entry) => entry.tasks || []).find((entry) => entry.id === task.taskKey);
  const people = item.people || [];
  const holdFor = item.holdStartedAt ? parseUtc(item.holdStartedAt) : null;

  return (
    <main id="app-main" className="mx-auto min-h-[calc(100vh-3.5rem)] max-w-[1440px] px-5 pb-16 pt-6 sm:px-8 lg:px-10">
      <nav className="flex items-center gap-1.5 text-[12.5px] text-slate-500" aria-label="Breadcrumb">
        <Link to="/cases" className="hover:text-ink">Cases</Link><Icon name="chevronRight" className="h-3 w-3" />
        <Link to={`/cases?type=${item.caseTypeId}`} className="hover:text-ink">{item.caseTypeName}</Link><Icon name="chevronRight" className="h-3 w-3" />
        <span className="font-mono text-ink">{item.reference}</span>
      </nav>

      <header className="mt-3 flex flex-wrap items-start gap-4">
        <span className="u-tile grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#FFF1EB] text-ember"><Icon name="briefcase" className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12.5px] text-slate-400">{item.reference}</span>
            <CaseStatusChip status={item.status} />
            <PriorityChip priority={item.priority} />
            <SlaChip label="Case SLA" dueAt={item.dueAt} state={item.slaState} status={item.status} now={now} />
            {stage && <SlaChip label={`${stage.name} SLA`} dueAt={item.stageDueAt} state={item.stageSlaState} status={item.status} now={now} />}
          </div>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-ink">{item.title}</h1>
          <p className="mt-0.5 text-[12.5px] text-slate-500">Opened {timeAgo(item.createdAt)} via {item.source}{item.status === 'on_hold' && holdFor ? ` · on hold since ${timeAgo(item.holdStartedAt)}${item.holdReason ? `: ${item.holdReason}` : ''}` : ''}{item.resolvedAt ? ` · resolved ${timeAgo(item.resolvedAt)}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {open && permissions.canWork && <button type="button" className={secondaryBtn} disabled={busy} onClick={() => { const reason = window.prompt('Put the case on hold. Reason (optional):', ''); if (reason !== null) act('/hold', { reason }, 'On hold. SLA timers are paused.'); }}><Icon name="clock" className="h-4 w-4" />Hold</button>}
          {item.status === 'on_hold' && permissions.canWork && <button type="button" className={secondaryBtn} disabled={busy} onClick={() => act('/resume', {}, 'Resumed. Due dates moved by the time on hold.')}><Icon name="play" className="h-4 w-4" />Resume</button>}
          {active && permissions.canManage && <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setMoving(true)}><Icon name="arrow" className="h-4 w-4" />Move</button>}
          {active && permissions.canManage && <button type="button" className={secondaryBtn} disabled={busy} onClick={() => { const comment = window.prompt('Cancel this case? Reason (optional):', ''); if (comment !== null) act('/cancel', { comment }); }}>Cancel case</button>}
          {active && permissions.canManage && <button type="button" className={primaryBtn} disabled={busy} onClick={() => { if (window.confirm('Resolve the case now? Open tasks are cancelled.')) act('/resolve', {}, 'Case resolved'); }}><Icon name="check" className="h-4 w-4" />Resolve</button>}
          {item.status === 'resolved' && permissions.canManage && <button type="button" className={secondaryBtn} disabled={busy} onClick={() => act('/close', {}, 'Case closed')}>Close</button>}
          {['resolved', 'closed', 'cancelled'].includes(item.status) && permissions.canManage && <button type="button" className={secondaryBtn} disabled={busy} onClick={() => act('/reopen', {}, 'Case reopened')}><Icon name="undo" className="h-4 w-4" />Reopen</button>}
        </div>
      </header>

      {(error || notice) && (
        <p className={`mt-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${error ? 'border-danger/20 bg-[#FEF3F2] text-danger' : 'border-[#D5EBDC] bg-[#F1F9F3] text-[#1F6B3A]'}`} role={error ? 'alert' : 'status'}>
          <Icon name={error ? 'alert' : 'check'} className="h-4 w-4" /><span className="flex-1">{error || notice}</span>
          <button type="button" className="text-[12px] font-semibold opacity-70 hover:opacity-100" onClick={() => { setError(''); setNotice(''); }}>Dismiss</button>
        </p>
      )}

      <Card className="mt-5 px-6 pb-4 pt-5">
        <StageStepper stages={definition.stages} currentStageId={item.currentStageId} status={item.status} skipped={skipped} />
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <Card title={stage ? `${stage.name} tasks` : 'Tasks'} action={running ? <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#3A75D0]" />Updating live</span> : stage?.exitConditions?.length ? <span className="max-w-[60%] truncate text-[12px] text-slate-500" title={stage.exitConditions.map((entry) => describeCondition(entry, definition)).join(' and ')}>Done when {stage.exitConditions.map((entry) => describeCondition(entry, definition)).join(' and ')}</span> : null}>
            {shownTasks.length ? (
              <ul className="divide-y divide-[#F1EEEA]">
                {shownTasks.map((task) => <TaskRow key={task.id} task={task} definitionTask={defTask(task)} canWork={permissions.canWork} canManage={permissions.canManage} caseOpen={open} busy={busy} onAction={taskAction} />)}
              </ul>
            ) : <p className="px-5 py-6 text-[13px] text-slate-500">{['resolved', 'closed'].includes(item.status) ? 'All stages are complete.' : 'No tasks in this stage.'}</p>}
            {history.length > 0 && (
              <div className="border-t border-[#F1EEEA]">
                <button type="button" className="flex w-full items-center gap-1.5 px-5 py-2.5 text-[12.5px] font-semibold text-slate-500 hover:text-ink" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
                  <Icon name={showHistory ? 'chevronDown' : 'chevronRight'} className="h-3.5 w-3.5" />Earlier tasks ({history.length})
                </button>
                {showHistory && (
                  <ul className="divide-y divide-[#F6F4F1] bg-[#FCFBFA]">
                    {history.map((task) => (
                      <li key={task.id} className="flex items-center gap-3 px-5 py-2.5 text-[12.5px]">
                        <KindTile kind={task.kind} size="h-6 w-6" iconSize="h-3 w-3" />
                        <span className="min-w-0 flex-1 truncate text-slate-700">{task.name} <span className="text-slate-400">· {definition.stages.find((entry) => entry.id === task.stageId)?.name || task.stageId}{task.attempt > 1 ? ` · attempt ${task.attempt}` : ''}</span></span>
                        {task.outcome && <span className="text-slate-500">{task.outcome}</span>}
                        <TaskStatusChip status={task.status} />
                        <span className="w-20 text-right text-slate-400">{timeAgo(task.completedAt || task.updatedAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>

          <Card title="Fields" action={permissions.canWork && active && <button type="button" className={primaryBtn} disabled={busy || !fieldsDirty} onClick={saveFields}>Save fields</button>}>
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
              {definition.fields.map((field) => (
                <div key={field.name} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
                  {permissions.canWork && active
                    ? <CaseFieldInput field={field} value={values[field.name]} error={fieldErrors[field.name]} onChange={(value) => { setValues({ ...values, [field.name]: value }); setFieldsDirty(true); setFieldErrors({ ...fieldErrors, [field.name]: undefined }); }} />
                    : <div><span className="mb-1 block text-[12px] font-medium text-slate-500">{field.label}</span><span className="block text-[13.5px] text-ink">{fieldText(field, item.fields?.[field.name])}</span></div>}
                </div>
              ))}
              {!definition.fields.length && <p className="text-[13px] text-slate-500">This case type has no fields.</p>}
            </div>
          </Card>

          <Card title={`Comments${item.comments.length ? ` (${item.comments.length})` : ''}`}>
            <ul className="space-y-4 px-5 py-4">
              {item.comments.map((entry) => (
                <li key={entry.id} className="flex gap-3">
                  <Avatar name={entry.userName} email={entry.userEmail} size="h-7 w-7 text-[10.5px]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px]"><span className="font-semibold text-ink">{entry.userName || entry.userEmail}</span> <span className="text-slate-400">{timeAgo(entry.createdAt)}</span></p>
                    <p className="mt-0.5 whitespace-pre-wrap text-[13.5px] leading-5 text-slate-700">{entry.body}</p>
                  </div>
                </li>
              ))}
              {!item.comments.length && <li className="text-[13px] text-slate-500">No comments yet.</li>}
            </ul>
            {permissions.canWork && (
              <form className="flex items-end gap-2 border-t border-[#F1EEEA] px-5 py-3" onSubmit={async (event) => { event.preventDefault(); if (comment.trim() && await act('/comments', { body: comment.trim() })) setComment(''); }}>
                <textarea aria-label="Comment" rows={2} className={control} value={comment} placeholder="Add a comment" maxLength={5000} onChange={(event) => setComment(event.target.value)} />
                <button type="submit" className={primaryBtn} disabled={busy || !comment.trim()}>Comment</button>
              </form>
            )}
          </Card>
        </div>

        <aside className="space-y-5">
          <Card title="Details">
            <dl className="space-y-3 px-5 py-4 text-[13px]">
              <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Stage</dt><dd className="font-semibold text-ink">{item.currentStageName}{item.stageCount ? <span className="font-normal text-slate-400"> · {item.stageIndex + 1} of {item.stageCount}</span> : null}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Owner</dt><dd className="w-[200px]">
                {permissions.canManage && active ? (
                  <select aria-label="Owner" className={control} disabled={busy} value={item.ownerUserId || ''} onChange={(event) => patch({ ownerUserId: event.target.value || null }, 'Owner changed')}>
                    <option value="">Nobody</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name || person.email}</option>)}
                  </select>
                ) : <span className="block text-right text-ink">{item.ownerName || item.ownerEmail || 'Nobody'}</span>}
              </dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Assignee</dt><dd className="w-[200px]">
                {permissions.canWork && active ? (
                  <select aria-label="Assignee" className={control} disabled={busy} value={item.assigneeUserId || ''} onChange={(event) => patch({ assigneeUserId: event.target.value || null }, 'Assignee changed')}>
                    <option value="">Nobody</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name || person.email}</option>)}
                  </select>
                ) : <span className="block text-right text-ink">{item.assigneeName || item.assigneeEmail || 'Nobody'}</span>}
              </dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Priority</dt><dd className="w-[200px]">
                {permissions.canManage && active ? (
                  <select aria-label="Priority" className={control} disabled={busy} value={item.priority} onChange={(event) => patch({ priority: event.target.value }, 'Priority changed')}>
                    {PRIORITIES.map((entry) => <option key={entry} value={entry}>{entry[0].toUpperCase() + entry.slice(1)}</option>)}
                  </select>
                ) : <span className="block text-right"><PriorityChip priority={item.priority} /></span>}
              </dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Case due</dt><dd className="text-ink">{formatWhen(item.dueAt)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Stage due</dt><dd className="text-ink">{formatWhen(item.stageDueAt)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">In stage since</dt><dd className="text-ink">{formatWhen(item.stageEnteredAt)}</dd></div>
            </dl>
          </Card>

          <Card title="Attachments" action={permissions.canWork && <><input ref={fileRef} type="file" className="hidden" accept=".csv,.xlsx,.pdf,.txt,.json,.png,.jpg,.jpeg,.docx" onChange={(event) => upload(event.target.files?.[0])} /><button type="button" className={secondaryBtn} disabled={busy} onClick={() => fileRef.current?.click()}><Icon name="upload" className="h-4 w-4" />Attach</button></>}>
            <ul className="divide-y divide-[#F1EEEA]">
              {item.attachments.map((file) => (
                <li key={file.id} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#F6F4F1] text-slate-500"><Icon name="document" className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-ink">{file.fileName}</span><span className="text-[11.5px] text-slate-400">{Math.max(1, Math.round(file.size / 1024))} KB · {file.userName || file.userEmail} · {timeAgo(file.createdAt)}</span></span>
                  <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-[#F6F4F1] hover:text-ink" aria-label={`Download ${file.fileName}`} onClick={() => download(`/api/artifacts/${file.artifactId}/download`, file.fileName).catch((err) => setError(err.message))}><Icon name="download" className="h-4 w-4" /></button>
                </li>
              ))}
              {!item.attachments.length && <li className="px-5 py-4 text-[13px] text-slate-500">No files attached.</li>}
            </ul>
          </Card>

          <Card title="Activity">
            <ol className="relative max-h-[560px] overflow-y-auto px-5 py-4">
              {item.events.map((event, index) => {
                const [icon, tone] = EVENT_ICON[event.event.split('.')[0]] || ['info', 'bg-[#F6F4F1] text-slate-500'];
                const alert = /breach|failed/.test(event.event);
                return (
                  <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {index < item.events.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-20px)] w-px bg-[#ECE8E3]" aria-hidden="true" />}
                    <span className={`relative grid h-7 w-7 shrink-0 place-items-center rounded-full ${alert ? 'bg-[#FDEEEC] text-[#A8261B]' : tone}`}><Icon name={alert ? 'alert' : icon} className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="text-[12.5px] leading-5 text-slate-700">{event.message}{event.event.startsWith('sla.') && event.data?.due ? <span className="text-slate-500"> · due {formatWhen(event.data.due)}</span> : null}</p>
                      <p className="text-[11px] text-slate-400" title={formatWhen(event.createdAt)}>{event.actorName || event.actorEmail || 'System'} · {timeAgo(event.createdAt)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </aside>
      </div>
      {moving && <MoveDialog item={item} onClose={() => setMoving(false)} onMove={async (stageId, reason) => { setMoving(false); await act('/move', { stageId, reason }, 'Case moved'); }} />}
    </main>
  );
}
