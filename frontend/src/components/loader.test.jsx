import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { BrandLoader, PageLoader, SkeletonCards, SkeletonRows, Spinner } from './Loader.jsx';
import { activityCount, beginActivity, subscribeActivity, trackActivity } from '../services/activity.js';

describe('loader components', () => {
  it('renders an accessible branded loader with a label', () => {
    const html = renderToStaticMarkup(<BrandLoader label="Loading projects" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading projects…');
    expect(html).toContain('urap-loader-arc');
  });

  it('renders page loader, spinner and skeletons', () => {
    const html = renderToStaticMarkup(<MemoryRouter><PageLoader /><Spinner /><SkeletonRows rows={3} cols={2} /><SkeletonCards count={2} /></MemoryRouter>);
    expect(html.match(/urap-skeleton/g).length).toBeGreaterThan(8);
  });
});

describe('activity tracker', () => {
  it('counts in-flight work and notifies subscribers once per change', async () => {
    const seen = [];
    const off = subscribeActivity((n) => seen.push(n));
    const end = beginActivity();
    expect(activityCount()).toBe(1);
    end(); end();
    expect(activityCount()).toBe(0);
    await trackActivity(Promise.resolve(1));
    await expect(trackActivity(Promise.reject(new Error('x')))).rejects.toThrow('x');
    off();
    expect(seen).toEqual([1, 0, 1, 0, 1, 0]);
    expect(activityCount()).toBe(0);
  });
});
