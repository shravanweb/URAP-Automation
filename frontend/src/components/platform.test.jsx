import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { PLATFORM_SECTION, SECTIONS, navSections } from '../layouts/AppLayout.jsx';
import { SignupChart } from '../pages/PlatformPage.jsx';
import { actionLabel, confirmCopy, userQuery, workspaceQuery } from './platformFormat.js';

describe('platform console', () => {
  it('shows the Platform nav only to super admins', () => {
    expect(navSections({ role: 'administrator' })).toBe(SECTIONS);
    expect(navSections(null)).toBe(SECTIONS);
    expect(navSections({ isSuperAdmin: true }).at(-1)).toBe(PLATFORM_SECTION);
  });
  it('builds queries and confirm text', () => {
    expect(workspaceQuery({ q: ' acme ', status: 'suspended', sort: 'users', dir: 'asc', limit: 25, offset: 50 })).toBe('q=acme&status=suspended&sort=users&dir=asc&limit=25&offset=50');
    expect(userQuery({ superAdmin: true })).toBe('superAdmin=true&limit=25&offset=0');
    expect(confirmCopy('suspend', 'Acme')[0]).toBe('Suspend Acme?');
    expect(confirmCopy('grant', 'a@b.c')[2]).toBe('Grant super admin');
    expect(actionLabel('workspace.suspend')).toBe('Suspended workspace');
  });
  it('renders the sign-up chart', () => {
    expect(renderToStaticMarkup(<MemoryRouter><SignupChart points={[{ day: '2026-10-20', total: 3 }]} /></MemoryRouter>)).toContain('New workspaces per day');
  });
});
