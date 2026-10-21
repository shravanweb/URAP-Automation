import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from '../services/api.js';
import { Icon } from './brand.jsx';
import { SkeletonRows } from './Loader.jsx';
import { actionLabel, categoryOf, categoryStyle, entityLink, formatTime, jsonDiff, rangeBounds, relativeTime, shortAgent } from './auditFormat.js';

const ENTITY_ICONS = {
  user: 'users', project: 'folder', workflow: 'flow', job: 'play', task: 'tasks', connection: 'link', schedule: 'calendar',
  work_queue: 'queue', queue_item: 'queue', flow: 'flow', flow_run: 'playCircle', agent: 'agent', agent_run: 'agent', app: 'app',
  case: 'briefcase', case_type: 'briefcase', bpmn_process: 'bpmn', robot: 'robot', recorder: 'monitor', artifact: 'document',
};
const PAGE_SIZES = [25, 50, 100];
const EMPTY_FILTERS = { q: '', category: '', userId: '', entityType: '', result: '', range: '7d', from: '', to: '' };
const field = 'h-10 w-full rounded-lg border border-[#E7DED5] bg-white px-3 text-[13.5px] text-[#172125] shadow-sm placeholder:text-[#9AA3A7] focus:border-[#FA4616] focus:outline-none focus:ring-2 focus:ring-[#FA4616]/15';

function queryFor(filters, extra = {}) {
  const params = new URLSearchParams();
  for (const key of ['q', 'category', 'userId', 'entityType', 'result']) if (filters[key]) params.set(key, filters[key]);
  const bounds = rangeBounds(filters.range, { from: filters.from, to: filters.to });
  if (bounds.from) params.set('from', bounds.from);
  if (bounds.to) params.set('to', bounds.to);
  for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  return params;
}

function CategoryChip({ action }) {
  const [label, cls] = categoryStyle(categoryOf(action));
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${cls}`}>{label}</span>;
}

function ResultBadge({ result }) {
  if (!result) return <span className="text-[#9AA3A7]">—</span>;
  const ok = result === 'success';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold ${ok ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#FEF2F2] text-[#B91C1C]'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-[#10B981]' : 'bg-[#EF4444]'}`} />{ok ? 'Success' : 'Failed'}
    </span>
  );
}

function Avatar({ actor, size = 'h-8 w-8 text-[12px]' }) {
  const name = actor?.name || actor?.email || (actor?.type === 'robot' ? 'Robot' : 'System');
  const tone = actor?.type === 'user' ? 'bg-[#FFF1EB] text-[#E8611A]' : actor?.type === 'robot' ? 'bg-[#EEF2FF] text-[#4F46E5]' : 'bg-slate-100 text-slate-500';
  return <span className={`grid shrink-0 place-items-center rounded-full font-bold ${size} ${tone}`}>{actor?.type === 'robot' ? <Icon name="robot" className="h-4 w-4" /> : name.trim()[0]?.toUpperCase() || '?'}</span>;
}

function CopyButton({ value, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  if (!value) return null;
  return (
    <button type="button" aria-label={`${label}: ${value}`} title={done ? 'Copied' : label} onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }).catch(() => {}); }}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[#6B7280] hover:bg-[#FFF1EB] hover:text-[#FA4616]">
      {done ? <Icon name="check" className="h-3.5 w-3.5" /> : <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>}
    </button>
  );
}

function EntityCell({ entity }) {
  const href = entityLink(entity);
  const name = entity?.name || (entity?.id ? `${entity.type.replace(/_/g, ' ')}` : '—');
  const body = (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#F7F3EF] text-[#5B6569]"><Icon name={ENTITY_ICONS[entity?.type] || 'grid'} className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className={`block truncate text-[13.5px] font-medium ${href ? 'text-[#172125] group-hover/ent:text-[#FA4616]' : 'text-[#172125]'}`}>{name}</span>
        <span className="block truncate text-[11.5px] text-[#8A9397]">{entity?.type?.replace(/_/g, ' ')}{entity?.id ? ` · ${entity.id.slice(0, 8)}` : ''}{entity?.id && entity.exists === false ? ' · deleted' : ''}</span>
      </span>
    </span>
  );
  return href ? <Link to={href} onClick={(e) => e.stopPropagation()} className="group/ent block min-w-0">{body}</Link> : body;
}

