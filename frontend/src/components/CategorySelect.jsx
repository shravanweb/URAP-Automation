import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './brand.jsx';

// Project category select: a floating, portal-rendered listbox (never resizes the modal it sits
// in), positioned under the trigger at the trigger's width and flipped up when there is no room.
// Search as you type, arrow keys / Enter / Escape, click outside to close. The value is the
// category slug; `allowCustom` offers 'Use "text"' for a typed slug (old datalist behaviour) and
// `emptyLabel` adds a "no value" row (the "Any category" filter).
const CATEGORY_ICONS = {
  erp: 'briefcase', crm: 'users', hrms: 'badge', hr: 'badge', ecommerce: 'card', finance: 'hash',
  excel: 'table', web: 'globe', api: 'api', documents: 'document', email: 'mail', testing: 'check',
  reporting: 'chart', general: 'grid',
};
export const categoryIcon = (code) => CATEGORY_ICONS[code] || 'folder';

function Tile({ icon, tone = 'neutral' }) {
  const look = tone === 'accent' ? 'bg-[#FFF1EA] text-[#E03A0E]' : 'bg-[#F5F2EE] text-[#4A5568]';
  return <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${look}`}><Icon name={icon} className="h-4 w-4" /></span>;
}

export default function CategorySelect({ categories, value, onChange, allowCustom = false, emptyLabel, placeholder = 'Choose a category', ariaLabel = 'Category', invalid = false }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState(null);
  const trigger = useRef(null);
  const popover = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const options = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = categories
      .filter((item) => !needle || `${item.label} ${item.code} ${item.description || ''}`.toLowerCase().includes(needle))
      .map((item) => ({ code: item.code, label: item.label, icon: categoryIcon(item.code) }));
    const slug = needle.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    if (allowCustom && slug.length >= 2 && !categories.some((item) => item.code === slug)) rows.push({ code: slug, label: `Use “${slug}”`, icon: 'plus', custom: true });
    if (emptyLabel && !needle) rows.unshift({ code: '', label: emptyLabel, icon: 'grid' });
    return rows;
  }, [categories, search, allowCustom, emptyLabel]);

  const selected = categories.find((item) => item.code === value);
  const display = selected ? selected.label : value || emptyLabel || '';
  const displayIcon = selected ? categoryIcon(selected.code) : value ? 'folder' : 'grid';

  // Position under the trigger (fixed, so scrolling modals never clip or grow); flip up if needed.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const height = Math.min(popover.current?.offsetHeight || 340, 340);
      const below = window.innerHeight - rect.bottom;
      const up = below < height + 12 && rect.top > below;
      setPlace({ left: rect.left, width: rect.width, top: up ? undefined : rect.bottom + 6, bottom: up ? window.innerHeight - rect.top + 6 : undefined, up });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) { setShown(false); return undefined; }
    setSearch('');
    const index = options.findIndex((item) => item.code === (value || ''));
    setActive(index >= 0 ? index : 0);
    const frame = requestAnimationFrame(() => { setShown(true); searchRef.current?.focus(); });
    const onDown = (event) => { if (!trigger.current?.contains(event.target) && !popover.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('mousedown', onDown); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, open]);

  function choose(item) { onChange(item.code); setOpen(false); trigger.current?.focus(); }
  function onKey(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); if (!open) setOpen(true); else setActive((index) => Math.min(index + 1, options.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
    else if (event.key === 'Enter') { if (open) { event.preventDefault(); if (options[active]) choose(options[active]); } }
    else if (event.key === 'Escape') { if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }
    else if (event.key === 'Tab' && open) setOpen(false);
  }

  const panel = open && typeof document !== 'undefined' ? createPortal(
    <div
      ref={popover}
      onKeyDown={onKey}
      style={{ position: 'fixed', left: place?.left ?? -9999, width: place?.width, top: place?.top, bottom: place?.bottom, zIndex: 70 }}
      className={`overflow-hidden rounded-xl border border-[#E9E4DE] bg-white shadow-[0_18px_44px_-14px_rgba(20,33,61,0.22),0_3px_8px_-2px_rgba(20,33,61,0.06)] transition-[opacity,transform] duration-150 ease-out ${place?.up ? 'origin-bottom' : 'origin-top'} ${shown && place ? 'scale-100 opacity-100' : `scale-[0.97] opacity-0 ${place?.up ? 'translate-y-1' : '-translate-y-1'}`}`}
    >
      <div className="flex items-center gap-2 border-b border-[#F1EEEA] px-3.5">
        <Icon name="search" className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          ref={searchRef}
          value={search}
          onChange={(event) => { setSearch(event.target.value); setActive(0); }}
          placeholder="Search categories…"
          aria-label="Search categories"
          aria-controls={listId}
          aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
          className="h-11 w-full border-0 bg-transparent p-0 text-[13.5px] text-ink placeholder:text-slate-400 shadow-none outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0"
        />
      </div>
      <ul ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} className="max-h-[280px] overflow-y-auto p-1.5 [scrollbar-color:#E2DCD5_transparent] [scrollbar-width:thin]">
        {options.length === 0 && <li className="px-3 py-8 text-center text-[13px] text-slate-500">No categories match “{search}”.</li>}
        {options.map((item, index) => {
          const isSelected = (value || '') === item.code && !item.custom;
          return (
            <li
              key={`${item.code}${item.custom ? '-custom' : ''}`}
              id={`${listId}-${index}`}
              data-index={index}
              role="option"
              aria-selected={isSelected}
              onMouseMove={() => { if (active !== index) setActive(index); }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
              className={`flex h-10 cursor-pointer items-center gap-3 rounded-lg px-2.5 text-[13.5px] transition-colors ${isSelected ? 'bg-[#FFF6F1]' : index === active ? 'bg-[#F7F5F2]' : ''}`}
            >
              <Tile icon={item.icon} tone={isSelected ? 'accent' : 'neutral'} />
              <span className={`min-w-0 flex-1 truncate ${isSelected ? 'font-semibold text-ink' : 'text-[#2B3441]'}`}>{item.label}</span>
              {isSelected && <Icon name="check" className="h-4 w-4 shrink-0 text-[#FA4616]" />}
            </li>
          );
        })}
      </ul>
    </div>,
    document.body,
  ) : null;

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        onKeyDown={onKey}
        onClick={() => setOpen((state) => !state)}
        className={`flex h-10 w-full items-center gap-2.5 rounded-lg border bg-white pl-2 pr-3 text-left text-sm text-ink shadow-sm transition-colors focus:border-ember focus:outline-none focus:ring-2 focus:ring-brand/15 ${open ? 'border-ember ring-2 ring-brand/15' : invalid ? 'border-[#E5A39B]' : 'border-slate-300 hover:border-slate-400'}`}
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#F5F2EE] text-[#4A5568]"><Icon name={displayIcon} className="h-3.5 w-3.5" /></span>
        <span className={`min-w-0 flex-1 truncate ${display ? '' : 'text-slate-400'}`}>{display || placeholder}</span>
        <Icon name="chevronDown" className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {panel}
    </div>
  );
}
