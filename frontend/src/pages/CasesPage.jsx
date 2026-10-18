import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, currentUser } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import { timeAgo } from '../layouts/CloudLayout.jsx';
import { Avatar, CaseFieldInput, CaseStatusChip, PriorityChip, SlaChip } from '../components/CaseBits.jsx';
import { PRIORITIES, validateCaseFields } from '../lib/caseDefinition.js';

// Case workspace: summary tiles, a filterable list, and a Kanban board by stage (drag a card to
// move the case). New cases open from a form generated from the published fields schema.

const canWork = (role) => ['administrator', 'project_manager', 'automation_developer', 'operator'].includes(role);
const canBuild = (role) => ['administrator', 'project_manager', 'automation_developer'].includes(role);
const select = 'h-9 rounded-lg border border-[#ECE8E3] bg-white px-2.5 text-[13px] text-ink focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15';
const STATUS_FILTERS = [['active', 'Active'], ['open', 'Open'], ['on_hold', 'On hold'], ['resolved', 'Resolved'], ['closed', 'Closed'], ['cancelled', 'Cancelled'], ['', 'All statuses']];
const SLA_FILTERS = [['', 'Any SLA'], ['on_track', 'On track'], ['at_risk', 'At risk'], ['breached', 'Breached']];

function SummaryTile({ label, value, tone, active, onClick, icon }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`u-card u-lift flex items-center gap-3 rounded-xl px-4 py-3 text-left ${active ? 'ring-2 ring-ember/30' : ''}`}>
      <span className={`u-tile grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tone}`}><Icon name={icon} className="h-4 w-4" /></span>
      <span><span className="block text-[20px] font-semibold leading-6 tracking-tight text-ink">{value ?? '–'}</span><span className="block text-[12px] text-slate-500">{label}</span></span>
    </button>
  );
}

