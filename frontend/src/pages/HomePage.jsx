import { WHATS_NEW } from '../components/whatsNew.js';
import { useEffect, useState } from 'react';
import { AppCard } from './AppsPage.jsx';
import { Link, useNavigate } from 'react-router-dom';
import { api, currentUser } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import { timeAgo } from '../layouts/CloudLayout.jsx';
import { WORKFLOW_TEMPLATES, activityPacks } from '../lib/workflowTemplates.js';
import { useRunWorkflow } from '../components/RunInputDialog.jsx';

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

// Restrained palette, Automation Cloud style: neutral warm-grey tiles with navy icons, URAP orange
// (#FA4616 family) for primary actions and featured items, and a subtle blue for info only.
// Status colours live only in the small STATUS_DOT map below.
const NEUTRAL = { tile: '#F5F2EE', fg: '#3B4A5E', wash: '#FBFAF8', ink: '#3B4A5E', chip: 'bg-[#F7F5F2] text-[#4A5568] border-[#ECE6DF]', ring: '#ECE6DF', dot: '#94A3B8' };
const ORANGE = { tile: '#FFF1EA', fg: '#E03A0E', wash: '#FFF7F2', ink: '#E03A0E', chip: 'bg-[#FFF3EC] text-[#C2410C] border-[#FBDCCB]', ring: '#FBDCCB', dot: '#FA4616' };
const BLUE = { tile: '#EEF3FB', fg: '#2F5FA8', wash: '#F6F9FD', ink: '#2F5FA8', chip: 'bg-[#F1F5FC] text-[#2F5FA8] border-[#DCE5F3]', ring: '#DCE5F3', dot: '#3A75D0' };
export const ACCENTS = { neutral: NEUTRAL, orange: ORANGE, blue: BLUE };
export function accentFor() { return NEUTRAL; }
const STATUS_DOT = { Failed: '#D9382B', 'SLA breached': '#D9382B', Waiting: '#D99A1E', 'SLA at risk': '#D99A1E', Resolved: '#2E9E57', Running: '#3A75D0' };

// Gradient icon tile used for every accented item on the page.
export function AccentTile({ accent, icon, size = 'md', children }) {
  const dims = { sm: 'h-8 w-8 rounded-lg', md: 'h-10 w-10 rounded-[11px]', lg: 'h-12 w-12 rounded-xl' }[size];
  const glyph = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' }[size];
  return (
    <span className={`grid shrink-0 place-items-center border shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] ${dims}`} style={{ background: accent.tile, color: accent.fg, borderColor: accent.ring }}>
      {icon ? <Icon name={icon} className={glyph} strokeWidth={1.9} /> : <span className="text-[13px] font-semibold">{children}</span>}
    </span>
  );
}

const PRODUCTS = [
  { to: '/studio', title: 'Studio', icon: 'studio', accent: 'orange', body: 'Design processes and workflows in a no-code canvas.' },
  { to: '/settings', title: 'Robots', icon: 'robot', accent: 'neutral', body: 'Register robots, watch their heartbeat, and manage access.' },
  { to: '/tasks', title: 'Action Center', icon: 'tasks', accent: 'neutral', body: 'Route approvals and forms to people, then resume the job.' },
  { to: '/jobs', title: 'Orchestrator', icon: 'orchestrator', accent: 'neutral', body: 'Run, schedule, and monitor jobs and queues centrally.' },
];

// Templates are real workflow definitions (lib/workflowTemplates.js, validated and run in
// backend/test/templates.test.js); "Try it" opens the designer pre-filled with their steps.
export const TEMPLATES = WORKFLOW_TEMPLATES.map((item) => ({ ...item, to: `/workflows/new?template=${item.key}` }));

// Activity packs come straight from the designer's activity catalog, with real counts.
const MARKETPLACE = activityPacks().map((pack) => ({ ...pack, meta: `${pack.count} ${pack.count === 1 ? 'activity' : 'activities'}` }));


