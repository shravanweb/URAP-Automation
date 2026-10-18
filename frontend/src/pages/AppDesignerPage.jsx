import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, currentUser } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import { StatusPill } from './HomePage.jsx';
import { timeAgo } from '../layouts/CloudLayout.jsx';
import { AppPageView } from '../components/AppRenderer.jsx';
import { AccessDialog, ComponentProperties, DataPanel, PageProperties, PagesPanel, Palette, PanelSection, Row, input } from '../components/AppDesignerPanels.jsx';
import { AppRuntime } from './AppRuntimePage.jsx';
import { COMPONENTS, allComponents, newComponent, resolvePath, stripBraces, validateAppDefinition } from '../lib/appDefinition.js';
import { bindingSuggestions, duplicateComponent, findInPage, insertComponent, moveComponent, removeComponent, updateComponent } from '../lib/appDesign.js';
import { useAppEngine } from '../lib/useAppEngine.js';

// App designer: a component palette, pages, data sources and variables on the left; the page on a
// 12-column grid in the middle (drag to add or rearrange, click to select); properties, bindings
// and actions on the right. Preview runs the saved draft for real. Publish validates first.

const canWrite = (role) => ['administrator', 'project_manager', 'automation_developer'].includes(role);
const canPublish = canWrite;
const secondaryBtn = 'u-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const primaryBtn = 'u-btn-primary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-60';
const EMPTY_DEFINITION = { pages: [] };
const EMPTY_LOOKUPS = { workflows: [], flows: [], agents: [], queues: [], connections: [], members: [], users: [], caseTypes: [] };

function toMaps(lookups) {
  const map = (rows, extra = (row) => row) => new Map(rows.map((row) => [row.id, extra(row)]));
  return {
    workflows: map(lookups.workflows),
    flows: map(lookups.flows),
    agents: map(lookups.agents, (row) => ({ ...row, agent_type: row.agentType })),
    queues: map(lookups.queues),
    connections: map(lookups.connections),
    caseTypes: map(lookups.caseTypes || []),
  };
}

