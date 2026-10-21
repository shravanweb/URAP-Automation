export const WORKSPACE_SORTS = [['created', 'Newest'], ['name', 'Name'], ['users', 'Users'], ['projects', 'Projects'], ['jobs', 'Jobs (30d)'], ['activity', 'Last activity']];

export function workspaceQuery({ q = '', status = '', sort = 'created', dir = 'desc', limit = 25, offset = 0 }) {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (status) params.set('status', status);
  params.set('sort', sort); params.set('dir', dir); params.set('limit', String(limit)); params.set('offset', String(offset));
  return params.toString();
}

export function userQuery({ q = '', role = '', status = '', superAdmin = false, tenantId = '', limit = 25, offset = 0 }) {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (role) params.set('role', role);
  if (status) params.set('status', status);
  if (tenantId) params.set('tenantId', tenantId);
  if (superAdmin) params.set('superAdmin', 'true');
  params.set('limit', String(limit)); params.set('offset', String(offset));
  return params.toString();
}

// Text for the confirm dialog of each platform action.
export function confirmCopy(action, label) {
  return {
    suspend: [`Suspend ${label}?`, 'Everyone in this workspace is signed out and cannot sign in or call the API. Robots stop authenticating and queued jobs are not picked up until you reactivate it. No data is deleted.', 'Suspend workspace'],
    reactivate: [`Reactivate ${label}?`, 'Members can sign in again and queued jobs resume.', 'Reactivate'],
    disable: [`Disable ${label}?`, 'The user is signed out everywhere and cannot sign in until enabled again.', 'Disable user'],
    enable: [`Enable ${label}?`, 'The user can sign in again with their existing password.', 'Enable user'],
    grant: [`Make ${label} a super admin?`, 'Super admins can see every workspace and user on this installation and suspend workspaces. Grant this only to platform operators.', 'Grant super admin'],
    revoke: [`Revoke super admin from ${label}?`, 'They keep their normal workspace access but lose the Platform console.', 'Revoke'],
  }[action];
}

export function actionLabel(action) {
  return { 'workspace.suspend': 'Suspended workspace', 'workspace.reactivate': 'Reactivated workspace', 'user.disable': 'Disabled user', 'user.enable': 'Enabled user', 'super_admin.grant': 'Granted super admin', 'super_admin.revoke': 'Revoked super admin' }[action] || action;
}
