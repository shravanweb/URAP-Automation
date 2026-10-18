import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, currentUser } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import BpmnCanvas from '../components/BpmnCanvas.jsx';
import { StatusPill } from './HomePage.jsx';
import { timeAgo } from '../layouts/CloudLayout.jsx';
import { formatTime } from './FlowRunPage.jsx';

// BPMN run monitor: the diagram of the version the run uses, with completed (green), active
// (blue, pulsing), failed (red), and cancelled (grey) elements, plus the timeline, variables,
// and per-element details with links to the Action Center task, job, or agent run.

const canControl = (role) => ['administrator', 'project_manager', 'operator'].includes(role);
const secondaryBtn = 'u-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
export const STATE_LEGEND = [['done', 'Completed', 'bg-[#ECF7EF] ring-[#1F8A4C]'], ['active', 'Active', 'bg-[#EAF1FB] ring-[#2F6FD0]'], ['failed', 'Failed', 'bg-[#FDEEEC] ring-[#D92D20]'], ['cancelled', 'Cancelled', 'bg-[#F2F4F7] ring-[#98A2B3]']];
const STATE_LABEL = { done: 'Completed', active: 'Active', failed: 'Failed', cancelled: 'Cancelled' };
const NODE_STATUS = { SUCCEEDED: 'Completed', WAITING: 'Waiting', READY: 'Ready', FAILED: 'Failed', CANCELLED: 'Cancelled' };

/** Canvas markers from element states. */
export const stateMarkers = (states = {}) => Object.fromEntries(Object.entries(states).map(([id, state]) => [id, `urap-${state}`]));

function Json({ value }) {
  if (value == null || (typeof value === 'object' && !Object.keys(value).length)) return <p className="text-[12px] text-slate-400">None</p>;
  return <pre className="max-h-56 overflow-auto rounded-lg border border-[#ECE8E3] bg-[#FCFBFA] p-2.5 font-mono text-[11.5px] leading-[17px] text-charcoal">{JSON.stringify(value, null, 2)}</pre>;
}

