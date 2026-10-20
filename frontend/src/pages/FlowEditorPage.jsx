import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, currentUser } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import FlowCanvas, { NODE_H, NODE_META, NODE_W, formatSeconds } from '../components/FlowCanvas.jsx';
import { OPERATORS, outputVarOf, validateDefinition } from '../lib/flowDefinition.js';
import { StatusPill } from './HomePage.jsx';
import { timeAgo } from '../layouts/CloudLayout.jsx';

// Flow editor: palette, canvas, and a properties panel with real pickers (project workflows,
// REST API connections, users). Saves a draft, publishes a version, and starts runs.

export const PALETTE = [
  ['Activities', ['robot', 'agent', 'human', 'case', 'http', 'timer']],
  ['Logic', ['decision', 'loop', 'parallel', 'join']],
  ['Events', ['end']],
];
export const OP_LABELS = { eq: 'equals', neq: 'does not equal', gt: 'is greater than', gte: 'is at least', lt: 'is less than', lte: 'is at most', contains: 'contains', empty: 'is empty', not_empty: 'is not empty' };
const canWrite = (role) => ['administrator', 'project_manager', 'automation_developer'].includes(role);
const canRun = (role) => ['administrator', 'project_manager', 'automation_developer', 'operator'].includes(role);
const input = 'w-full rounded-lg border border-[#E2DCD5] bg-white px-2.5 py-1.5 text-[13px] text-ink placeholder:text-slate-400 focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:bg-[#FAF9F7] disabled:text-slate-500';
const secondaryBtn = 'u-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const primaryBtn = 'u-btn-primary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-60';

export function newNode(type, x, y, definition) {
  const meta = NODE_META[type];
  const taken = new Set(definition.nodes.map((node) => node.id));
  let index = 1;
  while (taken.has(`${type}_${index}`)) index += 1;
  const id = `${type}_${index}`;
  const config = {
    robot: { workflowId: '', input: {}, outputVar: `${type}${index}`, retries: 0 },
    agent: { agentId: '', input: {}, outputVar: `agent${index}`, retries: 0 },
    human: { title: '', taskType: 'approval', priority: 'medium', outputVar: `review${index}` },
    case: { caseTypeId: '', title: '', fields: {}, priority: '', waitForResolution: false, outputVar: `case${index}` },
    http: { method: 'GET', path: '/', outputVar: `response${index}`, retries: 0 },
    timer: { seconds: 60 },
    loop: { maxIterations: 3 },
  }[type] || {};
  return { id, type, name: `${meta.label}${index > 1 ? ` ${index}` : ''}`, x, y, config };
}

/** Map validation items to { nodeId | 'edge:<id>': message } for canvas badges. */
export function problemMap(items) {
  const map = {};
  for (const item of items) {
    if (item.edgeId && !map[`edge:${item.edgeId}`]) map[`edge:${item.edgeId}`] = item.message;
    if (item.nodeId && !map[item.nodeId]) map[item.nodeId] = item.message;
  }
  return map;
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] leading-4 text-slate-400">{hint}</span>}
    </label>
  );
}

export function KeyValueEditor({ value = {}, onChange, disabled, keyPlaceholder = 'name', valuePlaceholder = '{{vars.amount}}' }) {
  const rows = Object.entries(value);
  const set = (next) => onChange(Object.fromEntries(next.filter(([key]) => key !== null)));
  return (
    <div className="space-y-1.5">
      {rows.map(([key, val], index) => (
        <div key={index} className="flex gap-1.5">
          <input className={`${input} w-[42%]`} disabled={disabled} value={key} placeholder={keyPlaceholder} aria-label="Input name" onChange={(event) => set(rows.map((row, i) => (i === index ? [event.target.value, row[1]] : row)))} />
          <input className={input} disabled={disabled} value={typeof val === 'string' ? val : JSON.stringify(val)} placeholder={valuePlaceholder} aria-label={`Value for ${key || 'input'}`} onChange={(event) => set(rows.map((row, i) => (i === index ? [row[0], event.target.value] : row)))} />
          {!disabled && <button type="button" className="grid w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-[#F6F4F1] hover:text-danger" aria-label={`Remove ${key || 'row'}`} onClick={() => set(rows.filter((_, i) => i !== index))}><Icon name="close" className="h-3.5 w-3.5" /></button>}
        </div>
      ))}
      {!disabled && <button type="button" className="text-[12.5px] font-semibold text-ember hover:underline" onClick={() => set([...rows, [`input${rows.length + 1}`, '']])}>+ Add input</button>}
    </div>
  );
}

