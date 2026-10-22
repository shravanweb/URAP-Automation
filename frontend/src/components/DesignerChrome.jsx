import { useRef, useState } from 'react';
import { Icon } from './brand.jsx';
import { ACTIVITIES } from '../lib/workflowGraph.js';

// Visual building blocks for the Workflow Designer: activity icons, small glyphs the shared
// icon set does not have, and a JSON editor box with a line-number gutter.

const GLYPHS = {
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M9 12h6M12 9v6',
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  exitFullscreen: 'M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4',
  kebab: 'M12 5.5h.01M12 12h.01M12 18.5h.01',
  collapse: 'M15 6l-6 6 6 6',
  expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  help: 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17h.01M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z',
  redo: 'M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h2',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
};

export function Glyph({ name, className = 'h-4 w-4', strokeWidth = 1.8 }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={GLYPHS[name]} />
    </svg>
  );
}

/** [background, foreground] per activity group. */
const GROUP_TONE = {
  Control: ['#FFF1EC', '#D63A0C'], Data: ['#E8F5EC', '#1D7A46'], Web: ['#EAF1FB', '#2F6FD0'], Desktop: ['#F1EDFB', '#6941C6'],
  Documents: ['#FDF5E6', '#B26B00'], 'Action Center': ['#E6F6F4', '#0E7C70'], Orchestrator: ['#FFF4E8', '#C2410C'], Integration: ['#EEF0FB', '#4450B5'], Robot: ['#F2F4F7', '#344054'],
};
/** type -> [icon, background, foreground]; anything missing uses its group tone. */
const TYPE_STYLE = {
  start: ['play', '#E7F6EC', '#1F8A4C'], end: ['stop', '#FDEEEC', '#D92D20'],
  for_each: ['refresh', '#EAF1FB', '#2F6FD0'], if_else: ['decision', '#FFF1EC', '#E0631F'], call_subworkflow: ['flow', '#F1EDFB', '#6941C6'], log_message: ['list', '#F3E8FF', '#8B3FD1'],
  read_excel: ['table', '#E8F5EC', '#1D7A46'], write_excel: ['table', '#E8F5EC', '#1D7A46'], read_csv: ['document', '#F2F4F7', '#475467'], write_csv: ['document', '#F2F4F7', '#475467'],
  read_pdf_text: ['document', '#FDEEEC', '#D92D20'], transform_data: ['table', '#EAF1FB', '#2F6FD0'], validate_data: ['check', '#E6F6F4', '#0E7C70'], find_duplicates: ['copy', '#FDF5E6', '#B26B00'],
  add_queue_item: ['queue', '#FFF4E8', '#C2410C'], get_queue_item: ['queue', '#FFF4E8', '#C2410C'], set_queue_item_status: ['queue', '#FFF4E8', '#C2410C'],
  http_request: ['globe', '#EAF1FB', '#2F6FD0'], database_query: ['database', '#EEF0FB', '#4450B5'], file_operation: ['folder', '#FDF5E6', '#B26B00'], send_notification: ['mail', '#EEF0FB', '#4450B5'],
  sheets_read_range: ['table', '#E8F5EC', '#1E8E3E'], sheets_append_rows: ['table', '#E8F5EC', '#1E8E3E'], sheets_update_range: ['table', '#E8F5EC', '#1E8E3E'],
  browser_open: ['globe', '#EAF1FB', '#2F6FD0'], browser_navigate: ['link', '#EAF1FB', '#2F6FD0'], browser_click: ['cursor', '#EAF1FB', '#2F6FD0'], browser_type: ['textInput', '#EAF1FB', '#2F6FD0'],
  browser_select_option: ['list', '#EAF1FB', '#2F6FD0'], browser_get_text: ['text', '#EAF1FB', '#2F6FD0'], browser_extract_table: ['table', '#EAF1FB', '#2F6FD0'], browser_wait_for: ['clock', '#EAF1FB', '#2F6FD0'],
  browser_screenshot: ['image', '#EAF1FB', '#2F6FD0'], browser_close: ['close', '#EAF1FB', '#2F6FD0'], browser_flutter_attendance: ['clock', '#EAF1FB', '#2F6FD0'],
  desktop_open_app: ['monitor', '#F1EDFB', '#6941C6'], desktop_attach_window: ['monitor', '#F1EDFB', '#6941C6'], desktop_click: ['cursor', '#F1EDFB', '#6941C6'], desktop_type: ['textInput', '#F1EDFB', '#6941C6'],
  desktop_hotkey: ['bolt', '#F1EDFB', '#6941C6'], desktop_get_text: ['text', '#F1EDFB', '#6941C6'], desktop_close_window: ['close', '#F1EDFB', '#6941C6'],
  ocr_extract: ['image', '#FDF5E6', '#B26B00'], extract_document_fields: ['document', '#FDF5E6', '#B26B00'], create_task: ['tasks', '#E6F6F4', '#0E7C70'], wait_for_task: ['clock', '#E6F6F4', '#0E7C70'],
  browser_ui_action: ['robot', '#F2F4F7', '#344054'], uipath_workflow: ['robot', '#F2F4F7', '#344054'],
};