export function NewCaseDialog({ caseTypes, initialTypeId, onClose, onCreated }) {
  const openable = caseTypes.filter((item) => item.canOpen);
  const [typeId, setTypeId] = useState(initialTypeId && openable.some((item) => item.id === initialTypeId) ? initialTypeId : openable[0]?.id || '');
  const type = openable.find((item) => item.id === typeId);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('');
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const submit = async (event) => {
    event.preventDefault();
    if (!type) return;
    const checked = validateCaseFields(type.published.fields, values);
    if (checked.errors.length) { setErrors(Object.fromEntries(checked.errors.map((item) => [item.path, item.message]))); return; }
    setBusy(true); setError('');
    try {
      const result = await api('/api/cases', { method: 'POST', body: { caseTypeId: type.id, title: title.trim() || undefined, fields: checked.values, ...(priority ? { priority } : {}), source: 'manual' } });
      onCreated(result.data);
    } catch (err) { setError(err.message); setErrors(err.fields || {}); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#1F1B17]/30 px-4 py-[8vh]" role="dialog" aria-modal="true" aria-labelledby="new-case-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form onSubmit={submit} className="w-full max-w-[560px] rounded-2xl border border-[#ECE8E3] bg-white shadow-[0_24px_64px_rgba(16,24,40,0.18)]">
        <div className="flex items-center gap-3 border-b border-[#F1EEEA] px-5 py-4">
          <span className="u-tile grid h-9 w-9 place-items-center rounded-lg bg-[#FFF1EB] text-ember"><Icon name="briefcase" className="h-4 w-4" /></span>
          <div className="flex-1"><h2 id="new-case-title" className="text-[16px] font-semibold tracking-tight text-ink">New case</h2><p className="text-[12.5px] text-slate-500">It starts in the first stage and its automatic tasks begin right away.</p></div>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Close" onClick={onClose}><Icon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[60vh] space-y-3.5 overflow-y-auto px-5 py-4">
          {!openable.length && <p className="rounded-lg bg-[#F6F4F1] px-3 py-2 text-[13px] text-slate-600">No published case type you can open cases of.</p>}
          {openable.length > 0 && (
            <div className="grid grid-cols-[1fr_140px] gap-3">
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-slate-600">Case type</span>
                <select className={`${select} w-full`} value={typeId} onChange={(event) => { setTypeId(event.target.value); setValues({}); setErrors({}); }}>
                  {openable.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-slate-600">Priority</span>
                <select className={`${select} w-full`} value={priority} onChange={(event) => setPriority(event.target.value)}>
                  <option value="">Default ({type?.published?.settings?.defaultPriority || 'medium'})</option>
                  {PRIORITIES.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
                </select>
              </label>
            </div>
          )}
          {type && (
            <>
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-slate-600">Title</span>
                <input autoFocus className={`${select} w-full`} value={title} placeholder={`${type.name} ${type.prefix}-…`} maxLength={300} onChange={(event) => setTitle(event.target.value)} />
              </label>
              {type.published.fields.map((field) => (
                <CaseFieldInput key={field.name} field={field} value={values[field.name]} error={errors[field.name]} onChange={(value) => { setValues({ ...values, [field.name]: value }); setErrors({ ...errors, [field.name]: undefined }); }} />
              ))}
            </>
          )}
          {error && <p className="rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#F1EEEA] px-5 py-3.5">
          <button type="button" className="u-btn-secondary h-9 rounded-lg px-3.5 text-[13px] font-semibold" onClick={onClose}>Cancel</button>
          <button type="submit" className="u-btn-primary h-9 rounded-lg px-4 text-[13px] font-semibold disabled:opacity-60" disabled={busy || !type}>{busy ? 'Opening…' : 'Open case'}</button>
        </div>
      </form>
    </div>
  );
}

function CaseRow({ item, now }) {
  return (
    <tr className="group border-t border-[#F1EEEA] hover:bg-[#FCFBFA]">
      <td className="py-3 pl-5 pr-3">
        <Link to={`/cases/${item.id}`} className="block min-w-0">
          <span className="block font-mono text-[11.5px] text-slate-400">{item.reference}</span>
          <span className="block max-w-[340px] truncate text-[13.5px] font-semibold text-ink group-hover:text-ember">{item.title}</span>
          <span className="block truncate text-[11.5px] text-slate-400">{item.caseTypeName}</span>
        </Link>
      </td>
      <td className="px-3 py-3">
        <span className="block text-[13px] text-ink">{item.currentStageName}</span>
        {item.stageCount ? (
          <span className="mt-1 flex gap-0.5" aria-label={`Stage ${item.stageIndex + 1} of ${item.stageCount}`}>
            {Array.from({ length: item.stageCount }, (_, index) => <span key={index} className={`h-1 w-4 rounded-full ${index < item.stageIndex || ['resolved', 'closed'].includes(item.status) ? 'bg-[#2E9E57]/70' : index === item.stageIndex ? 'bg-ember' : 'bg-[#ECE8E3]'}`} />)}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-3"><CaseStatusChip status={item.status} /></td>
      <td className="px-3 py-3"><PriorityChip priority={item.priority} /></td>
      <td className="px-3 py-3">
        <div className="flex flex-col items-start gap-1">
          <SlaChip label="Case" dueAt={item.dueAt} state={item.slaState} status={item.status} now={now} />
          <SlaChip label="Stage" dueAt={item.stageDueAt} state={item.stageSlaState} status={item.status} now={now} />
          {(!item.slaState || item.slaState === 'none') && (!item.stageSlaState || item.stageSlaState === 'none') && <span className="text-[12px] text-slate-400">—</span>}
        </div>
      </td>
      <td className="px-3 py-3">
        {item.assigneeUserId || item.ownerUserId ? (
          <span className="flex items-center gap-2"><Avatar name={item.assigneeName || item.ownerName} email={item.assigneeEmail || item.ownerEmail} /><span className="max-w-[140px] truncate text-[13px] text-slate-700">{item.assigneeName || item.ownerName || item.assigneeEmail || item.ownerEmail}</span></span>
        ) : <span className="text-[12.5px] text-slate-400">Unassigned</span>}
      </td>
      <td className="py-3 pl-3 pr-5 text-right text-[12px] text-slate-500">{timeAgo(item.updatedAt)}</td>
    </tr>
  );
}

function BoardCard({ item, now, draggable, onDragStart }) {
  return (
    <Link to={`/cases/${item.id}`} draggable={draggable} onDragStart={(event) => onDragStart(event, item)} className="u-lift block rounded-xl border border-[#ECE8E3] bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:border-[#E2DCD5]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-slate-400">{item.reference}</span>
        <PriorityChip priority={item.priority} />
      </div>
      <p className="mt-1 line-clamp-2 text-[13px] font-semibold leading-5 text-ink">{item.title}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {item.status !== 'open' && <CaseStatusChip status={item.status} />}
        <SlaChip label="Stage" compact dueAt={item.stageDueAt} state={item.stageSlaState} status={item.status} now={now} />
        {item.slaState === 'breached' || item.slaState === 'at_risk' ? <SlaChip label="Case" dueAt={item.dueAt} state={item.slaState} status={item.status} now={now} /> : null}
      </div>
      <div className="mt-2.5 flex items-center justify-between border-t border-[#F6F4F1] pt-2">
        <span className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
          {item.assigneeUserId || item.ownerUserId ? <><Avatar name={item.assigneeName || item.ownerName} email={item.assigneeEmail || item.ownerEmail} size="h-5 w-5 text-[9px]" /><span className="max-w-[120px] truncate">{item.assigneeName || item.ownerName}</span></> : 'Unassigned'}
        </span>
        <span className="text-[11px] text-slate-400">{timeAgo(item.stageEnteredAt || item.updatedAt)}</span>
      </div>
    </Link>
  );
}

function Board({ board, now, canMove, onMove }) {
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const columns = board.columns.filter((column, index, list) => {
    const finalStage = index === list.length - 2 && list[list.length - 1].id === '__resolved' && !column.taskCount && !column.cases.length;
    return !finalStage;
  });
  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {columns.map((column) => {
        const stage = !column.id.startsWith('__');
        const droppable = canMove && stage && dragging && dragging.currentStageId !== column.id && dragging.status === 'open';
        return (
          <section key={column.id} aria-label={column.name}
            className={`flex w-[288px] shrink-0 flex-col rounded-2xl border bg-[#F6F4F1]/70 ${over === column.id && droppable ? 'border-ember bg-[#FFF8F4]' : 'border-[#ECE8E3]'}`}
            onDragOver={(event) => { if (droppable) { event.preventDefault(); setOver(column.id); } }}
            onDragLeave={() => setOver((value) => (value === column.id ? null : value))}
            onDrop={(event) => { event.preventDefault(); setOver(null); if (droppable) onMove(dragging, column); setDragging(null); }}>
            <header className="flex items-center gap-2 px-3.5 pb-2 pt-3">
              <span className={`h-2 w-2 rounded-full ${column.id === '__resolved' ? 'bg-[#2E9E57]' : column.cases.some((item) => item.stageSlaState === 'breached') ? 'bg-danger' : column.cases.some((item) => item.stageSlaState === 'at_risk') ? 'bg-[#D99A1E]' : 'bg-[#C9C2BA]'}`} aria-hidden="true" />
              <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{column.name}</h3>
              <span className="rounded-full bg-white px-2 py-px text-[11.5px] font-semibold text-slate-500 ring-1 ring-inset ring-[#ECE8E3]">{column.cases.length}</span>
            </header>
            {column.sla && <p className="-mt-1 px-3.5 pb-2 text-[11px] text-slate-400">SLA {column.sla.hours}h per case</p>}
            {column.id === '__resolved' && <p className="-mt-1 px-3.5 pb-2 text-[11px] text-slate-400">Last 7 days</p>}
            <div className="flex min-h-[120px] flex-1 flex-col gap-2 px-2.5 pb-2.5">
              {column.cases.map((item) => <BoardCard key={item.id} item={item} now={now} draggable={canMove && item.status === 'open'} onDragStart={(event, value) => { event.dataTransfer.effectAllowed = 'move'; setDragging(value); }} />)}
              {!column.cases.length && <p className="rounded-xl border border-dashed border-[#E2DCD5] px-3 py-6 text-center text-[12px] text-slate-400">{droppable ? 'Drop to move here' : 'No cases'}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default function CasesPage() {
  const user = currentUser();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const typeId = params.get('type') || '';
  const view = params.get('view') === 'board' ? 'board' : 'list';
  const filters = { status: params.get('status') ?? 'active', stage: params.get('stage') || '', sla: params.get('sla') || '', owner: params.get('owner') || '', q: params.get('q') || '' };
  const [caseTypes, setCaseTypes] = useState(null);
  const [summary, setSummary] = useState(null);
  const [list, setList] = useState({ loading: true, rows: [], total: 0 });
  const [board, setBoard] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState(filters.q);
  const [now, setNow] = useState(Date.now());
  const [refresh, setRefresh] = useState(0);

  const setParam = useCallback((patch) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) { if (value === '' || value === null || value === undefined) next.delete(key); else next.set(key, value); }
    setParams(next, { replace: true });
  }, [params, setParams]);

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => { const timer = setInterval(() => setRefresh((value) => value + 1), 20000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    api('/api/case-types?published=1&limit=100').then((result) => setCaseTypes(result.data.filter((item) => item.currentVersionId))).catch((err) => { setCaseTypes([]); setError(err.message); });
  }, []);
  const type = (caseTypes || []).find((item) => item.id === typeId) || null;
  useEffect(() => {
    if (view === 'board' && !typeId && caseTypes?.length) setParam({ type: caseTypes[0].id });
  }, [view, typeId, caseTypes, setParam]);
  useEffect(() => {
    const timer = setTimeout(() => { if (search !== filters.q) setParam({ q: search }); }, 300);
    return () => clearTimeout(timer);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useMemo(() => {
    const out = new URLSearchParams();
    if (typeId) out.set('caseTypeId', typeId);
    if (filters.stage) out.set('stageId', filters.stage);
    if (filters.sla) out.set('sla', filters.sla);
    if (filters.owner) out.set('owner', filters.owner);
    if (filters.q) out.set('search', filters.q);
    return out;
  }, [typeId, filters.stage, filters.sla, filters.owner, filters.q]);

  useEffect(() => {
    let alive = true;
    api(`/api/cases/summary${typeId ? `?caseTypeId=${typeId}` : ''}`).then((result) => { if (alive) setSummary(result.data); }).catch(() => {});
    if (view === 'list') {
      const listQuery = new URLSearchParams(query);
      if (filters.status) listQuery.set('status', filters.status);
      listQuery.set('limit', '100');
      if (filters.sla || filters.status === 'active') listQuery.set('sort', 'due');
      api(`/api/cases?${listQuery}`).then((result) => { if (alive) setList({ loading: false, rows: result.data, total: result.meta?.total ?? result.data.length }); }).catch((err) => { if (alive) { setList({ loading: false, rows: [], total: 0 }); setError(err.message); } });
    } else if (typeId) {
      api(`/api/cases/board?${query}`).then((result) => { if (alive) setBoard(result.data); }).catch((err) => { if (alive) { setBoard(null); setError(err.message); } });
    }
    return () => { alive = false; };
  }, [query, filters.status, view, typeId, refresh]);

  const moveCase = async (item, column) => {
    setError('');
    try {
      await api(`/api/cases/${item.id}/move`, { method: 'POST', body: { stageId: column.id } });
      setRefresh((value) => value + 1);
    } catch (err) { setError(`${item.reference}: ${err.message}`); }
  };

  const stages = type?.published?.stages || [];
  const tile = (patch) => () => setParam({ status: '', sla: '', owner: '', ...patch, view: 'list' });
  const clearable = filters.stage || filters.sla || filters.owner || filters.q || filters.status !== 'active';

  return (
    <main id="app-main" className="mx-auto min-h-[calc(100vh-3.5rem)] max-w-[1440px] px-5 pb-16 pt-8 sm:px-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Cases</h1>
          <p className="mt-1 text-[13.5px] text-slate-500">Work cases through their stages. Robots, flows, and agents do the automatic tasks; you handle the rest before the SLA runs out.</p>
        </div>
        <div className="flex items-center gap-2">
          {canBuild(user?.role) && <Link to="/studio?view=cases" className="u-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold"><Icon name="studio" className="h-4 w-4" />Design case types</Link>}
          {canWork(user?.role) && <button type="button" className="u-btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold disabled:opacity-60" disabled={!caseTypes?.some((item) => item.canOpen)} onClick={() => setCreating(true)}><Icon name="plus" className="h-4 w-4" />New case</button>}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryTile label="Open" value={summary ? summary.open + summary.onHold : null} icon="briefcase" tone="bg-[#EAF1FB] text-[#2F5FA8]" active={filters.status === 'active' && !filters.sla && !filters.owner} onClick={tile({ status: 'active' })} />
        <SummaryTile label="SLA at risk" value={summary?.atRisk} icon="clock" tone="bg-[#FDF5E6] text-[#B7791F]" active={filters.sla === 'at_risk'} onClick={tile({ status: 'active', sla: 'at_risk' })} />
        <SummaryTile label="SLA breached" value={summary?.breached} icon="alert" tone="bg-[#FDEEEC] text-[#C2321F]" active={filters.sla === 'breached'} onClick={tile({ status: 'active', sla: 'breached' })} />
        <SummaryTile label="Mine" value={summary?.mine} icon="human" tone="bg-[#F1EEFB] text-[#5B47B8]" active={filters.owner === 'me'} onClick={tile({ status: 'active', owner: 'me' })} />
        <SummaryTile label="Resolved this week" value={summary?.resolvedThisWeek} icon="check" tone="bg-[#ECF7EF] text-[#1F6B3A]" active={filters.status === 'resolved'} onClick={tile({ status: 'resolved' })} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <select aria-label="Case type" className={`${select} min-w-[200px] font-semibold`} value={typeId} onChange={(event) => setParam({ type: event.target.value, stage: '' })}>
          {view === 'list' && <option value="">All case types</option>}
          {(caseTypes || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <div role="radiogroup" aria-label="View" className="flex rounded-lg border border-[#ECE8E3] bg-white p-0.5">
          {[['list', 'List', 'list'], ['board', 'Board', 'grid']].map(([key, text, icon]) => (
            <button key={key} type="button" role="radio" aria-checked={view === key} onClick={() => setParam({ view: key === 'list' ? '' : key })} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold ${view === key ? 'bg-[#F6F4F1] text-ink' : 'text-slate-500 hover:text-ink'}`}><Icon name={icon} className="h-3.5 w-3.5" />{text}</button>
          ))}
        </div>
        <span className="mx-1 h-6 w-px bg-[#ECE8E3]" aria-hidden="true" />
        {view === 'list' && (
          <select aria-label="Status" className={select} value={filters.status} onChange={(event) => setParam({ status: event.target.value === 'active' ? null : event.target.value || 'all' })}>
            {STATUS_FILTERS.map(([value, label]) => <option key={label} value={value === '' ? 'all' : value}>{label}</option>)}
          </select>
        )}
        {view === 'list' && type && (
          <select aria-label="Stage" className={select} value={filters.stage} onChange={(event) => setParam({ stage: event.target.value })}>
            <option value="">Any stage</option>
            {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
          </select>
        )}
        <select aria-label="SLA" className={select} value={filters.sla} onChange={(event) => setParam({ sla: event.target.value })}>
          {SLA_FILTERS.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
        </select>
        <select aria-label="Owner" className={select} value={filters.owner} onChange={(event) => setParam({ owner: event.target.value })}>
          <option value="">Anyone</option><option value="me">Mine</option><option value="unassigned">Unassigned</option>
        </select>
        <label className="relative ml-auto">
          <span className="sr-only">Search cases</span>
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title or reference" className="h-9 w-64 rounded-lg border border-[#ECE8E3] bg-white pl-8 pr-3 text-[13px] text-ink placeholder:text-slate-400 focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15" />
        </label>
        {clearable && <button type="button" className="text-[12.5px] font-semibold text-slate-500 hover:text-ink" onClick={() => { setSearch(''); setParam({ status: '', stage: '', sla: '', owner: '', q: '' }); }}>Clear</button>}
      </div>

      {error && <p className="mt-4 flex items-center gap-2 rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger" role="alert"><Icon name="alert" className="h-4 w-4" /><span className="flex-1">{error}</span><button type="button" className="text-[12px] font-semibold" onClick={() => setError('')}>Dismiss</button></p>}

      {caseTypes && !caseTypes.length ? (
        <div className="mt-7 flex flex-col items-center rounded-xl u-card px-6 py-16 text-center">
          <span className="u-tile grid h-12 w-12 place-items-center rounded-xl bg-[#FFF1EB] text-ember"><Icon name="briefcase" className="h-6 w-6" /></span>
          <h2 className="mt-4 text-[16px] font-semibold tracking-tight text-ink">No case types yet</h2>
          <p className="mt-1.5 max-w-md text-[13.5px] leading-6 text-slate-500">Design a case type in Studio with stages, tasks, and SLAs, publish it, and cases show up here.</p>
          {canBuild(user?.role) && <Link to="/studio?view=cases" className="u-btn-primary mt-5 inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold"><Icon name="plus" className="h-4 w-4" />Create a case type</Link>}
        </div>
      ) : view === 'board' ? (
        <div className="mt-5">
          {board ? <Board board={board} now={now} canMove={canWork(user?.role)} onMove={moveCase} /> : <div className="flex gap-3">{[0, 1, 2, 3].map((index) => <div key={index} className="h-[320px] w-[288px] animate-pulse rounded-2xl bg-white" />)}</div>}
          {board && canWork(user?.role) && <p className="text-[12px] text-slate-400">Drag an open case to another stage to move it. Moving forward past unfinished tasks needs a skippable stage or a manager.</p>}
        </div>
      ) : (
        <div className="u-card mt-5 overflow-hidden rounded-xl">
          <table className="w-full text-left">
            <thead className="bg-[#FCFBFA] text-[11.5px] font-semibold uppercase tracking-[0.06em] text-slate-500">
              <tr><th className="py-2.5 pl-5 pr-3">Case</th><th className="px-3 py-2.5">Stage</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Priority</th><th className="px-3 py-2.5">SLA</th><th className="px-3 py-2.5">Owner</th><th className="py-2.5 pl-3 pr-5 text-right">Updated</th></tr>
            </thead>
            <tbody>
              {list.rows.map((item) => <CaseRow key={item.id} item={item} now={now} />)}
              {list.loading && <tr><td colSpan={7} className="px-5 py-10 text-center text-[13px] text-slate-400">Loading cases…</td></tr>}
              {!list.loading && !list.rows.length && <tr><td colSpan={7} className="px-5 py-12 text-center text-[13px] text-slate-500">No cases match these filters.</td></tr>}
            </tbody>
          </table>
          {list.total > list.rows.length && <p className="border-t border-[#F1EEEA] px-5 py-2.5 text-[12px] text-slate-500">Showing {list.rows.length} of {list.total}. Narrow the filters to find more.</p>}
        </div>
      )}
      {creating && caseTypes && <NewCaseDialog caseTypes={caseTypes} initialTypeId={typeId} onClose={() => setCreating(false)} onCreated={(item) => { setCreating(false); navigate(`/cases/${item.id}`); }} />}
    </main>
  );
}
