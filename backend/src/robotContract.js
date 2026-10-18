import fs from 'node:fs/promises';
import path from 'node:path';

const REQUIRED = ['jobId', 'projectId', 'workflowId', 'correlationId'];

export function buildRobotResult(payload, reportPath) {
  const missing = REQUIRED.filter((field) => !payload?.[field]);
  const startedAt = new Date().toISOString();
  if (missing.length) {
    return {
      jobId: payload?.jobId || null,
      correlationId: payload?.correlationId || null,
      executionStatus: 'FAILED',
      output: {},
      startedAt,
      completedAt: new Date().toISOString(),
      errorCode: 'INVALID_INPUT',
      errorMessage: `Missing ${missing.join(', ')}`,
      retryable: false,
    };
  }
  return {
    jobId: payload.jobId,
    correlationId: payload.correlationId,
    executionStatus: 'SUCCEEDED',
    output: {
      ...(reportPath ? { reportPath } : {}),
      task: payload.task || 'ExecuteSupportedTask',
      projectId: payload.projectId,
      workflowId: payload.workflowId,
    },
    startedAt,
    completedAt: new Date().toISOString(),
    errorCode: null,
    errorMessage: null,
    retryable: false,
  };
}

export async function processHandoffFile(inboxFile, reportPath) {
  const payload = JSON.parse(await fs.readFile(inboxFile, 'utf8'));
  const result = buildRobotResult(payload, reportPath);
  if (result.executionStatus === 'SUCCEEDED' && reportPath) {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, [
      'URAP execution report',
      `Job: ${payload.jobId}`,
      `Project: ${payload.projectId}`,
      `Workflow: ${payload.workflowId}`,
      `Correlation: ${payload.correlationId}`,
      `Task: ${payload.task || 'ExecuteSupportedTask'}`,
    ].join('\n'), 'utf8');
  }
  return result;
}
