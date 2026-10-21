import { describe, expect, it } from 'vitest';
import { applyReviewedValues } from '../src/workflow/engine.js';
import { reviewedValues } from '../src/services/taskService.js';

const row = { task_type: 'validation', data_json: JSON.stringify({ invoiceNumber: null, totalAmount: 120.5, vendorName: 'Acme' }) };

describe('reviewer corrections on validation tasks', () => {
  it('merges corrections into the task data, trims, empties to null, keeps numbers numeric', () => {
    expect(reviewedValues(row, { invoiceNumber: ' INV-9 ', totalAmount: '1,250.75', vendorName: '' }))
      .toEqual({ invoiceNumber: 'INV-9', totalAmount: 1250.75, vendorName: null });
  });
  it('ignores non-validation tasks and missing input, rejects unknown keys', () => {
    expect(reviewedValues({ ...row, task_type: 'approval' }, { invoiceNumber: 'x' })).toBeNull();
    expect(reviewedValues(row, undefined)).toBeNull();
    expect(() => reviewedValues(row, { other: 'x' })).toThrow(/Unknown field/);
  });
  it('folds approved values back into the extraction step the task data came from', () => {
    const context = { steps: { extract: { values: { invoiceNumber: null, totalAmount: 1 }, confidence: 0.7 } } };
    applyReviewedValues({ config: { data: '{{steps.extract.values}}' } }, { outcome: 'approve', values: { invoiceNumber: 'INV-9', totalAmount: 2, extra: 'x' } }, context);
    expect(context.steps.extract.values).toEqual({ invoiceNumber: 'INV-9', totalAmount: 2 });
    expect(context.steps.extract.reviewed).toBe(true);
  });
  it('leaves the extraction untouched on reject or without values', () => {
    const context = { steps: { extract: { values: { invoiceNumber: null } } } };
    applyReviewedValues({ config: { data: '{{steps.extract.values}}' } }, { outcome: 'reject', values: { invoiceNumber: 'X' } }, context);
    applyReviewedValues({ config: { data: '{{steps.extract.values}}' } }, { outcome: 'approve', data: {} }, context);
    expect(context.steps.extract.values.invoiceNumber).toBeNull();
  });
});
