import { renderToStaticMarkup } from 'react-dom/server';
import { Route, Routes } from 'react-router-dom';
import { StaticRouter } from 'react-router-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import StudioPage, { START_OPTIONS, StartBuildingModal } from './StudioPage.jsx';
import CloudLayout from '../layouts/CloudLayout.jsx';

beforeAll(() => {
  const store = new Map([['urap.user', JSON.stringify({ id: 'u1', role: 'administrator', displayName: 'Shravan Kumar' })], ['urap.access', 'token']]);
  globalThis.sessionStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
});

const render = (path) => renderToStaticMarkup(
  <StaticRouter location={path}><Routes><Route element={<CloudLayout />}><Route path="/studio" element={<StudioPage />} /></Route></Routes></StaticRouter>,
);

describe('Studio projects page', () => {
  it('renders in the cloud shell with the Studio label, workspace tabs, and Install locally', () => {
    const html = render('/studio');
    expect(html).toContain('>Studio</span>');
    for (const tab of ['Cloud Workspace', 'Local Workspace', 'Templates']) expect(html).toContain(tab);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('Install locally');
    expect(html).toContain('href="/settings"');
  });

  it('shows the local workspace and templates tabs from the query string', () => {
    expect(render('/studio?tab=local')).toContain('Automate on your own machine');
    const templates = render('/studio?tab=templates');
    expect(templates).toContain('Extract invoice fields into Google Sheets');
    expect(templates).toContain('Try it');
  });
});

describe('Start building dialog', () => {
  it('groups options like Studio Web and enables every option (nothing is coming soon)', () => {
    const html = renderToStaticMarkup(<StartBuildingModal role="administrator" onClose={() => {}} onChoose={() => {}} />);
    expect(html).toContain('Start building');
    expect(html).toContain('Choose how you&#x27;d like to begin');
    expect(html).toContain('aria-modal="true"');
    for (const group of ['Orchestration', 'RPA', 'Building blocks']) expect(html).toContain(`>${group}</p>`);
    const soon = START_OPTIONS.flatMap(({ items }) => items).filter((item) => !item.action).map((item) => item.key);
    expect(soon).toEqual([]);
    expect(html).not.toContain('Coming soon');
    expect(html.match(/aria-disabled="true"/g)).toBeNull();
    expect(START_OPTIONS[0].items.find((item) => item.key === 'bpmn').action).toBe('bpmn');
  });

  it('disables creation options a viewer is not allowed to use', () => {
    const html = renderToStaticMarkup(<StartBuildingModal role="viewer" onClose={() => {}} onChoose={() => {}} />);
    expect(html).not.toContain('aria-disabled="false"');
    expect(html).toContain('Needs a higher role');
  });
});