export function activityStyle(type) {
  if (TYPE_STYLE[type]) return TYPE_STYLE[type];
  const group = ACTIVITIES.find(([key]) => key === type)?.[2];
  const [bg, fg] = GROUP_TONE[group] || ['#F2F4F7', '#475467'];
  return ['card', bg, fg];
}

/** Colored icon tile for an activity type (rounded square in the palette, circle on canvas cards). */
export function ActivityIcon({ type, round = false, className = 'h-6 w-6', iconClassName = 'h-3.5 w-3.5' }) {
  const [icon, bg, fg] = activityStyle(type);
  return (
    <span className={`grid shrink-0 place-items-center ${round ? 'rounded-full' : 'rounded-md'} ${className}`} style={{ backgroundColor: bg, color: fg }} aria-hidden="true">
      {icon === 'stop'
        ? <svg viewBox="0 0 24 24" className={iconClassName}><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" /></svg>
        : icon === 'play'
          ? <svg viewBox="0 0 24 24" className={iconClassName}><path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor" /></svg>
          : <Icon name={icon} className={iconClassName} strokeWidth={2} />}
    </span>
  );
}

/** JSON (or any code) text box with a line-number gutter and an expand toggle. */
export function CodeField({ id, value, onChange, rows = 6, label, ariaLabel, invalid = false }) {
  const gutter = useRef(null);
  const [tall, setTall] = useState(false);
  const count = Math.max(String(value ?? '').split('\n').length, tall ? rows * 2 : rows);
  return (
    <div className={`relative overflow-hidden rounded-lg border bg-[#FCFBFA] transition-colors focus-within:border-[#E9521F] focus-within:ring-2 focus-within:ring-[#E9521F]/15 ${invalid ? 'border-[#F4C7C1]' : 'border-[#E2DCD5]'}`}>
      <div className="flex">
        <div ref={gutter} aria-hidden="true" className="w-8 shrink-0 select-none overflow-hidden border-r border-[#ECE8E3] bg-[#F6F4F1] py-2 pr-1.5 text-right font-mono text-[11px] leading-[18px] text-slate-400" style={{ height: `${(tall ? rows * 2 : rows) * 18 + 16}px` }}>
          {Array.from({ length: count }, (_, index) => <div key={index}>{index + 1}</div>)}
        </div>
        <textarea
          id={id}
          aria-label={ariaLabel || label}
          spellCheck={false}
          wrap="off"
          rows={tall ? rows * 2 : rows}
          className="min-w-0 flex-1 resize-none overflow-auto whitespace-pre bg-transparent px-2.5 py-2 pr-8 font-mono text-[12px] leading-[18px] text-[#172125] outline-none"
          value={value}
          onChange={onChange}
          onScroll={(event) => { if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop; }}
        />
      </div>
      <button type="button" className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-[#F1EEEA] hover:text-[#172125]" aria-label={tall ? 'Shrink editor' : 'Expand editor'} onClick={() => setTall((current) => !current)}>
        <Glyph name="expand" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Empty canvas illustration (two windows and a cursor). */
export function DropIllustration() {
  return (
    <svg viewBox="0 0 120 84" className="h-20 w-28" fill="none" aria-hidden="true">
      <rect x="6" y="6" width="62" height="44" rx="5" fill="#FFFFFF" stroke="#C9C3BC" strokeWidth="1.6" />
      <path d="M6 15h62" stroke="#C9C3BC" strokeWidth="1.6" />
      <circle cx="12" cy="10.5" r="1.4" fill="#C9C3BC" /><circle cx="17" cy="10.5" r="1.4" fill="#C9C3BC" />
      <rect x="40" y="24" width="64" height="46" rx="5" fill="#FFFFFF" stroke="#9AA3AE" strokeWidth="1.6" />
      <path d="M40 33h64" stroke="#9AA3AE" strokeWidth="1.6" />
      <rect x="48" y="40" width="30" height="4" rx="2" fill="#E4E0DB" /><rect x="48" y="49" width="42" height="4" rx="2" fill="#E4E0DB" />
      <path d="M86 52l18 7-8 2.5-3 8z" fill="#5F6B78" stroke="#5F6B78" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
