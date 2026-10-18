import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { Route, Routes } from 'react-router-dom';
import { StaticRouter } from 'react-router-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { CaseFieldInput, SlaChip, StageStepper, parseUtc, slaSummary } from '../components/CaseBits.jsx';
import { conditionPaths, emptyDefinition, newStage, newTask, validateCaseTypeDefinition } from '../lib/caseDefinition.js';
import CaseDetailPage from './CaseDetailPage.jsx';
import CaseTypeDesignerPage, { ConditionList, EscalationList, SchemaEditor, slug } from './CaseTypeDesignerPage.jsx';
import CasesPage, { NewCaseDialog } from './CasesPage.jsx';
import { CaseTypesTable, START_OPTIONS, StartBuildingModal } from './StudioPage.jsx';

beforeAll(() => {
  const store = new Map([['urap.user', JSON.stringify({ id: 'u1', role: 'administrator', displayName: 'Shravan' })], ['urap.access', 'token']]);
  globalThis.sessionStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) };
  globalThis.localStorage = globalThis.sessionStorage;
});

const render = (node, path = '/') => renderToStaticMarkup(<StaticRouter location={path}>{node}</StaticRouter>);
const WORKFLOW = 'c259ae39-9831-4586-b758-3ca2a5331b17';

function vendorOnboarding() {
  const definition = emptyDefinition();
  definition.fields = [
    { name: 'vendorName', label: 'Vendor name', type: 'text', required: true },
    { name: 'taxId', label: 'Tax ID', type: 'text', required: false },
    { name: 'risk', label: 'Risk', type: 'select', options: ['low', 'high'], required: false },
  ];
  const verification = { ...newStage(definition.stages), id: 'verification', name: 'Verification', sla: { hours: 24, warnAt: 75 } };
  const robot = { ...newTask('workflow', definition), id: 'check', config: { workflowId: WORKFLOW, inputs: [{ key: 'invoiceId', value: '{{fields.taxId}}' }] } };
  verification.tasks = [robot];
  const review = { ...newTask('human', { stages: [verification] }), id: 'review' };
  verification.tasks.push(review);
  definition.stages.splice(1, 0, verification);
  definition.sla = { hours: 72, warnAt: 80 };
  return definition;
}

describe('case definition', () => {
  it('keeps the frontend copy in sync with the backend', () => {
    const strip = (text) => text.replace(/\r\n/g, '\n').split('\n').filter((line) => !line.startsWith('// Copy of backend') && !line.startsWith('// Keep the two files')).join('\n').trim();
    const backend = readFileSync(new URL('../../../backend/src/case/definition.js', import.meta.url), 'utf8');
    const frontend = readFileSync(new URL('../lib/caseDefinition.js', import.meta.url), 'utf8');
    expect(strip(frontend)).toBe(strip(backend));
  });

  it('validates a vendor onboarding type and offers condition paths from earlier stages', () => {
    const definition = vendorOnboarding();
    const lookups = { workflows: new Map([[WORKFLOW, { id: WORKFLOW, name: 'Score invoice', status: 'published' }]]), flows: new Map(), agents: new Map(), users: new Set() };
    expect(validateCaseTypeDefinition(definition, lookups).errors).toEqual([]);
    const paths = conditionPaths(definition, 'done').map((item) => item.path);
    expect(paths).toContain('fields.vendorName');
    expect(paths).toContain('tasks.review.outcome');
    expect(conditionPaths(definition, 'intake').map((item) => item.path)).not.toContain('tasks.review.outcome');
  });

  it('turns labels into field names', () => {
    expect(slug('Vendor name')).toBe('vendorName');
    expect(slug('2nd contact')).toBe('field2ndContact');
  });
});

