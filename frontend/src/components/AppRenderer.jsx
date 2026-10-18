import { useMemo, useRef, useState } from 'react';
import { Icon } from './brand.jsx';
import { COMPONENTS, isEmptyValue, referencedSources, renderTemplate } from '../lib/appDefinition.js';
import { defaultValues } from '../lib/useAppEngine.js';

// Renders app pages: a 12-column grid (one column on small screens) of components, shared by the
// published app, the designer preview, and the designer canvas (design mode adds selection,
// drag-and-drop targets, and turns interaction off).

export const SPAN_CLASS = { 3: 'md:col-span-3', 4: 'md:col-span-4', 6: 'md:col-span-6', 8: 'md:col-span-8', 12: 'md:col-span-12' };
const fieldClass = 'w-full rounded-lg border border-[#E2DCD5] bg-white px-3 py-2 text-[14px] text-ink placeholder:text-slate-400 transition-colors focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:bg-[#FAF9F7] disabled:text-slate-500';
const cardClass = 'rounded-2xl border border-[#ECE8E3] bg-white shadow-[0_1px_2px_rgba(23,33,37,0.04),0_8px_24px_-16px_rgba(23,33,37,0.12)]';

const TONES = {
  green: 'bg-[#ECF7EF] text-[#1F6B3A]', red: 'bg-[#FDEEEC] text-[#A8261B]', blue: 'bg-[#EAF1FB] text-[#2F5FA8]', amber: 'bg-[#FDF5E6] text-[#8A5A0B]', gray: 'bg-slate-100 text-slate-700',
};
const DOTS = { green: 'bg-[#2E9E57]', red: 'bg-[#D9382B]', blue: 'bg-[#3A75D0]', amber: 'bg-[#D99A1E]', gray: 'bg-slate-400' };

export function statusTone(value) {
  const text = String(value ?? '').toLowerCase();
  if (/fail|error|reject|denied|abandon|cancel/.test(text)) return text.includes('cancel') ? 'gray' : 'red';
  if (/succe|complete|done|approv|success|paid|publish|ok\b|^ok$|active/.test(text)) return 'green';
  if (/wait|pend|queue|suspend|retry|idle|review/.test(text)) return 'amber';
  if (/run|progress|start|new|claim|open/.test(text)) return 'blue';
  return 'gray';
}

export function humanize(value) {
  const text = String(value ?? '');
  if (/^[A-Z_]+$/.test(text)) return text.charAt(0) + text.slice(1).toLowerCase().replaceAll('_', ' ');
  return text.replaceAll('_', ' ');
}

export function StatusBadge({ value }) {
  if (isEmptyValue(value)) return <span className="text-slate-400">—</span>;
  const tone = statusTone(value);
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}><span className={`h-1.5 w-1.5 rounded-full ${DOTS[tone]}`} aria-hidden="true" />{humanize(value)}</span>;
}

export function formatCell(value, format) {
  if (value === null || value === undefined || value === '') return '—';
  if (format === 'datetime') {
    const text = String(value);
    const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text) ? `${text.replace(' ', 'T')}Z` : text);
    return Number.isNaN(date.getTime()) ? text : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  if (format === 'number') return Number.isFinite(Number(value)) ? Number(value).toLocaleString() : String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function text(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

function Field({ component, error, children, inline = false }) {
  const props = component.props || {};
  const id = `field-${component.id}`;
  if (inline) return <div>{children}{error ? <p className="mt-1 text-[12.5px] text-danger" role="alert">{error}</p> : props.helpText ? <p className="mt-1 text-[12.5px] text-slate-500">{props.helpText}</p> : null}</div>;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-ink">{props.label}{props.required && <span className="ml-0.5 text-ember" aria-hidden="true">*</span>}</label>
      {children}
      {error ? <p className="mt-1 text-[12.5px] text-danger" role="alert">{error}</p> : props.helpText ? <p className="mt-1 text-[12.5px] text-slate-500">{props.helpText}</p> : null}
    </div>
  );
}

function sourceState(engine, template) {
  const names = referencedSources(template);
  const entries = names.map((name) => engine.data?.[name]).filter(Boolean);
  return { loading: entries.some((entry) => entry.loading && !entry.loadedAt), error: entries.find((entry) => entry.error)?.error || null };
}

