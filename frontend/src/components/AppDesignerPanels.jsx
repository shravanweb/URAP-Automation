import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './brand.jsx';
import {
  ACTIONS, APP_ROLES, COLUMN_FORMATS, COMPONENTS, CONDITION_OPS, HTTP_METHODS, SOURCES, TASK_PRIORITIES,
  allComponents, componentActions, newAction, newDataSource,
} from '../lib/appDefinition.js';
import { SPAN_OPTIONS } from '../lib/appDesign.js';

// Panels of the app designer: component palette, pages, data sources and variables, the property
// panel (with binding pickers and the actions editor), and the access dialog.

const inputBase = 'rounded-lg border border-[#E2DCD5] bg-white px-2.5 py-1.5 text-[13px] text-ink placeholder:text-slate-400 focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:bg-[#FAF9F7] disabled:text-slate-500';
export const input = `w-full ${inputBase}`;
const label = 'mb-1 block text-[12px] font-medium text-slate-600';
const PALETTE_GROUPS = ['Layout', 'Inputs', 'Actions', 'Display', 'Data'];
const OP_LABELS = { truthy: 'has a value', falsy: 'is empty or false', eq: 'equals', neq: 'does not equal', gt: 'is greater than', lt: 'is less than', contains: 'contains', empty: 'is empty', not_empty: 'is not empty' };
const ROLE_LABELS = { administrator: 'Administrators', project_manager: 'Project managers', automation_developer: 'Automation developers', operator: 'Operators', viewer: 'Viewers' };
const menuCls = 'absolute z-30 mt-1 rounded-xl border border-[#ECE8E3] bg-white p-1 shadow-[0_16px_40px_-16px_rgba(16,24,40,0.28)]';
const removeBtn = 'grid w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-[#F6F4F1] hover:text-danger';

export function issuesFor(validation, ref) {
  const match = (item) => Object.entries(ref).every(([key, value]) => item[key] === value);
  return { errors: (validation?.errors || []).filter(match), warnings: (validation?.warnings || []).filter(match) };
}

function FieldIssues({ items }) {
  if (!items?.length) return null;
  return <ul className="mt-1 space-y-0.5">{items.map((item, index) => <li key={index} className="text-[11.5px] text-danger">{item.message}</li>)}</ul>;
}

export function Row({ title, children, hint, issues }) {
  return (
    <div>
      {title && <span className={label}>{title}</span>}
      {children}
      {hint && !issues?.length && <p className="mt-1 text-[11.5px] text-slate-400">{hint}</p>}
      <FieldIssues items={issues} />
    </div>
  );
}

