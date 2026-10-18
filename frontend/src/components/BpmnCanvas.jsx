import { useEffect, useRef, useState } from 'react';
import { URAP_MODDLE } from '../lib/bpmnModdle.js';
import { Icon } from './brand.jsx';

// BPMN canvas built on bpmn-js (bpmn.io, see its license: the bpmn.io logo in the bottom-right
// corner must stay visible, so nothing is drawn over that corner). bpmn-js loads with a dynamic
// import: it is code-split from the rest of the app and never loads in server-side tests.
//   readOnly=false: the full modeler (palette, context pad, wrench/replace menu, lanes, labels).
//   readOnly=true: a navigated viewer for the run monitor (pan and zoom only).
// markers: { elementId: 'urap-done' | 'urap-active' | 'urap-failed' | 'urap-cancelled' | 'urap-error' }.

export default function BpmnCanvas({ xml, importKey, readOnly = false, markers = {}, onReady, onChanged, onSelect, onImportError, className = '' }) {
  const host = useRef(null);
  const instance = useRef(null);
  const applied = useRef({});
  const callbacks = useRef({});
  callbacks.current = { onReady, onChanged, onSelect, onImportError };
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [imported, setImported] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let created = null;
    (async () => {
      try {
        const [module] = await Promise.all([
          readOnly ? import('bpmn-js/lib/NavigatedViewer') : import('bpmn-js/lib/Modeler'),
          import('bpmn-js/dist/assets/diagram-js.css'),
          import('bpmn-js/dist/assets/bpmn-js.css'),
          import('bpmn-js/dist/assets/bpmn-font/css/bpmn.css'),
        ]);
        if (cancelled || !host.current) return;
        const Diagram = module.default;
        created = new Diagram({ container: host.current, moddleExtensions: { urap: URAP_MODDLE } });
        instance.current = created;
        if (!readOnly) {
          created.on('commandStack.changed', () => callbacks.current.onChanged?.());
          created.on('selection.changed', (event) => callbacks.current.onSelect?.(event.newSelection[0] || null));
          created.on('element.changed', (event) => {
            const selection = created.get('selection').get();
            if (selection[0] && selection[0].id === event.element.id) callbacks.current.onSelect?.(event.element);
          });
        } else {
          created.on('element.click', (event) => callbacks.current.onSelect?.(event.element?.type === 'bpmn:Process' || event.element?.type === 'bpmn:Collaboration' ? null : event.element));
        }
        setState('ready');
      } catch (err) {
        if (!cancelled) { setError(err.message); setState('failed'); }
      }
    })();
    return () => { cancelled = true; created?.destroy(); instance.current = null; applied.current = {}; };
  }, [readOnly]);

  // (Re)import when the diagram source changes (first load, import of a file, run version).
  useEffect(() => {
    if (state !== 'ready' || !instance.current || !xml) return;
    let cancelled = false;
    instance.current.importXML(xml).then(({ warnings }) => {
      if (cancelled) return;
      applied.current = {};
      instance.current.get('canvas').zoom('fit-viewport', 'auto');
      setImported((value) => value + 1);
      callbacks.current.onReady?.(instance.current, warnings || []);
    }).catch((err) => { if (!cancelled) callbacks.current.onImportError?.(err); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, importKey]);

  // Markers for validation problems and run states.
  useEffect(() => {
    if (state !== 'ready' || !instance.current || !imported) return;
    const canvas = instance.current.get('canvas');
    const registry = instance.current.get('elementRegistry');
    for (const [id, cls] of Object.entries(applied.current)) if (markers[id] !== cls && registry.get(id)) canvas.removeMarker(id, cls);
    const next = {};
    for (const [id, cls] of Object.entries(markers || {})) {
      if (!cls || !registry.get(id)) continue;
      if (applied.current[id] !== cls) canvas.addMarker(id, cls);
      next[id] = cls;
    }
    applied.current = next;
  });

  const zoom = (factor) => {
    const canvas = instance.current?.get('canvas');
    if (!canvas) return;
    if (factor === 'fit') canvas.zoom('fit-viewport', 'auto');
    else canvas.zoom(Math.min(4, Math.max(0.2, canvas.zoom() * factor)));
  };

  return (
    <div className={`urap-bpmn relative h-full w-full bg-[#FCFBFA] ${className}`}>
      <div ref={host} className="absolute inset-0" data-testid="bpmn-host" />
      {state === 'loading' && <div className="absolute inset-0 grid place-items-center text-[13px] text-slate-500" role="status">Loading the BPMN canvas…</div>}
      {state === 'failed' && <div className="absolute inset-0 grid place-items-center px-6 text-center text-[13px] text-danger" role="alert">The BPMN canvas could not load: {error}</div>}
      {state === 'ready' && (
        <div className="absolute right-4 top-4 flex overflow-hidden rounded-lg bg-white shadow-[0_1px_2px_rgba(16,24,40,0.06)] ring-1 ring-[#ECE8E3]" role="group" aria-label="Zoom">
          <button type="button" className="grid h-8 w-8 place-items-center text-slate-600 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}><Icon name="zoomOut" className="h-3.5 w-3.5" /></button>
          <button type="button" className="h-8 border-x border-[#ECE8E3] px-2.5 text-[12px] font-semibold text-slate-600 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Fit to screen" onClick={() => zoom('fit')}>Fit</button>
          <button type="button" className="grid h-8 w-8 place-items-center text-slate-600 hover:bg-[#F6F4F1] hover:text-ink" aria-label="Zoom in" onClick={() => zoom(1.2)}><Icon name="zoomIn" className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </div>
  );
}

/** PNG from the SVG export (2x, white background). Browser only. */
export async function svgToPng(svg) {
  const view = svg.match(/viewBox="([-\d.\s]+)"/);
  const [, , w = 800, h = 600] = view ? view[1].trim().split(/\s+/).map(Number) : [];
  const width = Math.ceil(Number(svg.match(/width="([\d.]+)"/)?.[1]) || w);
  const height = Math.ceil(Number(svg.match(/height="([\d.]+)"/)?.[1]) || h);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Could not render the diagram')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = width * 2; canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(2, 2); ctx.drawImage(image, 0, 0, width, height);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
