// Pure helpers for the Audit Logs page (unit-tested in auditFormat.test.js).

export const CATEGORY_STYLES = {
  auth: ['Auth', 'bg-[#EEF2FF] text-[#4F46E5] ring-[#C7D2FE]'],
  user: ['User', 'bg-[#F5F3FF] text-[#7C3AED] ring-[#DDD6FE]'],
  project: ['Project', 'bg-[#FFF7ED] text-[#C2410C] ring-[#FED7AA]'],
  workflow: ['Workflow', 'bg-[#FFF1EB] text-[#E8611A] ring-[#FBD3BF]'],
  job: ['Job', 'bg-[#ECFDF5] text-[#047857] ring-[#A7F3D0]'],
  task: ['Task', 'bg-[#F0F9FF] text-[#0369A1] ring-[#BAE6FD]'],
  connection: ['Connection', 'bg-[#F0FDFA] text-[#0F766E] ring-[#99F6E4]'],
  schedule: ['Schedule', 'bg-[#FEFCE8] text-[#A16207] ring-[#FDE68A]'],
  queue: ['Queue', 'bg-[#FDF4FF] text-[#A21CAF] ring-[#F5D0FE]'],
  flow: ['Flow', 'bg-[#FFF1F2] text-[#BE123C] ring-[#FECDD3]'],
  agent: ['Agent', 'bg-[#EEF2FF] text-[#4338CA] ring-[#C7D2FE]'],
  app: ['App', 'bg-[#ECFEFF] text-[#0E7490] ring-[#A5F3FC]'],
  case: ['Case', 'bg-[#F7FEE7] text-[#4D7C0F] ring-[#D9F99D]'],
  bpmn: ['Process', 'bg-[#FFFBEB] text-[#B45309] ring-[#FDE68A]'],
  robot: ['Robot', 'bg-[#F1F5F9] text-[#334155] ring-[#CBD5E1]'],
  recorder: ['Recorder', 'bg-[#F1F5F9] text-[#334155] ring-[#CBD5E1]'],
};

export function categoryOf(action) {
  return String(action || '').split(/[._]/)[0];
}

export function categoryStyle(category) {
  return CATEGORY_STYLES[category] || [category ? category[0].toUpperCase() + category.slice(1) : 'Other', 'bg-slate-50 text-slate-600 ring-slate-200'];
}

const VERBS = {
  create: 'Created', update: 'Updated', publish: 'Published', enable: 'Enabled', disable: 'Disabled', archive: 'Archived',
  save_draft: 'Saved draft of', retry: 'Retried', cancel: 'Cancelled', run: 'Ran', delete: 'Deleted', assign: 'Assigned',
  complete: 'Completed', trigger: 'Triggered', rotate_token: 'Rotated token for', webhook_rotate: 'Rotated webhook for',
  enqueue: 'Queued', robot_claim: 'Robot claimed', robot_result: 'Robot reported result for', heartbeat: 'Heartbeat from',
  items_add: 'Added items to', attach: 'Attached file to', move: 'Moved', hold: 'Put on hold', resume: 'Resumed', reopen: 'Reopened',
  upload: 'Uploaded file to', access: 'Opened', action: 'Ran action in', agent_chat: 'Chatted with agent in', end: 'Ended', start: 'Started',
};
const NOUNS = {
  workflow: 'workflow', project: 'project', job: 'job', task: 'task', user: 'user', connection: 'connection', schedule: 'schedule',
  queue: 'queue', queue_item: 'queue item', flow: 'flow', flow_run: 'flow run', agent: 'agent', agent_run: 'agent run', app: 'app',
  case: 'case', case_type: 'case type', bpmn: 'process', robot: 'robot', recorder: 'recorder',
};
const SPECIAL = {
  'auth.login': 'Signed in', 'auth.login_failed': 'Sign-in failed', 'auth.signup': 'Signed up', 'auth.logout': 'Signed out',
  'user.password_reset_cli': 'Reset password (console)', 'recorder.start': 'Started recorder', 'robot.heartbeat': 'Robot heartbeat',
};

export function actionLabel(action) {
  if (SPECIAL[action]) return SPECIAL[action];
  const [subject, verb = ''] = String(action || '').split('.');
  const noun = NOUNS[subject] || subject.replace(/_/g, ' ');
  if (VERBS[verb]) return `${VERBS[verb]} ${noun}`;
  const words = `${verb.replace(/_/g, ' ')} ${noun}`.trim();
  return words ? words[0].toUpperCase() + words.slice(1) : String(action || '');
}

/** In-app link for an audit entity, or null when there is no page for it (or it no longer exists). */
export function entityLink(entity) {
  if (!entity?.id || entity.exists === false) return null;
  const { type, id, parentId } = entity;
  switch (type) {
    case 'workflow': return `/workflows/${id}`;
    case 'job': return `/jobs/${id}`;
    case 'task': return `/tasks/${id}`;
    case 'flow': return `/studio/flows/${id}`;
    case 'flow_run': return parentId ? `/studio/flows/${parentId}/runs/${id}` : null;
    case 'agent': return `/studio/agents/${id}`;
    case 'agent_run': return parentId ? `/studio/agents/${parentId}/runs/${id}` : null;
    case 'app': return `/studio/apps/${id}`;
    case 'case_type': return `/studio/cases/${id}`;
    case 'case': return `/cases/${id}`;
    case 'bpmn_process': return `/studio/processes/${id}`;
    case 'project': return '/projects';
    case 'work_queue': case 'queue_item': return '/queues';
    case 'schedule': return '/schedules';
    case 'connection': return '/connections';
    default: return null;
  }
}

export function relativeTime(date, now = Date.now()) {
  const s = Math.round((now - new Date(date).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30); return mo < 12 ? `${mo}mo ago` : `${Math.round(mo / 12)}y ago`;
}

export function formatTime(date, timeZone) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, ...(timeZone ? { timeZone } : {}) })
    .format(value).replace(/\bam\b/, 'AM').replace(/\bpm\b/, 'PM');
}

export function shortAgent(ua) {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl|PowerShell|node|axios|python/i.test(ua) ? ua.split(/[ /]/)[0] : null;
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : null;
  return [browser, os].filter(Boolean).join(' · ') || ua.slice(0, 28);
}

/** Flat key-level diff of two objects (before/after). */
export function jsonDiff(before = {}, after = {}) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].sort();
  return keys.map((key) => {
    const a = before?.[key]; const b = after?.[key];
    const same = JSON.stringify(a) === JSON.stringify(b);
    return { key, before: a, after: b, kind: a === undefined ? 'added' : b === undefined ? 'removed' : same ? 'same' : 'changed' };
  });
}

/** Date-range preset → ISO bounds in the browser's local zone. */
export function rangeBounds(preset, custom = {}, now = new Date()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (preset === 'today') return { from: start.toISOString() };
  if (preset === '7d') return { from: new Date(start.getTime() - 6 * 86400000).toISOString() };
  if (preset === '30d') return { from: new Date(start.getTime() - 29 * 86400000).toISOString() };
  if (preset === 'custom') {
    const out = {};
    if (custom.from) out.from = new Date(`${custom.from}T00:00:00`).toISOString();
    if (custom.to) out.to = new Date(new Date(`${custom.to}T00:00:00`).getTime() + 86400000).toISOString();
    return out;
  }
  return {};
}
