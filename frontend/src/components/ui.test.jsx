import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyState, StatusBadge } from './ui.jsx';

describe('interface states', () => {
  it('renders a status and an empty state', () => {
    expect(renderToStaticMarkup(<StatusBadge status="SUCCEEDED" />)).toContain('Succeeded');
    expect(renderToStaticMarkup(<EmptyState title="No jobs" body="Run a published workflow to see jobs." />)).toContain('No jobs');
  });
});
