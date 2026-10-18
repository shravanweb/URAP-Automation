import { describe, expect, it } from 'vitest';
import { ACTIVITIES, ACTIVITY_GROUPS, blankStep, buildDefinition, edges, insertActivity, insertSteps, removeStep, uniqueStepId } from './workflowGraph.js';

const base = [
  { id: 'start', type: 'start', name: 'Start', config: {}, next: 'end' },
  { id: 'end', type: 'end', name: 'End', config: {}, next: null },
];

describe('workflow designer graph helpers', () => {
  it('inserts an activity before End and wires the chain', () => {
    const { steps, index } = insertActivity(base, 'read_csv');
    expect(index).toBe(1);
    expect(steps.map((step) => step.id)).toEqual(['start', 'read_csv_1', 'end']);
    expect(steps[0].next).toBe('read_csv_1');
    expect(steps[1].next).toBe('end');
    expect(steps[1].config.path).toBe('in/data.csv');
  });

  it('creates unique ids after deletions', () => {
    const steps = [...base, { id: 'read_csv_1', type: 'read_csv' }, { id: 'read_csv_3', type: 'read_csv' }];
    expect(uniqueStepId('read_csv', steps)).toBe('read_csv_2');
    expect(blankStep('log_message', steps, { x: 1, y: 2 }).config.designer).toEqual({ x: 1, y: 2 });
  });

  it('removes a step and repairs references', () => {
    const { steps } = insertActivity(base, 'validate_data');
    const withBranch = [...steps, { id: 'decide', type: 'if_else', config: { whenTrue: 'validate_data_1', whenFalse: 'end' }, next: null }];
    const removed = removeStep(withBranch, 'validate_data_1');
    expect(removed.find((step) => step.id === 'start').next).toBe('end');
    expect(removed.find((step) => step.id === 'decide').config.whenTrue).toBe('end');
    expect(removeStep(removed, 'start')).toBe(removed);
    expect(removeStep(removed, 'end')).toBe(removed);
  });

  it('lists edges including loop bodies and builds a bounded retry policy', () => {
    const steps = [
      { id: 'start', type: 'start', config: {}, next: 'loop' },
      { id: 'loop', type: 'for_each', config: { bodyStart: 'body' }, next: 'end' },
      { id: 'body', type: 'log_message', config: {}, next: null },
      { id: 'end', type: 'end', config: {}, next: null },
    ];
    expect(edges(steps).map((edge) => `${edge.from}>${edge.to}:${edge.kind}`)).toEqual(['start>loop:next', 'loop>end:next', 'loop>body:body']);
    expect(buildDefinition(steps, { maxAttempts: 9, backoffSeconds: -1 }).retryPolicy).toEqual({ maxAttempts: 5, backoffSeconds: 0 });
  });

  it('inserts recorded steps in order and keeps every activity in a palette group', () => {
    const { steps, index } = insertSteps(base, [
      { type: 'browser_open', name: 'Open Browser', config: { url: 'https://x.test' } },
      { type: 'browser_click', name: 'Click Save', config: { selector: 'Save', selectorType: 'text' } },
    ]);
    expect(index).toBe(1);
    expect(steps.map((step) => step.id)).toEqual(['start', 'browser_open_1', 'browser_click_1', 'end']);
    expect(steps[0].next).toBe('browser_open_1');
    expect(steps[1].next).toBe('browser_click_1');
    expect(steps[2]).toMatchObject({ name: 'Click Save', next: 'end', config: { selector: 'Save', selectorType: 'text' } });
    expect(steps[2].config.designer).toBeTruthy();
    expect(ACTIVITIES.every(([, , group]) => ACTIVITY_GROUPS.includes(group))).toBe(true);
  });
});
