import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, currentUser } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import FlowCanvas, { NODE_META, RUN_STATUS } from '../components/FlowCanvas.jsx';
import { StatusPill } from './HomePage.jsx';
import { timeAgo } from '../layouts/CloudLayout.jsx';

// Flow run monitor: the published graph with live node statuses (polled), a timeline of
// events, variables, and per-step details with links to the job or Action Center task.

const canControl = (role) => ['administrator', 'project_manager', 'operator'].includes(role);
const secondaryBtn = 'u-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const EVENT_TONE = {
  'run.started': 'bg-[#EAF1FB] text-[#2F5FA8]', 'run.succeeded': 'bg-[#ECF7EF] text-[#1F6B3A]', 'run.failed': 'bg-[#FDEEEC] text-[#A8261B]',
  'run.cancelled': 'bg-slate-100 text-slate-600', 'run.retried': 'bg-[#FDF5E6] text-[#8A5A0B]', 'node.succeeded': 'bg-[#ECF7EF] text-[#1F6B3A]',
  'node.failed': 'bg-[#FDEEEC] text-[#A8261B]', 'node.waiting': 'bg-[#FDF5E6] text-[#8A5A0B]', 'node.retry': 'bg-[#FDF5E6] text-[#8A5A0B]',
};

/** Latest activation per node id: { nodeId: row }. */
export function latestNodeStates(nodes = []) {
  const map = {};
  for (const row of nodes) map[row.nodeId] = row;
  return map;
}

