import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, currentUser, download } from '../services/api.js';
import CategorySelect, { categoryIcon } from '../components/CategorySelect.jsx';
import { Icon } from '../components/brand.jsx';
import { EmptyState, ErrorText, Field, Modal, StatusBadge, buttonClass, inputClass, quietClass } from '../components/ui.jsx';
import { SkeletonRows } from '../components/Loader.jsx';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: z.string().max(4000).optional(),
  category: z.string().min(2, 'Choose or enter a category'),
});

const MEMBER_ROLES = ['project_manager', 'automation_developer', 'operator', 'viewer'];

function ProjectForm({ categories, initial, submitLabel, onSubmit }) {
  const [error, setError] = useState('');
  const form = useForm({ resolver: zodResolver(schema), defaultValues: initial || { category: 'general' } });
  return (
    <form className="space-y-3" onSubmit={form.handleSubmit(async (values) => { try { await onSubmit(values); } catch (err) { setError(err.message); } })}>
      <ErrorText>{error}</ErrorText>
      <Field label="Name"><input className={inputClass} {...form.register('name')} /></Field>
      <ErrorText>{form.formState.errors.name?.message}</ErrorText>
      <Field label="Description"><textarea className={inputClass} rows="3" {...form.register('description')} /></Field>
      <div className="block text-sm">
        <span className="mb-1 block font-medium">Category</span>
        <CategorySelect categories={categories} allowCustom value={form.watch('category')} invalid={Boolean(form.formState.errors.category)} onChange={(code) => form.setValue('category', code, { shouldValidate: true, shouldDirty: true })} />
      </div>
      <ErrorText>{form.formState.errors.category?.message}</ErrorText>
      <button className={buttonClass} type="submit">{submitLabel}</button>
    </form>
  );
}

function friendlyDate(value) {
  if (!value) return '';
  const date = new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function fullDate(value) {
  const date = new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString();
}
function categoryLabel(categories, code) { return categories.find((c) => c.code === code)?.label || code; }
const ACTION_TINTS = {
  blue: { icon: 'text-[#3B6FB6]', hover: 'hover:border-[#C9D9EE] hover:bg-[#F1F6FC]' },
  violet: { icon: 'text-[#7558B8]', hover: 'hover:border-[#D9CFEE] hover:bg-[#F5F2FC]' },
  amber: { icon: 'text-[#C2700F]', hover: 'hover:border-[#EFD9B8] hover:bg-[#FDF6EC]' },
  red: { icon: 'text-[#B4473C]', hover: 'hover:border-[#E8C4C0] hover:bg-[#FBF1F0]' },
};
function RowAction({ icon, label, onClick, tint = 'blue' }) {
  const look = ACTION_TINTS[tint];
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick}
      className={`inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border border-[#E6E1DA] bg-white px-2 text-[12.5px] font-medium text-[#4A5568] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FA4616]/40 ${look.hover}`}>
      <Icon name={icon} className={`h-4 w-4 ${look.icon}`} /><span className="hidden 2xl:inline">{label}</span>
    </button>
  );
}

function MembersPanel({ project }) {
  const user = currentUser();
  const manage = ['administrator', 'project_manager'].includes(user?.role);
  const [members, setMembers] = useState([]);
  const [users, setUsers] = useState([]);
  const [pick, setPick] = useState({ userId: '', role: 'operator' });
  const [error, setError] = useState('');

  async function load() {
    setMembers((await api(`/api/projects/${project.id}/members`)).data);
  }
  useEffect(() => {
    load().catch((err) => setError(err.message));
    if (user?.role === 'administrator') api('/api/users').then((result) => setUsers(result.data)).catch(() => {});
  }, [project.id]);

  return (
    <div className="space-y-3">
      <ErrorText>{error}</ErrorText>
      <ul className="divide-y divide-line rounded-md border border-line text-sm">{members.map((member) => (
        <li key={member.id} className="flex items-center justify-between px-3 py-2">
          <span>{member.display_name} · {member.email} · {member.role.replaceAll('_', ' ')}</span>
          {manage && project.status === 'active' && <button className={quietClass} type="button" onClick={async () => { try { await api(`/api/projects/${project.id}/members/${member.user_id}`, { method: 'DELETE' }); await load(); } catch (err) { setError(err.message); } }}>Remove</button>}
        </li>
      ))}</ul>
      {manage && project.status === 'active' && (
        <form className="grid gap-2 sm:grid-cols-3" onSubmit={async (event) => { event.preventDefault(); try { await api(`/api/projects/${project.id}/members`, { method: 'POST', body: pick }); setError(''); await load(); } catch (err) { setError(err.message); } }}>
          {users.length ? (
            <select className={inputClass} value={pick.userId} onChange={(event) => setPick({ ...pick, userId: event.target.value })}><option value="">User</option>{users.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.displayName} ({item.email})</option>)}</select>
          ) : (
            <input className={inputClass} placeholder="User id" value={pick.userId} onChange={(event) => setPick({ ...pick, userId: event.target.value })} />
          )}
          <select className={inputClass} value={pick.role} onChange={(event) => setPick({ ...pick, role: event.target.value })}>{MEMBER_ROLES.map((role) => <option key={role} value={role}>{role.replaceAll('_', ' ')}</option>)}</select>
          <button className={buttonClass} type="submit">Add or update</button>
        </form>
      )}
    </div>
  );
}

