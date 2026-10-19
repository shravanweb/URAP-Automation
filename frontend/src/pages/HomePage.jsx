import { useEffect, useState } from 'react';
import { AppCard } from './AppsPage.jsx';
import { Link, useNavigate } from 'react-router-dom';
import { api, currentUser } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import { timeAgo } from '../layouts/CloudLayout.jsx';
import { WORKFLOW_TEMPLATES, activityPacks } from '../lib/workflowTemplates.js';

// Signed-in home, laid out like an Automation Cloud home page in a light theme. Everything
// counted or listed comes from the API; template cards open real, validated workflows in the
// designer and activity packs are derived from the designer's activity catalog.

export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const PRODUCTS = [
  { to: '/studio', title: 'Studio', icon: 'studio', tile: 'bg-[#FFF1EC] text-[#D63A0C]', body: 'Design processes and workflows in a no-code canvas.' },
  { to: '/settings', title: 'Robots', icon: 'robot', tile: 'bg-[#E8F6F6] text-[#127C81]', body: 'Register robots, watch their heartbeat, and manage access.' },
  { to: '/tasks', title: 'Action Center', icon: 'tasks', tile: 'bg-[#F1EEFB] text-[#5B47B8]', body: 'Route approvals and forms to people, then resume the job.' },
  { to: '/jobs', title: 'Orchestrator', icon: 'orchestrator', tile: 'bg-[#EAF1FB] text-[#2F5FA8]', body: 'Run, schedule, and monitor jobs and queues centrally.' },
];

// Templates are real workflow definitions (lib/workflowTemplates.js, validated and run in
// backend/test/templates.test.js); "Try it" opens the designer pre-filled with their steps.
export const TEMPLATES = WORKFLOW_TEMPLATES.map((item) => ({ ...item, to: `/workflows/new?template=${item.key}` }));

// Activity packs come straight from the designer's activity catalog, with real counts.
const MARKETPLACE = activityPacks().map((pack) => ({ ...pack, meta: `${pack.count} ${pack.count === 1 ? 'activity' : 'activities'}` }));

// Features shipped in October 2026 (see the git history), each linking to its working page.
const WHATS_NEW = [
  { title: 'Redesigned Workflow Designer', body: 'Pan and zoom canvas, drag-and-drop activities, undo and redo, and code-style JSON properties.', link: 'Open the Designer', to: '/workflows/new', date: 'Oct 2026' },
  { title: 'BPMN processes', body: 'Model processes in BPMN 2.0, then publish and run them on the Flow engine with a live run monitor.', link: 'Model a process', to: '/studio?view=processes', date: 'Oct 2026' },
  { title: 'Cases', body: 'Case types with stages, tasks, SLAs, and escalations, plus a case workspace and board.', link: 'Open Cases', to: '/cases', date: 'Oct 2026' },
  { title: 'Apps', body: 'Build custom interfaces with data sources and actions, and share them with your team.', link: 'Browse apps', to: '/apps', date: 'Oct 2026' },
  { title: 'Agents', body: 'AI agents that call workflows, people, and APIs as tools, with a test chat and traces.', link: 'Build an agent', to: '/studio?view=agents', date: 'Oct 2026' },
  { title: 'Flow', body: 'Orchestrate robots, people, and APIs in one process with an editor and run monitor.', link: 'Open Flows', to: '/studio?view=flows', date: 'Oct 2026' },
];

const RESOURCES = [
  ['/workflows', 'Workflow Library', 'library'],
  ['/connections', 'Connections', 'link'],
  ['/queues', 'Queues', 'queue'],
  ['/reports', 'Reports', 'chart'],
  ['/audit', 'Audit Logs', 'audit'],
];

