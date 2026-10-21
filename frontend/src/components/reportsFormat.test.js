import { describe, expect, it } from 'vitest';
import { fillSeries, formatDuration, pageWindow, reportQuery } from './reportsFormat.js';

describe('reports helpers', () => {
  it('builds a filter query that also drives exports', () => {
    const q = reportQuery({ projectId: 'p1', workflowId: '', status: 'FAILED', trigger: 'manual', range: 'all' }, { limit: 25 });
    expect(q.toString()).toBe('projectId=p1&status=FAILED&trigger=manual&limit=25');
    const ranged = reportQuery({ range: '7d' }, {}, new Date(2026, 9, 21, 15));
    expect(ranged.get('from')).toBe(new Date(2026, 9, 15).toISOString());
  });
  it('formats durations', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(420)).toBe('420 ms');
    expect(formatDuration(4200)).toBe('4.2 s');
    expect(formatDuration(125000)).toBe('2m 5s');
    expect(formatDuration(3_900_000)).toBe('1h 5m');
  });
  it('fills missing days and computes the page window', () => {
    const out = fillSeries([{ day: '2026-10-20', succeeded: 3, failed: 1, total: 4 }], 3, new Date(2026, 9, 21, 12));
    expect(out.map((d) => d.total)).toEqual([0, 4, 0]);
    expect(pageWindow(25, 25, 60)).toEqual({ from: 26, to: 50, page: 2, pages: 3 });
    expect(pageWindow(0, 25, 0).from).toBe(0);
  });
});
