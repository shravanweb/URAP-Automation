import { useEffect, useState } from 'react';
import { api, currentUser } from '../services/api.js';
import { Modal } from './ui.jsx';
import { SkeletonRows } from './Loader.jsx';
import { formatTime, relativeTime } from './auditFormat.js';
import { ROLES, ROLE_INFO, SETTINGS_TABS, robotState, tabFromHash, temporaryPassword } from './settingsFormat.js';

const field = 'h-10 w-full rounded-lg border border-[#E7DED5] bg-white px-3 text-[13.5px] text-[#172125] shadow-sm focus:border-[#FA4616] focus:outline-none focus:ring-2 focus:ring-[#FA4616]/15 disabled:bg-[#F7F3EF] disabled:text-[#7A858B]';
const card = 'rounded-2xl border border-[#EFE7DF] bg-white p-5 shadow-[0_1px_2px_rgba(23,33,37,0.04)]';
const primary = 'h-10 rounded-lg bg-[#FA4616] px-4 text-[13px] font-semibold text-white hover:bg-[#E03C10] disabled:cursor-not-allowed disabled:opacity-50';
const ghost = 'h-9 rounded-lg border border-[#E7DED5] bg-white px-3 text-[12.5px] font-medium text-[#172125] hover:bg-[#FBF7F3] disabled:opacity-50';
const DOT = { online: 'bg-[#16A34A]', offline: 'bg-[#DC2626]', never: 'bg-[#CBD5E1]' };

function Row({ label, children, hint }) {
  return (
    <div className="grid gap-1 border-t border-[#F4EFEA] py-3 first:border-t-0 sm:grid-cols-[220px_1fr] sm:gap-4">
      <div><p className="text-[13px] font-medium text-[#172125]">{label}</p>{hint && <p className="text-[11.5px] text-[#7A858B]">{hint}</p>}</div>
      <div className="text-[13px] text-[#334247]">{children}</div>
    </div>
  );
}
function Configured({ ok, yes = 'Configured', no = 'Not configured' }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset ${ok ? 'bg-[#ECFDF3] text-[#15803D] ring-[#BBF7D0]' : 'bg-[#F4F1EE] text-[#5B6870] ring-[#E7DED5]'}`}><span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-[#16A34A]' : 'bg-[#9AA3A7]'}`} />{ok ? yes : no}</span>;
}
function Secret({ set }) {
  return <span className="font-mono text-[12.5px] text-[#5B6870]">{set ? '•••••••• (stored on the server, never shown)' : 'not set'}</span>;
}
function Section({ title, subtitle, children, action }) {
  return (
    <section className={card}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-[15px] font-semibold text-[#172125]">{title}</h2>{subtitle && <p className="mt-0.5 text-[12.5px] text-[#7A858B]">{subtitle}</p>}</div>{action}</div>
      {children}
    </section>
  );
}
function ReadOnlyNote({ canEdit }) {
  if (canEdit) return null;
  return <p className="rounded-lg bg-[#FFF7ED] px-3 py-2 text-[12.5px] text-[#9A3412]">Only administrators can change settings. You are viewing them read-only.</p>;
}

function General({ data, canEdit, act }) {
  const [name, setName] = useState(data.tenant.name);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <Section title="Workspace" subtitle="Basic details for this tenant.">
      <Row label="Workspace name" hint="Shown in the app header and emails.">
        <form className="flex max-w-lg gap-2" onSubmit={(e) => { e.preventDefault(); act(() => api('/api/settings/tenant', { method: 'PATCH', body: { name } }), 'Workspace name saved'); }}>
          <input className={field} value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} maxLength={200} aria-label="Workspace name" />
          {canEdit && <button className={primary} type="submit" disabled={name.trim().length < 2 || name.trim() === data.tenant.name}>Save</button>}
        </form>
      </Row>
      <Row label="Workspace ID"><span className="font-mono text-[12.5px]">{data.tenant.slug}</span></Row>
      <Row label="Project isolation" hint="Users only see projects they are members of."><Configured ok={data.tenant.isolationEnabled} yes="Enabled" no="Disabled" /></Row>
      <Row label="Time zone" hint="Times in the app use your browser time zone. The server stores UTC.">{tz} · server {data.server.timezone}</Row>
      <Row label="Environment">{data.server.environment}</Row>
      <Row label="Created">{formatTime(data.tenant.createdAt)}</Row>
    </Section>
  );
}

