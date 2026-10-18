import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, currentUser } from '../services/api.js';
import { Icon } from '../components/brand.jsx';
import BpmnCanvas, { saveBlob, svgToPng } from '../components/BpmnCanvas.jsx';
import { LANE_ROLES, compileBpmn, conditionText, isoDurationSeconds, mapFlowIssues } from '../lib/bpmnCompile.js';
import { validateDefinition } from '../lib/flowDefinition.js';
import { formatSeconds } from '../components/FlowCanvas.jsx';
import { Field, FormFieldsEditor, KeyValueEditor, OP_LABELS } from './FlowEditorPage.jsx';
import { StatusPill } from './HomePage.jsx';
import { timeAgo } from '../layouts/CloudLayout.jsx';

// BPMN modeler: the bpmn-js canvas (palette, context pad, replace menu, pools and lanes) with a
// URAP properties panel that writes urap: attributes into the BPMN XML, live validation that
// marks problem elements on the canvas, draft save, publish (compiles to a Flow version), runs,
// .bpmn import, and BPMN / SVG / PNG export.

const canWrite = (role) => ['administrator', 'project_manager', 'automation_developer'].includes(role);
const canPublish = canWrite;
const canRun = (role) => ['administrator', 'project_manager', 'automation_developer', 'operator'].includes(role);
const input = 'w-full rounded-lg border border-[#E2DCD5] bg-white px-2.5 py-1.5 text-[13px] text-ink placeholder:text-slate-400 focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:bg-[#FAF9F7] disabled:text-slate-500';
const secondaryBtn = 'u-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const primaryBtn = 'u-btn-primary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-60';
const ROLE_LABELS = { administrator: 'Administrator', project_manager: 'Project manager', automation_developer: 'Automation developer', operator: 'Operator' };
const SERVICE_TYPES = [['workflow', 'Robot workflow', 'Runs a published RPA or API workflow as a job'], ['agent', 'AI agent', 'Runs a published agent and stores its answer'], ['http', 'API call', 'Calls a REST API connection'], ['case', 'Case', 'Opens a case of a published case type']];

export const ELEMENT_INFO = {
  'bpmn:Process': ['Process', 'bpmn'], 'bpmn:Collaboration': ['Collaboration', 'bpmn'], 'bpmn:Participant': ['Pool', 'table'], 'bpmn:Lane': ['Lane', 'list'],
  'bpmn:StartEvent': ['Start event', 'startNode'], 'bpmn:EndEvent': ['End event', 'endNode'], 'bpmn:IntermediateCatchEvent': ['Intermediate event', 'clock'],
  'bpmn:UserTask': ['User task', 'human'], 'bpmn:ManualTask': ['Manual task', 'human'], 'bpmn:ServiceTask': ['Service task', 'robot'], 'bpmn:Task': ['Task', 'card'],
  'bpmn:ExclusiveGateway': ['Exclusive gateway', 'decision'], 'bpmn:ParallelGateway': ['Parallel gateway', 'parallel'], 'bpmn:SubProcess': ['Subprocess', 'grid'],
  'bpmn:SequenceFlow': ['Sequence flow', 'arrow'], 'bpmn:TextAnnotation': ['Annotation', 'text'], 'bpmn:Group': ['Group', 'grid'],
};

/** Input variables a run needs: vars.* the diagram reads that no step produces. */
export function inputVariables(definition) {
  if (!definition) return [];
  const produced = new Set(definition.nodes.map((node) => node.config?.outputVar).filter(Boolean));
  const found = new Set();
  for (const match of JSON.stringify({ nodes: definition.nodes, edges: definition.edges }).matchAll(/vars\.([A-Za-z_][A-Za-z0-9_]*)/g)) if (!produced.has(match[1])) found.add(match[1]);
  return [...found];
}

/** Validation for the current XML: compile + flow rules (+ project lookups when loaded). */
export function validateXml(xml, lookups = null) {
  const compiled = compileBpmn(xml);
  const flow = compiled.definition && !compiled.errors.length ? validateDefinition(compiled.definition, lookups) : { errors: [], warnings: [] };
  const compileIds = new Set(compiled.errors.map((item) => item.elementId).filter(Boolean));
  const seen = new Set();
  const unique = (items) => items.filter((item) => { const key = `${item.elementId || ''}|${item.message}`; if (seen.has(key)) return false; seen.add(key); return true; });
  return {
    compiled,
    errors: unique([...compiled.errors, ...mapFlowIssues(flow.errors, compiled.definition).filter((item) => !item.elementId || !compileIds.has(item.elementId))]),
    warnings: unique([...compiled.warnings, ...mapFlowIssues(flow.warnings, compiled.definition)]),
  };
}

const slug = (name) => String(name || 'process').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'process';
const typeOf = (element) => element?.businessObject?.$type || element?.type || '';
const eventKind = (bo) => {
  const type = bo?.eventDefinitions?.[0]?.$type || '';
  return type ? type.replace('bpmn:', '').replace('EventDefinition', '').toLowerCase() : 'none';
};

function Section({ title, children }) {
  return (
    <div className="space-y-3 border-t border-[#F1EEEA] pt-4">
      {title && <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{title}</p>}
      {children}
    </div>
  );
}

function Hint({ children, tone = 'info' }) {
  const tones = { info: 'border-[#E4ECF7] bg-[#F5F8FD] text-[#2F5FA8]', warn: 'border-[#F3E2C2] bg-[#FDF8EE] text-[#8A5A0B]', error: 'border-[#F4C7C1] bg-[#FEF3F2] text-danger' };
  return <div className={`rounded-lg border px-3 py-2 text-[12.5px] leading-5 ${tones[tone]}`}>{children}</div>;
}

