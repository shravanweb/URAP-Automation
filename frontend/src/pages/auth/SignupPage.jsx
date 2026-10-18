import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, saveSession } from '../../services/api.js';
import { Icon } from '../../components/brand.jsx';
import { PASSWORD_MIN, passwordChecks, passwordStrength } from '../../lib/passwordStrength.js';
import AuthLayout, { Alert, FieldError, PasswordInput, Spinner, useAuthOptions } from './AuthLayout.jsx';

export const signupSchema = z.object({
  displayName: z.string().trim().min(2, 'Enter your full name').max(200, 'Name is too long'),
  email: z.string().trim().min(1, 'Enter your work email').email('Enter a valid email address'),
  organization: z.string().trim().min(2, 'Enter your organization name').max(120, 'Organization name is too long'),
  password: z.string()
    .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
    .max(200, 'Password is too long')
    .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), 'Use both letters and numbers'),
  acceptTerms: z.boolean().refine((value) => value === true, 'Accept the terms to create an account'),
});

const PLANS = {
  free: 'Free plan',
  pro: 'Pro plan',
  enterprise: 'Enterprise plan',
};

const INCLUDED = [
  'A workspace project for your organization',
  'Studio designer with web, desktop, and document activities',
  'Server worker and robot agent execution',
  'Action Center approvals and work queues',
  'Schedules, reports, and a full audit log',
];

const SIGNUP_ASIDE = (
  <>
    <div>
      <p className="text-sm font-semibold text-brand">Get started free</p>
      <h2 className="mt-3 max-w-md text-[2.1rem] font-bold leading-[1.15] tracking-[-0.025em] xl:text-[2.5rem]">Your first automation is minutes away.</h2>
      <p className="mt-4 max-w-md text-base leading-relaxed text-slate-600">Create an account, record a web flow, and run it on a robot. No credit card, no installation wizard.</p>
    </div>
    <div className="rounded-xl border border-[#eadfd6] bg-white p-6 shadow-[0_12px_32px_rgba(23,33,37,0.08)]">
      <p className="text-sm font-semibold text-ink">Every account includes</p>
      <ul className="mt-4 space-y-3">
        {INCLUDED.map((item) => (
          <li key={item} className="flex items-start gap-3 text-sm text-slate-700">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-teal/20 text-teal"><Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.4} /></span>
            {item}
          </li>
        ))}
      </ul>
    </div>
    <ol className="grid gap-3 2xl:grid-cols-3">
      {[['1', 'Create account'], ['2', 'Build a workflow'], ['3', 'Run it on a robot']].map(([number, label]) => (
        <li key={number} className="flex items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-slate-300 bg-white text-sm font-semibold text-ink">{number}</span>
          <span className="text-sm text-slate-700">{label}</span>
        </li>
      ))}
    </ol>
  </>
);

const BAR_TONES = ['bg-slate-200', 'bg-danger', 'bg-warning', 'bg-teal', 'bg-success'];

