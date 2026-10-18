import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, Logo } from '../../components/brand.jsx';

const HIGHLIGHTS = [
  ['studio', 'Studio designer', 'Drag-and-drop workflows with web, desktop, and document activities.'],
  ['robot', 'Robots', 'Run unattended on servers or attended on a desktop, with a full step log.'],
  ['tasks', 'Action Center', 'Pause for approvals and data validation, then resume automatically.'],
  ['shield', 'Governed by design', 'Roles, encrypted credentials, and an audit trail for every change.'],
];

/** Small product illustration: a workflow run, built in HTML so it stays sharp at any size. */
function RunPreview() {
  const steps = [
    ['Read invoices', 'Documents · 18 PDFs', 'done'],
    ['Extract fields', 'OCR · 0.94 confidence', 'done'],
    ['Approve > ₹50,000', 'Action Center', 'wait'],
    ['Post to ERP', 'Robot · browser', 'next'],
  ];
  return (
    <div className="rounded-xl border border-[#eadfd6] bg-white p-4 shadow-[0_12px_32px_rgba(23,33,37,0.08)]" aria-hidden="true">
      <div className="flex items-center justify-between border-b border-[#efe7e0] pb-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-teal" />
          <span className="text-xs font-medium text-slate-700">Invoice processing · Run #128</span>
        </div>
        <span className="rounded-full bg-[#e9f7f7] px-2 py-0.5 text-[11px] text-[#0d5d61]">Running</span>
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map(([title, detail, state]) => (
          <li key={title} className="flex items-center gap-3 rounded-lg bg-[#faf7f4] px-3 py-2">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${state === 'done' ? 'bg-teal text-white' : state === 'wait' ? 'bg-brand text-white' : 'border border-slate-300 text-slate-400'}`}>
              {state === 'done' ? <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.4} /> : state === 'wait' ? '!' : ''}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{title}</span>
              <span className="block truncate text-xs text-slate-500">{detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function useAuthOptions() {
  const [options, setOptions] = useState({ allowSignup: true, loaded: false });
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/options')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => { if (alive && payload?.data) setOptions({ ...payload.data, loaded: true }); })
      .catch(() => { if (alive) setOptions((current) => ({ ...current, loaded: true })); });
    return () => { alive = false; };
  }, []);
  return options;
}

export default function AuthLayout({ title, children, aside, topLink }) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · URAP`;
    return () => { document.title = previous; };
  }, [title]);
  return (
    <div className="auth-surface min-h-screen lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden border-r border-[#efe7e0] bg-gradient-to-br from-[#fff6f0] via-[#fffaf6] to-[#f3f8f8] text-ink lg:block">
        
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand/15 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-40 right-[-6rem] h-[28rem] w-[28rem] rounded-full bg-teal/15 blur-3xl" aria-hidden="true" />
        <div className="relative flex h-full min-h-screen flex-col gap-10 px-10 py-10 xl:px-16 xl:py-12">
          <Logo />
          <div className="flex flex-1 flex-col justify-center gap-10">
            {aside || (
              <>
                <div>
                  <p className="text-sm font-semibold text-brand">Universal RPA Automation Platform</p>
                  <h2 className="mt-3 max-w-md text-[2.1rem] font-bold leading-[1.15] tracking-[-0.025em] xl:text-[2.5rem]">
                    Automate the busywork. Keep people in control.
                  </h2>
                  <p className="mt-4 max-w-md text-base leading-relaxed text-slate-600">
                    Design, run, and govern automations for the web, desktop, and documents from one workspace.
                  </p>
                </div>
                <RunPreview />
                <ul className="grid gap-x-8 gap-y-5 xl:grid-cols-2">
                  {HIGHLIGHTS.map(([icon, name, body]) => (
                    <li key={name} className="flex gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-brand shadow-sm ring-1 ring-[#efe7e0]"><Icon name={icon} className="h-5 w-5" /></span>
                      <span>
                        <span className="block text-sm font-semibold text-ink">{name}</span>
                        <span className="mt-0.5 block text-sm leading-snug text-slate-600">{body}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <p className="text-xs text-slate-500">Self-hosted. Your workflows, files, and credentials stay on your infrastructure.</p>
        </div>
      </aside>

      <div className="relative isolate flex min-h-screen flex-col overflow-clip bg-[#fffdfb]">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(#e9ddd3_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_80%)]" aria-hidden="true" />
        <div className="pointer-events-none absolute -right-24 -top-24 -z-10 h-80 w-80 rounded-full bg-brand/10 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-32 left-10 -z-10 h-80 w-80 rounded-full bg-teal/10 blur-3xl" aria-hidden="true" />
        <header className="flex items-center justify-between gap-4 px-5 py-5 sm:px-10">
          <Logo className="lg:invisible" />
          {topLink && <p className="auth-muted hidden text-sm text-slate-600 sm:block">{topLink}</p>}
        </header>
        <main id="main" className="flex-1 px-5 sm:px-10 xl:px-16">
          <div className="flex items-center justify-center py-6 lg:sticky lg:top-0 lg:min-h-[calc(100vh-5rem)]">
          <div className="w-full max-w-[480px]">
            <div className="relative overflow-hidden rounded-2xl border border-[#efe4da] bg-white px-6 py-8 shadow-[0_24px_60px_-20px_rgba(23,33,37,0.18)] sm:px-9 sm:py-9">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand via-[#ff8a4c] to-teal" aria-hidden="true" />
              {children}
            </div>
            <ul className="auth-muted mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-500">
              {[['lock', 'Encrypted credentials'], ['shield', 'Role-based access'], ['audit', 'Full audit trail']].map(([icon, label]) => (
                <li key={label} className="flex items-center gap-1.5"><Icon name={icon} className="h-4 w-4 text-brand" />{label}</li>
              ))}
            </ul>
          </div>
          </div>
        </main>
        <footer className="auth-muted flex flex-wrap items-center justify-center gap-x-5 gap-y-2 px-5 pb-6 text-xs text-slate-500">
          <span>© {new Date().getFullYear()} URAP</span>
          <Link className="hover:text-ink hover:underline" to="/legal#terms">Terms</Link>
          <Link className="hover:text-ink hover:underline" to="/legal#privacy">Privacy</Link>
          <Link className="hover:text-ink hover:underline" to="/">Home</Link>
        </footer>
      </div>
    </div>
  );
}

export function Alert({ tone = 'error', children, id }) {
  if (!children) return null;
  const styles = tone === 'error' ? 'alert-error border-danger/25 bg-[#FEF3F2] text-danger' : 'alert-info border-teal/30 bg-[#EFFAFA] text-[#0D5D61]';
  return (
    <div id={id} role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm ${styles}`}>
      <Icon name={tone === 'error' ? 'alert' : 'info'} className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />;
}

export function FieldError({ id, message }) {
  if (!message) return null;
  return <p id={id} className="form-error"><Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{message}</p>;
}

export function PasswordInput({ id, show, onToggle, inputProps, invalid, describedBy, onCapsLock }) {
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        className="form-input pr-12"
        aria-invalid={invalid ? 'true' : 'false'}
        aria-describedby={describedBy}
        onKeyUp={(event) => onCapsLock?.(event.getModifierState?.('CapsLock'))}
        {...inputProps}
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-slate-500 hover:text-ink"
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        aria-controls={id}
      >
        <Icon name={show ? 'eyeOff' : 'eye'} className="h-5 w-5" />
      </button>
    </div>
  );
}