export function formatTime(value) {
  if (!value) return '—';
  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

function Json({ value }) {
  if (value == null || (typeof value === 'object' && !Object.keys(value).length)) return <p className="text-[12px] text-slate-400">None</p>;
  return <pre className="max-h-56 overflow-auto rounded-lg border border-[#ECE8E3] bg-[#FCFBFA] p-2.5 font-mono text-[11.5px] leading-[17px] text-charcoal">{JSON.stringify(value, null, 2)}</pre>;
}

export default function FlowRunPage() {
  const { id: flowId, runId } = useParams();
  const user = currentUser();
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState('timeline');
  const [zoom, setZoom] = useState(0.9);

  const load = useCallback(() => api(`/api/flow-runs/${runId}`).then((result) => { setRun(result.data); setError(''); }).catch((err) => setError(err.message)), [runId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!run || !['RUNNING'].includes(run.status)) return undefined;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [run?.status, load]);

  const states = useMemo(() => latestNodeStates(run?.nodes), [run]);
  const counts = useMemo(() => {
    const values = Object.values(states);
    return { done: values.filter((row) => row.status === 'SUCCEEDED').length, waiting: values.filter((row) => row.status === 'WAITING').length, total: run?.definition?.nodes.length || 0 };
  }, [states, run]);

  async function act(kind) {
    setBusy(kind);
    try { await api(`/api/flow-runs/${runId}/${kind}`, { method: 'POST' }); await load(); } catch (err) { setError(err.message); } finally { setBusy(''); }
  }

  if (error && !run) return <div className="mx-auto max-w-xl px-6 py-20 text-center"><p className="text-[15px] font-semibold text-ink">Could not load the run</p><p className="mt-1 text-[13px] text-slate-500">{error}</p><Link to={`/studio/flows/${flowId}`} className="mt-4 inline-block text-[13px] font-semibold text-ember">Back to the flow</Link></div>;
  if (!run) return <div className="grid h-[calc(100vh-3.5rem)] place-items-center text-[13px] text-slate-500" role="status">Loading run…</div>;

  const node = selected ? run.definition.nodes.find((item) => item.id === selected) : null;
  const nodeRows = selected ? run.nodes.filter((row) => row.nodeId === selected) : [];
  const nodeEvents = selected ? run.events.filter((item) => item.nodeId === selected) : [];
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[#ECE8E3] bg-white px-4">
        <Link to={`/studio/flows/${flowId}`} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Back to the flow editor"><Icon name="chevronRight" className="h-4 w-4 rotate-180" /></Link>
        <div className="min-w-0">
          <p className="truncate text-[11.5px] leading-4 text-slate-500">Flow run · v{run.versionNumber} · {run.triggerSource}</p>
          <h1 className="truncate text-[14.5px] font-semibold leading-5 text-ink">{run.flowName}</h1>
        </div>
        <StatusPill status={run.status} />
        {run.status === 'RUNNING' && <span className="flex items-center gap-1.5 text-[12px] text-slate-500"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#3A75D0] opacity-60 motion-reduce:animate-none" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#3A75D0]" /></span>Live</span>}
        <div className="ml-6 hidden items-center gap-5 text-[12px] text-slate-500 lg:flex">
          <span>Started <span className="font-medium text-ink">{timeAgo(run.startedAt)}</span></span>
          <span>Duration <span className="font-medium tabular-nums text-ink">{duration(run.startedAt, run.finishedAt)}</span></span>
          <span>Steps <span className="font-medium tabular-nums text-ink">{counts.done}/{counts.total}</span>{counts.waiting ? ` · ${counts.waiting} waiting` : ''}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {canControl(user?.role) && run.status === 'FAILED' && <button type="button" className="u-btn-primary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold" disabled={busy !== ''} onClick={() => act('retry')}><Icon name="undo" className="h-3.5 w-3.5" />{busy === 'retry' ? 'Retrying…' : 'Retry failed step'}</button>}
          {canControl(user?.role) && ['RUNNING', 'FAILED'].includes(run.status) && <button type="button" className={secondaryBtn} disabled={busy !== ''} onClick={() => act('cancel')}><Icon name="close" className="h-3.5 w-3.5" />{busy === 'cancel' ? 'Cancelling…' : 'Cancel run'}</button>}
          <Link to={`/studio/flows/${flowId}`} className={secondaryBtn}><Icon name="flow" className="h-3.5 w-3.5" />Open editor</Link>
        </div>
      </div>
      {(run.error || error) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[#F4C7C1] bg-[#FEF3F2] px-5 py-2 text-[13px] text-danger" role="alert"><Icon name="alert" className="h-4 w-4" />{error || run.error}{run.status === 'FAILED' && !error && <span className="text-slate-500">· Retry the failed step or cancel the run.</span>}</div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <FlowCanvas definition={run.definition} nodeStates={states} selected={selected ? { kind: 'node', id: selected } : null} onSelect={(value) => setSelected(value?.kind === 'node' ? value.id : null)} zoom={zoom} fitKey={run.id} onZoom={setZoom} />
          <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap gap-3 rounded-xl bg-white/90 px-3 py-2 text-[11.5px] text-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.06)] ring-1 ring-[#ECE8E3] backdrop-blur">
            {['SUCCEEDED', 'WAITING', 'FAILED', 'CANCELLED'].map((key) => <span key={key} className="flex items-center gap-1.5"><span className={`grid h-4 w-4 place-items-center rounded-full ${RUN_STATUS[key].badge}`}><Icon name={RUN_STATUS[key].icon} className="h-2.5 w-2.5" strokeWidth={2.6} /></span>{RUN_STATUS[key].label}</span>)}
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border border-[#ECE8E3] bg-white opacity-60" />Not reached</span>
          </div>
        </div>
        <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-[#ECE8E3] bg-white" aria-label="Run details">
          {node ? (
            <div className="px-5 py-4">
              <button type="button" className="mb-3 text-[12.5px] font-medium text-slate-500 hover:text-ink" onClick={() => setSelected(null)}>← Run overview</button>
              <div className="flex items-start gap-3">
                <span className={`u-tile grid h-9 w-9 shrink-0 place-items-center rounded-lg ${NODE_META[node.type]?.tone}`}><Icon name={NODE_META[node.type]?.icon} className="h-[18px] w-[18px]" strokeWidth={1.8} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink">{node.name}</p>
                  <p className="text-[12px] text-slate-500">{NODE_META[node.type]?.label}</p>
                </div>
                {states[node.id] ? <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${RUN_STATUS[states[node.id].status]?.badge}`}>{RUN_STATUS[states[node.id].status]?.label}</span> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-medium text-slate-500">Not reached</span>}
              </div>
              {nodeRows.map((row) => (
                <div key={row.id} className="mt-4 space-y-2 rounded-xl border border-[#ECE8E3] p-3.5">
                  <div className="flex items-center justify-between text-[12px] text-slate-500"><span>Attempt {row.attempt} · {RUN_STATUS[row.status]?.label}</span><span className="tabular-nums">{formatTime(row.startedAt)} · {duration(row.startedAt, row.finishedAt)}</span></div>
                  {row.agentRunId && <Link to={`/studio/agents/${node.config?.agentId}/runs/${row.agentRunId}`} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ember hover:underline"><Icon name="agent" className="h-3.5 w-3.5" />Open agent run</Link>}
                  {row.jobId && <Link to={`/jobs/${row.jobId}`} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ember hover:underline"><Icon name="robot" className="h-3.5 w-3.5" />Open job</Link>}
                  {row.taskId && <Link to={`/tasks/${row.taskId}`} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ember hover:underline"><Icon name="tasks" className="h-3.5 w-3.5" />{row.status === 'WAITING' ? 'Complete the task in Action Center' : 'Open task'}</Link>}
                  {row.wakeAt && row.status === 'WAITING' && <p className="text-[12px] text-slate-500">Resumes at {formatTime(row.wakeAt)}</p>}
                  {node.type === 'join' ? <p className="text-[12px] text-slate-500">{row.arrivals} branch{row.arrivals === 1 ? '' : 'es'} arrived</p> : null}
                  {row.error && <p className="rounded-lg bg-[#FEF3F2] px-2.5 py-1.5 text-[12px] text-danger">{row.error}</p>}
                  {row.input && <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">Input</p><Json value={row.input} /></div>}
                  {row.output !== null && row.output !== undefined && <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">Output</p><Json value={row.output} /></div>}
                </div>
              ))}
              {nodeEvents.length > 0 && (
                <ol className="mt-4 space-y-2">
                  {nodeEvents.map((item) => <li key={item.id} className="flex gap-2 text-[12px] text-slate-600"><span className="w-16 shrink-0 tabular-nums text-slate-400">{formatTime(item.createdAt)}</span>{item.message}</li>)}
                </ol>
              )}
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
                  <ol className="relative space-y-0">
                    {run.events.map((item, index) => (
                      <li key={item.id} className="relative flex gap-3 pb-4">
                        {index < run.events.length - 1 && <span className="absolute left-[9px] top-5 h-full w-px bg-[#ECE8E3]" aria-hidden="true" />}
                        <span className={`relative mt-0.5 grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full ${EVENT_TONE[item.event] || 'bg-slate-100 text-slate-500'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" /></span>
                        <div className="min-w-0 flex-1">
                          <button type="button" className="text-left text-[13px] leading-5 text-ink hover:text-ember disabled:hover:text-ink" disabled={!item.nodeId} onClick={() => setSelected(item.nodeId)}>{item.message}</button>
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
