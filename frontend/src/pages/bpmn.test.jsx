import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { Route, Routes } from 'react-router-dom';
import { StaticRouter } from 'react-router-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import BpmnCanvas from '../components/BpmnCanvas.jsx';
import { compileBpmn, elementStates } from '../lib/bpmnCompile.js';
import { URAP_ATTRIBUTES, URAP_MODDLE } from '../lib/bpmnModdle.js';
import BpmnModelerPage, { BpmnProperties, inputVariables, validateXml } from './BpmnModelerPage.jsx';
import BpmnRunPage, { stateMarkers } from './BpmnRunPage.jsx';
import { NewProcessDialog, ProcessesTable, START_OPTIONS } from './StudioPage.jsx';
import { purchaseRequestXml } from '../../../backend/src/bpmn/templates.js';

beforeAll(() => {
  const store = new Map([['urap.user', JSON.stringify({ id: 'u1', role: 'administrator', displayName: 'Shravan' })], ['urap.access', 'token']]);
  globalThis.sessionStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) };
  globalThis.localStorage = globalThis.sessionStorage;
});

const render = (node, path = '/') => renderToStaticMarkup(<StaticRouter location={path}>{node}</StaticRouter>);
const WORKFLOW = 'c259ae39-9831-4586-b758-3ca2a5331b17';
const lookups = { loaded: true, workflows: [{ id: WORKFLOW, name: 'Score invoice', status: 'published' }], agents: [], connections: [], caseTypes: [], users: [{ id: 'u1', name: 'Shravan' }] };

describe('BPMN compile (frontend copy)', () => {
  it('keeps the frontend copy in sync with the backend', () => {
    const strip = (text) => text.replace(/\r\n/g, '\n').split('\n').filter((line) => !line.startsWith('// Copy of backend') && !line.startsWith('// Keep the two files')).join('\n').trim();
    const backend = readFileSync(new URL('../../../backend/src/bpmn/compile.js', import.meta.url), 'utf8');
    const frontend = readFileSync(new URL('../lib/bpmnCompile.js', import.meta.url), 'utf8');
    expect(strip(frontend)).toBe(strip(backend));
  });

  it('declares every urap: attribute the compiler reads, without clashing with BPMN attribute names', () => {
    const source = readFileSync(new URL('../lib/bpmnCompile.js', import.meta.url), 'utf8');
    const read = [...source.matchAll(/urap\((?:element|lane|flow), '([A-Za-z]+)'\)/g)].map((match) => match[1]);
    expect(read.length).toBeGreaterThan(15);
    for (const name of read) expect(URAP_ATTRIBUTES).toContain(name);
    for (const clash of ['implementation', 'method', 'body', 'name', 'id']) expect(URAP_ATTRIBUTES).not.toContain(clash);
    expect(URAP_MODDLE).toMatchObject({ prefix: 'urap', uri: 'http://urap.dev/schema/bpmn/1.0' });
  });

  it('validates the purchase request against project lookups and lists its run inputs', () => {
    const maps = { workflows: new Map([[WORKFLOW, { name: 'Score invoice', status: 'published', current_version_id: 'v1' }]]), agents: new Map(), caseTypes: new Map(), connections: new Map() };
    const ok = validateXml(purchaseRequestXml({ workflowId: WORKFLOW }), maps);
    expect(ok.errors).toEqual([]);
    expect(inputVariables(ok.compiled.definition).sort()).toEqual(['amount', 'item']);
    const missing = validateXml(purchaseRequestXml({ workflowId: '' }), maps);
    expect(missing.errors.map((item) => item.elementId)).toContain('Task_CreatePO');
    const states = elementStates(ok.compiled.definition, [{ nodeId: 'Start_Request', status: 'SUCCEEDED' }, { nodeId: 'Task_Approve', status: 'WAITING' }]).elements;
    expect(stateMarkers(states)).toMatchObject({ Start_Request: 'urap-done', Flow_ToApprove: 'urap-done', Task_Approve: 'urap-active' });
    expect(compileBpmn('<x').errors[0].message).toContain('not valid BPMN XML');
  });
});

describe('BPMN pages', () => {
  it('enables BPMN in Start building', () => {
    const option = START_OPTIONS.flatMap(({ items }) => items).find((item) => item.key === 'bpmn');
    expect(option.action).toBe('bpmn');
  });

  it('lists processes with an empty state and offers templates when creating one', () => {
    const empty = render(<ProcessesTable processes={[]} search="" onCreate={() => {}} />);
    expect(empty).toContain('No BPMN processes yet');
    expect(empty).toContain('New BPMN process');
    const table = render(<ProcessesTable processes={[{ id: 'b1', name: 'Purchase request', projectName: 'Finance Ops', status: 'published', versionNumber: 2, triggerType: 'manual', runCount: 3, lastRun: { id: 'r1', status: 'SUCCEEDED', startedAt: '2026-10-18 09:00:00.000' }, updatedAt: '2026-10-18 09:00:00.000' }]} search="" />);
    expect(table).toContain('href="/studio/processes/b1"');
    expect(table).toContain('href="/studio/processes/b1/runs/r1"');
    expect(table).toContain('Manual');
    const dialog = render(<NewProcessDialog projects={[{ id: 'p1', name: 'Finance Ops' }]} workflows={[{ id: WORKFLOW, name: 'Score invoice', projectId: 'p1', status: 'published' }]} onClose={() => {}} onCreated={() => {}} />);
    expect(dialog).toContain('New BPMN process');
    expect(dialog).toContain('Purchase request');
    expect(dialog).toContain('Blank process');
  });

  it('renders the modeler, canvas, and run monitor shells without loading bpmn-js on the server', () => {
    expect(render(<Routes><Route path="/studio/processes/:id" element={<BpmnModelerPage />} /></Routes>, '/studio/processes/b1')).toContain('Loading process');
    expect(render(<Routes><Route path="/studio/processes/:id/runs/:runId" element={<BpmnRunPage />} /></Routes>, '/studio/processes/b1/runs/r1')).toContain('Loading run');
    const canvas = render(<BpmnCanvas xml="<x/>" importKey={1} />);
    expect(canvas).toContain('Loading the BPMN canvas');
    expect(canvas).not.toContain('bjs-container');
  });

  it('shows the process overview and URAP settings for a selected user task', () => {
    const { compiled } = validateXml(purchaseRequestXml({ workflowId: WORKFLOW }));
    const overview = render(<BpmnProperties element={null} modeler={null} lookups={lookups} definition={compiled.definition} process={{ trigger: { type: 'manual' } }} />);
    expect(overview).toContain('How it starts');
    expect(overview).toContain('Project manager');
    const attrs = { 'urap:title': 'Approve purchase', 'urap:outputVar': 'approval' };
    const element = { id: 'Task_Approve', type: 'bpmn:UserTask', businessObject: { $type: 'bpmn:UserTask', name: 'Approve purchase', get: (key) => attrs[key] } };
    const panel = render(<BpmnProperties element={element} modeler={null} lookups={lookups} definition={compiled.definition} problems={[{ elementId: 'Task_Approve', message: 'Something to fix' }]} />);
    expect(panel).toContain('Action Center task');
    expect(panel).toContain('Something to fix');
    expect(panel).toContain('vars.approval.outcome');
    const plain = { id: 'Task_1', type: 'bpmn:Task', businessObject: { $type: 'bpmn:Task', name: 'Do it', get: () => undefined } };
    expect(render(<BpmnProperties element={plain} modeler={null} lookups={lookups} />)).toContain('Choose what this task does');
  });
});
