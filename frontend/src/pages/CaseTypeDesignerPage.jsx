import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, currentUser } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import { StatusPill } from './HomePage.jsx';
import { timeAgo } from '../layouts/CloudLayout.jsx';
import { KindTile, TASK_KIND } from '../components/CaseBits.jsx';
import {
  CONDITION_OPS, ESCALATION_ACTIONS, ESCALATION_LABELS, FIELD_TYPES, PRIORITIES, TASK_KINDS, WORKER_ROLES,
  conditionPaths, describeCondition, newEscalation, newField, newStage, newTask, validateCaseTypeDefinition,
} from '../lib/caseDefinition.js';

// Case type designer: a stage lane editor (stages left to right, tasks inside each stage with
// pickers for workflows, flows, agents, and people), a fields schema editor, case SLA and
// escalation settings, and who may work the cases. Validates like publish does, saves a draft,
// and publishes versions.

const canWrite = (role) => ['administrator', 'project_manager', 'automation_developer'].includes(role);
export const inputBase = 'rounded-lg border border-[#E2DCD5] bg-white px-2.5 py-1.5 text-[13px] text-ink placeholder:text-slate-400 focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:bg-[#FAF9F7] disabled:text-slate-500';
const input = `${inputBase} w-full`;
const secondaryBtn = 'u-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const primaryBtn = 'u-btn-primary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-60';
const ghostBtn = 'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-semibold text-slate-500 hover:bg-[#F6F4F1] hover:text-ink';
const iconBtn = 'grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-[#F6F4F1] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40';
export const ROLE_LABELS = { administrator: 'Administrators', project_manager: 'Project managers', automation_developer: 'Automation developers', operator: 'Operators' };
const OP_LABELS = { eq: 'is', neq: 'is not', gt: 'is more than', lt: 'is less than', contains: 'contains', empty: 'is empty', not_empty: 'is filled in', truthy: 'is set', falsy: 'is not set' };
const VALUE_OPS = ['eq', 'neq', 'gt', 'lt', 'contains'];
const TYPE_LABELS = { text: 'Text', textarea: 'Long text', number: 'Number', date: 'Date', select: 'Choice', checkbox: 'Checkbox', email: 'Email' };
const TABS = [['stages', 'Stages'], ['fields', 'Fields'], ['sla', 'SLA & escalation'], ['settings', 'Settings']];