const WHATS_NEW_STYLE = {
  'Redesigned Workflow Designer': ['studio', 'orange'], 'BPMN processes': ['bpmn', 'blue'], Cases: ['briefcase', 'amber'],
  Apps: ['app', 'neutral'], Agents: ['agent', 'neutral'], Flow: ['flow', 'neutral'],
};

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

const card = 'rounded-2xl border border-[#ECE8E3] bg-white shadow-[0_1px_2px_rgba(20,33,61,0.04),0_8px_24px_-18px_rgba(20,33,61,0.18)]';
const lift = 'transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 hover:border-[#E3DDD6] hover:shadow-[0_2px_4px_rgba(20,33,61,0.04),0_22px_44px_-22px_rgba(20,33,61,0.30)] motion-reduce:hover:translate-y-0';
const tag = 'inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-500';
const seeAll = 'group inline-flex items-center gap-1 text-[13px] font-medium text-slate-600 hover:text-ember';

function SeeAll({ to, children = 'See all' }) {
  return <Link to={to} className={seeAll}>{children}<Icon name="chevronRight" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></Link>;
}

const SECTION_META = {
  'Orchestrator services': ['orchestrator', 'blue', 'Your tenant, robots and how your jobs are running'],
  'Your apps': ['app', 'neutral'],
  Cases: ['briefcase', 'amber'],
  'Start from a template': ['sparkle', 'orange', 'Real, validated workflows that open pre-filled in the designer'],
  'Activity packs': ['grid', 'neutral', 'Building blocks from the designer, grouped by what they automate'],
  'License allocations': ['shield', 'neutral', 'How your seats, robots and workflows are being used'],
  Automations: ['studio', 'orange', 'Your projects and workflows, ready to run or edit'],
  'Job history': ['clock', 'blue'],
  'My actions': ['tasks', 'neutral'],
};

function Section({ title, badge, action, description, children }) {
  const [icon, tone, fallback] = SECTION_META[title] || [];
  return (
    <section className="mt-12">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          {icon && <AccentTile accent={title === 'Start from a template' ? ORANGE : NEUTRAL} icon={icon} size="sm" />}
          <div>
            <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.015em] text-ink">
              {title}
              {badge && <span className={tag}>{badge}</span>}
            </h2>
            {(description || fallback) && <p className="mt-0.5 text-[13px] text-slate-500">{description || fallback}</p>}
          </div>
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

// Per-template accent: primary icon, gradient tile, tinted header wash, chips, badge and CTA colours.
const TEMPLATE_THEMES = {
  'invoice-to-csv': { icon: 'document', ...NEUTRAL },
  'web-table-to-csv': { icon: 'globe', ...NEUTRAL },
  'purchase-approval': { icon: 'tasks', ...NEUTRAL },
  'queue-transactions': { icon: 'queue', ...NEUTRAL },
  'clean-customer-csv': { icon: 'table', ...NEUTRAL },
  'notepad-note': { icon: 'monitor', ...NEUTRAL },
};

function ThemedTemplateCard({ item, theme }) {
  const cta = item.cta || 'Try it';
  return (
    <Link
      to={item.to || '/workflows/new'}
      aria-label={`${cta}: ${item.title}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-[#ECE8E3] bg-white shadow-[0_1px_2px_rgba(20,33,61,0.04),0_8px_24px_-16px_rgba(20,33,61,0.18)] transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_2px_4px_rgba(20,33,61,0.04),0_22px_44px_-20px_rgba(20,33,61,0.30)]"
      style={{ '--accent-ring': ORANGE.ring }}
    >
      <span className="pointer-events-none absolute inset-0 rounded-2xl border border-transparent transition-colors duration-300 group-hover:border-[var(--accent-ring)]" aria-hidden="true" />
      <div className="relative flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]" style={{ background: theme.tile, color: theme.fg, borderColor: theme.ring }}>
            <Icon name={theme.icon} className="h-6 w-6" />
          </span>
          <span className="flex flex-col items-end gap-1">
            <span className={`rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] ${/ready/i.test(item.tag) ? ORANGE.chip : NEUTRAL.chip}`}>{item.tag}</span>
            {item.meta && <span className="text-[11.5px] font-medium text-slate-500">{item.meta}</span>}
          </span>
        </div>
        <h3 className="mt-4 text-[15px] font-semibold leading-snug text-ink">{item.title}</h3>
        <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-slate-500">{item.body}</p>
        <div className="mt-auto flex items-center justify-between gap-3 pt-5">
          <div className="flex flex-wrap items-center gap-1.5">
            {item.apps.map(([icon, label]) => (
              <span key={label} title={label} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${theme.chip}`}>
                <Icon name={icon} className="h-3.5 w-3.5" />{label}
              </span>
            ))}
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[13px] font-semibold transition-colors duration-200" style={{ color: ORANGE.ink, background: ORANGE.wash }}>
            {cta}<Icon name="arrow" className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1" />
          </span>
        </div>
      </div>
    </Link>
  );
}