function Orchestration({ data }) {
  const o = data.orchestrator;
  return (
    <Section title="UiPath Orchestrator" subtitle="Connection used to start UiPath jobs. Values come from the server environment and are never sent to the browser." action={<Configured ok={o.configured} />}>
      <Row label="Orchestrator host">{o.host || <span className="text-[#7A858B]">not set</span>}</Row>
      <Row label="Access token"><Secret set={o.tokenConfigured} /></Row>
      <Row label="Release key"><Secret set={o.releaseKeyConfigured} /></Row>
      <Row label="Folder (organization unit)"><Configured ok={o.folderConfigured} yes="Set" no="Default folder" /></Row>
      <Row label="Test connection" hint="Checks reachability with the stored token.">
        <button className={ghost} type="button" disabled title="No test endpoint is available yet">Test connection</button>
        <p className="mt-1 text-[11.5px] text-[#7A858B]">{o.configured ? 'A connection test is not available yet. Run a job with the Orchestrator adapter to verify.' : 'Configure the values below first.'}</p>
      </Row>
      <Row label="Required settings" hint="Set these in the backend .env and restart the API.">
        <ul className="space-y-1 font-mono text-[12px]">{o.required.map((k) => <li key={k}>{k}</li>)}</ul>
      </Row>
      {!o.configured && <p className="mt-2 rounded-lg bg-[#F7F3EF] px-3 py-2 text-[12.5px] text-[#5B6870]">Without Orchestrator, robot work uses the local file handoff and the robot API.</p>}
    </Section>
  );
}

