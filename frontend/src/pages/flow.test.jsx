import { renderToStaticMarkup } from 'react-dom/server';
import { Route, Routes } from 'react-router-dom';
import { StaticRouter } from 'react-router-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import FlowCanvas, { edgePath, fitView, formatSeconds, nodeSummary } from '../components/FlowCanvas.jsx';
import FlowEditorPage, { PALETTE, newNode, problemMap } from './FlowEditorPage.jsx';
import { latestNodeStates } from './FlowRunPage.jsx';
import { NewFlowDialog, START_OPTIONS, StartBuildingModal } from './StudioPage.jsx';
import { emptyDefinition, validateDefinition } from '../lib/flowDefinition.js';

beforeAll(() => {
  const store = new Map([['urap.user', JSON.stringify({ id: 'u1', role: 'administrator', displayName: 'Shravan' })], ['urap.access', 'token']]);
  globalThis.sessionStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) };
});

const sample = {
  variables: [{ name: 'amount', defaultValue: 0 }],
  nodes: [
    { id: 'start', type: 'start', name: 'Start', x: 40, y: 200, config: { trigger: 'manual' } },
    { id: 'score', type: 'robot', name: 'Score invoice', x: 280, y: 200, config: { workflowId: 'w1', outputVar: 'score' } },
    { id: 'review', type: 'human', name: 'Manager review', x: 520, y: 200, config: { title: 'Approve', outputVar: 'review' } },
    { id: 'gate', type: 'decision', name: 'Approved?', x: 760, y: 200, config: {} },
    { id: 'pay', type: 'end', name: 'Paid', x: 1000, y: 120, config: {} },
    { id: 'stop', type: 'end', name: 'Rejected', x: 1000, y: 300, config: {} },
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'score' }, { id: 'e2', from: 'score', to: 'review' }, { id: 'e3', from: 'review', to: 'gate' },
    { id: 'e4', from: 'gate', to: 'pay', label: 'Approved', condition: { left: 'vars.review.outcome', op: 'eq', right: 'approve' } },
    { id: 'e5', from: 'gate', to: 'stop', label: 'Rejected', isDefault: true },
  ],
};

describe('flow editor basics', () => {
  it('validates graphs like the backend publish check', () => {
    expect(validateDefinition(sample).errors).toEqual([]);
    expect(validateDefinition(emptyDefinition()).errors).toEqual([]);
    const broken = { ...sample, edges: sample.edges.filter((edge) => edge.id !== 'e2') };
    const messages = validateDefinition(broken).errors.map((item) => item.message);
    expect(messages).toContain('Score invoice needs exactly one outgoing connection');
    expect(messages).toContain('Manager review is not connected to anything before it');
    expect(problemMap(validateDefinition(broken).errors).score).toBe('Score invoice needs exactly one outgoing connection');
  });

  it('creates palette steps with unique ids and sensible defaults', () => {
    expect(PALETTE.flatMap(([, types]) => types)).toEqual(['robot', 'agent', 'human', 'case', 'http', 'timer', 'decision', 'parallel', 'join', 'end']);
    const first = newNode('robot', 100, 100, sample);
    expect(first.id).toBe('robot_1');
    const second = newNode('robot', 100, 100, { ...sample, nodes: [...sample.nodes, first] });
    expect(second.id).toBe('robot_2');
    expect(second.config).toMatchObject({ workflowId: '', retries: 0 });
    expect(newNode('timer', 0, 0, sample).config.seconds).toBe(60);
  });

  it('renders steps, branch labels, and summaries on the canvas', () => {
    const html = renderToStaticMarkup(<FlowCanvas definition={sample} editable lookups={{ workflows: [{ id: 'w1', name: 'Score workflow' }] }} problems={{ review: 'Give the task a title' }} />);
    expect(html).toContain('aria-label="Robot task: Score invoice"');
    expect(html).toContain('aria-label="Human task: Manager review, Give the task a title"');
    expect(html).toContain('Score workflow');
    expect(html).toContain('>Approved<');
    expect(html).toContain('Rejected · default');
    expect(html).toContain('title="Drag to connect"');
    expect(edgePath({ x: 0, y: 0 }, { x: 400, y: 0 }).d).toMatch(/^M200,34 C/);
    expect(nodeSummary({ type: 'start', config: { trigger: 'schedule', cron: '0 9 * * *' } })).toBe('Schedule · 0 9 * * *');
    expect(formatSeconds(3600)).toBe('1 hour');
    expect(fitView(sample, 2000, 900)).toEqual({ zoom: 1, left: 0, top: 0 });
    expect(fitView(sample, 700, 600).zoom).toBe(0.7);
  });

  it('shows live run statuses and dims steps that were not reached', () => {
    const states = latestNodeStates([
      { nodeId: 'start', status: 'SUCCEEDED' }, { nodeId: 'score', status: 'FAILED' }, { nodeId: 'score', status: 'SUCCEEDED' }, { nodeId: 'review', status: 'WAITING' },
    ]);
    expect(states.score.status).toBe('SUCCEEDED');
    const html = renderToStaticMarkup(<FlowCanvas definition={sample} nodeStates={states} />);
    expect(html).toContain('Manager review, Waiting');
    expect(html).toContain('Score invoice, Completed');
    expect(html).toContain('opacity-55');
    expect(html).not.toContain('Drag to connect');
  });

  it('enables Flow in the Start building dialog and asks for a project', () => {
    const options = START_OPTIONS.flatMap(({ items }) => items);
    expect(options.find((item) => item.key === 'flow').action).toBe('flow');
    expect(options.find((item) => item.key === 'agentic-flow').action).toBe('flow-api');
    const modal = renderToStaticMarkup(<StartBuildingModal role="automation_developer" onClose={() => {}} onChoose={() => {}} />);
    expect(modal.match(/Coming soon/g)).toBeNull();
    const dialog = renderToStaticMarkup(<NewFlowDialog projects={[{ id: 'p1', name: 'Finance' }]} onClose={() => {}} onCreated={() => {}} />);
    expect(dialog).toContain('New flow');
    expect(dialog).toContain('>Finance</option>');
    expect(renderToStaticMarkup(<NewFlowDialog projects={[]} onClose={() => {}} onCreated={() => {}} />)).toContain('Create a project first');
  });

  it('renders the editor route in its loading state', () => {
    const html = renderToStaticMarkup(<StaticRouter location="/studio/flows/f1"><Routes><Route path="/studio/flows/:id" element={<FlowEditorPage />} /></Routes></StaticRouter>);
    expect(html).toContain('Loading flow…');
  });
});
