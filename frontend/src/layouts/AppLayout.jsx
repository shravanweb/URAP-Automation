import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, clearSession, currentUser, getRefreshToken } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import logoLight from '../assets/logo-light.png';

export const SECTIONS = [
  ['Overview', [['/dashboard', 'Home', 'home'], ['/metrics', 'Metrics', 'gauge']]],
  ['Build', [
    ['/studio', 'Studio', 'sparkle'],
    ['/projects', 'Projects', 'folder'],
    ['/workflows/new', 'Workflow Builder', 'studio'],
    ['/workflows', 'Workflow Library', 'library'],
    ['/connections', 'Connections', 'link'],
  ]],
  ['Run', [
    ['/jobs', 'Jobs & Runs', 'play'],
    ['/schedules', 'Schedules', 'calendar'],
    ['/queues', 'Queues', 'queue'],
    ['/tasks', 'Action Center', 'tasks'],
    ['/apps', 'Apps', 'app'],
    ['/cases', 'Cases', 'briefcase'],
  ]],
  ['Govern', [
    ['/reports', 'Reports', 'chart'],
    ['/audit', 'Audit Logs', 'audit'],
    ['/settings', 'Settings', 'settings'],
  ]],
];

const TITLES = [
  ['/workflows/new', 'Workflow Builder'], ['/workflows/', 'Workflow Builder'], ['/workflows', 'Workflow Library'],
  ['/jobs/', 'Job details'], ['/tasks/', 'Action Center'],
  ...SECTIONS.flatMap(([, links]) => links.map(([to, label]) => [to, label])),
];

function pageTitle(pathname) {
  const exact = TITLES.find(([prefix]) => pathname === prefix);
  if (exact) return exact[1];
  return TITLES.find(([prefix]) => prefix.endsWith('/') && pathname.startsWith(prefix))?.[1] || 'URAP';
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'U';
}

function SideNav({ pending, onNavigate }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Platform">
      {SECTIONS.map(([section, links]) => (
        <div key={section} className="mt-5 first:mt-2">
          <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">{section}</p>
          <ul className="mt-1.5 space-y-0.5">
            {links.map(([to, label, icon]) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === '/workflows'}
                  onClick={onNavigate}
                  className={({ isActive }) => `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'}`}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand" aria-hidden="true" />}
                      <Icon name={icon} className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-brand' : 'text-white/50 group-hover:text-white/80'}`} />
                      <span className="truncate">{label}</span>
                      {to === '/tasks' && pending > 0 && (
                        <span className="ml-auto rounded-full bg-brand px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white" aria-label={`${pending} pending tasks`}>{pending}</span>
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export default function AppLayout() {
  const user = currentUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [pending, setPending] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [welcome, setWelcome] = useState(Boolean(location.state?.welcome));

  useEffect(() => {
    let alive = true;
    const load = () => api('/api/tasks/summary').then((result) => { if (alive) setPending(result.data.pending); }).catch(() => {});
    load();
    const timer = setInterval(load, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, [location.pathname]);

  useEffect(() => { setDrawer(false); setMenu(false); }, [location.pathname]);
  useEffect(() => {
    if (!drawer && !menu) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') { setDrawer(false); setMenu(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, menu]);

  const title = pageTitle(location.pathname);
  useEffect(() => { document.title = `${title} · URAP`; }, [title]);

  const signOut = async () => {
    await api('/api/auth/logout', { method: 'POST', body: { refreshToken: getRefreshToken() } }).catch(() => {});
    clearSession();
    navigate('/login', { state: { signedOut: true } });
  };

  const brand = (
    <Link to="/dashboard" className="block px-5 py-5" aria-label="URAP dashboard">
      <img src={logoLight} alt="URAP" className="h-11 w-auto" />
    </Link>
  );

  return (
    <div className="min-h-screen bg-cream lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a href="#app-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2">Skip to content</a>

      <aside className="sticky top-0 hidden h-screen flex-col bg-navy-900 lg:flex">
        {brand}
        <SideNav pending={pending} />
        <div className="border-t border-white/10 px-5 py-4 text-xs text-white/40">Universal RPA Automation Platform</div>
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" className="absolute inset-0 bg-navy-950/60" aria-label="Close navigation" onClick={() => setDrawer(false)} />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col bg-navy-900 shadow-lift">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button type="button" className="grid h-9 w-9 place-items-center rounded-lg text-white/70 hover:bg-white/10" aria-label="Close navigation" onClick={() => setDrawer(false)}><Icon name="close" /></button>
            </div>
            <SideNav pending={pending} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6">
          <button type="button" className="grid h-10 w-10 place-items-center rounded-lg border border-line text-ink lg:hidden" aria-label="Open navigation" aria-expanded={drawer} onClick={() => setDrawer(true)}>
            <Icon name="menu" />
          </button>
          <div className="min-w-0">
            <p className="hidden text-xs text-slate-500 sm:block">URAP</p>
            <p className="truncate text-[15px] font-semibold text-ink">{title}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/tasks" className="relative grid h-10 w-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-ink" aria-label={`Action Center, ${pending} pending`}>
              <Icon name="tasks" />
              {pending > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand" aria-hidden="true" />}
            </Link>
            <div className="relative">
              <button type="button" className="flex items-center gap-2.5 rounded-lg py-1.5 pl-1.5 pr-2 hover:bg-slate-100" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((open) => !open)}>
                <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-xs font-semibold text-white">{initials(user?.displayName)}</span>
                <span className="hidden text-left sm:block">
                  <span className="block max-w-[160px] truncate text-sm font-medium leading-tight text-ink">{user?.displayName}</span>
                  <span className="block text-xs capitalize leading-tight text-slate-500">{user?.role?.replaceAll('_', ' ')}</span>
                </span>
              </button>
              {menu && (
                <>
                  <button type="button" className="fixed inset-0 z-10 cursor-default" aria-hidden="true" tabIndex={-1} onClick={() => setMenu(false)} />
                  <div role="menu" className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-line bg-white p-1.5 shadow-lift">
                    <div className="px-3 py-2.5">
                      <p className="truncate text-sm font-semibold text-ink">{user?.displayName}</p>
                      <p className="truncate text-xs text-slate-500">{user?.email}</p>
                    </div>
                    <div className="my-1 h-px bg-line" />
                    {user?.role === 'administrator' && <Link role="menuitem" to="/settings" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink hover:bg-slate-100"><Icon name="settings" className="h-4 w-4" />Settings</Link>}
                    <Link role="menuitem" to="/" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink hover:bg-slate-100"><Icon name="home" className="h-4 w-4" />Homepage</Link>
                    <button role="menuitem" type="button" className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-danger hover:bg-[#FEF3F2]" onClick={signOut}><Icon name="logout" className="h-4 w-4" />Sign out</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        {welcome && (
          <div className="border-b border-[#FFD8CA] bg-brandsoft px-4 py-3 sm:px-6" role="status">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink">
              <span className="font-semibold">Welcome to URAP, {user?.displayName?.split(' ')[0]}.</span>
              <span className="text-slate-700">Your workspace project is ready. Start by building your first workflow.</span>
              <Link to="/workflows/new" className="link">Open Workflow Builder →</Link>
              <button type="button" className="ml-auto text-slate-500 hover:text-ink" aria-label="Dismiss welcome message" onClick={() => setWelcome(false)}><Icon name="close" className="h-4 w-4" /></button>
            </div>
          </div>
        )}
        <main id="app-main" className="min-w-0 flex-1 p-4 sm:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
