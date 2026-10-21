import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { SettingsView } from './SettingsTabs.jsx';
import { Donut, TrendChart } from './ReportsDashboard.jsx';
import { robotState, tabFromHash, temporaryPassword } from './settingsFormat.js';

const data = {
  tenant: { name: 'Acme', slug: 'default', isolationEnabled: true, createdAt: '2026-01-01T00:00:00Z' },
  server: { timezone: 'UTC', environment: 'production' },
  orchestrator: { configured: true, host: 'cloud.uipath.com', tokenConfigured: true, releaseKeyConfigured: true, folderConfigured: false, required: ['ORCHESTRATOR_BASE_URL'] },
  ai: { provider: 'openai', model: 'gpt-x', host: null, keyConfigured: true, configured: true },
  security: { accessTokenMinutes: 30, refreshTokenDays: 14, passwordRule: '12+ chars', bcryptRounds: 12, authRateLimitPerMinute: 10, rateLimitPerMinute: 300, refreshRateLimitPerMinute: 60, signupEnabled: true, signupRateLimitPerHour: 5, corsOrigins: ['http://localhost:5173'] },
  robots: [{ id: 'r1', name: 'Bot A', adapter: 'contract_simulator', machine: 'PC-1', version: '1.0', online: true, lastHeartbeatAt: new Date().toISOString(), jobsRun: 7 }],
  roleCounts: { administrator: { active: 2, disabled: 0 } },
};
const render = (tab, canEdit) => renderToStaticMarkup(<MemoryRouter><SettingsView data={data} tab={tab} onTab={() => {}} canEdit={canEdit} /></MemoryRouter>);

describe('settings view', () => {
  it('renders every tab without secret values and marks non-admins read-only', () => {
    for (const tab of ['general', 'orchestration', 'robots', 'ai', 'security', 'users']) {
      const html = render(tab, false);
      expect(html).toContain('read-only');
      expect(html).not.toMatch(/Rotate token|Create user|Register robot/);
    }
    expect(render('orchestration', true)).toContain('never shown');
    expect(render('robots', true)).toContain('PC-1');
    expect(render('robots', true)).toContain('Rotate token');
    expect(render('general', true)).not.toContain('read-only');
  });
  it('parses tabs, robot state and passwords', () => {
    expect(tabFromHash('#robots')).toBe('robots');
    expect(tabFromHash('#nope')).toBe('general');
    expect(robotState({ online: false, lastHeartbeatAt: null }).label).toBe('Never connected');
    expect(temporaryPassword()).toMatch(/^.{4}-.{4}-.{4}-.{5}$/);
  });
  it('renders charts', () => {
    expect(renderToStaticMarkup(<TrendChart points={[{ day: '2026-10-20', succeeded: 2, failed: 1, total: 3 }]} />)).toContain('Runs per day');
    expect(renderToStaticMarkup(<Donut items={[{ status: 'FAILED', count: 2 }]} />)).toContain('failed');
  });
});