export function ShowcaseCard({ item }) {
  const theme = TEMPLATE_THEMES[item.key] || (item.apps?.length ? { icon: item.apps[0][0], ...accentFor(item.key) } : null);
  if (theme && item.apps) return <ThemedTemplateCard item={item} theme={theme} />;
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
        <div className="h-full rounded-full bg-[#FA4616] transition-[width] duration-500" style={{ width: `${ratio * 100}%` }} />
      </div>
      {hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function EmptyState({ icon, children, action }) {
  const accent = NEUTRAL;
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="relative grid h-20 w-20 place-items-center" aria-hidden="true">
        <span className="absolute inset-0 rounded-full" style={{ background: `radial-gradient(circle, ${accent.wash} 0%, rgba(255,255,255,0) 70%)` }} />
        <span className="absolute inset-3 rounded-full border border-dashed" style={{ borderColor: accent.ring }} />
        <span className="relative"><AccentTile accent={accent} icon={icon} /></span>
      </span>
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
  const dot = STATUS_DOT[label] || NEUTRAL.dot;
  return (
    <div className="relative overflow-hidden rounded-xl border border-[#EEE9E3] bg-[#FBFAF8] px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500"><span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} aria-hidden="true" />{label}</p>
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

  const [runWorkflow, runDialog] = useRunWorkflow({ onError: (error) => setMessage(error.message) });
  function run(workflow) {
    setMessage('');
    runWorkflow(workflow);
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
        {runDialog}
        <div className="mx-auto max-w-[1280px] px-5 pb-16 pt-8 sm:px-8 lg:px-10">
          <header className="flex flex-col gap-3 rounded-2xl border border-[#EEE9E3] bg-white px-5 py-3.5 shadow-[0_1px_2px_rgba(20,33,61,0.04)] sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <AccentTile accent={ORANGE} size="sm">{(user?.displayName || 'U')[0].toUpperCase()}</AccentTile>
              <h1 className="truncate text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[22px]">{greeting()}, {user?.displayName || 'there'}</h1>
            </div>
            <p className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-end">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#ECE6DF] bg-[#F7F5F2] px-2.5 py-0.5 text-[12px] font-medium text-[#5B6474]"><Icon name="calendar" className="h-3.5 w-3.5 text-slate-400" />{today}</span>
              {data.tenant?.name && <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#ECE6DF] bg-[#F7F5F2] px-2.5 py-0.5 text-[12px] font-medium text-[#5B6474]"><Icon name="briefcase" className="h-3.5 w-3.5 text-slate-400" />{data.tenant.name}</span>}
              {role && <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#ECE6DF] bg-[#F7F5F2] px-2.5 py-0.5 text-[12px] font-medium text-[#5B6474] capitalize"><Icon name="shield" className="h-3.5 w-3.5 text-slate-400" />{role}</span>}
            </p>
          </header>

          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PRODUCTS.map((product) => (
              <Link key={product.title} to={product.to} className={`${card} ${lift} group relative flex h-full flex-col overflow-hidden p-5`}>
                <div className="relative flex items-start justify-between">
                  <AccentTile accent={product.accent === 'orange' ? ORANGE : NEUTRAL} icon={product.icon} size="lg" />
                  <span className="grid h-7 w-7 place-items-center rounded-full text-slate-400 transition-[transform,color] duration-200 group-hover:text-[#E03A0E] group-hover:translate-x-0.5 group-hover:-translate-y-0.5" style={{ background: NEUTRAL.wash }}><Icon name="arrowUpRight" className="h-4 w-4" /></span>
                </div>
                <h3 className="relative mt-4 text-[15px] font-semibold text-ink">{product.title}</h3>
                <p className="mt-1 text-[13px] leading-5 text-slate-500">{product.body}</p>
              </Link>
            ))}
          </div>

          <Section title="Orchestrator services">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className={`${card} p-5`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <AccentTile accent={NEUTRAL}>{(data.tenant?.name || 'T')[0].toUpperCase()}</AccentTile>
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
                    <p className="flex items-center gap-2 text-[15px] font-semibold text-ink"><AccentTile accent={NEUTRAL} icon="gauge" size="sm" />Execution summary</p>
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
                        <article key={project.id} className={`relative flex h-full flex-col rounded-xl border border-[#ECE8E3] bg-white p-4 transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-0.5 hover:border-[#E3DDD6] hover:shadow-[0_16px_32px_-20px_rgba(20,33,61,0.28)] motion-reduce:hover:translate-y-0`}>
                          <div className="flex items-center gap-3">
                            <AccentTile accent={accentFor(project.id ?? project.name)}>{project.name?.[0]?.toUpperCase()}</AccentTile>
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
                      <article key={workflow.id} className="flex h-full flex-col rounded-xl border border-[#ECE8E3] bg-white p-4 transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-0.5 hover:border-[#E3DDD6] hover:shadow-[0_16px_32px_-20px_rgba(20,33,61,0.28)] motion-reduce:hover:translate-y-0">
                        <div className="flex items-center justify-between"><AccentTile accent={accentFor(workflow.id ?? workflow.name)} icon="flow" size="sm" /><StatusPill status={workflow.status} /></div>
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
            <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ink"><AccentTile accent={NEUTRAL} icon="sparkle" size="sm" />What's New</h2>
            <p className="mt-1 text-[12.5px] text-slate-500">Features shipped this month</p>
            <ul className="mt-4 space-y-3">
              {WHATS_NEW.map((item) => {
                const [icon] = WHATS_NEW_STYLE[item.title] || ['sparkle'];
                const accent = NEUTRAL;
                return (
                  <li key={item.title} className={`${card} ${lift} group relative overflow-hidden p-4`}>
                    <div className="flex items-start gap-3">
                      <AccentTile accent={accent} icon={icon} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${ORANGE.chip}`}>New</span>
                          <span className="ml-auto text-[11px] text-slate-400">{item.date}</span>
                        </div>
                        <p className="mt-1 text-[13.5px] font-semibold text-ink">{item.title}</p>
                        <p className="mt-1 text-[12.5px] leading-5 text-slate-500">{item.body}</p>
                        <Link to={item.to} className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-ink transition-colors group-hover:text-[#E03A0E]">{item.link}<Icon name="arrow" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" /></Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ink"><AccentTile accent={NEUTRAL} icon="library" size="sm" />Resources</h2>
            <ul className="mt-2 space-y-0.5">
              {RESOURCES.map(([to, label, icon]) => (
                <li key={to}>
                  <Link to={to} className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-[13.5px] text-charcoal transition-colors hover:bg-[#F6F4F1] hover:text-ink">
                    <span className="grid h-8 w-8 place-items-center rounded-lg border transition-transform duration-200 group-hover:scale-105" style={{ background: accentFor(label).wash, color: accentFor(label).ink, borderColor: accentFor(label).ring }}><Icon name={icon} className="h-4 w-4" /></span>
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
