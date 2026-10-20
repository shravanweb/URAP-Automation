import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api.js';
import { buildRunInput, inputFields, publishedSteps } from '../lib/runInput.js';
import { templateByKey } from '../lib/workflowTemplates.js';

// Asks for the real values a run needs before queuing it. Nothing is pre-filled with sample data;
// Run stays blocked until every required field has a value.
export function RunInputDialog({ title, fields, initial = {}, onCancel, onSubmit }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((field) => [field.name, initial[field.name] ?? ''])));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const result = buildRunInput(fields, values);
    if (result.error) { setError(result.error); return; }
    setBusy(true);
    try { await onSubmit(result.input); } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#14213D]/30 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="run-input-title">
      <form onSubmit={submit} noValidate className="w-full max-w-md rounded-2xl border border-[#ECE6DF] bg-white p-6 shadow-[0_24px_60px_-24px_rgba(20,33,61,0.35)]">
        <h2 id="run-input-title" className="text-[17px] font-semibold tracking-[-0.01em] text-ink">Run {title}</h2>
        <p className="mt-1 text-[13px] text-slate-500">This workflow needs input. Enter the real values for this run.</p>
        <div className="mt-5 space-y-4">
          {fields.map((field) => (
            <label key={field.name} className="block">
              <span className="mb-1 flex items-center gap-1 text-[13px] font-medium text-ink">{field.label}{field.required !== false && <span className="text-[#E03A0E]" aria-hidden="true">*</span>}</span>
              {field.type === 'textarea' || field.type === 'json' ? (
                <textarea rows={3} required={field.required !== false} className="w-full rounded-lg border border-[#E2DCD5] bg-white px-3 py-2 text-[13px] text-ink placeholder:text-slate-400 focus:border-[#FA4616] focus:outline-none focus:ring-2 focus:ring-[#FA4616]/15" placeholder={field.placeholder || field.label} value={values[field.name]} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />
              ) : (
                <input type={field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : 'text'} required={field.required !== false} className="h-9 w-full rounded-lg border border-[#E2DCD5] bg-white px-3 text-[13px] text-ink placeholder:text-slate-400 focus:border-[#FA4616] focus:outline-none focus:ring-2 focus:ring-[#FA4616]/15" placeholder={field.placeholder || field.label} value={values[field.name]} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />
              )}
              {field.hint && <span className="mt-1 block text-[12px] text-slate-500">{field.hint}</span>}
            </label>
          ))}
        </div>
        {error && <p className="mt-4 rounded-lg border border-[#F4C7C1] bg-[#FEF3F2] px-3 py-2 text-[13px] text-[#B42318]" role="alert">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-9 rounded-lg border border-[#E2DCD5] bg-white px-4 text-[13px] font-semibold text-ink hover:bg-[#FAF8F5]">Cancel</button>
          <button type="submit" disabled={busy} className="h-9 rounded-lg bg-[#FA4616] px-4 text-[13px] font-semibold text-white hover:bg-[#E23D12] disabled:opacity-60">{busy ? 'Starting…' : 'Run'}</button>
        </div>
      </form>
    </div>
  );
}

/**
 * Hook for any Run button: loads the published definition (unless steps are given), and either
 * runs straight away (no input needed) or opens RunInputDialog first.
 * Returns [run(workflow, options), dialogElement].
 */
export function useRunWorkflow({ onError } = {}) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(null);
  async function queue(workflow, input, testRun) {
    const job = await api(`/api/workflows/${workflow.id}/run`, { method: 'POST', body: { ...(testRun ? { testRun: true } : {}), input } });
    navigate(`/jobs/${job.data.id}`);
  }
  async function run(workflow, { steps, testRun = false, initial = {}, templateKey } = {}) {
    try {
      const definitionSteps = steps || publishedSteps((await api(`/api/workflows/${workflow.id}`)).data);
      const fields = inputFields(definitionSteps, templateByKey(templateKey)?.inputFields || []);
      if (!fields.length) { await queue(workflow, {}, testRun); return; }
      setPending({ workflow, fields, testRun, initial });
    } catch (err) { onError?.(err); }
  }
  const dialog = pending ? (
    <RunInputDialog
      title={pending.workflow.name || 'workflow'}
      fields={pending.fields}
      initial={pending.initial}
      onCancel={() => setPending(null)}
      onSubmit={async (input) => { await queue(pending.workflow, input, pending.testRun); setPending(null); }}
    />
  ) : null;
  return [run, dialog];
}
