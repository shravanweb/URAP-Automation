// The Home / Studio workflow templates live in the frontend (they pre-fill the designer). This
// test holds them to the real engine: every definition must pass the validator, use only real
// step types, and run to completion against mocked services.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateDefinition } from '../src/workflow/validate.js';
import { executeWorkflow } from '../src/workflow/engine.js';
import { STEP_TYPES } from '../src/workflow/constants.js';
import { WORKFLOW_TEMPLATES, templateDefinition, activityPacks } from '../../frontend/src/lib/workflowTemplates.js';
import { ACTIVITIES } from '../../frontend/src/lib/workflowGraph.js';

const INVOICE_TEXT = 'ACME Supplies\nInvoice No: INV-1042\nInvoice Date: 12/10/2026\nDue Date: 26/10/2026\nTotal: USD 1,250.00';

function mockServices(root, calls) {
  return {
    storageRoot: root,
    ocr: async () => ({ text: INVOICE_TEXT, confidence: 95, lines: [] }),
    createTask: async (config) => { calls.tasks.push(config); return { taskId: 't1', status: 'completed', outcome: 'approve', data: { approvedAmount: 1100 } }; },
    getTask: async () => ({ taskId: 't1', status: 'completed', outcome: 'approve', data: {} }),
    notify: async (config) => { calls.notifications.push(config); return { channel: config.channel, notificationId: 'n1' }; },
    queueGet: async () => {
      const items = [{ id: 'q1', specificContent: { amount: 120 } }, { id: 'q2', specificContent: { amount: 0 } }];
      return { found: true, item: items[0], items, count: items.length };
    },
    queueSetStatus: async (config) => { calls.statuses.push([config.itemId, config.status, config.errorType || null]); return { item: { id: config.itemId, status: config.status } }; },
    web: async (type, config) => {
      calls.web.push(type);
      if (type === 'browser_extract_table') return { rows: [{ Company: 'Alfreds', Country: 'Germany' }], count: 1, pages: 1, columns: ['Company', 'Country'] };
      return { ok: true, selector: config.selector || null };
    },
    desktop: async (type, config) => {
      calls.desktop.push(type);
      if (type === 'desktop_type') return { typedCharacters: String(config.text).length, method: 'keys' };
      return { window: { handle: 1, title: 'Untitled - Notepad' } };
    },
    loadSubworkflow: async () => { throw new Error('not used'); },
  };
}

describe('workflow templates', () => {
  it('are valid definitions built only from real activities', () => {
    const designerTypes = new Set(ACTIVITIES.map(([type]) => type));
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    expect(new Set(WORKFLOW_TEMPLATES.map((item) => item.key)).size).toBe(WORKFLOW_TEMPLATES.length);
    for (const template of WORKFLOW_TEMPLATES) {
      const result = validateDefinition(templateDefinition(template));
      expect(result.errors, template.key).toEqual([]);
      expect(result.valid).toBe(true);
      for (const step of template.steps) {
        expect(STEP_TYPES, `${template.key}.${step.id}`).toContain(step.type);
        expect(designerTypes.has(step.type), `${template.key}.${step.id}`).toBe(true);
        expect(step.config.designer).toEqual({ x: expect.any(Number), y: expect.any(Number) });
      }
    }
  });

  it('run to completion against mocked services', async () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `urap-tpl-${template.key}-`));
      fs.mkdirSync(path.join(root, 'in'));
      fs.writeFileSync(path.join(root, 'in/customers.csv'), 'name,email\nAsha, ASHA@example.com \nBen,ben@example.com\nAsha again,asha@example.com\nNo Email,\n,cat@example.com\n');
      const calls = { tasks: [], notifications: [], statuses: [], web: [], desktop: [] };
      // Templates ship with no input values; the test types values like a person would in the Run dialog.
      const input = Object.fromEntries((template.inputFields || []).map((field) => [field.name, field.type === 'number' ? 10 : `test ${field.name}`]));
      const result = await executeWorkflow(templateDefinition(template), input, mockServices(root, calls));
      expect(result.status, `${template.key}: ${JSON.stringify(result.error)}`).toBe('SUCCEEDED');
      if (template.key === 'invoice-to-csv') {
        const csv = fs.readFileSync(path.join(root, 'out/invoice-fields.csv'), 'utf8');
        expect(csv).toContain('INV-1042');
      }
      if (template.key === 'web-table-to-csv') {
        expect(calls.web).toEqual(['browser_open', 'browser_wait_for', 'browser_extract_table', 'browser_close']);
        expect(fs.readFileSync(path.join(root, 'out/web-table.csv'), 'utf8')).toBe('Company,Country\nAlfreds,Germany\n');
      }
      if (template.key === 'purchase-approval') {
        expect(calls.tasks[0].title).toBe('Approve purchase: test item');
        expect(calls.notifications).toEqual([expect.objectContaining({ subject: 'Purchase approved', message: 'test item approved for 1100' })]);
      }
      if (template.key === 'queue-transactions') {
        expect(calls.statuses).toEqual([['q1', 'SUCCESSFUL', null], ['q2', 'FAILED', 'business']]);
      }
      if (template.key === 'clean-customer-csv') {
        expect(fs.readFileSync(path.join(root, 'out/customers-clean.csv'), 'utf8')).toBe('name,email\nAsha,asha@example.com\nBen,ben@example.com\n');
        expect(fs.readFileSync(path.join(root, 'out/customers-rejected.csv'), 'utf8').trim().split('\n')).toHaveLength(3);
      }
      if (template.key === 'notepad-note') {
        expect(calls.desktop).toEqual(['desktop_open_app', 'desktop_type']);
        expect(result.output.summary.log.message).toBe('Typed 9 characters');
      }
    }
  });

  it('derive activity packs from the designer catalog', () => {
    const packs = activityPacks();
    const total = ACTIVITIES.filter(([type]) => type !== 'start' && type !== 'end').length;
    expect(packs.reduce((sum, pack) => sum + pack.count, 0)).toBe(total);
    for (const pack of packs) {
      for (const label of pack.activities) expect(ACTIVITIES.some(([, l, g]) => l === label && g === pack.key)).toBe(true);
    }
  });
});
