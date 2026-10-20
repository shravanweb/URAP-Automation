import { describe, expect, it } from 'vitest';
import { buildRunInput, inputFields, inputRefs } from './runInput.js';
import { WORKFLOW_TEMPLATES } from './workflowTemplates.js';

describe('run input', () => {
  it('finds the input a workflow references', () => {
    expect(inputRefs([{ config: { a: '{{input.item}} x {{ input.amount }}', b: '{{input.item}}' } }])).toEqual(['item', 'amount']);
  });

  it('templates carry no sample values', () => {
    for (const template of WORKFLOW_TEMPLATES) expect(template.input || {}).toEqual({});
    const text = JSON.stringify(WORKFLOW_TEMPLATES);
    for (const sample of ['Laptop', 'alex@', 'Hello from URAP']) expect(text).not.toContain(sample);
  });

  it('blocks a run until required fields have values', () => {
    const template = WORKFLOW_TEMPLATES.find((item) => item.key === 'purchase-approval');
    const fields = inputFields(template.steps, template.inputFields);
    expect(fields.map((field) => field.label)).toEqual(['Item', 'Amount', 'Requested by']);
    expect(buildRunInput(fields, {}).error).toBe('Enter a value for Item, Amount, Requested by before running.');
    expect(buildRunInput(fields, { item: 'Chair', amount: 'abc', requestedBy: 'x' }).error).toBe('Amount must be a number.');
    expect(buildRunInput(fields, { item: 'Chair', amount: '25', requestedBy: 'r@corp' }).input).toEqual({ item: 'Chair', amount: 25, requestedBy: 'r@corp' });
  });
});
