import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Icon } from './brand.jsx';
import { PLATFORM_SECTION } from '../layouts/AppLayout.jsx';
import cube from '../assets/logo-mark-3d.png';

// Automation Cloud app launcher (grid button left of the logo). Every enabled item links to a
// real page; Environments and License & Usage have no page yet and are shown as "Coming soon".
const tone = {
  build: 'bg-[#FFF1EC] text-[#E5480F]', run: 'bg-[#E9F7EF] text-[#16834A]', govern: 'bg-[#F1EEFB] text-[#5B47B8]', platform: 'bg-[#EAF2FE] text-[#2563EB]',
};
export const LAUNCHER_GROUPS = [
  ['Build', 'build', 'grid', [
    ['/studio', 'Studio', 'sparkle', 'Design and build automations'],
    ['/projects', 'Projects', 'folder', 'Organize work, files, and members'],
    ['/workflows/new', 'Workflow Builder', 'studio', 'Start a new workflow on the canvas'],
    ['/workflows', 'Workflow Library', 'library', 'Browse, publish, and run workflows'],
    ['/apps', 'Apps', 'app', 'Custom apps published for you'],
    ['/connections', 'Connections', 'link', 'Credentials and integrations'],
  ]],
  ['Run', 'run', 'play', [
    ['/jobs', 'Jobs & Runs', 'play', 'Monitor executions and retries'],
    ['/schedules', 'Schedules', 'calendar', 'Time-based triggers'],
    ['/queues', 'Queues', 'queue', 'Work queues and transaction items'],
    ['/tasks', 'Action Center', 'tasks', 'Approvals and human-in-the-loop tasks'],
    ['/cases', 'Cases', 'briefcase', 'Work cases through stages and SLAs'],
  ]],
  ['Govern', 'govern', 'shield', [
    ['/reports', 'Reports', 'chart', 'Execution reports and exports'],
    ['/audit', 'Audit Logs', 'audit', 'Who changed what, and when'],
    ['/settings#general', 'Organization Settings', 'settings', 'Users, roles, and permissions'],
    [null, 'Environments', 'globe', 'Manage tenants and configurations'],
    [null, 'License & Usage', 'badge', 'Billing, plans, and usage details'],
  ]],
];
const PRIMARY = [['/dashboard', 'Home', 'home', 'Your automation overview'], ['/metrics', 'Metrics', 'gauge', 'Counts, trends, and recent errors']];
const PLATFORM_DESCRIPTIONS = { '/platform': 'KPIs across every workspace', '/platform/workspaces': 'Suspend, review, and search tenants', '/platform/users': 'Accounts across all workspaces', '/platform/audit': 'Super admin actions' };

export function launcherGroups(user) {
  if (!user?.isSuperAdmin) return LAUNCHER_GROUPS;
  return [...LAUNCHER_GROUPS, ['Platform', 'platform', 'shield', PLATFORM_SECTION[1].map(([to, label, icon]) => [to, label, icon, PLATFORM_DESCRIPTIONS[to]])]];
}

export function filterGroups(groups, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  return groups.map(([name, key, icon, items]) => [name, key, icon, items.filter(([, label, , sub]) => `${label} ${sub}`.toLowerCase().includes(needle))]).filter(([, , , items]) => items.length);
}

function Item({ to, label, icon, sub, toneClass, onNavigate, badge }) {
  const body = (active) => (
    <>
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${toneClass}`}><Icon name={icon} className="h-[16px] w-[16px]" strokeWidth={1.8} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold leading-5 text-[#172125]">{label}</span>
        <span className="block truncate text-[12px] leading-[17px] text-[#7A858B]">{to ? sub : <><span className="font-semibold text-[#9A6B57]">Coming soon</span> · {sub}</>}</span>
      </span>
      {badge > 0 && <span className="rounded-full bg-[#FA4616] px-1.5 py-0.5 text-[10.5px] font-semibold leading-none text-white" aria-label={`${badge} pending`}>{badge}</span>}
      {to && <Icon name="chevronRight" className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-[#E5480F]' : 'text-[#B8BFC3] group-hover:text-[#5B6870]'}`} />}
    </>
  );
  const base = 'group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#FA4616]/35';
  if (!to) return <span className={`${base} cursor-not-allowed opacity-60`} aria-disabled="true">{body(false)}</span>;
  return (
    <NavLink to={to} end data-launcher-item onClick={onNavigate} className={({ isActive }) => `${base} ${isActive ? 'bg-[#FFF4EF]' : 'hover:bg-[#F7F4F1] focus-visible:bg-[#F7F4F1]'}`}>
      {({ isActive }) => <>{body(isActive)}{isActive && <span className="sr-only">(current page)</span>}</>}
    </NavLink>
  );
}

