import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, currentUser } from '../services/api.js';
import { Modal } from '../components/ui.jsx';
import { SkeletonRows } from '../components/Loader.jsx';
import { formatTime, relativeTime } from '../components/auditFormat.js';
import { fillSeries, pageWindow } from '../components/reportsFormat.js';
import { WORKSPACE_SORTS, actionLabel, confirmCopy, userQuery, workspaceQuery } from '../components/platformFormat.js';

const card = 'rounded-2xl border border-[#EFE7DF] bg-white p-4 shadow-[0_1px_2px_rgba(23,33,37,0.04)]';
const field = 'h-10 rounded-lg border border-[#E7DED5] bg-white px-3 text-[13.5px] text-[#172125] shadow-sm focus:border-[#FA4616] focus:outline-none focus:ring-2 focus:ring-[#FA4616]/15';
const ghost = 'h-8 whitespace-nowrap rounded-lg border border-[#E7DED5] bg-white px-2.5 text-[12px] font-medium text-[#172125] hover:bg-[#FBF7F3] disabled:opacity-40';
const th = 'whitespace-nowrap px-3 py-2 text-left text-[11.5px] font-medium uppercase tracking-wide text-[#7A858B]';
const td = 'whitespace-nowrap px-3 py-2.5';
const TITLES = { overview: ['Platform overview', 'Every workspace on this installation. Visible only to super admins.'], workspaces: ['Workspaces', 'All tenants, including self sign-up workspaces.'], workspace: ['Workspace details', 'Read-only view. Secrets, connection values and file contents are never shown.'], users: ['All users', 'Every account across all workspaces.'], audit: ['Platform audit log', 'Actions taken by super admins.'] };