function duration(start, end) {
  if (!start) return '—';
  const a = new Date(`${String(start).replace(' ', 'T')}Z`).getTime();
  const b = end ? new Date(`${String(end).replace(' ', 'T')}Z`).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((b - a) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export default function BpmnRunPage() {
  const { id: processId, runId } = useParams();
  const user = currentUser();
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState('timeline');

  const load = useCallback(() => api(`/api/bpmn-runs/${runId}`).then((result) => { setRun(result.data); setError(''); }).catch((err) => setError(err.message)), [runId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (run?.status !== 'RUNNING') return undefined;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [run?.status, load]);

  const markers = useMemo(() => stateMarkers(run?.states), [run?.states]);
  const counts = useMemo(() => {
    const values = Object.values(run?.states || {});
    return { done: values.filter((value) => value === 'done').length, active: values.filter((value) => value === 'active').length };
  }, [run?.states]);

  async function act(kind) {
    setBusy(kind);
    try { await api(`/api/flow-runs/${runId}/${kind}`, { method: 'POST' }); await load(); } catch (err) { setError(err.message); } finally { setBusy(''); }
  }

  if (error && !run) return <div className="mx-auto max-w-xl px-6 py-20 text-center"><p className="text-[15px] font-semibold text-ink">Could not load the run</p><p className="mt-1 text-[13px] text-slate-500">{error}</p><Link to={`/studio/processes/${processId}`} className="mt-4 inline-block text-[13px] font-semibold text-ember">Back to the process</Link></div>;
  if (!run) return <div className="grid h-[calc(100vh-3.5rem)] place-items-center text-[13px] text-slate-500" role="status">Loading run…</div>;

  const nodesFor = (elementId) => run.definition.nodes.filter((node) => node.config?.bpmnId === elementId || node.config?.bpmnParent === elementId);
  const selectedNodes = selected ? nodesFor(selected.id) : [];
  const rows = selected ? run.nodes.filter((row) => selectedNodes.some((node) => node.id === row.nodeId)) : [];
  const events = selected ? run.events.filter((item) => item.elementId === selected.id || selectedNodes.some((node) => node.id === item.nodeId)) : [];
  const waiting = run.nodes.filter((row) => row.status === 'WAITING');
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[#ECE8E3] bg-white px-4">
        <Link to={`/studio/processes/${processId}`} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Back to the process"><Icon name="chevronRight" className="h-4 w-4 rotate-180" /></Link>
        <div className="min-w-0">
          <p className="truncate text-[11.5px] leading-4 text-slate-500">Process run · v{run.versionNumber} · {run.triggerSource}</p>
          <h1 className="truncate text-[14.5px] font-semibold leading-5 text-ink">{run.processName}</h1>
        </div>
        <StatusPill status={run.status} />
        {run.status === 'RUNNING' && <span className="flex items-center gap-1.5 text-[12px] text-slate-500"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#3A75D0] opacity-60 motion-reduce:animate-none" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#3A75D0]" /></span>Live</span>}
        <div className="ml-6 hidden items-center gap-5 text-[12px] text-slate-500 lg:flex">
          <span>Started <span className="font-medium text-ink">{timeAgo(run.startedAt)}</span></span>
          <span>Duration <span className="font-medium tabular-nums text-ink">{duration(run.startedAt, run.finishedAt)}</span></span>
          <span>Elements <span className="font-medium tabular-nums text-ink">{counts.done}</span> completed{counts.active ? ` · ${counts.active} active` : ''}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {canControl(user?.role) && run.status === 'FAILED' && <button type="button" className="u-btn-primary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold" disabled={busy !== ''} onClick={() => act('retry')}><Icon name="undo" className="h-3.5 w-3.5" />{busy === 'retry' ? 'Retrying…' : 'Retry failed step'}</button>}
          {canControl(user?.role) && ['RUNNING', 'FAILED'].includes(run.status) && <button type="button" className={secondaryBtn} disabled={busy !== ''} onClick={() => act('cancel')}><Icon name="close" className="h-3.5 w-3.5" />{busy === 'cancel' ? 'Cancelling…' : 'Cancel run'}</button>}
          <Link to={`/studio/processes/${processId}`} className={secondaryBtn}><Icon name="bpmn" className="h-3.5 w-3.5" />Open modeler</Link>
        </div>
      </div>
      {(run.error || error) && <div className="flex shrink-0 items-center gap-2 border-b border-[#F4C7C1] bg-[#FEF3F2] px-5 py-2 text-[13px] text-danger" role="alert"><Icon name="alert" className="h-4 w-4" />{error || run.error}</div>}
      {!error && waiting.some((row) => row.taskId) && run.status === 'RUNNING' && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[#E4ECF7] bg-[#F5F8FD] px-5 py-2 text-[13px] text-[#2F5FA8]" role="status">
          <Icon name="tasks" className="h-4 w-4" />Waiting for a person in Action Center.
          {waiting.filter((row) => row.taskId).slice(0, 1).map((row) => <Link key={row.id} to={`/tasks/${row.taskId}`} className="font-semibold hover:underline">Open the task →</Link>)}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <BpmnCanvas readOnly xml={run.xml} importKey={`${run.id}:${run.versionNumber}`} markers={markers} onSelect={(element) => setSelected(element ? { id: element.id, name: element.businessObject?.name || element.id, type: element.type } : null)} />
          <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap gap-3 rounded-xl bg-white/90 px-3 py-2 text-[11.5px] text-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.06)] ring-1 ring-[#ECE8E3] backdrop-blur">
            {STATE_LEGEND.map(([key, label, tone]) => <span key={key} className="flex items-center gap-1.5"><span className={`h-3 w-3 rounded-[4px] ring-2 ${tone}`} />{label}</span>)}
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[4px] bg-white ring-1 ring-[#D0D5DD]" />Not reached</span>
          </div>
        </div>
        <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-[#ECE8E3] bg-white" aria-label="Run details">
          {selected ? (
            <div className="px-5 py-4">
              <button type="button" className="mb-3 text-[12.5px] font-medium text-slate-500 hover:text-ink" onClick={() => setSelected(null)}>← Run overview</button>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-ink">{selected.name}</p>
                  <p className="text-[12px] text-slate-500">{selected.type.replace('bpmn:', '').replace(/([a-z])([A-Z])/g, '$1 $2')} · <span className="font-mono">{selected.id}</span></p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${run.states[selected.id] === 'done' ? 'bg-[#ECF7EF] text-[#1F6B3A]' : run.states[selected.id] === 'active' ? 'bg-[#EAF1FB] text-[#2F5FA8]' : run.states[selected.id] === 'failed' ? 'bg-[#FDEEEC] text-[#A8261B]' : 'bg-slate-100 text-slate-500'}`}>{STATE_LABEL[run.states[selected.id]] || 'Not reached'}</span>
              </div>
              {rows.length === 0 && <p className="mt-4 text-[12.5px] text-slate-500">{run.states[selected.id] ? 'The run passed through here.' : 'The run has not reached this element.'}</p>}
              {rows.map((row) => {
                const node = run.definition.nodes.find((item) => item.id === row.nodeId);
                return (
                  <div key={row.id} className="mt-4 space-y-2 rounded-xl border border-[#ECE8E3] p-3.5">
                    <div className="flex items-center justify-between text-[12px] text-slate-500"><span>{node?.name || row.nodeId} · {NODE_STATUS[row.status] || row.status}{row.attempt > 1 ? ` · attempt ${row.attempt}` : ''}</span><span className="tabular-nums">{formatTime(row.startedAt)} · {duration(row.startedAt, row.finishedAt)}</span></div>
                    {row.taskId && <Link to={`/tasks/${row.taskId}`} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ember hover:underline"><Icon name="tasks" className="h-3.5 w-3.5" />{row.status === 'WAITING' ? 'Complete the task in Action Center' : 'Open task'}</Link>}
                    {row.jobId && <Link to={`/jobs/${row.jobId}`} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ember hover:underline"><Icon name="robot" className="h-3.5 w-3.5" />Open job</Link>}
                    {row.agentRunId && <Link to={`/studio/agents/${node?.config?.agentId}/runs/${row.agentRunId}`} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ember hover:underline"><Icon name="agent" className="h-3.5 w-3.5" />Open agent run</Link>}
                    {row.wakeAt && row.status === 'WAITING' && <p className="text-[12px] text-slate-500">Resumes at {formatTime(row.wakeAt)}</p>}
                    {row.error && <p className="rounded-lg bg-[#FEF3F2] px-2.5 py-1.5 text-[12px] text-danger">{row.error}</p>}
                    {row.output !== null && row.output !== undefined && <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">Output</p><Json value={row.output} /></div>}
                  </div>
                );
              })}
              {events.length > 0 && <ol className="mt-4 space-y-2">{events.map((item) => <li key={item.id} className="flex gap-2 text-[12px] text-slate-600"><span className="w-16 shrink-0 tabular-nums text-slate-400">{formatTime(item.createdAt)}</span>{item.message}</li>)}</ol>}
            </div>
          ) : (
            <>
              <div className="sticky top-0 z-10 flex gap-5 border-b border-[#ECE8E3] bg-white px-5" role="tablist" aria-label="Run panels">
                {[['timeline', 'Timeline'], ['variables', 'Variables']].map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`-mb-px border-b-2 py-3 text-[13px] font-semibold ${tab === key ? 'border-ember text-ink' : 'border-transparent text-slate-500 hover:text-ink'}`}>{label}</button>
                ))}
              </div>
              <div className="px-5 py-4">
                {tab === 'timeline' ? (
                  <ol>
                    {run.events.map((item, index) => (
                      <li key={item.id} className="relative flex gap-3 pb-4">
                        {index < run.events.length - 1 && <span className="absolute left-[9px] top-5 h-full w-px bg-[#ECE8E3]" aria-hidden="true" />}
                        <span className={`relative mt-0.5 grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full ${/failed/.test(item.event) ? 'bg-[#FDEEEC] text-[#A8261B]' : /succeeded/.test(item.event) ? 'bg-[#ECF7EF] text-[#1F6B3A]' : /waiting/.test(item.event) ? 'bg-[#EAF1FB] text-[#2F5FA8]' : 'bg-slate-100 text-slate-500'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" /></span>
                        <div className="min-w-0 flex-1">
                          <button type="button" className="text-left text-[13px] leading-5 text-ink hover:text-ember disabled:hover:text-ink" disabled={!item.nodeId} onClick={() => setSelected({ id: item.elementId, name: run.definition.nodes.find((node) => node.id === item.nodeId)?.name || item.elementId, type: '' })}>{item.message}</button>
                          <p className="text-[11.5px] tabular-nums text-slate-400">{formatTime(item.createdAt)}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="space-y-4">
                    <div><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">Variables</p><Json value={run.variables} /></div>
                    <div><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">Run input</p><Json value={run.input} /></div>
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
