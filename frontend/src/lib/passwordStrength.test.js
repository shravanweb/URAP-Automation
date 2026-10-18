import { describe, expect, it } from 'vitest';
import { passwordChecks, passwordStrength } from './passwordStrength.js';

describe('password strength hint', () => {
  it('scores empty, weak, and strong passwords', () => {
    expect(passwordStrength('').score).toBe(0);
    expect(passwordStrength('abc').label).toBe('Weak');
    expect(passwordStrength('onlyletterslonger').meetsPolicy).toBe(false);
    const good = passwordStrength('blue-river-2026');
    expect(good.meetsPolicy).toBe(true);
    expect(good.score).toBeGreaterThanOrEqual(3);
    expect(passwordStrength('Blue-River-2026-Lamp!').label).toBe('Strong');
  });

  it('treats common words and personal details as weak', () => {
    expect(passwordStrength('password123456').label).toBe('Weak');
    expect(passwordStrength('ashara0-2026-xyz', { email: 'ashara0@example.com' }).score).toBe(1);
    expect(passwordStrength('Kumar-2026-teapot', { name: 'Ravi Kumar' }).score).toBe(1);
  });

  it('lists the policy checks', () => {
    expect(passwordChecks('abc1').map((check) => check.ok)).toEqual([false, true, true]);
  });
});
