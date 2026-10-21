import { Icon } from './brand.jsx';
const LABELS = {
  QUEUED: 'Queued', CLAIMED: 'Claimed', RUNNING: 'Running', SUCCEEDED: 'Succeeded', FAILED: 'Failed',
  RETRY_WAIT: 'Retry wait', CANCEL_REQUESTED: 'Cancel requested', CANCELLED: 'Cancelled', SKIPPED: 'Skipped',
  DRAFT: 'Draft', active: 'Active', archived: 'Archived', published: 'Published', disabled: 'Disabled',
  available: 'Available', unavailable: 'Unavailable', untested: 'Untested', unknown: 'Unknown',
  draft: 'Draft', retired: 'Retired', NEW: 'New', IN_PROGRESS: 'In progress', SUCCESSFUL: 'Successful',
  ABANDONED: 'Abandoned', DELETED: 'Deleted', TRIGGERED: 'Triggered', requires_robot: 'Requires robot',
  SUSPENDED: 'Waiting for task', pending: 'Pending', completed: 'Completed', cancelled: 'Cancelled',
};

const TONES = {
  SUCCEEDED: 'bg-success text-white', FAILED: 'bg-danger text-white', RUNNING: 'bg-ember text-white',
  QUEUED: 'bg-sand text-ink', CANCELLED: 'bg-muted text-white', SKIPPED: 'bg-line text-ink',
  published: 'bg-success text-white', active: 'bg-success text-white', archived: 'bg-muted text-white',
  available: 'bg-success text-white', unavailable: 'bg-danger text-white',
  SUCCESSFUL: 'bg-success text-white', TRIGGERED: 'bg-success text-white', IN_PROGRESS: 'bg-ember text-white',
  NEW: 'bg-sand text-ink', ABANDONED: 'bg-warning text-white', CLAIMED: 'bg-ember text-white',
  RETRY_WAIT: 'bg-warning text-white', CANCEL_REQUESTED: 'bg-warning text-white', disabled: 'bg-muted text-white',
  SUSPENDED: 'bg-charcoal text-white', pending: 'bg-warning text-white', completed: 'bg-success text-white', cancelled: 'bg-muted text-white',
};

export function StatusBadge({ status }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TONES[status] || 'bg-cream2 text-ink'}`}>{LABELS[status] || status}</span>;
}

export function EmptyState({ title, body }) {
  return <div className="rounded-lg border border-dashed border-sand bg-mist px-4 py-8 text-center"><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 text-sm text-muted">{body}</p></div>;
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <p className="rounded-lg border border-danger/20 bg-[#FEF3F2] px-3 py-2 text-sm text-danger" role="alert">{children}</p>;
}

export function Modal({ title, subtitle, icon, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 shadow-lift">
        {icon ? (
          <div className="mb-4 flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#FFF1EA] text-[#E03A0E]"><Icon name={icon} className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1"><h2 className="text-[17px] font-semibold leading-6 text-[#1F2933]">{title}</h2>{subtitle && <p className="truncate text-[13px] text-[#6B7280]" title={subtitle}>{subtitle}</p>}</div>
            <button type="button" onClick={onClose} aria-label="Close" title="Close" className="grid h-8 w-8 place-items-center rounded-lg text-[#6B7280] hover:bg-[#F5F2EE] hover:text-[#1F2933]"><Icon name="close" className="h-4 w-4" /></button>
          </div>
        ) : (
          <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button type="button" onClick={onClose} className="text-muted">Close</button></div>
        )}
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium">{label}</span>{children}</label>;
}

export const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink shadow-sm placeholder:text-slate-400 focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15';
export const buttonClass = 'rounded-lg bg-ember px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emberdark disabled:cursor-not-allowed disabled:opacity-60';
export const quietClass = 'rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-ink hover:bg-slate-50 disabled:opacity-60';
