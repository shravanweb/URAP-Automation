import { renderToStaticMarkup } from 'react-dom/server';
import { Route, Routes } from 'react-router-dom';
import { StaticRouter } from 'react-router-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import AgentTranscript, { buildTurns, tokenLabel } from '../components/AgentTranscript.jsx';
import AgentBuilderPage, { AiSetupCard, FieldListEditor, issuesByField } from './AgentBuilderPage.jsx';
import AgentRunPage, { runDuration } from './AgentRunPage.jsx';
import { AgentsTable, NewAgentDialog, START_OPTIONS, StartBuildingModal } from './StudioPage.jsx';
import { buildToolSchemas, defaultAgentConfig, newTool, validateAgentConfig } from '../lib/agentConfig.js';

beforeAll(() => {
  const store = new Map([['urap.user', JSON.stringify({ id: 'u1', role: 'administrator', displayName: 'Shravan' })], ['urap.access', 'token']]);
  globalThis.sessionStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) };
});

const run = {
  id: 'r1', status: 'IDLE', mode: 'chat', source: 'test', steps: 2, promptTokens: 120, completionTokens: 30,
  messages: [
    { id: 1, role: 'system', content: 'You are helpful.' },
    { id: 2, role: 'user', content: 'Check jobs' },
    { id: 3, role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'recent_jobs', arguments: { limit: 5 } }], promptTokens: 80, completionTokens: 10, durationMs: 1200 },
    { id: 4, role: 'tool', toolCallId: 'c1', toolName: 'recent_jobs', status: 'done', content: '{"rows":[]}' },
    { id: 5, role: 'assistant', content: 'There are no jobs yet.', promptTokens: 40, completionTokens: 20 },
  ],
};

describe('agent basics', () => {
  it('validates agent config like the backend publish check', () => {
    const config = defaultAgentConfig('conversational');
    expect(validateAgentConfig(config, {}, 'conversational').errors).toEqual([]);
    const tool = { ...newTool('workflow', []), name: 'run_workflow' };
    const broken = { ...config, maxSteps: 40, tools: [tool, { ...tool, id: 'other' }] };
    const messages = validateAgentConfig(broken, { workflows: [] }, 'conversational').errors.map((item) => item.message);
    expect(messages).toContain('Max steps must be a whole number from 1 to 25');
    expect(messages).toContain('run_workflow: pick a workflow');
    expect(messages).toContain('Two tools are named run_workflow');
    const auto = { ...defaultAgentConfig('autonomous'), outputSchema: [{ name: 'summary', type: 'string', required: true }] };
    expect(buildToolSchemas(auto, 'autonomous').map((item) => item.name)).toContain('submit_output');
    expect(issuesByField([{ field: 'maxSteps', message: 'a' }, { field: 'maxSteps', message: 'b' }])).toEqual({ maxSteps: ['a', 'b'] });
  });

  it('renders a transcript with tool calls joined to their results and token usage', () => {
    const turns = buildTurns(run.messages);
    expect(turns.map((turn) => turn.kind)).toEqual(['system', 'user', 'assistant', 'assistant']);
    expect(turns[2].calls[0].result.content).toBe('{"rows":[]}');
    expect(tokenLabel(run.messages[2])).toBe('80 in · 10 out · 1.2s');
    const html = renderToStaticMarkup(<StaticRouter location="/"><AgentTranscript run={run} toolTypes={{ recent_jobs: 'query' }} /></StaticRouter>);
    expect(html).toContain('recent_jobs');
    expect(html).toContain('There are no jobs yet.');
    expect(html).toContain('Check jobs');
    expect(html).not.toContain('You are helpful.');
    const input = buildTurns([{ id: 1, role: 'user', content: 'Task input:\n```json\n{"invoiceId":"INV-7"}\n```' }]);
    expect(input[0]).toMatchObject({ kind: 'input', input: { invoiceId: 'INV-7' } });
  });

  it('shows the AI provider setup state and field editors', () => {
    const status = { configured: false, providers: [{ id: 'openai', label: 'OpenAI', needsKey: true }, { id: 'anthropic', label: 'Anthropic', needsKey: true }, { id: 'openai_compatible', label: 'OpenAI-compatible', needsKey: false }] };
    const html = renderToStaticMarkup(<AiSetupCard projectId="p1" status={status} canConfigure onConfigured={() => {}} />);
    expect(html).toContain('Connect an AI provider');
    expect(html).toContain('API key');
    const readOnly = renderToStaticMarkup(<AiSetupCard projectId="p1" status={status} canConfigure={false} onConfigured={() => {}} />);
    expect(readOnly).toContain('Connect an AI provider');
    expect(readOnly).not.toContain('type="password"');
    const fields = renderToStaticMarkup(<FieldListEditor fields={[{ name: 'invoiceId', type: 'string', required: true }]} onChange={() => {}} />);
    expect(fields).toContain('invoiceId');
  });

  it('enables Agent in Start building and creates agents in a project', () => {
    expect(START_OPTIONS.flatMap((group) => group.items).find((item) => item.key === 'agent').action).toBe('agent');
    const modal = renderToStaticMarkup(<StaticRouter location="/studio"><StartBuildingModal role="administrator" onClose={() => {}} onChoose={() => {}} /></StaticRouter>);
    expect(modal).toContain('Agent');
    const dialog = renderToStaticMarkup(<NewAgentDialog projects={[{ id: 'p1', name: 'Finance Ops' }]} onClose={() => {}} onCreated={() => {}} onNewProject={() => {}} />);
    expect(dialog).toContain('Finance Ops');
    expect(dialog).toContain('Conversational');
    expect(dialog).toContain('Autonomous');
    expect(dialog).toContain('Coded');
    expect(dialog).toContain('sandbox');
    expect(dialog).not.toContain('Coming later');
    const empty = renderToStaticMarkup(<NewAgentDialog projects={[]} onClose={() => {}} onCreated={() => {}} onNewProject={() => {}} />);
    expect(empty).toContain('Create a project first');
  });

  it('lists agents and renders loading states for the builder and run pages', () => {
    const table = renderToStaticMarkup(<StaticRouter location="/studio"><AgentsTable search="" agents={[{ id: 'a1', name: 'Invoice assistant', projectName: 'Finance Ops', agentType: 'autonomous', status: 'published', versionNumber: 2, config: { tools: [{}, {}] }, updatedAt: '2026-10-18 08:00:00' }]} /></StaticRouter>);
    expect(table).toContain('Invoice assistant');
    expect(table).toContain('Autonomous');
    expect(table).toContain('v2');
    expect(renderToStaticMarkup(<StaticRouter location="/studio"><AgentsTable search="" agents={[]} /></StaticRouter>)).toContain('No agents yet');
    const builder = renderToStaticMarkup(<StaticRouter location="/studio/agents/a1"><Routes><Route path="/studio/agents/:id" element={<AgentBuilderPage />} /></Routes></StaticRouter>);
    expect(builder).toContain('Loading');
    const page = renderToStaticMarkup(<StaticRouter location="/studio/agents/a1/runs/r1"><Routes><Route path="/studio/agents/:id/runs/:runId" element={<AgentRunPage />} /></Routes></StaticRouter>);
    expect(page).toContain('Loading run');
    expect(runDuration({ startedAt: '2026-10-18 08:00:00', finishedAt: '2026-10-18 08:01:05' })).toBe('1m 5s');
  });
});