function Status({ value }) {
  const tone = value === 'suspended' || value === 'disabled' ? 'bg-[#FEF2F2] text-[#B91C1C] ring-[#FECACA]' : 'bg-[#ECFDF3] text-[#15803D] ring-[#BBF7D0]';
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ring-inset ${tone}`}>{value}</span>;
}
function Kpi({ label, value, hint, tone = '#172125' }) {
  return <div className={card}><p className="text-[12px] font-medium uppercase tracking-wide text-[#7A858B]">{label}</p><p className="mt-1 text-[26px] font-semibold leading-tight" style={{ color: tone }}>{value ?? '…'}</p>{hint && <p className="mt-0.5 text-[12px] text-[#7A858B]">{hint}</p>}</div>;
}
function Pager({ meta, onPage }) {
  if (!meta) return null;
  const win = pageWindow(meta.offset, meta.limit, meta.total);
  return (
    <div className="flex items-center justify-between border-t border-[#F1EBE5] px-4 py-2.5 text-[12.5px] text-[#5B6870]">
      <span>{win.from}–{win.to} of {meta.total.toLocaleString()}</span>
      <span className="flex items-center gap-2"><button type="button" className={ghost} disabled={meta.offset === 0} onClick={() => onPage(Math.max(0, meta.offset - meta.limit))}>Previous</button>Page {win.page} of {win.pages}<button type="button" className={ghost} disabled={meta.offset + meta.limit >= meta.total} onClick={() => onPage(meta.offset + meta.limit)}>Next</button></span>
    </div>
  );
}

// One confirm dialog for every platform action; the request carries confirm: true.
function useConfirm(onDone) {
  const [pending, setPending] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const ask = (action, label, url) => { setPending({ action, label, url }); setReason(''); setError(''); };
  const dialog = pending && (() => {
    const [title, body, cta] = confirmCopy(pending.action, pending.label);
    const danger = ['suspend', 'disable', 'revoke'].includes(pending.action);
    return (
      <Modal title={title} onClose={() => setPending(null)}>
        <p className="text-[13.5px] text-[#334247]">{body}</p>
        {pending.action === 'suspend' && <input className={`${field} mt-3 w-full`} placeholder="Reason (optional, kept in the platform audit log)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
        {error && <p className="mt-2 text-sm text-[#B91C1C]">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="h-10 rounded-lg border border-[#E7DED5] px-4 text-[13px]" onClick={() => setPending(null)}>Cancel</button>
          <button type="button" className={`h-10 rounded-lg px-4 text-[13px] font-semibold text-white ${danger ? 'bg-[#DC2626] hover:bg-[#B91C1C]' : 'bg-[#FA4616] hover:bg-[#E03C10]'}`} onClick={async () => {
            try { await api(pending.url, { method: 'POST', body: { confirm: true, ...(reason.trim() ? { reason: reason.trim() } : {}) } }); setPending(null); onDone(); } catch (err) { setError(err.message); }
          }}>{cta}</button>
        </div>
      </Modal>
    );
  })();
  return [ask, dialog];
}

export function SignupChart({ points }) {
  const w = 640; const h = 160; const pad = 22;
  const max = Math.max(1, ...points.map((p) => p.total));
  const step = (w - pad * 2) / Math.max(1, points.length);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-44 w-full" role="img" aria-label="New workspaces per day">
      {[0, 0.5, 1].map((f) => <g key={f}><line x1={pad} x2={w - pad} y1={h - pad - f * (h - pad * 2)} y2={h - pad - f * (h - pad * 2)} stroke="#F1EBE5" /><text x={2} y={h - pad - f * (h - pad * 2) + 4} fontSize="10" fill="#9AA3A7">{Math.round(max * f)}</text></g>)}
      {points.map((p, i) => { const bh = (p.total / max) * (h - pad * 2); return <rect key={p.day} x={pad + i * step + step * 0.2} y={h - pad - bh} width={step * 0.6} height={bh} rx="2" fill="#FA4616" opacity={p.total ? 0.85 : 0} />; })}
      {points.length > 0 && [0, Math.floor(points.length / 2), points.length - 1].map((i) => <text key={i} x={pad + i * step + step / 2} y={h - 5} fontSize="10" textAnchor="middle" fill="#9AA3A7">{points[i].day.slice(5)}</text>)}
    </svg>
  );
}

function Overview() {
  const [data, setData] = useState(null); const [error, setError] = useState('');
  useEffect(() => { api('/api/platform/overview').then((r) => setData(r.data)).catch((e) => setError(e.message)); }, []);
  const k = data?.kpis || {};
  const points = data ? fillSeries(data.signups.map((s) => ({ day: s.day, total: s.workspaces, succeeded: 0, failed: 0 })), 30) : [];
  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Workspaces" value={k.workspaces} hint={data ? `${k.suspended} suspended` : ''} />
        <Kpi label="Users" value={k.users} hint={data ? `${k.active7d} active in the last 7 days` : ''} />
        <Kpi label="Projects" value={k.projects} hint={data ? `${k.workflows} workflows` : ''} />
        <Kpi label="Robots online" value={k.robotsOnline} hint={data ? `of ${k.robots} registered` : ''} tone="#15803D" />
        <Kpi label="Jobs today" value={k.jobsToday} hint="UTC day" tone="#E03C10" />
        <Kpi label="Jobs (7 days)" value={k.jobs7d} />
        <Kpi label="Failures (7 days)" value={k.failures7d} tone="#B91C1C" hint={data && k.jobs7d ? `${Math.round((k.failures7d / k.jobs7d) * 100)}% of jobs` : ''} />
        <Kpi label="Active users (7d)" value={k.active7d} hint="signed in at least once" />
      </div>
      <div className={card}>
        <div className="mb-2 flex items-center justify-between"><h2 className="text-[14px] font-semibold">New workspaces, last 30 days</h2><Link to="/platform/workspaces" className="text-[12.5px] font-medium text-[#E03C10] hover:underline">All workspaces →</Link></div>
        {data ? <SignupChart points={points} /> : <div className="h-44 animate-pulse rounded-lg bg-[#F7F3EF]" />}
      </div>
    </div>
  );
}

function Workspaces() {
  const [f, setF] = useState({ q: '', status: '', sort: 'created', dir: 'desc', limit: 25, offset: 0 });
  const [res, setRes] = useState(null); const [error, setError] = useState(''); const [tick, setTick] = useState(0);
  const [ask, dialog] = useConfirm(() => setTick((n) => n + 1));
  useEffect(() => { const id = setTimeout(() => api(`/api/platform/workspaces?${workspaceQuery(f)}`).then(setRes).catch((e) => setError(e.message)), 200); return () => clearTimeout(id); }, [f, tick]);
  const me = currentUser();
  const set = (patch) => setF((x) => ({ ...x, ...patch, offset: 0 }));
  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">{error}</p>}
      <div className={`${card} flex flex-wrap gap-2`}>
        <input className={`${field} min-w-[240px] flex-1`} placeholder="Search name, ID or member email" value={f.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search workspaces" />
        <select className={field} value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="suspended">Suspended</option></select>
        <select className={field} value={f.sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort">{WORKSPACE_SORTS.map(([v, l]) => <option key={v} value={v}>Sort: {l}</option>)}</select>
        <button type="button" className={`${field} font-medium`} onClick={() => set({ dir: f.dir === 'asc' ? 'desc' : 'asc' })}>{f.dir === 'asc' ? '↑ Ascending' : '↓ Descending'}</button>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[#EFE7DF] bg-white">
        {!res ? <div className="p-4"><SkeletonRows rows={6} cols={6} /></div> : res.data.length === 0 ? <p className="px-4 py-10 text-center text-sm text-[#7A858B]">No workspaces match.</p> : (
          <div className="overflow-x-auto"><table className="min-w-full text-[13px]">
            <thead className="bg-[#FBF7F3]"><tr>{['Workspace', 'Owner admin', 'Created', 'Users', 'Projects', 'Jobs 30d', 'Last activity', 'Status', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{res.data.map((w) => (
              <tr key={w.id} className="border-t border-[#F4EFEA] hover:bg-[#FFFBF8]">
                <td className={td}><Link to={`/platform/workspaces/${w.id}`} className="font-medium text-[#172125] hover:text-[#E03C10]">{w.name}</Link><span className="block font-mono text-[11px] text-[#9AA3A7]">{w.id.slice(0, 8)} · {w.slug}</span></td>
                <td className={`${td} text-[#5B6870]`}>{w.ownerEmail || '—'}</td>
                <td className={`${td} text-[#5B6870]`} title={formatTime(w.createdAt)}>{relativeTime(w.createdAt)}</td>
                <td className={`${td} tabular-nums`}>{w.users}</td><td className={`${td} tabular-nums`}>{w.projects}</td><td className={`${td} tabular-nums`}>{w.jobs30d}</td>
                <td className={`${td} text-[#5B6870]`}>{w.lastActivityAt ? relativeTime(w.lastActivityAt) : 'never'}</td>
                <td className={td}><Status value={w.status} /></td>
                <td className={`${td} text-right`}>{w.id !== me?.tenantId && (w.status === 'active'
                  ? <button type="button" className={`${ghost} text-[#B91C1C]`} onClick={() => ask('suspend', w.name, `/api/platform/workspaces/${w.id}/suspend`)}>Suspend</button>
                  : <button type="button" className={ghost} onClick={() => ask('reactivate', w.name, `/api/platform/workspaces/${w.id}/reactivate`)}>Reactivate</button>)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <Pager meta={res?.meta} onPage={(offset) => setF((x) => ({ ...x, offset }))} />
      </div>
      {dialog}
    </div>
  );
}

function UserActions({ u, ask }) {
  const me = currentUser();
  if (u.id === me?.id) return <span className="text-[11.5px] text-[#9AA3A7]">you</span>;
  return (
    <span className="flex justify-end gap-1.5">
      {u.status === 'active' ? <button type="button" className={`${ghost} text-[#B91C1C]`} disabled={u.isSuperAdmin} title={u.isSuperAdmin ? 'Revoke super admin first' : ''} onClick={() => ask('disable', u.email, `/api/platform/users/${u.id}/disable`)}>Disable</button>
        : <button type="button" className={ghost} onClick={() => ask('enable', u.email, `/api/platform/users/${u.id}/enable`)}>Enable</button>}
      {u.isSuperAdmin ? <button type="button" className={ghost} onClick={() => ask('revoke', u.email, `/api/platform/users/${u.id}/revoke-super-admin`)}>Revoke super admin</button>
        : <button type="button" className={ghost} disabled={u.status !== 'active'} onClick={() => ask('grant', u.email, `/api/platform/users/${u.id}/grant-super-admin`)}>Make super admin</button>}
    </span>
  );
}

function WorkspaceDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [tick, setTick] = useState(0);
  const [ask, dialog] = useConfirm(() => setTick((n) => n + 1));
  useEffect(() => { api(`/api/platform/workspaces/${id}`).then((r) => setData(r.data)).catch((e) => setError(e.message)); }, [id, tick]);
  if (!data) return error ? <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">{error}</p> : <SkeletonRows rows={6} cols={4} />;
  const w = data.workspace; const own = w.id === currentUser()?.tenantId;
  const Table = ({ title, heads, rows, empty }) => (
    <div className="overflow-hidden rounded-2xl border border-[#EFE7DF] bg-white"><h2 className="border-b border-[#F1EBE5] px-4 py-3 text-[14px] font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="px-4 py-6 text-center text-[13px] text-[#7A858B]">{empty}</p> : <div className="overflow-x-auto"><table className="min-w-full text-[13px]"><thead className="bg-[#FBF7F3]"><tr>{heads.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>}
    </div>
  );
  return (
    <div className="space-y-4">
      <Link to="/platform/workspaces" className="text-[12.5px] font-medium text-[#E03C10] hover:underline">← All workspaces</Link>
      <div className={`${card} flex flex-wrap items-start justify-between gap-3`}>
        <div><h2 className="text-[18px] font-semibold">{w.name} <Status value={w.status} /></h2><p className="mt-1 font-mono text-[12px] text-[#7A858B]">{w.id} · {w.slug}</p>
          <p className="mt-1 text-[12.5px] text-[#5B6870]">Created {formatTime(w.createdAt)} · owner {w.ownerEmail || '—'} · {w.users} users · {w.projects} projects · {w.jobs30d} jobs in 30 days</p>
          {w.status === 'suspended' && <p className="mt-1 text-[12.5px] text-[#B91C1C]">Suspended {formatTime(w.suspendedAt)}{w.suspendedReason ? ` · ${w.suspendedReason}` : ''}</p>}</div>
        {!own && (w.status === 'active' ? <button type="button" className="h-10 rounded-lg bg-[#DC2626] px-4 text-[13px] font-semibold text-white hover:bg-[#B91C1C]" onClick={() => ask('suspend', w.name, `/api/platform/workspaces/${w.id}/suspend`)}>Suspend workspace</button>
          : <button type="button" className="h-10 rounded-lg bg-[#FA4616] px-4 text-[13px] font-semibold text-white" onClick={() => ask('reactivate', w.name, `/api/platform/workspaces/${w.id}/reactivate`)}>Reactivate</button>)}
      </div>
      <Table title="Members" heads={['Name', 'Email', 'Role', 'Status', 'Last sign-in', '']} empty="No members" rows={data.members.map((m) => <tr key={m.id} className="border-t border-[#F4EFEA]"><td className={`${td} font-medium`}>{m.name}{m.isSuperAdmin && <span className="ml-1.5 rounded bg-[#FFF1EB] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#E03C10]">SUPER ADMIN</span>}</td><td className={td}>{m.email}</td><td className={`${td} capitalize`}>{m.role.replaceAll('_', ' ')}</td><td className={td}><Status value={m.status} /></td><td className={`${td} text-[#5B6870]`}>{m.lastLoginAt ? relativeTime(m.lastLoginAt) : 'never'}</td><td className={td}><UserActions u={m} ask={ask} /></td></tr>)} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Table title="Projects" heads={['Project', 'Status', 'Workflows', 'Members', 'Created']} empty="No projects" rows={data.projects.map((p) => <tr key={p.id} className="border-t border-[#F4EFEA]"><td className={`${td} font-medium`}>{p.name}</td><td className={`${td} capitalize`}>{p.status}</td><td className={td}>{p.workflows}</td><td className={td}>{p.members}</td><td className={`${td} text-[#5B6870]`}>{relativeTime(p.createdAt)}</td></tr>)} />
        <Table title="Robots" heads={['Robot', 'Adapter', 'Status', 'Last heartbeat']} empty="No robots" rows={data.robots.map((r) => <tr key={r.id} className="border-t border-[#F4EFEA]"><td className={`${td} font-medium`}>{r.name}</td><td className={td}>{r.adapter.replaceAll('_', ' ')}</td><td className={td}>{r.online ? 'Online' : 'Offline'}</td><td className={`${td} text-[#5B6870]`}>{r.lastHeartbeatAt ? relativeTime(r.lastHeartbeatAt) : 'never'}</td></tr>)} />
      </div>
      <Table title="Recent jobs" heads={['Job', 'Workflow', 'Project', 'Status', 'Trigger', 'Created']} empty="No jobs yet" rows={data.jobs.map((j) => <tr key={j.id} className="border-t border-[#F4EFEA]"><td className={`${td} font-mono text-[12px]`}>{j.id.slice(0, 8)}</td><td className={td}>{j.workflow || '—'}</td><td className={td}>{j.project || '—'}</td><td className={td}>{j.status.toLowerCase()}</td><td className={td}>{j.trigger}</td><td className={`${td} text-[#5B6870]`}>{relativeTime(j.createdAt)}</td></tr>)} />
      <Table title="Audit trail (latest 50)" heads={['When', 'Who', 'Action', 'Entity', 'Result']} empty="No audit events" rows={data.audit.map((a) => <tr key={a.id} className="border-t border-[#F4EFEA]"><td className={`${td} text-[#5B6870]`} title={formatTime(a.createdAt)}>{relativeTime(a.createdAt)}</td><td className={td}>{a.actorEmail || 'system'}</td><td className={`${td} font-mono text-[12px]`}>{a.action}</td><td className={td}>{a.entityType}</td><td className={td}>{a.result}</td></tr>)} />
      {dialog}
    </div>
  );
}

function Users() {
  const [f, setF] = useState({ q: '', role: '', status: '', superAdmin: false, limit: 25, offset: 0 });
  const [res, setRes] = useState(null); const [error, setError] = useState(''); const [tick, setTick] = useState(0);
  const [ask, dialog] = useConfirm(() => setTick((n) => n + 1));
  useEffect(() => { const id = setTimeout(() => api(`/api/platform/users?${userQuery(f)}`).then(setRes).catch((e) => setError(e.message)), 200); return () => clearTimeout(id); }, [f, tick]);
  const set = (patch) => setF((x) => ({ ...x, ...patch, offset: 0 }));
  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">{error}</p>}
      <div className={`${card} flex flex-wrap gap-2`}>
        <input className={`${field} min-w-[240px] flex-1`} placeholder="Search name, email or workspace" value={f.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search users" />
        <select className={field} value={f.role} onChange={(e) => set({ role: e.target.value })} aria-label="Role"><option value="">Any role</option>{['administrator', 'project_manager', 'automation_developer', 'operator', 'viewer'].map((r) => <option key={r} value={r}>{r.replaceAll('_', ' ')}</option>)}</select>
        <select className={field} value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="disabled">Disabled</option></select>
        <label className="flex items-center gap-2 text-[13px] text-[#5B6870]"><input type="checkbox" checked={f.superAdmin} onChange={(e) => set({ superAdmin: e.target.checked })} />Super admins only</label>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[#EFE7DF] bg-white">
        {!res ? <div className="p-4"><SkeletonRows rows={6} cols={6} /></div> : res.data.length === 0 ? <p className="px-4 py-10 text-center text-sm text-[#7A858B]">No users match.</p> : (
          <div className="overflow-x-auto"><table className="min-w-full text-[13px]">
            <thead className="bg-[#FBF7F3]"><tr>{['Name', 'Email', 'Workspace', 'Role', 'Created', 'Last sign-in', 'Status', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{res.data.map((u) => (
              <tr key={u.id} className="border-t border-[#F4EFEA] hover:bg-[#FFFBF8]">
                <td className={`${td} font-medium`}>{u.name}{u.isSuperAdmin && <span className="ml-1.5 rounded bg-[#FFF1EB] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#E03C10]">SUPER ADMIN</span>}</td>
                <td className={td}>{u.email}</td>
                <td className={td}><Link className="hover:text-[#E03C10]" to={`/platform/workspaces/${u.workspace.id}`}>{u.workspace.name}</Link>{u.workspace.status === 'suspended' && <span className="ml-1 text-[11px] text-[#B91C1C]">(suspended)</span>}</td>
                <td className={`${td} capitalize`}>{u.role.replaceAll('_', ' ')}</td>
                <td className={`${td} text-[#5B6870]`}>{relativeTime(u.createdAt)}</td>
                <td className={`${td} text-[#5B6870]`}>{u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'never'}</td>
                <td className={td}><Status value={u.status} /></td>
                <td className={td}><UserActions u={u} ask={ask} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <Pager meta={res?.meta} onPage={(offset) => setF((x) => ({ ...x, offset }))} />
      </div>
      {dialog}
    </div>
  );
}

function Audit() {
  const [offset, setOffset] = useState(0); const [res, setRes] = useState(null); const [error, setError] = useState('');
  useEffect(() => { api(`/api/platform/audit?limit=50&offset=${offset}`).then(setRes).catch((e) => setError(e.message)); }, [offset]);
  return (
    <div className="overflow-hidden rounded-2xl border border-[#EFE7DF] bg-white">
      {error && <p className="px-4 py-2 text-sm text-[#B91C1C]">{error}</p>}
      {!res ? <div className="p-4"><SkeletonRows rows={6} cols={5} /></div> : res.data.length === 0 ? <p className="px-4 py-10 text-center text-sm text-[#7A858B]">No platform actions yet.</p> : (
        <div className="overflow-x-auto"><table className="min-w-full text-[13px]">
          <thead className="bg-[#FBF7F3]"><tr>{['When', 'Super admin', 'Action', 'Target', 'Details', 'IP'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{res.data.map((r) => <tr key={r.id} className="border-t border-[#F4EFEA]"><td className={`${td} text-[#5B6870]`} title={formatTime(r.createdAt)}>{formatTime(r.createdAt)}</td><td className={td}>{r.actorEmail}</td><td className={`${td} font-medium`}>{actionLabel(r.action)}</td><td className={td}>{r.targetType === 'workspace' && r.targetId ? <Link className="hover:text-[#E03C10]" to={`/platform/workspaces/${r.targetId}`}>{r.targetLabel}</Link> : r.targetLabel}</td><td className={`${td} text-[#5B6870]`}>{r.metadata?.reason || ''}</td><td className={`${td} font-mono text-[12px] text-[#7A858B]`}>{r.ip || ''}</td></tr>)}</tbody>
        </table></div>
      )}
      <Pager meta={res?.meta} onPage={setOffset} />
    </div>
  );
}

export default function PlatformPage({ section }) {
  const [title, subtitle] = TITLES[section];
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#E03C10]">Super Admin</p><h1 className="text-2xl font-semibold">{title}</h1><p className="text-[13px] text-[#7A858B]">{subtitle}</p></div>
      </div>
      {{ overview: <Overview />, workspaces: <Workspaces />, workspace: <WorkspaceDetail />, users: <Users />, audit: <Audit /> }[section]}
    </section>
  );
}
