import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, currentUser, download } from '../services/api.js';
import { EmptyState, ErrorText, Field, Modal, StatusBadge, buttonClass, inputClass, quietClass } from '../components/ui.jsx';

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
      <Field label="Category">
        <input className={inputClass} list="categories" {...form.register('category')} />
        <datalist id="categories">{categories.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</datalist>
      </Field>
      <ErrorText>{form.formState.errors.category?.message}</ErrorText>
      <button className={buttonClass} type="submit">{submitLabel}</button>
    </form>
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

function FilesPanel({ project }) {
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function load() {
    setFiles((await api(`/api/projects/${project.id}/files`)).data);
  }
  useEffect(() => { load().catch((err) => setError(err.message)); }, [project.id]);
  return (
    <div className="space-y-3">
      <ErrorText>{error}</ErrorText>
      {message && <p className="text-sm text-success">{message}</p>}
      {project.status === 'active' && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={async (event) => {
          event.preventDefault();
          const file = event.currentTarget.elements.file.files[0];
          if (!file) { setError('Choose a file'); return; }
          const body = new FormData();
          body.append('file', file);
          try {
            const result = await api(`/api/projects/${project.id}/files`, { method: 'POST', body });
            setMessage(`Uploaded. Use path "${result.data.path}" in read steps.`);
            setError('');
            event.target.reset();
            await load();
          } catch (err) { setError(err.message); }
        }}>
          <input name="file" type="file" accept=".csv,.xlsx,.pdf,.txt,.json" className="text-sm" />
          <button className={buttonClass} type="submit">Upload</button>
        </form>
      )}
      {files.length === 0 ? <EmptyState title="No files" body="Upload csv, xlsx, pdf, txt, or json input files. Job outputs also appear here." /> : (
        <ul className="divide-y divide-line rounded-md border border-line text-sm">{files.map((file) => (
          <li key={file.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <span><span className="font-medium">{file.fileName}</span> · {file.source} · {Math.ceil(file.size / 1024)} KB<span className="block font-mono text-xs text-muted">{file.path}</span></span>
            <button className={quietClass} type="button" onClick={() => download(`/api/artifacts/${file.id}/download`, file.fileName).catch((err) => setError(err.message))}>Download</button>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  const user = currentUser();
  const canManage = ['administrator', 'project_manager'].includes(user?.role);
  const [rows, setRows] = useState([]);
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
        <select className={inputClass} value={query.category} onChange={(event) => setQuery({ ...query, category: event.target.value })}><option value="">Any category</option>{categories.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select>
        <select className={inputClass} value={query.sort} onChange={(event) => setQuery({ ...query, sort: event.target.value })}><option value="created_at">Created</option><option value="name">Name</option><option value="category">Category</option><option value="status">Status</option></select>
        <select className={inputClass} value={query.order} onChange={(event) => setQuery({ ...query, order: event.target.value })}><option value="desc">Descending</option><option value="asc">Ascending</option></select>
        <button className={buttonClass} type="submit">Apply</button>
      </form>
      <ErrorText>{error}</ErrorText>
      {rows.length === 0 ? <EmptyState title="No projects" body="Create a project for any business process. The category is a label, not a limit on what the workflow can do." /> : (
        <div className="overflow-auto rounded-lg border border-line bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-cream2 text-muted"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Created</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>{rows.map((project) => (
              <tr key={project.id} className="border-t border-line">
                <td className="px-3 py-2"><p className="font-medium">{project.name}</p><p className="text-muted">{project.description}</p></td>
                <td className="px-3 py-2">{project.category}</td>
                <td className="px-3 py-2"><StatusBadge status={project.status} /></td>
                <td className="px-3 py-2">{project.created_at}</td>
                <td className="px-3 py-2"><div className="flex flex-wrap justify-end gap-1">
                  <button className={quietClass} type="button" onClick={() => setModal({ type: 'files', project })}>Files</button>
                  <button className={quietClass} type="button" onClick={() => setModal({ type: 'members', project })}>Members</button>
                  {canManage && project.status === 'active' && <button className={quietClass} type="button" onClick={() => setModal({ type: 'edit', project })}>Edit</button>}
                  {canManage && project.status === 'active' && <button className={quietClass} type="button" onClick={() => setModal({ type: 'archive', project })}>Archive</button>}
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
      {modal?.type === 'members' && <Modal title={`Members · ${modal.project.name}`} onClose={close}><MembersPanel project={modal.project} /></Modal>}
      {modal?.type === 'files' && <Modal title={`Files · ${modal.project.name}`} onClose={close}><FilesPanel project={modal.project} /></Modal>}
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
