import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './brand.jsx';

// Renders an agent run: user and assistant messages, each tool call with its arguments and result
// (joined by tool call id), token usage, and a live "working" indicator. Used by the builder's
// test panel and by the run trace page.

const TOOL_STATUS = {
  running: ['Running', 'bg-[#EAF1FB] text-[#2F5FA8]'],
  pending: ['Waiting', 'bg-[#FDF5E6] text-[#8A5A0B]'],
  done: ['Done', 'bg-[#ECF7EF] text-[#1F6B3A]'],
  error: ['Error', 'bg-[#FDEEEC] text-[#A8261B]'],
};

export function parseMaybeJson(text) {
  if (text == null) return null;
  try { return JSON.parse(text); } catch { return text; }
}

/** Splits a run's messages into display turns: [{ kind: 'user'|'assistant'|'system'|'input', message, calls: [{ call, result }] }]. */
export function buildTurns(messages = []) {
  const results = new Map(messages.filter((m) => m.role === 'tool').map((m) => [m.toolCallId, m]));
  const turns = [];
  for (const message of messages) {
    if (message.role === 'tool') continue;
    if (message.role === 'user' && /^Task input:\n```json\n/.test(message.content || '')) {
      turns.push({ kind: 'input', message, input: parseMaybeJson(message.content.replace(/^Task input:\n```json\n/, '').replace(/\n```$/, '')) });
      continue;
    }
    turns.push({ kind: message.role, message, calls: (message.toolCalls || []).map((call) => ({ call, result: results.get(call.id) || null })) });
  }
  return turns;
}

export function tokenLabel(message) {
  const total = (message.promptTokens || 0) + (message.completionTokens || 0);
  if (!total) return '';
  const time = message.durationMs != null ? ` · ${(message.durationMs / 1000).toFixed(1)}s` : '';
  return `${message.promptTokens.toLocaleString()} in · ${message.completionTokens.toLocaleString()} out${time}`;
}

function JsonBlock({ value, label }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div>
      {label && <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-slate-400">{label}</p>}
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[#F1EEEA] bg-[#FBFAF8] px-2.5 py-2 font-mono text-[11.5px] leading-[1.55] text-[#3B4A52]">{text}</pre>
    </div>
  );
}

export function ToolCallCard({ call, result, toolTypes = {}, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const status = result?.status || 'running';
  const [label, tone] = TOOL_STATUS[status] || TOOL_STATUS.running;
  const waitingLabel = result?.jobId ? 'Waiting for the job' : result?.taskId ? 'Waiting for a person' : label;
  const output = parseMaybeJson(result?.content);
  const isSubmit = call.name === 'submit_output';
  const type = toolTypes[call.name];
  const icon = isSubmit ? 'check' : { workflow: 'robot', task: 'human', case: 'briefcase', http: 'api', query: 'database' }[type] || 'bolt';
  return (
    <div className={`rounded-xl border bg-white ${status === 'error' ? 'border-[#F5C9C4]' : 'border-[#ECE8E3]'}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${isSubmit ? 'bg-[#ECF7EF] text-[#1F6B3A]' : 'bg-[#F6F4F1] text-charcoal'}`}><Icon name={icon} className="h-3.5 w-3.5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[12.5px] font-semibold text-ink">{isSubmit ? 'Submitted output' : call.name}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-px text-[11px] font-medium ${tone}`}>{status === 'pending' ? waitingLabel : label}</span>
        <Icon name="chevronDown" className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-[#F1EEEA] px-3 pb-3 pt-2.5">
          <JsonBlock label={isSubmit ? 'Output' : 'Arguments'} value={call.arguments ?? {}} />
          {result && result.content != null && !isSubmit && <JsonBlock label="Result" value={output} />}
          {(result?.jobId || result?.taskId) && (
            <div className="flex flex-wrap gap-3">
              {result.jobId && <Link to={`/jobs/${result.jobId}`} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ember hover:underline"><Icon name="robot" className="h-3.5 w-3.5" />Open job</Link>}
              {result.taskId && <Link to={`/tasks/${result.taskId}`} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ember hover:underline"><Icon name="tasks" className="h-3.5 w-3.5" />{status === 'pending' ? 'Answer in Action Center' : 'Open task'}</Link>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Working({ status, pending }) {
  const text = status === 'WAITING' ? (pending?.taskId ? 'Waiting for a person in Action Center…' : 'Waiting for the workflow to finish…') : 'Thinking…';
  return (
    <div className="flex items-center gap-2.5 pl-10 text-[12.5px] text-slate-500" role="status">
      <span className="flex gap-1" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#5B7BE0] motion-reduce:animate-none" style={{ animationDelay: `${i * 160}ms` }} />)}</span>
      {text}
    </div>
  );
}

export default function AgentTranscript({ run, showSystem = false, toolTypes = {}, compact = false, emptyText = 'Send a message to start.' }) {
  const turns = buildTurns(run?.messages || []);
  const visible = turns.filter((turn) => showSystem || turn.kind !== 'system');
  const active = run && ['RUNNING', 'WAITING'].includes(run.status);
  const pending = (run?.messages || []).find((m) => m.role === 'tool' && m.status === 'pending');
  if (!visible.length && !active) return <p className="px-2 py-10 text-center text-[13px] text-slate-400">{emptyText}</p>;
  return (
    <ol className={`space-y-4 ${compact ? 'text-[13px]' : 'text-[13.5px]'}`} aria-label="Conversation">
      {visible.map(({ kind, message, calls, input }) => {
        if (kind === 'system') {
          return (
            <li key={message.id}>
              <details className="group rounded-xl border border-dashed border-[#E2DCD5] bg-[#FCFBFA] px-3 py-2">
                <summary className="cursor-pointer list-none text-[12px] font-semibold text-slate-500"><span className="inline-flex items-center gap-1.5"><Icon name="settings" className="h-3.5 w-3.5" />System instructions</span></summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-[12.5px] leading-5 text-slate-600">{message.content}</pre>
              </details>
            </li>
          );
        }
        if (kind === 'input') {
          return (
            <li key={message.id} className="rounded-xl border border-[#ECE8E3] bg-[#FCFBFA] p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500"><Icon name="arrowUpRight" className="h-3.5 w-3.5" />Task input</p>
              <JsonBlock value={input} />
            </li>
          );
        }
        if (kind === 'user') {
          return (
            <li key={message.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-[#F6D5C8] bg-[#FFF5F0] px-3.5 py-2 leading-6 text-ink">{message.content}</div>
            </li>
          );
        }
        return (
          <li key={message.id} className="flex gap-2.5">
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#EEF4FF] text-[#3550B5]"><Icon name="sparkle" className="h-3.5 w-3.5" /></span>
            <div className="min-w-0 flex-1 space-y-2">
              {message.content && <div className="whitespace-pre-wrap break-words leading-6 text-ink">{message.content}</div>}
              {calls.map(({ call, result }) => <ToolCallCard key={call.id} call={call} result={result} toolTypes={toolTypes} defaultOpen={result?.status === 'pending' || call.name === 'submit_output'} />)}
              {tokenLabel(message) && <p className="text-[11px] tabular-nums text-slate-400">{tokenLabel(message)}</p>}
            </div>
          </li>
        );
      })}
      {active && <li><Working status={run.status} pending={pending} /></li>}
      {run?.status === 'FAILED' && run.error && (
        <li className="flex items-start gap-2 rounded-xl border border-[#F5C9C4] bg-[#FEF3F2] px-3 py-2.5 text-[13px] text-[#A8261B]" role="alert"><Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-words">{run.error}</span></li>
      )}
      {run?.status === 'CANCELLED' && <li className="text-center text-[12px] text-slate-400">Run cancelled</li>}
    </ol>
  );
}
