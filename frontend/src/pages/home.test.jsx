import { renderToStaticMarkup } from 'react-dom/server';
import { Route, Routes } from 'react-router-dom';
import { StaticRouter } from 'react-router-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import HomePage, { greeting } from './HomePage.jsx';
import CloudLayout, { initials, timeAgo } from '../layouts/CloudLayout.jsx';
import { SECTIONS } from '../layouts/AppLayout.jsx';

beforeAll(() => {
  const store = new Map([['urap.user', JSON.stringify({ id: 'u1', role: 'administrator', displayName: 'Shravan Kumar', email: 'sk@example.com' })], ['urap.access', 'token']]);
  globalThis.sessionStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
});

const render = () => renderToStaticMarkup(
  <StaticRouter location="/dashboard"><Routes><Route element={<CloudLayout />}><Route path="/dashboard" element={<HomePage />} /></Route></Routes></StaticRouter>,
);

describe('signed-in home', () => {
  it('renders the top bar, greeting, product cards, and every section', () => {
    const html = render();
    expect(html).toContain('Automation Cloud');
    expect(html).toContain('aria-label="All services"');
    expect(html).toContain('SK');
    expect(html).toMatch(/Good (morning|afternoon|evening), Shravan Kumar/);
    for (const [href, title] of [['/studio', 'Studio'], ['/settings', 'Robots'], ['/tasks', 'Action Center'], ['/jobs', 'Orchestrator']]) {
      expect(html).toContain(`href="${href}"`);
      expect(html).toContain(`>${title}</h3>`);
    }
    for (const text of ['Orchestrator services', 'Start from popular templates', 'Trending on Marketplace', 'License allocations', 'Robots &amp; services', 'Automations', 'Job history', 'My actions', 'Boost your productivity effortlessly', 'Start in Studio', 'What&#x27;s New', 'Resources', 'Try it']) {
      expect(html).toContain(text);
    }
  });

  it('keeps every platform page in the launcher list', () => {
    const links = SECTIONS.flatMap(([, items]) => items.map(([to]) => to));
    for (const to of ['/dashboard', '/metrics', '/projects', '/workflows/new', '/workflows', '/connections', '/jobs', '/schedules', '/queues', '/tasks', '/reports', '/audit', '/settings']) {
      expect(links).toContain(to);
    }
  });

  it('greets by time of day and formats relative times', () => {
    expect(greeting(new Date(2026, 9, 18, 9))).toBe('Good morning');
    expect(greeting(new Date(2026, 9, 18, 14))).toBe('Good afternoon');
    expect(greeting(new Date(2026, 9, 18, 20))).toBe('Good evening');
    const now = Date.parse('2026-10-18T12:00:00Z');
    expect(timeAgo('2026-10-18T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-10-18T11:58:00Z', now)).toBe('2 minutes ago');
    expect(timeAgo('2026-10-18T11:00:00Z', now)).toBe('1 hour ago');
    expect(timeAgo('2026-10-14T12:00:00Z', now)).toBe('4 days ago');
    expect(timeAgo('2026-10-18 11:00:00.000', now)).toBe('1 hour ago');
    expect(initials('Shravan Kumar')).toBe('SK');
  });
});
