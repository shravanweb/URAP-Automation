import { rangeBounds } from './auditFormat.js';

export const REPORT_STATUSES = ['QUEUED', 'CLAIMED', 'RUNNING', 'SUSPENDED', 'SUCCEEDED', 'FAILED', 'RETRY_WAIT', 'CANCEL_REQUESTED', 'CANCELLED', 'SKIPPED'];
export const REPORT_TRIGGERS = ['manual', 'schedule', 'api', 'retry', 'test', 'queue', 'flow', 'agent', 'app', 'case'];
export const EMPTY_REPORT_FILTERS = { projectId: '', workflowId: '', status: '', trigger: '', range: '30d', from: '', to: '' };

export function reportQuery(filters, extra = {}, now = new Date()) {
  const params = new URLSearchParams();
  for (const key of ['projectId', 'workflowId', 'status', 'trigger']) if (filters[key]) params.set(key, filters[key]);
  const bounds = rangeBounds(filters.range, { from: filters.from, to: filters.to }, now);
  if (bounds.from) params.set('from', bounds.from);
  if (bounds.to) params.set('to', bounds.to);
  for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  return params;
}

export function formatDuration(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return '—';
  const n = Number(ms);
  if (n < 1000) return `${n} ms`;
  const s = n / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Fill missing days with zeros so the trend chart has an evenly spaced x-axis.
export function fillSeries(series, days, now = new Date()) {
  const byDay = new Map(series.map((p) => [p.day, p]));
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push(byDay.get(key) || { day: key, succeeded: 0, failed: 0, total: 0 });
  }
  return out;
}

export function seriesDays(range, series) {
  if (range === 'today') return 1;
  if (range === '7d') return 7;
  if (range === '30d') return 30;
  return 0; // all time / custom: use the data as returned
}

export function pageWindow(offset, limit, total) {
  if (!total) return { from: 0, to: 0, page: 1, pages: 1 };
  return { from: offset + 1, to: Math.min(offset + limit, total), page: Math.floor(offset / limit) + 1, pages: Math.max(1, Math.ceil(total / limit)) };
}
