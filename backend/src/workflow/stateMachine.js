import { AppError } from '../lib/errors.js';

const TRANSITIONS = {
  DRAFT: ['QUEUED', 'CANCELLED'],
  QUEUED: ['CLAIMED', 'CANCELLED', 'SKIPPED'],
  CLAIMED: ['RUNNING', 'CANCELLED', 'FAILED'],
  RUNNING: ['SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'RETRY_WAIT', 'SUSPENDED'],
  SUSPENDED: ['QUEUED', 'CANCELLED', 'FAILED'],
  CANCEL_REQUESTED: ['CANCELLED', 'FAILED'],
  RETRY_WAIT: ['QUEUED', 'CANCELLED'],
  FAILED: ['QUEUED'],
  SUCCEEDED: [],
  CANCELLED: [],
  SKIPPED: [],
};

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new AppError(409, 'INVALID_STATE', `Cannot change job status from ${from} to ${to}`);
  }
}

export { TRANSITIONS };