export function AppLauncher({ user, tenant, pending = 0, onNavigate = () => {}, onHelp = () => {}, autoFocusSearch = false }) {
  const ref = useRef(null);
  const search = useRef(null);
  const [query, setQuery] = useState('');
  const groups = filterGroups(launcherGroups(user), query);
  const primary = PRIMARY.filter(([, label, , sub]) => !query.trim() || `${label} ${sub}`.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (autoFocusSearch) { search.current?.focus(); return; }
    const active = ref.current?.querySelector('[data-launcher-item][aria-current="page"]');
    (active || search.current)?.focus();
  }, [autoFocusSearch]);

  const onKeyDown = (event) => {
    const items = [...ref.current.querySelectorAll('[data-launcher-item]')];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length].focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); (index <= 0 ? search.current : items[index - 1]).focus(); }
    else if (event.key === 'Enter' && document.activeElement === search.current) { event.preventDefault(); items[0].click(); }
  };

  return (
    <div ref={ref} id="app-launcher" role="dialog" aria-label="App launcher" onKeyDown={onKeyDown}
      className="absolute left-0 z-40 mt-2.5 w-[min(96vw,1040px)] max-h-[calc(100vh-80px)] overflow-y-auto rounded-2xl border border-[#EDE6DF] bg-white shadow-[0_1px_2px_rgba(23,33,37,0.05),0_12px_24px_-8px_rgba(23,33,37,0.12),0_32px_64px_-24px_rgba(23,33,37,0.22)] animate-[launcher-in_140ms_cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:animate-none">
      <div className="grid lg:grid-cols-[210px_1fr]">
        <aside className="hidden flex-col gap-3 border-r border-[#F1EBE5] p-4 lg:flex">
          <div>
            <p className="text-[14.5px] font-semibold tracking-tight text-[#172125]">URAP Automation Cloud</p>
            <Link to="/settings#general" onClick={onNavigate} className="mt-0.5 inline-flex items-center gap-1 text-[12.5px] text-[#5B6870] hover:text-[#172125]">{tenant?.name || 'Your workspace'}<Icon name="chevronRight" className="h-3 w-3" /></Link>
          </div>
          <ul className="space-y-1">{primary.map(([to, label, icon, sub]) => <li key={to}><Item to={to} label={label} icon={icon} sub={sub} toneClass="bg-[#FFF1EC] text-[#E5480F]" onNavigate={onNavigate} /></li>)}</ul>
          <div className="mt-auto overflow-hidden rounded-2xl border border-[#F6E3D9] bg-gradient-to-br from-[#FFF7F3] to-[#FFEDE4] p-4">
            <p className="text-[14px] font-semibold text-[#172125]">Build. Run. Scale.</p>
            <p className="mt-1 text-[12px] leading-[17px] text-[#5B6870]">Automate repetitive work, integrate with your systems, and focus on what matters most.</p>
            <img src={cube} alt="" className="mx-auto mt-2 h-28 w-28 object-contain drop-shadow-[0_12px_18px_rgba(250,70,22,0.3)]" />
          </div>
        </aside>

        <div className="min-w-0 p-4">
          <label className="relative block">
            <span className="sr-only">Search for a feature, service, or help</span>
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9AA3A7]" />
            <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search for a feature, service, or help..." aria-controls="launcher-results"
              className="h-10 w-full rounded-xl border border-[#E9E2DB] bg-[#FBF9F7] pl-9 pr-16 text-[13.5px] text-[#172125] placeholder:text-[#9AA3A7] focus:border-[#F3B49C] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FA4616]/12" />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-[#E9E2DB] bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-[#7A858B]">Ctrl K</kbd>
          </label>
          <div className="mt-3 lg:hidden"><ul className="grid gap-1 sm:grid-cols-2">{primary.map(([to, label, icon, sub]) => <li key={to}><Item to={to} label={label} icon={icon} sub={sub} toneClass="bg-[#FFF1EC] text-[#E5480F]" onNavigate={onNavigate} /></li>)}</ul></div>
          <div id="launcher-results" className={`mt-3 grid gap-x-3 gap-y-4 sm:grid-cols-2 ${groups.length > 3 ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
            {groups.length === 0 && primary.length === 0 && <p className="col-span-full py-10 text-center text-[13px] text-[#7A858B]">No services match “{query}”.</p>}
            {groups.map(([name, key, icon, items]) => (
              <div key={name} role="group" aria-label={name} className="min-w-0">
                <p className="mb-1.5 flex items-center gap-2 px-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#5B6870]"><span className={`grid h-5 w-5 place-items-center rounded-md ${tone[key]}`}><Icon name={icon} className="h-3 w-3" /></span>{name}</p>
                <ul className="space-y-0.5">{items.map(([to, label, itemIcon, sub]) => <li key={label}><Item to={to} label={label} icon={itemIcon} sub={sub} toneClass={tone[key]} onNavigate={onNavigate} badge={to === '/tasks' ? pending : 0} /></li>)}</ul>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#F1EBE5] pt-3 text-[12.5px] text-[#5B6870]">
            <Link to="/settings" onClick={onNavigate} className="inline-flex items-center gap-1.5 hover:text-[#172125]"><Icon name="settings" className="h-4 w-4" />Settings</Link>
            <button type="button" onClick={onHelp} className="inline-flex items-center gap-1.5 hover:text-[#172125]"><Icon name="help" className="h-4 w-4" />Help &amp; documentation</button>
            <Link to="/dashboard#whats-new" onClick={onNavigate} className="inline-flex items-center gap-1.5 hover:text-[#172125]"><Icon name="sparkle" className="h-4 w-4" />What's new</Link>
            <Link to="/studio" onClick={onNavigate} className="ml-auto inline-flex items-center gap-3 rounded-xl border border-[#F6D9CB] bg-gradient-to-r from-[#FFF4EE] to-[#FFEADF] px-3.5 py-2 hover:border-[#F3B49C]">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#FA4616] text-white"><Icon name="grid" className="h-4 w-4" /></span>
              <span><span className="block text-[12.5px] font-semibold text-[#E5480F]">Explore URAP platform →</span><span className="block text-[11.5px] text-[#7A858B]">Learn, build, and automate faster</span></span>
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}
