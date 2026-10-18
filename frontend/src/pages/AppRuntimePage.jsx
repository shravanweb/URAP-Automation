import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import { AppPageView, ToastStack } from '../components/AppRenderer.jsx';
import { useAppEngine } from '../lib/useAppEngine.js';

// Published apps open at /apps/:id in a minimal app shell (app name, page navigation, the signed-in
// user). The designer embeds the same runtime for its preview, running against the draft.

function userInitials(name) {
  return String(name || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
}

function initials(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

function AppShell({ runtime, engine, embedded, preview }) {
  const { app, user, canEdit } = runtime;
  const pages = engine.pages;
  return (
    <div className={`flex flex-col bg-[#FAF9F7] ${embedded ? 'h-full' : 'min-h-screen'}`}>
      <header className="sticky top-0 z-30 border-b border-[#ECE8E3] bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-4 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#FF6A3D] to-[#E03A0C] text-[12px] font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]">{initials(app.name)}</span>
            <span className="truncate text-[15px] font-semibold tracking-tight text-ink">{app.name}</span>
            {preview && <span className="shrink-0 rounded-full bg-[#FDF5E6] px-2 py-0.5 text-[11px] font-semibold text-[#8A5A0B]">Preview · draft</span>}
          </div>
          {pages.length > 1 && (
            <nav aria-label="Pages" className="ml-2 flex min-w-0 items-center gap-1 overflow-x-auto">
              {pages.map((page) => (
                <button key={page.id} type="button" aria-current={engine.pageId === page.id ? 'page' : undefined} onClick={() => engine.goTo(page.id)} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-colors ${engine.pageId === page.id ? 'bg-[#F3F0EC] text-ink' : 'text-slate-500 hover:bg-[#F6F4F1] hover:text-ink'}`}>{page.name}</button>
              ))}
            </nav>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-3">
            {!embedded && canEdit && <Link to={`/studio/apps/${app.id}`} className="hidden items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-ink sm:inline-flex"><Icon name="studio" className="h-4 w-4" />Edit in Studio</Link>}
            {!embedded && <Link to="/apps" className="hidden text-[13px] font-medium text-slate-500 hover:text-ink sm:inline">All apps</Link>}
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#F1EEEA] text-[12px] font-semibold text-charcoal" title={user?.name || user?.email}>{userInitials(user?.name || user?.email)}</span>
          </div>
        </div>
      </header>
      <main id={embedded ? undefined : 'app-main'} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] px-5 pb-16 pt-8 sm:px-8">
          {engine.page ? <AppPageView page={engine.page} engine={engine} /> : <p className="text-[14px] text-slate-500">This app has no pages.</p>}
        </div>
      </main>
      <ToastStack toasts={engine.toasts} onDismiss={engine.dismissToast} />
    </div>
  );
}

function RuntimeBody({ runtime, embedded, preview, initialPageId, initialPageInputs, onPageChange }) {
  const engine = useAppEngine({
    appId: runtime.app.id, definition: runtime.definition, app: runtime.app, user: runtime.user, preview,
    initialPageId, initialPageInputs, onPageChange,
  });
  useEffect(() => { if (!embedded) document.title = `${runtime.app.name} · URAP`; }, [embedded, runtime.app.name]);
  return <AppShell runtime={runtime} engine={engine} embedded={embedded} preview={preview} />;
}

export function AppMessage({ icon = 'lock', title, body, action }) {
  return (
    <div className="grid min-h-[60vh] place-items-center px-6">
      <div className="max-w-md text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[#F6F4F1] text-slate-500"><Icon name={icon} className="h-6 w-6" /></span>
        <h1 className="mt-4 text-[18px] font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1.5 text-[14px] leading-6 text-slate-500">{body}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

/** Loads and renders an app. `definition` (designer preview) skips loading the draft again. */
export function AppRuntime({ appId, preview = false, embedded = false, definition = null, initialPageId = null, initialPageInputs = null, onPageChange = null }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    api(`/api/apps/${appId}/runtime${preview ? '?preview=1' : ''}`)
      .then((result) => { if (alive) setState({ loading: false, runtime: result.data }); })
      .catch((error) => { if (alive) setState({ loading: false, error }); });
    return () => { alive = false; };
  }, [appId, preview]);
  const runtime = useMemo(() => (state.runtime && definition ? { ...state.runtime, definition } : state.runtime), [state.runtime, definition]);
  if (state.loading) return <div className="grid min-h-[60vh] place-items-center text-[14px] text-slate-500">Opening app…</div>;
  if (state.error) {
    const code = state.error.code;
    const home = <Link to="/dashboard" className="u-btn-secondary inline-flex rounded-lg px-3.5 py-2 text-[13px] font-semibold">Back to Home</Link>;
    if (code === 'APP_ACCESS_DENIED') return <AppMessage title="You don’t have access to this app" body={state.error.message} action={home} />;
    if (code === 'APP_DISABLED') return <AppMessage icon="eyeOff" title="This app is turned off" body="Its owner turned it off for now. Try again later." action={home} />;
    if (code === 'APP_NOT_PUBLISHED') return <AppMessage icon="clock" title="This app isn’t published yet" body="Its builders are still working on it." action={home} />;
    return <AppMessage icon="alert" title="The app could not be opened" body={state.error.message} action={home} />;
  }
  return <RuntimeBody key={`${appId}-${preview}`} runtime={runtime} embedded={embedded} preview={preview} initialPageId={initialPageId} initialPageInputs={initialPageInputs} onPageChange={onPageChange} />;
}

export default function AppRuntimePage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const initialPageId = params.get('page');
  const [initialPageInputs] = useState(() => Object.fromEntries([...params.entries()].filter(([key]) => key !== 'page')));
  const onPageChange = useCallback((pageId, inputs) => setParams({ page: pageId, ...Object.fromEntries(Object.entries(inputs || {}).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')])) }, { replace: false }), [setParams]);
  useEffect(() => { if (!id) navigate('/apps'); }, [id, navigate]);
  return <AppRuntime appId={id} initialPageId={initialPageId} initialPageInputs={initialPageInputs} onPageChange={onPageChange} />;
}