function Summary({ data }) {
  const items = [
    ['Events today', data?.events, 'list', 'bg-[#FFF1EB] text-[#FA4616]'],
    ['Sign-ins', data?.signIns, 'users', 'bg-[#EEF2FF] text-[#4F46E5]'],
    ['Failures', data?.failures, 'alert', 'bg-[#FEF2F2] text-[#DC2626]'],
    ['Unique users', data?.uniqueUsers, 'eye', 'bg-[#ECFDF5] text-[#059669]'],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(([label, value, icon, tint]) => (
        <div key={label} className="flex items-center gap-3 rounded-xl border border-[#EFE6DD] bg-white px-4 py-3 shadow-[0_6px_18px_-14px_rgba(120,60,20,0.35)]">
          <span className={`grid h-10 w-10 place-items-center rounded-xl ${tint}`}><Icon name={icon} className="h-5 w-5" /></span>
          <span><span className="block text-[12px] font-medium text-[#6B7280]">{label}</span><span className="block text-[22px] font-bold leading-tight text-[#172125]">{value ?? '—'}</span></span>
        </div>
      ))}
    </div>
  );
}

function JsonBlock({ value }) {
  return <pre className="max-h-72 overflow-auto rounded-lg border border-[#EFE6DD] bg-[#FBF8F5] p-3 text-[12px] leading-relaxed text-[#283338]">{JSON.stringify(value, null, 2)}</pre>;
}