export function PanelSection({ title, children, action }) {
  return (
    <section className="border-b border-[#F1EEEA] px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{title}</h3>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function Segmented({ value, options, onChange, disabled, ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex rounded-lg border border-[#E2DCD5] bg-[#FAF9F7] p-0.5">
      {options.map(([key, text]) => (
        <button key={String(key)} type="button" role="radio" aria-checked={value === key} disabled={disabled} onClick={() => onChange(key)} className={`flex-1 rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${value === key ? 'bg-white text-ink shadow-[0_1px_2px_rgba(16,24,40,0.08)]' : 'text-slate-500 hover:text-ink'}`}>{text}</button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, children, disabled }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px] text-ink">
      <span>{children}</span>
      <button type="button" role="switch" aria-label={typeof children === 'string' ? children : undefined} aria-checked={Boolean(checked)} disabled={disabled} onClick={() => onChange(!checked)} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-ember' : 'bg-[#DDD6CF]'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

/** Text input with a binding picker: inserts {{path}} (or the bare path when `raw`). */
export function BindingInput({ value, onChange, suggestions = [], multiline = false, placeholder, disabled, raw = false, ariaLabel, mono = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!box.current?.contains(event.target)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const insert = (path) => {
    const token = raw ? path : `{{${path}}}`;
    const text = String(value ?? '');
    onChange(raw || !text ? token : `${text}${token}`);
    setOpen(false);
  };
  const groups = suggestions.reduce((map, item) => ({ ...map, [item.group]: [...(map[item.group] || []), item] }), {});
  const Control = multiline ? 'textarea' : 'input';
  return (
    <div ref={box} className="relative">
      <Control ref={ref} aria-label={ariaLabel} rows={multiline ? 3 : undefined} className={`${input} pr-9 ${multiline ? 'resize-y leading-5' : ''} ${mono ? 'font-mono text-[12px]' : ''}`} disabled={disabled} placeholder={placeholder} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
      {!disabled && (
        <button type="button" title="Insert a binding" aria-label="Insert a binding" aria-expanded={open} onClick={() => setOpen(!open)} className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md font-mono text-[11px] font-semibold text-slate-400 hover:bg-[#F6F4F1] hover:text-ember">{'{}'}</button>
      )}
      {open && (
        <div className={`${menuCls} right-0 max-h-72 w-[280px] overflow-y-auto`} role="listbox">
          {!suggestions.length && <p className="px-3 py-2 text-[12px] text-slate-500">Add fields, data sources, or variables to bind them.</p>}
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="py-1">
              <p className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-slate-400">{group}</p>
              {items.map((item) => (
                <button key={item.path} type="button" role="option" aria-selected="false" onClick={() => insert(item.path)} className="flex w-full flex-col rounded-md px-2.5 py-1.5 text-left hover:bg-[#F6F4F1]">
                  <span className="font-mono text-[11.5px] text-ink">{item.path}</span>
                  <span className="text-[11.5px] text-slate-500">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** [{ key, value }] editor. `fill` = [{ label, rows }] quick-fill buttons. */
export function MappingEditor({ rows = [], onChange, suggestions, disabled, keyPlaceholder = 'field', valuePlaceholder = '{{inputs.field}}', addLabel = '+ Add field', fill = [] }) {
  const list = rows || [];
  const update = (index, patch) => onChange(list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-1.5">
      {list.map((row, index) => (
        <div key={index} className="flex gap-1.5">
          <input aria-label="Field name" className={`${inputBase} shrink-0 w-[38%] font-mono text-[12px]`} disabled={disabled} value={row.key || ''} placeholder={keyPlaceholder} onChange={(event) => update(index, { key: event.target.value })} />
          <div className="min-w-0 flex-1"><BindingInput ariaLabel={`Value for ${row.key || 'field'}`} value={row.value} onChange={(value) => update(index, { value })} suggestions={suggestions} disabled={disabled} placeholder={valuePlaceholder} /></div>
          {!disabled && <button type="button" className={removeBtn} aria-label={`Remove ${row.key || 'row'}`} onClick={() => onChange(list.filter((_, i) => i !== index))}><Icon name="close" className="h-3.5 w-3.5" /></button>}
        </div>
      ))}
      {!disabled && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <button type="button" className="text-[12px] font-semibold text-ember hover:underline" onClick={() => onChange([...list, { key: '', value: '' }])}>{addLabel}</button>
          {fill.filter((item) => item.rows.length).map((item) => <button key={item.label} type="button" className="text-[12px] font-medium text-slate-500 hover:text-ink" onClick={() => onChange([...list.filter((row) => !item.rows.some((next) => next.key === row.key)), ...item.rows])}>{item.label}</button>)}
        </div>
      )}
    </div>
  );
}

export function Palette({ onAdd, onDragStart, onDragEnd, disabled }) {
  return (
    <div className="space-y-4 p-4">
      <p className="text-[12px] leading-5 text-slate-500">Drag components onto the page, or click to add after the selected one.</p>
      {PALETTE_GROUPS.map((group) => (
        <div key={group}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{group}</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(COMPONENTS).filter(([, meta]) => meta.group === group).map(([type, meta]) => (
              <button
                key={type}
                type="button"
                draggable={!disabled}
                disabled={disabled}
                onDragStart={(event) => { event.dataTransfer.setData('text/plain', `new:${type}`); event.dataTransfer.effectAllowed = 'copy'; onDragStart(type); }}
                onDragEnd={onDragEnd}
                onClick={() => onAdd(type)}
                className="flex cursor-grab items-center gap-2 rounded-lg border border-[#ECE8E3] bg-white px-2.5 py-2 text-left text-[12.5px] font-medium text-ink transition-colors hover:border-[#F3B9A4] hover:bg-[#FFF9F6] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#F6F4F1] text-charcoal"><Icon name={meta.icon} className="h-3.5 w-3.5" /></span>
                <span className="truncate">{meta.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PagesPanel({ definition, pageId, onSelect, onChange, disabled, validation }) {
  const pages = definition.pages;
  const update = (next) => onChange({ ...definition, pages: next });
  const move = (index, delta) => { const next = [...pages]; const [item] = next.splice(index, 1); next.splice(index + delta, 0, item); update(next); };
  const add = () => {
    const ids = pages.map((page) => page.id);
    let n = pages.length + 1;
    while (ids.includes(`page${n}`)) n += 1;
    const page = { id: `page${n}`, name: `Page ${n}`, inputs: [], components: [] };
    update([...pages, page]);
    onSelect(page.id);
  };
  const remove = (page) => {
    const count = allComponents(page).length;
    if (count && !window.confirm(`Delete ${page.name} and its ${count} component${count === 1 ? '' : 's'}?`)) return;
    const next = pages.filter((item) => item.id !== page.id);
    update(next);
    if (pageId === page.id) onSelect(next[0].id);
  };
  const iconBtn = 'grid h-6 w-6 place-items-center rounded text-slate-400 hover:text-ink disabled:opacity-30';
  return (
    <div className="p-4">
      <p className="mb-3 text-[12px] leading-5 text-slate-500">The first page opens first. People switch pages from the app’s navigation, or with a “Go to page” action.</p>
      <ul className="space-y-1">
        {pages.map((page, index) => {
          const problems = issuesFor(validation, { pageId: page.id }).errors.length;
          return (
            <li key={page.id}>
              <div className={`group flex items-center gap-2 rounded-lg border px-2.5 py-2 ${pageId === page.id ? 'border-[#F3B9A4] bg-[#FFF7F3]' : 'border-transparent hover:bg-[#F6F4F1]'}`}>
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onSelect(page.id)} aria-current={pageId === page.id ? 'page' : undefined}>
                  <Icon name="document" className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="truncate text-[13px] font-medium text-ink">{page.name || 'Untitled'}</span>
                  {index === 0 && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-500">Home</span>}
                  {problems > 0 && <span className="shrink-0 rounded-full bg-[#FDEEEC] px-1.5 text-[10.5px] font-semibold text-[#A8261B]">{problems}</span>}
                </button>
                {!disabled && (
                  <span className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <button type="button" className={iconBtn} disabled={index === 0} aria-label={`Move ${page.name} up`} onClick={() => move(index, -1)}><Icon name="arrowUp" className="h-3.5 w-3.5" /></button>
                    <button type="button" className={iconBtn} disabled={index === pages.length - 1} aria-label={`Move ${page.name} down`} onClick={() => move(index, 1)}><Icon name="arrowDown" className="h-3.5 w-3.5" /></button>
                    <button type="button" className={`${iconBtn} hover:text-danger`} disabled={pages.length === 1} aria-label={`Delete ${page.name}`} onClick={() => remove(page)}><Icon name="trash" className="h-3.5 w-3.5" /></button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!disabled && <button type="button" className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ember hover:underline" onClick={add}><Icon name="plus" className="h-3.5 w-3.5" />Add page</button>}
    </div>
  );
}

function filterOptions(type, lookups) {
  return { jobs: lookups.workflows, queue_items: lookups.queues, flow_runs: lookups.flows, agent_runs: lookups.agents }[type] || [];
}

function SourceEditor({ source, update, remove, lookups, disabled, issues, entry, saved, onLoad }) {
  const filter = SOURCES[source.type]?.filter;
  const err = (field) => issues.errors.filter((item) => item.field === field);
  return (
    <div className="space-y-2.5 border-t border-[#F1EEEA] px-3 pb-3 pt-2.5">
      <Row title="Name" issues={err('name')}><input className={`${input} font-mono text-[12px]`} disabled={disabled} value={source.name} onChange={(event) => update({ name: event.target.value })} /></Row>
      {source.type === 'http' ? (
        <>
          <Row title="REST connection" issues={err('connectionId')}>
            <select className={input} disabled={disabled} value={source.config.connectionId || ''} onChange={(event) => update({ config: { connectionId: event.target.value } })}>
              <option value="">Choose a connection…</option>
              {lookups.connections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Row>
          <Row title="GET path" issues={err('path')}><input className={`${input} font-mono text-[12px]`} disabled={disabled} value={source.config.path || ''} placeholder="/invoices" onChange={(event) => update({ config: { path: event.target.value } })} /></Row>
          <Row title="Query parameters"><MappingEditor rows={source.config.query || []} onChange={(query) => update({ config: { query } })} disabled={disabled} suggestions={[]} keyPlaceholder="param" valuePlaceholder="value" addLabel="+ Add parameter" /></Row>
        </>
      ) : (
        <>
          {filter && (
            <Row title={{ workflowId: 'Workflow', queueId: 'Queue', flowId: 'Flow', agentId: 'Agent' }[filter]} issues={err(filter)}>
              <select className={input} disabled={disabled} value={source.config[filter] || ''} onChange={(event) => update({ config: { [filter]: event.target.value } })}>
                <option value="">All in this project</option>
                {filterOptions(source.type, lookups).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Row>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Row title="Status"><input className={input} disabled={disabled} value={source.config.status || ''} placeholder="Any" onChange={(event) => update({ config: { status: event.target.value } })} /></Row>
            <Row title="Rows" issues={err('limit')}><input type="number" min={1} max={100} className={input} disabled={disabled} value={source.config.limit ?? 10} onChange={(event) => update({ config: { limit: Number(event.target.value) } })} /></Row>
          </div>
        </>
      )}
      <Toggle checked={source.autoLoad !== false} disabled={disabled} onChange={(value) => update({ autoLoad: value })}>Load when the app opens</Toggle>
      <div className="flex items-center justify-between gap-2 pt-1">
        <button type="button" className="text-[12px] font-semibold text-ember hover:underline disabled:opacity-50" disabled={issues.errors.length > 0} onClick={() => onLoad(source)}>{saved || disabled ? 'Load now' : 'Save and load'}</button>
        {!disabled && <button type="button" className="text-[12px] font-medium text-slate-500 hover:text-danger" onClick={remove}>Remove</button>}
      </div>
      {entry?.loading && <p className="text-[12px] text-slate-500">Loading…</p>}
      {entry?.error && <p className="text-[12px] text-danger">{entry.error}</p>}
      {entry?.loadedAt && !entry.loading && !entry.error && (
        <p className="rounded-lg bg-[#FBFAF8] px-2.5 py-2 text-[11.5px] leading-5 text-slate-600">{entry.count} row{entry.count === 1 ? '' : 's'}{entry.rows?.[0] && typeof entry.rows[0] === 'object' ? <> · fields: <span className="font-mono">{Object.keys(entry.rows[0]).slice(0, 10).join(', ')}</span></> : null}</p>
      )}
    </div>
  );
}

export function DataPanel({ definition, onChange, lookups, disabled, validation, engine, savedSources, onLoad }) {
  const [open, setOpen] = useState(null);
  const [menu, setMenu] = useState(false);
  const sources = definition.dataSources || [];
  const variables = definition.variables || [];
  const setSources = (next) => onChange({ ...definition, dataSources: next });
  const update = (id, patch) => setSources(sources.map((source) => (source.id === id ? { ...source, ...patch, config: { ...source.config, ...(patch.config || {}) } } : source)));
  const setVariable = (index, patch) => onChange({ ...definition, variables: variables.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  const addButton = (onClick, extra = {}) => <button type="button" className="inline-flex items-center gap-1 text-[12px] font-semibold text-ember hover:underline" onClick={onClick} {...extra}><Icon name="plus" className="h-3.5 w-3.5" />Add</button>;
  return (
    <div>
      <PanelSection title="Data sources" action={!disabled && (
        <div className="relative">
          {addButton(() => setMenu(!menu), { 'aria-expanded': menu, 'aria-label': 'Add data source' })}
          {menu && (
            <div className={`${menuCls} right-0 w-56`} role="menu">
              {Object.keys(SOURCES).map((type) => <button key={type} type="button" role="menuitem" className="block w-full rounded-md px-3 py-2 text-left text-[13px] text-ink hover:bg-[#F6F4F1]" onClick={() => { const source = newDataSource(type, sources); setSources([...sources, source]); setOpen(source.id); setMenu(false); }}>{SOURCES[type].label}</button>)}
            </div>
          )}
        </div>
      )}>
        {!sources.length && <p className="text-[12.5px] leading-5 text-slate-500">Data sources load platform data into the app: recent jobs, queue items, tasks, flow and agent runs, or a REST call. Bind them with <span className="font-mono text-[11.5px]">{'{{data.name.rows}}'}</span>.</p>}
        {sources.map((source) => {
          const issues = issuesFor(validation, { sourceId: source.id });
          const entry = engine?.data?.[source.name];
          const saved = savedSources.some((item) => JSON.stringify(item) === JSON.stringify(source));
          return (
            <div key={source.id} className={`rounded-xl border bg-white ${issues.errors.length ? 'border-[#F5C9C4]' : 'border-[#ECE8E3]'}`}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left" aria-expanded={open === source.id} onClick={() => setOpen(open === source.id ? null : source.id)}>
                <Icon name={source.type === 'http' ? 'api' : 'database'} className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1"><span className="block truncate font-mono text-[12.5px] font-semibold text-ink">{source.name}</span><span className="block text-[11.5px] text-slate-500">{SOURCES[source.type]?.label}{entry?.loadedAt ? ` · ${entry.count} rows` : ''}</span></span>
                {issues.errors.length > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-[#D9382B]" />}
                <Icon name="chevronDown" className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open === source.id ? 'rotate-180' : ''}`} />
              </button>
              {open === source.id && <SourceEditor source={source} update={(patch) => update(source.id, patch)} remove={() => setSources(sources.filter((item) => item.id !== source.id))} lookups={lookups} disabled={disabled} issues={issues} entry={entry} saved={saved} onLoad={onLoad} />}
            </div>
          );
        })}
      </PanelSection>
      <PanelSection title="Variables" action={!disabled && addButton(() => onChange({ ...definition, variables: [...variables, { name: `var${variables.length + 1}`, defaultValue: '' }] }), { 'aria-label': 'Add variable' })}>
        {!variables.length && <p className="text-[12.5px] leading-5 text-slate-500">Variables hold values while the app is open. Actions can store results in them (e.g. a workflow’s output), and components show them with <span className="font-mono text-[11.5px]">{'{{vars.name}}'}</span>.</p>}
        {variables.map((variable, index) => (
          <div key={index} className="flex gap-1.5">
            <input aria-label="Variable name" className={`${inputBase} shrink-0 w-[42%] font-mono text-[12px]`} disabled={disabled} value={variable.name} onChange={(event) => setVariable(index, { name: event.target.value })} />
            <input aria-label="Default value" className={input} disabled={disabled} value={variable.defaultValue ?? ''} placeholder="Default value" onChange={(event) => setVariable(index, { defaultValue: event.target.value })} />
            {!disabled && <button type="button" className={removeBtn} aria-label={`Remove ${variable.name}`} onClick={() => onChange({ ...definition, variables: variables.filter((_, i) => i !== index) })}><Icon name="close" className="h-3.5 w-3.5" /></button>}
          </div>
        ))}
        {(validation?.errors || []).filter((item) => item.field === 'variables').map((item, index) => <p key={index} className="text-[11.5px] text-danger">{item.message}</p>)}
      </PanelSection>
    </div>
  );
}

const SHOWN_ACTION_FIELDS = new Set(['workflowId', 'flowId', 'agentId', 'queueId', 'caseTypeId', 'connectionId', 'path', 'title', 'message', 'name', 'pageId', 'sourceId', 'resultVar']);

function ActionSummary({ action, lookups, definition }) {
  const config = action.config || {};
  const name = (list, id) => list.find((item) => item.id === id)?.name;
  const text = {
    run_workflow: name(lookups.workflows, config.workflowId),
    start_flow: name(lookups.flows, config.flowId),
    run_agent: name(lookups.agents, config.agentId),
    add_queue_item: name(lookups.queues, config.queueId),
    create_task: config.title,
    create_case: name(lookups.caseTypes || [], config.caseTypeId),
    call_http: config.connectionId ? `${config.method || 'GET'} ${config.path || '/'}` : '',
    navigate: definition.pages.find((page) => page.id === config.pageId)?.name,
    set_variable: config.name ? `vars.${config.name}` : '',
    refresh_data: (definition.dataSources || []).find((source) => source.id === config.sourceId)?.name,
    show_toast: config.message,
  }[action.type];
  return <span className="block truncate text-[11.5px] text-slate-500">{text || 'Not set up yet'}{action.resultVar ? ` → vars.${action.resultVar}` : ''}</span>;
}

function ActionConfig({ action, onChange, lookups, definition, page, suggestions, disabled, issues }) {
  const config = action.config || {};
  const set = (patch) => onChange({ ...action, config: { ...config, ...patch } });
  const err = (field) => issues.filter((item) => item.field === field);
  const fieldRows = allComponents(page).filter((item) => COMPONENTS[item.type]?.input && item.props?.name).map((item) => ({ key: item.props.name, value: `{{inputs.${item.props.name}}}` }));
  const mapFields = { label: 'Map form fields', rows: fieldRows };
  const select = (list, field, placeholder, noun) => (
    <Row title={noun} issues={err(field)}>
      <select aria-label={noun} className={input} disabled={disabled} value={config[field] || ''} onChange={(event) => set({ [field]: event.target.value })}>
        <option value="">{placeholder}</option>
        {list.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status && !['published', 'active'].includes(item.status) ? ` (${item.status})` : ''}</option>)}
      </select>
    </Row>
  );
  const priority = <Row title="Priority"><select aria-label="Priority" className={input} disabled={disabled} value={config.priority || 'medium'} onChange={(event) => set({ priority: event.target.value })}>{TASK_PRIORITIES.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></Row>;
  const waitRow = (
    <div className="space-y-2 rounded-lg bg-[#FBFAF8] p-2.5">
      <Toggle checked={config.wait !== false} disabled={disabled} onChange={(wait) => set({ wait })}>Wait for the result</Toggle>
      {config.wait !== false && <Row title="Give up after (seconds)"><input type="number" min={5} max={600} className={input} disabled={disabled} value={config.timeoutSeconds ?? 120} onChange={(event) => set({ timeoutSeconds: Number(event.target.value) })} /></Row>}
    </div>
  );
  const agent = lookups.agents.find((item) => item.id === config.agentId);
  const flow = lookups.flows.find((item) => item.id === config.flowId);
  const targetPage = definition.pages.find((item) => item.id === config.pageId);
  let body = null;
  switch (action.type) {
    case 'run_workflow':
      body = <>{select(lookups.workflows, 'workflowId', 'Choose a workflow…', 'Workflow')}<Row title="Inputs" hint="The workflow reads them as {{input.name}}."><MappingEditor rows={config.inputs} onChange={(inputs) => set({ inputs })} suggestions={suggestions} disabled={disabled} fill={[mapFields]} /></Row>{waitRow}</>;
      break;
    case 'start_flow':
      body = <>{select(lookups.flows, 'flowId', 'Choose a flow…', 'Flow')}<Row title="Inputs" hint="Values become flow variables."><MappingEditor rows={config.inputs} onChange={(inputs) => set({ inputs })} suggestions={suggestions} disabled={disabled} fill={[mapFields, { label: 'Use flow variables', rows: (flow?.definition?.variables || []).map((item) => ({ key: item.name, value: '' })) }]} /></Row>{waitRow}</>;
      break;
    case 'run_agent':
      body = (
        <>
          {select(lookups.agents, 'agentId', 'Choose an agent…', 'Agent')}
          {agent?.agentType === 'conversational'
            ? <Row title="Message" issues={err('message')} hint="The reply is in {{vars.name.reply}}."><BindingInput multiline value={config.message} onChange={(message) => set({ message })} suggestions={suggestions} disabled={disabled} placeholder="Summarise invoice {{inputs.invoiceId}}" /></Row>
            : <Row title="Input" hint="The agent’s output is in {{vars.name.output}}."><MappingEditor rows={config.inputs} onChange={(inputs) => set({ inputs })} suggestions={suggestions} disabled={disabled} fill={[{ label: 'Use agent inputs', rows: (agent?.config?.inputSchema || []).map((item) => ({ key: item.name, value: '' })) }, mapFields]} /></Row>}
          {waitRow}
        </>
      );
      break;
    case 'add_queue_item':
      body = <>{select(lookups.queues, 'queueId', 'Choose a queue…', 'Queue')}<Row title="Reference"><BindingInput value={config.reference} onChange={(reference) => set({ reference })} suggestions={suggestions} disabled={disabled} placeholder="{{inputs.invoiceId}}" /></Row><Row title="Content"><MappingEditor rows={config.content} onChange={(content) => set({ content })} suggestions={suggestions} disabled={disabled} fill={[mapFields]} /></Row>{priority}</>;
      break;
    case 'create_task':
      body = (
        <>
          <Row title="Title" issues={err('title')}><BindingInput value={config.title} onChange={(title) => set({ title })} suggestions={suggestions} disabled={disabled} /></Row>
          <Row title="Details"><BindingInput multiline value={config.description} onChange={(description) => set({ description })} suggestions={suggestions} disabled={disabled} /></Row>
          <div className="grid grid-cols-2 gap-2">
            {priority}
            <Row title="Assign to"><select aria-label="Assign to" className={input} disabled={disabled} value={config.assignedRole || ''} onChange={(event) => set({ assignedRole: event.target.value })}><option value="">Anyone in the project</option>{['project_manager', 'automation_developer', 'operator'].map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></Row>
          </div>
          <Row title="Data shown to the person"><MappingEditor rows={config.data} onChange={(data) => set({ data })} suggestions={suggestions} disabled={disabled} fill={[mapFields]} /></Row>
        </>
      );
      break;
    case 'create_case': {
      const caseType = (lookups.caseTypes || []).find((item) => item.id === config.caseTypeId);
      const caseFields = (caseType?.published?.fields || caseType?.definition?.fields || []).map((item) => ({ key: item.name, value: fieldRows.find((row) => row.key === item.name)?.value || '' }));
      body = (
        <>
          {select(lookups.caseTypes || [], 'caseTypeId', 'Choose a case type…', 'Case type')}
          <Row title="Case title" hint="Leave empty to use the case reference."><BindingInput value={config.title} onChange={(title) => set({ title })} suggestions={suggestions} disabled={disabled} placeholder="Onboard {{inputs.vendorName}}" /></Row>
          <Row title="Case fields" hint="The new case is in {{vars.name.reference}}."><MappingEditor rows={config.fields} onChange={(fields) => set({ fields })} suggestions={suggestions} disabled={disabled} fill={[{ label: 'Use case fields', rows: caseFields }, mapFields]} /></Row>
          <Row title="Priority"><select aria-label="Priority" className={input} disabled={disabled} value={config.priority || ''} onChange={(event) => set({ priority: event.target.value })}><option value="">Case type default</option>{TASK_PRIORITIES.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></Row>
        </>
      );
      break;
    }
    case 'call_http':
      body = (
        <>
          {select(lookups.connections, 'connectionId', 'Choose a REST connection…', 'Connection')}
          <div className="grid grid-cols-[92px_1fr] gap-2">
            <Row title="Method"><select aria-label="Method" className={input} disabled={disabled} value={config.method || 'GET'} onChange={(event) => set({ method: event.target.value })}>{HTTP_METHODS.map((item) => <option key={item}>{item}</option>)}</select></Row>
            <Row title="Path" issues={err('path')}><BindingInput mono value={config.path} onChange={(path) => set({ path })} suggestions={suggestions} disabled={disabled} placeholder="/invoices/{{inputs.id}}" /></Row>
          </div>
          <Row title="Query parameters"><MappingEditor rows={config.query} onChange={(query) => set({ query })} suggestions={suggestions} disabled={disabled} keyPlaceholder="param" addLabel="+ Add parameter" /></Row>
          {['POST', 'PUT', 'PATCH'].includes(config.method) && <Row title="JSON body"><MappingEditor rows={config.body} onChange={(nextBody) => set({ body: nextBody })} suggestions={suggestions} disabled={disabled} fill={[mapFields]} /></Row>}
        </>
      );
      break;
    case 'navigate':
      body = <>{select(definition.pages, 'pageId', 'Choose a page…', 'Page')}{(targetPage?.inputs?.length > 0 || (config.inputs || []).length > 0) && <Row title="Page inputs"><MappingEditor rows={config.inputs} onChange={(inputs) => set({ inputs })} suggestions={suggestions} disabled={disabled} fill={[{ label: 'Use page inputs', rows: (targetPage?.inputs || []).map((name) => ({ key: name, value: '' })) }]} /></Row>}</>;
      break;
    case 'set_variable':
      body = <><Row title="Variable" issues={err('name')}><input aria-label="Variable" className={`${input} font-mono text-[12px]`} disabled={disabled} value={config.name || ''} placeholder="selected" onChange={(event) => set({ name: event.target.value })} /></Row><Row title="Value"><BindingInput value={config.value} onChange={(value) => set({ value })} suggestions={suggestions} disabled={disabled} /></Row></>;
      break;
    case 'refresh_data':
      body = select((definition.dataSources || []).map((item) => ({ id: item.id, name: item.name })), 'sourceId', 'Choose a data source…', 'Data source');
      break;
    case 'show_toast':
      body = <><Row title="Message" issues={err('message')}><BindingInput value={config.message} onChange={(message) => set({ message })} suggestions={suggestions} disabled={disabled} /></Row><Row title="Style"><Segmented value={config.tone || 'success'} options={[['success', 'Success'], ['info', 'Info'], ['error', 'Error']]} onChange={(tone) => set({ tone })} disabled={disabled} ariaLabel="Message style" /></Row></>;
      break;
    default:
      body = null;
  }
  return (
    <div className="space-y-2.5">
      {body}
      {ACTIONS[action.type]?.server && (
        <Row title="Save the result as" issues={err('resultVar')} hint="Optional. Then show it with {{vars.name.output}}.">
          <input aria-label="Save the result as" className={`${input} font-mono text-[12px]`} disabled={disabled} value={action.resultVar || ''} placeholder="result" onChange={(event) => onChange({ ...action, resultVar: event.target.value })} />
        </Row>
      )}
      {issues.filter((item) => !SHOWN_ACTION_FIELDS.has(item.field)).map((item, index) => <p key={index} className="text-[11.5px] text-danger">{item.message}</p>)}
    </div>
  );
}

export function ActionsEditor({ component, event, onChange, lookups, definition, page, suggestions, disabled, validation }) {
  const actions = component.events?.[event] || [];
  const [open, setOpen] = useState(actions[0]?.id || null);
  const [menu, setMenu] = useState(false);
  const set = (next) => onChange({ ...component, events: { ...(component.events || {}), [event]: next } });
  const taken = componentActions(component).map((item) => item.action?.id || item.id);
  const move = (index, delta) => { const next = [...actions]; const [item] = next.splice(index, 1); next.splice(index + delta, 0, item); set(next); };
  const iconBtn = 'grid h-6 w-6 place-items-center rounded text-slate-400 hover:text-ink disabled:opacity-30';
  return (
    <div className="space-y-2">
      {!actions.length && <p className="text-[12.5px] leading-5 text-slate-500">Nothing happens yet. Add the steps to run, in order. If one fails, the rest stop and the person sees the error.</p>}
      {actions.map((action, index) => {
        const issues = [...issuesFor(validation, { componentId: component.id, actionId: action.id }).errors, ...issuesFor(validation, { componentId: component.id, actionId: action.id }).warnings];
        return (
          <div key={action.id} className={`rounded-xl border bg-white ${issues.length ? 'border-[#F5C9C4]' : 'border-[#ECE8E3]'}`}>
            <div className="flex items-center gap-2 px-2.5 py-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#F6F4F1] text-[10.5px] font-semibold text-slate-500">{index + 1}</span>
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open === action.id} onClick={() => setOpen(open === action.id ? null : action.id)}>
                <Icon name={ACTIONS[action.type]?.icon || 'bolt'} className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="min-w-0"><span className="block truncate text-[12.5px] font-semibold text-ink">{ACTIONS[action.type]?.label || action.type}</span><ActionSummary action={action} lookups={lookups} definition={definition} /></span>
              </button>
              {issues.length > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-[#D9382B]" title={`${issues.length} issue(s)`} />}
              {!disabled && (
                <span className="flex shrink-0">
                  <button type="button" className={iconBtn} disabled={index === 0} aria-label="Move action up" onClick={() => move(index, -1)}><Icon name="arrowUp" className="h-3.5 w-3.5" /></button>
                  <button type="button" className={iconBtn} disabled={index === actions.length - 1} aria-label="Move action down" onClick={() => move(index, 1)}><Icon name="arrowDown" className="h-3.5 w-3.5" /></button>
                  <button type="button" className={`${iconBtn} hover:text-danger`} aria-label={`Remove ${ACTIONS[action.type]?.label}`} onClick={() => set(actions.filter((item) => item.id !== action.id))}><Icon name="trash" className="h-3.5 w-3.5" /></button>
                </span>
              )}
            </div>
            {open === action.id && (
              <div className="border-t border-[#F1EEEA] px-3 pb-3 pt-2.5">
                <ActionConfig action={action} onChange={(next) => set(actions.map((item) => (item.id === action.id ? next : item)))} lookups={lookups} definition={definition} page={page} suggestions={suggestions} disabled={disabled} issues={issues} />
              </div>
            )}
          </div>
        );
      })}
      {!disabled && (
        <div className="relative">
          <button type="button" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ember hover:underline" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="plus" className="h-3.5 w-3.5" />Add action</button>
          {menu && (
            <div className={`${menuCls} left-0 w-64`} role="menu">
              {[['Platform', true], ['In the app', false]].map(([group, server]) => (
                <div key={group} className="py-1">
                  <p className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-slate-400">{group}</p>
                  {Object.entries(ACTIONS).filter(([, meta]) => Boolean(meta.server) === server).map(([type, meta]) => (
                    <button key={type} type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-[#F6F4F1]" onClick={() => { const action = newAction(type, taken); set([...actions, action]); setOpen(action.id); setMenu(false); }}>
                      <Icon name={meta.icon} className="h-4 w-4 text-slate-500" />{meta.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OptionsEditor({ options = [], onChange, disabled }) {
  const list = options || [];
  const update = (index, patch) => onChange(list.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  return (
    <div className="space-y-1.5">
      {list.map((option, index) => (
        <div key={index} className="flex gap-1.5">
          <input aria-label="Option label" className={input} disabled={disabled} value={option.label} placeholder="Label" onChange={(event) => update(index, { label: event.target.value })} />
          <input aria-label="Option value" className={`${input} font-mono text-[12px]`} disabled={disabled} value={option.value} placeholder="value" onChange={(event) => update(index, { value: event.target.value })} />
          {!disabled && <button type="button" className={removeBtn} aria-label={`Remove ${option.label || 'option'}`} onClick={() => onChange(list.filter((_, i) => i !== index))}><Icon name="close" className="h-3.5 w-3.5" /></button>}
        </div>
      ))}
      {!disabled && <button type="button" className="text-[12px] font-semibold text-ember hover:underline" onClick={() => onChange([...list, { label: `Option ${list.length + 1}`, value: `option${list.length + 1}` }])}>+ Add option</button>}
    </div>
  );
}

function titleCase(key) {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function ColumnsEditor({ columns = [], onChange, disabled, sample }) {
  const list = columns || [];
  const update = (index, patch) => onChange(list.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const keys = sample && typeof sample === 'object' ? Object.keys(sample).filter((key) => sample[key] === null || typeof sample[key] !== 'object') : [];
  return (
    <div className="space-y-1.5">
      {list.map((column, index) => (
        <div key={index} className="flex gap-1.5">
          <input aria-label="Column field" className={`${inputBase} shrink-0 w-[34%] font-mono text-[12px]`} disabled={disabled} value={column.key} placeholder="field" onChange={(event) => update(index, { key: event.target.value })} />
          <input aria-label="Column label" className={input} disabled={disabled} value={column.label} placeholder="Label" onChange={(event) => update(index, { label: event.target.value })} />
          <select aria-label="Column format" className={`${inputBase} shrink-0 w-[88px] shrink-0`} disabled={disabled} value={column.format || 'text'} onChange={(event) => update(index, { format: event.target.value })}>{COLUMN_FORMATS.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          {!disabled && <button type="button" className={removeBtn} aria-label={`Remove column ${column.label || column.key}`} onClick={() => onChange(list.filter((_, i) => i !== index))}><Icon name="close" className="h-3.5 w-3.5" /></button>}
        </div>
      ))}
      {!disabled && (
        <div className="flex flex-wrap gap-x-3">
          <button type="button" className="text-[12px] font-semibold text-ember hover:underline" onClick={() => onChange([...list, { key: '', label: '', format: 'text' }])}>+ Add column</button>
          {keys.length > 0 && <button type="button" className="text-[12px] font-medium text-slate-500 hover:text-ink" onClick={() => onChange(keys.slice(0, 8).map((key) => ({ key, label: titleCase(key), format: /status/i.test(key) ? 'status' : /At$|date|time/i.test(key) ? 'datetime' : 'text' })))}>Use fields from data</button>}
        </div>
      )}
    </div>
  );
}

export function ComponentProperties({ component, onChange, onDelete, onDuplicate, lookups, definition, page, suggestions, disabled, validation, sampleRow }) {
  const props = component.props || {};
  const meta = COMPONENTS[component.type] || {};
  const set = (patch) => onChange({ ...component, props: { ...props, ...patch } });
  const issues = issuesFor(validation, { componentId: component.id });
  const err = (field) => [...issues.errors, ...issues.warnings].filter((item) => item.field === field && !item.actionId);
  const text = (field, title, extra = {}) => <Row title={title} issues={err(field)} hint={extra.hint}><input aria-label={title} className={`${input} ${extra.mono ? 'font-mono text-[12px]' : ''}`} disabled={disabled} value={props[field] ?? ''} placeholder={extra.placeholder} onChange={(event) => set({ [field]: event.target.value })} /></Row>;
  const bind = (field, title, extra = {}) => <Row title={title} issues={err(field)} hint={extra.hint}><BindingInput ariaLabel={title} multiline={extra.multiline} mono={extra.mono} value={props[field]} onChange={(value) => set({ [field]: value })} suggestions={suggestions} disabled={disabled} placeholder={extra.placeholder} /></Row>;
  const number = (field, title, extra = {}) => <Row title={title} issues={err(field)}><input aria-label={title} type="number" className={input} disabled={disabled} value={props[field] ?? ''} min={extra.min} max={extra.max} onChange={(event) => set({ [field]: event.target.value === '' ? null : Number(event.target.value) })} /></Row>;
  const seg = (field, title, options, fallback) => <Row title={title}><Segmented value={props[field] ?? fallback} options={options} onChange={(value) => set({ [field]: value })} disabled={disabled} ariaLabel={title} /></Row>;
  const align = (options = [['left', 'Left'], ['center', 'Center'], ['right', 'Right']]) => seg('align', 'Alignment', options, 'left');
  let specific = null;
  switch (component.type) {
    case 'heading': specific = <>{bind('text', 'Text')}{seg('level', 'Size', [[1, 'Large'], [2, 'Medium'], [3, 'Small']], 2)}{align()}</>; break;
    case 'text': specific = <>{bind('text', 'Text', { multiline: true })}{seg('tone', 'Style', [['default', 'Default'], ['muted', 'Muted']], 'default')}{align()}</>; break;
    case 'image': specific = <>{bind('src', 'Image URL', { placeholder: 'https://…' })}{text('alt', 'Alt text', { hint: 'Describes the image for screen readers.' })}<div className="grid grid-cols-2 gap-2">{number('height', 'Height (px)', { min: 40, max: 800 })}<Row title="Fit"><select aria-label="Fit" className={input} disabled={disabled} value={props.fit || 'cover'} onChange={(event) => set({ fit: event.target.value })}><option value="cover">Fill</option><option value="contain">Fit</option></select></Row></div></>; break;
    case 'stat': specific = <>{text('label', 'Label')}{bind('value', 'Value', { placeholder: '{{data.recentJobs.count}}' })}{bind('hint', 'Note')}{seg('tone', 'Colour', [['default', 'Neutral'], ['success', 'Good'], ['warning', 'Watch'], ['danger', 'Bad']], 'default')}</>; break;
    case 'status_badge': specific = <>{text('label', 'Label')}{bind('value', 'Status', { placeholder: '{{vars.score.status}}', hint: 'Colour follows the value: succeeded, failed, waiting, running…' })}</>; break;
    case 'details': specific = <>{text('title', 'Title')}{bind('value', 'Value', { placeholder: '{{vars.score.output}}', hint: 'Bind an object to list its fields.' })}</>; break;
    case 'button': specific = <>{text('label', 'Label')}{seg('variant', 'Style', [['primary', 'Primary'], ['secondary', 'Secondary'], ['ghost', 'Quiet']], 'primary')}{align([['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['stretch', 'Full']])}</>; break;
    case 'table': specific = <>{text('title', 'Title')}{bind('rows', 'Rows', { mono: true, placeholder: '{{data.recentJobs.rows}}' })}<Row title="Columns" issues={err('columns')}><ColumnsEditor columns={props.columns} onChange={(columns) => set({ columns })} disabled={disabled} sample={sampleRow} /></Row><div className="grid grid-cols-2 gap-2">{number('pageSize', 'Rows per page', { min: 1, max: 100 })}{text('emptyText', 'When empty')}</div></>; break;
    case 'agent_chat': specific = (
      <>
        <Row title="Agent" issues={err('agentId')} hint="A published conversational agent from this project.">
          <select aria-label="Agent" className={input} disabled={disabled} value={props.agentId || ''} onChange={(event) => set({ agentId: event.target.value })}><option value="">Choose an agent…</option>{lookups.agents.filter((item) => item.agentType === 'conversational').map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== 'published' ? ` (${item.status})` : ''}</option>)}</select>
        </Row>
        {text('title', 'Title')}{text('placeholder', 'Placeholder')}{number('height', 'Height (px)', { min: 240, max: 900 })}
      </>
    ); break;
    case 'form': specific = <>{text('title', 'Title')}{bind('description', 'Description')}{text('submitLabel', 'Submit button')}<Toggle checked={props.resetOnSubmit !== false} disabled={disabled} onChange={(resetOnSubmit) => set({ resetOnSubmit })}>Clear fields after a successful submit</Toggle></>; break;
    case 'card': specific = <>{text('title', 'Title')}{bind('description', 'Description')}</>; break;
    default: break;
  }
  const inputProps = meta.input && (
    <>
      {text('name', 'Field name', { mono: true, hint: `Use it as {{inputs.${props.name || 'name'}}}.` })}
      {text('label', 'Label')}
      {['text_input', 'number', 'dropdown'].includes(component.type) && text('placeholder', 'Placeholder')}
      {component.type !== 'file_upload' && bind('defaultValue', 'Default value', { placeholder: component.type === 'text_input' ? '{{app.user.name}}' : '' })}
      {text('helpText', 'Help text')}
      <Toggle checked={Boolean(props.required)} disabled={disabled} onChange={(required) => set({ required })}>Required</Toggle>
      {component.type === 'text_input' && (
        <>
          <Toggle checked={Boolean(props.multiline)} disabled={disabled} onChange={(multiline) => set({ multiline })}>Multiple lines</Toggle>
          {seg('format', 'Format', [['text', 'Text'], ['email', 'Email']], 'text')}
          <div className="grid grid-cols-2 gap-2">{number('minLength', 'Min length', { min: 0 })}{number('maxLength', 'Max length', { min: 1 })}</div>
          {text('pattern', 'Pattern (regular expression)', { mono: true, placeholder: 'INV-[0-9]+' })}
          {props.pattern && text('patternMessage', 'Message when it doesn’t match')}
        </>
      )}
      {component.type === 'number' && <div className="grid grid-cols-3 gap-2">{number('min', 'Min')}{number('max', 'Max')}{number('step', 'Step')}</div>}
      {component.type === 'dropdown' && (
        <>
          {seg('optionsMode', 'Options', [['static', 'Fixed list'], ['bound', 'From data']], 'static')}
          {(props.optionsMode || 'static') === 'static'
            ? <Row issues={err('options')}><OptionsEditor options={props.options} onChange={(options) => set({ options })} disabled={disabled} /></Row>
            : <>{bind('optionsFrom', 'Rows', { mono: true, placeholder: '{{data.queueItems.rows}}' })}<div className="grid grid-cols-2 gap-2">{text('labelKey', 'Label field', { mono: true })}{text('valueKey', 'Value field', { mono: true })}</div></>}
        </>
      )}
      {component.type === 'file_upload' && text('accept', 'Accepted types', { mono: true, hint: 'Stored with the project’s files. The value is {artifactId, fileName}.' })}
    </>
  );
  const condition = component.visibleWhen || { path: '', op: 'truthy', value: '' };
  const needsValue = ['eq', 'neq', 'gt', 'lt', 'contains'].includes(condition.op || 'truthy');
  const event = component.type === 'form' ? 'onSubmit' : component.type === 'button' ? 'onClick' : null;
  const general = issues.errors.concat(issues.warnings).filter((item) => !item.field && !item.actionId);
  return (
    <div>
      <div className="flex items-center gap-2.5 border-b border-[#F1EEEA] px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#F6F4F1] text-charcoal"><Icon name={meta.icon} className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1"><p className="text-[13.5px] font-semibold text-ink">{meta.label}</p><p className="font-mono text-[11px] text-slate-400">{component.id}</p></div>
        {!disabled && <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-[#F6F4F1] hover:text-ink" title="Duplicate" aria-label="Duplicate component" onClick={onDuplicate}><Icon name="copy" className="h-4 w-4" /></button>}
        {!disabled && <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-[#FEF3F2] hover:text-danger" title="Delete (Del)" aria-label="Delete component" onClick={onDelete}><Icon name="trash" className="h-4 w-4" /></button>}
      </div>
      {general.map((item, index) => <p key={index} className="mx-4 mt-3 rounded-lg bg-[#FEF8EC] px-3 py-2 text-[12px] text-[#8A5A0B]">{item.message}</p>)}
      <PanelSection title="Layout">
        <Row title="Width" issues={err('span')}><Segmented value={Number(component.span) || 12} options={SPAN_OPTIONS} onChange={(span) => onChange({ ...component, span })} disabled={disabled} ariaLabel="Width" /></Row>
      </PanelSection>
      {(specific || inputProps) && <PanelSection title={meta.input ? 'Field' : 'Content'}>{inputProps}{specific}</PanelSection>}
      {event && (
        <PanelSection title={event === 'onSubmit' ? 'When submitted' : 'When clicked'}>
          <ActionsEditor key={component.id} component={component} event={event} onChange={onChange} lookups={lookups} definition={definition} page={page} suggestions={suggestions} disabled={disabled} validation={validation} />
        </PanelSection>
      )}
      <PanelSection title="Visibility">
        <Row title="Show only when" hint="Leave empty to always show it." issues={err('visibleWhen')}>
          <BindingInput ariaLabel="Show only when" raw mono value={condition.path} onChange={(path) => onChange({ ...component, visibleWhen: path ? { ...condition, path } : null })} suggestions={suggestions} disabled={disabled} placeholder="vars.score" />
        </Row>
        {condition.path && (
          <div className="grid grid-cols-2 gap-2">
            <select aria-label="Condition" className={input} disabled={disabled} value={condition.op || 'truthy'} onChange={(change) => onChange({ ...component, visibleWhen: { ...condition, op: change.target.value } })}>{CONDITION_OPS.map((op) => <option key={op} value={op}>{OP_LABELS[op]}</option>)}</select>
            {needsValue && <input aria-label="Compare with" className={input} disabled={disabled} value={condition.value ?? ''} placeholder="value" onChange={(change) => onChange({ ...component, visibleWhen: { ...condition, value: change.target.value } })} />}
          </div>
        )}
      </PanelSection>
    </div>
  );
}

export function PageProperties({ page, onChange, disabled, validation, children }) {
  const issues = issuesFor(validation, { pageId: page.id });
  const [inputsText, setInputsText] = useState((page.inputs || []).join(', '));
  useEffect(() => { setInputsText((page.inputs || []).join(', ')); }, [page.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <div className="flex items-center gap-2.5 border-b border-[#F1EEEA] px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#F6F4F1] text-charcoal"><Icon name="document" className="h-4 w-4" /></span>
        <div><p className="text-[13.5px] font-semibold text-ink">{page.name || 'Page'}</p><p className="text-[11.5px] text-slate-500">Select a component on the canvas to edit it</p></div>
      </div>
      <PanelSection title="Page">
        <Row title="Name" issues={issues.errors.filter((item) => item.field === 'name' && !item.componentId)}><input aria-label="Page name" className={input} disabled={disabled} value={page.name} onChange={(event) => onChange({ ...page, name: event.target.value })} /></Row>
        <Row title="Page inputs" issues={issues.errors.filter((item) => item.field === 'inputs' && !item.componentId)} hint="Comma-separated names other pages pass in. Read them as {{page.inputs.name}}; they also come from the link (?invoiceId=…).">
          <input aria-label="Page inputs" className={`${input} font-mono text-[12px]`} disabled={disabled} value={inputsText} placeholder="invoiceId" onChange={(event) => { setInputsText(event.target.value); onChange({ ...page, inputs: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) }); }} />
        </Row>
      </PanelSection>
      {children}
    </div>
  );
}

export function AccessDialog({ app, members, users, onClose, onSave }) {
  const [settings, setSettings] = useState({ access: 'project', roles: [], userIds: [], ...(app.settings || {}) });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const people = useMemo(() => {
    const map = new Map();
    for (const member of members) map.set(member.userId || member.user_id, { id: member.userId || member.user_id, name: member.displayName || member.display_name, email: member.email, note: (member.role || 'member').replaceAll('_', ' ') });
    for (const user of users) if (!map.has(user.id)) map.set(user.id, { id: user.id, name: user.displayName || user.display_name, email: user.email, note: (user.role || '').replaceAll('_', ' ') });
    return [...map.values()];
  }, [members, users]);
  const shown = people.filter((person) => !search || `${person.name} ${person.email}`.toLowerCase().includes(search.toLowerCase()));
  const url = `${typeof window === 'undefined' ? '' : window.location.origin}/apps/${app.id}`;
  const modes = [
    ['project', 'Project members', `People who are members of ${app.projectName || 'the project'}.`],
    ['tenant', 'Everyone in your organization', 'Any signed-in user of this tenant.'],
    ['roles', 'Specific roles', 'People with the roles you pick.'],
    ['users', 'Specific people', 'Only the people you pick.'],
  ];
  const toggleIn = (key, value, on) => setSettings({ ...settings, [key]: on ? [...settings[key], value] : settings[key].filter((item) => item !== value) });
  async function save() {
    setBusy(true); setError('');
    try { await onSave(settings); onClose(); } catch (err) { setError(err.message); setBusy(false); }
  }
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/35 p-4 pt-[8vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="access-title" className="w-full max-w-[560px] rounded-2xl u-card shadow-[0_24px_64px_-20px_rgba(23,33,37,0.35)]">
        <div className="flex items-start justify-between px-6 pb-4 pt-5">
          <div>
            <h2 id="access-title" className="text-[17px] font-semibold tracking-tight text-ink">Who can open this app</h2>
            <p className="mt-0.5 text-[13px] text-slate-500">Changes apply right away. Builders of this project and administrators can always open it.</p>
          </div>
          <button type="button" className="-mr-2 grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Close" onClick={onClose}><Icon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 border-t border-[#ECE8E3] px-6 py-5">
          <div className="grid gap-2">
            {modes.map(([key, title, body]) => (
              <label key={key} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${settings.access === key ? 'border-[#F3B9A4] bg-[#FFF7F3]' : 'border-[#ECE8E3] hover:border-[#E2DCD5]'}`}>
                <input type="radio" name="access" className="mt-1 accent-[#FA4616]" checked={settings.access === key} onChange={() => setSettings({ ...settings, access: key })} />
                <span><span className="block text-[13.5px] font-semibold text-ink">{title}</span><span className="block text-[12.5px] text-slate-500">{body}</span></span>
              </label>
            ))}
          </div>
          {settings.access === 'roles' && (
            <fieldset className="grid grid-cols-2 gap-2">
              <legend className="sr-only">Roles</legend>
              {APP_ROLES.map((role) => <label key={role} className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" className="accent-[#FA4616]" checked={settings.roles.includes(role)} onChange={(event) => toggleIn('roles', role, event.target.checked)} />{ROLE_LABELS[role]}</label>)}
            </fieldset>
          )}
          {settings.access === 'users' && (
            <div>
              <input className={input} placeholder="Search people" aria-label="Search people" value={search} onChange={(event) => setSearch(event.target.value)} />
              <ul className="mt-2 max-h-56 divide-y divide-[#F4F1EE] overflow-y-auto rounded-lg border border-[#ECE8E3]">
                {!shown.length && <li className="px-3 py-3 text-[12.5px] text-slate-500">No people found.</li>}
                {shown.map((person) => (
                  <li key={person.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-[#FCFBFA]">
                      <input type="checkbox" className="accent-[#FA4616]" checked={settings.userIds.includes(person.id)} onChange={(event) => toggleIn('userIds', person.id, event.target.checked)} />
                      <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-ink">{person.name || person.email}</span><span className="block truncate text-[11.5px] text-slate-500">{person.email} · <span className="capitalize">{person.note}</span></span></span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <span className={label}>App link</span>
            <div className="flex gap-2">
              <input readOnly aria-label="App link" className={`${input} font-mono text-[12px]`} value={url} />
              <button type="button" className="u-btn-secondary shrink-0 rounded-lg px-3 text-[13px] font-semibold" onClick={() => { navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => {}); }}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            {app.status !== 'published' && <p className="mt-1 text-[11.5px] text-slate-500">The link works once the app is published.</p>}
          </div>
          {error && <p className="rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#ECE8E3] px-6 py-4">
          <button type="button" className="rounded-lg border border-[#ECE8E3] px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-[#F6F4F1]" onClick={onClose}>Cancel</button>
          <button type="button" disabled={busy} className="rounded-lg u-btn-primary px-3.5 py-2 text-[13px] font-semibold disabled:opacity-60" onClick={save}>{busy ? 'Saving…' : 'Save access'}</button>
        </div>
      </div>
    </div>
  );
}
