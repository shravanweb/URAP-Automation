import { useState } from 'react';
import { Icon } from './brand.jsx';
import { availabilityLabel, CATEGORIES, categoryCounts, connectorLook, filterConnectors } from './connectorCatalog.js';

/** Connector catalog: search, category chips, and a card grid. `onUse(id)` preselects a connector. */
export default function ConnectorCatalog({ connectors = [], onUse, canAdd = false }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const counts = categoryCounts(connectors);
  const shown = filterConnectors(connectors, { category, query });
  return (
    <section className="rounded-2xl border border-[#E7E5E1] bg-white p-5" aria-labelledby="connector-catalog-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="connector-catalog-title" className="flex items-center gap-2 text-[17px] font-semibold text-ink">
            Connector catalog
            <span className="rounded-full bg-[#F3F2EF] px-2 py-0.5 text-xs font-medium text-muted">{connectors.length}</span>
          </h2>
          <p className="mt-1 text-sm text-muted">Building blocks for connections. Pick one to add a connection for a project.</p>
        </div>
        <label className="relative w-full sm:w-72">
          <span className="sr-only">Search connectors</span>
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="h-9 w-full rounded-lg border border-[#E7E5E1] bg-[#FAFAF9] pl-9 pr-3 text-sm outline-none transition focus:border-[#F2B79F] focus:bg-white focus:ring-2 focus:ring-[#FBE3D8]" placeholder="Search connectors" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Connector categories">
        {CATEGORIES.filter(([id]) => id === 'all' || counts[id]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={category === id} onClick={() => setCategory(id)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition ${category === id ? 'border-[#F2B79F] bg-[#FFF3EE] text-[#C2410C]' : 'border-[#E7E5E1] bg-white text-[#4B5563] hover:border-[#D6D3CE] hover:bg-[#FAFAF9]'}`}>
            {label}<span className={`text-xs ${category === id ? 'text-[#C2410C]/70' : 'text-muted'}`}>{counts[id] || 0}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-[#E7E5E1] py-8 text-center text-sm text-muted">No connectors match “{query}”.</p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((item) => {
            const look = connectorLook(item.id);
            const status = availabilityLabel(item.availability);
            return (
              <li key={item.id} className="group flex flex-col rounded-xl border border-[#ECEAE6] bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:border-[#E0DDD8] hover:shadow-[0_8px_24px_-12px_rgba(17,24,39,0.18)]">
                <div className="flex items-start gap-3">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${look.tint}`}><Icon name={look.icon} className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{item.displayName}</p>
                    <p className="truncate font-mono text-[11px] text-muted">{item.id}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${status.tone}`}>{status.label}</span>
                </div>
                <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-[13px] leading-5 text-[#4B5563]">{item.description}</p>
                {canAdd && (
                  <div className="mt-3 flex justify-end border-t border-[#F3F2EF] pt-3">
                    <button type="button" onClick={() => onUse?.(item.id)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-[#C2410C] transition hover:bg-[#FFF3EE]">
                      <Icon name="plus" className="h-3.5 w-3.5" /> Add connection
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