export const slug = (text) => {
  const words = String(text || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const name = words.map((word, index) => (index ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase())).join('');
  return /^[A-Za-z]/.test(name) ? name.slice(0, 63) : `field${name}`.slice(0, 63);
};

/** Problems for one stage / task / field / scope. */
export function issuesFor(items, ref) {
  return items.filter((item) => Object.entries(ref).every(([key, value]) => item[key] === value));
}

function Field({ label, hint, issues = [], children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-slate-600">{label}</span>
      {children}
      {issues.map((item, index) => <span key={index} className="mt-1 block text-[11.5px] leading-4 text-danger">{item.message}</span>)}
      {hint && !issues.length && <span className="mt-1 block text-[11.5px] leading-4 text-slate-400">{hint}</span>}
    </label>
  );
}

function Toggle({ checked, onChange, disabled, children, hint }) {
  return (
    <label className={`flex items-start gap-2.5 text-[13px] text-ink ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={Boolean(checked)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        <span className="h-[18px] w-8 rounded-full bg-[#E2DCD5] transition-colors peer-checked:bg-ember peer-focus-visible:ring-2 peer-focus-visible:ring-brand/30" />
        <span className="absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-3.5" />
      </span>
      <span>{children}{hint && <span className="block text-[11.5px] leading-4 text-slate-400">{hint}</span>}</span>
    </label>
  );
}

function PanelSection({ title, description, children, action }) {
  return (
    <section className="border-b border-[#F1EEEA] px-4 py-4 last:border-b-0">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500">{title}</h3>
          {description && <p className="mt-0.5 text-[12px] leading-4 text-slate-400">{description}</p>}
        </div>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Key/value input mapping with template suggestions. */
export function MappingRows({ rows = [], onChange, disabled, suggestions = [], keyPlaceholder = 'input', addLabel = '+ Add input' }) {
  const listId = useRef(`map-${Math.random().toString(36).slice(2)}`).current;
  const set = (index, patch) => onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-1.5">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <input aria-label="Input name" className={`${inputBase} w-[38%] shrink-0 font-mono text-[12.5px]`} disabled={disabled} value={row.key || ''} placeholder={keyPlaceholder} onChange={(event) => set(index, { key: event.target.value })} />
          <input aria-label="Value" list={listId} className={`${inputBase} min-w-0 flex-1 font-mono text-[12.5px]`} disabled={disabled} value={row.value ?? ''} placeholder="{{fields.name}}" onChange={(event) => set(index, { value: event.target.value })} />
          {!disabled && <button type="button" className={iconBtn} aria-label="Remove input" onClick={() => onChange(rows.filter((_, position) => position !== index))}><Icon name="close" className="h-3.5 w-3.5" /></button>}
        </div>
      ))}
      <datalist id={listId}>{suggestions.map((item) => <option key={item} value={item} />)}</datalist>
      {!disabled && <button type="button" className={ghostBtn} onClick={() => onChange([...rows, { key: '', value: '' }])}>{addLabel}</button>}
    </div>
  );
}

/** Conditions (all must hold) over case fields and task results. */
export function ConditionList({ conditions = [], paths, onChange, disabled, empty }) {
  const set = (index, patch) => onChange(conditions.map((item, position) => (position === index ? { ...item, ...patch } : item)));
  const groups = [...new Set(paths.map((item) => item.group))];
  return (
    <div className="space-y-1.5">
      {!conditions.length && <p className="text-[12px] text-slate-400">{empty}</p>}
      {conditions.map((condition, index) => (
        <div key={index} className="rounded-lg border border-[#ECE8E3] bg-[#FCFBFA] p-2">
          <div className="flex items-center gap-1.5">
            {index > 0 && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">and</span>}
            <select aria-label="Condition field" className={`${inputBase} min-w-0 flex-1`} disabled={disabled} value={condition.path || ''} onChange={(event) => set(index, { path: event.target.value })}>
              <option value="">Choose…</option>
              {groups.map((group) => <optgroup key={group} label={group}>{paths.filter((item) => item.group === group).map((item) => <option key={item.path} value={item.path}>{item.label}</option>)}</optgroup>)}
              {condition.path && !paths.some((item) => item.path === condition.path) && <option value={condition.path}>{condition.path}</option>}
            </select>
            {!disabled && <button type="button" className={iconBtn} aria-label="Remove condition" onClick={() => onChange(conditions.filter((_, position) => position !== index))}><Icon name="close" className="h-3.5 w-3.5" /></button>}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <select aria-label="Operator" className={`${inputBase} w-[46%] shrink-0`} disabled={disabled} value={condition.op || 'truthy'} onChange={(event) => set(index, { op: event.target.value })}>
              {CONDITION_OPS.map((op) => <option key={op} value={op}>{OP_LABELS[op]}</option>)}
            </select>
            {VALUE_OPS.includes(condition.op) && <input aria-label="Value" className={`${inputBase} min-w-0 flex-1`} disabled={disabled} value={condition.value ?? ''} placeholder={String(condition.path || '').endsWith('.outcome') ? 'approve' : 'value'} onChange={(event) => set(index, { value: event.target.value })} />}
          </div>
        </div>
      ))}
      {!disabled && <button type="button" className={ghostBtn} onClick={() => onChange([...conditions, { path: '', op: 'not_empty', value: '' }])}>+ Add condition</button>}
    </div>
  );
}

export function SlaEditor({ sla, onChange, disabled, label = 'Has an SLA', issues = [] }) {
  return (
    <div className="space-y-2.5">
      <Toggle checked={Boolean(sla)} disabled={disabled} onChange={(on) => onChange(on ? { hours: 24, warnAt: 75 } : null)} hint={sla ? 'Marked at risk at the warning threshold and breached at the deadline. Time on hold does not count.' : 'No deadline.'}>{label}</Toggle>
      {sla && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Deadline (hours)" issues={issues.filter((item) => item.field === 'sla')}><input type="number" min={0.25} step={0.25} className={input} disabled={disabled} value={sla.hours ?? ''} onChange={(event) => onChange({ ...sla, hours: event.target.value === '' ? '' : Number(event.target.value) })} /></Field>
          <Field label="Warn at (% used)" issues={issues.filter((item) => item.field === 'warnAt')}><input type="number" min={1} max={99} className={input} disabled={disabled} value={sla.warnAt ?? 75} onChange={(event) => onChange({ ...sla, warnAt: Number(event.target.value) })} /></Field>
        </div>
      )}
    </div>
  );
}

export function EscalationList({ rules = [], onChange, disabled, people = [], issues = [] }) {
  const set = (index, patch) => onChange(rules.map((rule, position) => (position === index ? { ...rule, ...patch } : rule)));
  const setConfig = (index, patch) => set(index, { config: { ...(rules[index].config || {}), ...patch } });
  return (
    <div className="space-y-2">
      {!rules.length && <p className="text-[12px] text-slate-400">No escalation. The project is still notified when the SLA is at risk or breached.</p>}
      {rules.map((rule, index) => {
        const problems = issues.filter((item) => item.escalationId === rule.id);
        return (
          <div key={rule.id || index} className={`rounded-lg border p-2.5 ${problems.length ? 'border-[#F5C9C4] bg-[#FFFAF9]' : 'border-[#ECE8E3] bg-[#FCFBFA]'}`}>
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] text-slate-500">When</span>
              <select aria-label="When" className={`${inputBase} w-[112px] shrink-0`} disabled={disabled} value={rule.when} onChange={(event) => set(index, { when: event.target.value })}>
                <option value="at_risk">at risk</option>
                <option value="breached">breached</option>
              </select>
              <select aria-label="Escalation action" className={`${inputBase} min-w-0 flex-1`} disabled={disabled} value={rule.action} onChange={(event) => set(index, { action: event.target.value, config: {} })}>
                {ESCALATION_ACTIONS.map((action) => <option key={action} value={action}>{ESCALATION_LABELS[action]}</option>)}
              </select>
              {!disabled && <button type="button" className={iconBtn} aria-label="Remove escalation" onClick={() => onChange(rules.filter((_, position) => position !== index))}><Icon name="trash" className="h-3.5 w-3.5" /></button>}
            </div>
            <div className="mt-2">
              {rule.action === 'notify' && <input aria-label="Message" className={input} disabled={disabled} value={rule.config?.message || ''} placeholder="{{case.reference}} needs attention" onChange={(event) => setConfig(index, { message: event.target.value })} />}
              {rule.action === 'reassign' && (
                <select aria-label="Reassign to" className={input} disabled={disabled} value={rule.config?.userId || ''} onChange={(event) => setConfig(index, { userId: event.target.value })}>
                  <option value="">Choose a person…</option>
                  {people.map((person) => <option key={person.id} value={person.id}>{person.name || person.email}</option>)}
                </select>
              )}
              {rule.action === 'raise_priority' && (
                <select aria-label="Raise priority to" className={input} disabled={disabled} value={rule.config?.priority || ''} onChange={(event) => setConfig(index, { priority: event.target.value })}>
                  <option value="">One level up</option>
                  {PRIORITIES.map((item) => <option key={item} value={item}>To {item}</option>)}
                </select>
              )}
              {rule.action === 'create_task' && (
                <div className="grid grid-cols-[1fr_150px] gap-1.5">
                  <input aria-label="Task title" className={input} disabled={disabled} value={rule.config?.title || ''} placeholder="Overdue: {{case.reference}}" onChange={(event) => setConfig(index, { title: event.target.value })} />
                  <select aria-label="Task for" className={input} disabled={disabled} value={rule.config?.assignedRole || ''} onChange={(event) => setConfig(index, { assignedRole: event.target.value })}>
                    <option value="">Anyone</option>
                    {WORKER_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                  </select>
                </div>
              )}
            </div>
            {problems.map((item, position) => <p key={position} className="mt-1.5 text-[11.5px] text-danger">{item.message}</p>)}
          </div>
        );
      })}
      {!disabled && <button type="button" className={ghostBtn} onClick={() => onChange([...rules, newEscalation(rules)])}>+ Add escalation</button>}
    </div>
  );
}

/** Schema rows: label, name, type, required, options. Used for case fields and task forms. */
export function SchemaEditor({ fields = [], onChange, disabled, issues = [], addLabel = '+ Add field', compact = false }) {
  const set = (index, patch) => onChange(fields.map((field, position) => (position === index ? { ...field, ...patch } : field)));
  const move = (index, delta) => {
    const next = [...fields];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {fields.map((field, index) => {
        const problems = issues.filter((item) => item.field === field.name);
        return (
          <div key={index} className={`rounded-lg border bg-white p-2.5 ${problems.length ? 'border-[#F5C9C4]' : 'border-[#ECE8E3]'}`}>
            <div className={`grid items-end gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_132px_auto]'}`}>
              <Field label="Label"><input className={input} disabled={disabled} value={field.label || ''} onChange={(event) => set(index, { label: event.target.value, ...(field.autoName !== false && (!field.name || field.name === slug(field.label) || /^field\d+$/.test(field.name)) ? { name: slug(event.target.value) } : {}) })} /></Field>
              <Field label="Name"><input className={`${input} font-mono text-[12.5px]`} disabled={disabled} value={field.name || ''} onChange={(event) => set(index, { name: event.target.value.replace(/[^A-Za-z0-9_]/g, ''), autoName: false })} /></Field>
              <Field label="Type">
                <select className={input} disabled={disabled} value={field.type} onChange={(event) => set(index, { type: event.target.value, ...(event.target.value === 'select' && !field.options?.length ? { options: ['Option 1', 'Option 2'] } : {}) })}>
                  {FIELD_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
                </select>
              </Field>
              <div className={`flex items-center gap-1 pb-1 ${compact ? 'col-span-2 justify-between' : ''}`}>
                <label className="mr-1 flex items-center gap-1.5 text-[12.5px] text-slate-600"><input type="checkbox" className="accent-[#F25A1E]" disabled={disabled} checked={Boolean(field.required)} onChange={(event) => set(index, { required: event.target.checked })} />Required</label>
                {!disabled && (
                  <span className="flex">
                    <button type="button" className={iconBtn} aria-label="Move field up" disabled={index === 0} onClick={() => move(index, -1)}><Icon name="arrowUp" className="h-3.5 w-3.5" /></button>
                    <button type="button" className={iconBtn} aria-label="Move field down" disabled={index === fields.length - 1} onClick={() => move(index, 1)}><Icon name="arrowDown" className="h-3.5 w-3.5" /></button>
                    <button type="button" className={`${iconBtn} hover:!text-danger`} aria-label={`Delete field ${field.label || field.name}`} onClick={() => onChange(fields.filter((_, position) => position !== index))}><Icon name="trash" className="h-3.5 w-3.5" /></button>
                  </span>
                )}
              </div>
            </div>
            {field.type === 'select' && (
              <div className="mt-2"><Field label="Options" hint="Comma separated"><input className={input} disabled={disabled} value={(field.options || []).join(', ')} onChange={(event) => set(index, { options: event.target.value.split(',').map((item) => item.trim()).filter((item, position, list) => item || position === list.length - 1) })} /></Field></div>
            )}
            {problems.map((item, position) => <p key={position} className="mt-1.5 text-[11.5px] text-danger">{item.message}</p>)}
          </div>
        );
      })}
      {!disabled && <button type="button" className={ghostBtn} onClick={() => onChange([...fields, newField(fields)])}>{addLabel}</button>}
    </div>
  );
}

