import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ConnectorCatalog from './ConnectorCatalog.jsx';
import { availabilityLabel, categoryCounts, connectorLook, filterConnectors } from './connectorCatalog.js';

const connectors = [
  { id: 'ai_provider', displayName: 'AI provider', description: 'Models for agents', availability: 'available' },
  { id: 'mysql', displayName: 'MySQL', description: 'Allow-listed tables', availability: 'available' },
  { id: 'browser_uipath', displayName: 'Browser via UiPath', description: 'Browser tasks on a robot', availability: 'requires_robot' },
  { id: 'credential', displayName: 'Credential', description: 'Username and password', availability: 'available' },
];

describe('connector catalog', () => {
  it('maps ids to categories and icons, with a fallback', () => {
    expect(connectorLook('mysql').category).toBe('databases');
    expect(connectorLook('credential').category).toBe('security');
    expect(connectorLook('something_new')).toMatchObject({ category: 'other', icon: 'link' });
  });

  it('labels availability', () => {
    expect(availabilityLabel('available').label).toBe('Available');
    expect(availabilityLabel('requires_robot').label).toBe('Requires robot');
  });

  it('filters by category and search', () => {
    expect(filterConnectors(connectors, { category: 'web' }).map((item) => item.id)).toEqual(['browser_uipath']);
    expect(filterConnectors(connectors, { query: 'PASSWORD' }).map((item) => item.id)).toEqual(['credential']);
    expect(filterConnectors(connectors, { query: 'ai_prov' })).toHaveLength(1);
    expect(categoryCounts(connectors)).toMatchObject({ all: 4, ai: 1, databases: 1, web: 1, security: 1 });
  });

  it('renders a card per connector with key, status, and Add connection for writers', () => {
    const html = renderToStaticMarkup(<ConnectorCatalog connectors={connectors} canAdd />);
    expect(html).toContain('Connector catalog');
    expect(html).toContain('>ai_provider<');
    expect(html).toContain('Requires robot');
    expect(html.match(/Add connection/g)).toHaveLength(4);
    expect(html).not.toContain('Data &amp; files');
    expect(renderToStaticMarkup(<ConnectorCatalog connectors={connectors} />)).not.toContain('Add connection');
  });
});
