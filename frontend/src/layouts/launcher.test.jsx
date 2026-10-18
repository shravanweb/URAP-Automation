import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { LAUNCHER_DESCRIPTIONS, Launcher } from './CloudLayout.jsx';
import { SECTIONS } from './AppLayout.jsx';

describe('app launcher', () => {
  const html = renderToStaticMarkup(<StaticRouter location="/studio"><Launcher pending={3} tenant={{ name: 'DefaultTenant' }} onNavigate={() => {}} onHelp={() => {}} /></StaticRouter>);

  it('lists every platform page with a one-line description', () => {
    for (const [, links] of SECTIONS) {
      for (const [to, label] of links) {
        expect(LAUNCHER_DESCRIPTIONS[to], to).toBeTruthy();
        expect(html).toContain(`href="${to}"`);
        expect(html).toContain(`>${label.replace("&", "&amp;")}</span>`);
      }
    }
    for (const group of ['Overview', 'Build', 'Run', 'Govern']) expect(html).toContain(`aria-label="${group}"`);
  });

  it('marks the current page, shows the pending badge, tenant, and footer links', () => {
    expect(html).toMatch(/aria-current="page"[^>]*href="\/studio"|href="\/studio"[^>]*aria-current="page"/);
    expect(html).toContain('aria-label="3 pending"');
    expect(html).toContain('DefaultTenant');
    expect(html).toContain('role="dialog"');
    for (const text of ['Settings', 'Help &amp; shortcuts', 'What&#x27;s new']) expect(html).toContain(text);
  });
});