describe('case bits', () => {
  const now = Date.parse('2026-10-18T10:00:00Z');
  it('reads API timestamps as UTC', () => {
    expect(parseUtc('2026-10-18 10:00:00.000').toISOString()).toBe('2026-10-18T10:00:00.000Z');
    expect(parseUtc(null)).toBeNull();
  });

  it('summarises SLA timers', () => {
    expect(slaSummary({ dueAt: '2026-10-18 13:30:00', state: 'on_track', status: 'open' }, now)).toMatchObject({ tone: 'on_track', label: '3h 30m left' });
    expect(slaSummary({ dueAt: '2026-10-18 10:30:00', state: 'at_risk', status: 'open' }, now)).toMatchObject({ tone: 'at_risk' });
    expect(slaSummary({ dueAt: '2026-10-18 08:00:00', state: 'breached', status: 'open' }, now)).toMatchObject({ tone: 'breached', label: 'Overdue 2h' });
    expect(slaSummary({ dueAt: '2026-10-18 13:30:00', state: 'on_track', status: 'on_hold' }, now)).toMatchObject({ label: 'Paused' });
    expect(slaSummary({ dueAt: '2026-10-18 13:30:00', state: 'met', status: 'resolved' }, now)).toMatchObject({ label: 'Met' });
    expect(slaSummary({ dueAt: null, state: 'none', status: 'open' }, now)).toBeNull();
    expect(renderToStaticMarkup(<SlaChip label="Stage" dueAt="2026-10-18 08:00:00" state="breached" status="open" now={now} />)).toContain('Overdue 2h');
  });

  it('renders the stage stepper with done, skipped, and current stages', () => {
    const stages = [{ id: 'a', name: 'Intake' }, { id: 'b', name: 'Verification' }, { id: 'c', name: 'Approval' }, { id: 'd', name: 'Done' }];
    const html = renderToStaticMarkup(<StageStepper stages={stages} currentStageId="c" status="open" skipped={new Set(['b'])} />);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('Current stage');
    expect(html).toContain('Skipped');
    expect(html.match(/Done/g).length).toBeGreaterThanOrEqual(2);
    const resolved = renderToStaticMarkup(<StageStepper stages={stages} currentStageId="d" status="resolved" />);
    expect(resolved).not.toContain('aria-current');
  });

  it('renders inputs for each field type', () => {
    const html = renderToStaticMarkup(<>
      <CaseFieldInput field={{ name: 'risk', label: 'Risk', type: 'select', options: ['low', 'high'], required: true }} value="high" onChange={() => {}} />
      <CaseFieldInput field={{ name: 'amount', label: 'Amount', type: 'number' }} value={5} onChange={() => {}} error="Too small" />
    </>);
    expect(html).toContain('<option value="high" selected="">high</option>');
    expect(html).toContain('type="number"');
    expect(html).toContain('Too small');
  });
});

describe('case designer pieces', () => {
  const definition = vendorOnboarding();
  it('edits schema rows, conditions, and escalations', () => {
    const schema = renderToStaticMarkup(<SchemaEditor fields={definition.fields} onChange={() => {}} issues={[{ field: 'risk', message: 'Risk: add the options' }]} />);
    expect(schema).toContain('Vendor name');
    expect(schema).toContain('Risk: add the options');
    expect(schema).toContain('+ Add field');
    const conditions = renderToStaticMarkup(<ConditionList conditions={[{ path: 'tasks.review.outcome', op: 'eq', value: 'approve' }]} paths={conditionPaths(definition, 'done')} onChange={() => {}} empty="none" />);
    expect(conditions).toContain('Review: decision');
    expect(conditions).toContain('value="approve"');
    const escalations = renderToStaticMarkup(<EscalationList rules={[{ id: 'esc1', when: 'breached', action: 'reassign', config: {} }]} people={[{ id: 'u2', name: 'Asha' }]} onChange={() => {}} issues={[{ escalationId: 'esc1', message: 'Case: choose who the case is reassigned to' }]} />);
    expect(escalations).toContain('Asha');
    expect(escalations).toContain('choose who the case is reassigned to');
  });

  it('renders loading states for the pages', () => {
    expect(render(<Routes><Route path="/studio/cases/:id" element={<CaseTypeDesignerPage />} /></Routes>, '/studio/cases/x')).toContain('Loading case type');
    expect(render(<Routes><Route path="/cases/:id" element={<CaseDetailPage />} /></Routes>, '/cases/x')).toContain('Loading case');
    const list = render(<CasesPage />, '/cases');
    expect(list).toContain('Cases');
    expect(list).toContain('New case');
    expect(list).toContain('SLA at risk');
  });

  it('builds the new case form from the published schema', () => {
    const types = [{ id: 't1', name: 'Vendor onboarding', prefix: 'VO', canOpen: true, published: { fields: definition.fields, stages: [], settings: { defaultPriority: 'high' } } }];
    const html = render(<NewCaseDialog caseTypes={types} initialTypeId="t1" onClose={() => {}} onCreated={() => {}} />);
    expect(html).toContain('Vendor name');
    expect(html).toContain('Default (high)');
    expect(html).toContain('Open case');
  });
});

describe('studio cases', () => {
  it('enables Case in the start building modal', () => {
    const option = START_OPTIONS.flatMap(({ items }) => items).find((item) => item.key === 'case');
    expect(option.action).toBe('case');
    const html = render(<StartBuildingModal onClose={() => {}} onChoose={() => {}} />);
    expect(html).toContain('Build a dynamic case management solution');
  });

  it('lists case types with open and at-risk counts', () => {
    const html = render(<CaseTypesTable search="" caseTypes={[{ id: 't1', name: 'Vendor onboarding', projectName: 'Finance Ops', prefix: 'VO', status: 'published', versionNumber: 2, openCases: 3, atRiskCases: 1, updatedAt: '2026-10-18 10:00:00' }]} />);
    expect(html).toContain('Vendor onboarding');
    expect(html).toContain('/studio/cases/t1');
    expect(html).toContain('Finance Ops');
  });
});
