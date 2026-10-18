export const ROLES = [
  'administrator',
  'project_manager',
  'automation_developer',
  'operator',
  'viewer',
];

const GRANTS = {
  'projects.create': ['administrator', 'project_manager'],
  'projects.update': ['administrator', 'project_manager'],
  'projects.archive': ['administrator', 'project_manager'],
  'members.manage': ['administrator', 'project_manager'],
  'workflows.write': ['administrator', 'project_manager', 'automation_developer'],
  'workflows.publish': ['administrator', 'project_manager', 'automation_developer'],
  'connections.write': ['administrator', 'project_manager', 'automation_developer'],
  'jobs.run': ['administrator', 'project_manager', 'automation_developer', 'operator'],
  'jobs.control': ['administrator', 'project_manager', 'operator'],
  'schedules.write': ['administrator', 'project_manager'],
  'queues.write': ['administrator', 'project_manager', 'automation_developer'],
  'queues.items': ['administrator', 'project_manager', 'automation_developer', 'operator'],
  'tasks.complete': ['administrator', 'project_manager', 'automation_developer', 'operator'],
  'cases.work': ['administrator', 'project_manager', 'automation_developer', 'operator'],
  'cases.manage': ['administrator', 'project_manager'],
  'recorder.use': ['administrator', 'project_manager', 'automation_developer'],
  'users.manage': ['administrator'],
  'robots.manage': ['administrator'],
  'settings.manage': ['administrator'],
};

export function can(role, permission) {
  return (GRANTS[permission] || []).includes(role);
}