function StrengthMeter({ password, email, name }) {
  const strength = passwordStrength(password, { email, name });
  const checks = passwordChecks(password);
  return (
    <div className="mt-2.5" id="signup-password-strength">
      <div className="flex items-center gap-3">
        <div className="grid flex-1 grid-cols-4 gap-1.5" aria-hidden="true">
          {[1, 2, 3, 4].map((bar) => (
            <span key={bar} className={`h-1.5 rounded-full ${bar <= strength.score ? BAR_TONES[strength.score] : 'bg-slate-200'}`} />
          ))}
        </div>
        <span className="auth-muted w-14 text-right text-xs font-medium text-slate-600" aria-live="polite">
          {strength.label && <><span className="sr-only">Password strength: </span>{strength.label}</>}
        </span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {checks.map((check) => (
          <li key={check.id} className={`flex items-center gap-1.5 text-xs ${check.ok ? 'text-success' : 'auth-muted text-slate-500'}`}>
            <Icon name={check.ok ? 'check' : 'info'} className="h-3.5 w-3.5" strokeWidth={check.ok ? 2.4 : 1.7} />
            {check.label}
            <span className="sr-only">{check.ok ? '(met)' : '(not met yet)'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SignupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const plan = PLANS[params.get('plan')] ? params.get('plan') : 'free';
  const options = useAuthOptions();
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, watch, setError: setFieldError, setFocus, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(signupSchema),
    defaultValues: { displayName: '', email: '', organization: '', password: '', acceptTerms: false },
  });
  const [password, email, displayName] = watch(['password', 'email', 'displayName']);
  const closed = options.loaded && options.allowSignup === false;

  const onSubmit = async (values) => {
    setError('');
    try {
      const result = await api('/api/auth/signup', { method: 'POST', body: { ...values, email: values.email.trim() } });
      saveSession(result.data, { remember: false });
      navigate('/dashboard', { replace: true, state: { welcome: true } });
    } catch (err) {
      if (err instanceof TypeError) {
        setError('We could not reach the server. Check your connection and that the URAP API is running.');
        return;
      }
      if (err.code === 'EMAIL_IN_USE') {
        setFieldError('email', { message: 'An account with this email already exists.' });
        setError('');
        setFocus('email');
        return;
      }
      const fields = Object.entries(err.fields || {}).filter(([name]) => ['displayName', 'email', 'organization', 'password', 'acceptTerms'].includes(name));
      if (fields.length) {
        fields.forEach(([name, message]) => setFieldError(name, { message }));
        setFocus(fields[0][0]);
        return;
      }
      setError(err.status === 429 ? 'Too many sign-up attempts from this network. Try again later.' : err.message);
    }
  };

  const fieldProps = (name, describedBy) => ({
    'aria-invalid': errors[name] ? 'true' : 'false',
    'aria-describedby': [errors[name] && `signup-${name}-error`, describedBy].filter(Boolean).join(' ') || undefined,
  });

  return (
    <AuthLayout title="Create your account" aside={SIGNUP_ASIDE} topLink={<>Already have an account? <Link className="link" to="/login">Sign in</Link></>}>
      <p className="inline-flex items-center gap-2 rounded-full bg-brandsoft px-3 py-1 text-xs font-semibold text-emberdark">
        <Icon name="bolt" className="h-3.5 w-3.5" /> {PLANS[plan]} · no credit card
      </p>
      <h1 className="auth-heading mt-4 text-[1.75rem] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-3xl">Create your URAP account</h1>
      <p className="auth-muted mt-2 text-[15px] text-slate-600">Start automating in minutes. We'll set up a workspace for your organization.</p>

      {closed ? (
        <div className="mt-8 space-y-5">
          <Alert tone="info">Self sign-up is turned off on this installation. Ask your URAP administrator to create an account for you.</Alert>
          <Link to="/login" className="btn btn-secondary btn-lg w-full">Back to sign in</Link>
        </div>
      ) : (
        <form className="mt-8 space-y-5" noValidate onSubmit={handleSubmit(onSubmit)} aria-busy={isSubmitting}>
          <div aria-live="assertive"><Alert>{error}</Alert></div>

          <div>
            <label htmlFor="signup-displayName" className="form-label">Full name</label>
            <input id="signup-displayName" className="form-input" autoComplete="name" autoFocus placeholder="Asha Rao" {...fieldProps('displayName')} {...register('displayName')} />
            <FieldError id="signup-displayName-error" message={errors.displayName?.message} />
          </div>

          <div>
            <label htmlFor="signup-email" className="form-label">Work email</label>
            <input id="signup-email" type="email" inputMode="email" className="form-input" autoComplete="email" placeholder="name@company.com" {...fieldProps('email')} {...register('email')} />
            <FieldError id="signup-email-error" message={errors.email?.message} />
            {errors.email?.message?.includes('already exists') && <p className="form-hint"><Link className="link" to="/login" state={{ email }}>Sign in instead</Link> or <Link className="link" to="/forgot-password">reset your password</Link>.</p>}
          </div>

          <div>
            <label htmlFor="signup-organization" className="form-label">Organization name</label>
            <input id="signup-organization" className="form-input" autoComplete="organization" placeholder="Northwind Traders" {...fieldProps('organization')} {...register('organization')} />
            <FieldError id="signup-organization-error" message={errors.organization?.message} />
          </div>

          <div>
            <label htmlFor="signup-password" className="form-label">Password</label>
            <PasswordInput
              id="signup-password"
              show={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
              invalid={Boolean(errors.password)}
              describedBy={[errors.password && 'signup-password-error', 'signup-password-strength'].filter(Boolean).join(' ')}
              inputProps={{ autoComplete: 'new-password', ...register('password') }}
            />
            <FieldError id="signup-password-error" message={errors.password?.message} />
            <StrengthMeter password={password} email={email} name={displayName} />
          </div>

          <div>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-[#D63A0C]" {...fieldProps('acceptTerms')} {...register('acceptTerms')} />
              <span className="auth-muted leading-snug text-slate-700">
                I agree to the <Link className="link" to="/legal#terms" target="_blank" rel="noopener">Terms of Use</Link> and <Link className="link" to="/legal#privacy" target="_blank" rel="noopener">Privacy Notice</Link>.
              </span>
            </label>
            <FieldError id="signup-acceptTerms-error" message={errors.acceptTerms?.message} />
          </div>

          <button type="submit" className="btn btn-primary btn-lg w-full" disabled={isSubmitting}>
            {isSubmitting ? <><Spinner /> Creating your account…</> : 'Create account'}
          </button>
          <p className="auth-muted text-center text-xs text-slate-500">Your account can create projects, build and run workflows, and manage the projects you own.</p>
        </form>
      )}

      <p className="auth-muted mt-8 text-center text-sm text-slate-600 sm:hidden">
        Already have an account? <Link className="link" to="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
