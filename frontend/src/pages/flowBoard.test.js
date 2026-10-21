import { describe, expect, it } from 'vitest';
import { edgeProgress, elbowPath } from './LandingPage.jsx';

describe('landing flow board connectors', () => {
  const a = { x: 0, y: 0, w: 100, h: 40 };
  it('joins boxes in the same row with a straight horizontal line, edge to edge', () => {
    expect(elbowPath(a, { x: 200, y: 0, w: 100, h: 40 })).toBe('M100 20 H193');
  });
  it('drops to the next row with an elbow: down, across, down into the top edge', () => {
    const d = elbowPath({ x: 200, y: 0, w: 100, h: 40 }, { x: 0, y: 100, w: 100, h: 40 });
    expect(d.startsWith('M250 40 V')).toBe(true);
    expect(d).toMatch(/H60 Q50 70 50 80 V93$/);
  });
  it('draws edges one after another as progress grows, and reverses', () => {
    expect(edgeProgress(0, 0, 4)).toBe(0);
    expect(edgeProgress(0.23, 0, 4)).toBe(1);
    expect(edgeProgress(0.23, 1, 4)).toBe(0);
    expect(edgeProgress(0.345, 1, 4)).toBeCloseTo(0.5, 1);
    expect(edgeProgress(1, 3, 4)).toBe(1);
  });
});