function slaText(sla) {
  if (!sla) return 'No SLA';
  const hours = Number(sla.hours);
  const text = hours >= 48 && hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;
  return `SLA ${text} · warn ${sla.warnAt ?? 75}%`;
}

function taskTarget(task, lookups) {
  const config = task.config || {};
  if (task.kind === 'workflow') return lookups.workflows.find((item) => item.id === config.workflowId)?.name || 'Choose a workflow';
  if (task.kind === 'flow') return lookups.flows.find((item) => item.id === config.flowId)?.name || 'Choose a flow';
  if (task.kind === 'agent') return lookups.agents.find((item) => item.id === config.agentId)?.name || 'Choose an agent';
  const person = lookups.people.find((item) => item.id === config.assigneeUserId);
  return person ? `For ${person.name || person.email}` : config.assignedRole ? `For ${ROLE_LABELS[config.assignedRole]}` : 'Action Center · anyone';
}

function AddTaskMenu({ onAdd, align = 'left' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#D7D2CB] px-3 py-2 text-[12.5px] font-semibold text-slate-500 hover:border-ember hover:bg-[#FFF8F4] hover:text-ember" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="plus" className="h-3.5 w-3.5" />Add task
      </button>
      {open && (
        <div className={`absolute z-30 mt-1 w-[240px] rounded-xl border border-[#ECE8E3] bg-white p-1.5 shadow-[0_12px_32px_rgba(16,24,40,0.14)] ${align === 'right' ? 'right-0' : 'left-0'}`} role="menu">
          {TASK_KINDS.map((kind) => (
            <button key={kind} type="button" role="menuitem" className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-[#F6F4F1]" onClick={() => { onAdd(kind); setOpen(false); }}>
              <KindTile kind={kind} size="h-7 w-7" iconSize="h-3.5 w-3.5" />
              <span><span className="block text-[13px] font-semibold text-ink">{TASK_KIND[kind].label}</span><span className="block text-[11.5px] text-slate-500">{{ human: 'Approval or form in Action Center', workflow: 'Run a published workflow', flow: 'Run a published flow', agent: 'Run a published agent' }[kind]}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StageLane({ stage, index, count, definition, lookups, selected, issues, editable, onSelect, onMove, onDelete, onAddTask, onMoveTask }) {
  const stageIssues = issues.filter((item) => item.stageId === stage.id);
  const active = selected?.stageId === stage.id && !selected.taskId;
  const last = index === count - 1;
  return (
    <div className={`flex w-[284px] shrink-0 flex-col rounded-2xl border bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${active ? 'border-ember ring-2 ring-ember/15' : stageIssues.length ? 'border-[#F5C9C4]' : 'border-[#ECE8E3]'}`}>
      <button type="button" className="group flex items-start gap-2.5 rounded-t-2xl px-3.5 pb-2.5 pt-3 text-left hover:bg-[#FCFBFA]" onClick={() => onSelect({ stageId: stage.id })} aria-label={`Stage ${stage.name}`}>
        <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11.5px] font-bold ${last ? 'bg-[#ECF7EF] text-[#1F6B3A]' : 'bg-[#FFF1EC] text-ember'}`}>{last ? <Icon name="check" className="h-3 w-3" strokeWidth={2.6} /> : index + 1}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-ink">{stage.name || 'Untitled stage'}</span>
          <span className="mt-1 flex flex-wrap gap-1">
            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-medium ${stage.sla ? 'bg-[#F2FAF4] text-[#1F6B3A]' : 'bg-[#F6F4F1] text-slate-500'}`}><Icon name="clock" className="h-3 w-3" />{slaText(stage.sla)}</span>
            {stage.allowSkip && <span className="rounded-full bg-[#F6F4F1] px-1.5 py-px text-[11px] font-medium text-slate-500">Skippable</span>}
            {(stage.escalations || []).length > 0 && <span className="rounded-full bg-[#FDF5E6] px-1.5 py-px text-[11px] font-medium text-[#8A5A0B]">{stage.escalations.length} escalation{stage.escalations.length === 1 ? '' : 's'}</span>}
          </span>
        </span>
        {stageIssues.length > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#FDEEEC] px-1 text-[11px] font-bold text-[#A8261B]" title={stageIssues.map((item) => item.message).join('\n')}>{stageIssues.length}</span>}
      </button>
      {(stage.entryConditions || []).length > 0 && (
        <p className="mx-3.5 mb-2 rounded-md bg-[#F6F4F1] px-2 py-1 text-[11.5px] leading-4 text-slate-600"><span className="font-semibold">Runs only if</span> {stage.entryConditions.map((item) => describeCondition(item, definition)).join(' and ')}</p>
      )}
      <div className="flex min-h-[80px] flex-1 flex-col gap-2 border-t border-[#F1EEEA] bg-[#FCFBFA] px-2.5 py-2.5">
        {(stage.tasks || []).map((task, position) => {
          const taskActive = selected?.taskId === task.id;
          const taskIssues = issues.filter((item) => item.taskId === task.id);
          return (
            <div key={task.id} className={`group relative rounded-xl border bg-white transition-shadow ${taskActive ? 'border-ember ring-2 ring-ember/15' : taskIssues.length ? 'border-[#F5C9C4]' : 'border-[#ECE8E3] hover:shadow-[0_2px_8px_rgba(16,24,40,0.06)]'}`}>
              <button type="button" className="flex w-full items-start gap-2.5 p-2.5 text-left" onClick={() => onSelect({ stageId: stage.id, taskId: task.id })} aria-label={`Task ${task.name}`}>
                <KindTile kind={task.kind} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{task.name || 'Untitled task'}</span>
                  <span className={`block truncate text-[11.5px] ${taskIssues.length ? 'text-danger' : 'text-slate-500'}`}>{taskIssues.length ? taskIssues[0].message.split(': ').slice(1).join(': ') || taskIssues[0].message : taskTarget(task, lookups)}</span>
                  <span className="mt-1.5 flex gap-1">
                    <span className={`rounded px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide ${task.required ? 'bg-[#FFF1EC] text-ember' : 'bg-[#F6F4F1] text-slate-500'}`}>{task.required ? 'Required' : 'Optional'}</span>
                    {!task.auto && <span className="rounded bg-[#F6F4F1] px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">Manual start</span>}
                  </span>
                </span>
              </button>
              {editable && (
                <span className="absolute right-1.5 top-1.5 hidden gap-0.5 rounded-md bg-white group-hover:flex">
                  <button type="button" className={iconBtn} aria-label="Move task up" disabled={position === 0} onClick={() => onMoveTask(stage.id, position, -1)}><Icon name="arrowUp" className="h-3 w-3" /></button>
                  <button type="button" className={iconBtn} aria-label="Move task down" disabled={position === stage.tasks.length - 1} onClick={() => onMoveTask(stage.id, position, 1)}><Icon name="arrowDown" className="h-3 w-3" /></button>
                </span>
              )}
            </div>
          );
        })}
        {!(stage.tasks || []).length && <p className="px-1 py-2 text-center text-[12px] text-slate-400">{last ? 'Final stage. Cases resolve when they reach it and its tasks are done.' : 'No tasks yet.'}</p>}
        {editable && <AddTaskMenu onAdd={(kind) => onAddTask(stage.id, kind)} />}
      </div>
      {((stage.exitConditions || []).length > 0 || editable) && (
        <div className="flex items-center gap-1 border-t border-[#F1EEEA] px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate px-1 text-[11.5px] text-slate-500" title={(stage.exitConditions || []).map((item) => describeCondition(item, definition)).join(' and ')}>
            {(stage.exitConditions || []).length ? <><span className="font-semibold text-slate-600">Done when</span> {stage.exitConditions.map((item) => describeCondition(item, definition)).join(' and ')}</> : 'Done when required tasks finish'}
          </span>
          {editable && (
            <>
              <button type="button" className={iconBtn} aria-label={`Move ${stage.name} left`} disabled={index === 0} onClick={() => onMove(index, -1)}><Icon name="arrow" className="h-3.5 w-3.5 rotate-180" /></button>
              <button type="button" className={iconBtn} aria-label={`Move ${stage.name} right`} disabled={last} onClick={() => onMove(index, 1)}><Icon name="arrow" className="h-3.5 w-3.5" /></button>
              <button type="button" className={`${iconBtn} hover:!text-danger`} aria-label={`Delete stage ${stage.name}`} disabled={count <= 1} onClick={() => onDelete(stage.id)}><Icon name="trash" className="h-3.5 w-3.5" /></button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StagePanel({ stage, index, definition, onChange, editable, people, issues }) {
  const paths = conditionPaths(definition, stage.id);
  const entryPaths = conditionPaths(definition, stage.id, { includeCurrent: false });
  const stageIssues = issues.filter((item) => item.stageId === stage.id && !item.taskId);
  return (
    <>
      <PanelSection title="Stage">
        <Field label="Name" issues={stageIssues.filter((item) => item.field === 'name')}><input className={input} disabled={!editable} value={stage.name} onChange={(event) => onChange({ ...stage, name: event.target.value })} /></Field>
        <Toggle checked={stage.allowSkip} disabled={!editable} onChange={(allowSkip) => onChange({ ...stage, allowSkip })} hint="Case workers may move a case past this stage before its tasks are done. Managers can always move cases.">Can be skipped</Toggle>
      </PanelSection>
      <PanelSection title="Entry conditions" description={index === 0 ? 'The first stage always runs.' : 'Skip this stage unless all of these hold when the case arrives.'}>
        {index > 0
          ? <ConditionList conditions={stage.entryConditions} paths={entryPaths} disabled={!editable} empty="Always runs." onChange={(entryConditions) => onChange({ ...stage, entryConditions })} />
          : null}
        {stageIssues.filter((item) => item.field === 'entry').map((item, position) => <p key={position} className="text-[11.5px] text-danger">{item.message}</p>)}
      </PanelSection>
      <PanelSection title="Exit conditions" description="The stage completes when required tasks are done and all of these hold.">
        <ConditionList conditions={stage.exitConditions} paths={paths} disabled={!editable} empty="No extra conditions." onChange={(exitConditions) => onChange({ ...stage, exitConditions })} />
        {stageIssues.filter((item) => item.field === 'exit').map((item, position) => <p key={position} className="text-[11.5px] text-danger">{item.message}</p>)}
      </PanelSection>
      <PanelSection title="Stage SLA">
        <SlaEditor sla={stage.sla} disabled={!editable} issues={stageIssues} label="Stage has an SLA" onChange={(sla) => onChange({ ...stage, sla })} />
        <div>
          <span className="mb-1.5 block text-[12px] font-medium text-slate-600">Escalation</span>
          <EscalationList rules={stage.escalations} people={people} disabled={!editable} issues={stageIssues} onChange={(escalations) => onChange({ ...stage, escalations })} />
        </div>
      </PanelSection>
    </>
  );
}

function TaskPanel({ stage, task, definition, onChange, onDelete, editable, lookups, issues }) {
  const config = task.config || {};
  const setConfig = (patch) => onChange({ ...task, config: { ...config, ...patch } });
  const taskIssues = issues.filter((item) => item.taskId === task.id);
  const at = (field) => taskIssues.filter((item) => item.field === field);
  const suggestions = [
    ...definition.fields.map((field) => `{{fields.${field.name}}}`),
    '{{case.reference}}', '{{case.title}}', '{{case.priority}}', '{{case.id}}',
  ];
  const picker = (list, key, noun, field, empty) => (
    <Field label={noun[0].toUpperCase() + noun.slice(1)} issues={at(field)} hint={list.length ? `Only published ${noun}s run. The stage waits for it to finish.` : empty}>
      <select className={input} disabled={!editable} value={config[key] || ''} onChange={(event) => setConfig({ [key]: event.target.value })}>
        <option value="">Choose a {noun}…</option>
        {list.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== 'published' ? ` (${item.status})` : ''}</option>)}
      </select>
    </Field>
  );
  return (
    <>
      <PanelSection title={TASK_KIND[task.kind]?.label || 'Task'} action={editable && <button type="button" className={`${ghostBtn} hover:!text-danger`} onClick={onDelete}><Icon name="trash" className="h-3.5 w-3.5" />Delete</button>}>
        <Field label="Name" issues={at('name')}><input className={input} disabled={!editable} value={task.name} onChange={(event) => onChange({ ...task, name: event.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Toggle checked={task.required} disabled={!editable} onChange={(required) => onChange({ ...task, required })} hint="Blocks the stage until done">Required</Toggle>
          <Toggle checked={task.auto} disabled={!editable} onChange={(auto) => onChange({ ...task, auto })} hint="Starts when the stage begins">Start automatically</Toggle>
        </div>
        <p className="font-mono text-[11px] text-slate-400">id: {task.id} · in {stage.name}</p>
      </PanelSection>
      {task.kind === 'workflow' && (
        <PanelSection title="Robot" description="Runs as an unattended job. Its output is saved on the case task.">
          {picker(lookups.workflows, 'workflowId', 'workflow', 'workflowId', 'This project has no workflows yet.')}
          <Field label="Inputs" issues={at('inputs')}><MappingRows rows={config.inputs} disabled={!editable} suggestions={suggestions} onChange={(inputs) => setConfig({ inputs })} /></Field>
        </PanelSection>
      )}
      {task.kind === 'flow' && (
        <PanelSection title="Flow" description="Starts a flow run linked to the case.">
          {picker(lookups.flows, 'flowId', 'flow', 'flowId', 'This project has no flows yet.')}
          <Field label="Inputs" issues={at('inputs')}><MappingRows rows={config.inputs} disabled={!editable} suggestions={suggestions} onChange={(inputs) => setConfig({ inputs })} /></Field>
        </PanelSection>
      )}
      {task.kind === 'agent' && (
        <PanelSection title="Agent" description="Starts an agent run linked to the case.">
          {picker(lookups.agents, 'agentId', 'agent', 'agentId', 'This project has no agents yet.')}
          <Field label="Message" issues={at('message')} hint="For conversational agents."><textarea rows={3} className={input} disabled={!editable} value={config.message || ''} placeholder="Check vendor {{fields.vendorName}}" onChange={(event) => setConfig({ message: event.target.value })} /></Field>
          <Field label="Inputs" issues={at('inputs')}><MappingRows rows={config.inputs} disabled={!editable} suggestions={suggestions} onChange={(inputs) => setConfig({ inputs })} /></Field>
        </PanelSection>
      )}
      {task.kind === 'human' && (
        <>
          <PanelSection title="Action Center task" description="Completing it completes this case task; form answers with matching names update case fields.">
            <Field label="Title" issues={at('title')}><input className={input} disabled={!editable} value={config.title || ''} onChange={(event) => setConfig({ title: event.target.value })} /></Field>
            <Field label="Instructions"><textarea rows={2} className={input} disabled={!editable} value={config.description || ''} onChange={(event) => setConfig({ description: event.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Type">
                <select className={input} disabled={!editable} value={config.taskType || 'approval'} onChange={(event) => setConfig({ taskType: event.target.value })}>
                  <option value="approval">Approval</option><option value="form">Form</option><option value="validation">Validation</option>
                </select>
              </Field>
              <Field label="Priority">
                <select className={input} disabled={!editable} value={config.priority || 'medium'} onChange={(event) => setConfig({ priority: event.target.value })}>
                  {PRIORITIES.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
                </select>
              </Field>
              <Field label="Role">
                <select className={input} disabled={!editable} value={config.assignedRole || ''} onChange={(event) => setConfig({ assignedRole: event.target.value })}>
                  <option value="">Anyone</option>
                  {WORKER_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                </select>
              </Field>
              <Field label="Person" issues={at('assigneeUserId')}>
                <select className={input} disabled={!editable} value={config.assigneeUserId || ''} onChange={(event) => setConfig({ assigneeUserId: event.target.value })}>
                  <option value="">Nobody in particular</option>
                  {lookups.people.map((person) => <option key={person.id} value={person.id}>{person.name || person.email}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Due in (hours)" issues={at('dueInHours')} hint="Optional"><input type="number" min={1} className={input} disabled={!editable} value={config.dueInHours ?? ''} onChange={(event) => setConfig({ dueInHours: event.target.value === '' ? null : Number(event.target.value) })} /></Field>
          </PanelSection>
          <PanelSection title="Form fields" description="Shown in the task. Name them like case fields to write answers back.">
            <SchemaEditor compact fields={config.formFields || []} disabled={!editable} addLabel="+ Add form field" onChange={(formFields) => setConfig({ formFields })} />
            {at('formFields').map((item, position) => <p key={position} className="text-[11.5px] text-danger">{item.message}</p>)}
            {editable && definition.fields.some((field) => !(config.formFields || []).some((item) => item.name === field.name)) && (
              <select className={`${input} text-slate-500`} value="" aria-label="Add a case field to the form" onChange={(event) => {
                const field = definition.fields.find((item) => item.name === event.target.value);
                if (field) setConfig({ formFields: [...(config.formFields || []), { name: field.name, label: field.label, type: field.type, required: false, ...(field.options ? { options: field.options } : {}) }] });
              }}>
                <option value="">+ Add a case field to the form…</option>
                {definition.fields.filter((field) => !(config.formFields || []).some((item) => item.name === field.name)).map((field) => <option key={field.name} value={field.name}>{field.label}</option>)}
              </select>
            )}
          </PanelSection>
        </>
      )}
    </>
  );
}

function OverviewPanel({ definition, caseType, validation, onPick }) {
  const tasks = definition.stages.reduce((sum, stage) => sum + (stage.tasks || []).length, 0);
  const slaHours = definition.stages.reduce((sum, stage) => sum + (stage.sla ? Number(stage.sla.hours) || 0 : 0), 0);
  return (
    <>
      <PanelSection title="Case type">
        <dl className="grid grid-cols-2 gap-2 text-[12.5px]">
          {[['Stages', definition.stages.length], ['Tasks', tasks], ['Fields', definition.fields.length], ['Case SLA', definition.sla ? `${definition.sla.hours}h` : 'None'], ['Stage SLAs', slaHours ? `${slaHours}h total` : 'None'], ['Reference', `${caseType.prefix}-0001`]].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-[#F1EEEA] bg-[#FCFBFA] px-2.5 py-2"><dt className="text-[11px] text-slate-500">{label}</dt><dd className="mt-0.5 font-semibold text-ink">{value}</dd></div>
          ))}
        </dl>
        <p className="text-[12.5px] leading-5 text-slate-500">Select a stage or task to edit it. Cases move left to right: a stage completes when its required tasks are done and its exit conditions hold.</p>
      </PanelSection>
      {(validation.errors.length > 0 || validation.warnings.length > 0) && (
        <PanelSection title="To fix">
          <ul className="space-y-1">
            {[...validation.errors.map((item) => ({ ...item, level: 'error' })), ...validation.warnings.map((item) => ({ ...item, level: 'warning' }))].slice(0, 12).map((item, index) => (
              <li key={index}><button type="button" className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] hover:bg-[#F6F4F1]" onClick={() => onPick(item)}>
                <Icon name="alert" className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${item.level === 'error' ? 'text-danger' : 'text-[#B7791F]'}`} /><span className="text-slate-700">{item.message}</span>
              </button></li>
            ))}
          </ul>
        </PanelSection>
      )}
    </>
  );
}

export default function CaseTypeDesignerPage() {
  const { id } = useParams();
  const user = currentUser();
  const editable = canWrite(user?.role);
  const [caseType, setCaseType] = useState(null);
  const [definition, setDefinition] = useState(null);
  const [meta, setMeta] = useState({ name: '', description: '', prefix: '' });
  const [lookups, setLookups] = useState({ workflows: [], flows: [], agents: [], people: [] });
  const [tab, setTab] = useState('stages');
  const [selected, setSelected] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [serverIssues, setServerIssues] = useState([]);
  const [webhook, setWebhook] = useState(null);

  useEffect(() => {
    let alive = true;
    api(`/api/case-types/${id}`).then(async (result) => {
      if (!alive) return;
      const data = result.data;
      setCaseType(data); setDefinition(data.definition); setMeta({ name: data.name, description: data.description || '', prefix: data.prefix });
      setServerIssues(data.validation?.errors || []);
      const get = (path) => api(path).then((value) => value.data).catch(() => []);
      const [workflows, flows, agents] = await Promise.all([
        get(`/api/workflows?projectId=${data.projectId}&limit=100`),
        get(`/api/flows?projectId=${data.projectId}&limit=100`),
        get(`/api/agents?projectId=${data.projectId}&limit=100`),
      ]);
      if (alive) setLookups({ workflows, flows, agents, people: data.people || [] });
    }).catch((err) => setError(err.message));
    return () => { alive = false; };
  }, [id]);

  const maps = useMemo(() => ({
    workflows: new Map(lookups.workflows.map((item) => [item.id, item])),
    flows: new Map(lookups.flows.map((item) => [item.id, item])),
    agents: new Map(lookups.agents.map((item) => [item.id, { ...item, agent_type: item.agentType || item.agent_type }])),
    users: new Set(lookups.people.map((item) => item.id)),
  }), [lookups]);
  const validation = useMemo(() => (definition ? validateCaseTypeDefinition(definition, lookups.workflows.length || lookups.flows.length || lookups.agents.length ? maps : { users: maps.users }) : { errors: [], warnings: [] }), [definition, maps, lookups]);
  const issues = validation.errors;

  const update = useCallback((next) => { setDefinition(next); setDirty(true); setNotice(''); }, []);
  const updateStage = (stageId, stage) => update({ ...definition, stages: definition.stages.map((item) => (item.id === stageId ? stage : item)) });
  const updateTask = (stageId, task) => update({ ...definition, stages: definition.stages.map((item) => (item.id === stageId ? { ...item, tasks: item.tasks.map((entry) => (entry.id === task.id ? task : entry)) } : item)) });

  const addStage = () => {
    const stage = newStage(definition.stages);
    const stages = [...definition.stages];
    stages.splice(Math.max(stages.length - 1, 0), 0, stage); // before the final stage
    update({ ...definition, stages });
    setSelected({ stageId: stage.id });
  };
  const moveStage = (index, delta) => {
    const stages = [...definition.stages];
    const [item] = stages.splice(index, 1);
    stages.splice(index + delta, 0, item);
    if (stages[0].entryConditions?.length) stages[0] = { ...stages[0], entryConditions: [] };
    update({ ...definition, stages });
  };
  const deleteStage = (stageId) => {
    const stage = definition.stages.find((item) => item.id === stageId);
    if (stage.tasks?.length && !window.confirm(`Delete ${stage.name} and its ${stage.tasks.length} task${stage.tasks.length === 1 ? '' : 's'}?`)) return;
    update({ ...definition, stages: definition.stages.filter((item) => item.id !== stageId) });
    setSelected(null);
  };
  const addTask = (stageId, kind) => {
    const task = newTask(kind, definition);
    update({ ...definition, stages: definition.stages.map((item) => (item.id === stageId ? { ...item, tasks: [...(item.tasks || []), task] } : item)) });
    setSelected({ stageId, taskId: task.id });
  };
  const moveTask = (stageId, index, delta) => {
    update({ ...definition, stages: definition.stages.map((item) => {
      if (item.id !== stageId) return item;
      const tasks = [...item.tasks];
      const [task] = tasks.splice(index, 1);
      tasks.splice(index + delta, 0, task);
      return { ...item, tasks };
    }) });
  };
  const deleteTask = (stageId, taskId) => {
    update({ ...definition, stages: definition.stages.map((item) => (item.id === stageId ? { ...item, tasks: item.tasks.filter((task) => task.id !== taskId) } : item)) });
    setSelected({ stageId });
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const patch = {};
      if (meta.name.trim() && meta.name.trim() !== caseType.name) patch.name = meta.name.trim();
      if (meta.description !== (caseType.description || '')) patch.description = meta.description;
      if (meta.prefix && meta.prefix !== caseType.prefix) patch.prefix = meta.prefix;
      if (Object.keys(patch).length) await api(`/api/case-types/${id}`, { method: 'PATCH', body: patch });
      const result = await api(`/api/case-types/${id}/draft`, { method: 'PUT', body: { definition } });
      setCaseType((value) => ({ ...value, ...result.data, people: value.people }));
      setServerIssues(result.data.validation?.errors || []);
      setDirty(false); setNotice('Draft saved');
      return true;
    } catch (err) { setError(err.message); return false; } finally { setSaving(false); }
  };
  const publish = async () => {
    if (issues.length) { setError(`Fix ${issues.length} issue${issues.length === 1 ? '' : 's'} before publishing.`); return; }
    if (dirty && !(await save())) return;
    setSaving(true); setError('');
    try {
      const result = await api(`/api/case-types/${id}/publish`, { method: 'POST' });
      const fresh = await api(`/api/case-types/${id}`).catch(() => null);
      setCaseType((value) => ({ ...value, ...result.data, ...(fresh ? { versions: fresh.data.versions } : {}), people: value.people }));
      setNotice(`Published version ${result.data.versionNumber}. New cases use it; open cases keep their version.`);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const toggleEnabled = async () => {
    try {
      const result = await api(`/api/case-types/${id}/${caseType.status === 'disabled' ? 'enable' : 'disable'}`, { method: 'POST' });
      setCaseType((value) => ({ ...value, ...result.data }));
    } catch (err) { setError(err.message); }
  };
  const rotateWebhook = async () => {
    if (caseType.hasWebhook && !window.confirm('Create a new token? The old one stops working.')) return;
    try {
      const result = await api(`/api/case-types/${id}/webhook-token`, { method: 'POST' });
      setWebhook(result.data); setCaseType((value) => ({ ...value, hasWebhook: true }));
    } catch (err) { setError(err.message); }
  };

  useEffect(() => {
    const onKey = (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); if (dirty && editable) save(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const pickIssue = (item) => {
    if (item.scope === 'fields') setTab('fields');
    else if (item.scope === 'case') setTab('sla');
    else if (item.scope === 'settings') setTab('settings');
    else if (item.stageId) { setTab('stages'); setSelected({ stageId: item.stageId, taskId: item.taskId }); }
  };

  if (error && !caseType) return <div className="p-8"><p className="rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger" role="alert">{error}</p></div>;
  if (!caseType || !definition) return <div className="p-8 text-[14px] text-slate-500">Loading case type…</div>;

  const selectedStage = selected && definition.stages.find((item) => item.id === selected.stageId);
  const selectedTask = selectedStage && selected.taskId && (selectedStage.tasks || []).find((item) => item.id === selected.taskId);
  const settings = definition.settings || {};
  const setSettings = (patch) => update({ ...definition, settings: { ...settings, ...patch } });
  const issueCount = issues.length;
  const warningCount = validation.warnings.length;
  const fieldIssues = issues.filter((item) => item.scope === 'fields');
  const caseIssues = issues.filter((item) => item.scope === 'case');
  const settingIssues = issues.filter((item) => item.scope === 'settings');
  const tabCount = { stages: issues.filter((item) => item.stageId).length, fields: fieldIssues.length, sla: caseIssues.length, settings: settingIssues.length };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-[560px] flex-col bg-[#FAF9F7]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#ECE8E3] bg-white px-4 py-2.5">
        <Link to="/studio?view=cases" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Back to case types"><Icon name="arrow" className="h-4 w-4 rotate-180" /></Link>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#FFF1EB] text-ember"><Icon name="briefcase" className="h-4 w-4" /></span>
        <div className="min-w-0">
          <input aria-label="Case type name" className="w-[280px] max-w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-semibold tracking-tight text-ink hover:border-[#ECE8E3] focus:border-ember focus:outline-none" value={meta.name} disabled={!editable} onChange={(event) => { setMeta({ ...meta, name: event.target.value }); setDirty(true); }} />
          <p className="px-1 text-[11.5px] text-slate-500">{caseType.projectName}{caseType.versionNumber ? ` · v${caseType.versionNumber} published` : ' · not published yet'}{dirty ? ' · unsaved changes' : notice === 'Draft saved' ? ' · draft saved' : ''}</p>
        </div>
        <StatusPill status={caseType.status} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-semibold ${issueCount ? 'border-[#F5C9C4] bg-[#FEF3F2] text-[#A8261B]' : warningCount ? 'border-[#F1DDB4] bg-[#FEF8EC] text-[#8A5A0B]' : 'border-[#D5EBDC] bg-[#F1F9F3] text-[#1F6B3A]'}`} title={[...issues, ...validation.warnings].map((item) => item.message).join('\n')}>
            <Icon name={issueCount ? 'alert' : 'check'} className="h-3.5 w-3.5" />
            {issueCount ? `${issueCount} issue${issueCount === 1 ? '' : 's'}` : warningCount ? `${warningCount} warning${warningCount === 1 ? '' : 's'}` : 'Ready to publish'}
          </span>
          {caseType.status === 'published' && <Link to={`/cases?type=${id}`} className={secondaryBtn}><Icon name="external" className="h-4 w-4" />Open cases</Link>}
          {editable && <button type="button" className={secondaryBtn} disabled={saving || !dirty} onClick={save} title="Ctrl+S">{saving ? 'Saving…' : 'Save draft'}</button>}
          {editable && <button type="button" className={primaryBtn} disabled={saving} onClick={publish}>Publish</button>}
        </div>
      </header>
      {(error || (notice && notice !== 'Draft saved')) && (
        <div className={`flex items-center gap-2 border-b px-4 py-2 text-[13px] ${error ? 'border-[#F5C9C4] bg-[#FEF3F2] text-danger' : 'border-[#D5EBDC] bg-[#F1F9F3] text-[#1F6B3A]'}`} role={error ? 'alert' : 'status'}>
          <Icon name={error ? 'alert' : 'check'} className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{error || notice}</span>
          <button type="button" className="text-[12px] font-semibold opacity-70 hover:opacity-100" onClick={() => { setError(''); setNotice(''); }}>Dismiss</button>
        </div>
      )}
      <div role="tablist" aria-label="Case type sections" className="flex gap-1 border-b border-[#ECE8E3] bg-white px-4">
        {TABS.map(([key, text]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-2 text-[13px] font-semibold ${tab === key ? 'border-ember text-ink' : 'border-transparent text-slate-500 hover:text-ink'}`}>
            {text}{key === 'stages' && <span className="rounded-full bg-[#F6F4F1] px-1.5 text-[11px] text-slate-500">{definition.stages.length}</span>}
            {key === 'fields' && <span className="rounded-full bg-[#F6F4F1] px-1.5 text-[11px] text-slate-500">{definition.fields.length}</span>}
            {tabCount[key] > 0 && <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-label="has issues" />}
          </button>
        ))}
      </div>

      {tab === 'stages' && (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto px-5 py-5" onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
            <div className="flex items-stretch gap-3">
              {definition.stages.map((stage, index) => (
                <div key={stage.id} className="flex items-stretch gap-3">
                  <StageLane stage={stage} index={index} count={definition.stages.length} definition={definition} lookups={lookups} selected={selected} issues={issues} editable={editable}
                    onSelect={setSelected} onMove={moveStage} onDelete={deleteStage} onAddTask={addTask} onMoveTask={moveTask} />
                  {index < definition.stages.length - 1 && <span className="mt-6 flex shrink-0 items-start text-[#D7D2CB]" aria-hidden="true"><Icon name="chevronRight" className="h-5 w-5" /></span>}
                </div>
              ))}
              {editable && (
                <button type="button" className="flex w-[180px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#E2DCD5] text-[13px] font-semibold text-slate-500 hover:border-ember hover:bg-[#FFF8F4] hover:text-ember" onClick={addStage}>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-white shadow-sm"><Icon name="plus" className="h-4 w-4" /></span>Add stage
                </button>
              )}
            </div>
          </div>
          <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-[#ECE8E3] bg-white" aria-label="Properties">
            {selectedTask ? (
              <TaskPanel key={selectedTask.id} stage={selectedStage} task={selectedTask} definition={definition} editable={editable} lookups={lookups} issues={issues}
                onChange={(task) => updateTask(selectedStage.id, task)} onDelete={() => deleteTask(selectedStage.id, selectedTask.id)} />
            ) : selectedStage ? (
              <StagePanel key={selectedStage.id} stage={selectedStage} index={definition.stages.indexOf(selectedStage)} definition={definition} editable={editable} people={lookups.people} issues={issues}
                onChange={(stage) => updateStage(selectedStage.id, stage)} />
            ) : (
              <OverviewPanel definition={definition} caseType={caseType} validation={validation} onPick={pickIssue} />
            )}
          </aside>
        </div>
      )}

      {tab === 'fields' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-[920px]">
            <h2 className="text-[15px] font-semibold text-ink">Case fields</h2>
            <p className="mb-4 mt-0.5 text-[13px] text-slate-500">The data every case carries. Tasks read them as <code className="rounded bg-[#F6F4F1] px-1 font-mono text-[12px]">{'{{fields.name}}'}</code>, conditions check them, and human task answers with the same name write back.</p>
            <SchemaEditor fields={definition.fields} disabled={!editable} issues={fieldIssues} onChange={(fields) => update({ ...definition, fields })} />
          </div>
        </div>
      )}

      {tab === 'sla' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto grid max-w-[1040px] gap-5 lg:grid-cols-[1fr_1fr]">
            <section className="u-card rounded-2xl border border-[#ECE8E3] bg-white p-5">
              <h2 className="text-[15px] font-semibold text-ink">Case SLA</h2>
              <p className="mb-4 mt-0.5 text-[13px] text-slate-500">From opening to resolution. Pauses while the case is on hold.</p>
              <SlaEditor sla={definition.sla} disabled={!editable} issues={caseIssues} label="Cases have a resolution SLA" onChange={(sla) => update({ ...definition, sla })} />
              <h3 className="mb-2 mt-5 text-[13px] font-semibold text-ink">Escalation</h3>
              <EscalationList rules={definition.escalations} people={lookups.people} disabled={!editable} issues={caseIssues} onChange={(escalations) => update({ ...definition, escalations })} />
            </section>
            <section className="u-card rounded-2xl border border-[#ECE8E3] bg-white p-5">
              <h2 className="text-[15px] font-semibold text-ink">Stage SLAs</h2>
              <p className="mb-4 mt-0.5 text-[13px] text-slate-500">Each stage can have its own deadline, measured from when the case enters it.</p>
              <ul className="divide-y divide-[#F1EEEA]">
                {definition.stages.map((stage, index) => (
                  <li key={stage.id} className="flex items-center gap-3 py-2.5">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-[#F6F4F1] text-[11.5px] font-bold text-slate-600">{index + 1}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-ink">{stage.name}</span><span className="text-[12px] text-slate-500">{slaText(stage.sla)}{(stage.escalations || []).length ? ` · ${stage.escalations.length} escalation${stage.escalations.length === 1 ? '' : 's'}` : ''}</span></span>
                    <button type="button" className={ghostBtn} onClick={() => { setTab('stages'); setSelected({ stageId: stage.id }); }}>Edit</button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto grid max-w-[1040px] gap-5 lg:grid-cols-2">
            <section className="u-card space-y-4 rounded-2xl border border-[#ECE8E3] bg-white p-5">
              <h2 className="text-[15px] font-semibold text-ink">General</h2>
              <Field label="Description"><textarea rows={3} className={input} disabled={!editable} value={meta.description} onChange={(event) => { setMeta({ ...meta, description: event.target.value }); setDirty(true); }} /></Field>
              <Field label="Reference prefix" hint={`Cases are numbered ${meta.prefix || 'CASE'}-0001, ${meta.prefix || 'CASE'}-0002, …`}><input className={`${input} font-mono uppercase`} maxLength={8} disabled={!editable} value={meta.prefix} onChange={(event) => { setMeta({ ...meta, prefix: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }); setDirty(true); }} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Default priority" issues={settingIssues.filter((item) => item.field === 'defaultPriority')}>
                  <select className={input} disabled={!editable} value={settings.defaultPriority || 'medium'} onChange={(event) => setSettings({ defaultPriority: event.target.value })}>
                    {PRIORITIES.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
                  </select>
                </Field>
                <Field label="Default owner" hint="Otherwise whoever opens the case" issues={settingIssues.filter((item) => item.field === 'defaultOwnerUserId')}>
                  <select className={input} disabled={!editable} value={settings.defaultOwnerUserId || ''} onChange={(event) => setSettings({ defaultOwnerUserId: event.target.value })}>
                    <option value="">Case creator</option>
                    {lookups.people.map((person) => <option key={person.id} value={person.id}>{person.name || person.email}</option>)}
                  </select>
                </Field>
              </div>
              <div>
                <span className="mb-1.5 block text-[12px] font-medium text-slate-600">Who can open and work cases</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {WORKER_ROLES.map((role) => (
                    <label key={role} className="flex items-center gap-2 rounded-lg border border-[#ECE8E3] px-2.5 py-1.5 text-[13px] text-ink">
                      <input type="checkbox" className="accent-[#F25A1E]" disabled={!editable} checked={(settings.workerRoles || WORKER_ROLES).includes(role)} onChange={(event) => {
                        const current = settings.workerRoles || WORKER_ROLES;
                        setSettings({ workerRoles: event.target.checked ? [...new Set([...current, role])] : current.filter((item) => item !== role) });
                      }} />{ROLE_LABELS[role]}
                    </label>
                  ))}
                </div>
                {settingIssues.filter((item) => item.field === 'workerRoles').map((item, index) => <p key={index} className="mt-1 text-[11.5px] text-danger">{item.message}</p>)}
                <p className="mt-1.5 text-[11.5px] text-slate-400">Project members only. Owners and project managers can always change priority, owner, and move cases.</p>
              </div>
            </section>
            <div className="space-y-5">
              <section className="u-card rounded-2xl border border-[#ECE8E3] bg-white p-5">
                <h2 className="text-[15px] font-semibold text-ink">Open cases by API</h2>
                <p className="mt-0.5 text-[13px] text-slate-500">Other systems can POST JSON to open a case of the published version.</p>
                <pre className="mt-3 overflow-x-auto rounded-lg bg-[#1F1B17] px-3 py-2.5 font-mono text-[11.5px] leading-5 text-[#F6EFE8]">{`POST ${typeof window !== 'undefined' ? window.location.origin : ''}/api/hooks/cases/${id}
X-URAP-Case-Token: <token>
{ "title": "…", "fields": { ${definition.fields.slice(0, 2).map((field) => `"${field.name}": …`).join(', ')} } }`}</pre>
                {webhook && <p className="mt-2 rounded-lg border border-[#F1DDB4] bg-[#FEF8EC] px-3 py-2 text-[12.5px] text-[#8A5A0B]">Copy this token now; it is not shown again: <code className="select-all break-all font-mono text-[12px] text-ink">{webhook.webhookToken}</code></p>}
                {editable && <button type="button" className={`${secondaryBtn} mt-3`} onClick={rotateWebhook}><Icon name="refresh" className="h-4 w-4" />{caseType.hasWebhook ? 'Rotate token' : 'Create token'}</button>}
                <p className="mt-2 text-[11.5px] text-slate-400">Signed-in clients can also POST /api/cases with caseTypeId.</p>
              </section>
              <section className="u-card rounded-2xl border border-[#ECE8E3] bg-white p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[15px] font-semibold text-ink">Versions</h2>
                  {editable && caseType.currentVersionId && <button type="button" className={secondaryBtn} onClick={toggleEnabled}>{caseType.status === 'disabled' ? 'Enable' : 'Disable'}</button>}
                </div>
                {(caseType.versions || []).length ? (
                  <ul className="mt-2 divide-y divide-[#F1EEEA] text-[13px]">
                    {caseType.versions.map((version) => <li key={version.id} className="flex justify-between py-2"><span className="font-semibold text-ink">v{version.versionNumber}</span><span className="text-slate-500">{timeAgo(version.publishedAt)}</span></li>)}
                  </ul>
                ) : <p className="mt-2 text-[13px] text-slate-500">Not published yet.</p>}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