export function FormFieldsEditor({ fields = [], onChange, disabled }) {
  const update = (index, patch) => onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  return (
    <div className="space-y-2">
      {fields.map((field, index) => (
        <div key={index} className="rounded-lg border border-[#ECE8E3] bg-[#FCFBFA] p-2.5">
          <div className="flex gap-1.5">
            <input className={input} disabled={disabled} value={field.label || ''} placeholder="Label" aria-label="Field label" onChange={(event) => update(index, { label: event.target.value })} />
            <select className={`${input} w-28`} disabled={disabled} value={field.type || 'text'} aria-label="Field type" onChange={(event) => update(index, { type: event.target.value })}>
              {['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'email'].map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            {!disabled && <button type="button" className="grid w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-danger" aria-label={`Remove field ${field.label || index + 1}`} onClick={() => onChange(fields.filter((_, i) => i !== index))}><Icon name="close" className="h-3.5 w-3.5" /></button>}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <input className={`${input} font-mono text-[12px]`} disabled={disabled} value={field.name || ''} placeholder="fieldName" aria-label="Field name" onChange={(event) => update(index, { name: event.target.value })} />
            <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-slate-600"><input type="checkbox" disabled={disabled} checked={Boolean(field.required)} onChange={(event) => update(index, { required: event.target.checked })} className="accent-[#D63A0C]" />Required</label>
          </div>
          {field.type === 'select' && <input className={`${input} mt-1.5`} disabled={disabled} value={(field.options || []).join(', ')} placeholder="Options, comma separated" aria-label="Options" onChange={(event) => update(index, { options: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />}
        </div>
      ))}
      {!disabled && <button type="button" className="text-[12.5px] font-semibold text-ember hover:underline" onClick={() => onChange([...fields, { name: `field${fields.length + 1}`, label: `Field ${fields.length + 1}`, type: 'text', required: false }])}>+ Add form field</button>}
    </div>
  );
}

function variablePaths(definition) {
  const paths = (definition.variables || []).map((item) => `vars.${item.name}`);
  for (const node of definition.nodes) {
    const name = outputVarOf(node);
    if (!name) continue;
    if (node.type === 'human') paths.push(`vars.${name}.outcome`, `vars.${name}.data`, `vars.${name}.comment`);
    else if (node.type === 'http') paths.push(`vars.${name}.status`, `vars.${name}.data`);
    else paths.push(`vars.${name}`);
  }
  return paths;
}

function NodeProperties({ node, definition, lookups, disabled, onNode, onEdge, onDelete, flow }) {
  const meta = NODE_META[node.type];
  const config = node.config || {};
  const set = (patch) => onNode({ ...node, config: { ...config, ...patch } });
  const outgoing = definition.edges.filter((edge) => edge.from === node.id);
  const name = (id) => definition.nodes.find((item) => item.id === id)?.name || id;
  const paths = variablePaths(definition);
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className={`u-tile grid h-9 w-9 shrink-0 place-items-center rounded-lg ${meta.tone}`}><Icon name={meta.icon} className="h-[18px] w-[18px]" strokeWidth={1.8} /></span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{meta.label}</p>
          <p className="text-[12.5px] leading-5 text-slate-500">{meta.body}</p>
        </div>
      </div>
      <Field label="Name"><input className={input} disabled={disabled} value={node.name || ''} maxLength={120} onChange={(event) => onNode({ ...node, name: event.target.value })} /></Field>

      {node.type === 'start' && (
        <>
          <Field label="Trigger">
            <select className={input} disabled={disabled} value={config.trigger || 'manual'} onChange={(event) => set({ trigger: event.target.value })}>
              <option value="manual">Manual (Run button or API)</option>
              <option value="schedule">Schedule (cron)</option>
              <option value="webhook">Webhook</option>
            </select>
          </Field>
          {config.trigger === 'schedule' && (
            <>
              <Field label="Cron expression" hint="Minute hour day month weekday, e.g. 0 9 * * 1-5 for 09:00 on weekdays."><input className={`${input} font-mono`} disabled={disabled} value={config.cron || ''} placeholder="0 9 * * 1-5" onChange={(event) => set({ cron: event.target.value })} /></Field>
              <Field label="Time zone"><input className={input} disabled={disabled} value={config.timezone || 'Asia/Kolkata'} onChange={(event) => set({ timezone: event.target.value })} /></Field>
            </>
          )}
          {config.trigger === 'webhook' && (
            <p className="rounded-lg border border-[#ECE8E3] bg-[#FCFBFA] px-3 py-2 text-[12px] leading-5 text-slate-600">
              POST JSON to <code className="font-mono text-[11.5px] text-ink">/api/hooks/flows/{flow.id}</code> with header <code className="font-mono text-[11.5px] text-ink">X-URAP-Flow-Token</code>. The token is shown once when you publish{flow.hasWebhook ? ' (a token already exists; rotate it from the Publish menu)' : ''}. The body becomes the run variables.
            </p>
          )}
        </>
      )}

      {node.type === 'robot' && (
        <>
          <Field label="Workflow" hint={lookups.workflows.length ? 'Only published workflows can run. The flow waits for the job to finish.' : 'This project has no workflows yet.'}>
            <select className={input} disabled={disabled} value={config.workflowId || ''} onChange={(event) => set({ workflowId: event.target.value })}>
              <option value="">Choose a workflow…</option>
              {lookups.workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}{workflow.status !== 'published' ? ` (${workflow.status})` : ''}</option>)}
            </select>
          </Field>
          <Field label="Job input" hint="Values can use templates such as {{vars.amount}}."><KeyValueEditor disabled={disabled} value={config.input || {}} onChange={(value) => set({ input: value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Output variable" hint="Job output"><input className={`${input} font-mono`} disabled={disabled} value={config.outputVar || ''} onChange={(event) => set({ outputVar: event.target.value })} /></Field>
            <Field label="Retries"><input type="number" min={0} max={5} className={input} disabled={disabled} value={config.retries ?? 0} onChange={(event) => set({ retries: Number(event.target.value) })} /></Field>
          </div>
        </>
      )}

      {node.type === 'agent' && (
        <>
          <Field label="Agent" hint={lookups.agents?.length ? 'Only published agents can run. The flow waits for the agent to finish.' : 'This project has no agents yet. Create one in Studio → Agents.'}>
            <select className={input} disabled={disabled} value={config.agentId || ''} onChange={(event) => set({ agentId: event.target.value })}>
              <option value="">Choose an agent…</option>
              {(lookups.agents || []).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}{agent.status !== 'published' ? ` (${agent.status})` : ''}</option>)}
            </select>
          </Field>
          {config.agentId && (() => {
            const agent = (lookups.agents || []).find((item) => item.id === config.agentId);
            const fields = agent?.config?.inputSchema || [];
            return (
              <p className="-mt-1 text-[12px] leading-5 text-slate-500">
                {fields.length ? <>Inputs: {fields.map((field) => <code key={field.name} className="mr-1 rounded bg-[#F6F4F1] px-1 font-mono text-[11.5px] text-ink">{field.name}{field.required ? '*' : ''}</code>)}</> : 'The agent takes free-form input.'}
                {' '}<Link to={`/studio/agents/${config.agentId}`} className="font-semibold text-ember hover:underline">Open agent</Link>
              </p>
            );
          })()}
          <Field label="Agent input" hint="Values can use templates such as {{vars.ticket}}."><KeyValueEditor disabled={disabled} value={config.input || {}} onChange={(value) => set({ input: value })} valuePlaceholder="{{vars.ticket}}" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Output variable" hint="Agent output"><input className={`${input} font-mono`} disabled={disabled} value={config.outputVar || ''} onChange={(event) => set({ outputVar: event.target.value })} /></Field>
            <Field label="Retries"><input type="number" min={0} max={5} className={input} disabled={disabled} value={config.retries ?? 0} onChange={(event) => set({ retries: Number(event.target.value) })} /></Field>
          </div>
        </>
      )}

      {node.type === 'case' && (
        <>
          <Field label="Case type" hint={lookups.caseTypes?.length ? 'Only published case types can open cases.' : 'This project has no case types yet. Create one in Studio → Cases.'}>
            <select className={input} disabled={disabled} value={config.caseTypeId || ''} onChange={(event) => set({ caseTypeId: event.target.value })}>
              <option value="">Choose a case type…</option>
              {(lookups.caseTypes || []).map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== 'published' ? ` (${item.status})` : ''}</option>)}
            </select>
          </Field>
          {config.caseTypeId && (() => {
            const caseType = (lookups.caseTypes || []).find((item) => item.id === config.caseTypeId);
            const fields = caseType?.published?.fields || caseType?.definition?.fields || [];
            return (
              <p className="-mt-1 text-[12px] leading-5 text-slate-500">
                {fields.length ? <>Fields: {fields.map((field) => <code key={field.name} className="mr-1 rounded bg-[#F6F4F1] px-1 font-mono text-[11.5px] text-ink">{field.name}{field.required ? '*' : ''}</code>)}</> : 'This case type has no fields.'}
                {' '}<Link to={`/studio/cases/${config.caseTypeId}`} className="font-semibold text-ember hover:underline">Open case type</Link>
              </p>
            );
          })()}
          <Field label="Case title" hint="Templates allowed. Leave empty for the case reference."><input className={input} disabled={disabled} value={config.title || ''} placeholder="Onboard {{vars.vendorName}}" onChange={(event) => set({ title: event.target.value })} /></Field>
          <Field label="Case fields" hint="Values can use templates such as {{vars.vendor}}."><KeyValueEditor disabled={disabled} value={config.fields || {}} onChange={(value) => set({ fields: value })} valuePlaceholder="{{vars.vendor}}" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <select className={input} disabled={disabled} value={config.priority || ''} onChange={(event) => set({ priority: event.target.value })}>
                <option value="">Case type default</option>
                {['low', 'medium', 'high', 'critical'].map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
              </select>
            </Field>
            <Field label="Output variable" hint="Case id and reference"><input className={`${input} font-mono`} disabled={disabled} value={config.outputVar || ''} onChange={(event) => set({ outputVar: event.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" className="accent-[#F25A1E]" disabled={disabled} checked={Boolean(config.waitForResolution)} onChange={(event) => set({ waitForResolution: event.target.checked })} />
            Wait until the case is resolved
          </label>
        </>
      )}

      {node.type === 'human' && (
        <>
          <Field label="Task title" hint="Shown in Action Center. Templates allowed."><input className={input} disabled={disabled} value={config.title || ''} placeholder="Approve invoice {{vars.invoiceId}}" onChange={(event) => set({ title: event.target.value })} /></Field>
          <Field label="Instructions"><textarea rows={2} className={`${input} resize-none`} disabled={disabled} value={config.description || ''} onChange={(event) => set({ description: event.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Task type">
              <select className={input} disabled={disabled} value={config.taskType || 'approval'} onChange={(event) => set({ taskType: event.target.value })}>
                <option value="approval">Approval</option><option value="form">Form</option><option value="validation">Validation</option>
              </select>
            </Field>
            <Field label="Priority">
              <select className={input} disabled={disabled} value={config.priority || 'medium'} onChange={(event) => set({ priority: event.target.value })}>
                {['low', 'medium', 'high', 'critical'].map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Assign to">
            <select className={input} disabled={disabled} value={config.assigneeUserId ? `user:${config.assigneeUserId}` : config.assignedRole ? `role:${config.assignedRole}` : ''} onChange={(event) => {
              const [kind, id] = event.target.value.split(':');
              set({ assigneeUserId: kind === 'user' ? id : undefined, assignedRole: kind === 'role' ? id : undefined });
            }}>
              <option value="">Anyone who can complete tasks</option>
              <optgroup label="Role">
                {['operator', 'automation_developer', 'project_manager', 'administrator'].map((role) => <option key={role} value={`role:${role}`}>{role.replaceAll('_', ' ')}</option>)}
              </optgroup>
              {lookups.users.length > 0 && <optgroup label="Person">{lookups.users.map((item) => <option key={item.id} value={`user:${item.id}`}>{item.name}{item.email ? ` · ${item.email}` : ''}</option>)}</optgroup>}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Due in (hours)"><input type="number" min={0} className={input} disabled={disabled} value={config.dueInHours ?? ''} onChange={(event) => set({ dueInHours: event.target.value === '' ? undefined : Number(event.target.value) })} /></Field>
            <Field label="Output variable"><input className={`${input} font-mono`} disabled={disabled} value={config.outputVar || ''} onChange={(event) => set({ outputVar: event.target.value })} /></Field>
          </div>
          <Field label="Data shown to the person" hint="Key/value pairs, templates allowed."><KeyValueEditor disabled={disabled} value={config.data || {}} onChange={(value) => set({ data: value })} /></Field>
          <div>
            <span className="mb-1 block text-[12px] font-medium text-slate-600">Form fields</span>
            <FormFieldsEditor disabled={disabled} fields={config.formFields || []} onChange={(value) => set({ formFields: value })} />
            <p className="mt-1 text-[11.5px] text-slate-400">The result is available as {`{{vars.${config.outputVar || 'review'}.outcome}}`} and {`{{vars.${config.outputVar || 'review'}.data.<field>}}`}.</p>
          </div>
        </>
      )}

      {node.type === 'timer' && (
        <Field label="Delay" hint={config.seconds ? `Waits ${formatSeconds(Number(config.seconds))}.` : 'Between 1 second and 30 days.'}>
          <div className="flex gap-1.5">
            <input type="number" min={1} className={input} disabled={disabled} value={config.seconds ?? ''} onChange={(event) => set({ seconds: Number(event.target.value) })} aria-label="Delay in seconds" />
            <select className={`${input} w-28`} disabled={disabled} aria-label="Quick delay" value="" onChange={(event) => event.target.value && set({ seconds: Number(event.target.value) })}>
              <option value="">Preset…</option><option value="30">30 s</option><option value="300">5 min</option><option value="3600">1 hour</option><option value="86400">1 day</option>
            </select>
          </div>
        </Field>
      )}

      {node.type === 'http' && (
        <>
          <Field label="REST API connection" hint={lookups.connections.length ? 'Credentials stay in the connection.' : 'Add a REST API connection to this project in Connections.'}>
            <select className={input} disabled={disabled} value={config.connectionId || ''} onChange={(event) => set({ connectionId: event.target.value })}>
              <option value="">Choose a connection…</option>
              {lookups.connections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <div className="flex gap-1.5">
            <select className={`${input} w-24`} disabled={disabled} value={config.method || 'GET'} aria-label="Method" onChange={(event) => set({ method: event.target.value })}>
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => <option key={method}>{method}</option>)}
            </select>
            <input className={`${input} font-mono`} disabled={disabled} value={config.path || ''} placeholder="/orders/{{vars.orderId}}" aria-label="Path" onChange={(event) => set({ path: event.target.value })} />
          </div>
          {!['GET', 'DELETE'].includes(config.method || 'GET') && <Field label="JSON body"><textarea rows={3} className={`${input} resize-none font-mono text-[12px]`} disabled={disabled} value={typeof config.body === 'string' ? config.body : config.body ? JSON.stringify(config.body, null, 2) : ''} placeholder={'{"id": "{{vars.orderId}}"}'} onChange={(event) => set({ body: event.target.value })} /></Field>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Output variable" hint="{ status, data, headers }"><input className={`${input} font-mono`} disabled={disabled} value={config.outputVar || ''} onChange={(event) => set({ outputVar: event.target.value })} /></Field>
            <Field label="Retries"><input type="number" min={0} max={5} className={input} disabled={disabled} value={config.retries ?? 0} onChange={(event) => set({ retries: Number(event.target.value) })} /></Field>
          </div>
        </>
      )}

      {node.type === 'loop' && (
        <>
          <Field label="Max iterations" hint="The Done connection runs after this many repeats, or sooner if the list or condition ends.">
            <input type="number" min={1} max={50} className={input} disabled={disabled} value={config.maxIterations ?? 3} onChange={(event) => set({ maxIterations: Number(event.target.value) })} />
          </Field>
          <Field label="List to walk (optional)" hint="A variable path such as vars.rows. Each item is stored in the item variable.">
            <input className={`${input} font-mono`} disabled={disabled} value={config.source || ''} placeholder="vars.rows" onChange={(event) => set({ source: event.target.value })} />
          </Field>
          <Field label="Item variable" hint="Set on each repeat when a list is given.">
            <input className={`${input} font-mono`} disabled={disabled} value={config.itemVar || ''} placeholder="item" onChange={(event) => set({ itemVar: event.target.value })} />
          </Field>
          <p className="text-[12.5px] leading-5 text-slate-500">Connect Repeat back to this step, and mark the other connection as Done (the default). The run stops after the limit even if Repeat is still connected.</p>
          <div className="space-y-2">
            {outgoing.map((edge) => (
              <label key={edge.id} className="flex items-center gap-2 rounded-lg border border-[#ECE8E3] bg-[#FCFBFA] px-2.5 py-2 text-[12.5px] text-ink">
                <input type="radio" className="accent-[#D63A0C]" name={`done-${node.id}`} disabled={disabled} checked={Boolean(edge.isDefault)} onChange={() => onEdge({ ...edge, isDefault: true, label: edge.label || 'Done' })} />
                <span className="min-w-0 flex-1">{edge.isDefault ? 'Done' : 'Repeat'} → {name(edge.to)}</span>
              </label>
            ))}
          </div>
        </>
      )}

      {node.type === 'decision' && (
        <div>
          <span className="mb-1.5 block text-[12px] font-medium text-slate-600">Branches (checked in order)</span>
          {outgoing.length === 0 && <p className="text-[12.5px] text-slate-500">Drag from the orange port to another step to add a branch.</p>}
          <div className="space-y-2">
            {outgoing.map((edge) => (
              <BranchEditor key={edge.id} edge={edge} target={name(edge.to)} paths={paths} disabled={disabled} onChange={onEdge} />
            ))}
          </div>
          <datalist id="flow-variable-paths">{paths.map((path) => <option key={path} value={path} />)}</datalist>
        </div>
      )}

      {['parallel', 'join', 'end'].includes(node.type) && <p className="text-[12.5px] leading-5 text-slate-500">{node.type === 'parallel' ? 'Connect two or more steps after this one; they all start together.' : node.type === 'join' ? 'Connect two or more branches into this step. It continues once every branch has arrived.' : 'The run completes when every active branch has reached an End.'}</p>}

      {!disabled && node.type !== 'start' && (
        <button type="button" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-500 hover:text-danger" onClick={onDelete}><Icon name="trash" className="h-3.5 w-3.5" />Delete step</button>
      )}
    </div>
  );
}

function BranchEditor({ edge, target, disabled, onChange, compact = false }) {
  const condition = edge.condition || { left: '', op: 'eq', right: '' };
  const set = (patch) => onChange({ ...edge, ...patch });
  return (
    <div className={`rounded-lg border border-[#ECE8E3] ${compact ? '' : 'bg-[#FCFBFA]'} p-2.5`}>
      <div className="flex items-center gap-1.5">
        <input className={input} disabled={disabled} value={edge.label || ''} placeholder="Branch label" aria-label="Branch label" onChange={(event) => set({ label: event.target.value })} />
        <span className="shrink-0 text-[11.5px] text-slate-400">→ {target}</span>
      </div>
      <label className="mt-1.5 flex items-center gap-1.5 text-[12px] text-slate-600"><input type="checkbox" className="accent-[#D63A0C]" disabled={disabled} checked={Boolean(edge.isDefault)} onChange={(event) => set({ isDefault: event.target.checked, condition: event.target.checked ? null : condition })} />Default branch (when nothing else matches)</label>
      {!edge.isDefault && (
        <div className="mt-1.5 space-y-1.5">
          <input className={`${input} font-mono text-[12px]`} list="flow-variable-paths" disabled={disabled} value={condition.left} placeholder="vars.review.outcome" aria-label="Variable" onChange={(event) => set({ condition: { ...condition, left: event.target.value } })} />
          <div className="flex gap-1.5">
            <select className={`${input} w-[46%]`} disabled={disabled} value={condition.op} aria-label="Operator" onChange={(event) => set({ condition: { ...condition, op: event.target.value } })}>
              {OPERATORS.map((op) => <option key={op} value={op}>{OP_LABELS[op]}</option>)}
            </select>
            {!['empty', 'not_empty'].includes(condition.op) && <input className={input} disabled={disabled} value={condition.right ?? ''} placeholder="approve" aria-label="Value" onChange={(event) => set({ condition: { ...condition, right: event.target.value } })} />}
          </div>
        </div>
      )}
    </div>
  );
}

function VariablesPanel({ definition, disabled, onChange }) {
  const variables = definition.variables || [];
  const set = (next) => onChange({ ...definition, variables: next });
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink">Flow variables</p>
      <p className="mt-0.5 text-[12px] leading-5 text-slate-500">Inputs for each run, with defaults. Steps read them as <code className="font-mono text-[11.5px]">{'{{vars.name}}'}</code> and write their results into output variables.</p>
      <div className="mt-3 space-y-1.5">
        {variables.map((item, index) => (
          <div key={index} className="flex gap-1.5">
            <input className={`${input} font-mono text-[12px]`} disabled={disabled} value={item.name} placeholder="name" aria-label="Variable name" onChange={(event) => set(variables.map((row, i) => (i === index ? { ...row, name: event.target.value } : row)))} />
            <input className={input} disabled={disabled} value={item.defaultValue ?? ''} placeholder="default" aria-label={`Default for ${item.name}`} onChange={(event) => set(variables.map((row, i) => (i === index ? { ...row, defaultValue: event.target.value } : row)))} />
            {!disabled && <button type="button" className="grid w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-[#F6F4F1] hover:text-danger" aria-label={`Remove ${item.name}`} onClick={() => set(variables.filter((_, i) => i !== index))}><Icon name="close" className="h-3.5 w-3.5" /></button>}
          </div>
        ))}
        {!disabled && <button type="button" className="text-[12.5px] font-semibold text-ember hover:underline" onClick={() => set([...variables, { name: `var${variables.length + 1}`, defaultValue: '' }])}>+ Add variable</button>}
      </div>
    </div>
  );
}

function RunsPanel({ flowId, refreshKey }) {
  const [runs, setRuns] = useState(null);
  useEffect(() => { api(`/api/flow-runs?flowId=${flowId}&limit=15`).then((result) => setRuns(result.data)).catch(() => setRuns([])); }, [flowId, refreshKey]);
  if (!runs) return <div className="space-y-2" aria-hidden="true">{[0, 1, 2].map((key) => <div key={key} className="h-10 animate-pulse rounded-lg bg-[#F6F4F1]" />)}</div>;
  if (!runs.length) return <p className="py-6 text-center text-[13px] text-slate-500">No runs yet. Publish the flow and press Run.</p>;
  return (
    <ul className="-mx-2 divide-y divide-[#F1EEEA]">
      {runs.map((run) => (
        <li key={run.id}>
          <Link to={`/studio/flows/${flowId}/runs/${run.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-[#FAF9F7]">
            <StatusPill status={run.status} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-600">v{run.versionNumber} · {run.triggerSource}</span>
            <span className="shrink-0 text-[12px] text-slate-400">{timeAgo(run.startedAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RunDialog({ flow, onClose, onStarted }) {
  const variables = flow.definition?.variables || [];
  const [values, setValues] = useState(() => Object.fromEntries(variables.map((item) => [item.name, item.defaultValue ?? ''])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector('input, button[type="submit"]')?.focus();
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    const inputValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value !== '' && !Number.isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(String(value)) ? Number(value) : value]));
    try {
      const result = await api(`/api/flows/${flow.id}/run`, { method: 'POST', body: { input: inputValues } });
      onStarted(result.data);
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-navy-950/35 p-4 pt-[12vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form ref={ref} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="run-title" className="w-full max-w-[440px] rounded-2xl u-card shadow-[0_24px_64px_-20px_rgba(16,24,40,0.3)]">
        <div className="px-6 pb-4 pt-5">
          <h2 id="run-title" className="text-[17px] font-semibold tracking-tight text-ink">Run {flow.name}</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">Runs published version {flow.versionNumber}.{variables.length ? ' Set the input variables.' : ''}</p>
        </div>
        {variables.length > 0 && (
          <div className="space-y-3 border-t border-[#ECE8E3] px-6 py-4">
            {variables.map((item) => <Field key={item.name} label={item.name}><input className={input} value={values[item.name] ?? ''} onChange={(event) => setValues({ ...values, [item.name]: event.target.value })} /></Field>)}
          </div>
        )}
        {error && <p className="mx-6 mb-3 rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-[#ECE8E3] px-6 py-4">
          <button type="button" className={secondaryBtn} onClick={onClose}>Cancel</button>
          <button type="submit" className={primaryBtn} disabled={busy}><Icon name="play" className="h-3.5 w-3.5" />{busy ? 'Starting…' : 'Start run'}</button>
        </div>
      </form>
    </div>
  );
}

export default function FlowEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = currentUser();
  const writable = canWrite(user?.role);
  const [flow, setFlow] = useState(null);
  const [definition, setDefinition] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState(null);
  const [serverIssues, setServerIssues] = useState([]);
  const [lookups, setLookups] = useState({ workflows: [], agents: [], connections: [], users: [], caseTypes: [] });
  const [panel, setPanel] = useState('properties');
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState('');
  const [showIssues, setShowIssues] = useState(false);
  const [running, setRunning] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    let alive = true;
    api(`/api/flows/${id}`).then(async (result) => {
      if (!alive) return;
      const data = result.data;
      setFlow(data); setDefinition(data.definition); setName(data.name); setServerIssues(data.validation?.errors || []);
      const get = (path) => api(path).then((value) => value.data).catch(() => []);
      const [workflows, connections, members, users, agents, caseTypes] = await Promise.all([
        get(`/api/workflows?projectId=${data.projectId}&limit=100`),
        get(`/api/projects/${data.projectId}/connections`),
        get(`/api/projects/${data.projectId}/members`),
        user?.role === 'administrator' ? get('/api/users') : Promise.resolve([]),
        get(`/api/agents?projectId=${data.projectId}&limit=100`),
        get(`/api/case-types?projectId=${data.projectId}&limit=100&published=1`),
      ]);
      if (!alive) return;
      const people = new Map();
      for (const item of users || []) if (item.status !== 'disabled') people.set(item.id, { id: item.id, name: item.displayName || item.email, email: item.email });
      for (const item of members || []) people.set(item.user_id, { id: item.user_id, name: item.display_name || item.email, email: item.email });
      setLookups({ workflows, agents, caseTypes, connections: connections.filter((item) => item.connectorType === 'rest_api'), users: [...people.values()] });
    }).catch((err) => setError(err.message));
    return () => { alive = false; };
  }, [id]);

  const local = useMemo(() => (definition ? validateDefinition(definition) : { errors: [], warnings: [] }), [definition]);
  const issues = useMemo(() => {
    const seen = new Set(local.errors.map((item) => item.message));
    return [...local.errors, ...serverIssues.filter((item) => !seen.has(item.message))];
  }, [local, serverIssues]);
  const problems = useMemo(() => problemMap(issues), [issues]);

  const change = useCallback((next) => { setDefinition(next); setDirty(true); setServerIssues([]); }, []);
  const selectedNode = selected?.kind === 'node' ? definition?.nodes.find((node) => node.id === selected.id) : null;
  const selectedEdge = selected?.kind === 'edge' ? definition?.edges.find((edge) => edge.id === selected.id) : null;

  const remove = useCallback(() => {
    if (!definition || !selected || !writable) return;
    if (selected.kind === 'node') {
      const node = definition.nodes.find((item) => item.id === selected.id);
      if (!node || node.type === 'start') return;
      change({ ...definition, nodes: definition.nodes.filter((item) => item.id !== node.id), edges: definition.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id) });
    } else {
      change({ ...definition, edges: definition.edges.filter((edge) => edge.id !== selected.id) });
    }
    setSelected(null);
  }, [definition, selected, writable, change]);

  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected) { event.preventDefault(); remove(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save() {
    if (!writable || !definition) return null;
    setBusy('save'); setError('');
    try {
      if (name.trim() && name.trim() !== flow.name) await api(`/api/flows/${id}`, { method: 'PATCH', body: { name: name.trim() } });
      const result = await api(`/api/flows/${id}/draft`, { method: 'PUT', body: { definition } });
      setFlow(result.data); setServerIssues(result.data.validation?.errors || []); setDirty(false);
      setNotice({ tone: 'ok', text: 'Draft saved.' });
      return result.data;
    } catch (err) { setError(err.message); return null; } finally { setBusy(''); }
  }

  async function publish() {
    const saved = dirty || name.trim() !== flow.name ? await save() : flow;
    if (!saved) return;
    setBusy('publish'); setError('');
    try {
      const result = await api(`/api/flows/${id}/publish`, { method: 'POST' });
      setFlow(result.data); setServerIssues([]);
      setNotice(result.data.webhookToken
        ? { tone: 'ok', text: `Published version ${result.data.versionNumber}. Webhook token (shown once):`, token: result.data.webhookToken }
        : { tone: 'ok', text: `Published version ${result.data.versionNumber}.` });
    } catch (err) {
      setServerIssues(Array.isArray(err.details) ? err.details : []);
      setShowIssues(true);
      setError(Array.isArray(err.details) && err.details.length ? 'Fix the issues below before publishing.' : err.message);
    } finally { setBusy(''); }
  }

  const addNode = (type, x, y) => {
    if (!writable) return;
    const position = x == null ? nextPosition(definition) : { x, y };
    const node = newNode(type, position.x, position.y, definition);
    change({ ...definition, nodes: [...definition.nodes, node] });
    setSelected({ kind: 'node', id: node.id });
    setPanel('properties');
  };

  if (error && !flow) return <div className="mx-auto max-w-xl px-6 py-20 text-center"><p className="text-[15px] font-semibold text-ink">Could not open the flow</p><p className="mt-1 text-[13px] text-slate-500">{error}</p><Link to="/studio?view=flows" className="mt-4 inline-block text-[13px] font-semibold text-ember">Back to Studio</Link></div>;
  if (!flow || !definition) return <div className="grid h-[calc(100vh-3.5rem)] place-items-center text-[13px] text-slate-500" role="status">Loading flow…</div>;

  const published = flow.status === 'published';
  const statusLabel = dirty ? 'Unsaved changes' : flow.currentVersionId ? `v${flow.versionNumber}` : null;
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[#ECE8E3] bg-white px-4">
        <Link to="/studio?view=flows" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Back to flows"><Icon name="chevronRight" className="h-4 w-4 rotate-180" /></Link>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#FFF1EC] text-ember u-tile"><Icon name="flow" className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0">
          <p className="truncate text-[11.5px] leading-4 text-slate-500">{flow.projectName} · Flow</p>
          <input className="-ml-1 w-[min(34vw,360px)] rounded-md border border-transparent bg-transparent px-1 text-[14.5px] font-semibold leading-5 text-ink hover:border-[#ECE8E3] focus:border-ember focus:outline-none disabled:hover:border-transparent" value={name} disabled={!writable} aria-label="Flow name" onChange={(event) => { setName(event.target.value); setDirty(true); }} />
        </div>
        <StatusPill status={flow.status} />
        {statusLabel && <span className={`text-[12px] ${dirty ? 'font-medium text-[#8A5A0B]' : 'text-slate-400'}`}>{statusLabel}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold ${issues.length ? 'bg-[#FDEEEC] text-[#A8261B] hover:bg-[#FBE2DE]' : 'bg-[#ECF7EF] text-[#1F6B3A]'}`} aria-expanded={showIssues} onClick={() => setShowIssues((value) => !value)}>
            <Icon name={issues.length ? 'alert' : 'check'} className="h-3.5 w-3.5" strokeWidth={2.2} />{issues.length ? `${issues.length} issue${issues.length === 1 ? '' : 's'}` : 'Valid'}
          </button>
          <div className="flex items-center rounded-lg border border-[#ECE8E3] bg-white">
            <button type="button" className="grid h-8 w-8 place-items-center text-slate-500 hover:text-ink" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.5, +(value - 0.1).toFixed(2)))}><Icon name="zoomOut" className="h-4 w-4" /></button>
            <span className="w-11 text-center text-[12px] tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span>
            <button type="button" className="grid h-8 w-8 place-items-center text-slate-500 hover:text-ink" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.5, +(value + 0.1).toFixed(2)))}><Icon name="zoomIn" className="h-4 w-4" /></button>
          </div>
          {writable && <button type="button" className={secondaryBtn} disabled={busy !== '' || (!dirty && name.trim() === flow.name)} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}
          {writable && <button type="button" className={secondaryBtn} disabled={busy !== '' || local.errors.length > 0} title={local.errors.length ? 'Fix the issues before publishing' : undefined} onClick={publish}><Icon name="upload" className="h-3.5 w-3.5" />{busy === 'publish' ? 'Publishing…' : 'Publish'}</button>}
          {canRun(user?.role) && <button type="button" className={primaryBtn} disabled={!published || dirty} title={!published ? 'Publish the flow first' : dirty ? 'Save and publish your changes first' : undefined} onClick={() => setRunning(true)}><Icon name="play" className="h-3.5 w-3.5" />Run</button>}
        </div>
      </div>

      {(notice || error) && (
        <div className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-2 text-[13px] ${error ? 'border-[#F4C7C1] bg-[#FEF3F2] text-danger' : 'border-[#CDE9D6] bg-[#F2FAF4] text-ink'}`} role={error ? 'alert' : 'status'}>
          <span className="font-medium">{error || notice.text}</span>
          {!error && notice.token && <code className="select-all rounded bg-white px-2 py-0.5 font-mono text-[12px] text-ink ring-1 ring-[#CDE9D6]">{notice.token}</code>}
          <button type="button" className="ml-auto text-slate-500 hover:text-ink" aria-label="Dismiss" onClick={() => { setNotice(null); setError(''); }}><Icon name="close" className="h-4 w-4" /></button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[232px] shrink-0 overflow-y-auto border-r border-[#ECE8E3] bg-white px-3 py-4 md:block" aria-label="Steps palette">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Add a step</p>
          <p className="mt-1 px-1 text-[11.5px] leading-4 text-slate-400">Drag onto the canvas, or click to add.</p>
          {PALETTE.map(([group, types]) => (
            <div key={group} className="mt-4">
              <p className="mb-1.5 px-1 text-[11px] font-medium text-slate-400">{group}</p>
              <ul className="space-y-1">
                {types.map((type) => {
                  const meta = NODE_META[type];
                  return (
                    <li key={type}>
                      <button type="button" draggable={writable} disabled={!writable} onDragStart={(event) => { event.dataTransfer.setData('application/x-urap-flow-node', type); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => addNode(type)} className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:border-[#ECE8E3] hover:bg-[#FAF9F7] disabled:cursor-not-allowed disabled:opacity-60" title={meta.body}>
                        <span className={`u-tile grid h-7 w-7 shrink-0 place-items-center rounded-md ${meta.tone}`}><Icon name={meta.icon} className="h-4 w-4" strokeWidth={1.8} /></span>
                        <span className="min-w-0"><span className="block text-[13px] font-medium text-ink">{meta.label}</span></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <div className="mt-6 rounded-lg border border-[#ECE8E3] bg-[#FCFBFA] p-3 text-[11.5px] leading-[17px] text-slate-500">
            <p className="font-semibold text-slate-600">Tips</p>
            <p className="mt-1">Drag from a step’s orange port to connect it. Select a step or connection and press Delete to remove it. Arrow keys nudge the selected step.</p>
          </div>
        </aside>

        <div className="relative min-w-0 flex-1">
          <FlowCanvas
            definition={definition}
            editable={writable}
            selected={selected}
            onSelect={(value) => { setSelected(value); if (value) setPanel('properties'); }}
            onChange={change}
            onDropNode={addNode}
            problems={problems}
            lookups={lookups}
            zoom={zoom}
            fitKey={flow.id}
            onZoom={setZoom}
          />
          {showIssues && (
            <div className="absolute inset-x-4 bottom-4 max-h-[40%] overflow-y-auto rounded-xl u-card shadow-[0_16px_40px_-16px_rgba(16,24,40,0.22)]" role="region" aria-label="Validation issues">
              <div className="flex items-center justify-between border-b border-[#ECE8E3] px-4 py-2.5">
                <p className="text-[13px] font-semibold text-ink">{issues.length ? `${issues.length} issue${issues.length === 1 ? '' : 's'} to fix before publishing` : 'No issues. The flow is ready to publish.'}</p>
                <button type="button" className="text-slate-400 hover:text-ink" aria-label="Close issues" onClick={() => setShowIssues(false)}><Icon name="close" className="h-4 w-4" /></button>
              </div>
              <ul className="divide-y divide-[#F4F1EE]">
                {issues.map((item, index) => (
                  <li key={index}>
                    <button type="button" className="flex w-full items-start gap-2.5 px-4 py-2 text-left text-[13px] hover:bg-[#FAF9F7]" onClick={() => item.nodeId ? setSelected({ kind: 'node', id: item.nodeId }) : item.edgeId && setSelected({ kind: 'edge', id: item.edgeId })}>
                      <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#D9382B]" strokeWidth={2.2} />
                      <span className="text-ink">{item.message}</span>
                    </button>
                  </li>
                ))}
                {local.warnings.map((item, index) => (
                  <li key={`w${index}`} className="flex items-start gap-2.5 px-4 py-2 text-[13px] text-slate-600"><Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#D99A1E]" />{item.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-[#ECE8E3] bg-white" aria-label="Properties">
          <div className="sticky top-0 z-10 flex gap-5 border-b border-[#ECE8E3] bg-white px-5" role="tablist" aria-label="Editor panels">
            {[['properties', selectedNode || selectedEdge ? 'Properties' : 'Flow'], ['runs', 'Runs']].map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={panel === key} onClick={() => setPanel(key)} className={`-mb-px border-b-2 py-3 text-[13px] font-semibold ${panel === key ? 'border-ember text-ink' : 'border-transparent text-slate-500 hover:text-ink'}`}>{label}</button>
            ))}
          </div>
          <div className="px-5 py-4">
            {panel === 'runs' ? <RunsPanel flowId={flow.id} refreshKey={flow.updatedAt} /> : selectedNode ? (
              <NodeProperties
                node={selectedNode}
                definition={definition}
                lookups={lookups}
                flow={flow}
                disabled={!writable}
                onNode={(node) => change({ ...definition, nodes: definition.nodes.map((item) => (item.id === node.id ? node : item)) })}
                onEdge={(edge) => change({
                  ...definition,
                  edges: definition.edges.map((item) => {
                    if (item.id === edge.id) return edge;
                    if (edge.isDefault && item.from === edge.from && definition.nodes.find((node) => node.id === edge.from)?.type === 'loop') return { ...item, isDefault: false };
                    return item;
                  }),
                })}
                onDelete={remove}
              />
            ) : selectedEdge ? (
              <div className="space-y-3">
                <p className="text-[13px] font-semibold text-ink">Connection</p>
                <p className="text-[12.5px] text-slate-500">{definition.nodes.find((node) => node.id === selectedEdge.from)?.name} → {definition.nodes.find((node) => node.id === selectedEdge.to)?.name}</p>
                {definition.nodes.find((node) => node.id === selectedEdge.from)?.type === 'decision' && (
                  <>
                    <BranchEditor edge={selectedEdge} target={definition.nodes.find((node) => node.id === selectedEdge.to)?.name} disabled={!writable} compact onChange={(edge) => change({ ...definition, edges: definition.edges.map((item) => (item.id === edge.id ? edge : item)) })} />
                    <datalist id="flow-variable-paths">{variablePaths(definition).map((path) => <option key={path} value={path} />)}</datalist>
                  </>
                )}
                {writable && <button type="button" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-500 hover:text-danger" onClick={remove}><Icon name="trash" className="h-3.5 w-3.5" />Delete connection</button>}
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <p className="text-[13px] font-semibold text-ink">{flow.name}</p>
                  <p className="mt-0.5 text-[12px] leading-5 text-slate-500">{definition.nodes.length} steps · {definition.edges.length} connections{flow.currentVersionId ? ` · published v${flow.versionNumber}` : ' · never published'}</p>
                  {flow.lastRun && <Link to={`/studio/flows/${flow.id}/runs/${flow.lastRun.id}`} className="mt-2 inline-flex items-center gap-2 text-[12.5px] font-medium text-slate-600 hover:text-ember">Last run <StatusPill status={flow.lastRun.status} /></Link>}
                </div>
                <VariablesPanel definition={definition} disabled={!writable} onChange={change} />
                <p className="text-[12px] leading-5 text-slate-400">Select a step to edit it. Steps: {Object.entries(NODE_META).filter(([type]) => type !== 'start').map(([, meta]) => meta.label).join(', ')}.</p>
              </div>
            )}
          </div>
        </aside>
      </div>
      {running && <RunDialog flow={flow} onClose={() => setRunning(false)} onStarted={(run) => navigate(`/studio/flows/${flow.id}/runs/${run.id}`)} />}
    </div>
  );
}

function nextPosition(definition) {
  const maxX = Math.max(...definition.nodes.filter((node) => node.type !== 'end').map((node) => node.x), 0);
  const ys = definition.nodes.map((node) => node.y);
  return { x: maxX + NODE_W + 60, y: ys.length ? Math.min(...ys) + NODE_H + 80 : 200 };
}