/** URAP properties for the selected BPMN element. Writes urap: attributes through bpmn-js modeling (undoable). */
export function BpmnProperties({ element, modeler, lookups, disabled, problems = [], definition, process, onSelectElement }) {
  const bo = element?.businessObject;
  const type = typeOf(element);
  const services = modeler ? { modeling: modeler.get('modeling'), moddle: modeler.get('moddle'), replace: modeler.get('bpmnReplace'), registry: modeler.get('elementRegistry'), selection: modeler.get('selection') } : null;
  const get = (key) => bo?.get(`urap:${key}`) ?? '';
  const set = (patch) => {
    if (!services || disabled) return;
    const props = {};
    for (const [key, value] of Object.entries(patch)) props[key === 'name' ? 'name' : `urap:${key}`] = value === '' || value === null ? undefined : value;
    services.modeling.updateProperties(element, props);
  };
  const json = (key, fallback) => { try { return get(key) ? JSON.parse(get(key)) : fallback; } catch { return fallback; } };
  const replaceWith = (target) => {
    if (!services || disabled) return;
    const next = services.replace.replaceElement(element, target);
    if (next) services.selection.select(next);
  };
  const setExpression = (definitionBo, key, body) => {
    if (!services || disabled) return;
    services.modeling.updateModdleProperties(element, definitionBo, { [key]: body ? services.moddle.create('bpmn:FormalExpression', { body }) : undefined });
  };
  const myProblems = problems.filter((item) => element && item.elementId === element.id);

  if (!element) {
    const lanes = definition?.bpmn?.lanes || [];
    const counts = definition ? definition.nodes.reduce((acc, node) => ({ ...acc, [node.type]: (acc[node.type] || 0) + 1 }), {}) : {};
    return (
      <div className="space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Process</p>
          <p className="mt-1 text-[13px] leading-5 text-slate-600">Select an element on the canvas to edit how it runs. Use the palette on the left to add events, tasks, gateways, pools, and lanes; the wrench on an element changes its type.</p>
        </div>
        <Section title="How it starts">
          <p className="text-[13px] text-ink">{process?.trigger?.type === 'schedule' ? `On a schedule (${process.trigger.cron || 'set the timer cycle'}, ${process.trigger.timezone})` : process?.trigger?.type === 'webhook' ? 'When another system calls its webhook (message start event)' : 'Manually, from the Run button or the API (none start event)'}</p>
        </Section>
        {definition && (
          <Section title="What runs">
            <ul className="grid grid-cols-2 gap-2 text-[12.5px] text-slate-600">
              {[['human', 'User tasks'], ['robot', 'Robot workflows'], ['agent', 'AI agents'], ['http', 'API calls'], ['case', 'Cases'], ['decision', 'Decisions'], ['parallel', 'Parallel splits'], ['timer', 'Timers']].filter(([key]) => counts[key]).map(([key, label]) => (
                <li key={key} className="flex items-center justify-between rounded-lg border border-[#F1EEEA] bg-[#FCFBFA] px-2.5 py-1.5"><span>{label}</span><span className="font-semibold tabular-nums text-ink">{counts[key]}</span></li>
              ))}
            </ul>
          </Section>
        )}
        {lanes.length > 0 && (
          <Section title="Lanes">
            <ul className="space-y-1.5 text-[12.5px]">
              {lanes.map((lane) => (
                <li key={lane.id}><button type="button" className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left hover:bg-[#F6F4F1]" onClick={() => onSelectElement?.(lane.id)}><span className="font-medium text-ink">{lane.name || lane.id}</span><span className="text-slate-500">{lane.role ? ROLE_LABELS[lane.role] : 'Anyone'}</span></button></li>
              ))}
            </ul>
            <p className="text-[11.5px] leading-4 text-slate-400">User tasks in a lane go to the lane's role unless the task names its own assignee.</p>
          </Section>
        )}
      </div>
    );
  }

  const [label, icon] = ELEMENT_INFO[type] || [type.replace('bpmn:', ''), 'card'];
  const supportedTask = ['bpmn:UserTask', 'bpmn:ManualTask', 'bpmn:ServiceTask'].includes(type);
  const lane = services && bo?.$instanceOf?.('bpmn:FlowNode') ? services.registry.filter((item) => item.type === 'bpmn:Lane' && (item.businessObject.flowNodeRef || []).includes(bo))[0]?.businessObject : null;
  const nameEditable = !['bpmn:Process', 'bpmn:Collaboration'].includes(type);
  const serviceType = get('serviceType') || 'workflow';
  const kind = eventKind(bo);
  const eventDefinition = bo?.eventDefinitions?.[0];

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="u-tile grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#FFF1EC] text-ember"><Icon name={icon} className="h-[18px] w-[18px]" strokeWidth={1.8} /></span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
          <p className="truncate font-mono text-[11.5px] text-slate-400">{element.id}</p>
        </div>
      </div>
      {myProblems.map((item, index) => <Hint key={index} tone="error">{item.message}</Hint>)}
      {nameEditable && <Field label={type === 'bpmn:TextAnnotation' ? 'Text' : 'Name'}>
        {type === 'bpmn:TextAnnotation'
          ? <textarea rows={3} className={`${input} resize-none`} disabled={disabled} value={bo.text || ''} onChange={(event) => services?.modeling.updateProperties(element, { text: event.target.value })} />
          : <input className={input} disabled={disabled} value={bo.name || ''} maxLength={120} onChange={(event) => set({ name: event.target.value })} />}
      </Field>}

      {type === 'bpmn:Lane' && (
        <Section title="Who works in this lane">
          <Field label="Role" hint="User tasks in this lane are assigned to this role in Action Center.">
            <select className={input} disabled={disabled} value={get('role')} onChange={(event) => set({ role: event.target.value })}>
              <option value="">Anyone who can complete tasks</option>
              {LANE_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
            </select>
          </Field>
          {lookups.users.length > 0 && (
            <Field label="Or a person" hint="Overrides the role.">
              <select className={input} disabled={disabled} value={get('assigneeUserId')} onChange={(event) => set({ assigneeUserId: event.target.value })}>
                <option value="">Nobody in particular</option>
                {lookups.users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
          )}
        </Section>
      )}

      {type === 'bpmn:Participant' && <Hint>Pools group the process. Only one pool may contain steps; other pools can stay empty to show external parties (message flows between pools are documentation).</Hint>}

      {(type === 'bpmn:UserTask' || type === 'bpmn:ManualTask') && (
        <Section title="Action Center task">
          <Field label="Task title" hint="Templates allowed, such as {{vars.amount}}. Defaults to the name."><input className={input} disabled={disabled} value={get('title')} placeholder={bo.name || 'Review required'} onChange={(event) => set({ title: event.target.value })} /></Field>
          <Field label="Instructions"><textarea rows={2} className={`${input} resize-none`} disabled={disabled} value={get('description')} onChange={(event) => set({ description: event.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Task type">
              <select className={input} disabled={disabled} value={get('taskType') || 'approval'} onChange={(event) => set({ taskType: event.target.value })}>
                <option value="approval">Approval</option><option value="form">Form</option><option value="validation">Validation</option>
              </select>
            </Field>
            <Field label="Priority">
              <select className={input} disabled={disabled} value={get('priority') || 'medium'} onChange={(event) => set({ priority: event.target.value })}>
                {['low', 'medium', 'high', 'critical'].map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Assign to" hint={!get('assignedRole') && !get('assigneeUserId') && lane ? `From the ${lane.name || 'lane'} lane: ${lane.get('urap:role') ? ROLE_LABELS[lane.get('urap:role')] : 'anyone'}.` : undefined}>
            <select className={input} disabled={disabled} value={get('assigneeUserId') ? `user:${get('assigneeUserId')}` : get('assignedRole') ? `role:${get('assignedRole')}` : ''} onChange={(event) => {
              const [k, id] = event.target.value.split(':');
              set({ assigneeUserId: k === 'user' ? id : '', assignedRole: k === 'role' ? id : '' });
            }}>
              <option value="">{lane ? 'Use the lane' : 'Anyone who can complete tasks'}</option>
              <optgroup label="Role">{LANE_ROLES.map((role) => <option key={role} value={`role:${role}`}>{ROLE_LABELS[role]}</option>)}</optgroup>
              {lookups.users.length > 0 && <optgroup label="Person">{lookups.users.map((item) => <option key={item.id} value={`user:${item.id}`}>{item.name}</option>)}</optgroup>}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Due in (hours)"><input type="number" min={0} className={input} disabled={disabled} value={get('dueInHours')} onChange={(event) => set({ dueInHours: event.target.value })} /></Field>
            <Field label="Result variable"><input className={`${input} font-mono`} disabled={disabled} value={get('outputVar')} placeholder={definition?.nodes.find((node) => node.id === element.id)?.config?.outputVar || 'review'} onChange={(event) => set({ outputVar: event.target.value })} /></Field>
          </div>
          {(get('taskType') === 'form' || json('formFields', []).length > 0) && (
            <div>
              <span className="mb-1 block text-[12px] font-medium text-slate-600">Form fields</span>
              <FormFieldsEditor disabled={disabled} fields={json('formFields', [])} onChange={(value) => set({ formFields: value.length ? JSON.stringify(value) : '' })} />
            </div>
          )}
          <p className="text-[11.5px] leading-4 text-slate-400">Later steps read <code className="font-mono">vars.{get('outputVar') || definition?.nodes.find((node) => node.id === element.id)?.config?.outputVar || 'review'}.outcome</code> (approve / reject) and <code className="font-mono">.data</code>.</p>
        </Section>
      )}

      {type === 'bpmn:ServiceTask' && (
        <Section title="What it runs">
          <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Service type">
            {SERVICE_TYPES.map(([key, title, body]) => (
              <button key={key} type="button" role="radio" aria-checked={serviceType === key} disabled={disabled} title={body} onClick={() => set({ serviceType: key })} className={`rounded-lg border px-2.5 py-2 text-left text-[12.5px] font-semibold transition-colors ${serviceType === key ? 'border-ember bg-[#FFF6F2] text-ink' : 'border-[#ECE8E3] text-slate-600 hover:bg-[#F6F4F1]'}`}>{title}</button>
            ))}
          </div>
          {serviceType === 'workflow' && (
            <Field label="Workflow" hint={lookups.workflows.length ? 'Only published workflows can run.' : 'This project has no workflows yet.'}>
              <select className={input} disabled={disabled} value={get('workflowId')} onChange={(event) => set({ workflowId: event.target.value })}>
                <option value="">Choose a workflow…</option>
                {lookups.workflows.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== 'published' ? ` (${item.status})` : ''}</option>)}
              </select>
            </Field>
          )}
          {serviceType === 'agent' && (
            <Field label="Agent">
              <select className={input} disabled={disabled} value={get('agentId')} onChange={(event) => set({ agentId: event.target.value })}>
                <option value="">Choose an agent…</option>
                {lookups.agents.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== 'published' ? ` (${item.status})` : ''}</option>)}
              </select>
            </Field>
          )}
          {serviceType === 'http' && (
            <>
              <Field label="REST API connection" hint={lookups.connections.length ? 'Credentials stay in the connection.' : 'Add a REST API connection to this project in Connections.'}>
                <select className={input} disabled={disabled} value={get('connectionId')} onChange={(event) => set({ connectionId: event.target.value })}>
                  <option value="">Choose a connection…</option>
                  {lookups.connections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <div className="flex gap-1.5">
                <select className={`${input} w-24`} disabled={disabled} value={get('httpMethod') || 'GET'} aria-label="Method" onChange={(event) => set({ httpMethod: event.target.value })}>
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => <option key={method}>{method}</option>)}
                </select>
                <input className={`${input} font-mono`} disabled={disabled} value={get('path')} placeholder="/orders/{{vars.orderId}}" aria-label="Path" onChange={(event) => set({ path: event.target.value })} />
              </div>
              <Field label="Body" hint="JSON, templates allowed."><textarea rows={3} className={`${input} resize-none font-mono text-[12px]`} disabled={disabled} value={get('requestBody')} onChange={(event) => set({ requestBody: event.target.value })} /></Field>
            </>
          )}
          {serviceType === 'case' && (
            <>
              <Field label="Case type">
                <select className={input} disabled={disabled} value={get('caseTypeId')} onChange={(event) => set({ caseTypeId: event.target.value })}>
                  <option value="">Choose a case type…</option>
                  {lookups.caseTypes.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== 'published' ? ` (${item.status})` : ''}</option>)}
                </select>
              </Field>
              <Field label="Case title"><input className={input} disabled={disabled} value={get('title')} placeholder="Onboard {{vars.vendorName}}" onChange={(event) => set({ title: event.target.value })} /></Field>
              <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" className="accent-[#D63A0C]" disabled={disabled} checked={get('waitForResolution') === 'true'} onChange={(event) => set({ waitForResolution: event.target.checked ? 'true' : '' })} />Wait until the case is resolved</label>
            </>
          )}
          {serviceType !== 'http' && (
            <Field label={serviceType === 'case' ? 'Case fields' : 'Input'} hint="Values can use templates such as {{vars.amount}}.">
              <KeyValueEditor disabled={disabled} value={json('input', {})} onChange={(value) => set({ input: Object.keys(value).length ? JSON.stringify(value) : '' })} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            {serviceType !== 'case' && <Field label="Retries"><input type="number" min={0} max={5} className={input} disabled={disabled} value={get('retries')} placeholder="0" onChange={(event) => set({ retries: event.target.value })} /></Field>}
            <Field label="Result variable"><input className={`${input} font-mono`} disabled={disabled} value={get('outputVar')} placeholder={definition?.nodes.find((node) => node.id === element.id)?.config?.outputVar || 'result'} onChange={(event) => set({ outputVar: event.target.value })} /></Field>
          </div>
        </Section>
      )}

      {type === 'bpmn:Task' && (
        <Section title="Choose what this task does">
          <p className="text-[12.5px] leading-5 text-slate-600">A plain task cannot run. Make it a User task (a person completes it in Action Center) or a Service task (a robot, agent, API call, or case).</p>
          <div className="flex gap-2">
            <button type="button" className={secondaryBtn} disabled={disabled} onClick={() => replaceWith({ type: 'bpmn:UserTask' })}><Icon name="human" className="h-3.5 w-3.5" />User task</button>
            <button type="button" className={secondaryBtn} disabled={disabled} onClick={() => replaceWith({ type: 'bpmn:ServiceTask' })}><Icon name="robot" className="h-3.5 w-3.5" />Service task</button>
          </div>
        </Section>
      )}

      {type === 'bpmn:StartEvent' && bo.$parent?.$type !== 'bpmn:SubProcess' && (
        <Section title="Trigger">
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Trigger">
            {[['none', 'Manual', undefined], ['timer', 'Timer', 'bpmn:TimerEventDefinition'], ['message', 'Message', 'bpmn:MessageEventDefinition']].map(([key, title, definitionType]) => (
              <button key={key} type="button" role="radio" aria-checked={kind === key} disabled={disabled} onClick={() => kind !== key && replaceWith(definitionType ? { type: 'bpmn:StartEvent', eventDefinitionType: definitionType } : { type: 'bpmn:StartEvent' })} className={`rounded-lg border px-2 py-2 text-[12.5px] font-semibold ${kind === key ? 'border-ember bg-[#FFF6F2] text-ink' : 'border-[#ECE8E3] text-slate-600 hover:bg-[#F6F4F1]'}`}>{title}</button>
            ))}
          </div>
          {kind === 'none' && <p className="text-[12.5px] text-slate-500">Starts from the Run button or the API.</p>}
          {kind === 'timer' && (
            <>
              <Field label="Repeat" hint="A cron expression (minute hour day month weekday) or R/PT15M, R/PT2H, R/P1D, R/P1W.">
                <input className={`${input} font-mono`} disabled={disabled} value={eventDefinition?.timeCycle?.body || ''} placeholder="0 9 * * 1-5" onChange={(event) => setExpression(eventDefinition, 'timeCycle', event.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {[['Every 15 min', 'R/PT15M'], ['Hourly', 'R/PT1H'], ['Weekdays 9:00', '0 9 * * 1-5'], ['Daily', 'R/P1D']].map(([title, value]) => <button key={value} type="button" disabled={disabled} className="rounded-full border border-[#ECE8E3] px-2.5 py-0.5 text-[12px] text-slate-600 hover:bg-[#F6F4F1]" onClick={() => setExpression(eventDefinition, 'timeCycle', value)}>{title}</button>)}
              </div>
              <Field label="Time zone"><input className={input} disabled={disabled} value={get('timezone')} placeholder="UTC" list="bpmn-timezones" onChange={(event) => set({ timezone: event.target.value })} /></Field>
              <datalist id="bpmn-timezones">{['UTC', 'Asia/Kolkata', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore'].map((zone) => <option key={zone} value={zone} />)}</datalist>
            </>
          )}
          {kind === 'message' && <Hint>Another system starts the process with <span className="font-mono">POST {process?.webhookUrl || '/api/hooks/flows/…'}</span> and the <span className="font-mono">X-URAP-Flow-Token</span> header. The token is shown once when you first publish; the JSON body becomes the run input.</Hint>}
        </Section>
      )}

      {type === 'bpmn:IntermediateCatchEvent' && kind === 'timer' && (
        <Section title="Wait">
          <Field label="Duration" hint={isoDurationSeconds(eventDefinition?.timeDuration?.body || '') ? `Waits ${formatSeconds(isoDurationSeconds(eventDefinition.timeDuration.body))}.` : 'An ISO 8601 duration such as PT10M, PT2H, or P1D (up to 30 days).'}>
            <input className={`${input} font-mono`} disabled={disabled} value={eventDefinition?.timeDuration?.body || ''} placeholder="PT10M" onChange={(event) => setExpression(eventDefinition, 'timeDuration', event.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {[['5 min', 'PT5M'], ['1 hour', 'PT1H'], ['1 day', 'P1D']].map(([title, value]) => <button key={value} type="button" disabled={disabled} className="rounded-full border border-[#ECE8E3] px-2.5 py-0.5 text-[12px] text-slate-600 hover:bg-[#F6F4F1]" onClick={() => setExpression(eventDefinition, 'timeDuration', value)}>{title}</button>)}
          </div>
        </Section>
      )}

      {type === 'bpmn:EndEvent' && <p className="text-[12.5px] text-slate-500">The run ends here once no other branch is still active.</p>}
      {type === 'bpmn:ExclusiveGateway' && <Hint>Takes the first outgoing flow whose condition is true, else the default flow. Select a flow to set its condition.</Hint>}
      {type === 'bpmn:ParallelGateway' && <Hint>With several outgoing flows it starts every branch; with several incoming flows it waits for all of them.</Hint>}
      {type === 'bpmn:SubProcess' && <Hint>Its steps run inline, from its start event to its end event, then the process continues.</Hint>}
      {['bpmn:TextAnnotation', 'bpmn:Group', 'bpmn:Association'].includes(type) && <p className="text-[12.5px] text-slate-500">Documentation only; it does not change how the process runs.</p>}

      {type === 'bpmn:SequenceFlow' && (() => {
        const source = element.source;
        if (typeOf(source) !== 'bpmn:ExclusiveGateway') return <p className="text-[12.5px] text-slate-500">Conditions only apply to flows leaving an exclusive gateway.</p>;
        const isDefault = source.businessObject.default === bo;
        const condition = { left: get('conditionLeft'), op: get('conditionOp') || 'eq', right: get('conditionRight') };
        const writeCondition = (next) => {
          if (!services || disabled) return;
          const body = next.left ? conditionText(next) : '';
          services.modeling.updateProperties(element, {
            'urap:conditionLeft': next.left || undefined, 'urap:conditionOp': next.left ? next.op : undefined, 'urap:conditionRight': next.left && !['empty', 'not_empty'].includes(next.op) ? next.right : undefined,
            conditionExpression: body ? services.moddle.create('bpmn:FormalExpression', { body }) : undefined,
          });
        };
        const paths = [];
        for (const node of definition?.nodes || []) {
          const out = node.config?.outputVar;
          if (!out) continue;
          if (node.type === 'human') paths.push(`vars.${out}.outcome`, `vars.${out}.data`);
          else if (node.type === 'http') paths.push(`vars.${out}.status`, `vars.${out}.data`);
          else paths.push(`vars.${out}`);
        }
        for (const name of inputVariables(definition)) paths.push(`vars.${name}`);
        return (
          <Section title="Condition">
            <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" className="accent-[#D63A0C]" disabled={disabled} checked={isDefault} onChange={(event) => services.modeling.updateProperties(source, { default: event.target.checked ? bo : undefined })} />Default flow (taken when no condition matches)</label>
            {!isDefault && (
              <>
                <Field label="When"><input className={`${input} font-mono`} disabled={disabled} list="bpmn-paths" value={condition.left} placeholder="vars.approval.outcome" onChange={(event) => writeCondition({ ...condition, left: event.target.value })} /></Field>
                <datalist id="bpmn-paths">{[...new Set(paths)].map((path) => <option key={path} value={path} />)}</datalist>
                <div className="flex gap-1.5">
                  <select className={`${input} w-40`} disabled={disabled} value={condition.op} aria-label="Operator" onChange={(event) => writeCondition({ ...condition, op: event.target.value })}>
                    {Object.entries(OP_LABELS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                  </select>
                  {!['empty', 'not_empty'].includes(condition.op) && <input className={input} disabled={disabled} value={condition.right} placeholder="approve" aria-label="Value" onChange={(event) => writeCondition({ ...condition, right: event.target.value })} />}
                </div>
                {condition.left && <p className="font-mono text-[11.5px] text-slate-400">{conditionText(condition)}</p>}
              </>
            )}
          </Section>
        );
      })()}

      {!supportedTask && !ELEMENT_INFO[type] && myProblems.length === 0 && <p className="text-[12.5px] text-slate-500">This element is not executed.</p>}
    </div>
  );
}

function RunDialog({ process, variables, onClose, onStarted }) {
  const [values, setValues] = useState(() => Object.fromEntries(variables.map((name) => [name, ''])));
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
    const inputValues = Object.fromEntries(Object.entries(values).filter(([key]) => key).map(([key, value]) => [key, /^-?\d+(\.\d+)?$/.test(String(value)) ? Number(value) : value]));
    try {
      const result = await api(`/api/bpmn/${process.id}/run`, { method: 'POST', body: { input: inputValues } });
      onStarted(result.data);
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-navy-950/35 p-4 pt-[12vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form ref={ref} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="bpmn-run-title" className="w-full max-w-[460px] rounded-2xl u-card shadow-[0_24px_64px_-20px_rgba(16,24,40,0.3)]">
        <div className="px-6 pb-4 pt-5">
          <h2 id="bpmn-run-title" className="text-[17px] font-semibold tracking-tight text-ink">Run {process.name}</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">Runs published version {process.versionNumber}. The input becomes <span className="font-mono">vars</span>.</p>
        </div>
        <div className="border-t border-[#ECE8E3] px-6 py-4">
          <KeyValueEditor value={values} onChange={setValues} valuePlaceholder="value" keyPlaceholder="name" />
        </div>
        {error && <p className="mx-6 mb-3 rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-[#ECE8E3] px-6 py-4">
          <button type="button" className={secondaryBtn} onClick={onClose}>Cancel</button>
          <button type="submit" className={primaryBtn} disabled={busy}><Icon name="play" className="h-3.5 w-3.5" />{busy ? 'Starting…' : 'Start run'}</button>
        </div>
      </form>
    </div>
  );
}

function RunsList({ processId, refreshKey }) {
  const [runs, setRuns] = useState(null);
  useEffect(() => { api(`/api/bpmn/${processId}/runs?limit=20`).then((result) => setRuns(result.data)).catch(() => setRuns([])); }, [processId, refreshKey]);
  if (!runs) return <div className="space-y-2" aria-hidden="true">{[0, 1, 2].map((key) => <div key={key} className="h-10 animate-pulse rounded-lg bg-[#F6F4F1]" />)}</div>;
  if (!runs.length) return <p className="py-6 text-center text-[13px] text-slate-500">No runs yet. Publish the process and press Run.</p>;
  return (
    <ul className="-mx-2 divide-y divide-[#F1EEEA]">
      {runs.map((run) => (
        <li key={run.id}>
          <Link to={`/studio/processes/${processId}/runs/${run.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-[#FAF9F7]">
            <StatusPill status={run.status} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-600">v{run.versionNumber} · {run.triggerSource}</span>
            <span className="shrink-0 text-[12px] text-slate-400">{timeAgo(run.startedAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function BpmnModelerPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = currentUser();
  const writable = canWrite(user?.role);
  const [process, setProcess] = useState(null);
  const [xml, setXml] = useState('');
  const [importKey, setImportKey] = useState(0);
  const [modeler, setModeler] = useState(null);
  const [selected, setSelected] = useState({ element: null, tick: 0 });
  const [dirty, setDirty] = useState(false);
  const [validation, setValidation] = useState({ errors: [], warnings: [], compiled: null });
  const [lookups, setLookups] = useState({ loaded: false, workflows: [], agents: [], connections: [], caseTypes: [], users: [] });
  const [panel, setPanel] = useState('properties');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [token, setToken] = useState('');
  const [running, setRunning] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [name, setName] = useState('');
  const [runsKey, setRunsKey] = useState(0);
  const fileRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    api(`/api/bpmn/${id}`).then(async (result) => {
      if (!alive) return;
      const data = result.data;
      setProcess(data); setName(data.name); setXml(data.xml); setImportKey((value) => value + 1);
      const get = (path) => api(path).then((value) => value.data).catch(() => null);
      const [workflows, connections, members, users, agents, caseTypes] = await Promise.all([
        get(`/api/workflows?projectId=${data.projectId}&limit=100`),
        get(`/api/projects/${data.projectId}/connections`),
        get(`/api/projects/${data.projectId}/members`),
        user?.role === 'administrator' ? get('/api/users') : Promise.resolve([]),
        get(`/api/agents?projectId=${data.projectId}&limit=100`),
        get(`/api/case-types?projectId=${data.projectId}&limit=100`),
      ]);
      if (!alive) return;
      const people = new Map();
      for (const item of users || []) if (item.status !== 'disabled') people.set(item.id, { id: item.id, name: item.displayName || item.email, email: item.email });
      for (const item of members || []) people.set(item.user_id, { id: item.user_id, name: item.display_name || item.email, email: item.email });
      setLookups({
        loaded: Boolean(workflows && agents && caseTypes && connections),
        workflows: workflows || [], agents: agents || [], caseTypes: caseTypes || [],
        connections: (connections || []).filter((item) => item.connectorType === 'rest_api'), users: [...people.values()],
      });
    }).catch((err) => setError(err.message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const lookupMaps = useMemo(() => {
    if (!lookups.loaded) return null;
    const rows = (list) => new Map(list.map((item) => [item.id, { ...item, current_version_id: item.currentVersionId ?? item.current_version_id ?? (item.status === 'published' ? item.id : null) }]));
    return { workflows: rows(lookups.workflows), agents: rows(lookups.agents), caseTypes: rows(lookups.caseTypes), connections: new Map(lookups.connections.map((item) => [item.id, { ...item, connector_type: 'rest_api' }])) };
  }, [lookups]);

  const revalidate = useCallback(async () => {
    if (!modeler) return;
    try {
      const { xml: current } = await modeler.saveXML({ format: false });
      setValidation(validateXml(current, lookupMaps));
    } catch { /* the diagram is mid-edit */ }
  }, [modeler, lookupMaps]);
  useEffect(() => { revalidate(); }, [revalidate]);

  const onChanged = useCallback(() => {
    setDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(revalidate, 300);
  }, [revalidate]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const markers = useMemo(() => Object.fromEntries(validation.errors.filter((item) => item.elementId).map((item) => [item.elementId, 'urap-error'])), [validation.errors]);
  const selectElement = (elementId) => {
    const element = modeler?.get('elementRegistry').get(elementId);
    if (!element) return;
    modeler.get('selection').select(element);
    try { modeler.get('canvas').scrollToElement(element); } catch { /* older canvas */ }
    setPanel('properties');
  };

  async function currentXml() {
    const { xml: value } = await modeler.saveXML({ format: true });
    return value;
  }

  async function save({ quiet = false } = {}) {
    if (!modeler) return false;
    setBusy('save'); setError('');
    try {
      if (name.trim() && name.trim() !== process.name) await api(`/api/bpmn/${id}`, { method: 'PATCH', body: { name: name.trim() } });
      const result = await api(`/api/bpmn/${id}/draft`, { method: 'PUT', body: { xml: await currentXml() } });
      setProcess((value) => ({ ...value, ...result.data }));
      setDirty(false);
      if (!quiet) setNotice('Draft saved');
      return true;
    } catch (err) { setError(err.message); return false; } finally { setBusy(''); }
  }

  async function publish() {
    if (dirty && !(await save({ quiet: true }))) return;
    setBusy('publish'); setError('');
    try {
      const result = await api(`/api/bpmn/${id}/publish`, { method: 'POST' });
      setProcess((value) => ({ ...value, ...result.data }));
      setNotice(`Published version ${result.data.versionNumber}`);
      if (result.data.webhookToken) setToken(result.data.webhookToken);
    } catch (err) {
      if (err.details?.length) { setError('Fix the problems listed in the Problems tab, then publish again.'); setValidation((value) => ({ ...value, errors: err.details })); setPanel('problems'); } else setError(err.message);
    } finally { setBusy(''); }
  }

  async function exportAs(kind) {
    setExportOpen(false);
    if (!modeler) return;
    try {
      if (kind === 'bpmn') saveBlob(new Blob([await currentXml()], { type: 'application/xml' }), `${slug(process.name)}.bpmn`);
      else {
        const { svg } = await modeler.saveSVG();
        if (kind === 'svg') saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${slug(process.name)}.svg`);
        else saveBlob(await svgToPng(svg), `${slug(process.name)}.png`);
      }
    } catch (err) { setError(`Export failed: ${err.message}`); }
  }

  async function importFile(file) {
    if (!file) return;
    const text = await file.text();
    const check = compileBpmn(text);
    if (!check.definition && check.errors.some((item) => !item.elementId && /not valid BPMN XML|not a BPMN 2.0/.test(item.message))) { setError(check.errors[0].message); return; }
    setXml(text); setImportKey((value) => value + 1); setDirty(true); setNotice(`Imported ${file.name}. Save to keep it.`);
  }

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (writable && modeler) save(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    if (!dirty) return undefined;
    const onUnload = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(t); }, [notice]);

  if (error && !process) return <div className="mx-auto max-w-xl px-6 py-20 text-center"><p className="text-[15px] font-semibold text-ink">Could not load the process</p><p className="mt-1 text-[13px] text-slate-500">{error}</p><Link to="/studio?view=processes" className="mt-4 inline-block text-[13px] font-semibold text-ember">Back to Studio</Link></div>;
  if (!process) return <div className="grid h-[calc(100vh-3.5rem)] place-items-center text-[13px] text-slate-500" role="status">Loading process…</div>;

  const definition = validation.compiled?.definition || null;
  const trigger = validation.compiled?.trigger || process.trigger;
  const problemCount = validation.errors.length;
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[#ECE8E3] bg-white px-4">
        <Link to="/studio?view=processes" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Back to processes"><Icon name="chevronRight" className="h-4 w-4 rotate-180" /></Link>
        <span className="u-tile grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#FFF1EC] text-ember"><Icon name="bpmn" className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="truncate text-[11.5px] leading-4 text-slate-500">{process.projectName} · BPMN process</p>
          <input aria-label="Process name" className="-ml-1 w-[260px] truncate rounded-md border border-transparent bg-transparent px-1 text-[14.5px] font-semibold leading-5 text-ink hover:border-[#ECE8E3] focus:border-ember focus:outline-none disabled:hover:border-transparent" disabled={!writable} value={name} maxLength={200} onChange={(event) => { setName(event.target.value); setDirty(true); }} />
        </div>
        <StatusPill status={process.status} />
        {process.versionNumber ? <span className="text-[12px] tabular-nums text-slate-400">v{process.versionNumber}</span> : null}
        <span className="hidden items-center gap-1.5 rounded-full bg-[#F6F4F1] px-2.5 py-0.5 text-[12px] font-medium text-slate-600 xl:inline-flex"><Icon name={trigger?.type === 'schedule' ? 'clock' : trigger?.type === 'webhook' ? 'link' : 'play'} className="h-3 w-3" />{trigger?.type === 'schedule' ? 'Timer start' : trigger?.type === 'webhook' ? 'Message start' : 'Manual start'}</span>
        <span className={`text-[12px] ${dirty ? 'text-[#8A5A0B]' : 'text-slate-400'}`}>{dirty ? 'Unsaved changes' : `Saved ${timeAgo(process.updatedAt)}`}</span>
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".bpmn,.xml,application/xml,text/xml" className="hidden" onChange={(event) => { importFile(event.target.files?.[0]); event.target.value = ''; }} />
          {writable && <button type="button" className={secondaryBtn} onClick={() => fileRef.current?.click()}><Icon name="upload" className="h-3.5 w-3.5" />Import</button>}
          <div className="relative">
            <button type="button" className={secondaryBtn} aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((value) => !value)}><Icon name="download" className="h-3.5 w-3.5" />Export<Icon name="chevronDown" className="h-3 w-3" /></button>
            {exportOpen && (
              <>
                <button type="button" className="fixed inset-0 z-30 cursor-default" aria-hidden="true" tabIndex={-1} onClick={() => setExportOpen(false)} />
                <div role="menu" className="absolute right-0 top-full z-40 mt-1.5 w-52 rounded-xl u-card p-1.5 shadow-[0_16px_40px_-16px_rgba(23,33,37,0.28)]">
                  {[['bpmn', 'BPMN 2.0 XML (.bpmn)'], ['svg', 'Image (.svg)'], ['png', 'Image (.png)']].map(([key, label]) => <button key={key} type="button" role="menuitem" className="flex w-full rounded-lg px-3 py-2 text-left text-[13px] text-ink hover:bg-[#F6F4F1]" onClick={() => exportAs(key)}>{label}</button>)}
                </div>
              </>
            )}
          </div>
          {writable && <button type="button" className={secondaryBtn} disabled={busy !== '' || !modeler} onClick={() => save()}>{busy === 'save' ? 'Saving…' : 'Save'}</button>}
          {canRun(user?.role) && <button type="button" className={secondaryBtn} disabled={process.status !== 'published' || dirty} title={process.status !== 'published' ? 'Publish the process first' : dirty ? 'Save and publish your changes first' : undefined} onClick={() => setRunning(true)}><Icon name="play" className="h-3.5 w-3.5" />Run</button>}
          {canPublish(user?.role) && <button type="button" className={primaryBtn} disabled={busy !== '' || !modeler || problemCount > 0} title={problemCount ? 'Fix the problems first' : undefined} onClick={publish}>{busy === 'publish' ? 'Publishing…' : 'Publish'}</button>}
        </div>
      </div>
      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[#F4C7C1] bg-[#FEF3F2] px-5 py-2 text-[13px] text-danger" role="alert">
          <Icon name="alert" className="h-4 w-4" />{error}
          <button type="button" className="ml-auto text-slate-500 hover:text-ink" aria-label="Dismiss" onClick={() => setError('')}><Icon name="close" className="h-4 w-4" /></button>
        </div>
      )}
      {token && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#F3E2C2] bg-[#FDF8EE] px-5 py-2 text-[13px] text-ink" role="status">
          <span className="font-semibold">Webhook token (shown once):</span><code className="rounded bg-white px-1.5 py-0.5 font-mono text-[12px]">{token}</code>
          <span className="text-slate-500">POST {process.webhookUrl} with header X-URAP-Flow-Token.</span>
          <button type="button" className="ml-auto text-slate-500 hover:text-ink" aria-label="Dismiss" onClick={() => setToken('')}><Icon name="close" className="h-4 w-4" /></button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {notice && <div className="pointer-events-none absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-[12.5px] font-medium text-[#1F6B3A] shadow-[0_8px_24px_-12px_rgba(23,33,37,0.3)] ring-1 ring-[#CDE9D6]" role="status"><Icon name="check" className="h-3.5 w-3.5" />{notice}</div>}
          <BpmnCanvas
            xml={xml} importKey={importKey} readOnly={false} markers={markers}
            onReady={(instance) => { setModeler(instance); setSelected({ element: null, tick: 0 }); }}
            onChanged={onChanged}
            onSelect={(element) => setSelected((value) => ({ element, tick: value.tick + 1 }))}
            onImportError={(err) => setError(`Could not open the diagram: ${err.message}`)}
          />
        </div>
        <aside className="flex w-[360px] shrink-0 flex-col border-l border-[#ECE8E3] bg-white" aria-label="Process panels">
          <div className="flex shrink-0 gap-5 border-b border-[#ECE8E3] px-5" role="tablist" aria-label="Panels">
            {[['properties', 'Properties'], ['problems', `Problems${problemCount ? ` (${problemCount})` : ''}`], ['runs', 'Runs']].map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={panel === key} onClick={() => setPanel(key)} className={`-mb-px border-b-2 py-3 text-[13px] font-semibold ${panel === key ? 'border-ember text-ink' : 'border-transparent text-slate-500 hover:text-ink'} ${key === 'problems' && problemCount ? 'text-danger' : ''}`}>{label}</button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {panel === 'properties' && <BpmnProperties key={`${selected.element?.id || 'none'}`} element={selected.element} modeler={modeler} lookups={lookups} disabled={!writable} problems={validation.errors} definition={definition} process={{ ...process, trigger }} onSelectElement={selectElement} />}
            {panel === 'problems' && (
              validation.errors.length === 0 && validation.warnings.length === 0
                ? <div className="py-8 text-center"><span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[#ECF7EF] text-[#1F6B3A]"><Icon name="check" className="h-5 w-5" /></span><p className="mt-3 text-[13px] font-medium text-ink">Ready to publish</p><p className="mt-1 text-[12.5px] text-slate-500">Every element maps to a URAP step.</p></div>
                : (
                  <ul className="space-y-2">
                    {validation.errors.map((item, index) => (
                      <li key={`e${index}`}><button type="button" disabled={!item.elementId} onClick={() => selectElement(item.elementId)} className="flex w-full gap-2.5 rounded-lg border border-[#F4C7C1] bg-[#FEF3F2] px-3 py-2 text-left text-[12.5px] leading-5 text-danger hover:border-danger/40"><Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{item.message}{item.elementId && <span className="mt-0.5 block font-mono text-[11px] text-danger/70">{item.elementId}</span>}</span></button></li>
                    ))}
                    {validation.warnings.map((item, index) => (
                      <li key={`w${index}`}><button type="button" disabled={!item.elementId} onClick={() => selectElement(item.elementId)} className="flex w-full gap-2.5 rounded-lg border border-[#F3E2C2] bg-[#FDF8EE] px-3 py-2 text-left text-[12.5px] leading-5 text-[#8A5A0B]"><Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{item.message}</span></button></li>
                    ))}
                  </ul>
                )
            )}
            {panel === 'runs' && <RunsList processId={id} refreshKey={runsKey} />}
          </div>
        </aside>
      </div>
      {running && <RunDialog process={process} variables={inputVariables(definition)} onClose={() => setRunning(false)} onStarted={(run) => { setRunning(false); setRunsKey((value) => value + 1); navigate(`/studio/processes/${id}/runs/${run.id}`); }} />}
    </div>
  );
}
