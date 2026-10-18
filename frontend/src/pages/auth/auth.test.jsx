import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import LoginPage, { loginErrorMessage } from './LoginPage.jsx';
import SignupPage, { signupSchema } from './SignupPage.jsx';
import ForgotPasswordPage from './ForgotPasswordPage.jsx';
import LandingPage from '../LandingPage.jsx';
import LegalPage from '../LegalPage.jsx';

function render(path, element) {
  return renderToStaticMarkup(<StaticRouter location={path}>{element}</StaticRouter>);
}

describe('public pages', () => {
  it('renders the login form with accessible controls', () => {
    const html = render('/login', <LoginPage />);
    expect(html).toContain('Sign in to URAP');
    expect(html).toContain('for="login-email"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('Keep me signed in on this device');
    expect(html).toContain('href="/forgot-password"');
    expect(html).toContain('href="/signup"');
    // The old overlapping brand panel copy is gone.
    expect(html).not.toContain('pick up the path');
  });

  it('renders the sign-up form with every field and the terms checkbox', () => {
    const html = render('/signup?plan=pro', <SignupPage />);
    for (const id of ['signup-displayName', 'signup-email', 'signup-organization', 'signup-password']) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('Terms of Use');
    expect(html).toContain('Pro plan');
    expect(html).toContain('At least 12 characters');
  });

  it('validates sign-up input on the client', () => {
    const good = { displayName: 'Asha Rao', email: 'asha@example.com', organization: 'Northwind', password: 'blue-river-2026', acceptTerms: true };
    expect(signupSchema.safeParse(good).success).toBe(true);
    const bad = signupSchema.safeParse({ ...good, email: 'x', password: 'short', acceptTerms: false });
    expect(bad.success).toBe(false);
    expect([...new Set(bad.error.issues.map((issue) => issue.path[0]))].sort()).toEqual(['acceptTerms', 'email', 'password']);
    expect(signupSchema.safeParse({ ...good, password: 'lettersonlyhere' }).success).toBe(false);
  });

  it('maps sign-in failures to clear messages', () => {
    expect(loginErrorMessage({ status: 401 })).toMatch(/not correct/);
    expect(loginErrorMessage({ status: 429 })).toMatch(/Too many/);
    expect(loginErrorMessage(new TypeError('Failed to fetch'))).toMatch(/could not reach the server/);
  });

  it('renders the forgot-password, legal, and landing pages', () => {
    expect(render('/forgot-password', <ForgotPasswordPage />)).toContain('Contact your URAP administrator');
    const legal = render('/legal', <LegalPage />);
    expect(legal).toContain('id="terms"');
    expect(legal).toContain('id="privacy"');
    // The original landing page is kept; its sign-up buttons go to /signup and Sign in to /login.
    const landing = render('/', <LandingPage />);
    for (const text of ['Your clear path', 'to automation results', 'UiPath Studio', 'UiPath Robot', 'UiPath Orchestrator', 'Ready to start?', 'Try URAP free', 'href="/signup"', 'href="/login"']) {
      expect(landing).toContain(text);
    }
    expect(landing).not.toContain('href="#start"');
  });
});
