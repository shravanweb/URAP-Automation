import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, currentUser } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import { timeAgo } from '../layouts/CloudLayout.jsx';

// Directory of the published apps the signed-in user may open.

const canBuild = (role) => ['administrator', 'project_manager', 'automation_developer'].includes(role);

function initials(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

export function AppCard({ app }) {
  return (
    <Link to={`/apps/${app.id}`} className="u-card u-lift group flex flex-col rounded-xl p-4 transition-shadow">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#FF6A3D] to-[#E03A0C] text-[13px] font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]">{initials(app.name)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-semibold text-ink group-hover:text-ember">{app.name}</p>
          <p className="truncate text-[12px] text-slate-500">{app.projectName}</p>
        </div>
        <Icon name="external" className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-ember" />
      </div>
      <p className="mt-3 line-clamp-2 min-h-[40px] text-[13px] leading-5 text-slate-600">{app.description || 'No description.'}</p>
      <p className="mt-3 border-t border-[#F1EEEA] pt-3 text-[11.5px] text-slate-400">v{app.versionNumber} · updated {timeAgo(app.publishedAt || app.updatedAt)}</p>
    </Link>
  );
}

export default function AppsPage() {
  const user = currentUser();
  const [state, setState] = useState({ loading: true, apps: [] });
  const [search, setSearch] = useState('');
  useEffect(() => {
    let alive = true;
    api('/api/apps/available').then((result) => { if (alive) setState({ loading: false, apps: result.data }); }).catch((error) => { if (alive) setState({ loading: false, apps: [], error: error.message }); });
    return () => { alive = false; };
  }, []);
  const rows = state.apps.filter((app) => !search || `${app.name} ${app.description} ${app.projectName}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <main id="app-main" className="mx-auto min-h-[calc(100vh-3.5rem)] max-w-[1280px] px-5 pb-16 pt-8 sm:px-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Apps</h1>
          <p className="mt-1 text-[13.5px] text-slate-500">Custom apps published for you: forms, dashboards, and tools that run your automations.</p>
        </div>
        <div className="flex items-center gap-2">
          {state.apps.length > 0 && (
            <label className="relative">
              <span className="sr-only">Search apps</span>
              <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search apps" className="h-9 w-56 rounded-lg border border-[#ECE8E3] bg-white pl-8 pr-3 text-[13px] text-ink placeholder:text-slate-400 focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15" />
            </label>
          )}
          {canBuild(user?.role) && <Link to="/studio?view=apps" className="u-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold"><Icon name="studio" className="h-4 w-4" />Build apps</Link>}
        </div>
      </div>
      {state.error && <p className="mt-6 rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger" role="alert">{state.error}</p>}
      {state.loading ? (
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">{[0, 1, 2].map((index) => <div key={index} className="h-[156px] animate-pulse rounded-xl bg-white" />)}</div>
      ) : !state.apps.length ? (
        <div className="mt-7 flex flex-col items-center rounded-xl u-card px-6 py-16 text-center">
          <span className="u-tile grid h-12 w-12 place-items-center rounded-xl bg-[#FFF1EB] text-ember"><Icon name="app" className="h-6 w-6" /></span>
          <h2 className="mt-4 text-[16px] font-semibold tracking-tight text-ink">No apps yet</h2>
          <p className="mt-1.5 max-w-md text-[13.5px] leading-6 text-slate-500">When someone publishes an app and shares it with you, it shows up here.</p>
          {canBuild(user?.role) && <Link to="/studio?view=apps" className="mt-5 u-btn-primary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold"><Icon name="plus" className="h-4 w-4" />Build an app</Link>}
        </div>
      ) : (
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((app) => <AppCard key={app.id} app={app} />)}
          {!rows.length && <p className="col-span-full py-10 text-center text-[13px] text-slate-500">No apps match “{search}”.</p>}
        </div>
      )}
    </main>
  );
}
