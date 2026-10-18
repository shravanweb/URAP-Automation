import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, currentUser } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import AgentTranscript from '../components/AgentTranscript.jsx';
import { FIELD_TYPES, HTTP_METHODS, LIMITS, QUERY_RESOURCES, TASK_ROLES, newTool, validateAgentConfig } from '../lib/agentConfig.js';
import { StatusPill } from './HomePage.jsx';
import { timeAgo } from '../layouts/CloudLayout.jsx';

// Agent builder: instructions, model settings, tools with real pickers (published workflows,
// REST API connections, roles and people), input/output schema, and a test panel that chats with
// (or runs) the saved draft and shows every tool call. Shows a "Connect an AI provider" setup
// card when no provider is configured for the project.

const canWrite = (role) => ['administrator', 'project_manager', 'automation_developer'].includes(role);
const input = 'w-full rounded-lg border border-[#E2DCD5] bg-white px-2.5 py-1.5 text-[13px] text-ink placeholder:text-slate-400 focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:bg-[#FAF9F7] disabled:text-slate-500';
const secondaryBtn = 'u-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const primaryBtn = 'u-btn-primary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-60';
export const TOOL_META = {
  workflow: { label: 'Run a workflow', icon: 'robot', tone: 'bg-[#FFF1EC] text-[#D63A0C]', body: 'Starts a published workflow through the job system and waits for its output.' },
  case: { label: 'Open a case', icon: 'briefcase', tone: 'bg-[#FDF2EC] text-[#B4471B]', body: 'Opens a case of a published case type with fields the agent fills in.' },
  task: { label: 'Ask a person', icon: 'human', tone: 'bg-[#F1EEFB] text-[#5B47B8]', body: 'Creates an Action Center task (human in the loop) and optionally waits for the decision.' },
  http: { label: 'Call an API', icon: 'api', tone: 'bg-slate-100 text-slate-700', body: 'Calls a project REST API connection. Credentials stay in the connection.' },
  query: { label: 'Look up project data', icon: 'database', tone: 'bg-[#E8F6F6] text-[#127C81]', body: 'Reads recent jobs, queue items, tasks, or workflows in this project.' },
};
const RESOURCE_LABELS = { jobs: 'Jobs', queue_items: 'Queue items', tasks: 'Action Center tasks', workflows: 'Workflows' };
const ROLE_LABELS = { administrator: 'Administrators', project_manager: 'Project managers', automation_developer: 'Automation developers', operator: 'Operators' };
const PRESETS = [
  { key: 'groq', label: 'Groq', provider: 'openai_compatible', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { key: 'ollama', label: 'Ollama (local)', provider: 'openai_compatible', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
];
const DEFAULT_MODELS = { openai: 'gpt-4o-mini', anthropic: 'claude-3-5-haiku-latest', azure_openai: '', openai_compatible: '', mock: 'mock-1' };

/** Groups validation items by field ("instructions", "tools.<id>", ...). */
export function issuesByField(items = []) {
  const map = {};
  for (const item of items) (map[item.field] ||= []).push(item.message);
  return map;
}

function Section({ title, description, action, children, id }) {
  return (
    <section id={id} className="rounded-xl u-card">
      <div className="flex items-start justify-between gap-4 border-b border-[#F1EEEA] px-5 py-3.5">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] leading-5 text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[12.5px] font-medium text-ink">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[11.5px] leading-4 text-danger">{error}</span> : hint ? <span className="mt-1 block text-[11.5px] leading-4 text-slate-400">{hint}</span> : null}
    </label>
  );
}

function Problems({ items }) {
  if (!items?.length) return null;
  return <ul className="mt-2 space-y-0.5">{items.map((message) => <li key={message} className="flex items-start gap-1.5 text-[12px] text-danger"><Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{message}</li>)}</ul>;
}