// Soft status pills: a colored dot and tinted background, readable at a glance.
const STATUS = {
  SUCCEEDED: ['Succeeded', 'bg-[#ECF7EF] text-[#1F6B3A]', 'bg-[#2E9E57]'],
  published: ['Published', 'bg-[#ECF7EF] text-[#1F6B3A]', 'bg-[#2E9E57]'],
  FAILED: ['Failed', 'bg-[#FDEEEC] text-[#A8261B]', 'bg-[#D9382B]'],
  RUNNING: ['Running', 'bg-[#EAF1FB] text-[#2F5FA8]', 'bg-[#3A75D0]'],
  CLAIMED: ['Starting', 'bg-[#EAF1FB] text-[#2F5FA8]', 'bg-[#3A75D0]'],
  QUEUED: ['Queued', 'bg-slate-100 text-slate-700', 'bg-slate-400'],
  RETRY_WAIT: ['Retry wait', 'bg-[#FDF5E6] text-[#8A5A0B]', 'bg-[#D99A1E]'],
  SUSPENDED: ['Waiting for task', 'bg-[#FDF5E6] text-[#8A5A0B]', 'bg-[#D99A1E]'],
  CANCEL_REQUESTED: ['Cancelling', 'bg-[#FDF5E6] text-[#8A5A0B]', 'bg-[#D99A1E]'],
  CANCELLED: ['Cancelled', 'bg-slate-100 text-slate-600', 'bg-slate-400'],
  WAITING: ['Waiting', 'bg-[#FDF5E6] text-[#8A5A0B]', 'bg-[#D99A1E]'],
  IDLE: ['Awaiting reply', 'bg-[#EEF4FF] text-[#3550B5]', 'bg-[#5B7BE0]'],
  draft: ['Draft', 'bg-slate-100 text-slate-700', 'bg-slate-400'],
  disabled: ['Disabled', 'bg-slate-100 text-slate-600', 'bg-slate-400'],
  archived: ['Archived', 'bg-slate-100 text-slate-600', 'bg-slate-400'],
};

export function StatusPill({ status }) {
  const [label, tone, dot] = STATUS[status] || [status, 'bg-slate-100 text-slate-700', 'bg-slate-400'];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />{label}
    </span>
  );
}

const PRIORITY = {
  critical: 'bg-[#FDEEEC] text-[#A8261B]',
  high: 'bg-[#FFF1EC] text-[#B8320A]',
  medium: 'bg-[#FDF5E6] text-[#8A5A0B]',
  low: 'bg-slate-100 text-slate-600',
};

const card = 'rounded-xl u-card';
const lift = 'u-lift';
const tag = 'inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-500';
const seeAll = 'group inline-flex items-center gap-1 text-[13px] font-medium text-slate-600 hover:text-ember';

function SeeAll({ to, children = 'See all' }) {
  return <Link to={to} className={seeAll}>{children}<Icon name="chevronRight" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></Link>;
}

