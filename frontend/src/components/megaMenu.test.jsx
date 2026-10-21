import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DesktopMegaNav, MEGA_MENUS, MobileMegaNav } from './MegaMenu.jsx';

const render = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

describe('landing mega menu', () => {
  it('renders closed nav buttons with aria-expanded', () => {
    const html = render(<DesktopMegaNav />);
    for (const m of MEGA_MENUS) expect(html).toContain(m.label);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(MEGA_MENUS.length);
    expect(html).not.toContain('Browse');
  });
  it('renders the Solutions panel with industries, departments and browse rows when open', () => {
    const html = render(<DesktopMegaNav initialOpen={1} />);
    expect(html).toContain('aria-expanded="true"');
    for (const t of ['Industries', 'Departments', 'Banking &amp; financial services', 'Finance &amp; accounting', 'all industries', 'all departments', 'NEW']) expect(html).toContain(t);
  });
  it('mobile accordion lists every menu', () => {
    const html = render(<MobileMegaNav />);
    for (const m of MEGA_MENUS) expect(html).toContain(m.label);
  });
});
