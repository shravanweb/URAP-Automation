import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, clearSession, currentUser, getRefreshToken } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import { SECTIONS } from './AppLayout.jsx';
import logo from '../assets/logo.png';

// Light "Automation Cloud" shell for the signed-in home page: a thin top bar with an app
// launcher (every platform page), search, notifications, help, and the user menu. The other
// pages keep the sidebar shell (AppLayout); the launcher and the sidebar list the same links.

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'U';
}

export function timeAgo(value, now = Date.now()) {
  if (!value) return '';
  // The API returns UTC 'YYYY-MM-DD HH:MM:SS' strings without a zone; read them as UTC.
  const text = String(value);
  const then = new Date(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text) ? `${text.replace(' ', 'T')}Z` : value).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const steps = [[60, 'minute'], [3600, 'hour'], [86400, 'day'], [2592000, 'month'], [31536000, 'year']];
  let [size, unit] = steps[0];
  for (const step of steps) if (seconds >= step[0]) [size, unit] = step;
  const amount = Math.floor(seconds / size);
  return `${amount} ${unit}${amount === 1 ? '' : 's'} ago`;
}

const iconButton = 'relative grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-[#F6F4F1] hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ember/35 aria-expanded:bg-slate-100 aria-expanded:text-ink';
const panel = 'absolute z-40 mt-2.5 rounded-xl u-card shadow-[0_1px_2px_rgba(16,24,40,0.04),0_16px_40px_-16px_rgba(16,24,40,0.22)]';

function useDismiss(open, close) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);
}

function Backdrop({ onClose }) {
  return <button type="button" className="fixed inset-0 z-30 cursor-default" aria-hidden="true" tabIndex={-1} onClick={onClose} />;
}

// App launcher: groups are laid out in two columns (Overview + Build | Run + Govern, seven and
// nine items) so there are no empty gaps. Each item has a tinted icon tile in its group
// color and a one-line description.
const GROUP_TONES = {
  Overview: 'bg-slate-100 text-slate-600',
  Build: 'bg-[#FFF1EC] text-[#D63A0C]',
  Run: 'bg-[#E8F6F6] text-[#127C81]',
  Govern: 'bg-[#F1EEFB] text-[#5B47B8]',
};

export const LAUNCHER_DESCRIPTIONS = {
  '/dashboard': 'Your automation overview',
  '/metrics': 'Counts, trends, and recent errors',
  '/studio': 'Design and build automations',
  '/projects': 'Organize work, files, and members',
  '/workflows/new': 'Start a new workflow on the canvas',
  '/workflows': 'Browse, publish, and run workflows',
  '/connections': 'Credentials and integrations',
  '/jobs': 'Monitor executions and retries',
  '/schedules': 'Time-based triggers',
  '/queues': 'Work queues and transaction items',
  '/tasks': 'Approvals and human-in-the-loop tasks',
  '/apps': 'Custom apps published for you',
  '/cases': 'Work cases through stages and SLAs',
  '/reports': 'Execution reports and exports',
  '/audit': 'Who changed what, and when',
  '/settings': 'Tenant, users, and robots',
};

const COLUMNS = [['Overview', 'Build'], ['Run', 'Govern']];

function moveFocus(container, current, key) {
  const items = [...container.querySelectorAll('[data-launcher-item]')];
  const index = items.indexOf(current);
  if (key === 'Home') return items[0];
  if (key === 'End') return items[items.length - 1];
  if (index < 0) return key === 'ArrowDown' ? items[0] : null;
  if (key === 'ArrowDown') return items[(index + 1) % items.length];
  if (key === 'ArrowUp') return items[(index - 1 + items.length) % items.length];
  // Left/right: the closest item in the neighbouring column, by vertical position.
  const from = current.getBoundingClientRect();
  const candidates = items.filter((item) => {
    const rect = item.getBoundingClientRect();
    return key === 'ArrowRight' ? rect.left > from.right - 4 : rect.right < from.left + 4;
  });
  if (!candidates.length) return null;
  const centre = (rect) => rect.top + rect.height / 2;
  return candidates.reduce((best, item) => (Math.abs(centre(item.getBoundingClientRect()) - centre(from)) < Math.abs(centre(best.getBoundingClientRect()) - centre(from)) ? item : best));
}

