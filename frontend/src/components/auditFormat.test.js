import { describe, expect, it } from 'vitest';
import { actionLabel, categoryOf, categoryStyle, entityLink, formatTime, jsonDiff, rangeBounds, relativeTime, shortAgent } from './auditFormat.js';

describe('audit formatting', () => {
  it('turns actions into human labels and categories', () => {
    expect(actionLabel('auth.login')).toBe('Signed in');
    expect(actionLabel('auth.login_failed')).toBe('Sign-in failed');
    expect(actionLabel('workflow.publish')).toBe('Published workflow');
    expect(actionLabel('task.complete')).toBe('Completed task');
    expect(actionLabel('flow_run.retry')).toBe('Retried flow run');
    expect(actionLabel('case_type.save_draft')).toBe('Saved draft of case type');
    expect(categoryOf('flow_run.retry')).toBe('flow');
    expect(categoryStyle('auth')[0]).toBe('Auth');
    expect(categoryStyle('mystery')[0]).toBe('Mystery');
  });

  it('links entities to their pages only when they exist', () => {
    expect(entityLink({ type: 'workflow', id: 'w1' })).toBe('/workflows/w1');
    expect(entityLink({ type: 'flow_run', id: 'r1', parentId: 'f1' })).toBe('/studio/flows/f1/runs/r1');
    expect(entityLink({ type: 'flow_run', id: 'r1' })).toBeNull();
    expect(entityLink({ type: 'workflow', id: 'w1', exists: false })).toBeNull();
    expect(entityLink({ type: 'user', id: 'u1' })).toBeNull();
  });

  it('formats times in IST with relative age', () => {
    expect(formatTime('2026-10-21T14:50:00Z', 'Asia/Kolkata')).toBe('21 Oct 2026, 8:20 PM');
    const now = Date.parse('2026-10-21T16:50:00Z');
    expect(relativeTime('2026-10-21T14:50:00Z', now)).toBe('2h ago');
    expect(relativeTime('2026-10-21T16:49:50Z', now)).toBe('just now');
    expect(formatTime('nope')).toBe('—');
  });

  it('summarises user agents and diffs metadata', () => {
    expect(shortAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')).toBe('Chrome · Windows');
    expect(shortAgent(null)).toBeNull();
    const d = jsonDiff({ name: 'A', x: 1 }, { name: 'B', y: 2, x: 1 });
    expect(d.find((r) => r.key === 'name').kind).toBe('changed');
    expect(d.find((r) => r.key === 'y').kind).toBe('added');
    expect(d.find((r) => r.key === 'x').kind).toBe('same');
  });

  it('computes date range bounds', () => {
    const now = new Date('2026-10-21T10:00:00');
    expect(rangeBounds('all', {}, now)).toEqual({});
    expect(new Date(rangeBounds('today', {}, now).from).getHours()).toBe(0);
    const c = rangeBounds('custom', { from: '2026-10-01', to: '2026-10-02' }, now);
    expect(new Date(c.to) - new Date(c.from)).toBe(2 * 86400000);
  });
});