function IssuesPopover({ validation, onPick, onClose }) {
  const items = [...validation.errors.map((item) => ({ ...item, level: 'error' })), ...validation.warnings.map((item) => ({ ...item, level: 'warning' }))];
  const ref = useRef(null);
  useEffect(() => {
    const close = (event) => { if (!ref.current?.contains(event.target)) onClose(); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [onClose]);
  return (
    <div ref={ref} className="absolute right-0 top-10 z-40 w-[380px] rounded-xl border border-[#ECE8E3] bg-white p-1.5 shadow-[0_16px_40px_-16px_rgba(16,24,40,0.28)]" role="dialog" aria-label="Issues">
      {!items.length && <p className="px-3 py-3 text-[13px] text-slate-500">No issues. The app is ready to publish.</p>}
      <ul className="max-h-[360px] overflow-y-auto">
        {items.map((item, index) => (
          <li key={index}>
            <button type="button" className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[#F6F4F1]" onClick={() => onPick(item)}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.level === 'error' ? 'bg-[#D9382B]' : 'bg-[#D99A1E]'}`} />
              <span className="text-[12.5px] leading-5 text-ink">{item.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AppDesignerPage() {
  const { id } = useParams();
  const user = currentUser();
  const editable = canWrite(user?.role);
  const [app, setApp] = useState(null);
  const [definition, setDefinition] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lookups, setLookups] = useState(EMPTY_LOOKUPS);
  const [pageId, setPageId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('components');
  const [mode, setMode] = useState('design');
  const [previewKey, setPreviewKey] = useState(0);
  const [accessOpen, setAccessOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [drag, setDrag] = useState(null);
  const [dropTarget, setDropTargetState] = useState(null);
  const dropRef = useRef(null);

  const load = useCallback(async () => {
    const { data } = await api(`/api/apps/${id}`);
    setApp(data);
    setDefinition(data.definition);
    setName(data.name);
    setDescription(data.description || '');
    setDirty(false);
    setPageId((current) => (current && data.definition.pages.some((page) => page.id === current) ? current : data.definition.pages[0]?.id));
    return data;
  }, [id]);

  useEffect(() => {
    let alive = true;
    load().then(async (data) => {
      const get = (path) => api(path).then((result) => result.data).catch(() => []);
      const [workflows, flows, agents, queues, connections, members, users, caseTypes] = await Promise.all([
        get(`/api/workflows?projectId=${data.projectId}&limit=100`),
        get(`/api/flows?projectId=${data.projectId}&limit=100`),
        get(`/api/agents?projectId=${data.projectId}&limit=100`),
        get(`/api/queues?projectId=${data.projectId}&limit=100`),
        get(`/api/projects/${data.projectId}/connections`),
        get(`/api/projects/${data.projectId}/members`),
        user?.role === 'administrator' ? get('/api/users') : Promise.resolve([]),
        get(`/api/case-types?projectId=${data.projectId}&limit=100&published=1`),
      ]);
      if (alive) setLookups({ workflows, flows, agents, queues, connections: connections.filter((item) => item.connectorType === 'rest_api'), members, users, caseTypes });
    }).catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [load, user?.role]);

  const lookupMaps = useMemo(() => toMaps(lookups), [lookups]);
  const validation = useMemo(() => (definition ? validateAppDefinition(definition, lookupMaps) : { errors: [], warnings: [] }), [definition, lookupMaps]);
  const page = definition?.pages.find((item) => item.id === pageId) || definition?.pages[0] || null;
  const selected = page && selectedId ? findInPage(page, selectedId)?.component : null;
  const suggestions = useMemo(() => (definition && page ? bindingSuggestions(definition, page) : []), [definition, page]);
  const savedSources = app?.definition?.dataSources || [];

  const canvasUser = useMemo(() => ({ id: user?.id, name: user?.displayName || user?.email, email: user?.email, role: user?.role }), [user?.id, user?.displayName, user?.email, user?.role]);
  const canvasApp = useMemo(() => ({ id, name }), [id, name]);
  const engine = useAppEngine({
    appId: app ? id : null, definition: definition || EMPTY_DEFINITION, app: canvasApp, user: canvasUser, preview: true, interactive: false, dataSources: savedSources,
  });
  useEffect(() => { if (page && engine.pageId !== page.id) engine.goTo(page.id); }, [page, engine]);

  const change = useCallback((next) => { setDefinition(next); setDirty(true); setNotice(''); }, []);
  const changePage = useCallback((nextPage) => change({ ...definition, pages: definition.pages.map((item) => (item.id === nextPage.id ? nextPage : item)) }), [change, definition]);

  const save = useCallback(async () => {
    if (!editable || !definition) return app;
    setSaving(true); setError('');
    try {
      if (name.trim() !== app.name || description !== (app.description || '')) await api(`/api/apps/${id}`, { method: 'PATCH', body: { name: name.trim() || app.name, description } });
      const { data } = await api(`/api/apps/${id}/draft`, { method: 'PUT', body: { definition } });
      setApp(data);
      setDirty(false);
      setNotice('Draft saved');
      return data;
    } catch (err) {
      setError(err.details?.length ? `${err.message}: ${err.details.map((item) => item.message).slice(0, 3).join('; ')}` : err.message);
      return null;
    } finally {
      setSaving(false);
    }
  }, [editable, definition, app, name, description, id]);

  async function publish() {
    if (validation.errors.length) { setIssuesOpen(true); setError(`Fix ${validation.errors.length} issue${validation.errors.length === 1 ? '' : 's'} before publishing.`); return; }
    const saved = dirty ? await save() : app;
    if (!saved) return;
    setSaving(true); setError('');
    try {
      const { data } = await api(`/api/apps/${id}/publish`, { method: 'POST' });
      setApp(data);
      setNotice(`Published version ${data.versionNumber}. People with access can open it now.`);
    } catch (err) {
      setError(err.details?.length ? `${err.message}: ${err.details.map((item) => item.message).slice(0, 3).join('; ')}` : err.message);
    } finally {
      setSaving(false);
    }
  }

  async function setEnabled(enabled) {
    try { const { data } = await api(`/api/apps/${id}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' }); setApp(data); setNotice(enabled ? 'The app is on again.' : 'The app is turned off. Nobody can open it until you turn it on.'); } catch (err) { setError(err.message); }
  }

  async function togglePreview() {
    if (mode === 'preview') { setMode('design'); return; }
    if (dirty && editable) { const saved = await save(); if (!saved) return; }
    setPreviewKey((key) => key + 1);
    setMode('preview');
  }

  async function loadSource(source) {
    let saved = savedSources.some((item) => JSON.stringify(item) === JSON.stringify(source));
    if (!saved && editable) saved = Boolean(await save());
    if (saved) engine.loadSource(source);
  }

  // Keyboard: Ctrl/Cmd+S saves, Delete removes the selection, Escape clears it.
  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (dirty) save(); return; }
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (typing || mode !== 'design') return;
      if (event.key === 'Escape') setSelectedId(null);
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && editable && page) { event.preventDefault(); changePage(removeComponent(page, selectedId)); setSelectedId(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, save, mode, selectedId, editable, page, changePage]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const takenIds = () => definition.pages.flatMap((item) => allComponents(item).map((component) => component.id));
  const addComponent = (type, parentId = undefined, index = undefined) => {
    if (!editable || !page) return;
    const component = newComponent(type, takenIds());
    let target = parentId;
    let position = index;
    if (target === undefined) {
      const found = selectedId ? findInPage(page, selectedId) : null;
      if (found && COMPONENTS[found.component.type]?.container && !COMPONENTS[type]?.container) { target = found.component.id; position = (found.component.children || []).length; }
      else if (found) { target = found.parent?.id || null; position = found.index + 1; }
      else { target = null; position = page.components.length; }
    }
    changePage(insertComponent(page, component, target, position));
    setSelectedId(component.id);
  };

  const setDropTarget = useCallback((next) => {
    const key = JSON.stringify(next);
    if (dropRef.current === key) return;
    dropRef.current = key;
    setDropTargetState(next);
  }, []);
  const endDrag = useCallback(() => { setDrag(null); setDropTarget(null); }, [setDropTarget]);
  const design = editable ? {
    selectedId,
    onSelect: (componentId) => { setSelectedId(componentId); setTab((current) => current); },
    dropTarget,
    setDropTarget,
    dragging: Boolean(drag),
    onDragStart: (componentId, event) => { event.dataTransfer.setData('text/plain', `move:${componentId}`); event.dataTransfer.effectAllowed = 'move'; setDrag({ kind: 'move', id: componentId }); },
    onDragEnd: endDrag,
    onDrop: (parentId, index, event) => {
      const raw = event.dataTransfer?.getData('text/plain') || '';
      const current = drag || (raw.startsWith('new:') ? { kind: 'new', type: raw.slice(4) } : raw.startsWith('move:') ? { kind: 'move', id: raw.slice(5) } : null);
      endDrag();
      if (!current || !page) return;
      if (current.kind === 'new' && COMPONENTS[current.type]) addComponent(current.type, parentId, index);
      if (current.kind === 'move' && current.id !== parentId) { changePage(moveComponent(page, current.id, parentId, index)); setSelectedId(current.id); }
    },
  } : { selectedId, onSelect: setSelectedId, dropTarget: null, setDropTarget: () => {}, dragging: false, onDragStart: (componentId, event) => event.preventDefault(), onDragEnd: () => {}, onDrop: () => {} };

  const pickIssue = (item) => {
    setIssuesOpen(false);
    if (item.pageId) setPageId(item.pageId);
    if (item.componentId) { setSelectedId(item.componentId); setMode('design'); }
    else if (item.sourceId || item.field === 'variables') { setTab('data'); setSelectedId(null); }
    else if (item.pageId) { setTab('pages'); setSelectedId(null); }
  };

  const sampleRow = (() => {
    if (selected?.type !== 'table') return null;
    const rows = resolvePath(engine.context, stripBraces(selected.props?.rows || ''));
    return Array.isArray(rows) ? rows[0] : null;
  })();

  if (error && !app) return <div className="p-8"><p className="rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger" role="alert">{error}</p></div>;
  if (!app || !definition || !page) return <div className="p-8 text-[14px] text-slate-500">Loading app…</div>;

  const issueCount = validation.errors.length;
  const warningCount = validation.warnings.length;
  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-[560px] flex-col bg-[#FAF9F7]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#ECE8E3] bg-white px-4 py-2.5">
        <Link to="/studio?view=apps" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Back to apps"><Icon name="arrow" className="h-4 w-4 rotate-180" /></Link>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#FFF1EB] text-ember"><Icon name="app" className="h-4 w-4" /></span>
        <div className="min-w-0">
          <input aria-label="App name" className="w-[260px] max-w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-semibold tracking-tight text-ink hover:border-[#ECE8E3] focus:border-ember focus:outline-none" value={name} disabled={!editable} onChange={(event) => { setName(event.target.value); setDirty(true); }} />
          <p className="px-1 text-[11.5px] text-slate-500">{app.projectName}{app.versionNumber ? ` · v${app.versionNumber} published ${timeAgo(app.publishedAt)}` : ' · not published yet'}{dirty ? ' · unsaved changes' : notice === 'Draft saved' ? ' · draft saved' : ''}</p>
        </div>
        <StatusPill status={app.status} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <button type="button" className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-semibold ${issueCount ? 'border-[#F5C9C4] bg-[#FEF3F2] text-[#A8261B]' : warningCount ? 'border-[#F1DDB4] bg-[#FEF8EC] text-[#8A5A0B]' : 'border-[#D5EBDC] bg-[#F1F9F3] text-[#1F6B3A]'}`} aria-expanded={issuesOpen} onClick={() => setIssuesOpen(!issuesOpen)}>
              <Icon name={issueCount ? 'alert' : 'check'} className="h-3.5 w-3.5" />
              {issueCount ? `${issueCount} issue${issueCount === 1 ? '' : 's'}` : warningCount ? `${warningCount} warning${warningCount === 1 ? '' : 's'}` : 'Ready'}
            </button>
            {issuesOpen && <IssuesPopover validation={validation} onPick={pickIssue} onClose={() => setIssuesOpen(false)} />}
          </div>
          <div role="radiogroup" aria-label="Mode" className="flex rounded-lg border border-[#E2DCD5] bg-[#FAF9F7] p-0.5">
            {[['design', 'Design'], ['preview', 'Preview']].map(([key, text]) => (
              <button key={key} type="button" role="radio" aria-checked={mode === key} onClick={() => { if (key !== mode) togglePreview(); }} className={`rounded-md px-3 py-1 text-[12.5px] font-semibold ${mode === key ? 'bg-white text-ink shadow-[0_1px_2px_rgba(16,24,40,0.08)]' : 'text-slate-500 hover:text-ink'}`}>{text}</button>
            ))}
          </div>
          {canPublish(user?.role) && <button type="button" className={secondaryBtn} onClick={() => setAccessOpen(true)}><Icon name="users" className="h-4 w-4" />Share</button>}
          {app.status === 'published' && <a href={`/apps/${id}`} target="_blank" rel="noreferrer" className={secondaryBtn}><Icon name="external" className="h-4 w-4" />Open app</a>}
          {editable && <button type="button" className={secondaryBtn} disabled={saving || !dirty} onClick={save} title="Ctrl+S">{saving ? 'Saving…' : 'Save draft'}</button>}
          {canPublish(user?.role) && <button type="button" className={primaryBtn} disabled={saving} onClick={publish}>Publish</button>}
        </div>
      </header>
      {(error || (notice && notice !== 'Draft saved')) && (
        <div className={`flex items-center gap-2 border-b px-4 py-2 text-[13px] ${error ? 'border-[#F5C9C4] bg-[#FEF3F2] text-danger' : 'border-[#D5EBDC] bg-[#F1F9F3] text-[#1F6B3A]'}`} role={error ? 'alert' : 'status'}>
          <Icon name={error ? 'alert' : 'check'} className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{error || notice}</span>
          <button type="button" className="text-[12px] font-semibold opacity-70 hover:opacity-100" onClick={() => { setError(''); setNotice(''); }}>Dismiss</button>
        </div>
      )}
      {mode === 'preview' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="border-b border-[#F1DDB4] bg-[#FEF8EC] px-4 py-1.5 text-[12.5px] text-[#8A5A0B]">Preview runs the saved draft for real: workflows run, queue items and tasks get created.</p>
          <div className="min-h-0 flex-1 overflow-hidden"><AppRuntime key={previewKey} appId={id} preview embedded /></div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[268px] shrink-0 flex-col border-r border-[#ECE8E3] bg-white" aria-label="Build">
            <div role="tablist" className="flex gap-1 border-b border-[#ECE8E3] px-3 pt-2">
              {[['components', 'Add'], ['pages', 'Pages'], ['data', 'Data']].map(([key, text]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`-mb-px border-b-2 px-2.5 pb-2 pt-1 text-[13px] font-semibold ${tab === key ? 'border-ember text-ink' : 'border-transparent text-slate-500 hover:text-ink'}`}>{text}</button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === 'components' && <Palette disabled={!editable} onAdd={(type) => addComponent(type)} onDragStart={(type) => setDrag({ kind: 'new', type })} onDragEnd={endDrag} />}
              {tab === 'pages' && <PagesPanel definition={definition} pageId={page.id} disabled={!editable} validation={validation} onChange={change} onSelect={(next) => { setPageId(next); setSelectedId(null); }} />}
              {tab === 'data' && <DataPanel definition={definition} onChange={change} lookups={lookups} disabled={!editable} validation={validation} engine={engine} savedSources={savedSources} onLoad={loadSource} />}
            </div>
          </aside>
          <main className="min-w-0 flex-1 overflow-auto bg-[#F3F1EE] [background-image:radial-gradient(#E3DDD6_1px,transparent_1px)] [background-size:18px_18px]" onClick={() => setSelectedId(null)}>
            <div className="mx-auto my-6 w-[calc(100%-48px)] max-w-[1040px] overflow-hidden rounded-2xl border border-[#E6E1DB] bg-[#FAF9F7] shadow-[0_24px_48px_-28px_rgba(23,33,37,0.35)]">
              <div className="flex h-12 items-center gap-3 border-b border-[#ECE8E3] bg-white px-5">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#FF6A3D] to-[#E03A0C] text-[11px] font-bold text-white">{(name || 'A').slice(0, 1).toUpperCase()}</span>
                <span className="text-[14px] font-semibold text-ink">{name}</span>
                {definition.pages.length > 1 && (
                  <nav className="ml-2 flex gap-1" aria-label="App pages">
                    {definition.pages.map((item) => <button key={item.id} type="button" onClick={(event) => { event.stopPropagation(); setPageId(item.id); setSelectedId(null); }} className={`rounded-md px-2.5 py-1 text-[12.5px] font-medium ${item.id === page.id ? 'bg-[#F3F0EC] text-ink' : 'text-slate-500 hover:text-ink'}`}>{item.name}</button>)}
                  </nav>
                )}
                <span className="ml-auto text-[11.5px] text-slate-400">{page.name} · design</span>
              </div>
              <div className="px-7 pb-10 pt-7"><AppPageView page={page} engine={engine} design={design} /></div>
            </div>
          </main>
          <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-[#ECE8E3] bg-white" aria-label="Properties">
            {selected ? (
              <ComponentProperties
                key={selected.id}
                component={selected}
                onChange={(next) => changePage(updateComponent(page, selected.id, () => next))}
                onDelete={() => { changePage(removeComponent(page, selected.id)); setSelectedId(null); }}
                onDuplicate={() => { const result = duplicateComponent(page, selected.id, definition); changePage(result.page); setSelectedId(result.id); }}
                lookups={lookups}
                definition={definition}
                page={page}
                suggestions={suggestions}
                disabled={!editable}
                validation={validation}
                sampleRow={sampleRow}
              />
            ) : (
              <PageProperties page={page} onChange={changePage} disabled={!editable} validation={validation}>
                <PanelSection title="App">
                  <Row title="Description"><textarea aria-label="App description" rows={3} className={`${input} resize-y`} disabled={!editable} value={description} placeholder="What people use this app for" onChange={(event) => { setDescription(event.target.value); setDirty(true); }} /></Row>
                  <div className="flex items-center justify-between text-[12.5px] text-slate-500">
                    <span>Access: <span className="font-medium text-ink">{{ project: 'Project members', tenant: 'Everyone', roles: 'Specific roles', users: 'Specific people' }[app.settings?.access || 'project']}</span></span>
                    {canPublish(user?.role) && <button type="button" className="font-semibold text-ember hover:underline" onClick={() => setAccessOpen(true)}>Change</button>}
                  </div>
                  {canPublish(user?.role) && app.currentVersionId && (
                    <button type="button" className="text-left text-[12.5px] font-medium text-slate-500 hover:text-ink" onClick={() => setEnabled(app.status === 'disabled')}>{app.status === 'disabled' ? 'Turn the app back on' : 'Turn the app off'}</button>
                  )}
                </PanelSection>
                {app.versions?.length > 0 && (
                  <PanelSection title="Versions">
                    <ul className="space-y-1.5 text-[12.5px]">{app.versions.slice(0, 6).map((version) => <li key={version.id} className="flex justify-between text-slate-600"><span className="font-medium text-ink">v{version.versionNumber}</span><span>{timeAgo(version.publishedAt)}</span></li>)}</ul>
                  </PanelSection>
                )}
              </PageProperties>
            )}
          </aside>
        </div>
      )}
      {accessOpen && (
        <AccessDialog
          app={app}
          members={lookups.members}
          users={lookups.users}
          onClose={() => setAccessOpen(false)}
          onSave={async (settings) => { const { data } = await api(`/api/apps/${id}/settings`, { method: 'PUT', body: { settings } }); setApp((current) => ({ ...current, settings: data.settings })); setNotice('Access updated.'); }}
        />
      )}
    </div>
  );
}
