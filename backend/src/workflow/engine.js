import { AppError } from '../lib/errors.js';
import { MAX_STEP_VISITS, MAX_WORKFLOW_DEPTH } from './constants.js';
import { resolveTemplates } from './expressions.js';
import { executeStep } from './steps.js';

function byId(definition) {
  return new Map(definition.steps.map((step) => [step.id, step]));
}

async function withTimeout(promise, timeoutMs, label) {
  if (!timeoutMs) return promise;
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new AppError(408, 'STEP_TIMEOUT', `${label} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runChain(startId, endId, steps, context, services, hooks, visits) {
  let currentId = startId;
  const guard = new Set();
  while (currentId) {
    if (guard.has(currentId)) throw new AppError(400, 'CYCLE', 'A step chain cycled');
    guard.add(currentId);
    const step = steps.get(currentId);
    if (!step) throw new AppError(400, 'MISSING_STEP', `Missing step ${currentId}`);
    await runOne(step, steps, context, services, hooks, visits);
    if (currentId === endId) return;
    if (step.type === 'end') return;
    if (step.type === 'if_else') currentId = context.steps[step.id].next;
    else currentId = step.next || null;
  }
}

async function runOne(step, steps, context, services, hooks, visits) {
  visits.count += 1;
  if (visits.count > MAX_STEP_VISITS) throw new AppError(400, 'STEP_LIMIT', 'Workflow exceeded the step execution limit');
  if (await hooks.shouldCancel?.()) {
    const error = new AppError(409, 'CANCELLED', 'Execution was cancelled');
    error.cancelled = true;
    throw error;
  }
  const started = Date.now();
  await hooks.onStep?.({ step, status: 'RUNNING', startedAt: new Date(started) });
  try {
    let output;
    if (step.type === 'for_each') {
      const resolved = resolveTemplates(step.config || {}, context);
      const items = Array.isArray(resolved.source) ? resolved.source : [];
      if (items.length > step.config.maxIterations) {
        throw new AppError(400, 'LOOP_LIMIT', `Loop has ${items.length} items and maxIterations is ${step.config.maxIterations}`);
      }
      const max = items.length;
      const iterationOutputs = [];
      context.__loopDepth = (context.__loopDepth || 0) + 1;
      try {
      for (let index = 0; index < max; index += 1) {
        context.item = items[index];
        context.iteration = index;
        await runChain(step.config.bodyStart, step.config.bodyEnd || null, steps, context, services, {
          ...hooks,
          iteration: index,
        }, visits);
        iterationOutputs.push(context.steps[step.config.bodyEnd || step.config.bodyStart]);
      }
      } finally {
        context.__loopDepth -= 1;
      }
      output = { iterations: max, results: iterationOutputs };
      delete context.item;
    } else {
      let attempt = 0;
      while (attempt < 2) {
        try {
          output = await withTimeout(executeStep(step, context, services), step.timeoutMs, step.name);
          break;
        } catch (error) {
          attempt += 1;
          if (step.errorPolicy !== 'continue' && attempt >= 1 && step.config.retryStep !== true) throw error;
          if (step.config.retryStep === true && attempt < 2) continue;
          throw error;
        }
      }
    }
    context.steps[step.id] = output;
    await hooks.onStep?.({
      step,
      status: 'SUCCEEDED',
      startedAt: new Date(started),
      finishedAt: new Date(),
      durationMs: Date.now() - started,
      output,
      iteration: hooks.iteration ?? null,
    });
    return output;
  } catch (error) {
    if (error.suspend) {
      await hooks.onStep?.({
        step,
        status: 'SUSPENDED',
        startedAt: new Date(started),
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        output: { taskId: error.suspend.taskId, waiting: true },
        iteration: hooks.iteration ?? null,
      });
      throw error;
    }
    await hooks.onStep?.({
      step,
      status: error.cancelled ? 'CANCELLED' : 'FAILED',
      startedAt: new Date(started),
      finishedAt: new Date(),
      durationMs: Date.now() - started,
      error: error.message,
      iteration: hooks.iteration ?? null,
    });
    if (step.errorPolicy === 'continue' && !error.cancelled) {
      context.steps[step.id] = { error: error.message, continued: true };
      return context.steps[step.id];
    }
    throw error;
  }
}

/** Thrown by a step that must wait for a person (Action Center). The engine stops and reports SUSPENDED. */
export function suspendSignal(taskId) {
  const error = new Error('Waiting for an Action Center task');
  error.suspend = { taskId };
  return error;
}

/**
 * Runs a workflow definition. When resume = { steps, stepId, output } is given, execution
 * continues after the suspended step, whose output becomes `output` (the task result).
 */
export async function executeWorkflow(definition, input, services, hooks = {}, depth = 0, resume = null) {
  if (depth > MAX_WORKFLOW_DEPTH) throw new AppError(400, 'DEPTH_LIMIT', 'Sub-workflow depth limit exceeded');
  const steps = byId(definition);
  const start = definition.steps.find((step) => step.type === 'start');
  const context = { input: input || {}, steps: resume?.steps ? { ...resume.steps } : {}, item: undefined, iteration: 0, __depth: depth, __loopDepth: 0 };
  const visits = { count: 0 };
  const wrapped = {
    ...services,
    subworkflow: async (config) => {
      const child = await services.loadSubworkflow(config.workflowId);
      const result = await executeWorkflow(child.definition, config.input || {}, services, hooks, depth + 1);
      if (result.status !== 'SUCCEEDED') {
        const error = new AppError(422, result.error?.code || 'SUBWORKFLOW_FAILED', result.error?.message || 'Sub-workflow failed');
        error.retryable = Boolean(result.error?.retryable);
        throw error;
      }
      return result.output;
    },
  };
  let suspendedAt = null;
  try {
    let currentId = start.id;
    const seen = new Set();
    if (resume?.stepId) {
      const resumed = steps.get(resume.stepId);
      if (!resumed) throw new AppError(409, 'RESUME_FAILED', `The workflow no longer has step ${resume.stepId}`);
      context.steps[resumed.id] = resume.output;
      await hooks.onStep?.({ step: resumed, status: 'SUCCEEDED', startedAt: new Date(), finishedAt: new Date(), durationMs: 0, output: resume.output, iteration: null });
      for (const id of Object.keys(context.steps)) seen.add(id);
      currentId = resumed.next || null;
    }
    while (currentId) {
      if (seen.has(currentId)) throw new AppError(400, 'CYCLE', 'Workflow entered a cycle');
      seen.add(currentId);
      const step = steps.get(currentId);
      suspendedAt = step.id;
      await runOne(step, steps, context, wrapped, hooks, visits);
      if (step.type === 'end') break;
      currentId = step.type === 'if_else' ? context.steps[step.id].next : (step.next || null);
    }
    const end = [...steps.values()].reverse().find((step) => step.type === 'end' && context.steps[step.id]);
    return {
      status: 'SUCCEEDED',
      output: end ? context.steps[end.id] : { steps: context.steps },
      steps: context.steps,
    };
  } catch (error) {
    if (error.suspend) {
      if (depth > 0) throw error;
      return { status: 'SUSPENDED', suspend: { stepId: suspendedAt, taskId: error.suspend.taskId }, steps: context.steps };
    }
    return {
      status: error.cancelled ? 'CANCELLED' : 'FAILED',
      error: { code: error.code || 'EXECUTION_FAILED', message: error.message, retryable: Boolean(error.retryable) },
      steps: context.steps,
    };
  }
}
