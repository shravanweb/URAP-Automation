import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from '../services/api.js';
import { SkeletonRows } from './Loader.jsx';
import { formatTime, relativeTime } from './auditFormat.js';
import { EMPTY_REPORT_FILTERS, REPORT_STATUSES, REPORT_TRIGGERS, fillSeries, formatDuration, pageWindow, reportQuery, seriesDays } from './reportsFormat.js';

const field = 'h-10 w-full rounded-lg border border-[#E7DED5] bg-white px-3 text-[13.5px] text-[#172125] shadow-sm focus:border-[#FA4616] focus:outline-none focus:ring-2 focus:ring-[#FA4616]/15';
const card = 'rounded-2xl border border-[#EFE7DF] bg-white p-4 shadow-[0_1px_2px_rgba(23,33,37,0.04)]';
const PAGE_SIZES = [25, 50, 100];
const STATUS_COLORS = { SUCCEEDED: '#16A34A', FAILED: '#DC2626', RUNNING: '#2563EB', QUEUED: '#F59E0B', CLAIMED: '#0EA5E9', RETRY_WAIT: '#F97316', CANCELLED: '#94A3B8', CANCEL_REQUESTED: '#A855F7', SKIPPED: '#CBD5E1', SUSPENDED: '#8B5CF6', DRAFT: '#E2E8F0' };
const STATUS_PILL = { SUCCEEDED: 'bg-[#ECFDF3] text-[#15803D] ring-[#BBF7D0]', FAILED: 'bg-[#FEF2F2] text-[#B91C1C] ring-[#FECACA]', RUNNING: 'bg-[#EFF6FF] text-[#1D4ED8] ring-[#BFDBFE]', QUEUED: 'bg-[#FFFBEB] text-[#B45309] ring-[#FDE68A]' };

