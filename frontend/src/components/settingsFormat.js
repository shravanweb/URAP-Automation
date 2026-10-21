export const SETTINGS_TABS = [
  { id: 'general', label: 'General' },
  { id: 'orchestration', label: 'Orchestration' },
  { id: 'robots', label: 'Robots' },
  { id: 'ai', label: 'AI provider' },
  { id: 'security', label: 'Security' },
  { id: 'users', label: 'Users & roles' },
];
export const ROLES = ['administrator', 'project_manager', 'automation_developer', 'operator', 'viewer'];
export const ROLE_INFO = {
  administrator: 'Full access, including users, robots and settings',
  project_manager: 'Manages projects, members and schedules',
  automation_developer: 'Builds and publishes workflows',
  operator: 'Runs jobs and handles tasks',
  viewer: 'Read-only access',
};

export function tabFromHash(hash) {
  const id = String(hash || '').replace(/^#/, '');
  return SETTINGS_TABS.some((t) => t.id === id) ? id : 'general';
}

export function robotState(robot) {
  if (robot.online) return { label: 'Online', tone: 'online' };
  if (robot.lastHeartbeatAt) return { label: 'Offline', tone: 'offline' };
  return { label: 'Never connected', tone: 'never' };
}

// Random temporary password for an administrator reset: 16 characters from an unambiguous
// alphabet plus a digit, so it always meets the 12-character letters-and-numbers rule.
export function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12)}7`;
}
