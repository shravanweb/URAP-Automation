import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './brand.jsx';

// Lightweight SVG/HTML flow canvas (no graph library): nodes are positioned cards, edges are
// bezier paths in an SVG layer. Editable mode supports dragging nodes, dropping palette items,
// and drawing connections from a node's output port; read-only mode shows run statuses.

export const NODE_W = 200;
export const NODE_H = 68;
export const CANVAS_W = 3000;
export const CANVAS_H = 1800;

export const NODE_META = {
  start: { label: 'Start', icon: 'startNode', tone: 'bg-[#ECF7EF] text-[#1F6B3A]', body: 'Where the process begins: manually, on a schedule, or from a webhook.' },
  robot: { label: 'Robot task', icon: 'robot', tone: 'bg-[#FFF1EC] text-[#D63A0C]', body: 'Run a published URAP workflow and wait for the job to finish.' },
  agent: { label: 'Agent', icon: 'agent', tone: 'bg-[#EEF4FF] text-[#3550B5]', body: 'Run a published AI agent with inputs and store its output.' },
  case: { label: 'Create case', icon: 'briefcase', tone: 'bg-[#FDF2EC] text-[#B4471B]', body: 'Open a case of a published case type, optionally waiting until it is resolved.' },
  human: { label: 'Human task', icon: 'human', tone: 'bg-[#F1EEFB] text-[#5B47B8]', body: 'Send an approval or form to Action Center and wait for a person.' },
  decision: { label: 'Decision', icon: 'decision', tone: 'bg-[#FDF5E6] text-[#8A5A0B]', body: 'Choose a branch by comparing variables.' },
  parallel: { label: 'Parallel split', icon: 'parallel', tone: 'bg-[#EAF1FB] text-[#2F5FA8]', body: 'Start every outgoing branch at the same time.' },
  join: { label: 'Join', icon: 'join', tone: 'bg-[#EAF1FB] text-[#2F5FA8]', body: 'Wait until all incoming branches have arrived.' },
  timer: { label: 'Timer', icon: 'clock', tone: 'bg-[#E8F6F6] text-[#127C81]', body: 'Pause the process for a set time.' },
  http: { label: 'HTTP call', icon: 'api', tone: 'bg-slate-100 text-slate-700', body: 'Call a REST API through a project connection.' },
  end: { label: 'End', icon: 'endNode', tone: 'bg-slate-100 text-ink', body: 'Finish this branch of the process.' },
};

export const RUN_STATUS = {
  SUCCEEDED: { label: 'Completed', ring: 'ring-2 ring-[#2E9E57]/55', badge: 'bg-[#ECF7EF] text-[#1F6B3A]', icon: 'check' },
  WAITING: { label: 'Waiting', ring: 'ring-2 ring-[#D99A1E]/60', badge: 'bg-[#FDF5E6] text-[#8A5A0B]', icon: 'clock' },
  READY: { label: 'Running', ring: 'ring-2 ring-[#3A75D0]/55', badge: 'bg-[#EAF1FB] text-[#2F5FA8]', icon: 'play' },
  FAILED: { label: 'Failed', ring: 'ring-2 ring-[#D9382B]/60', badge: 'bg-[#FDEEEC] text-[#A8261B]', icon: 'alert' },
  CANCELLED: { label: 'Cancelled', ring: 'ring-1 ring-slate-300', badge: 'bg-slate-100 text-slate-600', icon: 'close' },
};

export function edgePath(from, to) {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const dx = Math.max(48, Math.abs(x2 - x1) / 2);
  return { d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } };
}

