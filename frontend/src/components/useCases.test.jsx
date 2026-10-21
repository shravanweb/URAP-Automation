import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import UseCasesSection, { BENEFITS, USE_CASES } from './UseCasesSection.jsx';

const solutions = USE_CASES.map((c) => [c.title, `${c.title} description`]);

describe('UseCasesSection', () => {
  it('renders heading, six use cases with descriptions, and four benefits', () => {
    const html = renderToStaticMarkup(<UseCasesSection solutions={solutions} />);
    expect(html).toContain('id="solutions"');
    expect(html).toContain('already do');
    expect(html).toContain('Explore all use cases');
    for (const c of USE_CASES) expect(html).toContain(`${c.title} description`);
    for (const [title] of BENEFITS) expect(html).toContain(title);
    expect(USE_CASES).toHaveLength(6);
  });
});

import { hubGeometry } from './UseCasesSection.jsx';

describe('hubGeometry', () => {
  it('puts a ring target on every connector, inside the clear band between tile and cards', () => {
    const box = { x: 0, y: 0, w: 900, h: 600 };
    const tile = { x: 390, y: 240, w: 120, h: 110 };
    const cards = [
      { x: 40, y: 0, w: 300, h: 140 }, { x: 560, y: 0, w: 300, h: 140 },
      { x: 0, y: 230, w: 320, h: 140 }, { x: 580, y: 230, w: 320, h: 140 },
      { x: 40, y: 460, w: 300, h: 140 }, { x: 560, y: 460, w: 300, h: 140 },
    ];
    const g = hubGeometry(box, tile, cards);
    expect(g.links).toHaveLength(6);
    expect(g.r1).toBeGreaterThan(tile.w * 0.6);
    for (const l of g.links) {
      const toEnd = Math.hypot(l.x2 - g.cx, l.y2 - g.cy);
      expect(Math.hypot(l.tx - g.cx, l.ty - g.cy)).toBeCloseTo(g.r1, 5);
      expect(toEnd).toBeGreaterThan(g.r1);
    }
  });
});

import { revealPlan } from './UseCasesSection.jsx';

describe('revealPlan', () => {
  it('starts hidden, reveals hub first then cards in order, and finishes by 80%', () => {
    const start = revealPlan(0);
    expect(start.hub).toBe(0);
    expect(start.cards.every((c) => c.card === 0 && c.line === 0)).toBe(true);
    const early = revealPlan(0.2);
    expect(early.hub).toBe(1);
    expect(early.cards[5].card).toBe(0);
    const mid = revealPlan(0.4);
    expect(mid.cards[0].card).toBe(1);
    expect(mid.cards[5].card).toBe(0);
    for (let i = 1; i < 6; i += 1) expect(mid.cards[i - 1].line).toBeGreaterThanOrEqual(mid.cards[i].line);
    const done = revealPlan(0.8);
    expect(done.text).toBe(1);
    expect(done.cards.every((c) => c.line === 1 && c.dot === 1 && c.card === 1)).toBe(true);
    expect(done.benefits.every((b) => b === 1)).toBe(true);
    expect(revealPlan(0.4)).toEqual(mid); // pure: scrolling back gives the same frame
  });
});
