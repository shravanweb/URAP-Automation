import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import LandingFooter, { isEmail } from './LandingFooter.jsx';

describe('landing footer', () => {
  it('renders columns, newsletter, features and the current year', () => {
    const html = renderToStaticMarkup(<MemoryRouter><LandingFooter /></MemoryRouter>);
    for (const text of ['Platform', 'Solutions', 'Resources', 'Developers', 'Company', 'Get the latest from URAP', 'Enterprise Ready', 'Dedicated Support', 'Sitemap']) expect(html).toContain(text);
    expect(html).toContain(`© ${new Date().getFullYear()} URAP. All rights reserved.`);
  });
  it('validates emails', () => {
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('nope')).toBe(false);
    expect(isEmail('a@b')).toBe(false);
  });
});
