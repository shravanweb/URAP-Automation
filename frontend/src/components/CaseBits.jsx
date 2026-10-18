import { Icon } from './brand.jsx';
import { formatDuration } from '../lib/caseDefinition.js';

// Small shared pieces for the case pages: status / priority / SLA chips, the stage stepper, task
// kind tiles, and avatars. Pure render helpers so they work in static tests too.

/** API timestamps are UTC 'YYYY-MM-DD HH:MM:SS(.mmm)' strings without a zone. */
export function parseUtc(value) {
  if (!value) return null;
  const text = String(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatWhen(value) {
  const date = parseUtc(value);
  if (!date) return '—';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const CASE_STATUS = {
  open: ['Open', 'bg-[#EAF1FB] text-[#2F5FA8]', 'bg-[#3A75D0]'],
  on_hold: ['On hold', 'bg-[#FDF5E6] text-[#8A5A0B]', 'bg-[#D99A1E]'],
  resolved: ['Resolved', 'bg-[#ECF7EF] text-[#1F6B3A]', 'bg-[#2E9E57]'],
  closed: ['Closed', 'bg-slate-100 text-slate-700', 'bg-slate-500'],
  cancelled: ['Cancelled', 'bg-slate-100 text-slate-500', 'bg-slate-400'],
};

export function CaseStatusChip({ status }) {
  const [label, tone, dot] = CASE_STATUS[status] || [status, 'bg-slate-100 text-slate-700', 'bg-slate-400'];
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}><span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />{label}</span>;
}

const PRIORITY_TONE = {
  critical: 'bg-[#FDEEEC] text-[#A8261B] ring-[#F5C9C4]',
  high: 'bg-[#FFF1EC] text-[#B8320A] ring-[#F8D3C4]',
  medium: 'bg-[#F6F4F1] text-slate-700 ring-[#ECE8E3]',
  low: 'bg-white text-slate-500 ring-[#ECE8E3]',
};

export function PriorityChip({ priority }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium capitalize ring-1 ring-inset ${PRIORITY_TONE[priority] || PRIORITY_TONE.medium}`}>{priority}</span>;
}

/** Countdown text and tone for an SLA timer. */
export function slaSummary({ dueAt, state, status }, now = Date.now()) {
  if (!state || state === 'none' || !dueAt) return null;
  if (state === 'met') return { label: 'Met', tone: 'met', state };
  if (status === 'on_hold') return { label: 'Paused', tone: 'paused', state };
  if (['resolved', 'closed', 'cancelled'].includes(status)) return { label: state === 'breached' ? 'Breached' : 'Stopped', tone: state === 'breached' ? 'breached' : 'paused', state };
  const due = parseUtc(dueAt)?.getTime();
  if (!due) return null;
  const left = due - now;
  if (left <= 0 || state === 'breached') return { label: `Overdue ${formatDuration(Math.max(0, -left))}`, tone: 'breached', state: 'breached' };
  return { label: `${formatDuration(left)} left`, tone: state === 'at_risk' ? 'at_risk' : 'on_track', state };
}

const SLA_TONE = {
  on_track: 'bg-[#F2FAF4] text-[#1F6B3A] ring-[#CDE9D6]',
  at_risk: 'bg-[#FDF5E6] text-[#8A5A0B] ring-[#F1DDB2]',
  breached: 'bg-[#FDEEEC] text-[#A8261B] ring-[#F5C9C4]',
  met: 'bg-[#F2FAF4] text-[#1F6B3A] ring-[#CDE9D6]',
  paused: 'bg-slate-50 text-slate-500 ring-[#ECE8E3]',
};

export function SlaChip({ label = 'SLA', dueAt, state, status, now, compact = false }) {
  const summary = slaSummary({ dueAt, state, status }, now);
  if (!summary) return null;
  const icon = summary.tone === 'breached' ? 'alert' : summary.tone === 'met' ? 'check' : 'clock';
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset ${SLA_TONE[summary.tone]}`} title={dueAt ? `Due ${formatWhen(dueAt)}` : undefined}>
      <Icon name={icon} className="h-3 w-3" />{compact ? summary.label : <><span className="font-semibold">{label}</span><span className="opacity-80">· {summary.label}</span></>}
    </span>
  );
}

/** Worst SLA state of a case (case or stage timer) for list sorting and badges. */
export function worstSla(item) {
  const rank = { breached: 3, at_risk: 2, on_track: 1, met: 0, none: 0 };
  return (rank[item.stageSlaState] || 0) > (rank[item.slaState] || 0) ? 'stage' : 'case';
}

export const TASK_KIND = {
  human: { label: 'Human task', icon: 'human', tone: 'bg-[#F1EEFB] text-[#5B47B8]' },
  workflow: { label: 'Robot (workflow)', icon: 'robot', tone: 'bg-[#FFF1EC] text-[#D63A0C]' },
  flow: { label: 'Flow', icon: 'flow', tone: 'bg-[#EAF1FB] text-[#2F5FA8]' },
  agent: { label: 'Agent', icon: 'agent', tone: 'bg-[#EEF4FF] text-[#3550B5]' },
};

export function KindTile({ kind, size = 'h-8 w-8', iconSize = 'h-4 w-4' }) {
  const meta = TASK_KIND[kind] || { icon: 'bolt', tone: 'bg-slate-100 text-slate-600' };
  return <span className={`u-tile grid shrink-0 place-items-center rounded-lg ${size} ${meta.tone}`}><Icon name={meta.icon} className={iconSize} /></span>;
}

