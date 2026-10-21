import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { encryptJson, decryptJson } from '../src/lib/cryptoSecrets.js';
import { redact } from '../src/lib/redact.js';
import { resolveInside } from '../src/lib/paths.js';
import { extractPdfLiteralText } from '../src/lib/pdfText.js';
import { assertTransition } from '../src/workflow/stateMachine.js';
import { validateDefinition } from '../src/workflow/validate.js';
import { executeWorkflow } from '../src/workflow/engine.js';
import { matchesCron, nextRun } from '../src/scheduler/cron.js';
import { buildRobotResult } from '../src/robotContract.js';

const key = Buffer.from('0123456789abcdef0123456789abcdef');

function workflow(steps) {
  return { schemaVersion: '1.0', retryPolicy: { maxAttempts: 1, backoffSeconds: 0 }, steps };
}

describe('platform building blocks', () => {
  it('encrypts connection secrets and redacts them', () => {
    const encrypted = encryptJson({ password: 'local-only' }, key);
    expect(decryptJson(encrypted.ciphertext, encrypted.iv, encrypted.tag, key)).toEqual({ password: 'local-only' });
    expect(redact({ password: 'local-only', host: 'db' })).toEqual({ password: '[redacted]', host: 'db' });
  });

  it('rejects paths that leave storage', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'urap-'));
    expect(resolveInside(root, 'in/orders.csv').startsWith(root)).toBe(true);
    expect(() => resolveInside(root, '../secret.txt')).toThrow(/storage root/);
  });

  it('extracts literal PDF text', () => {
    const pdf = `%PDF-1.1
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
4 0 obj << /Length 44 >> stream
BT (Order 1001) Tj ET
endstream
endobj
%%EOF`;
    expect(extractPdfLiteralText(Buffer.from(pdf))).toBe('Order 1001');
  });

  it('enforces job status transitions', () => {
    expect(() => assertTransition('QUEUED', 'SUCCEEDED')).toThrow(/QUEUED/);
    expect(() => assertTransition('FAILED', 'QUEUED')).not.toThrow();
    expect(() => assertTransition('SUCCEEDED', 'QUEUED')).toThrow(/SUCCEEDED/);
  });

  it('rejects unknown steps, raw SQL, and unbounded loops', () => {
    const unknown = validateDefinition(workflow([
      { id: 'start', type: 'start', name: 'Start', next: 'bad' },
      { id: 'bad', type: 'shell', name: 'Shell', config: { command: 'whoami' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]));
    expect(unknown.valid).toBe(false);
    const sql = validateDefinition(workflow([
      { id: 'start', type: 'start', name: 'Start', next: 'query' },
      { id: 'query', type: 'database_query', name: 'Query', config: { connectionId: '00000000-0000-4000-8000-000000000099', operation: 'select_rows', sql: 'drop table users' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]));
    expect(sql.valid).toBe(false);
    expect(sql.errors.some((error) => /Arbitrary code/.test(error.message))).toBe(true);
  });

  it('runs a conditional branch and a bounded loop', async () => {
    const notifications = [];
    const services = {
      notify: async (config) => {
        notifications.push(config.message);
        return { channel: 'in_app' };
      },
      loadSubworkflow: async () => { throw new Error('not used'); },
    };
    const result = await executeWorkflow(workflow([
      { id: 'start', type: 'start', name: 'Start', next: 'branch' },
      { id: 'branch', type: 'if_else', name: 'Has rows', config: { left: '{{input.count}}', operator: 'gt', right: 0, whenTrue: 'loop', whenFalse: 'end' } },
      { id: 'loop', type: 'for_each', name: 'Each row', config: { source: '{{input.rows}}', bodyStart: 'note', bodyEnd: 'note', maxIterations: 5 }, next: 'end' },
      { id: 'note', type: 'send_notification', name: 'Note', config: { channel: 'in_app', subject: 'Row', message: '{{item.sku}}' } },
      { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['loop'] } },
    ]), { count: 2, rows: [{ sku: 'A' }, { sku: 'B' }] }, services);
    expect(result.status).toBe('SUCCEEDED');
    expect(notifications).toEqual(['A', 'B']);
    expect(result.output.summary.loop.iterations).toBe(2);
  });

  it('does not report success when a step fails', async () => {
    const result = await executeWorkflow(workflow([
      { id: 'start', type: 'start', name: 'Start', next: 'bad' },
      { id: 'bad', type: 'read_csv', name: 'Missing file', config: { path: 'missing.csv' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]), {}, { storageRoot: os.tmpdir() });
    expect(result.status).toBe('FAILED');
    expect(result.output).toBeUndefined();
  });

  it('calculates the next cron run in a time zone', () => {
    const from = new Date('2026-01-01T00:00:30.000Z');
    expect(matchesCron('0 * * * *', new Date('2026-01-01T01:00:00.000Z'), 'UTC')).toBe(true);
    const upcoming = nextRun('0 0 * * *', from, 'UTC');
    expect(upcoming.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('includes the UiPath workflows for the documented file contract', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uipath');
    for (const name of ['Main.xaml', 'Workflows/Initialize.xaml', 'Workflows/RetrieveWork.xaml', 'Workflows/ValidateInputs.xaml', 'Workflows/ExecuteTask.xaml', 'Workflows/ReportResults.xaml', 'Workflows/HandleException.xaml', 'Workflows/GenerateReport.xaml', 'Workflows/Finalize.xaml']) {
      expect(fs.existsSync(path.join(root, name))).toBe(true);
    }
    const main = fs.readFileSync(path.join(root, 'Main.xaml'), 'utf8');
    expect(main).toContain('ExecuteSupportedTask');
    expect(main).toContain('executionStatus');
    expect(main).toContain('jobId');
  });

  it('builds the robot result contract', () => {
    expect(buildRobotResult({ jobId: 'j' }, 'report.txt').executionStatus).toBe('FAILED');
    const ok = buildRobotResult({
      jobId: 'j', projectId: 'p', workflowId: 'w', correlationId: 'c', task: 'ExecuteSupportedTask',
    }, 'report.txt');
    expect(ok.executionStatus).toBe('SUCCEEDED');
    expect(ok.retryable).toBe(false);
  });
});

describe('added step types and helpers', () => {
  it('validates queue, CSV, and log steps', () => {
    const ok = validateDefinition(workflow([
      { id: 'start', type: 'start', name: 'Start', next: 'get' },
      { id: 'get', type: 'get_queue_item', name: 'Get', config: { queueName: 'Orders', maxItems: 5 }, next: 'set' },
      { id: 'set', type: 'set_queue_item_status', name: 'Set', config: { itemId: '{{steps.get.item.id}}', status: 'SUCCESSFUL' }, next: 'csv' },
      { id: 'csv', type: 'write_csv', name: 'CSV', config: { path: 'out/a.csv', rows: [] }, next: 'log' },
      { id: 'log', type: 'log_message', name: 'Log', config: { message: 'done' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]));
    expect(ok.errors).toEqual([]);
    const bad = validateDefinition(workflow([
      { id: 'start', type: 'start', name: 'Start', next: 'get' },
      { id: 'get', type: 'get_queue_item', name: 'Get', config: { maxItems: 500 }, next: 'set' },
      { id: 'set', type: 'set_queue_item_status', name: 'Set', config: { itemId: 'x', status: 'DONE', errorType: 'oops' }, next: 'csv' },
      { id: 'csv', type: 'write_csv', name: 'CSV', config: { path: 'C:/Windows/x.csv' }, next: 'add' },
      { id: 'add', type: 'add_queue_item', name: 'Add', config: { queueName: 'Q', priority: 'urgent' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End' },
    ]));
    const paths = bad.errors.map((error) => error.path);
    expect(paths).toEqual(expect.arrayContaining(['get.config.queueName', 'get.config.maxItems', 'set.config.status', 'set.config.errorType', 'csv.config.path', 'add.config.priority']));
  });

  it('writes CSV with formula protection and logs messages', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'urap-csv-'));
    const result = await executeWorkflow(workflow([
      { id: 'start', type: 'start', name: 'Start', next: 'csv' },
      { id: 'csv', type: 'write_csv', name: 'CSV', config: { path: 'out/rows.csv', rows: '{{input.rows}}' }, next: 'log' },
      { id: 'log', type: 'log_message', name: 'Log', config: { level: 'warn', message: 'wrote {{steps.csv.rows}}' }, next: 'end' },
      { id: 'end', type: 'end', name: 'End', config: { summaryFrom: ['log'] } },
    ]), { rows: [{ a: '=1+1', b: 2 }] }, { storageRoot: root });
    expect(result.status).toBe('SUCCEEDED');
    expect(fs.readFileSync(path.join(root, 'out/rows.csv'), 'utf8')).toBe("a,b\n'=1+1,2\n");
    expect(result.output.summary.log).toEqual({ level: 'warn', message: 'wrote 1' });
  });

  it('maps queue priorities and lists migrations in order', async () => {
    const { priorityValue } = await import('../src/services/queueService.js');
    const { listMigrations } = await import('../src/db/migrate.js');
    expect([priorityValue('low'), priorityValue(undefined), priorityValue('HIGH')]).toEqual([0, 1, 2]);
    expect(() => priorityValue('urgent')).toThrow(/priority/);
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations');
    const migrations = await listMigrations(root);
    expect(migrations.map((item) => item.id)).toEqual(['002_work_queues', '003_action_center', '004_flows', '005_agents', '006_apps', '007_cases', '008_bpmn', '009_audit_details', '010_platform_admin']);
  });
});
