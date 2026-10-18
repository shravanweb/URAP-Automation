import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, saveSession } from '../../services/api.js';
import AuthLayout, { Alert, FieldError, PasswordInput, Spinner, useAuthOptions } from './AuthLayout.jsx';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
  remember: z.boolean().optional(),
});

export function loginErrorMessage(error) {
  if (error instanceof TypeError) return 'We could not reach the server. Check your connection and that the URAP API is running.';
  if (error?.status === 401) return 'That email and password combination is not correct. Check both and try again.';
  if (error?.status === 429) return 'Too many sign-in attempts. Wait a minute, then try again.';
  if (error?.status >= 500) return 'The server had a problem signing you in. Try again in a moment.';
  return error?.message || 'Sign-in failed. Try again.';
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const options = useAuthOptions();
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const { register, handleSubmit, setFocus, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: location.state?.email || '', password: '', remember: false },
  });
  const from = typeof location.state?.from === 'string' && location.state.from.startsWith('/') ? location.state.from : '/dashboard';

  const onSubmit = async (values) => {
    setError('');
    try {
      const result = await api('/api/auth/login', { method: 'POST', body: { email: values.email.trim(), password: values.password } });
      saveSession(result.data, { remember: Boolean(values.remember) });
      navigate(from, { replace: true });
    } catch (err) {
      setError(loginErrorMessage(err));
      setFocus('password');
    }
  };

  return (
    <AuthLayout
      title="Sign in"
      topLink={options.allowSignup !== false && <>New to URAP? <Link className="link" to="/signup">Create an account</Link></>}
    >
      <h1 className="auth-heading text-[1.75rem] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-3xl">Sign in to URAP</h1>
      <p className="auth-muted mt-2 text-[15px] text-slate-600">Welcome back. Enter your work email and password to continue.</p>

      {location.state?.signedOut && !error && <div className="mt-6"><Alert tone="info">You have been signed out.</Alert></div>}
      {location.state?.from && !error && !location.state?.signedOut && <div className="mt-6"><Alert tone="info">Sign in to continue to that page.</Alert></div>}

      <form className="mt-8 space-y-5" noValidate onSubmit={handleSubmit(onSubmit)} aria-busy={isSubmitting}>
        <div aria-live="assertive"><Alert id="login-error">{error}</Alert></div>

        <div>
          <label htmlFor="login-email" className="form-label">Work email</label>
          <input
            id="login-email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoFocus
            placeholder="name@company.com"
            className="form-input"
            aria-invalid={errors.email ? 'true' : 'false'}
            aria-describedby={errors.email ? 'login-email-error' : undefined}
            {...register('email')}
          />
          <FieldError id="login-email-error" message={errors.email?.message} />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <label htmlFor="login-password" className="form-label mb-0">Password</label>
            <Link to="/forgot-password" className="link text-sm">Forgot password?</Link>
          </div>
          <PasswordInput
            id="login-password"
            show={showPassword}
            onToggle={() => setShowPassword((value) => !value)}
            invalid={Boolean(errors.password)}
            describedBy={[errors.password && 'login-password-error', capsLock && 'login-caps'].filter(Boolean).join(' ') || undefined}
            onCapsLock={setCapsLock}
            inputProps={{ autoComplete: 'current-password', ...register('password') }}
          />
          <FieldError id="login-password-error" message={errors.password?.message} />
          {capsLock && <p id="login-caps" className="form-hint">Caps Lock is on.</p>}
        </div>

        <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm text-ink">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-[#D63A0C]" {...register('remember')} />
          <span className="auth-muted">Keep me signed in on this device</span>
        </label>

        <button type="submit" className="btn btn-primary btn-lg w-full" disabled={isSubmitting}>
          {isSubmitting ? <><Spinner /> Signing in…</> : 'Sign in'}
        </button>
      </form>

      {options.allowSignup !== false && (
        <p className="auth-muted mt-8 text-center text-sm text-slate-600 sm:hidden">
          New to URAP? <Link className="link" to="/signup">Create an account</Link>
        </p>
      )}
    </AuthLayout>
  );
}