function TableView({ component, engine, ctx }) {
  const props = component.props || {};
  const rows = renderTemplate(props.rows || '', ctx);
  const list = Array.isArray(rows) ? rows : [];
  const pageSize = Math.max(1, Number(props.pageSize) || 10);
  const [pageIndex, setPageIndex] = useState(0);
  const pages = Math.max(1, Math.ceil(list.length / pageSize));
  const visible = list.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize);
  const state = sourceState(engine, props.rows);
  const columns = props.columns?.length ? props.columns : [{ key: 'id', label: 'ID' }];
  return (
    <div className={`${cardClass} overflow-hidden`}>
      {(props.title || list.length > 0) && (
        <div className="flex items-center justify-between gap-3 border-b border-[#F1EEEA] px-5 py-3">
          <h3 className="text-[14.5px] font-semibold text-ink">{props.title}</h3>
          <span className="text-xs tabular-nums text-slate-500">{state.loading ? 'Loading…' : `${list.length} ${list.length === 1 ? 'row' : 'rows'}`}</span>
        </div>
      )}
      {state.error && <p className="border-b border-[#F5C9C4] bg-[#FEF3F2] px-5 py-2 text-[13px] text-danger" role="alert">Could not load data: {state.error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-[#FBFAF8] text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
            <tr>{columns.map((column, index) => <th key={`${column.key}-${index}`} scope="col" className="whitespace-nowrap px-5 py-2.5 font-semibold">{column.label || column.key}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-[#F4F1EE]">
            {state.loading && !list.length && [0, 1, 2].map((row) => <tr key={row}>{columns.map((column, index) => <td key={index} className="px-5 py-3"><span className="block h-3 w-3/4 animate-pulse rounded bg-[#F1EEEA]" /></td>)}</tr>)}
            {!state.loading && !list.length && <tr><td colSpan={columns.length} className="px-5 py-10 text-center text-slate-500">{props.emptyText || 'Nothing to show yet'}</td></tr>}
            {visible.map((row, rowIndex) => (
              <tr key={row?.id || rowIndex} className="transition-colors hover:bg-[#FCFBFA]">
                {columns.map((column, index) => {
                  const value = renderTemplate(`{{${column.key}}}`, row || {});
                  return <td key={index} className="max-w-[280px] truncate px-5 py-3 text-[#33424A]">{column.format === 'status' ? <StatusBadge value={value} /> : formatCell(value, column.format)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-[#F1EEEA] px-5 py-2.5 text-[12.5px] text-slate-500">
          <span className="tabular-nums">Page {pageIndex + 1} of {pages}</span>
          <button type="button" className="rounded-md border border-[#ECE8E3] px-2 py-1 font-medium text-ink hover:bg-[#F6F4F1] disabled:opacity-40" disabled={pageIndex === 0} onClick={() => setPageIndex(pageIndex - 1)}>Previous</button>
          <button type="button" className="rounded-md border border-[#ECE8E3] px-2 py-1 font-medium text-ink hover:bg-[#F6F4F1] disabled:opacity-40" disabled={pageIndex >= pages - 1} onClick={() => setPageIndex(pageIndex + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

function DetailsView({ props, ctx }) {
  const value = renderTemplate(props.value || '', ctx);
  const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : null;
  return (
    <div className={`${cardClass} p-5`}>
      {props.title && <h3 className="text-[14.5px] font-semibold text-ink">{props.title}</h3>}
      {isEmptyValue(value) ? <p className="mt-2 text-[13px] text-slate-400">Nothing to show yet</p> : entries ? (
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {entries.slice(0, 40).map(([key, item]) => (
            <div key={key} className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">{humanize(key)}</dt>
              <dd className="mt-0.5 break-words text-[13.5px] text-ink">{item && typeof item === 'object' ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-[#FBFAF8] px-2 py-1 font-mono text-[11.5px] text-[#3B4A52]">{JSON.stringify(item, null, 2)}</pre> : /status/i.test(key) ? <StatusBadge value={item} /> : String(item)}</dd>
            </div>
          ))}
        </dl>
      ) : <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#FBFAF8] px-3 py-2 font-mono text-[12px] text-[#3B4A52]">{text(value)}</pre>}
    </div>
  );
}

function AgentChatView({ component, engine, design }) {
  const props = component.props || {};
  const chat = engine.chats?.[component.id] || {};
  const [message, setMessage] = useState('');
  const scroller = useRef(null);
  const messages = chat.messages || [];
  const send = () => { const value = message.trim(); if (!value || chat.busy) return; setMessage(''); engine.sendChat(component, value).then(() => scroller.current?.scrollTo({ top: 1e6 })); };
  return (
    <div className={`${cardClass} flex flex-col overflow-hidden`} style={{ height: Math.max(240, Math.min(900, Number(props.height) || 420)) }}>
      <div className="flex items-center gap-2.5 border-b border-[#F1EEEA] px-5 py-3">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#EEF4FF] text-[#3550B5]"><Icon name="agent" className="h-4 w-4" /></span>
        <h3 className="text-[14.5px] font-semibold text-ink">{props.title || 'Assistant'}</h3>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4" aria-live="polite">
        {!messages.length && <p className="text-[13px] text-slate-400">{design ? 'People chat with the agent here.' : 'Ask anything to get started.'}</p>}
        {messages.map((item) => (
          <div key={item.id} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <p className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[13.5px] leading-6 ${item.role === 'user' ? 'rounded-br-md bg-[#FFF1EC] text-ink' : 'rounded-bl-md bg-[#F6F4F1] text-ink'}`}>{item.content}</p>
          </div>
        ))}
        {chat.busy && <p className="flex items-center gap-2 text-[12.5px] text-slate-500"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#3A75D0]" />Thinking…</p>}
        {chat.error && <p className="rounded-lg bg-[#FEF3F2] px-3 py-2 text-[12.5px] text-danger" role="alert">{chat.error}</p>}
      </div>
      <form className="flex items-end gap-2 border-t border-[#F1EEEA] p-3" onSubmit={(event) => { event.preventDefault(); send(); }}>
        <textarea aria-label={props.placeholder || 'Message'} rows={1} disabled={design || chat.busy} className={`${fieldClass} max-h-28 min-h-[40px] resize-none`} placeholder={props.placeholder || 'Ask a question…'} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} />
        <button type="submit" disabled={design || chat.busy || !message.trim()} className="u-btn-primary grid h-10 w-10 shrink-0 place-items-center rounded-lg disabled:opacity-50" aria-label="Send"><Icon name="arrowUpRight" className="h-4 w-4" strokeWidth={2.2} /></button>
      </form>
    </div>
  );
}

function FileField({ component, engine, value, disabled }) {
  const input = useRef(null);
  const busy = engine.busy?.[component.id];
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-[#DDD6CF] bg-[#FCFBFA] px-3 py-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-slate-500 shadow-[0_1px_2px_rgba(16,24,40,0.06)]"><Icon name="upload" className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1 text-[13px]">
        {value?.fileName ? <p className="truncate font-medium text-ink">{value.fileName}</p> : <p className="text-slate-500">{busy ? 'Uploading…' : 'No file chosen'}</p>}
        <p className="text-[11.5px] text-slate-400">Up to 10 MB · {component.props?.accept || 'any supported type'}</p>
      </div>
      <input ref={input} id={`field-${component.id}`} type="file" className="sr-only" accept={component.props?.accept || undefined} disabled={disabled || busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) engine.uploadFile(component, file); event.target.value = ''; }} />
      {value?.fileName && !disabled && <button type="button" className="text-[12.5px] font-medium text-slate-500 hover:text-danger" onClick={() => engine.setValue(component.props.name, null, component.id)}>Remove</button>}
      <button type="button" disabled={disabled || busy} className="u-btn-secondary rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50" onClick={() => input.current?.click()}>{value?.fileName ? 'Replace' : 'Choose file'}</button>
    </div>
  );
}

export function ComponentBody({ component, engine, ctx, values, design, renderChildren }) {
  const props = component.props || {};
  const error = design ? null : engine.errors?.[component.id];
  const busy = engine.busy?.[component.id];
  const disabled = design || !engine.interactive;
  const align = { left: 'text-left', center: 'text-center', right: 'text-right' }[props.align] || 'text-left';
  const value = values?.[props.name];
  const set = (next) => engine.setValue(props.name, next, component.id);
  const invalid = error ? 'border-[#E5867C] focus:border-[#D9382B] focus:ring-[#D9382B]/15' : '';
  switch (component.type) {
    case 'heading': {
      const Tag = `h${Math.min(3, Math.max(1, Number(props.level) || 2))}`;
      const size = { h1: 'text-[26px] leading-tight', h2: 'text-[20px] leading-snug', h3: 'text-[16px]' }[Tag];
      return <Tag className={`${size} ${align} font-semibold tracking-[-0.015em] text-ink`}>{text(renderTemplate(props.text || '', ctx))}</Tag>;
    }
    case 'text':
      return <p className={`${align} whitespace-pre-wrap text-[14px] leading-6 ${props.tone === 'muted' ? 'text-slate-500' : 'text-[#33424A]'}`}>{text(renderTemplate(props.text || '', ctx))}</p>;
    case 'image': {
      const src = renderTemplate(props.src || '', ctx);
      if (!src) return <div className="grid place-items-center rounded-xl border border-dashed border-[#DDD6CF] bg-[#FCFBFA] text-[13px] text-slate-400" style={{ height: Number(props.height) || 180 }}><span className="flex items-center gap-2"><Icon name="image" className="h-4 w-4" />Add an image URL</span></div>;
      return <img src={String(src)} alt={props.alt || ''} className="w-full rounded-xl border border-[#ECE8E3] bg-[#FCFBFA]" style={{ height: Number(props.height) || 180, objectFit: props.fit === 'contain' ? 'contain' : 'cover' }} />;
    }
    case 'stat': {
      const tone = { success: 'text-[#1F6B3A]', warning: 'text-[#8A5A0B]', danger: 'text-[#A8261B]' }[props.tone] || 'text-ink';
      return (
        <div className={`${cardClass} h-full p-5`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">{props.label}</p>
          <p className={`mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums ${tone}`}>{text(renderTemplate(props.value ?? '', ctx)) || '—'}</p>
          {props.hint && <p className="mt-2 text-[12.5px] text-slate-500">{text(renderTemplate(props.hint, ctx))}</p>}
        </div>
      );
    }
    case 'status_badge':
      return <div className="flex items-center gap-2.5">{props.label && <span className="text-[13px] font-medium text-slate-600">{props.label}</span>}<StatusBadge value={renderTemplate(props.value ?? '', ctx)} /></div>;
    case 'details':
      return <DetailsView props={props} ctx={ctx} />;
    case 'divider':
      return <hr className="border-0 border-t border-[#ECE8E3]" />;
    case 'text_input':
      return (
        <Field component={component} error={error}>
          {props.multiline
            ? <textarea id={`field-${component.id}`} rows={4} disabled={disabled} aria-invalid={Boolean(error)} className={`${fieldClass} ${invalid} resize-y`} placeholder={props.placeholder || ''} value={value ?? ''} onChange={(event) => set(event.target.value)} />
            : <input id={`field-${component.id}`} type={props.format === 'email' ? 'email' : 'text'} disabled={disabled} aria-invalid={Boolean(error)} className={`${fieldClass} ${invalid}`} placeholder={props.placeholder || ''} value={value ?? ''} onChange={(event) => set(event.target.value)} />}
        </Field>
      );
    case 'number':
      return <Field component={component} error={error}><input id={`field-${component.id}`} type="number" inputMode="decimal" disabled={disabled} aria-invalid={Boolean(error)} className={`${fieldClass} ${invalid} tabular-nums`} placeholder={props.placeholder || ''} min={props.min ?? undefined} max={props.max ?? undefined} step={props.step || 'any'} value={value ?? ''} onChange={(event) => set(event.target.value === '' ? '' : Number(event.target.value))} /></Field>;
    case 'date':
      return <Field component={component} error={error}><input id={`field-${component.id}`} type="date" disabled={disabled} aria-invalid={Boolean(error)} className={`${fieldClass} ${invalid}`} value={value ?? ''} onChange={(event) => set(event.target.value)} /></Field>;
    case 'dropdown': {
      const bound = props.optionsMode === 'bound' ? renderTemplate(props.optionsFrom || '', ctx) : null;
      const options = props.optionsMode === 'bound'
        ? (Array.isArray(bound) ? bound : []).map((row) => (row && typeof row === 'object' ? { label: String(renderTemplate(`{{${props.labelKey || 'name'}}}`, row) ?? ''), value: String(renderTemplate(`{{${props.valueKey || 'id'}}}`, row) ?? '') } : { label: String(row), value: String(row) }))
        : (props.options || []).map((option) => ({ label: option.label, value: String(option.value) }));
      return (
        <Field component={component} error={error}>
          <select id={`field-${component.id}`} disabled={disabled} aria-invalid={Boolean(error)} className={`${fieldClass} ${invalid}`} value={value ?? ''} onChange={(event) => set(event.target.value)}>
            <option value="">{props.placeholder || 'Select…'}</option>
            {options.map((option, index) => <option key={`${option.value}-${index}`} value={option.value}>{option.label || option.value}</option>)}
          </select>
        </Field>
      );
    }
    case 'checkbox':
      return (
        <Field component={component} error={error} inline>
          <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-ink">
            <input id={`field-${component.id}`} type="checkbox" disabled={disabled} className="h-4 w-4 rounded border-[#CFC7BF] accent-[#FA4616]" checked={value === true} onChange={(event) => set(event.target.checked)} />
            <span>{props.label}{props.required && <span className="ml-0.5 text-ember" aria-hidden="true">*</span>}</span>
          </label>
        </Field>
      );
    case 'file_upload':
      return <Field component={component} error={error}><FileField component={component} engine={engine} value={value} disabled={disabled} /></Field>;
    case 'button': {
      const variant = { primary: 'u-btn-primary', secondary: 'u-btn-secondary', ghost: 'text-ink hover:bg-[#F6F4F1]' }[props.variant] || 'u-btn-primary';
      const justify = { center: 'justify-center', right: 'justify-end', stretch: '' }[props.align] || 'justify-start';
      return (
        <div className={`flex ${justify}`}>
          <button type="button" disabled={busy || (!design && !engine.interactive)} aria-busy={Boolean(busy)} className={`${variant} ${props.align === 'stretch' ? 'w-full justify-center' : ''} inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${design ? 'pointer-events-none' : ''}`} onClick={() => engine.runActions(component, 'onClick')}>
            {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />}
            {busy ? 'Working…' : props.label || 'Button'}
          </button>
        </div>
      );
    }
    case 'table':
      return <TableView component={component} engine={engine} ctx={ctx} />;
    case 'agent_chat':
      return <AgentChatView component={component} engine={engine} design={design} />;
    case 'form':
      return (
        <form noValidate className={`${cardClass} p-6`} onSubmit={(event) => { event.preventDefault(); if (!design) engine.submitForm(component); }}>
          {(props.title || props.description) && (
            <div className="mb-5">
              {props.title && <h3 className="text-[16px] font-semibold tracking-tight text-ink">{props.title}</h3>}
              {props.description && <p className="mt-1 text-[13.5px] text-slate-500">{renderTemplate(props.description, ctx)}</p>}
            </div>
          )}
          {renderChildren(component)}
          <div className="mt-6 flex items-center justify-end gap-3 border-t border-[#F1EEEA] pt-4">
            <button type="submit" disabled={busy || (!design && !engine.interactive)} aria-busy={Boolean(busy)} className={`u-btn-primary inline-flex h-10 items-center gap-2 rounded-lg px-5 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${design ? 'pointer-events-none' : ''}`}>
              {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />}
              {busy ? 'Working…' : props.submitLabel || 'Submit'}
            </button>
          </div>
        </form>
      );
    case 'card':
      return (
        <section className={`${cardClass} p-6`}>
          {(props.title || props.description) && (
            <div className="mb-4">
              {props.title && <h3 className="text-[16px] font-semibold tracking-tight text-ink">{props.title}</h3>}
              {props.description && <p className="mt-1 text-[13.5px] text-slate-500">{renderTemplate(props.description, ctx)}</p>}
            </div>
          )}
          {renderChildren(component)}
        </section>
      );
    default:
      return <p className="text-[13px] text-slate-400">Unknown component {component.type}</p>;
  }
}

/**
 * A page's component grid. `design` (designer canvas only):
 * { selectedId, onSelect(id), onDrop(parentId, index, event), dropTarget, setDropTarget, onDragStart(id, event) }.
 */
export function AppPageView({ page, engine, design = null }) {
  const ctx = engine.context;
  const designValues = useMemo(() => (design ? defaultValues(page, ctx) : null), [design, page, ctx]);
  const values = design ? designValues : engine.values;

  const grid = (components, parent) => {
    const shown = design ? components : components.filter((component) => engine.isVisible(component));
    return (
      <div className="grid grid-cols-12 gap-x-5 gap-y-5">
        {shown.map((component, index) => (
          <ComponentSlot key={component.id} component={component} index={index} parent={parent} engine={engine} ctx={ctx} values={values} design={design} renderChildren={(container) => children(container)} />
        ))}
        {design && <DropZone parentId={parent?.id || null} index={components.length} design={design} empty={!components.length} label={parent ? 'Drop fields here' : 'Drag components here, or click one on the left'} />}
      </div>
    );
  };
  const children = (container) => grid(container.children || [], container);
  return grid(page?.components || [], null);
}

function DropZone({ parentId, index, design, empty, label }) {
  const active = design.dropTarget && design.dropTarget.parentId === parentId && design.dropTarget.index === index && design.dropTarget.zone;
  if (!empty && !active && !design.dragging) return null;
  return (
    <div
      className={`col-span-12 grid place-items-center rounded-xl border-2 border-dashed text-[12.5px] transition-colors ${empty ? 'min-h-[88px]' : 'min-h-[44px]'} ${active ? 'border-ember bg-[#FFF7F3] text-ember' : 'border-[#E2DCD5] text-slate-400'}`}
      onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); design.setDropTarget({ parentId, index, zone: true }); }}
      onDragLeave={() => design.setDropTarget(null)}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); design.onDrop(parentId, index, event); }}
    >
      {label}
    </div>
  );
}

function ComponentSlot({ component, index, parent, engine, ctx, values, design, renderChildren }) {
  const span = SPAN_CLASS[component.span] || SPAN_CLASS[12];
  const body = <ComponentBody component={component} engine={engine} ctx={ctx} values={values} design={Boolean(design)} renderChildren={renderChildren} />;
  if (!design) return <div className={`col-span-12 ${span} min-w-0`}>{body}</div>;
  const selected = design.selectedId === component.id;
  const target = design.dropTarget && !design.dropTarget.zone && design.dropTarget.parentId === (parent?.id || null) ? design.dropTarget : null;
  const before = target && target.index === index && !target.afterId;
  const after = target && target.index === index + 1 && target.afterId === component.id;
  const horizontal = Number(component.span || 12) < 12;
  const container = COMPONENTS[component.type]?.container;
  const meta = COMPONENTS[component.type];
  return (
    <div
      className={`group/slot relative col-span-12 ${span} min-w-0 rounded-xl outline-offset-[6px] transition-[outline-color] ${selected ? 'outline outline-2 outline-[#FA4616]' : 'outline outline-1 outline-transparent hover:outline-[#F3B9A4]'}`}
      draggable
      data-component-id={component.id}
      onDragStart={(event) => { event.stopPropagation(); design.onDragStart(component.id, event); }}
      onDragEnd={() => design.onDragEnd()}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const first = horizontal ? event.clientX - rect.left < rect.width / 2 : event.clientY - rect.top < rect.height / 2;
        design.setDropTarget({ parentId: parent?.id || null, index: first ? index : index + 1, afterId: first ? null : component.id });
      }}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (target) design.onDrop(target.parentId, target.index, event); }}
      onClick={(event) => { event.stopPropagation(); design.onSelect(component.id); }}
    >
      {(before || after) && <span className={`pointer-events-none absolute z-10 rounded-full bg-ember ${horizontal ? `top-0 h-full w-[3px] ${before ? '-left-[11px]' : '-right-[11px]'}` : `left-0 h-[3px] w-full ${before ? '-top-[11px]' : '-bottom-[11px]'}`}`} aria-hidden="true" />}
      {selected && <span className="pointer-events-none absolute -top-[30px] left-0 z-10 flex items-center gap-1 rounded-md bg-ember px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm"><Icon name="grip" className="h-3 w-3" strokeWidth={3} />{meta?.label}{component.props?.name ? ` · ${component.props.name}` : ''}</span>}
      {component.visibleWhen?.path && <span className="pointer-events-none absolute -top-2 right-2 z-10 inline-flex items-center gap-1 rounded-full border border-[#ECE8E3] bg-white px-1.5 py-px text-[10.5px] font-medium text-slate-500 shadow-sm"><Icon name="eye" className="h-3 w-3" />Conditional</span>}
      <div className={container ? '' : 'pointer-events-none select-none'}>{body}</div>
    </div>
  );
}

export function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} role={item.tone === 'error' ? 'alert' : 'status'} className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-white px-4 py-3 text-[13.5px] shadow-[0_16px_40px_-16px_rgba(16,24,40,0.3)] ${item.tone === 'error' ? 'border-[#F5C9C4]' : 'border-[#ECE8E3]'}`}>
          <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${item.tone === 'error' ? 'bg-[#FDEEEC] text-[#A8261B]' : item.tone === 'info' ? 'bg-[#EAF1FB] text-[#2F5FA8]' : 'bg-[#ECF7EF] text-[#1F6B3A]'}`}><Icon name={item.tone === 'error' ? 'alert' : item.tone === 'info' ? 'info' : 'check'} className="h-3 w-3" strokeWidth={2.4} /></span>
          <p className="min-w-0 flex-1 break-words text-ink">{item.message}</p>
          <button type="button" className="text-slate-400 hover:text-ink" aria-label="Dismiss" onClick={() => onDismiss(item.id)}><Icon name="close" className="h-3.5 w-3.5" /></button>
        </div>
      ))}
    </div>
  );
}