export function Launcher({ pending, tenant, onNavigate, onHelp }) {
  const ref = useRef(null);
  const [filter, setFilter] = useState('');
  const groups = Object.fromEntries(SECTIONS.map(([section, links]) => [section, links]));
  const needle = filter.trim().toLowerCase();
  const visible = (links) => links.filter(([to, label]) => !needle || `${label} ${LAUNCHER_DESCRIPTIONS[to] || ''}`.toLowerCase().includes(needle));
  const total = SECTIONS.reduce((sum, [, links]) => sum + visible(links).length, 0);

  useEffect(() => {
    const active = ref.current?.querySelector('[data-launcher-item][aria-current="page"]');
    (active || ref.current?.querySelector('[data-launcher-item]'))?.focus();
  }, []);

  const onKeyDown = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const inInput = event.target.tagName === 'INPUT';
    if (inInput && event.key !== 'ArrowDown') return;
    const next = moveFocus(ref.current, inInput ? null : document.activeElement, event.key);
    if (next) { event.preventDefault(); next.focus(); }
  };

  return (
    <div
      ref={ref}
      id="app-launcher"
      role="dialog"
      aria-label="App launcher"
      onKeyDown={onKeyDown}
      className="absolute left-0 z-40 mt-2.5 w-[min(94vw,720px)] origin-top-left overflow-hidden rounded-2xl u-card shadow-[0_1px_2px_rgba(23,33,37,0.05),0_12px_24px_-8px_rgba(23,33,37,0.12),0_32px_64px_-24px_rgba(23,33,37,0.22)] animate-[launcher-in_140ms_cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:animate-none"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ECE8E3] px-5 py-4">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold tracking-tight text-ink">URAP Automation Cloud</p>
          <p className="truncate text-xs text-slate-500">{tenant?.name ? `${tenant.name} · ` : ''}Switch to any service</p>
        </div>
        <label className="relative w-full sm:w-56">
          <span className="sr-only">Filter services</span>
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter services" className="h-8 w-full rounded-lg border border-[#ECE8E3] bg-[#F6F4F1] pl-8 pr-3 text-[13px] text-ink placeholder:text-slate-400 focus:border-[#DCCFC4] focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/10" />
        </label>
      </div>

      <div className="max-h-[min(70vh,600px)] overflow-y-auto px-3 py-3">
        {total === 0 ? <p className="px-3 py-10 text-center text-[13px] text-slate-500">No services match “{filter}”.</p> : (
          <div className="grid gap-x-2 sm:grid-cols-2">
            {COLUMNS.map((column) => (
              <div key={column.join()} className="min-w-0">
                {column.map((section) => {
                  const links = visible(groups[section] || []);
                  if (!links.length) return null;
                  return (
                    <div key={section} className="mb-2 last:mb-0" role="group" aria-label={section}>
                      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{section}</p>
                      <ul>
                        {links.map(([to, label, icon]) => (
                          <li key={to}>
                            <NavLink
                              to={to}
                              end
                              data-launcher-item
                              onClick={onNavigate}
                              className={({ isActive }) => `group relative flex items-center gap-3 rounded-xl px-3 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ember/35 ${isActive ? 'bg-[#FAF6F3] ring-1 ring-inset ring-[#F1E4DA]' : 'hover:bg-[#F6F4F1] focus-visible:bg-[#F6F4F1]'}`}
                            >
                              {({ isActive }) => (
                                <>
                                  {isActive && <span className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full bg-ember" aria-hidden="true" />}
                                  <span className={`u-tile grid h-9 w-9 shrink-0 place-items-center rounded-lg ${GROUP_TONES[section] || GROUP_TONES.Overview}`}><Icon name={icon} className="h-[18px] w-[18px]" strokeWidth={1.8} /></span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[14px] font-semibold leading-5 text-ink">{label}</span>
                                    <span className="block truncate text-[12.5px] leading-[18px] text-slate-500">{LAUNCHER_DESCRIPTIONS[to]}</span>
                                  </span>
                                  {to === '/tasks' && pending > 0 && <span className="rounded-full bg-brand px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-none text-white" aria-label={`${pending} pending`}>{pending}</span>}
                                  {isActive && <span className="sr-only">(current page)</span>}
                                </>
                              )}
                            </NavLink>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#ECE8E3] bg-[#FCFBFA] px-5 py-3 text-[12.5px] text-slate-500">
        <Link to="/settings" onClick={onNavigate} className="inline-flex items-center gap-1.5 rounded hover:text-ink"><Icon name="settings" className="h-3.5 w-3.5" />Settings</Link>
        <button type="button" onClick={onHelp} className="inline-flex items-center gap-1.5 rounded hover:text-ink"><Icon name="help" className="h-3.5 w-3.5" />Help &amp; shortcuts</button>
        <Link to="/dashboard#whats-new" onClick={onNavigate} className="inline-flex items-center gap-1.5 rounded hover:text-ink"><Icon name="sparkle" className="h-3.5 w-3.5" />What's new</Link>
        <span className="ml-auto hidden items-center gap-1 sm:inline-flex"><kbd className="rounded border border-[#ECE8E3] bg-white px-1 text-[11px]">↑</kbd><kbd className="rounded border border-[#ECE8E3] bg-white px-1 text-[11px]">↓</kbd> to move · <kbd className="rounded border border-[#ECE8E3] bg-white px-1 text-[11px]">Esc</kbd> to close</span>
      </div>
    </div>
  );
}

function SearchDialog({ onClose }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [workflows, setWorkflows] = useState([]);
  const [active, setActive] = useState(0);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); api('/api/workflows?limit=100').then((result) => setWorkflows(result.data)).catch(() => {}); }, []);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pages = SECTIONS.flatMap(([section, links]) => links.map(([to, label, icon]) => ({ key: to, to, label, hint: section, icon })));
    const flows = workflows.map((workflow) => ({ key: workflow.id, to: `/workflows/${workflow.id}`, label: workflow.name, hint: 'Workflow', icon: 'studio' }));
    return [...pages, ...flows].filter((item) => !needle || item.label.toLowerCase().includes(needle)).slice(0, 10);
  }, [query, workflows]);
  const go = (item) => { if (item) { onClose(); navigate(item.to); } };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-navy-950/30 p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close search" onClick={onClose} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl u-card shadow-[0_24px_64px_-20px_rgba(16,24,40,0.3)]">
        <div className="flex items-center gap-3 border-b border-[#ECE8E3] px-4">
          <Icon name="search" className="h-5 w-5 text-slate-400" />
          <input
            ref={input}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, results.length - 1)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
              if (event.key === 'Enter') go(results[active]);
            }}
            className="h-12 w-full bg-transparent text-[15px] text-ink placeholder:text-slate-400 focus:outline-none"
            placeholder="Search pages and workflows"
            aria-label="Search pages and workflows"
          />
          <kbd className="rounded border border-[#ECE8E3] px-1.5 py-0.5 text-[11px] text-slate-500">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No matches</li>}
          {results.map((item, index) => (
            <li key={item.key}>
              <button type="button" onMouseEnter={() => setActive(index)} onClick={() => go(item)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${index === active ? 'bg-[#F6F4F1]' : ''}`}>
                <Icon name={item.icon} className="h-4 w-4 text-slate-500" />
                <span className="truncate text-ink">{item.label}</span>
                <span className="ml-auto text-xs text-slate-500">{item.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function CloudLayout() {
  const user = currentUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState('');
  const [pending, setPending] = useState(0);
  const [notes, setNotes] = useState([]);
  const [tenant, setTenant] = useState(null);
  const [welcome, setWelcome] = useState(Boolean(location.state?.welcome));
  const close = useMemo(() => () => setOpen(''), []);
  useDismiss(Boolean(open), close);
  const toggle = (name) => setOpen((current) => (current === name ? '' : name));
  const appsButton = useRef(null);
  const wasOpen = useRef('');
  // When the launcher closes (Esc, click outside), return focus to the grid button.
  useEffect(() => {
    if (wasOpen.current === 'apps' && open !== 'apps' && (!document.activeElement || document.activeElement === document.body)) appsButton.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api('/api/tasks/summary').then((result) => { if (alive) setPending(result.data.pending); }).catch(() => {});
      api('/api/notifications?limit=10').then((result) => { if (alive) setNotes(result.data); }).catch(() => {});
    };
    load();
    api('/api/settings').then((result) => { if (alive && result.data?.tenant?.name) setTenant(result.data.tenant); }).catch(() => {});
    const timer = setInterval(load, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen('search'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The Workflow Designer (/workflows/new, /workflows/:id) is part of Studio; the library is not.
  const inStudio = location.pathname.startsWith('/studio') || /^\/workflows\/[^/]+/.test(location.pathname);
  const product = inStudio ? 'Studio' : 'Automation Cloud';
  useEffect(() => { document.title = inStudio ? 'Studio · URAP' : 'Home · URAP Automation Cloud'; }, [inStudio]);

  const recent = notes.filter((note) => Date.now() - new Date(note.created_at).getTime() < 7 * 86400000).length;
  const badge = recent + pending;

  const signOut = async () => {
    await api('/api/auth/logout', { method: 'POST', body: { refreshToken: getRefreshToken() } }).catch(() => {});
    clearSession();
    navigate('/login', { state: { signedOut: true } });
  };

  return (
    <div className="min-h-screen bg-[#FAF9F7] text-ink">
      <a href="#app-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2">Skip to content</a>
      <header className="sticky top-0 z-40 flex h-14 items-center gap-1 border-b border-[rgba(23,33,37,0.07)] bg-white/95 px-3 backdrop-blur-md supports-[backdrop-filter]:bg-white/80 sm:px-4">
        <div className="relative">
          <button ref={appsButton} type="button" className={iconButton} aria-label="All services" aria-haspopup="dialog" aria-controls="app-launcher" aria-expanded={open === 'apps'} onClick={() => toggle('apps')}>
            <Icon name="grid" className="h-5 w-5" strokeWidth={2.4} />
          </button>
          {open === 'apps' && <><Backdrop onClose={close} /><Launcher pending={pending} tenant={tenant} onNavigate={close} onHelp={() => setOpen('help')} /></>}
        </div>
        <Link to="/dashboard" className="ml-1 flex items-center gap-2.5 rounded-md px-1 py-1" aria-label={`URAP ${product}, go to home`}>
          <img src={logo} alt="URAP" className="h-9 w-auto" />
          <span className="hidden text-[15px] font-semibold tracking-tight text-ink md:block">{product}</span>
        </Link>
        {tenant && (
          <div className="relative ml-2 hidden sm:block">
            <span className="mr-2 text-slate-300" aria-hidden="true">/</span>
            <button type="button" className="inline-flex items-center gap-2 rounded-full border border-[#ECE8E3] bg-white py-1 pl-1.5 pr-2.5 text-[13px] font-medium text-ink transition-colors hover:border-[#E2DCD5] hover:bg-[#F6F4F1] focus:outline-none focus-visible:ring-2 focus-visible:ring-ember/35 aria-expanded:border-[#E2DCD5] aria-expanded:bg-[#F6F4F1]" aria-haspopup="menu" aria-expanded={open === 'tenant'} onClick={() => toggle('tenant')}>
              <span className="grid h-5 w-5 place-items-center rounded-full bg-gradient-to-br from-[#3A474E] to-[#172125] text-[10px] font-semibold text-white">{tenant.name[0]?.toUpperCase()}</span>
              <span className="max-w-[180px] truncate">{tenant.name}</span>
              <Icon name="chevronDown" className="h-3.5 w-3.5 text-slate-500" />
            </button>
            {open === 'tenant' && (
              <>
                <Backdrop onClose={close} />
                <div role="menu" className={`${panel} left-4 w-72 p-1.5`}>
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Tenant</p>
                  <div className="flex items-center gap-3 rounded-lg bg-[#F6F4F1] px-3 py-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#3A474E] to-[#172125] text-xs font-semibold text-white">{tenant.name[0]?.toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{tenant.name}</p>
                      <p className="truncate text-xs text-slate-500">{tenant.slug || 'default'}</p>
                    </div>
                    <Icon name="check" className="h-4 w-4 text-ember" />
                  </div>
                  <div className="my-1 h-px bg-[#ECE8E3]" />
                  <Link role="menuitem" to="/settings" onClick={close} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink hover:bg-[#F6F4F1]"><Icon name="settings" className="h-4 w-4 text-slate-500" />Tenant settings</Link>
                </div>
              </>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" className={iconButton} aria-label="Search (Ctrl+K)" onClick={() => setOpen('search')}><Icon name="search" /></button>

          <div className="relative">
            <button type="button" className={iconButton} aria-label={`Notifications, ${badge} new`} aria-expanded={open === 'bell'} onClick={() => toggle('bell')}>
              <Icon name="bell" />
              {badge > 0 && <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white">{badge > 99 ? '99+' : badge}</span>}
            </button>
            {open === 'bell' && (
              <>
                <Backdrop onClose={close} />
                <div className={`${panel} right-0 w-[min(92vw,360px)]`} role="dialog" aria-label="Notifications">
                  <div className="flex items-center justify-between border-b border-[#ECE8E3] px-4 py-3">
                    <p className="text-sm font-semibold">Notifications</p>
                    <Link to="/tasks" onClick={close} className="text-xs font-semibold text-ember hover:underline">{pending} pending action{pending === 1 ? '' : 's'}</Link>
                  </div>
                  {notes.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">You're all caught up.</p> : (
                    <ul className="max-h-80 divide-y divide-[#F1EEEA] overflow-y-auto">
                      {notes.map((note) => (
                        <li key={note.id}>
                          <Link to={note.job_id ? `/jobs/${note.job_id}` : '/jobs'} onClick={close} className="block px-4 py-3 hover:bg-[#F6F4F1]">
                            <p className="truncate text-sm font-medium text-ink">{note.subject}</p>
                            <p className="line-clamp-2 text-xs text-slate-600">{note.body}</p>
                            <p className="mt-1 text-[11px] text-slate-500">{timeAgo(note.created_at)}</p>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <button type="button" className={iconButton} aria-label="Help" aria-expanded={open === 'help'} onClick={() => toggle('help')}><Icon name="help" /></button>
            {open === 'help' && (
              <>
                <Backdrop onClose={close} />
                <div className={`${panel} right-0 w-64 p-1.5`} role="menu">
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Help</p>
                  {[['/workflows/new', 'Build your first workflow', 'studio'], ['/tasks', 'Work with Action Center', 'tasks'], ['/queues', 'Process queue items', 'queue'], ['/settings', 'Connect a robot', 'robot']].map(([to, label, icon]) => (
                    <Link key={to} role="menuitem" to={to} onClick={close} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink hover:bg-[#F6F4F1]"><Icon name={icon} className="h-4 w-4 text-slate-500" />{label}</Link>
                  ))}
                  <div className="my-1 h-px bg-[#ECE8E3]" />
                  <p className="px-3 py-1.5 text-xs text-slate-500">Press <kbd className="rounded border border-[#ECE8E3] px-1">Ctrl</kbd> + <kbd className="rounded border border-[#ECE8E3] px-1">K</kbd> to search</p>
                </div>
              </>
            )}
          </div>

          <span className="mx-1.5 hidden h-6 w-px bg-[#ECE8E3] sm:block" aria-hidden="true" />
          <div className="relative">
            <button type="button" className="grid h-8 w-8 place-items-center u-avatar rounded-full text-xs font-semibold text-white ring-offset-2 transition hover:ring-2 hover:ring-[#E2DCD5] focus:outline-none focus-visible:ring-2 focus-visible:ring-ember/40 aria-expanded:ring-2 aria-expanded:ring-[#E2DCD5]" aria-label="Account" aria-haspopup="menu" aria-expanded={open === 'user'} onClick={() => toggle('user')}>
              {initials(user?.displayName)}
            </button>
            {open === 'user' && (
              <>
                <Backdrop onClose={close} />
                <div role="menu" className={`${panel} right-0 w-64 p-1.5`}>
                  <div className="px-3 py-2.5">
                    <p className="truncate text-sm font-semibold text-ink">{user?.displayName}</p>
                    <p className="truncate text-xs text-slate-500">{user?.email}</p>
                    <p className="mt-1 text-xs capitalize text-slate-500">{user?.role?.replaceAll('_', ' ')}</p>
                  </div>
                  <div className="my-1 h-px bg-[#ECE8E3]" />
                  <Link role="menuitem" to="/settings" onClick={close} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink hover:bg-[#F6F4F1]"><Icon name="settings" className="h-4 w-4" />Settings</Link>
                  <Link role="menuitem" to="/" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink hover:bg-[#F6F4F1]"><Icon name="home" className="h-4 w-4" />Homepage</Link>
                  <button role="menuitem" type="button" className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-danger hover:bg-[#FEF3F2]" onClick={signOut}><Icon name="logout" className="h-4 w-4" />Sign out</button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {open === 'search' && <SearchDialog onClose={close} />}

      {welcome && (
        <div className="border-b border-[#FFD8CA] bg-brandsoft px-4 py-3 sm:px-6" role="status">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink">
            <span className="font-semibold">Welcome to URAP, {user?.displayName?.split(' ')[0]}.</span>
            <span className="text-slate-700">Your workspace project is ready. Start by building your first workflow.</span>
            <Link to="/workflows/new" className="font-semibold text-ember hover:underline">Open Workflow Builder →</Link>
            <button type="button" className="ml-auto text-slate-500 hover:text-ink" aria-label="Dismiss welcome message" onClick={() => setWelcome(false)}><Icon name="close" className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      <Outlet />
    </div>
  );
}