function Pill({ status }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS_PILL[status] || 'bg-[#F4F1EE] text-[#5B6870] ring-[#E7DED5]'}`}>{status.replaceAll('_', ' ').toLowerCase()}</span>;
}

function Kpi({ label, value, hint, tone = '#172125' }) {
  return (
    <div className={card}>
      <p className="text-[12px] font-medium uppercase tracking-wide text-[#7A858B]">{label}</p>
      <p className="mt-1 text-[26px] font-semibold leading-tight" style={{ color: tone }}>{value}</p>
      {hint && <p className="mt-0.5 text-[12px] text-[#7A858B]">{hint}</p>}
    </div>
  );
}

export function TrendChart({ points }) {
  const w = 640; const h = 180; const pad = 24;
  const max = Math.max(1, ...points.map((p) => p.total));
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const x = (i) => pad + i * step;
  const y = (v) => h - pad - (v / max) * (h - pad * 2);
  const line = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const barW = Math.max(3, Math.min(18, step * 0.55 || 18));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-48 w-full" role="img" aria-label="Runs per day">
      {[0, 0.5, 1].map((t) => <g key={t}><line x1={pad} x2={w - pad} y1={y(max * t)} y2={y(max * t)} stroke="#F1EBE5" /><text x={4} y={y(max * t) + 4} fontSize="10" fill="#9AA3A7">{Math.round(max * t)}</text></g>)}
      {points.map((p, i) => <rect key={p.day} x={x(i) - barW / 2} y={y(p.total)} width={barW} height={Math.max(0, h - pad - y(p.total))} rx="2" fill="#FDE3D8" />)}
      <path d={line('succeeded')} fill="none" stroke="#16A34A" strokeWidth="2" />
      <path d={line('failed')} fill="none" stroke="#DC2626" strokeWidth="2" />
      {points.length > 0 && [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => <text key={i} x={x(i)} y={h - 6} fontSize="10" textAnchor="middle" fill="#9AA3A7">{points[i].day.slice(5)}</text>)}
    </svg>
  );
}

export function Donut({ items }) {
  const total = items.reduce((s, i) => s + i.count, 0);
  let acc = 0;
  const r = 52; const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label="Status breakdown">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#F4F1EE" strokeWidth="18" />
        {total > 0 && items.map((it) => { const len = (it.count / total) * c; const el = <circle key={it.status} cx="70" cy="70" r={r} fill="none" stroke={STATUS_COLORS[it.status] || '#94A3B8'} strokeWidth="18" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />; acc += len; return el; })}
        <text x="70" y="68" textAnchor="middle" fontSize="20" fontWeight="600" fill="#172125">{total}</text>
        <text x="70" y="86" textAnchor="middle" fontSize="10" fill="#7A858B">runs</text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1 text-[12.5px]">
        {items.map((it) => <li key={it.status} className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLORS[it.status] || '#94A3B8' }} />{it.status.replaceAll('_', ' ').toLowerCase()}</span><span className="font-medium tabular-nums">{it.count}</span></li>)}
        {!items.length && <li className="text-[#7A858B]">No runs in this range</li>}
      </ul>
    </div>
  );
}

function Bars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  if (!rows.length) return <p className="text-[13px] text-[#7A858B]">No runs in this range</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.id} className="text-[12.5px]">
          <div className="flex justify-between gap-2"><span className="truncate font-medium text-[#172125]">{r.name}</span><span className="shrink-0 tabular-nums text-[#5B6870]">{r.total} runs{r.failed ? ` · ${r.failed} failed` : ''}{r.avgDurationMs != null ? ` · avg ${formatDuration(r.avgDurationMs)}` : ''}</span></div>
          <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-[#F4F1EE]">
            <div className="bg-[#16A34A]" style={{ width: `${((r.succeeded ?? r.total - r.failed) / max) * 100}%` }} />
            <div className="bg-[#DC2626]" style={{ width: `${(r.failed / max) * 100}%` }} />
            {r.succeeded != null && <div className="bg-[#FDBA74]" style={{ width: `${((r.total - r.succeeded - r.failed) / max) * 100}%` }} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ReportsDashboard() {
  const [filters, setFilters] = useState(EMPTY_REPORT_FILTERS);
  const [projects, setProjects] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [page, setPage] = useState({ limit: 25, offset: 0 });
  const [error, setError] = useState('');
  const tz = -new Date().getTimezoneOffset();

  useEffect(() => {
    Promise.all([api('/api/projects?limit=100'), api('/api/workflows?limit=100')])
      .then(([p, w]) => { setProjects(p.data); setWorkflows(w.data); })
      .catch((err) => setError(err.message));
  }, []);
  useEffect(() => {
    setSummary(null);
    api(`/api/reports/summary?${reportQuery(filters, { tzOffset: tz })}`).then((r) => { setSummary(r.data); setError(''); }).catch((err) => setError(err.message));
  }, [filters]);
  useEffect(() => {
    setJobs(null);
    api(`/api/reports/jobs?${reportQuery(filters, page)}`).then((r) => setJobs(r)).catch((err) => setError(err.message));
  }, [filters, page]);

  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage((p) => ({ ...p, offset: 0 })); };
  const exportFile = (kind) => download(`/api/reports/export.${kind}?${reportQuery(filters)}`, `executions.${kind}`).catch((err) => setError(err.message));
  const visibleWorkflows = filters.projectId ? workflows.filter((w) => (w.projectId || w.project_id) === filters.projectId) : workflows;
  const k = summary?.kpis;
  const days = seriesDays(filters.range);
  const points = summary ? (days ? fillSeries(summary.series, days) : summary.series) : [];
  const win = pageWindow(page.offset, page.limit, jobs?.meta.total || 0);
  const filtered = Object.entries(filters).some(([key, v]) => v && v !== EMPTY_REPORT_FILTERS[key]);

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">{error}</p>}
      <div className={`${card} grid gap-2 md:grid-cols-3 xl:grid-cols-7`}>
        <select aria-label="Date range" className={field} value={filters.range} onChange={(e) => set({ range: e.target.value })}><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">All time</option><option value="custom">Custom range</option></select>
        {filters.range === 'custom' && <><input aria-label="From" type="date" className={field} value={filters.from} onChange={(e) => set({ from: e.target.value })} /><input aria-label="To" type="date" className={field} value={filters.to} onChange={(e) => set({ to: e.target.value })} /></>}
        <select aria-label="Project" className={field} value={filters.projectId} onChange={(e) => set({ projectId: e.target.value, workflowId: '' })}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label="Workflow" className={field} value={filters.workflowId} onChange={(e) => set({ workflowId: e.target.value })}><option value="">All workflows</option>{visibleWorkflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select aria-label="Status" className={field} value={filters.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any status</option>{REPORT_STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ').toLowerCase()}</option>)}</select>
        <select aria-label="Trigger" className={field} value={filters.trigger} onChange={(e) => set({ trigger: e.target.value })}><option value="">Any trigger</option>{REPORT_TRIGGERS.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <div className="flex gap-2 xl:col-span-1">
          <button type="button" className="h-10 flex-1 rounded-lg border border-[#E7DED5] bg-white px-3 text-[13px] font-medium hover:bg-[#FBF7F3]" onClick={() => exportFile('csv')}>CSV</button>
          <button type="button" className="h-10 flex-1 rounded-lg bg-[#FA4616] px-3 text-[13px] font-semibold text-white hover:bg-[#E03C10]" onClick={() => exportFile('xlsx')}>Excel</button>
        </div>
        {filtered && <button type="button" className="text-left text-[12.5px] font-medium text-[#E03C10] hover:underline md:col-span-3 xl:col-span-7" onClick={() => { setFilters(EMPTY_REPORT_FILTERS); setPage((p) => ({ ...p, offset: 0 })); }}>Clear filters</button>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Total runs" value={k ? k.total.toLocaleString() : '…'} hint={k ? `${k.active} active now` : ''} />
        <Kpi label="Success rate" value={k ? (k.successRate == null ? '—' : `${k.successRate}%`) : '…'} hint="of finished runs" tone="#15803D" />
        <Kpi label="Failed" value={k ? k.failed.toLocaleString() : '…'} hint={k && k.total ? `${Math.round((k.failed / k.total) * 100)}% of runs` : ''} tone="#B91C1C" />
        <Kpi label="Avg duration" value={k ? formatDuration(k.avgDurationMs) : '…'} hint="start to finish" />
        <Kpi label="Runs today" value={k ? k.today.toLocaleString() : '…'} hint="in your time zone" tone="#E03C10" />
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <div className={`${card} xl:col-span-2`}>
          <div className="mb-2 flex items-center justify-between"><h2 className="text-[14px] font-semibold">Runs over time</h2><span className="flex gap-3 text-[11.5px] text-[#5B6870]"><span className="flex items-center gap-1"><i className="h-0.5 w-3 bg-[#16A34A]" />succeeded</span><span className="flex items-center gap-1"><i className="h-0.5 w-3 bg-[#DC2626]" />failed</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-[#FDE3D8]" />total</span></span></div>
          {summary ? <TrendChart points={points} /> : <div className="h-48 animate-pulse rounded-lg bg-[#F7F3EF]" />}
        </div>
        <div className={card}><h2 className="mb-3 text-[14px] font-semibold">Status breakdown</h2>{summary ? <Donut items={summary.statuses} /> : <div className="h-36 animate-pulse rounded-lg bg-[#F7F3EF]" />}</div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className={card}><h2 className="mb-3 text-[14px] font-semibold">Top workflows</h2>{summary ? <Bars rows={summary.workflows} /> : <SkeletonRows rows={4} cols={2} />}</div>
        <div className={card}><h2 className="mb-3 text-[14px] font-semibold">Runs by project</h2>{summary ? <Bars rows={summary.projects} /> : <SkeletonRows rows={4} cols={2} />}</div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#EFE7DF] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F1EBE5] px-4 py-3">
          <h2 className="text-[14px] font-semibold">Job runs</h2>
          <span className="text-[12.5px] text-[#5B6870]">{jobs ? `${win.from}–${win.to} of ${jobs.meta.total.toLocaleString()}` : 'Loading…'}</span>
        </div>
        {!jobs ? <div className="p-4"><SkeletonRows rows={6} cols={6} /></div> : jobs.data.length === 0 ? <p className="px-4 py-10 text-center text-sm text-[#7A858B]">No job runs match these filters.</p> : (
          <div className="overflow-x-auto"><table className="min-w-full text-[13px]">
            <thead className="bg-[#FBF7F3] text-left text-[11.5px] uppercase tracking-wide text-[#7A858B]"><tr>{['Job', 'Workflow', 'Project', 'Status', 'Trigger', 'Started by', 'Robot', 'Started', 'Duration', 'Error'].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{jobs.data.map((j) => (
              <tr key={j.id} className="border-t border-[#F4EFEA] align-top hover:bg-[#FFFBF8]">
                <td className="px-3 py-2"><Link className="font-mono text-[#E03C10] hover:underline" to={`/jobs/${j.id}`}>{j.id.slice(0, 8)}</Link></td>
                <td className="px-3 py-2"><span className="font-medium">{j.workflow.name || '—'}</span>{j.workflow.version != null && <span className="ml-1 text-[11px] text-[#7A858B]">v{j.workflow.version}</span>}</td>
                <td className="px-3 py-2 text-[#5B6870]">{j.project.name || '—'}</td>
                <td className="px-3 py-2"><Pill status={j.status} /></td>
                <td className="px-3 py-2 text-[#5B6870]">{j.trigger}</td>
                <td className="px-3 py-2 text-[#5B6870]">{j.startedBy?.name || (j.trigger === 'schedule' ? 'Scheduler' : 'System')}</td>
                <td className="px-3 py-2 text-[#5B6870]">{j.robot?.name || (j.target === 'local' ? 'Server worker' : j.target)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-[#5B6870]" title={formatTime(j.startedAt || j.createdAt)}>{relativeTime(j.startedAt || j.createdAt)}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDuration(j.durationMs)}</td>
                <td className="max-w-[260px] px-3 py-2 text-[12px] text-[#B91C1C]"><span className="line-clamp-2" title={j.error || ''}>{j.error || ''}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#F1EBE5] px-4 py-2.5 text-[12.5px]">
          <label className="flex items-center gap-2 text-[#5B6870]">Rows<select className="h-8 rounded-md border border-[#E7DED5] bg-white px-2" value={page.limit} onChange={(e) => setPage({ limit: Number(e.target.value), offset: 0 })}>{PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <span className="flex items-center gap-2">
            <button type="button" className="h-8 rounded-md border border-[#E7DED5] px-3 disabled:opacity-40" disabled={page.offset === 0} onClick={() => setPage((p) => ({ ...p, offset: Math.max(0, p.offset - p.limit) }))}>Previous</button>
            <span className="text-[#5B6870]">Page {win.page} of {win.pages}</span>
            <button type="button" className="h-8 rounded-md border border-[#E7DED5] px-3 disabled:opacity-40" disabled={!jobs || page.offset + page.limit >= jobs.meta.total} onClick={() => setPage((p) => ({ ...p, offset: p.offset + p.limit }))}>Next</button>
          </span>
        </div>
      </div>
    </div>
  );
}
