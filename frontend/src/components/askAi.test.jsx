import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AskAi, { ASK_CHIPS } from './AskAi.jsx';

describe('Ask AI landing assistant', () => {
  it('renders the collapsed pill with an accessible label and no open panel', () => {
    const html = renderToStaticMarkup(<AskAi ask={async () => ({})} />);
    expect(html).toContain('Ask AI about URAP');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('role="dialog"');
  });
  it('offers the four industry chips with known fallback topics', () => {
    expect(ASK_CHIPS.map((c) => c.topic)).toEqual(['finance', 'healthcare', 'manufacturing', 'hr']);
    expect(ASK_CHIPS.every((c) => c.question.length > 10 && c.label)).toBe(true);
  });
});