export const TASK_STATUS = {
  not_started: ['Not started', 'bg-slate-100 text-slate-600'],
  in_progress: ['In progress', 'bg-[#EAF1FB] text-[#2F5FA8]'],
  completed: ['Done', 'bg-[#ECF7EF] text-[#1F6B3A]'],
  failed: ['Failed', 'bg-[#FDEEEC] text-[#A8261B]'],
  skipped: ['Skipped', 'bg-slate-100 text-slate-500'],
  cancelled: ['Cancelled', 'bg-slate-100 text-slate-500'],
};

export function TaskStatusChip({ status }) {
  const [label, tone] = TASK_STATUS[status] || [status, 'bg-slate-100 text-slate-600'];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ${tone}`}>{label}</span>;
}

export function Avatar({ name, email, size = 'h-6 w-6 text-[10px]' }) {
  const text = String(name || email || '?').trim();
  const letters = text.includes('@') ? text[0] : text.split(/\s+/).slice(0, 2).map((part) => part[0]).join('');
  return <span className={`inline-grid shrink-0 place-items-center rounded-full bg-[#F1EEEA] font-semibold uppercase text-slate-600 ring-2 ring-white ${size}`} title={email || name}>{letters || '?'}</span>;
}

/**
 * Stage progress: done stages get a check, the current stage an orange ring, later stages are grey.
 * `skipped` is a Set of stage ids the case passed without doing them.
 */
export function StageStepper({ stages, currentStageId, status, skipped = new Set(), compact = false }) {
  const current = stages.findIndex((stage) => stage.id === currentStageId);
  const finished = ['resolved', 'closed'].includes(status);
  return (
    <ol className={`flex w-full items-start ${compact ? 'gap-1' : 'gap-0'}`} aria-label="Stage progress">
      {stages.map((stage, index) => {
        const done = finished ? index <= current : index < current;
        const active = !finished && index === current;
        const passed = skipped.has(stage.id) && index < current;
        const state = done ? (passed ? 'skipped' : 'done') : active ? 'current' : 'upcoming';
        return (
          <li key={stage.id} className="relative flex min-w-0 flex-1 flex-col items-center text-center" aria-current={active ? 'step' : undefined}>
            {index > 0 && <span className={`absolute right-1/2 top-[13px] h-[2px] w-full ${index <= current || finished ? 'bg-[#2E9E57]/60' : 'bg-[#ECE8E3]'}`} aria-hidden="true" />}
            <span className={`relative z-10 grid h-7 w-7 place-items-center rounded-full text-[12px] font-semibold ${
              state === 'done' ? 'bg-[#2E9E57] text-white'
                : state === 'skipped' ? 'bg-white text-slate-400 ring-2 ring-[#D7D2CB]'
                  : state === 'current' ? (status === 'on_hold' ? 'bg-white text-[#8A5A0B] ring-[3px] ring-[#D99A1E]' : 'bg-white text-ember ring-[3px] ring-ember')
                    : 'bg-white text-slate-400 ring-2 ring-[#ECE8E3]'}`}
            >
              {state === 'done' ? <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.6} /> : index + 1}
            </span>
            {!compact && (
              <span className="mt-2 w-full px-1">
                <span className={`block truncate text-[12.5px] font-semibold ${state === 'current' ? 'text-ink' : state === 'upcoming' ? 'text-slate-400' : 'text-slate-600'}`}>{stage.name}</span>
                <span className="block truncate text-[11px] text-slate-400">{state === 'skipped' ? 'Skipped' : state === 'current' ? (status === 'on_hold' ? 'On hold' : 'Current stage') : state === 'done' ? 'Done' : stage.sla ? `SLA ${stage.sla.hours}h` : ' '}</span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const fieldInput = 'w-full rounded-lg border border-[#E2DCD5] bg-white px-2.5 py-1.5 text-[13px] text-ink placeholder:text-slate-400 focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:bg-[#FAF9F7] disabled:text-slate-600';

/** One input for a case field from the case type schema. */
export function CaseFieldInput({ field, value, onChange, disabled, error, id }) {
  const inputId = id || `case-field-${field.name}`;
  let control;
  if (field.type === 'textarea') control = <textarea id={inputId} rows={3} className={fieldInput} disabled={disabled} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />;
  else if (field.type === 'select') {
    control = (
      <select id={inputId} className={fieldInput} disabled={disabled} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose…</option>
        {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  } else if (field.type === 'checkbox') {
    control = <label className="flex items-center gap-2 py-1 text-[13px] text-ink"><input id={inputId} type="checkbox" className="accent-[#F25A1E]" disabled={disabled} checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />Yes</label>;
  } else {
    const type = { number: 'number', date: 'date', email: 'email' }[field.type] || 'text';
    control = <input id={inputId} type={type} className={fieldInput} disabled={disabled} value={value ?? ''} onChange={(event) => onChange(type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)} />;
  }
  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-[12px] font-medium text-slate-600">{field.label}{field.required && <span className="text-ember"> *</span>}</label>
      {control}
      {error ? <p className="mt-1 text-[11.5px] text-danger">{error}</p> : field.help ? <p className="mt-1 text-[11.5px] text-slate-400">{field.help}</p> : null}
    </div>
  );
}

/** Display text for a field value. */
export function fieldText(field, value) {
  if (value === undefined || value === null || value === '') return '—';
  if (field?.type === 'checkbox') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
