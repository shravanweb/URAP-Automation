import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { AppLauncher, LAUNCHER_GROUPS, filterGroups, launcherGroups } from '../components/AppLauncher.jsx';
import { WHATS_NEW } from '../components/whatsNew.js';

const render = (user, location = '/studio') => renderToStaticMarkup(<StaticRouter location={location}><AppLauncher user={user} pending={3} tenant={{ name: 'DefaultTenant' }} /></StaticRouter>);

describe('app launcher', () => {
  const html = render({ role: 'administrator' });

  it('lists Build, Run and Govern with real links, and Coming soon for pages that do not exist', () => {
    for (const group of ['Build', 'Run', 'Govern']) expect(html).toContain(`aria-label="${group}"`);
    for (const [, , , items] of LAUNCHER_GROUPS) {
      for (const [to, label, , sub] of items) {
        expect(html).toContain(label.replace('&', '&amp;'));
        expect(html).toContain(sub);
        if (to) expect(html).toContain(`href="${to}"`);
      }
    }
    expect(html.match(/Coming soon/g)).toHaveLength(2);
    expect(html).toContain('aria-disabled="true"');
    for (const text of ['Home', 'Your automation overview', 'Metrics', 'Build. Run. Scale.', 'Search for a feature, service, or help...', 'Ctrl K', 'Explore URAP platform', 'Help &amp; documentation', 'DefaultTenant']) expect(html).toContain(text);
    for (const gone of ['Boost your productivity', 'Start in Studio', 'Connect a robot', WHATS_NEW[0].title]) expect(html).not.toContain(gone);
  });

  it('marks the current page, shows the pending badge, and is a labelled dialog', () => {
    expect(html).toMatch(/aria-current="page"[^>]*href="\/studio"|href="\/studio"[^>]*aria-current="page"/);
    expect(html).toContain('aria-label="3 pending"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="App launcher"');
  });

  it('shows the Platform group only to super admins and filters live', () => {
    expect(html).not.toContain('aria-label="Platform"');
    expect(render({ isSuperAdmin: true })).toContain('aria-label="Platform"');
    expect(launcherGroups({ isSuperAdmin: true }).map(([name]) => name)).toEqual(['Build', 'Run', 'Govern', 'Platform']);
    const found = filterGroups(LAUNCHER_GROUPS, 'queue');
    expect(found.map(([name, , , items]) => [name, items.map(([, label]) => label)])).toEqual([['Run', ['Queues']]]);
    expect(filterGroups(LAUNCHER_GROUPS, 'zzz')).toEqual([]);
  });
});
