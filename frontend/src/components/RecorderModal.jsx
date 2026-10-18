import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';
import { ErrorText, Modal, buttonClass, inputClass, quietClass } from './ui.jsx';
import { parseCodegen } from '../lib/codegenImport.js';
import { activityLabel } from '../lib/workflowGraph.js';

function StepPreview({ steps }) {
  if (!steps.length) return <p className="text-xs text-muted">No steps yet.</p>;
  return (
    <ol className="max-h-56 space-y-1 overflow-auto text-xs">
      {steps.map((step, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <li key={index} className="rounded border border-line px-2 py-1"><span className="font-medium">{activityLabel(step.type)}</span> · {step.name}{step.config?.selector ? <span className="font-mono text-muted"> · {step.config.selectorType}: {step.config.selector}</span> : null}</li>
      ))}
    </ol>
  );
}

/**
 * Web recorder: starts a browser on the API machine (POST /api/recorder/sessions), polls the
 * recorded steps, offers pick mode for selectors, and inserts the steps into the designer.
 * The second tab imports a Playwright codegen script instead.
 */
export default function RecorderModal({ onInsert, onPicks, onClose, initialTab = 'record' }) {
  const [tab, setTab] = useState(initialTab);
  const [url, setUrl] = useState('https://');
  const [headless, setHeadless] = useState(false);
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  function poll(id) {
    clearInterval(timer.current);
    timer.current = setInterval(async () => {
      try {
        const result = await api(`/api/recorder/sessions/${id}`);
        setSession(result.data);
        onPicks?.(result.data.picks || []);
        if (result.data.status !== 'recording') clearInterval(timer.current);
      } catch (err) {
        setError(err.message);
        clearInterval(timer.current);
      }
    }, 1000);
  }

  async function start() {
    setError('');
    try {
      const result = await api('/api/recorder/sessions', { method: 'POST', body: { url, headless } });
      setSession(result.data);
      if (result.data.error) setError(`The page did not load: ${result.data.error}`);
      poll(result.data.id);
    } catch (err) { setError(err.message); }
  }

  async function mode(next) {
    try { setSession((await api(`/api/recorder/sessions/${session.id}/mode`, { method: 'POST', body: { mode: next } })).data); } catch (err) { setError(err.message); }
  }

  async function stop() {
    clearInterval(timer.current);
    try { setSession((await api(`/api/recorder/sessions/${session.id}/stop`, { method: 'POST' })).data); } catch (err) { setError(err.message); }
  }

  const parsed = code.trim() ? parseCodegen(code) : { steps: [], skipped: [] };

  return (
    <Modal title="Record web steps" onClose={async () => { if (session?.status === 'recording') await stop(); onClose(); }}>
      <div className="mb-3 flex gap-2 text-sm">
        <button type="button" className={tab === 'record' ? buttonClass : quietClass} onClick={() => setTab('record')}>Recorder</button>
        <button type="button" className={tab === 'codegen' ? buttonClass : quietClass} onClick={() => setTab('codegen')}>Import Playwright codegen</button>
      </div>
      <ErrorText>{error}</ErrorText>
      {tab === 'record' ? (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted">A Chromium window opens on the machine that runs the URAP API. Click, type, and pick options there; each action becomes an activity. Password fields are never recorded: the Type Into step asks for a Credential connection instead. On a server without a screen, tick Headless or run <span className="font-mono">npm run record -- &lt;url&gt;</span> on your desktop and import the JSON.</p>
          {!session && (
            <>
              <input className={inputClass} aria-label="Start URL" value={url} onChange={(event) => setUrl(event.target.value)} />
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={headless} onChange={(event) => setHeadless(event.target.checked)} /> Headless (no window, for tests)</label>
              <button className={buttonClass} type="button" onClick={start}>Start recording</button>
            </>
          )}
          {session && (
            <>
              <p>Status <span className="font-medium">{session.status}</span> · mode <span className="font-medium">{session.mode}</span> · {session.events} events</p>
              {session.status === 'recording' && (
                <div className="flex flex-wrap gap-2">
                  <button className={quietClass} type="button" onClick={() => mode(session.mode === 'pick' ? 'record' : 'pick')}>{session.mode === 'pick' ? 'Back to recording' : 'Pick an element'}</button>
                  <button className={quietClass} type="button" onClick={stop}>Stop</button>
                </div>
              )}
              {session.picks?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold">Picked element selectors (best first)</p>
                  <ul className="mt-1 max-h-32 overflow-auto font-mono text-[11px]">{session.picks[0].element.candidates.map((candidate) => <li key={`${candidate.selectorType}:${candidate.selector}`}>{candidate.selectorType}: {candidate.selector}</li>)}</ul>
                  <p className="text-[11px] text-muted">Use them from the Target element field of the selected activity.</p>
                </div>
              )}
              <StepPreview steps={session.steps || []} />
              <button className={buttonClass} type="button" disabled={!session.steps?.length} onClick={async () => { if (session.status === 'recording') await stop(); onInsert(session.steps); }}>Insert {session.steps?.length || 0} steps</button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted">Run <span className="font-mono">npx playwright codegen https://your-site</span>, choose the JavaScript or Test target, and paste the generated code here. You can also paste a workflow JSON from <span className="font-mono">npm run record</span>.</p>
          <textarea className={`${inputClass} font-mono`} rows="8" aria-label="Codegen script" value={code} onChange={(event) => setCode(event.target.value)} placeholder="await page.goto('https://…');" />
          {(() => {
            let fromJson = null;
            try { const value = JSON.parse(code); fromJson = Array.isArray(value?.steps) ? value.steps.filter((step) => !['start', 'end'].includes(step.type)).map(({ id, next, ...rest }) => rest) : null; } catch { fromJson = null; }
            const steps = fromJson || parsed.steps;
            return (
              <>
                <StepPreview steps={steps} />
                {!fromJson && parsed.skipped.length > 0 && <p className="text-[11px] text-warning">Skipped {parsed.skipped.length} line(s): {parsed.skipped.slice(0, 3).join(' · ')}</p>}
                <button className={buttonClass} type="button" disabled={!steps.length} onClick={() => onInsert(steps)}>Insert {steps.length} steps</button>
              </>
            );
          })()}
        </div>
      )}
    </Modal>
  );
}