export function nodeSummary(node, lookups = {}) {
  const config = node.config || {};
  switch (node.type) {
    case 'start': return config.trigger === 'schedule' ? `Schedule · ${config.cron || 'no cron'}` : config.trigger === 'webhook' ? 'Webhook' : 'Manual start';
    case 'robot': return lookups.workflows?.find((item) => item.id === config.workflowId)?.name || (config.workflowId ? 'Workflow' : 'Choose a workflow');
    case 'agent': return lookups.agents?.find((item) => item.id === config.agentId)?.name || (config.agentId ? 'Agent' : 'Choose an agent');
    case 'human': return config.title || 'Untitled task';
    case 'case': return lookups.caseTypes?.find((item) => item.id === config.caseTypeId)?.name || (config.caseTypeId ? 'Case type' : 'Choose a case type');
    case 'timer': return config.seconds ? formatSeconds(Number(config.seconds)) : 'Set a delay';
    case 'http': return `${String(config.method || 'GET').toUpperCase()} ${config.path || '/'}`;
    case 'decision': return 'If / else';
    default: return NODE_META[node.type]?.label || node.type;
  }
}

export function formatSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? '' : 's'}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

const snap = (value) => Math.round(value / 8) * 8;

// Zoom and scroll offsets that bring the whole graph into a viewport of the given size.
export function fitView(definition, width, height, { min = 0.7, max = 1, pad = 48 } = {}) {
  const nodes = definition?.nodes || [];
  if (!nodes.length || !width || !height) return { zoom: 1, left: 0, top: 0 };
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const boundsW = Math.max(...nodes.map((node) => node.x)) + NODE_W - minX + pad * 2;
  const boundsH = Math.max(...nodes.map((node) => node.y)) + NODE_H - minY + pad * 2;
  const zoom = +Math.max(min, Math.min(max, width / boundsW, height / boundsH)).toFixed(2);
  const left = Math.max(0, Math.round((minX - pad) * zoom - Math.max(0, (width - boundsW * zoom) / 2)));
  const top = Math.max(0, Math.round((minY - pad) * zoom - Math.max(0, (height - boundsH * zoom) / 2)));
  return { zoom, left, top };
}