function Robots({ data, canEdit, act, setToken }) {
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({ adapter: 'contract_simulator', projectIds: [] });
  useEffect(() => { if (canEdit) api('/api/projects?limit=100&status=active').then((r) => setProjects(r.data)).catch(() => {}); }, [canEdit]);
  const online = data.robots.filter((r) => r.online).length;
  return (
    <div className="space-y-4">
      <Section title="Robots" subtitle={`${data.robots.length} registered · ${online} online. A robot is online when it sent a heartbeat in the last minute.`}>
        {data.robots.length === 0 ? <p className="py-6 text-center text-[13px] text-[#7A858B]">No robots registered yet.</p> : (
          <div className="overflow-x-auto"><table className="min-w-full text-[13px]">
            <thead className="bg-[#FBF7F3] text-left text-[11.5px] uppercase tracking-wide text-[#7A858B]"><tr>{['Robot', 'Status', 'Machine', 'Version', 'Adapter', 'Last heartbeat', 'Jobs run', ''].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{data.robots.map((r) => { const s = robotState(r); return (
              <tr key={r.id} className="border-t border-[#F4EFEA]">
                <td className="whitespace-nowrap px-3 py-2.5 font-medium">{r.name}{r.lastError && <span className="block max-w-[220px] truncate text-[11.5px] font-normal text-[#B91C1C]" title={r.lastError}>{r.lastError}</span>}</td>
                <td className="whitespace-nowrap px-3 py-2.5"><span className="inline-flex items-center gap-1.5 text-[12.5px]"><span className={`h-2 w-2 rounded-full ${DOT[s.tone]}`} />{s.label}</span></td>
                <td className="whitespace-nowrap px-3 py-2.5 text-[#5B6870]">{r.machine || '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px] text-[#5B6870]">{r.version || '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-[#5B6870]">{r.adapter.replaceAll('_', ' ')}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-[#5B6870]" title={r.lastHeartbeatAt ? formatTime(r.lastHeartbeatAt) : ''}>{r.lastHeartbeatAt ? relativeTime(r.lastHeartbeatAt) : 'never'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{r.jobsRun}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">{canEdit && <button className={`${ghost} whitespace-nowrap`} type="button" onClick={() => act(async () => { const res = await api(`/api/robots/${r.id}/rotate-token`, { method: 'POST' }); setToken({ name: r.name, token: res.data.token }); }, 'Token rotated')}>Rotate token</button>}</td>
              </tr>); })}</tbody>
          </table></div>
        )}
      </Section>
      {canEdit && (
        <Section title="Register a robot" subtitle="The robot token is shown once after registration.">
          <form className="grid gap-2 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); act(async () => { const res = await api('/api/robots', { method: 'POST', body: form }); setToken({ name: form.name, token: res.data.token }); }, 'Robot registered'); }}>
            <input className={field} placeholder="Robot name" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className={field} value={form.adapter} onChange={(e) => setForm({ ...form, adapter: e.target.value })}><option value="local_file_handoff">UiPath file handoff</option><option value="orchestrator">UiPath Orchestrator</option><option value="contract_simulator">Contract robot (npm run robot-simulator)</option></select>
            <select multiple aria-label="Projects" className={`${field} h-20 py-1`} value={form.projectIds} onChange={(e) => setForm({ ...form, projectIds: [...e.target.selectedOptions].map((o) => o.value) })}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <button className={primary} type="submit">Register robot</button>
          </form>
        </Section>
      )}
    </div>
  );
}

function Ai({ data }) {
  const a = data.ai;
  return (
    <Section title="AI provider" subtitle="Used by Ask AI, agents and document extraction. The API key stays on the server." action={<Configured ok={a.configured} />}>
      <Row label="Provider">{a.provider || <span className="text-[#7A858B]">not set</span>}</Row>
      <Row label="Model">{a.model || <span className="text-[#7A858B]">provider default</span>}</Row>
      <Row label="Endpoint host">{a.host || <span className="text-[#7A858B]">provider default</span>}</Row>
      <Row label="API key"><Secret set={a.keyConfigured} /></Row>
      <Row label="How to change" hint="Restart the API after editing."><span className="font-mono text-[12px]">AI_PROVIDER, AI_MODEL, AI_BASE_URL, AI_API_KEY</span> in the backend .env</Row>
    </Section>
  );
}

function Security({ data }) {
  const s = data.security;
  return (
    <Section title="Security" subtitle="Session, password and rate-limit policy enforced by the API. Changed through server configuration.">
      <Row label="Session length">{s.accessTokenMinutes} min access token · {s.refreshTokenDays} day refresh token</Row>
      <Row label="Password policy">{s.passwordRule}</Row>
      <Row label="Password hashing">bcrypt, cost {s.bcryptRounds}</Row>
      <Row label="Sign-in rate limit">{s.authRateLimitPerMinute} attempts per minute per IP</Row>
      <Row label="API rate limit">{s.rateLimitPerMinute} requests per minute · token refresh {s.refreshRateLimitPerMinute}/min</Row>
      <Row label="Self sign-up"><Configured ok={s.signupEnabled} yes="Allowed" no="Disabled" />{s.signupEnabled && <span className="ml-2 text-[12px] text-[#7A858B]">{s.signupRateLimitPerHour} per hour per IP</span>}</Row>
      <Row label="Allowed origins (CORS)"><ul className="font-mono text-[12px]">{s.corsOrigins.map((o) => <li key={o}>{o}</li>)}</ul></Row>
    </Section>
  );
}

function Users({ data, canEdit, act, setResetInfo }) {
  const me = currentUser();
  const [users, setUsers] = useState(null);
  const [newUser, setNewUser] = useState({ role: 'operator' });
  const load = () => api('/api/users').then((r) => setUsers(r.data));
  useEffect(() => { if (canEdit) load().catch(() => setUsers([])); }, [canEdit]);
  const run = (work, msg) => act(async () => { await work(); await load(); }, msg);
  return (
    <div className="space-y-4">
      <Section title="Roles" subtitle="What each role can do, and how many people have it.">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{ROLES.map((r) => (
          <div key={r} className="rounded-xl border border-[#F1EBE5] bg-[#FFFBF8] p-3">
            <p className="text-[13px] font-semibold capitalize">{r.replaceAll('_', ' ')}</p>
            <p className="mt-1 text-[22px] font-semibold">{data.roleCounts[r]?.active || 0}</p>
            <p className="text-[11.5px] text-[#7A858B]">{ROLE_INFO[r]}{data.roleCounts[r]?.disabled ? ` · ${data.roleCounts[r].disabled} disabled` : ''}</p>
          </div>
        ))}</div>
      </Section>
      {canEdit && (
        <Section title="Users" subtitle="Create users, change roles, disable access and reset passwords.">
          {!users ? <SkeletonRows rows={4} cols={3} /> : (
            <ul className="divide-y divide-[#F4EFEA]">{users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13px]">
                <span><span className="font-medium">{u.displayName}</span> <span className="text-[#7A858B]">· {u.email}</span>{u.status !== 'active' && <span className="ml-2 rounded-full bg-[#F4F1EE] px-2 py-0.5 text-[11px] text-[#5B6870]">disabled</span>}</span>
                <span className="flex gap-1.5">
                  <select className={`${field} h-9 w-auto`} value={u.role} disabled={u.id === me?.id} onChange={(e) => run(() => api(`/api/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } }), 'Role updated')}>{ROLES.map((r) => <option key={r} value={r}>{r.replaceAll('_', ' ')}</option>)}</select>
                  {u.id !== me?.id && <button className={ghost} type="button" onClick={() => run(() => api(`/api/users/${u.id}`, { method: 'PATCH', body: { status: u.status === 'active' ? 'disabled' : 'active' } }), 'User updated')}>{u.status === 'active' ? 'Disable' : 'Enable'}</button>}
                  {u.id !== me?.id && <button className={`${ghost} whitespace-nowrap`} type="button" onClick={() => { const password = temporaryPassword(); run(async () => { await api(`/api/users/${u.id}`, { method: 'PATCH', body: { password } }); setResetInfo({ email: u.email, password }); }, 'Password reset'); }}>Reset password</button>}
                </span>
              </li>
            ))}</ul>
          )}
          <form className="mt-3 grid gap-2 md:grid-cols-5" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/api/users', { method: 'POST', body: newUser }); setNewUser({ role: 'operator' }); }, 'User created'); }}>
            <input className={field} placeholder="Email" value={newUser.email || ''} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
            <input className={field} placeholder="Display name" value={newUser.displayName || ''} onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })} />
            <input className={field} placeholder="Temporary password, 12+ characters" type="password" autoComplete="new-password" value={newUser.password || ''} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
            <select className={field} value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{r.replaceAll('_', ' ')}</option>)}</select>
            <button className={primary} type="submit">Create user</button>
          </form>
        </Section>
      )}
    </div>
  );
}

export function SettingsView({ data, tab, onTab, canEdit, act = () => {}, setToken = () => {}, setResetInfo = () => {} }) {
  return (
    <div className="space-y-4">
      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-[#EFE7DF] bg-white p-1" role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => onTab(t.id)} className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-[13px] font-medium transition ${tab === t.id ? 'bg-[#FFF1EB] text-[#E03C10]' : 'text-[#5B6870] hover:bg-[#FBF7F3] hover:text-[#172125]'}`}>{t.label}</button>)}
      </nav>
      <ReadOnlyNote canEdit={canEdit} />
      {tab === 'general' && <General data={data} canEdit={canEdit} act={act} />}
      {tab === 'orchestration' && <Orchestration data={data} />}
      {tab === 'robots' && <Robots data={data} canEdit={canEdit} act={act} setToken={setToken} />}
      {tab === 'ai' && <Ai data={data} />}
      {tab === 'security' && <Security data={data} />}
      {tab === 'users' && <Users data={data} canEdit={canEdit} act={act} setResetInfo={setResetInfo} />}
    </div>
  );
}

export default function SettingsTabs() {
  const [tab, setTab] = useState(() => tabFromHash(typeof window !== 'undefined' ? window.location.hash : ''));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [token, setToken] = useState(null);
  const [resetInfo, setResetInfo] = useState(null);
  const load = () => api('/api/settings/overview').then((r) => { setData(r.data); setError(''); });
  useEffect(() => { load().catch((err) => setError(err.message)); }, []);
  useEffect(() => { const sync = () => setTab(tabFromHash(window.location.hash)); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync); }, []);
  const onTab = (id) => { setTab(id); setMessage(''); window.history.replaceState(null, '', `#${id}`); };
  async function act(work, done) {
    try { await work(); setError(''); setMessage(done); await load(); } catch (err) { setMessage(''); setError(err.message); }
  }
  if (!data) return error ? <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">{error}</p> : <SkeletonRows rows={6} cols={3} />;
  return (
    <>
      {error && <p className="mb-3 rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">{error}</p>}
      {message && <p className="mb-3 rounded-lg bg-[#ECFDF3] px-3 py-2 text-sm text-[#15803D]">{message}</p>}
      <SettingsView data={data} tab={tab} onTab={onTab} canEdit={data.canEdit} act={act} setToken={setToken} setResetInfo={setResetInfo} />
      {resetInfo && (
        <Modal title={`Temporary password · ${resetInfo.email}`} onClose={() => setResetInfo(null)}>
          <p className="text-sm">Share this password with the user over a trusted channel. It is not shown again. Their existing sessions were signed out.</p>
          <pre className="mt-2 select-all break-all rounded bg-mist p-2 font-mono text-sm">{resetInfo.password}</pre>
        </Modal>
      )}
      {token && (
        <Modal title={`Robot token · ${token.name}`} onClose={() => setToken(null)}>
          <p className="text-sm">Copy this token now. It is stored only as a hash and will not be shown again.</p>
          <pre className="mt-2 select-all break-all rounded bg-mist p-2 font-mono text-xs">{token.token}</pre>
          <p className="mt-2 text-xs text-muted">Contract robot: set ROBOT_TOKEN to this value and run npm run robot-simulator in backend.</p>
        </Modal>
      )}
    </>
  );
}
