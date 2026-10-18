import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, currentUser } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import AgentTranscript from '../components/AgentTranscript.jsx';
import { useAgentRun } from './AgentBuilderPage.jsx';
import { StatusPill } from './HomePage.jsx';
import { formatTime } from './FlowRunPage.jsx';

// Agent run trace: every message, tool call (arguments, result, linked job or task), token usage,
// and the run's input and output. Live while the run works; a conversation can be continued here.

const SOURCE = { test: 'Test run (draft)', chat: 'Chat', api: 'API', flow: 'Flow step' };
const secondaryBtn = 'u-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';

export function runDuration(run) {
  if (!run?.startedAt) return '—';
  const start = new Date(`${String(run.startedAt).replace(' ', 'T')}Z`).getTime();
  const end = run.finishedAt ? new Date(`${String(run.finishedAt).replace(' ', 'T')}Z`).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function Stat({ label, value }) {
  return <div><p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">{label}</p><p className="mt-0.5 text-[13.5px] font-semibold tabular-nums text-ink">{value}</p></div>;
}

export default function AgentRunPage() {
  const { id, runId } = useParams();
  const user = currentUser();
  const { run, reload, error } = useAgentRun(runId);
  const [busy, setBusy] = useState('');
  const [text, setText] = useState('');
  const [actionError, setActionError] = useState('');
  const toolCalls = (run?.messages || []).filter((m) => m.role === 'tool');

  async function act(path, body) {
    setBusy(path); setActionError('');
    try { await api(`/api/agent-runs/${runId}/${path}`, { method: 'POST', body }); await reload(); if (path === 'messages') setText(''); } catch (err) { setActionError(err.message); } finally { setBusy(''); }
  }

  if (error && !run) return <main id="app-main" className="p-10 text-[14px] text-danger">{error}</main>;
  if (!run) return <main id="app-main" className="p-10 text-[14px] text-slate-500">Loading run…</main>;
  const active = ['RUNNING', 'WAITING'].includes(run.status);
  const canContinue = run.mode === 'chat' && run.status === 'IDLE' && (run.startedBy === user?.id || user?.role === 'administrator');
  return (
    <main id="app-main" className="flex h-[calc(100vh-3.5rem)] flex-col bg-[#FAF9F7]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#ECE8E3] bg-white px-4 py-2.5">
        <Link to={`/studio/agents/${id}`} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Back to the agent"><Icon name="chevronRight" className="h-4 w-4 rotate-180" /></Link>
        <span className="u-tile grid h-8 w-8 place-items-center rounded-lg bg-[#EEF4FF] text-[#3550B5]"><Icon name="agent" className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="text-[11.5px] text-slate-500">{run.agentName} · {SOURCE[run.source] || run.source}{run.versionNumber ? ` · v${run.versionNumber}` : ''}</p>
          <h1 className="max-w-[520px] truncate text-[15px] font-semibold tracking-tight text-ink">{run.title || 'Agent run'}</h1>
        </div>
        <StatusPill status={run.status} />
        {active && <span className="flex items-center gap-1.5 text-[12px] text-slate-500"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#3A75D0] opacity-60 motion-reduce:animate-none" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#3A75D0]" /></span>Live</span>}
        <div className="ml-auto flex items-center gap-2">
          {run.mode === 'chat' && run.status === 'IDLE' && <button type="button" className={secondaryBtn} disabled={Boolean(busy)} onClick={() => act('end')}>End conversation</button>}
          {(active || run.status === 'IDLE') && <button type="button" className={secondaryBtn} disabled={Boolean(busy)} onClick={() => act('cancel')}><Icon name="close" className="h-3.5 w-3.5" />Cancel run</button>}
          <Link to={`/studio/agents/${id}`} className={secondaryBtn}><Icon name="agent" className="h-3.5 w-3.5" />Open agent</Link>
        </div>
      </div>
      {actionError && <div className="border-b border-[#F5C9C4] bg-[#FEF3F2] px-5 py-2 text-[13px] text-danger" role="alert">{actionError}</div>}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[820px] px-6 py-6">
              <AgentTranscript run={run} showSystem toolTypes={run.toolTypes || {}} />
            </div>
          </div>
          {canContinue && (
            <form className="border-t border-[#ECE8E3] bg-white px-6 py-3" onSubmit={(event) => { event.preventDefault(); if (text.trim()) act('messages', { content: text.trim() }); }}>
              <div className="mx-auto flex max-w-[820px] items-end gap-2 rounded-xl border border-[#E2DCD5] bg-white p-1.5 focus-within:border-ember focus-within:ring-2 focus-within:ring-brand/15">
                <textarea aria-label="Reply to the agent" rows={1} className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13.5px] focus:outline-none" placeholder="Reply…" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (text.trim()) act('messages', { content: text.trim() }); } }} />
                <button type="submit" disabled={Boolean(busy) || !text.trim()} className="u-btn-primary grid h-9 w-9 place-items-center rounded-lg disabled:opacity-50" aria-label="Send"><Icon name="arrowUpRight" className="h-4 w-4" strokeWidth={2.2} /></button>
              </div>
            </form>
          )}
        </div>
        <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-[#ECE8E3] bg-white" aria-label="Run details">
          <div className="grid grid-cols-2 gap-4 border-b border-[#F1EEEA] px-5 py-4">
            <Stat label="Model steps" value={run.steps} />
            <Stat label="Tool calls" value={toolCalls.length} />
            <Stat label="Tokens in" value={run.promptTokens.toLocaleString()} />
            <Stat label="Tokens out" value={run.completionTokens.toLocaleString()} />
            <Stat label="Duration" value={runDuration(run)} />
            <Stat label="Started" value={formatTime(run.startedAt)} />
          </div>
          <div className="space-y-4 px-5 py-4">
            <div><p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">Provider</p><p className="mt-0.5 text-[13px] text-ink">{run.providerLabel || '—'}</p></div>
            {run.flowRunId && <div><p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">Started by a flow</p><p className="mt-0.5 font-mono text-[12px] text-slate-600">{run.flowRunId}</p></div>}
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">Input</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg border border-[#F1EEEA] bg-[#FBFAF8] px-2.5 py-2 font-mono text-[11.5px] text-[#3B4A52]">{JSON.stringify(run.input || {}, null, 2)}</pre>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">{run.mode === 'chat' ? 'Last reply' : 'Output'}</p>
              {run.output ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg border border-[#CDE9D6] bg-[#F7FBF8] px-2.5 py-2 font-mono text-[11.5px] text-ink">{JSON.stringify(run.output, null, 2)}</pre> : <p className="text-[12.5px] text-slate-400">{active ? 'Not finished yet' : 'None'}</p>}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