const ACCEPTED = ['csv', 'xlsx', 'pdf', 'txt', 'json'];
const extOf = (name = '') => (name.split('.').pop() || '').toLowerCase();
const FILE_ICONS = { csv: 'table', xlsx: 'table', xls: 'table', pdf: 'document', txt: 'text', json: 'code' };
function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function FileTile({ name }) {
  return <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#F5F2EE] text-[#4A5568]"><Icon name={FILE_ICONS[extOf(name)] || 'document'} className="h-4 w-4" /></span>;
}
function IconButton({ icon, label, onClick, danger = false, disabled = false }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#E6E1DA] bg-white text-[#4A5568] transition-colors disabled:opacity-50 ${danger ? 'hover:border-[#E8C4C0] hover:bg-[#FBF1F0] hover:text-[#B4473C]' : 'hover:bg-[#F7F5F2] hover:text-[#1F2933]'}`}>
      <Icon name={icon} className="h-4 w-4" />
    </button>
  );
}

function FilesPanel({ project }) {
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [picked, setPicked] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const input = useRef(null);
  async function load() {
    setFiles((await api(`/api/projects/${project.id}/files`)).data);
  }
  useEffect(() => { load().catch((err) => setError(err.message)); }, [project.id]);

  function pick(file) {
    if (!file) return;
    if (!ACCEPTED.includes(extOf(file.name))) { setError(`Unsupported file type. Use ${ACCEPTED.join(', ')}.`); return; }
    setError(''); setMessage(''); setPicked(file);
  }
  function clear() { setPicked(null); if (input.current) input.current.value = ''; }
  async function upload(event) {
    event.preventDefault();
    if (!picked) { setError('Choose a file'); return; }
    const body = new FormData();
    body.append('file', picked);
    setUploading(true);
    try {
      const result = await api(`/api/projects/${project.id}/files`, { method: 'POST', body });
      setMessage(`Uploaded. Use path "${result.data.path}" in read steps.`);
      setError('');
      clear();
      await load();
    } catch (err) { setError(err.message); } finally { setUploading(false); }
  }

  return (
    <div className="space-y-4">
      <ErrorText>{error}</ErrorText>
      {message && <p className="rounded-lg border border-[#CFE8D7] bg-[#F1FAF4] px-3 py-2 text-[13px] text-[#256B3E]">{message}</p>}
      {project.status === 'active' && (
        <form className="space-y-3" onSubmit={upload}>
          <label
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); pick(event.dataTransfer.files[0]); }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? 'border-[#FA4616]/60 bg-[#FFF6F1]' : 'border-[#E0DAD2] bg-[#FBFAF8] hover:border-[#CFC7BD] hover:bg-[#F7F5F2]'}`}>
            <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-[#E03A0E] shadow-sm ring-1 ring-[#EFE9E2]"><Icon name="upload" className="h-5 w-5" /></span>
            <span className="text-sm text-[#1F2933]">Drag files here or <span className="font-semibold text-[#E03A0E] underline-offset-2 hover:underline">browse</span></span>
            <span className="flex flex-wrap justify-center gap-1">{ACCEPTED.map((ext) => <span key={ext} className="rounded-md border border-[#E6E1DA] bg-white px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[#6B7280]">{ext}</span>)}</span>
            <input ref={input} name="file" type="file" accept=".csv,.xlsx,.pdf,.txt,.json" className="sr-only" onChange={(event) => pick(event.target.files[0])} />
          </label>
          {picked && (
            <div className="flex items-center gap-3 rounded-xl border border-[#E6E1DA] bg-white px-3 py-2">
              <FileTile name={picked.name} />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-[#1F2933]" title={picked.name}>{picked.name}</p><p className="text-xs text-[#6B7280]">{formatSize(picked.size)}</p></div>
              <IconButton icon="close" label="Remove file" danger disabled={uploading} onClick={clear} />
            </div>
          )}
          <div className="flex justify-end">
            <button className={`${buttonClass} inline-flex items-center gap-2`} type="submit" disabled={!picked || uploading}>
              {uploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" /> : <Icon name="upload" className="h-4 w-4" />}
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </form>
      )}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Project files{files.length ? ` · ${files.length}` : ''}</p>
        {files.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-[#EFE9E2] bg-[#FBFAF8] px-4 py-6 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#F5F2EE] text-[#6B7280]"><Icon name="folder" className="h-5 w-5" /></span>
            <p className="text-sm font-medium text-[#1F2933]">No files yet</p>
            <p className="max-w-xs text-[13px] text-[#6B7280]">Upload csv, xlsx, pdf, txt, or json input files. Job outputs also appear here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#EFE9E2] rounded-xl border border-[#E6E1DA]">{files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 px-3 py-2.5">
              <FileTile name={file.fileName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#1F2933]" title={file.path}>{file.fileName}</p>
                <p className="flex items-center gap-1.5 text-xs text-[#6B7280]">
                  <span>{formatSize(file.size)}</span>{file.createdAt && <><span aria-hidden="true">·</span><span title={fullDate(file.createdAt)}>{friendlyDate(file.createdAt)}</span></>}
                  <span className="rounded-full border border-[#E6E1DA] bg-[#F7F5F2] px-1.5 py-px text-[11px] text-[#4A5568]">{file.source === 'job' ? 'output' : file.source === 'upload' ? 'input' : file.source}</span>
                </p>
              </div>
              <IconButton icon="download" label={`Download ${file.fileName}`} onClick={() => download(`/api/artifacts/${file.id}/download`, file.fileName).catch((err) => setError(err.message))} />
            </li>
          ))}</ul>
        )}
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const user = currentUser();
  const canManage = ['administrator', 'project_manager'].includes(user?.role);
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState([]);
  const [query, setQuery] = useState({ search: '', status: '', category: '', sort: 'created_at', order: 'desc' });
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);

  async function load() {
    const params = new URLSearchParams({ limit: '100', sort: query.sort, order: query.order });
    for (const key of ['search', 'status', 'category']) if (query[key]) params.set(key, query[key]);
    const result = await api(`/api/projects?${params.toString()}`);
    setRows(result.data);
    setTotal(result.meta.total);
    setLoaded(true);
  }

  useEffect(() => {
    api('/api/categories').then((result) => setCategories(result.data)).catch((err) => setError(err.message));
    load().catch((err) => setError(err.message));
  }, []);

  const close = () => setModal(null);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Projects <span className="text-base font-normal text-muted">({total})</span></h1>{canManage && <button className={buttonClass} type="button" onClick={() => setModal({ type: 'create' })}>New project</button>}</div>
      <form className="grid gap-2 md:grid-cols-6" onSubmit={(event) => { event.preventDefault(); load().catch((err) => setError(err.message)); }}>
        <input className={inputClass} placeholder="Search name or description" value={query.search} onChange={(event) => setQuery({ ...query, search: event.target.value })} />
        <select className={inputClass} value={query.status} onChange={(event) => setQuery({ ...query, status: event.target.value })}><option value="">Any status</option><option value="active">Active</option><option value="archived">Archived</option></select>
        <CategorySelect categories={categories} value={query.category} emptyLabel="Any category" ariaLabel="Filter by category" onChange={(code) => setQuery({ ...query, category: code })} />
        <select className={inputClass} value={query.sort} onChange={(event) => setQuery({ ...query, sort: event.target.value })}><option value="created_at">Created</option><option value="name">Name</option><option value="category">Category</option><option value="status">Status</option></select>
        <select className={inputClass} value={query.order} onChange={(event) => setQuery({ ...query, order: event.target.value })}><option value="desc">Descending</option><option value="asc">Ascending</option></select>
        <button className={buttonClass} type="submit">Apply</button>
      </form>
      <ErrorText>{error}</ErrorText>
      {!loaded && !error ? <SkeletonRows rows={6} cols={5} label="Loading projects" /> : rows.length === 0 ? <EmptyState title="No projects" body="Create a project for any business process. The category is a label, not a limit on what the workflow can do." /> : (
        <div className="overflow-auto rounded-lg border border-line bg-white">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-cream2 text-muted"><tr><th className="px-3 py-2">Name</th><th className="w-44 px-3 py-2">Category</th><th className="w-28 px-3 py-2">Status</th><th className="w-32 px-3 py-2">Created</th><th className="w-44 px-3 py-2 2xl:w-[22rem]"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map((project) => (
              <tr key={project.id} className="border-t border-line">
                <td className="max-w-0 px-3 py-2"><p className="truncate font-medium" title={project.name}>{project.name}</p>{project.description && <p className="truncate text-muted" title={project.description}>{project.description}</p>}</td>
                <td className="whitespace-nowrap px-3 py-2"><span className="inline-flex items-center gap-1.5 rounded-full border border-[#E6E1DA] bg-[#F7F5F2] px-2 py-0.5 text-xs text-[#4A5568]"><Icon name={categoryIcon(project.category)} className="h-3.5 w-3.5" />{categoryLabel(categories, project.category)}</span></td>
                <td className="px-3 py-2"><StatusBadge status={project.status} /></td>
                <td className="whitespace-nowrap px-3 py-2 text-[#4A5568]" title={fullDate(project.created_at)}>{friendlyDate(project.created_at)}</td>
                <td className="whitespace-nowrap px-3 py-2"><div className="flex flex-nowrap justify-end gap-1">
                  <RowAction icon="folder" label="Files" onClick={() => setModal({ type: 'files', project })} />
                  <RowAction tint="violet" icon="users" label="Members" onClick={() => setModal({ type: 'members', project })} />
                  {canManage && project.status === 'active' && <RowAction tint="amber" icon="pencil" label="Edit" onClick={() => setModal({ type: 'edit', project })} />}
                  {canManage && project.status === 'active' && <RowAction tint="red" icon="archive" label="Archive" onClick={() => setModal({ type: 'archive', project })} />}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {modal?.type === 'create' && (
        <Modal title="New project" onClose={close}>
          <ProjectForm categories={categories} submitLabel="Create project" onSubmit={async (values) => { await api('/api/projects', { method: 'POST', body: values }); close(); await load(); }} />
        </Modal>
      )}
      {modal?.type === 'edit' && (
        <Modal title={`Edit ${modal.project.name}`} onClose={close}>
          <ProjectForm categories={categories} initial={{ name: modal.project.name, description: modal.project.description || '', category: modal.project.category }} submitLabel="Save changes" onSubmit={async (values) => { await api(`/api/projects/${modal.project.id}`, { method: 'PATCH', body: values }); close(); await load(); }} />
        </Modal>
      )}
      {modal?.type === 'members' && <Modal title="Members" subtitle={modal.project.name} icon="users" onClose={close}><MembersPanel project={modal.project} /></Modal>}
      {modal?.type === 'files' && <Modal title="Files" subtitle={modal.project.name} icon="folder" onClose={close}><FilesPanel project={modal.project} /></Modal>}
      {modal?.type === 'archive' && (
        <Modal title="Archive project" onClose={close}>
          <p className="text-sm">Archive {modal.project.name}? Workflows stay in history and cannot be run.</p>
          <div className="mt-3 flex gap-2">
            <button className={buttonClass} type="button" onClick={async () => { try { await api(`/api/projects/${modal.project.id}/archive`, { method: 'POST' }); close(); await load(); } catch (err) { setError(err.message); close(); } }}>Archive</button>
            <button className={quietClass} type="button" onClick={close}>Cancel</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