function Section({ title, badge, action, description, children }) {
  return (
    <section className="mt-10">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight text-ink">
            {title}
            {badge && <span className={tag}>{badge}</span>}
          </h2>
          {description && <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function AppTile({ icon, label }) {
  return (
    <span className="grid h-7 w-7 place-items-center rounded-md border border-[#ECE8E3] bg-[#F6F4F1] text-slate-600" title={label}>
      <Icon name={icon} className="h-4 w-4" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function ShowcaseCard({ item }) {
  return (
    <Link to={item.to || '/workflows/new'} className={`${card} ${lift} group flex h-full flex-col p-5`} aria-label={`${item.cta || 'Try it'}: ${item.title}`}>
      <span className="flex items-center gap-2">
        <span className={tag}>{item.tag}</span>
        {item.meta && <span className="text-[11.5px] font-medium text-slate-500">{item.meta}</span>}
      </span>
      <h3 className="mt-3 text-[14.5px] font-semibold leading-snug text-ink">{item.title}</h3>
      <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-slate-500">{item.body}</p>
      <div className="mt-auto flex items-center justify-between pt-5">
        <div className="flex items-center gap-1.5">{item.apps.map(([icon, label]) => <AppTile key={label} icon={icon} label={label} />)}</div>
        <span className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 transition-colors group-hover:text-ember">
          {item.cta || 'Try it'}<Icon name="arrow" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

function Tabs({ tabs, value, onChange, label }) {
  return (
    <div className="flex gap-6 border-b border-[#ECE8E3] px-5" role="tablist" aria-label={label}>
      {tabs.map(([key, text, count]) => (
        <button key={key} type="button" role="tab" aria-selected={value === key} onClick={() => onChange(key)} className={`-mb-px inline-flex items-center gap-2 border-b-2 py-3 text-[13px] font-semibold transition-colors ${value === key ? 'border-ink text-ink' : 'border-transparent text-slate-500 hover:text-ink'}`}>
          {text}
          {count != null && <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-medium tabular-nums text-slate-600">{count}</span>}
        </button>
      ))}
    </div>
  );
}

function Allocation({ label, used, total, hint }) {
  const ratio = total > 0 ? Math.min(1, used / total) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium text-ink">{label}</p>
        <p className="text-[13px] tabular-nums text-slate-500"><span className="font-semibold text-ink">{used}</span> of {total}<span className="ml-2 inline-block w-10 text-right text-slate-400">{Math.round(ratio * 100)}%</span></p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={used}>
        <div className="h-full rounded-full bg-teal transition-[width] duration-500" style={{ width: `${ratio * 100}%` }} />
      </div>
      {hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function EmptyState({ icon, children, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-[#F6F4F1] text-slate-400"><Icon name={icon} className="h-5 w-5" /></span>
      <p className="mt-3 text-[13px] text-slate-500">{children}</p>
      {action}
    </div>
  );
}

function Skeleton({ rows = 3 }) {
  return (
    <div className="space-y-3 p-5" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => <div key={index} className="h-4 animate-pulse rounded bg-slate-100" style={{ width: `${90 - index * 15}%` }} />)}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-lg bg-[#FAF9F7] px-3.5 py-3 ring-1 ring-inset ring-[#F1EEEA]">
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500">{label}</p>
      <p className="mt-1 text-[24px] font-medium tabular-nums leading-none tracking-tight text-ink">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

function duration(job) {
  if (!job.startedAt || !job.finishedAt) return '—';
  const ms = new Date(job.finishedAt) - new Date(job.startedAt);
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60000)} min`;
}

function dueLabel(value, now = new Date()) {
  if (!value) return null;
  const due = new Date(value);
  const startOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOf(due) - startOf(now)) / 86400000);
  if (due < now) return { text: `Overdue · ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, late: true };
  if (days === 0) return { text: 'Due today' };
  if (days === 1) return { text: 'Due tomorrow' };
  return { text: `Due ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` };
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const iconButton = 'grid h-8 w-8 place-items-center rounded-md text-slate-500 transition-colors hover:bg-[#F6F4F1] hover:text-ink disabled:opacity-40';

export default function HomePage() {
  const user = currentUser();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'administrator';
  const [data, setData] = useState({ loading: true });
  const [licenseTab, setLicenseTab] = useState('users');
  const [autoTab, setAutoTab] = useState('projects');
  const [menu, setMenu] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    const get = (path) => api(path).then((result) => result).catch(() => null);
    Promise.all([
      get('/api/settings'), get('/api/dashboard'), get('/api/projects?limit=8'), get('/api/workflows?limit=100'),
      get('/api/jobs?limit=6'), get('/api/tasks?status=pending&mine=true&limit=5'), get('/api/tasks/summary'),
      isAdmin ? get('/api/users') : Promise.resolve(null),
      get('/api/apps/available'), get('/api/cases/summary'),
    ]).then(([settings, dashboard, projects, workflows, jobs, tasks, summary, users, apps, cases]) => {
      if (!alive) return;
      setData({
        loading: false,
        tenant: settings?.data?.tenant || null,
        robots: settings?.data?.robots || [],
        dashboard: dashboard?.data || null,
        projects: projects?.data || [],
        projectTotal: projects?.meta?.total ?? projects?.data?.length ?? 0,
        workflows: workflows?.data || [],
        jobs: jobs?.data || [],
        tasks: tasks?.data || [],
        summary: summary?.data || null,
        users: users?.data || null,
        apps: apps?.data || [],
        cases: cases?.data || null,
      });
    });
    return () => { alive = false; };
  }, [isAdmin]);

  // /dashboard#whats-new (from the app launcher) scrolls to the What's New list.
  useEffect(() => {
    if (!data.loading && window.location.hash === '#whats-new') document.getElementById('whats-new')?.scrollIntoView({ block: 'start' });
  }, [data.loading]);

  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setMenu(''); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const workflowName = (id) => data.workflows?.find((workflow) => workflow.id === id)?.name || 'Workflow';
  const flowsByProject = (id) => (data.workflows || []).filter((workflow) => workflow.project_id === id);
  const lastActivity = [data.jobs?.[0]?.createdAt, data.workflows?.[0]?.updated_at].filter(Boolean).sort().pop();

  async function run(workflow) {
    setMessage('');
    try {
      const result = await api(`/api/workflows/${workflow.id}/run`, { method: 'POST', body: { input: {} } });
      navigate(`/jobs/${result.data.id}`);
    } catch (error) {
      setMessage(`${workflow.name}: ${error.message}`);
    }
  }

  const robots = data.robots || [];
  const onlineRobots = robots.filter((robot) => robot.reportedAvailable).length;
  const activeUsers = (data.users || []).filter((item) => item.status === 'active').length;
  const admins = (data.users || []).filter((item) => item.role === 'administrator').length;
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const role = user?.role?.replaceAll('_', ' ');

  return (
    <div className="xl:grid xl:min-h-[calc(100vh-3.5rem)] xl:grid-cols-[minmax(0,1fr)_360px]">
      <main id="app-main" className="min-w-0">
        <div className="mx-auto max-w-[1280px] px-5 pb-16 pt-8 sm:px-8 lg:px-10">
          <header>
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-[30px]">{greeting()}, {user?.displayName || 'there'}</h1>
            <p className="mt-1.5 text-sm text-slate-500">
              {today}
              {data.tenant?.name && <><span className="mx-2 text-slate-300">·</span>{data.tenant.name}</>}
              {role && <><span className="mx-2 text-slate-300">·</span><span className="capitalize">{role}</span></>}
            </p>
          </header>

          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PRODUCTS.map((product) => (
              <Link key={product.title} to={product.to} className={`${card} ${lift} group flex h-full flex-col p-5`}>
                <div className="flex items-start justify-between">
                  <span className={`u-tile grid h-10 w-10 place-items-center rounded-[10px] ${product.tile}`}><Icon name={product.icon} className="h-5 w-5" strokeWidth={1.8} /></span>
                  <Icon name="arrowUpRight" className="h-4 w-4 text-slate-300 transition-colors group-hover:text-ember" />
                </div>
                <h3 className="mt-4 text-[15px] font-semibold text-ink">{product.title}</h3>
                <p className="mt-1 text-[13px] leading-5 text-slate-500">{product.body}</p>
              </Link>
            ))}
          </div>

          <Section title="Orchestrator services">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className={`${card} p-5`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#3A474E] to-[#172125] text-sm font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">{(data.tenant?.name || 'T')[0].toUpperCase()}</span>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-ink">{data.tenant?.name || (data.loading ? 'Loading…' : 'Default tenant')}</p>
                      <p className="text-xs text-slate-500">Tenant{data.tenant?.slug ? ` · ${data.tenant.slug}` : ''}{lastActivity ? ` · Updated ${timeAgo(lastActivity)}` : ''}</p>
                    </div>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#ECF7EF] px-2 py-0.5 text-xs font-medium text-[#1F6B3A]"><span className="h-1.5 w-1.5 rounded-full bg-[#2E9E57]" />Enabled</span>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <Stat label="Projects" value={data.projectTotal ?? 0} sub={data.dashboard ? `${data.dashboard.activeProjects ?? data.projectTotal} active` : null} />
                  <Stat label="Robots" value={robots.length} sub={`${onlineRobots} online`} />
                  <Stat label="Workflows" value={data.dashboard?.totalWorkflows ?? 0} sub={`${data.dashboard?.enabledWorkflows ?? 0} published`} />
                </div>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-[#ECE8E3] pt-4 text-[13px]">
                  <SeeAll to="/jobs">Jobs</SeeAll>
                  <SeeAll to="/queues">Queues</SeeAll>
                  <SeeAll to="/schedules">Schedules</SeeAll>
                  <SeeAll to="/settings">Robots</SeeAll>
                </div>
              </div>
              <div className={`${card} flex flex-col p-5`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[15px] font-semibold text-ink">Execution summary</p>
                    <p className="text-xs text-slate-500">Jobs across the projects you can access</p>
                  </div>
                  <SeeAll to="/metrics">Metrics</SeeAll>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Running" value={data.dashboard?.runningJobs ?? 0} />
                  <Stat label="Queued" value={data.dashboard?.queuedJobs ?? 0} />
                  <Stat label="Waiting" value={data.dashboard?.suspendedJobs ?? 0} sub="for people" />
                  <Stat label="Failed" value={data.dashboard?.failedExecutions ?? 0} />
                </div>
                <div className="mt-auto pt-4">
                  {(() => {
                    const ok = data.dashboard?.successfulExecutions ?? 0;
                    const bad = data.dashboard?.failedExecutions ?? 0;
                    const total = ok + bad;
                    const rate = total ? Math.round((ok / total) * 100) : null;
                    return (
                      <div className="border-t border-[#ECE8E3] pt-4">
                        <div className="flex items-baseline justify-between text-[13px]">
                          <span className="font-medium text-ink">Success rate</span>
                          <span className="tabular-nums text-slate-500">{rate == null ? 'No completed runs yet' : <><span className="font-semibold text-ink">{rate}%</span> of {total} completed</>}</span>
                        </div>
                        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                          {total > 0 && <><div className="h-full bg-[#2E9E57]" style={{ width: `${(ok / total) * 100}%` }} /><div className="h-full bg-[#D9382B]" style={{ width: `${(bad / total) * 100}%` }} /></>}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </Section>

          {data.apps?.length > 0 && (
            <Section title="Your apps" description="Apps published for you" action={<SeeAll to="/apps" />}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.apps.slice(0, 3).map((app) => <AppCard key={app.id} app={app} />)}
              </div>
            </Section>
          )}

          {data.cases && data.cases.open + data.cases.onHold + data.cases.resolvedThisWeek > 0 && (
            <Section title="Cases" description="Open cases and their SLAs across your projects" action={<SeeAll to="/cases" />}>
              <div className={`${card} p-5`}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <Stat label="Open" value={data.cases.open + data.cases.onHold} sub={data.cases.onHold ? `${data.cases.onHold} on hold` : null} />
                  <Stat label="SLA at risk" value={data.cases.atRisk} />
                  <Stat label="SLA breached" value={data.cases.breached} />
                  <Stat label="Yours" value={data.cases.mine} sub="owned or assigned" />
                  <Stat label="Resolved" value={data.cases.resolvedThisWeek} sub="this week" />
                </div>
                {(data.cases.atRisk > 0 || data.cases.breached > 0) && (
                  <Link to={`/cases?sla=${data.cases.breached ? 'breached' : 'at_risk'}`} className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ember hover:underline">
                    <Icon name="alert" className="h-4 w-4" />Review {data.cases.breached + data.cases.atRisk} case{data.cases.breached + data.cases.atRisk === 1 ? '' : 's'} close to or past their SLA
                  </Link>
                )}
              </div>
            </Section>
          )}

          <Section title="Start from a template">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {TEMPLATES.map((item) => <ShowcaseCard key={item.key} item={item} />)}
            </div>
          </Section>

          <Section title="Activity packs">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {MARKETPLACE.map((item) => <ShowcaseCard key={item.key} item={item} />)}
            </div>
          </Section>

          <Section title="License allocations" action={<SeeAll to="/settings">See all licenses</SeeAll>}>
            <div className={card}>
              <Tabs label="License allocations" tabs={[['users', 'Users'], ['robots', 'Robots & services']]} value={licenseTab} onChange={setLicenseTab} />
              <div className="p-5">
                {licenseTab === 'users' ? (
                  data.users ? (
                    <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
                      <Allocation label="Active users" used={activeUsers} total={data.users.length} hint="Users with an active account in your organization" />
                      <Allocation label="Administrators" used={admins} total={data.users.length} hint="Users who can manage users, robots, and settings" />
                    </div>
                  ) : data.loading ? <Skeleton rows={2} /> : <p className="text-[13px] text-slate-500">User allocations are visible to administrators.</p>
                ) : (
                  <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
                    <Allocation label="Robots online" used={onlineRobots} total={robots.length} hint="Robots that sent a heartbeat in the last minute" />
                    <Allocation label="Published workflows" used={data.dashboard?.enabledWorkflows ?? 0} total={data.dashboard?.totalWorkflows ?? 0} hint="Workflows with a published version robots can run" />
                  </div>
                )}
              </div>
            </div>
          </Section>

          <Section title="Automations" action={<SeeAll to={autoTab === 'projects' ? '/projects' : '/workflows'} />}>
            <div className={card}>
              <Tabs label="Automations" tabs={[['projects', 'Projects', data.loading ? null : data.projectTotal], ['workflows', 'Workflows', data.loading ? null : data.workflows?.length]]} value={autoTab} onChange={setAutoTab} />
              {message && <p className="mx-5 mt-4 rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger" role="alert">{message}</p>}
              {data.loading ? <Skeleton /> : autoTab === 'projects' ? (
                data.projects?.length ? (
                  <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
                    {data.projects.map((project) => {
                      const flows = flowsByProject(project.id);
                      const first = flows.find((flow) => flow.status === 'published') || flows[0];
                      return (
                        <article key={project.id} className={`relative flex h-full flex-col rounded-lg border border-[#ECE8E3] bg-white p-4 transition duration-150 hover:border-[#E2DCD5] hover:shadow-[0_8px_20px_-12px_rgba(16,24,40,0.14)]`}>
                          <div className="flex items-center gap-3">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#F6F4F1] text-sm font-semibold text-charcoal">{project.name?.[0]?.toUpperCase()}</span>
                            <div className="min-w-0">
                              <Link to="/projects" className="block truncate text-[14px] font-semibold text-ink hover:text-ember">{project.name}</Link>
                              <p className="truncate text-xs text-slate-500">Updated {timeAgo(project.updated_at || project.created_at)}</p>
                            </div>
                          </div>
                          <div className="mt-auto flex items-center justify-between pt-4">
                            <span className="text-xs tabular-nums text-slate-500">{plural(flows.length, 'workflow')}</span>
                            <div className="flex items-center">
                              <button type="button" className={iconButton} disabled={!first} title={first ? (first.status === 'published' ? `Run ${first.name}` : `Open ${first.name}`) : 'No workflows yet'} aria-label={first ? (first.status === 'published' ? `Run ${first.name}` : `Open ${first.name}`) : 'No workflows yet'} onClick={() => (first?.status === 'published' ? run(first) : navigate(first ? `/workflows/${first.id}` : '/workflows/new'))}>
                                <Icon name="playCircle" className="h-[18px] w-[18px]" />
                              </button>
                              <button type="button" className={iconButton} aria-label={`More actions for ${project.name}`} aria-expanded={menu === project.id} onClick={() => setMenu(menu === project.id ? '' : project.id)}>
                                <Icon name="more" className="h-[18px] w-[18px]" strokeWidth={2.6} />
                              </button>
                            </div>
                          </div>
                          {menu === project.id && (
                            <>
                              <button type="button" className="fixed inset-0 z-10 cursor-default" aria-hidden="true" tabIndex={-1} onClick={() => setMenu('')} />
                              <div role="menu" className="absolute bottom-12 right-3 z-20 w-48 rounded-xl border border-[#ECE8E3] bg-white p-1 shadow-[0_16px_40px_-16px_rgba(16,24,40,0.22)]">
                                <Link role="menuitem" to="/projects" className="block rounded-md px-3 py-2 text-[13px] text-ink hover:bg-[#F6F4F1]">Open project</Link>
                                <Link role="menuitem" to="/workflows/new" className="block rounded-md px-3 py-2 text-[13px] text-ink hover:bg-[#F6F4F1]">New workflow</Link>
                                <Link role="menuitem" to="/jobs" className="block rounded-md px-3 py-2 text-[13px] text-ink hover:bg-[#F6F4F1]">View jobs</Link>
                              </div>
                            </>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ) : <EmptyState icon="folder" action={<Link to="/projects" className="mt-3 text-[13px] font-semibold text-ember hover:underline">Create a project</Link>}>No projects yet.</EmptyState>
              ) : (
                data.workflows?.length ? (
                  <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
                    {data.workflows.slice(0, 8).map((workflow) => (
                      <article key={workflow.id} className="flex h-full flex-col rounded-lg border border-[#ECE8E3] bg-white p-4 transition duration-150 hover:border-[#E2DCD5] hover:shadow-[0_8px_20px_-12px_rgba(16,24,40,0.14)]">
                        <div><StatusPill status={workflow.status} /></div>
                        <Link to={`/workflows/${workflow.id}`} className="mt-3 truncate text-[14px] font-semibold text-ink hover:text-ember">{workflow.name}</Link>
                        <p className="text-xs text-slate-500">{workflow.status === 'published' ? 'Published' : 'Updated'} {timeAgo(workflow.updated_at)}</p>
                        <div className="mt-auto flex justify-end pt-4">
                          {workflow.status === 'published' ? (
                            <button type="button" className="inline-flex items-center gap-1.5 u-btn-secondary rounded-md px-2.5 py-1 text-[13px] font-medium" onClick={() => run(workflow)}><Icon name="play" className="h-3.5 w-3.5" />Run</button>
                          ) : (
                            <Link to={`/workflows/${workflow.id}`} className="inline-flex items-center gap-1.5 u-btn-secondary rounded-md px-2.5 py-1 text-[13px] font-medium"><Icon name="studio" className="h-3.5 w-3.5" />Open in Studio</Link>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : <EmptyState icon="studio" action={<Link to="/workflows/new" className="mt-3 text-[13px] font-semibold text-ember hover:underline">Build one in Studio</Link>}>No workflows yet.</EmptyState>
              )}
            </div>
          </Section>

          <div className="grid grid-cols-1 gap-x-6 2xl:grid-cols-2">
            <Section title="Job history" description="Recent runs across your projects" action={<SeeAll to="/jobs" />}>
              <div className={`${card} overflow-hidden`}>
                {data.loading ? <Skeleton /> : data.jobs?.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-[13px]">
                      <thead className="border-b border-[#ECE8E3] bg-[#FBFAF8] text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                        <tr>
                          <th scope="col" className="px-5 py-2.5 font-semibold">Workflow</th>
                          <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                          <th scope="col" className="px-3 py-2.5 font-semibold">Trigger</th>
                          <th scope="col" className="px-3 py-2.5 font-semibold">Started</th>
                          <th scope="col" className="px-5 py-2.5 text-right font-semibold">Duration</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F4F1EE]">
                        {data.jobs.map((job) => (
                          <tr key={job.id} className="cursor-pointer transition-colors hover:bg-[#FCFBFA]" onClick={() => navigate(`/jobs/${job.id}`)}>
                            <td className="max-w-[260px] truncate px-5 py-3"><Link to={`/jobs/${job.id}`} className="font-medium text-ink hover:text-ember" onClick={(event) => event.stopPropagation()}>{workflowName(job.workflowId)}</Link></td>
                            <td className="px-3 py-3"><StatusPill status={job.status} /></td>
                            <td className="px-3 py-3 capitalize text-slate-600">{job.triggerSource}</td>
                            <td className="whitespace-nowrap px-3 py-3 text-slate-600">{timeAgo(job.createdAt)}</td>
                            <td className="px-5 py-3 text-right tabular-nums text-slate-600">{duration(job)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <EmptyState icon="clock" action={<Link to="/workflows" className="mt-3 text-[13px] font-semibold text-ember hover:underline">Run a workflow</Link>}>See the results of your automations once you've run them.</EmptyState>}
              </div>
            </Section>

            <Section title="My actions" description="Pending actions that require attention" action={<SeeAll to="/tasks">See all actions</SeeAll>}>
              <div className={`${card} overflow-hidden`}>
                {data.loading ? <Skeleton /> : data.tasks?.length ? (
                  <ul className="divide-y divide-[#F1EEEA]">
                    {data.tasks.map((task) => {
                      const due = dueLabel(task.dueAt);
                      return (
                        <li key={task.id}>
                          <Link to={`/tasks/${task.id}`} className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-[#FCFBFA]">
                            <span className={`w-[68px] shrink-0 rounded-md px-1.5 py-0.5 text-center text-[11px] font-semibold capitalize ${PRIORITY[task.priority] || PRIORITY.low}`}>{task.priority}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13.5px] font-medium text-ink">{task.title}</span>
                              <span className="block truncate text-xs text-slate-500">{task.workflowName || task.projectName}{task.type && <><span className="mx-1.5 text-slate-300">·</span><span className="capitalize">{task.type}</span></>}</span>
                            </span>
                            <span className={`hidden shrink-0 text-xs sm:block ${due?.late ? 'font-medium text-danger' : 'text-slate-500'}`}>{due ? due.text : `Created ${timeAgo(task.createdAt)}`}</span>
                            <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-slate-500" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : <EmptyState icon="inbox" action={data.summary?.pending ? <Link to="/tasks" className="mt-3 text-[13px] font-semibold text-ember hover:underline">View {data.summary.pending} pending in your projects</Link> : null}>You're all caught up. No actions are waiting for you.</EmptyState>}
              </div>
            </Section>
          </div>
        </div>
      </main>

      <aside className="border-t border-[#ECE8E3] bg-[#FCFBFA] xl:border-l xl:border-t-0" aria-label="Get started">
        <div className="grid gap-8 px-5 py-8 sm:px-8 md:grid-cols-3 lg:px-10 xl:grid-cols-1 xl:px-6">
          <div className="rounded-xl border border-[#F6DCCF] bg-gradient-to-br from-[#FFF3EC] via-[#FFF9F5] to-white p-5">
            <span className="grid h-9 w-9 place-items-center u-tile rounded-lg bg-white text-ember shadow-[0_1px_2px_rgba(16,24,40,0.06)]"><Icon name="sparkle" className="h-5 w-5" /></span>
            <h2 className="mt-4 text-[16px] font-semibold leading-snug tracking-tight text-ink">Boost your productivity effortlessly</h2>
            <p className="mt-1.5 text-[13px] leading-5 text-slate-600">Build and run automations in your browser. No installs needed.</p>
            <Link to="/studio" className="mt-4 inline-flex items-center gap-2 rounded-lg u-btn-primary px-3.5 py-2 text-[13px] font-semibold">Start in Studio<Icon name="arrow" className="h-3.5 w-3.5" /></Link>
            <p className="mt-4 text-xs text-slate-500">Automating desktop apps? <Link to="/settings" className="font-medium text-ink underline decoration-[#DDD6CF] underline-offset-2 hover:text-ember">Connect a robot</Link></p>
          </div>

          <div id="whats-new" className="scroll-mt-20">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">What's New</h2>
            <ul className="mt-3 divide-y divide-[#F1EEEA]">
              {WHATS_NEW.map((item) => (
                <li key={item.title} className="py-3.5 first:pt-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-[#FFF1EC] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-ember">New</span>
                    <p className="text-[13.5px] font-semibold text-ink">{item.title}</p>
                    <span className="ml-auto text-[11px] text-slate-400">{item.date}</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-5 text-slate-500">{item.body}</p>
                  <Link to={item.to} className="group mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-ink hover:text-ember">{item.link}<Icon name="arrow" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Resources</h2>
            <ul className="mt-2 space-y-0.5">
              {RESOURCES.map(([to, label, icon]) => (
                <li key={to}>
                  <Link to={to} className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-[13.5px] text-charcoal transition-colors hover:bg-[#F6F4F1] hover:text-ink">
                    <span className="grid h-7 w-7 place-items-center rounded-md border border-[#ECE8E3] bg-white text-slate-500 group-hover:text-ember"><Icon name={icon} className="h-4 w-4" /></span>
                    {label}
                    <Icon name="chevronRight" className="ml-auto h-4 w-4 text-slate-300 group-hover:text-slate-500" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}
