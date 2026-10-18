import { Link } from 'react-router-dom';
import { Icon } from '../../components/brand.jsx';
import AuthLayout, { Alert } from './AuthLayout.jsx';

const STEPS = [
  ['Contact your URAP administrator', 'This is the person who set up URAP for your organization or manages its users.'],
  ['They set a temporary password', 'Administrators open Settings → Users and choose Reset password next to your account.'],
  ['Sign in with the new password', 'Your other sessions are signed out automatically when the password changes.'],
];

export default function ForgotPasswordPage() {
  return (
    <AuthLayout title="Reset your password" topLink={<>Remembered it? <Link className="link" to="/login">Sign in</Link></>}>
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-brandsoft text-ember"><Icon name="lock" className="h-6 w-6" /></span>
      <h1 className="auth-heading mt-5 text-[1.75rem] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-3xl">Forgot your password?</h1>
      <p className="auth-muted mt-2 text-[15px] leading-relaxed text-slate-600">
        Passwords on this URAP installation are reset by an administrator. Here is how to get back in:
      </p>

      <ol className="mt-7 space-y-4">
        {STEPS.map(([title, body], index) => (
          <li key={title} className="auth-card flex gap-4 rounded-xl border border-line bg-white p-4">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-white">{index + 1}</span>
            <span>
              <span className="auth-heading block text-sm font-semibold text-ink">{title}</span>
              <span className="auth-muted mt-1 block text-sm leading-snug text-slate-600">{body}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-6">
        <Alert tone="info">
          Why no reset email? Outgoing email for account messages is not configured on this installation, so a reset link could not be delivered.
        </Alert>
      </div>

      <details className="auth-muted mt-5 text-sm text-slate-600">
        <summary className="cursor-pointer font-medium text-ink">I am the administrator and I am locked out</summary>
        <p className="mt-2 leading-relaxed">
          On the server, in the <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-ink">backend</code> folder, run{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-ink">npm run reset-password -- you@company.com</code>. It prints a new temporary password and signs out existing sessions.
        </p>
      </details>

      <Link to="/login" className="btn btn-secondary btn-lg mt-8 w-full">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> Back to sign in
      </Link>
    </AuthLayout>
  );
}
