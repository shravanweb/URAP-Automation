import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../services/api.js';
import { Icon } from '../../components/brand.jsx';
import AuthLayout, { Alert } from './AuthLayout.jsx';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/reset-password', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Choose a new password" topLink={<>Remembered it? <Link className="link" to="/login">Sign in</Link></>}>
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-brandsoft text-ember"><Icon name="lock" className="h-6 w-6" /></span>
      <h1 className="auth-heading mt-5 text-[1.75rem] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-3xl">Set a new password</h1>
      {done ? (
        <>
          <p className="auth-muted mt-2 text-[15px] leading-relaxed text-slate-600">Your password is updated and other sessions are signed out.</p>
          <Link to="/login" className="btn btn-primary btn-lg mt-8 w-full">Sign in</Link>
        </>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={submit}>
          {!token && <Alert tone="error">This page needs the link from your reset email.</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
          <label className="block text-sm font-medium text-ink" htmlFor="reset-password">New password
            <input id="reset-password" type="password" autoComplete="new-password" required minLength={12} className="form-input mt-1.5" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <p className="auth-muted text-sm text-slate-600">At least 12 characters, with letters and numbers.</p>
          <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy || !token}>{busy ? 'Saving…' : 'Update password'}</button>
        </form>
      )}
    </AuthLayout>
  );
}
