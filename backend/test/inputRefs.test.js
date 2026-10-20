import { describe, expect, it } from 'vitest';
import { inputRefs, missingInput } from '../src/workflow/inputRefs.js';

describe('required run input', () => {
  const definition = { steps: [{ config: { title: 'Approve {{input.item}}', data: { amount: '{{ input.amount }}' } } }] };
  it('lists referenced input names', () => expect(inputRefs(JSON.stringify(definition))).toEqual(['item', 'amount']));
  it('reports missing or blank values', () => {
    expect(missingInput(definition, {})).toEqual(['item', 'amount']);
    expect(missingInput(definition, { item: '  ', amount: 0 })).toEqual(['item']);
    expect(missingInput(definition, { item: 'Chair', amount: 5 })).toEqual([]);
  });
});