export default function FlowCanvas({
  definition, editable = false, selected = null, onSelect = () => {}, onChange = () => {}, onDropNode = null,
  nodeStates = {}, problems = {}, lookups = {}, zoom = 1, height = 'h-full', fitKey = null, onZoom = null,
}) {
  const surface = useRef(null);
  const viewport = useRef(null);
  const pendingScroll = useRef(null);
  const latest = useRef(definition);
  latest.current = definition;

  // Fit the graph once per fitKey (e.g. when a flow or run first loads).
  useLayoutEffect(() => {
    if (fitKey == null || !viewport.current) return;
    const view = fitView(latest.current, viewport.current.clientWidth, viewport.current.clientHeight);
    pendingScroll.current = view;
    if (onZoom && view.zoom !== zoom) onZoom(view.zoom);
    else viewport.current.scrollTo?.(view.left, view.top);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  useEffect(() => {
    if (!pendingScroll.current || !viewport.current) return;
    if (pendingScroll.current.zoom === zoom) viewport.current.scrollTo?.(pendingScroll.current.left, pendingScroll.current.top);
    pendingScroll.current = null;
  }, [zoom, fitKey]);
  const [drag, setDrag] = useState(null);
  const [link, setLink] = useState(null);
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));

  const point = (event) => {
    const rect = surface.current.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
  };

  const moveNode = (id, x, y) => onChange({
    ...definition,
    nodes: definition.nodes.map((node) => (node.id === id ? { ...node, x: Math.max(0, Math.min(CANVAS_W - NODE_W, snap(x))), y: Math.max(0, Math.min(CANVAS_H - NODE_H, snap(y))) } : node)),
  });

  const connect = (from, to) => {
    if (!from || !to || from === to) return;
    if (definition.edges.some((edge) => edge.from === from && edge.to === to)) return;
    const source = byId.get(from);
    const target = byId.get(to);
    if (!source || !target || source.type === 'end' || target.type === 'start') return;
    let edges = definition.edges;
    // Single-exit steps re-point their connection instead of adding a second one.
    if (!['decision', 'parallel'].includes(source.type)) edges = edges.filter((edge) => edge.from !== from);
    const edge = { id: `e_${Math.random().toString(36).slice(2, 9)}`, from, to };
    if (source.type === 'decision') {
      const siblings = edges.filter((item) => item.from === from);
      Object.assign(edge, siblings.some((item) => item.isDefault) || !siblings.length ? { label: `Branch ${siblings.length + 1}`, condition: { left: '', op: 'eq', right: '' } } : { label: 'Otherwise', isDefault: true });
    }
    onChange({ ...definition, edges: [...edges, edge] });
    onSelect({ kind: 'edge', id: edge.id });
  };

  const onPointerMove = (event) => {
    if (drag) {
      const p = point(event);
      moveNode(drag.id, p.x - drag.dx, p.y - drag.dy);
    } else if (link) {
      setLink({ ...link, ...point(event) });
    }
  };
  const onPointerUp = (event) => {
    if (link) {
      const target = document.elementsFromPoint?.(event.clientX, event.clientY).map((el) => el.closest?.('[data-node-id]')).find(Boolean);
      connect(link.from, target?.getAttribute('data-node-id'));
    }
    setDrag(null);
    setLink(null);
  };

  const traversed = (edge) => {
    const source = nodeStates[edge.from];
    return source?.status === 'SUCCEEDED' && Boolean(nodeStates[edge.to]);
  };

  return (
    <div ref={viewport} className={`relative overflow-auto bg-[#FAF9F7] ${height}`} data-flow-canvas>
      <div style={{ width: CANVAS_W * zoom, height: CANVAS_H * zoom }}>
        <div
          ref={surface}
          className="bg-dots relative origin-top-left"
          style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${zoom})` }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => { setDrag(null); setLink(null); }}
          onPointerDown={(event) => { if (event.target === event.currentTarget) onSelect(null); }}
          onDragOver={(event) => { if (editable && onDropNode) event.preventDefault(); }}
          onDrop={(event) => {
            if (!editable || !onDropNode) return;
            const type = event.dataTransfer.getData('application/x-urap-flow-node');
            if (!type) return;
            event.preventDefault();
            const p = point(event);
            onDropNode(type, snap(p.x - NODE_W / 2), snap(p.y - NODE_H / 2));
          }}
        >
          <svg className="pointer-events-none absolute inset-0" width={CANVAS_W} height={CANVAS_H} aria-hidden="true">
            <defs>
              <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#B9B1A9" /></marker>
              <marker id="flow-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2E9E57" /></marker>
              <marker id="flow-arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#D63A0C" /></marker>
            </defs>
            {definition.edges.map((edge) => {
              const from = byId.get(edge.from);
              const to = byId.get(edge.to);
              if (!from || !to) return null;
              const { d } = edgePath(from, to);
              const isSelected = selected?.kind === 'edge' && selected.id === edge.id;
              const on = traversed(edge);
              const stroke = isSelected ? '#D63A0C' : on ? '#2E9E57' : problems[`edge:${edge.id}`] ? '#D9382B' : '#C9C1B9';
              return (
                <g key={edge.id}>
                  <path d={d} fill="none" stroke={stroke} strokeWidth={isSelected || on ? 2.2 : 1.6} strokeDasharray={edge.isDefault ? '5 4' : undefined} markerEnd={`url(#${isSelected ? 'flow-arrow-sel' : on ? 'flow-arrow-on' : 'flow-arrow'})`} />
                  {editable && <path d={d} fill="none" stroke="transparent" strokeWidth={14} className="pointer-events-auto cursor-pointer" onPointerDown={(event) => { event.stopPropagation(); onSelect({ kind: 'edge', id: edge.id }); }} />}
                </g>
              );
            })}
            {link && (() => {
              const from = byId.get(link.from);
              if (!from) return null;
              return <path d={edgePath(from, { x: link.x, y: link.y - NODE_H / 2 }).d} fill="none" stroke="#D63A0C" strokeWidth={1.8} strokeDasharray="4 4" />;
            })()}
          </svg>

          {definition.edges.map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to || (!edge.label && !edge.isDefault)) return null;
            const { mid } = edgePath(from, to);
            const isSelected = selected?.kind === 'edge' && selected.id === edge.id;
            return (
              <button
                key={`label-${edge.id}`}
                type="button"
                tabIndex={editable ? 0 : -1}
                className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium shadow-[0_1px_2px_rgba(16,24,40,0.05)] ${isSelected ? 'border-[#F3B9A4] bg-[#FFF6F2] text-ember' : 'border-[#ECE8E3] bg-white text-slate-600'}`}
                style={{ left: mid.x, top: mid.y }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => editable && onSelect({ kind: 'edge', id: edge.id })}
              >
                {edge.label || 'Otherwise'}{edge.isDefault && edge.label ? ' · default' : ''}
              </button>
            );
          })}

          {definition.nodes.map((node) => {
            const meta = NODE_META[node.type] || NODE_META.end;
            const isSelected = selected?.kind === 'node' && selected.id === node.id;
            const state = nodeStates[node.id];
            const status = state ? RUN_STATUS[state.status] : null;
            const issue = problems[node.id];
            const dim = Object.keys(nodeStates).length > 0 && !state;
            return (
              <div
                key={node.id}
                data-node-id={node.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`${meta.label}: ${node.name || node.id}${status ? `, ${status.label}` : ''}${issue ? `, ${issue}` : ''}`}
                className={`group absolute flex select-none items-center gap-3 rounded-xl border bg-white px-3 text-left shadow-[0_1px_2px_rgba(16,24,40,0.05),0_2px_6px_-2px_rgba(16,24,40,0.06)] transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ember/40 ${editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${isSelected ? 'border-[#F3B9A4] ring-2 ring-ember/25' : issue ? 'border-[#F4C7C1]' : 'border-[#ECE8E3] hover:border-[#E2DCD5] hover:shadow-[0_2px_4px_rgba(16,24,40,0.05),0_10px_20px_-10px_rgba(16,24,40,0.14)]'} ${status?.ring || ''} ${dim ? 'opacity-55' : ''}`}
                style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H, touchAction: 'none' }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelect({ kind: 'node', id: node.id });
                  if (!editable || event.button !== 0) return;
                  const p = point(event);
                  setDrag({ id: node.id, dx: p.x - node.x, dy: p.y - node.y });
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect({ kind: 'node', id: node.id }); return; }
                  if (!editable || !event.key.startsWith('Arrow')) return;
                  event.preventDefault();
                  const step = event.shiftKey ? 40 : 8;
                  const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
                  const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
                  moveNode(node.id, node.x + dx, node.y + dy);
                }}
              >
                <span className={`u-tile grid h-9 w-9 shrink-0 place-items-center rounded-lg ${meta.tone}`}><Icon name={meta.icon} className="h-[18px] w-[18px]" strokeWidth={1.8} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold leading-5 text-ink">{node.name || meta.label}</span>
                  <span className="block truncate text-[11.5px] leading-4 text-slate-500">{nodeSummary(node, lookups)}</span>
                </span>
                {status && <span className={`absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full ${status.badge} ring-2 ring-white`} title={status.label}><Icon name={status.icon} className="h-3 w-3" strokeWidth={2.4} /></span>}
                {!status && issue && <span className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-[#FDEEEC] text-[#A8261B] ring-2 ring-white" title={issue}><Icon name="alert" className="h-3 w-3" strokeWidth={2.4} /></span>}
                {node.type !== 'start' && <span className="absolute -left-[5px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-white bg-[#C9C1B9]" aria-hidden="true" />}
                {editable && node.type !== 'end' && (
                  <span
                    className="absolute -right-[7px] top-1/2 grid h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair place-items-center rounded-full border-2 border-white bg-ember shadow-[0_0_0_1px_rgba(214,58,12,0.25)] transition-transform hover:scale-125"
                    title="Drag to connect"
                    aria-hidden="true"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      const p = point(event);
                      setLink({ from: node.id, ...p });
                    }}
                  />
                )}
                {!editable && node.type !== 'end' && <span className="absolute -right-[5px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-white bg-[#C9C1B9]" aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