export function FieldListEditor({ fields = [], onChange, disabled, addLabel = 'Add field', empty }) {
  const update = (index, patch) => onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  return (
    <div className="space-y-2">
      {!fields.length && empty && <p className="text-[12.5px] text-slate-400">{empty}</p>}
      {fields.map((field, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,0.9fr)_96px_minmax(0,1.4fr)_auto_auto] items-center gap-2">
          <input aria-label="Field name" className={`${input} font-mono`} disabled={disabled} value={field.name} placeholder="name" onChange={(event) => update(index, { name: event.target.value })} />
          <select aria-label="Field type" className={input} disabled={disabled} value={field.type} onChange={(event) => update(index, { type: event.target.value })}>{FIELD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>
          <input aria-label="Field description" className={input} disabled={disabled} value={field.description || ''} placeholder="Description for the model" onChange={(event) => update(index, { description: event.target.value })} />
          <label className="flex items-center gap-1 text-[12px] text-slate-600"><input type="checkbox" className="accent-[#FA4616]" disabled={disabled} checked={Boolean(field.required)} onChange={(event) => update(index, { required: event.target.checked })} />Required</label>
          <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-[#F6F4F1] hover:text-danger disabled:invisible" disabled={disabled} aria-label={`Remove ${field.name || 'field'}`} onClick={() => onChange(fields.filter((_, i) => i !== index))}><Icon name="close" className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      {!disabled && <button type="button" className="text-[12.5px] font-semibold text-ember hover:underline" onClick={() => onChange([...fields, { name: '', type: 'string', description: '', required: false }])}>+ {addLabel}</button>}
    </div>
  );
}

function ToolEditor({ tool, lookups, disabled, onChange, onDelete, problems, open, onToggle }) {
  const meta = TOOL_META[tool.type] || { label: tool.type, icon: 'bolt', tone: 'bg-slate-100 text-slate-600' };
  const set = (patch) => onChange({ ...tool, ...patch });
  const workflow = lookups.workflows.find((item) => item.id === tool.workflowId);
  const summary = tool.type === 'workflow' ? (workflow?.name || 'Choose a workflow')
    : tool.type === 'case' ? ((lookups.caseTypes || []).find((item) => item.id === tool.caseTypeId)?.name || 'Choose a case type')
    : tool.type === 'task' ? `${tool.wait === false ? 'Does not wait' : 'Waits for the answer'}${tool.assignedRole ? ` · ${ROLE_LABELS[tool.assignedRole]}` : ''}`
      : tool.type === 'http' ? `${tool.method} ${tool.pathPrefix || '/'}…` : (tool.resources || []).map((item) => RESOURCE_LABELS[item]).join(', ');
  return (
    <div className={`rounded-xl border bg-white ${problems?.length ? 'border-[#F5C9C4]' : 'border-[#ECE8E3]'}`}>
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <span className={`u-tile grid h-8 w-8 shrink-0 place-items-center rounded-lg ${meta.tone}`}><Icon name={meta.icon} className="h-4 w-4" /></span>
        <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={open} onClick={onToggle}>
          <span className="block truncate font-mono text-[13px] font-semibold text-ink">{tool.name || 'unnamed_tool'}</span>
          <span className="block truncate text-[12px] text-slate-500">{meta.label} · {summary}</span>
        </button>
        {problems?.length > 0 && <span className="rounded-full bg-[#FDEEEC] px-2 py-px text-[11px] font-medium text-[#A8261B]">{problems.length} issue{problems.length === 1 ? '' : 's'}</span>}
        <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-[#F6F4F1] hover:text-ink" aria-label={open ? 'Collapse tool' : 'Expand tool'} onClick={onToggle}><Icon name="chevronDown" className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} /></button>
        {!disabled && <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-[#FEF3F2] hover:text-danger" aria-label={`Delete tool ${tool.name}`} onClick={onDelete}><Icon name="trash" className="h-4 w-4" /></button>}
      </div>
      {open && (
        <div className="space-y-3 border-t border-[#F1EEEA] px-3.5 pb-3.5 pt-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tool name" hint="What the model calls: lowercase, digits, underscores."><input className={`${input} font-mono`} disabled={disabled} value={tool.name} onChange={(event) => set({ name: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} /></Field>
            <Field label="Type"><input className={input} disabled value={meta.label} /></Field>
          </div>
          <Field label="When to use it" hint="The model reads this to decide when to call the tool."><textarea rows={2} className={`${input} resize-none`} disabled={disabled} value={tool.description || ''} onChange={(event) => set({ description: event.target.value })} /></Field>
          {tool.type === 'workflow' && (
            <>
              <Field label="Workflow" hint={lookups.workflows.length ? 'Only published workflows can run.' : 'This project has no workflows yet.'}>
                <select className={input} disabled={disabled} value={tool.workflowId || ''} onChange={(event) => set({ workflowId: event.target.value })}>
                  <option value="">Choose a workflow…</option>
                  {lookups.workflows.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== 'published' ? ` (${item.status})` : ''}</option>)}
                </select>
              </Field>
              <div>
                <p className="mb-1.5 text-[12.5px] font-medium text-ink">Inputs the model provides <span className="font-normal text-slate-400">(passed as job input)</span></p>
                <FieldListEditor fields={tool.inputs || []} disabled={disabled} onChange={(inputs) => set({ inputs })} addLabel="Add input" empty="No inputs: the workflow runs with an empty input." />
              </div>
            </>
          )}
          {tool.type === 'task' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Assign to">
                  <select className={input} disabled={disabled} value={tool.assigneeUserId ? `user:${tool.assigneeUserId}` : tool.assignedRole ? `role:${tool.assignedRole}` : ''} onChange={(event) => {
                    const [kind, value] = event.target.value.split(':');
                    set({ assignedRole: kind === 'role' ? value : '', assigneeUserId: kind === 'user' ? value : '' });
                  }}>
                    <option value="">Anyone who can complete tasks</option>
                    <optgroup label="Role">{TASK_ROLES.map((role) => <option key={role} value={`role:${role}`}>{ROLE_LABELS[role]}</option>)}</optgroup>
                    {lookups.users.length > 0 && <optgroup label="Person">{lookups.users.map((item) => <option key={item.id} value={`user:${item.id}`}>{item.name}</option>)}</optgroup>}
                  </select>
                </Field>
                <Field label="Priority">
                  <select className={input} disabled={disabled} value={tool.priority || 'medium'} onChange={(event) => set({ priority: event.target.value })}>{['low', 'medium', 'high', 'critical'].map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select>
                </Field>
              </div>
              <label className="flex items-start gap-2 text-[12.5px] text-ink"><input type="checkbox" className="mt-0.5 accent-[#FA4616]" disabled={disabled} checked={tool.wait !== false} onChange={(event) => set({ wait: event.target.checked })} /><span>Wait for the decision<span className="block text-[11.5px] text-slate-400">The agent pauses until the person approves or rejects, then continues with their answer.</span></span></label>
            </>
          )}
          {tool.type === 'case' && (() => {
            const caseType = (lookups.caseTypes || []).find((item) => item.id === tool.caseTypeId);
            const fields = caseType?.published?.fields || [];
            return (
              <Field label="Case type" hint={fields.length ? `The agent fills in: ${fields.map((field) => `${field.name}${field.required ? '*' : ''}`).join(', ')}` : (lookups.caseTypes || []).length ? 'Only published case types can open cases.' : 'This project has no case types yet. Create one in Studio → Cases.'}>
                <select className={input} disabled={disabled} value={tool.caseTypeId || ''} onChange={(event) => set({ caseTypeId: event.target.value })}>
                  <option value="">Choose a case type…</option>
                  {(lookups.caseTypes || []).map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== 'published' ? ` (${item.status})` : ''}</option>)}
                </select>
              </Field>
            );
          })()}
          {tool.type === 'http' && (
            <div className="grid grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)] gap-3">
              <Field label="REST API connection" hint={lookups.restConnections.length ? '' : 'Add one in Connections.'}>
                <select className={input} disabled={disabled} value={tool.connectionId || ''} onChange={(event) => set({ connectionId: event.target.value })}>
                  <option value="">Choose…</option>
                  {lookups.restConnections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <Field label="Method"><select className={input} disabled={disabled} value={tool.method || 'GET'} onChange={(event) => set({ method: event.target.value })}>{HTTP_METHODS.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Allowed path prefix"><input className={`${input} font-mono`} disabled={disabled} value={tool.pathPrefix || '/'} onChange={(event) => set({ pathPrefix: event.target.value })} /></Field>
            </div>
          )}
          {tool.type === 'query' && (
            <fieldset>
              <legend className="mb-1.5 text-[12.5px] font-medium text-ink">May look up</legend>
              <div className="flex flex-wrap gap-2">
                {QUERY_RESOURCES.map((resource) => {
                  const on = (tool.resources || []).includes(resource);
                  return (
                    <label key={resource} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] ${on ? 'border-[#F3B9A4] bg-[#FFF7F3] text-ink' : 'border-[#ECE8E3] text-slate-600'}`}>
                      <input type="checkbox" className="accent-[#FA4616]" disabled={disabled} checked={on} onChange={() => set({ resources: on ? tool.resources.filter((item) => item !== resource) : [...(tool.resources || []), resource] })} />{RESOURCE_LABELS[resource]}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          <Problems items={problems} />
        </div>
      )}
    </div>
  );
}

function AddToolMenu({ onAdd }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" className={secondaryBtn} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Icon name="plus" className="h-3.5 w-3.5" />Add tool</button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-30 cursor-default" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-80 rounded-xl u-card p-1.5 shadow-[0_16px_40px_-16px_rgba(23,33,37,0.28)]">
            {Object.entries(TOOL_META).map(([type, meta]) => (
              <button key={type} type="button" role="menuitem" className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-[#F6F4F1]" onClick={() => { setOpen(false); onAdd(type); }}>
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${meta.tone}`}><Icon name={meta.icon} className="h-3.5 w-3.5" /></span>
                <span><span className="block text-[13px] font-semibold text-ink">{meta.label}</span><span className="block text-[12px] leading-4 text-slate-500">{meta.body}</span></span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function AiSetupCard({ projectId, status, canConfigure, onConfigured }) {
  const providers = status?.providers || [];
  const [form, setForm] = useState({ provider: 'openai', baseUrl: '', model: DEFAULT_MODELS.openai, apiKey: '', apiVersion: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const meta = providers.find((item) => item.id === form.provider);
  const needsBase = ['azure_openai', 'openai_compatible'].includes(form.provider);
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setMessage(null);
    try {
      const label = meta?.label || form.provider;
      const created = await api(`/api/projects/${projectId}/connections`, {
        method: 'POST',
        body: {
          connectorType: 'ai_provider', name: `${label} · ${form.model}`.slice(0, 200),
          config: { provider: form.provider, model: form.model.trim(), ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}), ...(form.apiVersion.trim() ? { apiVersion: form.apiVersion.trim() } : {}) },
          secret: form.apiKey ? { apiKey: form.apiKey } : undefined,
        },
      });
      setForm((value) => ({ ...value, apiKey: '' }));
      const tested = await api(`/api/connections/${created.data.id}/test`, { method: 'POST' }).catch((err) => ({ data: { status: 'unavailable', error: err.message } }));
      if (tested.data.status === 'available') { setMessage({ tone: 'ok', text: 'Connected. The provider answered the test.' }); onConfigured?.(created.data); }
      else setMessage({ tone: 'error', text: `Saved, but the test call failed: ${tested.data.error || 'unknown error'}. Check the key, model, and base URL.` });
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-xl border border-[#ECE8E3] bg-white p-4" role="region" aria-label="Connect an AI provider">
      <div className="flex items-start gap-3">
        <span className="u-tile grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#EEF4FF] text-[#3550B5]"><Icon name="sparkle" className="h-5 w-5" /></span>
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-ink">Connect an AI provider</h3>
          <p className="mt-0.5 text-[12.5px] leading-5 text-slate-500">Agents need a model to think with. Add your provider once for this project; the API key is stored encrypted and never shown again.</p>
        </div>
      </div>
      {!canConfigure ? (
        <p className="mt-4 rounded-lg bg-[#FCFBFA] px-3 py-2.5 text-[12.5px] text-slate-600">Ask an administrator, project manager, or automation developer to add an <span className="font-semibold">AI provider</span> connection to this project.</p>
      ) : (
        <form className="mt-4 space-y-3" onSubmit={submit}>
          <Field label="Provider">
            <select className={input} value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value, model: DEFAULT_MODELS[event.target.value] ?? '', baseUrl: '' })}>
              {providers.map((item) => <option key={item.id} value={item.id}>{item.id === 'openai_compatible' ? 'OpenAI-compatible (Groq, Ollama, …)' : item.label}</option>)}
            </select>
          </Field>
          {form.provider === 'openai_compatible' && (
            <div className="flex flex-wrap gap-1.5">{PRESETS.map((preset) => <button key={preset.key} type="button" className="rounded-full border border-[#ECE8E3] px-2.5 py-0.5 text-[12px] font-medium text-slate-600 hover:border-[#F3B9A4] hover:text-ink" onClick={() => setForm({ ...form, baseUrl: preset.baseUrl, model: preset.model })}>{preset.label}</button>)}</div>
          )}
          {(needsBase || form.provider === 'anthropic' || form.provider === 'openai') && (
            <Field label={needsBase ? 'Base URL' : 'Base URL (optional)'} hint={form.provider === 'azure_openai' ? 'https://<resource>.openai.azure.com' : needsBase ? 'For example https://api.groq.com/openai/v1' : `Default ${meta?.baseUrl || ''}`}>
              <input className={`${input} font-mono`} required={needsBase} value={form.baseUrl} placeholder={meta?.baseUrl || 'https://…'} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
            </Field>
          )}
          <div className={`grid gap-3 ${form.provider === 'azure_openai' ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <Field label={form.provider === 'azure_openai' ? 'Deployment name' : 'Model'}><input className={`${input} font-mono`} required value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} /></Field>
            {form.provider === 'azure_openai' && <Field label="API version"><input className={`${input} font-mono`} value={form.apiVersion} placeholder="2024-06-01" onChange={(event) => setForm({ ...form, apiVersion: event.target.value })} /></Field>}
          </div>
          <Field label={meta?.needsKey === false ? 'API key (optional)' : 'API key'} hint="Stored encrypted with the server's credentials key.">
            <input type="password" autoComplete="new-password" className={`${input} font-mono`} required={meta?.needsKey !== false} value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} />
          </Field>
          {message && <p className={`rounded-lg px-3 py-2 text-[12.5px] ${message.tone === 'ok' ? 'bg-[#F2FAF4] text-[#1F6B3A]' : 'bg-[#FEF3F2] text-danger'}`} role={message.tone === 'ok' ? 'status' : 'alert'}>{message.text}</p>}
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-[11.5px] leading-4 text-slate-400">Or set AI_PROVIDER, AI_API_KEY, and AI_MODEL on the server.</p>
            <button type="submit" disabled={busy || !form.model.trim()} className={`${primaryBtn} shrink-0 whitespace-nowrap`}>{busy ? 'Connecting…' : 'Save and test'}</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Polls a run while it is working. */
export function useAgentRun(runId) {
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!runId) { setRun(null); return null; }
    try {
      const result = await api(`/api/agent-runs/${runId}`);
      setRun(result.data);
      setError('');
      return result.data;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [runId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!run || !['RUNNING', 'WAITING'].includes(run.status)) return undefined;
    const timer = setTimeout(load, run.status === 'WAITING' ? 2000 : 900);
    return () => clearTimeout(timer);
  }, [run, load]);
  return { run, setRun, reload: load, error };
}

function TestPanel({ agent, config, aiStatus, canConfigure, onConfigured, ensureSaved, toolTypes, onRunStarted }) {
  const [runId, setRunId] = useState(null);
  const { run, reload } = useAgentRun(runId);
  const [text, setText] = useState('');
  const [inputs, setInputs] = useState({});
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const scroller = useRef(null);
  const chat = agent.agentType === 'conversational';
  const busy = sending || (run && ['RUNNING', 'WAITING'].includes(run.status));
  useEffect(() => { scroller.current?.scrollTo?.({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [run?.messages?.length, run?.status]);

  async function start(body) {
    setSending(true); setError(null);
    try {
      if (!(await ensureSaved())) { setSending(false); return; }
      const result = await api(`/api/agents/${agent.id}/runs`, { method: 'POST', body: { test: true, ...body } });
      setRunId(result.data.id);
      onRunStarted?.();
    } catch (err) {
      setError({ message: err.message, details: err.details });
    } finally {
      setSending(false);
    }
  }
  async function send(event) {
    event?.preventDefault();
    const content = text.trim();
    if (!content || busy) return;
    if (run && run.status === 'IDLE') {
      setSending(true); setError(null);
      try {
        await api(`/api/agent-runs/${run.id}/messages`, { method: 'POST', body: { content } });
        setText('');
        await reload();
      } catch (err) {
        setError({ message: err.message });
      } finally {
        setSending(false);
      }
      return;
    }
    setText('');
    await start({ message: content });
  }
  function runTask(event) {
    event.preventDefault();
    const values = {};
    for (const field of config.inputSchema || []) {
      const raw = inputs[field.name];
      if (raw === undefined || raw === '') continue;
      if (field.type === 'number') values[field.name] = Number(raw);
      else if (field.type === 'boolean') values[field.name] = raw === true || raw === 'true';
      else if (field.type === 'object') { try { values[field.name] = JSON.parse(raw); } catch { values[field.name] = raw; } }
      else values[field.name] = raw;
    }
    start({ input: values });
  }

  if (!aiStatus) return <div className="p-5 text-[13px] text-slate-400">Checking the AI provider…</div>;
  if (!aiStatus.configured) return <div className="overflow-y-auto p-4"><AiSetupCard projectId={agent.projectId} status={aiStatus} canConfigure={canConfigure} onConfigured={onConfigured} /></div>;
  const totals = run ? `${run.steps} step${run.steps === 1 ? '' : 's'} · ${run.totalTokens.toLocaleString()} tokens` : '';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-[#F1EEEA] px-4 py-2">
        <p className="min-w-0 truncate text-[12px] text-slate-500"><span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2E9E57] align-middle" aria-hidden="true" /> <span className="font-medium text-ink">{aiStatus.active.providerLabel} · {aiStatus.active.model}</span>{aiStatus.active.source === 'env' ? ' (server default)' : ''}</p>
        <div className="flex shrink-0 items-center gap-2">
          {run && <span className="text-[11.5px] tabular-nums text-slate-400">{totals}</span>}
          {run && <Link to={`/studio/agents/${agent.id}/runs/${run.id}`} className="text-[12px] font-semibold text-slate-600 hover:text-ember">Trace</Link>}
          {run && <button type="button" className="text-[12px] font-semibold text-slate-600 hover:text-ember" onClick={() => { setRunId(null); setError(null); }}>{chat ? 'New chat' : 'Reset'}</button>}
        </div>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!chat && !run && (
          <form className="space-y-3" onSubmit={runTask}>
            <p className="text-[12.5px] text-slate-500">Run the saved draft once with these inputs. Tools really run: workflows start jobs and tasks appear in Action Center.</p>
            {(config.inputSchema || []).map((field) => (
              <Field key={field.name} label={<>{field.name}{field.required && <span className="text-danger"> *</span>} <span className="font-normal text-slate-400">{field.type}</span></>} hint={field.description}>
                {field.type === 'boolean'
                  ? <select className={input} value={String(inputs[field.name] ?? '')} onChange={(event) => setInputs({ ...inputs, [field.name]: event.target.value })}><option value="">—</option><option value="true">true</option><option value="false">false</option></select>
                  : <textarea rows={field.type === 'object' ? 3 : 2} className={`${input} resize-none ${field.type === 'object' ? 'font-mono' : ''}`} value={inputs[field.name] ?? ''} onChange={(event) => setInputs({ ...inputs, [field.name]: event.target.value })} />}
              </Field>
            ))}
            {!(config.inputSchema || []).length && <p className="text-[12.5px] text-slate-400">This agent has no input fields. Add some under Input &amp; output, or run it as is.</p>}
            <button type="submit" disabled={sending} className={primaryBtn}><Icon name="play" className="h-3.5 w-3.5" />{sending ? 'Starting…' : 'Run test'}</button>
          </form>
        )}
        {(chat || run) && <AgentTranscript run={run || (chat && config.greeting ? { status: 'IDLE', messages: [{ id: 'greeting', role: 'assistant', content: config.greeting, toolCalls: [] }] } : null)} toolTypes={toolTypes} compact emptyText="Say hello to test your agent. It uses the saved draft." />}
        {run?.status === 'SUCCEEDED' && run.mode === 'task' && (
          <div className="mt-4 rounded-xl border border-[#CDE9D6] bg-[#F2FAF4] p-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[#1F6B3A]">Output</p>
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-ink">{JSON.stringify(run.output, null, 2)}</pre>
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[12.5px] text-danger" role="alert">
            {error.message}
            {Array.isArray(error.details) && error.details.length > 0 && <ul className="mt-1 list-disc pl-4">{error.details.slice(0, 5).map((item, index) => <li key={index}>{item.message}</li>)}</ul>}
          </div>
        )}
      </div>
      {chat && (
        <form className="border-t border-[#F1EEEA] p-3" onSubmit={send}>
          <div className="flex items-end gap-2 rounded-xl border border-[#E2DCD5] bg-white p-1.5 focus-within:border-ember focus-within:ring-2 focus-within:ring-brand/15">
            <textarea
              aria-label="Message the agent"
              rows={1}
              className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13.5px] text-ink placeholder:text-slate-400 focus:outline-none"
              placeholder={run && !['IDLE', 'RUNNING', 'WAITING'].includes(run.status) ? 'This chat ended. Start a new one.' : 'Message the agent…'}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }}
            />
            <button type="submit" disabled={busy || !text.trim()} className="u-btn-primary grid h-9 w-9 shrink-0 place-items-center rounded-lg disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send"><Icon name="arrowUpRight" className="h-4 w-4" strokeWidth={2.2} /></button>
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-slate-400">Enter to send · Shift+Enter for a new line · Tools really run</p>
        </form>
      )}
    </div>
  );
}

function RunsList({ agentId, refreshKey }) {
  const [runs, setRuns] = useState(null);
  useEffect(() => { api(`/api/agent-runs?agentId=${agentId}&limit=25`).then((result) => setRuns(result.data)).catch(() => setRuns([])); }, [agentId, refreshKey]);
  if (!runs) return <p className="p-5 text-[13px] text-slate-400">Loading runs…</p>;
  if (!runs.length) return <p className="p-5 text-[13px] text-slate-500">No runs yet. Test the agent, publish it, or add it to a flow.</p>;
  return (
    <ul className="divide-y divide-[#F1EEEA] overflow-y-auto">
      {runs.map((run) => (
        <li key={run.id}>
          <Link to={`/studio/agents/${agentId}/runs/${run.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-[#FCFBFA]">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">{run.title || 'Run'}</p>
              <p className="mt-0.5 text-[11.5px] text-slate-500">{run.source === 'test' ? 'Test' : run.source === 'flow' ? 'From a flow' : run.mode === 'chat' ? 'Chat' : 'API'}{run.versionNumber ? ` · v${run.versionNumber}` : ' · draft'} · {run.steps} steps · {run.totalTokens.toLocaleString()} tokens · {timeAgo(run.startedAt)}</p>
            </div>
            <StatusPill status={run.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function AgentBuilderPage() {
  const { id } = useParams();
  const user = currentUser();
  const writable = canWrite(user?.role);
  const [agent, setAgent] = useState(null);
  const [config, setConfig] = useState(null);
  const [name, setName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [serverIssues, setServerIssues] = useState([]);
  const [lookups, setLookups] = useState({ workflows: [], restConnections: [], aiConnections: [], users: [] });
  const [aiStatus, setAiStatus] = useState(null);
  const [panel, setPanel] = useState('test');
  const [openTool, setOpenTool] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState('');
  const [runsKey, setRunsKey] = useState(0);

  const loadStatus = useCallback(async (projectId, connectionId) => {
    const result = await api(`/api/ai/status?projectId=${projectId}${connectionId ? `&connectionId=${connectionId}` : ''}`).catch(() => null);
    setAiStatus(result?.data || { configured: false, providers: [], connections: [] });
    return result?.data;
  }, []);

  useEffect(() => {
    let alive = true;
    api(`/api/agents/${id}`).then(async (result) => {
      if (!alive) return;
      const data = result.data;
      setAgent(data); setConfig(data.config); setName(data.name); setServerIssues(data.validation?.errors || []);
      const get = (path) => api(path).then((value) => value.data).catch(() => []);
      const [workflows, connections, members, users, caseTypes] = await Promise.all([
        get(`/api/workflows?projectId=${data.projectId}&limit=100`),
        get(`/api/projects/${data.projectId}/connections`),
        get(`/api/projects/${data.projectId}/members`),
        user?.role === 'administrator' ? get('/api/users') : Promise.resolve([]),
        get(`/api/case-types?projectId=${data.projectId}&limit=100&published=1`),
      ]);
      if (!alive) return;
      const people = new Map();
      for (const item of users || []) if (item.status !== 'disabled') people.set(item.id, { id: item.id, name: item.displayName || item.email });
      for (const item of members || []) people.set(item.user_id, { id: item.user_id, name: item.display_name || item.email });
      setLookups({
        workflows,
        caseTypes,
        restConnections: connections.filter((item) => item.connectorType === 'rest_api'),
        aiConnections: connections.filter((item) => item.connectorType === 'ai_provider'),
        users: [...people.values()],
      });
      loadStatus(data.projectId, data.config.connectionId);
    }).catch((err) => setError(err.message));
    return () => { alive = false; };
  }, [id, loadStatus]);

  const change = (patch) => { setConfig((value) => ({ ...value, ...patch })); setDirty(true); setServerIssues([]); };
  const clientIssues = useMemo(() => (config ? validateAgentConfig(config, null, agent?.agentType) : { errors: [], warnings: [] }), [config, agent?.agentType]);
  const issues = serverIssues.length ? serverIssues : clientIssues.errors;
  const byField = issuesByField(issues);
  const toolTypes = useMemo(() => Object.fromEntries((config?.tools || []).map((tool) => [tool.name, tool.type])), [config?.tools]);

  const save = useCallback(async () => {
    setBusy('save'); setError('');
    try {
      const result = await api(`/api/agents/${id}/draft`, { method: 'PUT', body: { config } });
      setAgent(result.data); setServerIssues(result.data.validation?.errors || []); setDirty(false);
      return result.data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy('');
    }
  }, [id, config]);
  const ensureSaved = useCallback(async () => (dirty ? Boolean(await save()) : true), [dirty, save]);

  useEffect(() => {
    const onKey = (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); if (writable && dirty) save(); } };
    const onUnload = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); };
  }, [dirty, save, writable]);

  async function publish() {
    if (dirty && !(await save())) return;
    setBusy('publish'); setError(''); setNotice(null);
    try {
      const result = await api(`/api/agents/${id}/publish`, { method: 'POST' });
      setAgent(result.data); setServerIssues([]);
      setNotice(`Published version ${result.data.versionNumber}. Flows and chats now use it.`);
    } catch (err) {
      setError(err.message);
      if (err.details) setServerIssues(err.details);
    } finally {
      setBusy('');
    }
  }
  async function rename() {
    const next = name.trim();
    if (!next || next === agent.name) { setName(agent.name); return; }
    try { const result = await api(`/api/agents/${id}`, { method: 'PATCH', body: { name: next } }); setAgent((value) => ({ ...value, name: result.data.name })); } catch (err) { setError(err.message); setName(agent.name); }
  }

  if (error && !agent) return <main id="app-main" className="p-10 text-[14px] text-danger">{error}</main>;
  if (!agent || !config) return <main id="app-main" className="p-10 text-[14px] text-slate-500">Loading agent…</main>;
  const chat = agent.agentType === 'conversational';
  const disabled = !writable;
  const updateTool = (tool) => change({ tools: config.tools.map((item) => (item.id === tool.id ? tool : item)) });

  return (
    <main id="app-main" className="flex h-[calc(100vh-3.5rem)] flex-col bg-[#FAF9F7]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#ECE8E3] bg-white px-4 py-2.5">
        <Link to="/studio?view=agents" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Back to agents"><Icon name="chevronRight" className="h-4 w-4 rotate-180" /></Link>
        <span className="u-tile grid h-8 w-8 place-items-center rounded-lg bg-[#EEF4FF] text-[#3550B5]"><Icon name="agent" className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="text-[11.5px] text-slate-500">{agent.projectName} · {chat ? 'Conversational agent' : 'Autonomous agent'}</p>
          <input aria-label="Agent name" className="-ml-1 w-[280px] rounded-md border border-transparent bg-transparent px-1 text-[15px] font-semibold tracking-tight text-ink hover:border-[#ECE8E3] focus:border-ember focus:outline-none" disabled={disabled} value={name} onChange={(event) => setName(event.target.value)} onBlur={rename} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        </div>
        <StatusPill status={agent.status} />
        <span className="text-[12px] text-slate-500">{dirty ? <span className="font-medium text-[#8A5A0B]">Unsaved changes</span> : agent.versionNumber ? `v${agent.versionNumber}` : 'Not published'}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold ${issues.length ? 'bg-[#FDEEEC] text-[#A8261B]' : 'bg-[#ECF7EF] text-[#1F6B3A]'}`}><Icon name={issues.length ? 'alert' : 'check'} className="h-3.5 w-3.5" />{issues.length ? `${issues.length} issue${issues.length === 1 ? '' : 's'}` : 'Valid'}</span>
          {writable && <button type="button" className={secondaryBtn} disabled={!dirty || busy === 'save'} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}
          {writable && <button type="button" className={primaryBtn} disabled={Boolean(busy) || issues.length > 0} onClick={publish}><Icon name="upload" className="h-3.5 w-3.5" />{busy === 'publish' ? 'Publishing…' : 'Publish'}</button>}
        </div>
      </div>
      {(notice || error) && (
        <div className={`flex items-center gap-3 border-b px-5 py-2 text-[13px] ${error ? 'border-[#F5C9C4] bg-[#FEF3F2] text-danger' : 'border-[#CDE9D6] bg-[#F2FAF4] text-[#1F6B3A]'}`} role={error ? 'alert' : 'status'}>
          <span className="flex-1">{error || notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => { setNotice(null); setError(''); }}><Icon name="close" className="h-4 w-4" /></button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[860px] space-y-4 px-6 py-6">
            <Section title="Instructions" description="Tell the agent who it is, what it should do, and the rules it must follow.">
              <textarea aria-label="Instructions" rows={9} className={`${input} resize-y py-2 text-[13.5px] leading-6`} disabled={disabled} value={config.instructions} onChange={(event) => change({ instructions: event.target.value })} placeholder="You are an accounts payable assistant…" />
              <div className="mt-1 flex justify-between text-[11.5px] text-slate-400"><span>{byField.instructions ? <span className="text-danger">{byField.instructions[0]}</span> : 'Tip: describe when to use each tool and what a good final answer looks like.'}</span><span className="tabular-nums">{config.instructions.length.toLocaleString()} / 20,000</span></div>
              {chat && <Field className="mt-3" label="Greeting" hint="First message shown in a new chat (optional)."><input className={input} disabled={disabled} value={config.greeting || ''} onChange={(event) => change({ greeting: event.target.value })} /></Field>}
            </Section>

            <Section title="Model" description="Which AI provider and model the agent uses, and the guardrails for each run.">
              <div className="grid grid-cols-2 gap-4">
                <Field label="AI provider" error={byField.connectionId?.[0]} hint={aiStatus?.configured ? `Default: ${aiStatus.active?.providerLabel} · ${aiStatus.active?.model}` : 'No provider yet: connect one in the Test panel.'}>
                  <select className={input} disabled={disabled} value={config.connectionId || ''} onChange={(event) => { change({ connectionId: event.target.value || null }); loadStatus(agent.projectId, event.target.value || null); }}>
                    <option value="">Project default</option>
                    {lookups.aiConnections.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status === 'unavailable' ? ' (test failed)' : ''}</option>)}
                  </select>
                </Field>
                <Field label="Model override" hint="Leave empty to use the provider's model." error={byField.model?.[0]}><input className={`${input} font-mono`} disabled={disabled} value={config.model || ''} placeholder={aiStatus?.active?.model || 'e.g. gpt-4o-mini'} onChange={(event) => change({ model: event.target.value.trim() })} /></Field>
              </div>
              <div className="mt-4 grid grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))] gap-4">
                <Field label={<span className="flex justify-between">Temperature<span className="tabular-nums text-slate-500">{Number(config.temperature).toFixed(1)}</span></span>} hint="Lower is more predictable." error={byField.temperature?.[0]}>
                  <input type="range" min={0} max={2} step={0.1} className="mt-2 w-full accent-[#FA4616]" disabled={disabled} value={config.temperature} onChange={(event) => change({ temperature: Number(event.target.value) })} />
                </Field>
                <Field label="Max steps" hint={`Model calls per turn (${LIMITS.maxSteps.join('–')})`} error={byField.maxSteps?.[0]}><input type="number" min={LIMITS.maxSteps[0]} max={LIMITS.maxSteps[1]} className={input} disabled={disabled} value={config.maxSteps} onChange={(event) => change({ maxSteps: Number(event.target.value) })} /></Field>
                <Field label="Max tokens per reply" error={byField.maxTokens?.[0]} hint="64–8192"><input type="number" min={64} max={8192} step={64} className={input} disabled={disabled} value={config.maxTokens} onChange={(event) => change({ maxTokens: Number(event.target.value) })} /></Field>
                <Field label="Token budget per run" error={byField.maxTotalTokens?.[0]} hint="Stops the run when used up"><input type="number" min={1000} max={500000} step={1000} className={input} disabled={disabled} value={config.maxTotalTokens} onChange={(event) => change({ maxTotalTokens: Number(event.target.value) })} /></Field>
              </div>
              <Field className="mt-4 max-w-[260px]" label="Tool wait limit (minutes)" hint="How long to wait for a job or a person" error={byField.toolTimeoutMinutes?.[0]}><input type="number" min={1} max={10080} className={input} disabled={disabled} value={config.toolTimeoutMinutes} onChange={(event) => change({ toolTimeoutMinutes: Number(event.target.value) })} /></Field>
            </Section>

            <Section title="Tools" description="Actions the agent may take. It decides when to call them; every call is recorded in the run trace." action={writable && <AddToolMenu onAdd={(type) => { const tool = newTool(type, config.tools); change({ tools: [...config.tools, tool] }); setOpenTool(tool.id); }} />}>
              {config.tools.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#E2DCD5] px-4 py-6 text-center">
                  <p className="text-[13px] font-medium text-ink">No tools yet</p>
                  <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-5 text-slate-500">Without tools the agent can only talk. Add a workflow it can run, a person it can ask, an API it can call, or project data it can look up.</p>
                </div>
              ) : (
                <div className="space-y-2">{config.tools.map((tool) => <ToolEditor key={tool.id} tool={tool} lookups={lookups} disabled={disabled} problems={byField[`tools.${tool.id}`]} open={openTool === tool.id} onToggle={() => setOpenTool(openTool === tool.id ? null : tool.id)} onChange={updateTool} onDelete={() => change({ tools: config.tools.filter((item) => item.id !== tool.id) })} />)}</div>
              )}
              <Problems items={byField.tools} />
            </Section>

            <Section title="Input & output" description={chat ? 'Conversational agents take chat messages. Inputs and outputs are used when the agent runs as a flow step or through the API.' : 'What the agent receives and must return. Output fields become a submit_output tool the model calls when done.'}>
              <p className="mb-2 text-[12.5px] font-semibold text-ink">Input</p>
              <FieldListEditor fields={config.inputSchema} disabled={disabled} onChange={(inputSchema) => change({ inputSchema })} addLabel="Add input field" empty="No input fields." />
              <Problems items={byField.inputSchema} />
              <p className="mb-2 mt-5 text-[12.5px] font-semibold text-ink">Output</p>
              <FieldListEditor fields={config.outputSchema} disabled={disabled} onChange={(outputSchema) => change({ outputSchema })} addLabel="Add output field" empty="No output fields: the final answer is returned as text." />
              <Problems items={byField.outputSchema} />
            </Section>
            <p className="pb-4 text-center text-[11.5px] text-slate-400">Coded agents (your own JavaScript tools) are planned; they need a hardened sandbox first.</p>
          </div>
        </div>

        <aside className="flex w-[440px] shrink-0 flex-col border-l border-[#ECE8E3] bg-white" aria-label="Test and runs">
          <div className="flex gap-5 border-b border-[#ECE8E3] px-4" role="tablist">
            {[['test', chat ? 'Test chat' : 'Test run'], ['runs', 'Runs']].map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={panel === key} onClick={() => setPanel(key)} className={`-mb-px border-b-2 py-2.5 text-[13px] font-semibold ${panel === key ? 'border-ember text-ink' : 'border-transparent text-slate-500 hover:text-ink'}`}>{label}</button>
            ))}
          </div>
          {panel === 'test'
            ? <TestPanel agent={agent} config={config} aiStatus={aiStatus} canConfigure={writable} toolTypes={toolTypes} ensureSaved={ensureSaved} onRunStarted={() => setRunsKey((value) => value + 1)} onConfigured={async (connection) => { setLookups((value) => ({ ...value, aiConnections: [...value.aiConnections, connection] })); await loadStatus(agent.projectId, config.connectionId); }} />
            : <RunsList agentId={agent.id} refreshKey={runsKey} />}
        </aside>
      </div>
    </main>
  );
}
