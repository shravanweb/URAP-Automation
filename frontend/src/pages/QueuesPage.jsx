import { useEffect, useState } from 'react';
import { api, currentUser } from '../services/api.js';
import { EmptyState, ErrorText, Modal, StatusBadge, buttonClass, inputClass, quietClass } from '../components/ui.jsx';

const ITEM_STATUSES = ['NEW', 'IN_PROGRESS', 'SUCCESSFUL', 'FAILED', 'ABANDONED', 'DELETED'];

export default function QueuesPage() {
  const user = currentUser();
  const canDefine = ['administrator', 'project_manager', 'automation_developer'].includes(user?.role);
  const canAdd = user?.role !== 'viewer';
  const canControl = ['administrator', 'project_manager', 'operator'].includes(user?.role);
  const [queues, setQueues] = useState([]);
  const [projects, setProjects] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [items, setItems] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [form, setForm] = useState({ maxRetries: 1, uniqueReference: false, triggerEnabled: false });
  const [itemForm, setItemForm] = useState({ priority: 'normal', specificContent: '{\n  \n}' });
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const [queueResult, projectResult, workflowResult] = await Promise.all([api('/api/queues'), api('/api/projects?limit=100&status=active'), api('/api/workflows?limit=100&status=published')]);
    setQueues(queueResult.data);
    setProjects(projectResult.data);
    setWorkflows(workflowResult.data);
    if (selected) setSelected(queueResult.data.find((queue) => queue.id === selected.id) || null);
  }

  async function loadItems(queue = selected, status = statusFilter) {
    if (!queue) return;
    const params = new URLSearchParams({ limit: '100' });
    if (status) params.set('status', status);
    setItems((await api(`/api/queues/${queue.id}/items?${params.toString()}`)).data);
  }

  useEffect(() => { load().catch((err) => setError(err.message)); }, []);
  useEffect(() => { loadItems().catch((err) => setError(err.message)); }, [selected?.id, statusFilter]);

  async function act(work, done) {
    try { await work(); setError(''); setMessage(done); await load(); await loadItems(); } catch (err) { setError(err.message); }
  }

  const projectName = (id) => projects.find((project) => project.id === id)?.name || id.slice(0, 8);

  return (
    <section className="space-y-4">
      <div><h1 className="text-2xl font-semibold">Queues</h1><p className="text-sm text-muted">Orchestrator-style work queues. Dispatcher workflows or users add items; performer workflows (Get Transaction Item / Set Transaction Status) or robots process them. Application errors are retried up to the queue limit; business errors are not.</p></div>
      <ErrorText>{error}</ErrorText>
      {message && <p className="text-sm text-success">{message}</p>}
      {canDefine && (
        <form className="grid gap-2 rounded-lg border border-line bg-white p-3 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); act(() => api('/api/queues', { method: 'POST', body: { projectId: form.projectId, name: form.name, description: form.description || '', maxRetries: Number(form.maxRetries) || 0, uniqueReference: form.uniqueReference, triggerWorkflowId: form.triggerWorkflowId || null, triggerEnabled: form.triggerEnabled } }), 'Queue created'); }}>
          <select className={inputClass} value={form.projectId || ''} onChange={(event) => setForm({ ...form, projectId: event.target.value })}><option value="">Project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
          <input className={inputClass} placeholder="Queue name" value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <input className={inputClass} placeholder="Description" value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          <label className="flex items-center gap-2 text-sm">Auto retries<input className={`${inputClass} w-20`} type="number" min="0" max="10" value={form.maxRetries} onChange={(event) => setForm({ ...form, maxRetries: event.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.uniqueReference} onChange={(event) => setForm({ ...form, uniqueReference: event.target.checked })} /> Unique references</label>
          <select className={inputClass} value={form.triggerWorkflowId || ''} onChange={(event) => setForm({ ...form, triggerWorkflowId: event.target.value })}><option value="">No queue trigger</option>{workflows.filter((item) => item.project_id === form.projectId).map((item) => <option key={item.id} value={item.id}>Trigger: {item.name}</option>)}</select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.triggerEnabled} onChange={(event) => setForm({ ...form, triggerEnabled: event.target.checked })} /> Trigger enabled</label>
          <button className={buttonClass} type="submit">Create queue</button>
        </form>
      )}
      {queues.length === 0 ? <EmptyState title="No queues" body="Create a queue, then add items manually, through the API, or with an Add Queue Item activity." /> : (
        <div className="overflow-auto rounded-lg border border-line bg-white">
          <table className="min-w-full text-sm"><thead className="bg-cream2 text-muted"><tr><th className="px-3 py-2 text-left">Queue</th><th className="px-3 py-2 text-left">Project</th>{['NEW', 'IN_PROGRESS', 'SUCCESSFUL', 'FAILED', 'ABANDONED'].map((status) => <th key={status} className="px-3 py-2 text-right">{status.replace('_', ' ').toLowerCase()}</th>)}<th className="px-3 py-2 text-left">Retries</th><th className="px-3 py-2 text-left">Trigger</th><th /></tr></thead>
            <tbody>{queues.map((queue) => (
              <tr key={queue.id} className={`border-t border-line ${selected?.id === queue.id ? 'bg-cream' : ''}`}>
                <td className="px-3 py-2"><button type="button" className="font-medium text-emberdark" onClick={() => setSelected(queue)}>{queue.name}</button><p className="text-muted">{queue.description}</p></td>
                <td className="px-3 py-2">{projectName(queue.projectId)}</td>
                {['NEW', 'IN_PROGRESS', 'SUCCESSFUL', 'FAILED', 'ABANDONED'].map((status) => <td key={status} className="px-3 py-2 text-right">{queue.counts?.[status] ?? 0}</td>)}
                <td className="px-3 py-2">{queue.maxRetries}{queue.uniqueReference ? ' · unique ref' : ''}</td>
                <td className="px-3 py-2">{queue.triggerWorkflowId ? `${workflows.find((item) => item.id === queue.triggerWorkflowId)?.name || 'workflow'} · ${queue.triggerEnabled ? 'on' : 'off'}` : '—'}</td>
                <td className="px-3 py-2">{canDefine && queue.triggerWorkflowId && <button className={quietClass} type="button" onClick={() => act(() => api(`/api/queues/${queue.id}`, { method: 'PATCH', body: { triggerEnabled: !queue.triggerEnabled } }), 'Trigger updated')}>{queue.triggerEnabled ? 'Pause trigger' : 'Start trigger'}</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {selected && (
        <div className="space-y-3 rounded-lg border border-line bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Items · {selected.name} <span className="font-mono text-xs text-muted">{selected.id}</span></h2>
            <div className="flex gap-2">
              <select className={inputClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{ITEM_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select>
              <button className={quietClass} type="button" onClick={() => loadItems().catch((err) => setError(err.message))}>Refresh</button>
            </div>
          </div>
          {canAdd && (
            <form className="grid gap-2 md:grid-cols-4" onSubmit={(event) => {
              event.preventDefault();
              act(async () => {
                let specificContent;
                try { specificContent = JSON.parse(itemForm.specificContent || '{}'); } catch { throw new Error('Specific content must be valid JSON'); }
                await api(`/api/queues/${selected.id}/items`, { method: 'POST', body: { reference: itemForm.reference || undefined, priority: itemForm.priority, specificContent } });
                setItemForm({ ...itemForm, reference: '' });
              }, 'Item added');
            }}>
              <input className={inputClass} placeholder="Reference" value={itemForm.reference || ''} onChange={(event) => setItemForm({ ...itemForm, reference: event.target.value })} />
              <select className={inputClass} value={itemForm.priority} onChange={(event) => setItemForm({ ...itemForm, priority: event.target.value })}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select>
              <textarea className={`${inputClass} font-mono`} rows="2" value={itemForm.specificContent} onChange={(event) => setItemForm({ ...itemForm, specificContent: event.target.value })} />
              <button className={buttonClass} type="submit">Add item</button>
            </form>
          )}
          {!items ? <p className="text-sm text-muted">Loading…</p> : items.length === 0 ? <EmptyState title="No items" body="Nothing matches this filter." /> : (
            <div className="overflow-auto"><table className="min-w-full text-sm"><thead className="bg-cream2 text-muted"><tr><th className="px-3 py-2 text-left">Reference</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Priority</th><th className="px-3 py-2 text-left">Retries</th><th className="px-3 py-2 text-left">Error</th><th className="px-3 py-2 text-left">Created</th><th /></tr></thead>
              <tbody>{items.map((item) => (
                <tr key={item.id} className="border-t border-line">
                  <td className="px-3 py-2"><button type="button" className="text-emberdark" onClick={() => setDetail(item)}>{item.reference || item.id.slice(0, 8)}</button></td>
                  <td className="px-3 py-2"><StatusBadge status={item.status} /></td>
                  <td className="px-3 py-2">{item.priority}</td>
                  <td className="px-3 py-2">{item.retryCount}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-danger">{item.errorType ? `${item.errorType}: ${item.errorMessage}` : ''}</td>
                  <td className="px-3 py-2">{item.createdAt}</td>
                  <td className="px-3 py-2"><div className="flex justify-end gap-1">
                    {canControl && ['FAILED', 'ABANDONED'].includes(item.status) && <button className={quietClass} type="button" onClick={() => act(() => api(`/api/queue-items/${item.id}/retry`, { method: 'POST' }), 'Item queued again')}>Retry</button>}
                    {canControl && item.status === 'NEW' && <button className={quietClass} type="button" onClick={() => act(() => api(`/api/queue-items/${item.id}/delete`, { method: 'POST' }), 'Item deleted')}>Delete</button>}
                  </div></td>
                </tr>
              ))}</tbody></table></div>
          )}
        </div>
      )}
      {detail && (
        <Modal title={`Item ${detail.reference || detail.id.slice(0, 8)}`} onClose={() => setDetail(null)}>
          <p className="text-sm"><StatusBadge status={detail.status} /> · retries {detail.retryCount} · started {detail.startedAt || '—'} · finished {detail.finishedAt || '—'}</p>
          {detail.errorMessage && <ErrorText>{detail.errorType}: {detail.errorMessage}</ErrorText>}
          <p className="mt-2 text-xs font-semibold uppercase text-muted">Specific content</p>
          <pre className="max-h-48 overflow-auto rounded bg-mist p-2 text-xs">{JSON.stringify(detail.specificContent, null, 2)}</pre>
          <p className="mt-2 text-xs font-semibold uppercase text-muted">Output</p>
          <pre className="max-h-48 overflow-auto rounded bg-mist p-2 text-xs">{JSON.stringify(detail.output, null, 2)}</pre>
        </Modal>
      )}
    </section>
  );
}