function Drawer({ row, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!row) return null;
  const meta = row.metadata;
  const hasDiff = meta && meta.before && meta.after && typeof meta.before === 'object' && typeof meta.after === 'object';
  const rest = meta && hasDiff ? Object.fromEntries(Object.entries(meta).filter(([k]) => k !== 'before' && k !== 'after')) : meta;
  const Row = ({ label, children, copy }) => (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-3 py-2">
      <dt className="text-[12.5px] font-medium text-[#6B7280]">{label}</dt>
      <dd className="flex min-w-0 items-start gap-1 text-[13px] text-[#172125]"><span className="min-w-0 break-all">{children ?? <span className="text-[#9AA3A7]">—</span>}</span>{copy && <CopyButton value={copy} />}</dd>
    </div>
  );
  const href = entityLink(row.entity);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Audit event details">
      <button type="button" aria-label="Close details" className="absolute inset-0 bg-[#172125]/25 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="audit-drawer relative flex h-full w-full max-w-[520px] flex-col border-l border-[#EFE6DD] bg-white shadow-[-20px_0_50px_-30px_rgba(23,33,37,0.45)]">
        <header className="flex items-start gap-3 border-b border-[#F1E9E1] px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><CategoryChip action={row.action} /><ResultBadge result={row.result} /></div>
            <h2 className="mt-2 text-[18px] font-bold text-[#172125]">{actionLabel(row.action)}</h2>
            <p className="mt-0.5 text-[12.5px] text-[#6B7280]">{formatTime(row.createdAt)} · {relativeTime(row.createdAt)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-[#6B7280] hover:bg-[#F7F3EF]"><Icon name="close" className="h-4 w-4" /></button>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#FA4616]">Event</h3>
            <dl className="mt-1 divide-y divide-[#F4EDE6]">
              <Row label="Action" copy={row.action}><code className="text-[12.5px]">{row.action}</code></Row>
              <Row label="Event ID" copy={row.id}><code className="text-[12px]">{row.id}</code></Row>
              <Row label="Time (UTC)">{new Date(row.createdAt).toISOString()}</Row>
              <Row label="Request ID" copy={row.requestId}>{row.requestId && <code className="text-[12px]">{row.requestId}</code>}</Row>
            </dl>
          </section>
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#FA4616]">Actor</h3>
            <div className="mt-2 flex items-center gap-3 rounded-xl border border-[#F1E9E1] p-3">
              <Avatar actor={row.actor} size="h-10 w-10 text-[14px]" />
              <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-semibold text-[#172125]">{row.actor.name || row.actor.email || row.actor.type}</p><p className="truncate text-[12.5px] text-[#6B7280]">{row.actor.email || row.actor.type}</p></div>
            </div>
            <dl className="mt-1 divide-y divide-[#F4EDE6]">
              <Row label="Actor ID" copy={row.actor.id}>{row.actor.id && <code className="text-[12px]">{row.actor.id}</code>}</Row>
              <Row label="IP address" copy={row.ip}>{row.ip}</Row>
              <Row label="User agent">{row.userAgent}</Row>
            </dl>
          </section>
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#FA4616]">Target</h3>
            <dl className="mt-1 divide-y divide-[#F4EDE6]">
              <Row label="Type">{row.entity.type?.replace(/_/g, ' ')}</Row>
              <Row label="Name">{row.entity.name ? (href ? <Link className="font-medium text-[#FA4616] hover:underline" to={href}>{row.entity.name}</Link> : row.entity.name) : null}</Row>
              <Row label="Entity ID" copy={row.entity.id}>{row.entity.id && <code className="text-[12px]">{row.entity.id}</code>}</Row>
              <Row label="Project" copy={row.project?.id}>{row.project ? (row.project.name || row.project.id) : null}</Row>
            </dl>
          </section>
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#FA4616]">{hasDiff ? 'Changes' : 'Details'}</h3>
            {hasDiff && (
              <div className="mt-2 overflow-hidden rounded-lg border border-[#EFE6DD] text-[12.5px]">
                {jsonDiff(meta.before, meta.after).filter((d) => d.kind !== 'same').map((d) => (
                  <div key={d.key} className="grid grid-cols-[110px_1fr_1fr] gap-2 border-b border-[#F4EDE6] px-3 py-2 last:border-0">
                    <code className="font-semibold">{d.key}</code>
                    <code className="break-all rounded bg-[#FEF2F2] px-1.5 text-[#B91C1C]">{d.before === undefined ? '—' : JSON.stringify(d.before)}</code>
                    <code className="break-all rounded bg-[#ECFDF5] px-1.5 text-[#047857]">{d.after === undefined ? '—' : JSON.stringify(d.after)}</code>
                  </div>
                ))}
              </div>
            )}
            {rest && Object.keys(rest).length ? <div className="mt-2"><JsonBlock value={rest} /></div> : !hasDiff && <p className="mt-2 text-[13px] text-[#9AA3A7]">No extra details were recorded for this event.</p>}
          </section>
        </div>
      </aside>
    </div>
  );
}

export default function AuditLog() {
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [pageSize, setPageSize] = useState(25);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [facets, setFacets] = useState({ users: [], entityTypes: [], categories: [] });
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api('/api/audit/facets').then((r) => setFacets(r.data)).catch(() => {});
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    api(`/api/audit/summary?since=${encodeURIComponent(midnight.toISOString())}`).then((r) => setSummary(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    let live = true;
    setData(null); setError('');
    api(`/api/audit?${queryFor(filters, { limit: pageSize, offset }).toString()}`)
      .then((r) => { if (live) setData(r); })
      .catch((e) => { if (live) { setError(e.message); setData({ data: [], meta: { total: 0, limit: pageSize, offset } }); } });
    return () => { live = false; };
  }, [filters, pageSize, offset]);

  const total = data?.meta?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.floor(offset / pageSize) + 1;
  const apply = (e) => { e?.preventDefault(); setOffset(0); setFilters({ ...draft }); };
  const clear = () => { setDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); setOffset(0); };
  const activeCount = useMemo(() => ['q', 'category', 'userId', 'entityType', 'result'].filter((k) => filters[k]).length + (filters.range !== '7d' ? 1 : 0), [filters]);

  async function exportCsv() {
    setExporting(true);
    try { await download(`/api/audit/export.csv?${queryFor(filters).toString()}`, `audit-log-${new Date().toISOString().slice(0, 10)}.csv`); } catch (e) { setError(e.message); } finally { setExporting(false); }
  }

  return (
    <div className="space-y-5">
      <Summary data={summary} />

      <form onSubmit={apply} className="rounded-xl border border-[#EFE6DD] bg-white p-4 shadow-[0_6px_18px_-16px_rgba(120,60,20,0.35)]">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
          <label className="relative block">
            <span className="sr-only">Search</span>
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9AA3A7]" />
            <input className={`${field} pl-9`} placeholder="Search action, user, entity id, IP, request id" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
          </label>
          <select aria-label="Category" className={field} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
            <option value="">All categories</option>
            {facets.categories.map((c) => <option key={c} value={c}>{categoryStyle(c)[0]}</option>)}
          </select>
          <select aria-label="User" className={field} value={draft.userId} onChange={(e) => setDraft({ ...draft, userId: e.target.value })}>
            <option value="">All users</option>
            {facets.users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </select>
          <select aria-label="Entity type" className={field} value={draft.entityType} onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}>
            <option value="">All entity types</option>
            {facets.entityTypes.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <select aria-label="Result" className={field} value={draft.result} onChange={(e) => setDraft({ ...draft, result: e.target.value })}>
            <option value="">Any result</option><option value="success">Success</option><option value="failure">Failed</option>
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[#E7DED5] bg-[#FBF8F5] p-0.5" role="group" aria-label="Date range">
            {[['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['all', 'All time'], ['custom', 'Custom']].map(([k, label]) => (
              <button key={k} type="button" aria-pressed={draft.range === k} onClick={() => setDraft({ ...draft, range: k })}
                className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium ${draft.range === k ? 'bg-white text-[#FA4616] shadow-sm ring-1 ring-[#F3D9CB]' : 'text-[#5B6569] hover:text-[#172125]'}`}>{label}</button>
            ))}
          </div>
          {draft.range === 'custom' && (
            <div className="flex items-center gap-2 text-[12.5px] text-[#6B7280]">
              <input type="date" aria-label="From date" className={`${field} h-9 w-[150px]`} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
              <span>to</span>
              <input type="date" aria-label="To date" className={`${field} h-9 w-[150px]`} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={clear} className="h-9 rounded-lg px-3 text-[13px] font-medium text-[#5B6569] hover:bg-[#F7F3EF]">Clear{activeCount ? ` (${activeCount})` : ''}</button>
            <button type="button" onClick={exportCsv} disabled={exporting} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E7DED5] bg-white px-3 text-[13px] font-semibold text-[#172125] hover:border-[#FA4616] hover:text-[#FA4616] disabled:opacity-60"><Icon name="download" className="h-4 w-4" />{exporting ? 'Exporting…' : 'Export CSV'}</button>
            <button type="submit" className="h-9 rounded-lg bg-[#FA4616] px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-[#E03D10]">Apply</button>
          </div>
        </div>
      </form>

      {error && <p className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B91C1C]" role="alert">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-[#EFE6DD] bg-white shadow-[0_10px_30px_-24px_rgba(120,60,20,0.45)]">
        {!data ? <div className="p-3"><SkeletonRows rows={8} cols={5} label="Loading audit events" /></div> : data.data.length === 0 ? (
          <div className="grid place-items-center px-6 py-16 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#FFF1EB] text-[#FA4616]"><Icon name="audit" className="h-6 w-6" /></span>
            <p className="mt-3 text-[15px] font-semibold text-[#172125]">No audit events match</p>
            <p className="mt-1 text-[13px] text-[#6B7280]">Try a wider date range or clear the filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead className="border-b border-[#F1E9E1] bg-[#FBF8F5] text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
                <tr><th className="px-4 py-3">Time</th><th className="px-4 py-3">User</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Entity</th><th className="px-4 py-3">Result</th><th className="px-4 py-3">Source</th></tr>
              </thead>
              <tbody className="divide-y divide-[#F4EDE6]">
                {data.data.map((row) => (
                  <tr key={row.id} tabIndex={0} onClick={() => setSelected(row)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(row); } }}
                    className={`cursor-pointer align-middle transition-colors hover:bg-[#FFF8F3] focus:bg-[#FFF8F3] focus:outline-none ${selected?.id === row.id ? 'bg-[#FFF5EF]' : ''}`}>
                    <td className="whitespace-nowrap px-4 py-3"><span className="block text-[13px] font-medium text-[#172125]">{formatTime(row.createdAt)}</span><span className="block text-[11.5px] text-[#8A9397]">{relativeTime(row.createdAt)}</span></td>
                    <td className="max-w-[220px] px-4 py-3"><span className="flex min-w-0 items-center gap-2.5"><Avatar actor={row.actor} /><span className="min-w-0"><span className="block truncate text-[13.5px] font-medium text-[#172125]">{row.actor.name || row.actor.email || (row.actor.type === 'robot' ? 'Robot' : 'System')}</span><span className="block truncate text-[11.5px] text-[#8A9397]">{row.actor.email || row.actor.type}</span></span></span></td>
                    <td className="px-4 py-3"><span className="block text-[13.5px] font-medium text-[#172125]">{actionLabel(row.action)}</span><span className="mt-1 block"><CategoryChip action={row.action} /></span></td>
                    <td className="max-w-[260px] px-4 py-3"><EntityCell entity={row.entity} /></td>
                    <td className="px-4 py-3"><ResultBadge result={row.result} /></td>
                    <td className="max-w-[170px] px-4 py-3"><span className="block truncate text-[13px] text-[#172125]">{row.ip || '—'}</span><span className="block truncate text-[11.5px] text-[#8A9397]">{shortAgent(row.userAgent) || '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-[#F1E9E1] bg-[#FDFBF9] px-4 py-3 text-[13px] text-[#5B6569]">
          <span>{total ? `${offset + 1}–${Math.min(offset + pageSize, total)} of ${total.toLocaleString('en-IN')} events` : '0 events'}</span>
          <label className="ml-auto flex items-center gap-2">Rows
            <select aria-label="Rows per page" className="h-8 rounded-md border border-[#E7DED5] bg-white px-2 text-[13px]" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setOffset(0); }}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <span>Page {page} of {pageCount}</span>
          <button type="button" aria-label="Previous page" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))} className="grid h-8 w-8 place-items-center rounded-md border border-[#E7DED5] bg-white disabled:opacity-40"><Icon name="chevronRight" className="h-4 w-4 rotate-180" /></button>
          <button type="button" aria-label="Next page" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)} className="grid h-8 w-8 place-items-center rounded-md border border-[#E7DED5] bg-white disabled:opacity-40"><Icon name="chevronRight" className="h-4 w-4" /></button>
        </div>
      </div>

      <Drawer row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
