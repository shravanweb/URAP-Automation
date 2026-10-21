import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { currentUser } from '../services/api.js';
import heroImage from '../assets/hero-clean.png';
import cube1 from '../assets/cubes/cube-1.png';
import cube2 from '../assets/cubes/cube-2.png';
import cube3 from '../assets/cubes/cube-3.png';
import cube4 from '../assets/cubes/cube-4.png';
import cube5 from '../assets/cubes/cube-5.png';
import cube6 from '../assets/cubes/cube-6.png';
import logoImage from '../assets/logo.png';
import logoMarkImage from '../assets/logo-mark.png';
import './landing-legacy.css';
import AskAi from '../components/AskAi.jsx';
import LandingFooter from '../components/LandingFooter.jsx';
import { DesktopMegaNav, MobileMegaNav } from '../components/MegaMenu.jsx';
import UseCasesSection from '../components/UseCasesSection.jsx';

// Floating cubes cut out of the hero image; positions are percentages of the 1672x941 artwork.
const heroCubes = [
  { src: cube1, left: 53.289, top: 27.949, width: 3.648, duration: 6.5, delay: 0, distance: 14 },
  { src: cube2, left: 68.78, top: 21.254, width: 3.289, duration: 5.5, delay: 1.2, distance: 10 },
  { src: cube3, left: 92.524, top: 19.66, width: 4.665, duration: 7.5, delay: 0.6, distance: 16 },
  { src: cube4, left: 66.208, top: 32.837, width: 2.093, duration: 5, delay: 2, distance: 8 },
  { src: cube5, left: 94.019, top: 42.508, width: 4.725, duration: 7, delay: 1.6, distance: 14 },
  { src: cube6, left: 52.512, top: 48.247, width: 2.033, duration: 6, delay: 0.9, distance: 8 },
];

// The scroll-driven "path" section: one run, four steps. Each step swaps the copy on the left
// and lights the matching part of the illustration on the right.
const pathSteps = [
  {
    kicker: 'Read', lead: 'Read the', accent: 'file',
    body: 'Extract the exact data you need from Excel, CSV or PDF files and send it to your next step. No manual copy and paste, no errors.',
    points: [
      ['excel', 'Excel and CSV rows', 'Read rows, filter data and work with any sheet.'],
      ['pdf', 'PDF text', 'Extract text and structured data from PDF files.'],
      ['columns', 'The columns you choose', 'Pick and use only the data you need.'],
    ],
    cta: 'Explore file automation', href: '#solutions', badge: 'File processed',
  },
  {
    kicker: 'Check', lead: 'Validate the', accent: 'rows',
    body: 'Every row is checked before anything is entered, so bad data stops here instead of in your systems.',
    points: [
      ['check', 'Required fields', 'Rows missing a value are set aside for review.'],
      ['copy', 'Duplicate values', 'Repeated keys are flagged before they are processed.'],
      ['rules', 'Rules on the workflow', 'Formats, ranges and allowed values you define.'],
    ],
    cta: 'Explore data validation', href: '#solutions', badge: 'Rows validated',
  },
  {
    kicker: 'Act', lead: 'Enter the', accent: 'data',
    body: 'A robot types the checked rows into the application that needs them, the same way a person would.',
    points: [
      ['robot', 'Robot on the desktop', 'Windows apps driven through UI Automation.'],
      ['globe', 'Browser form', 'Web pages filled and submitted with Playwright.'],
      ['plug', 'Approved connector', 'APIs, databases and Google Sheets connections.'],
    ],
    cta: 'Explore robots', href: '#platform', badge: 'Data entered',
  },
  {
    kicker: 'Save', lead: 'Save the', accent: 'result',
    body: 'Each run ends with a status, the files it produced and a full history you can come back to.',
    points: [
      ['status', 'Job status', 'Succeeded, failed or waiting, visible at a glance.'],
      ['file', 'Output file', 'Results written to project storage.'],
      ['history', 'Attempt history', 'Every retry kept with its own log.'],
    ],
    cta: 'Explore job history', href: '#platform', badge: 'Result saved',
  },
];

const PATH_ICONS = {
  excel: ['#1F7A45', '#E9F6EE', 'M5 4h10l4 4v12H5zM9 9l6 7M15 9l-6 7'],
  pdf: ['#D93025', '#FDECEA', 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h4'],
  columns: ['#E8710A', '#FFF2E5', 'M4 5h16v14H4zM4 10h16M4 14.5h16M9.5 5v14M14.5 5v14'],
  check: ['#1F7A45', '#E9F6EE', 'M4 12.5l5 5L20 6.5'],
  copy: ['#2F5FA8', '#EAF1FB', 'M8 8h11v12H8zM5 16V4h11'],
  rules: ['#E8710A', '#FFF2E5', 'M5 6h14M5 12h14M5 18h9M3 6h0M3 12h0'],
  robot: ['#5B47B8', '#F1EEFB', 'M6 9h12v10H6zM12 5v4M9 13h0M15 13h0M9.5 16.5h5'],
  globe: ['#2F5FA8', '#EAF1FB', 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18'],
  plug: ['#E8710A', '#FFF2E5', 'M9 3v5M15 3v5M7 8h10v4a5 5 0 0 1-10 0zM12 17v4'],
  status: ['#1F7A45', '#E9F6EE', 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M8 12.5l3 3 5-6'],
  file: ['#2F5FA8', '#EAF1FB', 'M6 3h9l4 4v14H6zM14 3v5h5'],
  history: ['#E8710A', '#FFF2E5', 'M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4M12 8v4l3 2'],
};

function PathIcon({ name }) {
  const [stroke, bg, d] = PATH_ICONS[name] || PATH_ICONS.file;
  return (
    <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border border-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_6px_14px_-8px_rgba(20,33,61,0.25)]" style={{ background: `linear-gradient(150deg, #FFFFFF 0%, ${bg} 55%, ${bg} 100%)` }}>
      <svg viewBox="0 0 24 24" className="relative h-5 w-5" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
    </span>
  );
}

// ----- Path illustration ---------------------------------------------------------------------
// One design canvas (640 x 520) shared by the SVG connectors and the HTML cards, so lines meet
// cards exactly at any size. Each stage has three source nodes and a table; the active point
// (0-2) decides which nodes light up, which connector pulses, and what the table shows.
const CANVAS = { w: 640, h: 520 };
const NODE = { x: 0, w: 124, h: 72, ys: [130, 260, 390] };
const HUB = { x: 222, y: 260, size: 92 };
const TABLE = { x: 286, y: 84, w: 354, h: 352 };
const pct = (value, total) => `${(value / total) * 100}%`;

const PEOPLE = [
  ['John Martin', 'john@acme.io', 'Sales', '#E8F0FE', '#2F5FA8'],
  ['Sarah Lee', 'sarah@acme.io', 'HR', '#FDECEF', '#B4235A'],
  ['Michael Chen', 'michael@acme.io', 'Finance', '#ECF7EF', '#1F7A45'],
  ['Priya Sharma', 'priya@acme.io', 'Operations', '#FFF2E5', '#C2570C'],
  ['David Wilson', 'david@acme.io', 'IT', '#F1EEFB', '#5B47B8'],
];
const initialsOf = (name) => name.split(' ').map((part) => part[0]).join('').slice(0, 2);

const PILL = {
  green: 'border-[#CFEBD9] bg-[#F0FAF3] text-[#1F7A45]',
  amber: 'border-[#F5E1B8] bg-[#FDF7EA] text-[#8A5A0B]',
  red: 'border-[#F6CFCB] bg-[#FDF1F0] text-[#B42318]',
  blue: 'border-[#D5E2F6] bg-[#F1F6FD] text-[#2F5FA8]',
  slate: 'border-[#E4E7EC] bg-[#F7F8FA] text-[#5B6474]',
};

// Per stage: the three source nodes, which node(s) each point lights, and the table per point.
const STAGE_ART = [
  {
    nodes: [['XLSX', 'excel', 'Workbook'], ['CSV', 'columns', 'Export'], ['PDF', 'pdf', 'Invoice']],
    lights: [[0, 1], [2], [0, 1, 2]],
    table: (point) => {
      if (point === 1) {
        return {
          title: 'Extracted Data', source: 'invoice-1042.pdf', badge: ['File processed', 'green'],
          columns: ['Field', 'Value', 'Confidence'], focus: null,
          rows: [['Invoice number', 'INV-1042', ['98%', 'green']], ['Invoice date', '12 Oct 2026', ['96%', 'green']], ['Vendor', 'ACME Supplies', ['93%', 'green']], ['Total', 'USD 1,250.00', ['97%', 'green']], ['Due date', '26 Oct 2026', ['91%', 'green']]],
        };
      }
      return {
        title: 'Extracted Data', source: point === 0 ? 'employees.xlsx · 5 rows' : 'employees.xlsx · 3 of 5 columns', badge: ['File processed', 'green'],
        columns: ['Name', 'Email', 'Department', 'Status'], focus: point === 2 ? [0, 1, 2] : null,
        rows: PEOPLE.map(([name, email, dept, bg, fg]) => [{ name, bg, fg }, email, dept, ['Active', 'green']]),
      };
    },
  },
  {
    nodes: [['Required', 'check', 'Fields'], ['Duplicate', 'copy', 'Keys'], ['Rules', 'rules', 'Workflow']],
    lights: [[0], [1], [2]],
    table: (point) => ({
      title: 'Validation', source: ['Required fields', 'Duplicate keys', 'Workflow rules'][point], badge: [['1 row missing a value', 'amber'], ['1 duplicate found', 'amber'], ['1 rule failed', 'red']][point],
      columns: ['Name', 'Email', 'Department', 'Check'], focus: [[1, 3], [1, 3], [2, 3]][point],
      rows: PEOPLE.map(([name, email, dept, bg, fg], i) => {
        const flagged = [1, 3, 4][point] === i;
        const cells = point === 0 && flagged ? '—' : point === 1 && flagged ? 'sarah@acme.io' : email;
        return [{ name, bg, fg }, cells, point === 2 && flagged ? 'Unknown' : dept, flagged ? [['Missing', 'amber'], ['Duplicate', 'amber'], ['Rule failed', 'red']][point] : ['Valid', 'green']];
      }),
    }),
  },
  {
    nodes: [['Desktop', 'robot', 'Windows'], ['Browser', 'globe', 'Web form'], ['API', 'plug', 'Sheets · DB']],
    lights: [[0], [1], [2]],
    table: (point) => ({
      title: 'Data entry', source: ['Robot · ERP desktop client', 'Browser · portal.company.com', 'Connector · Google Sheets'][point], badge: ['Data entered', 'green'],
      columns: ['Name', 'Target', 'Department', 'Status'], focus: [1, 3],
      rows: PEOPLE.map(([name, , dept, bg, fg], i) => [{ name, bg, fg }, ['ERP · Employees', 'Portal · New hire', 'Sheet · Staff'][point], dept, i < 4 ? ['Entered', 'green'] : ['Typing…', 'blue']]),
    }),
  },
  {
    nodes: [['Job status', 'status', 'Orchestrator'], ['Output file', 'file', 'Storage'], ['History', 'history', 'Attempts']],
    lights: [[0], [1], [2]],
    table: (point) => {
      if (point === 1) {
        return {
          title: 'Job output', source: 'out/', badge: ['Result saved', 'green'], columns: ['File', 'Size', 'Rows'], focus: null,
          rows: [['employees-clean.csv', '4.2 KB', ['5 rows', 'green']], ['rejected.csv', '0.6 KB', ['1 row', 'amber']], ['run-summary.json', '1.1 KB', ['—', 'slate']]],
        };
      }
      if (point === 2) {
        return {
          title: 'Attempt history', source: 'Job #2841', badge: ['Result saved', 'green'], columns: ['Attempt', 'Started', 'Duration', 'Result'], focus: null,
          rows: [['#1', '09:00:02', '14 s', ['Failed', 'red']], ['#2', '09:00:47', '12 s', ['Succeeded', 'green']]],
        };
      }
      return {
        title: 'Job status', source: 'Invoice intake · v3', badge: ['Result saved', 'green'], columns: ['Step', 'Duration', 'Status'], focus: null,
        rows: [['Read the file', '1.2 s', ['Succeeded', 'green']], ['Validate the rows', '0.4 s', ['Succeeded', 'green']], ['Enter the data', '9.8 s', ['Succeeded', 'green']], ['Save the result', '0.3 s', ['Succeeded', 'green']]],
      };
    },
  },
];

function Pill({ value }) {
  const [text, tone] = value;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-[2px] text-[9.5px] font-semibold tracking-[0.01em] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] ${PILL[tone] || PILL.slate}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />{text}
    </span>
  );
}

function Cell({ value }) {
  if (Array.isArray(value)) return <Pill value={value} />;
  if (value && typeof value === 'object') {
    return (
      <span className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-bold" style={{ background: value.bg, color: value.fg }}>{initialsOf(value.name)}</span>
        <span className="font-medium text-[#14213D]">{value.name}</span>
      </span>
    );
  }
  return value;
}

/** Enterprise-style illustration: source nodes, pulsing connectors, URAP hub, and a live table. */
function PathIllustration({ step, point }) {
  const art = STAGE_ART[step];
  const lit = new Set(art.lights[point]);
  const table = art.table(point);
  const hubLeft = HUB.x - HUB.size / 2;
  const hubRight = HUB.x + HUB.size / 2;
  const connector = (y) => `M${NODE.x + NODE.w} ${y} C ${NODE.x + NODE.w + 34} ${y}, ${hubLeft - 34} ${HUB.y}, ${hubLeft} ${HUB.y}`;
  const out = `M${hubRight} ${HUB.y} L ${TABLE.x} ${HUB.y}`;
  return (
    <div className="relative mx-auto w-full max-w-[720px]" style={{ aspectRatio: `${CANVAS.w} / ${CANVAS.h}` }} aria-hidden="true">
      {/* Dotted grid panel, fading at the edges */}
      <div className="absolute -inset-6 rounded-[28px] [mask-image:radial-gradient(ellipse_at_55%_50%,#000_45%,transparent_78%)]" style={{ backgroundImage: 'radial-gradient(#D9DDE5 1px, transparent 1.2px)', backgroundSize: '18px 18px' }} />
      <div className="pointer-events-none absolute -inset-[18%] bg-[radial-gradient(closest-side_at_30%_52%,rgba(255,176,128,0.42),transparent_70%),radial-gradient(closest-side_at_74%_42%,rgba(176,164,240,0.30),transparent_72%),radial-gradient(closest-side_at_62%_78%,rgba(150,190,240,0.28),transparent_70%)]" />

      <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${CANVAS.w} ${CANVAS.h}`} fill="none">
        <defs>
          <linearGradient id="path-pulse" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="80" y2="0">
            <stop offset="0" stopColor="#F26B1D" stopOpacity="0" />
            <stop offset="0.6" stopColor="#FF9A57" />
            <stop offset="1" stopColor="#F26B1D" />
          </linearGradient>
          {/* Arrowheads stop just short of the port dots so the flow direction reads clearly. */}
          {[['on', '#F26B1D'], ['off', '#CDD2DA']].map(([tone, fill]) => (
            <marker key={tone} id={`path-arrow-${tone}`} viewBox="0 0 10 10" refX="15" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto" overflow="visible">
              <path d="M1 1.2 L9 5 L1 8.8 L3 5 Z" fill={fill} />
            </marker>
          ))}
        </defs>
        {NODE.ys.map((y, i) => {
          const on = lit.has(i);
          return (
            <g key={`${step}-${i}`}>
              <path d={connector(y)} stroke={on ? '#F7C4A3' : '#E3E6EC'} strokeWidth={on ? 2.2 : 1.6} strokeLinecap="round" className="transition-[stroke] duration-500" markerEnd={`url(#path-arrow-${on ? 'on' : 'off'})`} />
              {on && <path d={connector(y)} pathLength="100" stroke="#FF9A57" strokeWidth="6" strokeLinecap="round" className="landing-path-trail" style={{ animationDelay: `${i * 0.18}s` }} />}
              {on && <path d={connector(y)} pathLength="100" stroke="#F26B1D" strokeWidth="2.4" strokeLinecap="round" className="landing-path-pulse" style={{ animationDelay: `${i * 0.18}s` }} />}
              <circle cx={NODE.x + NODE.w} cy={y} r="3.5" fill="#FFFFFF" stroke={on ? '#F26B1D' : '#CDD2DA'} strokeWidth="1.5" />
            </g>
          );
        })}
        <path d={out} stroke="#F7C4A3" strokeWidth="2.2" strokeLinecap="round" markerEnd="url(#path-arrow-on)" />
        <path key={`trail-${step}-${point}`} d={out} pathLength="100" stroke="#FF9A57" strokeWidth="6" strokeLinecap="round" className="landing-path-trail" style={{ animationDelay: '0.5s' }} />
        <path key={`out-${step}-${point}`} d={out} pathLength="100" stroke="#F26B1D" strokeWidth="2.4" strokeLinecap="round" className="landing-path-pulse" style={{ animationDelay: '0.5s' }} />
        <circle cx={hubLeft} cy={HUB.y} r="3.5" fill="#FFFFFF" stroke="#F26B1D" strokeWidth="1.5" />
        <circle cx={TABLE.x} cy={HUB.y} r="3.5" fill="#FFFFFF" stroke="#F26B1D" strokeWidth="1.5" />
      </svg>

      {art.nodes.map(([label, icon, sub], i) => {
        const on = lit.has(i);
        return (
          <div key={`${step}-${label}`} className={`absolute flex items-center gap-2.5 rounded-2xl border bg-white/70 px-3 backdrop-blur-xl transition-[opacity,box-shadow,border-color] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${on ? 'border-[#F7CDB2] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_0_0_4px_rgba(242,107,29,0.07),0_2px_4px_rgba(20,33,61,0.04),0_22px_40px_-20px_rgba(242,107,29,0.5)]' : 'border-[#E8EBF0] opacity-60 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(20,33,61,0.04),0_14px_30px_-22px_rgba(20,33,61,0.35)]'}`}
            style={{ left: pct(NODE.x, CANVAS.w), top: pct(NODE.ys[i] - NODE.h / 2, CANVAS.h), width: pct(NODE.w, CANVAS.w), height: pct(NODE.h, CANVAS.h) }}>
            <PathIcon name={icon} />
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-semibold text-[#14213D]">{label}</span>
              <span className="block truncate text-[10.5px] text-[#8A93A3]">{sub}</span>
            </span>
          </div>
        );
      })}

      <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: pct(HUB.x, CANVAS.w), top: pct(HUB.y, CANVAS.h), width: pct(HUB.size, CANVAS.w), aspectRatio: '1' }}>
        <div className="landing-path-halo absolute inset-[-14px] rounded-[30px] bg-[radial-gradient(circle,rgba(242,107,29,0.18)_0%,rgba(242,107,29,0)_70%)]" />
        <div className="relative grid h-full w-full place-items-center rounded-[24px] border border-[#EFE3DA] bg-[linear-gradient(160deg,#FFFFFF_0%,#FFF8F3_100%)] shadow-[0_1px_0_#FFFFFF_inset,0_24px_44px_-22px_rgba(242,107,29,0.55),0_6px_14px_-8px_rgba(20,33,61,0.18)]">
          <div className="absolute inset-[6px] rounded-[19px] border border-[#F6ECE4]" />
          <div className="absolute inset-0 overflow-hidden rounded-[24px]"><div className="landing-path-shimmer absolute inset-y-0 -left-1/2 w-1/2 bg-[linear-gradient(100deg,transparent_0%,rgba(255,255,255,0.85)_50%,transparent_100%)]" /></div>
          <img src={logoMarkImage} alt="" className="relative h-[46%] w-[46%] object-contain" />
        </div>
        <span className="absolute left-1/2 top-full mt-2.5 -translate-x-1/2 whitespace-nowrap rounded-full border border-[#EFE3DA] bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-[#8A5A3C]">URAP robot</span>
      </div>

      <div className="absolute flex flex-col overflow-hidden rounded-[18px] border border-[#E3E7EE] bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_1px_2px_rgba(31,52,94,0.05),0_12px_24px_-14px_rgba(31,52,94,0.18),0_40px_80px_-40px_rgba(31,52,94,0.45)] backdrop-blur-xl"
        style={{ left: pct(TABLE.x, CANVAS.w), top: pct(TABLE.y, CANVAS.h), width: pct(TABLE.w, CANVAS.w), height: pct(TABLE.h, CANVAS.h) }}>
        <div className="flex items-center gap-2.5 border-b border-[#EDF0F4] bg-[linear-gradient(180deg,#FFFFFF_0%,#F7F9FB_100%)] px-3.5 py-2.5">
          <span className="flex gap-[5px]">{['#FF6159', '#FFBD2E', '#28C941'].map((c) => <span key={c} className="h-[9px] w-[9px] rounded-full shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.12)]" style={{ background: c, opacity: 0.85 }} />)}</span>
          <span className="ml-1 leading-tight">
            <span className="block text-[12.5px] font-semibold tracking-[-0.01em] text-[#14213D]">{table.title}</span>
            <span className="block text-[9.5px] text-[#9AA3B2]">URAP · live run</span>
          </span>
          <span className="ml-auto"><Pill value={table.badge} /></span>
        </div>
        <div className="flex items-center gap-2 border-b border-[#F2F4F7] px-3.5 py-2 text-[10.5px] text-[#6B7280]">
          <span className="inline-flex items-center gap-1 rounded-md border border-[#E8EBF0] bg-[#F8F9FB] px-1.5 py-0.5 font-medium text-[#4A5565]">{table.source}</span>
          {table.focus && <span className="text-[#C2570C]">{table.focus.length} column{table.focus.length === 1 ? '' : 's'} highlighted</span>}
        </div>
        <table className="w-full whitespace-nowrap text-left text-[10px]">
          <thead>
            <tr className="text-[#8A93A3]">
              {table.columns.map((column, c) => {
                const on = !table.focus || table.focus.includes(c);
                return <th key={column} className={`px-2.5 py-2 text-[9px] font-semibold uppercase tracking-[0.06em] transition-all duration-500 ${table.focus && on ? 'bg-[#FFF4EC] text-[#C2570C]' : ''} ${on ? '' : 'opacity-35'}`}>{column}</th>;
              })}
            </tr>
          </thead>
          <tbody key={`${step}-${point}`} className="text-[#4A5565]">
            {table.rows.map((cells, r) => (
              <tr key={r} className="landing-path-row border-t border-[#F2F4F7] transition-colors duration-200 hover:bg-[#FAF7F4]" style={{ animationDelay: `${0.15 + r * 0.12}s` }}>
                {cells.map((cell, c) => {
                  const on = !table.focus || table.focus.includes(c);
                  return <td key={c} className={`px-2.5 py-[7px] transition-all duration-500 ${table.focus && on ? 'bg-[#FFF8F3]' : ''} ${on ? '' : 'opacity-30'}`}><Cell value={cell} /></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Cycles the active point every 1.5 s within a stage; cards reveal one at a time on entry. */
function usePathPoints(step, count, paused) {
  const [state, setState] = useState({ step, point: 0, revealed: 1 });
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    setState({ step, point: 0, revealed: reduced ? count : 1 });
  }, [step, count, reduced]);
  // Cards reveal on their own clock so hovering one (which pauses the cycle) never hides the rest.
  useEffect(() => {
    if (reduced) return undefined;
    const timer = setInterval(() => {
      setState((current) => (current.revealed >= count ? current : { ...current, revealed: current.revealed + 1 }));
    }, 1500);
    return () => clearInterval(timer);
  }, [step, count, reduced]);
  useEffect(() => {
    if (reduced || paused) return undefined;
    const timer = setInterval(() => {
      setState((current) => ({ ...current, point: (current.point + 1) % count }));
    }, 1500);
    return () => clearInterval(timer);
  }, [step, count, paused, reduced]);
  const current = state.step === step ? state : { step, point: 0, revealed: reduced ? count : 1 };
  return [current, (point) => setState((value) => ({ ...value, step, point, revealed: Math.max(value.revealed, point + 1) }))];
}

const navMenus = [
  { label: 'Platform', items: [
    { name: 'Studio', href: '#platform', detail: 'Design the workflow' },
    { name: 'Robot', href: '#platform', detail: 'Run it on the machine' },
    { name: 'Orchestrator', href: '#platform', detail: 'Monitor jobs and schedules' },
  ] },
  { label: 'Solutions', items: [
    { name: 'ERP', href: '#solutions', detail: 'Orders and inventory' },
    { name: 'CRM', href: '#solutions', detail: 'Customers and follow-ups' },
    { name: 'Finance', href: '#solutions', detail: 'Invoices and reconciliation' },
    { name: 'Files', href: '#solutions', detail: 'Excel, CSV, and PDF' },
  ] },
  { label: 'Resources', items: [
    { name: 'The path', href: '#path', detail: 'Follow one run as you scroll' },
    { name: 'Terms of Use', href: '/legal', detail: 'How URAP may be used' },
    { name: 'Privacy Notice', href: '/legal', detail: 'What data URAP keeps' },
  ] },
  { label: 'Developers', icon: 'code', items: [
    { name: 'API and webhooks', href: '#platform', detail: 'Start jobs from other systems' },
    { name: 'Robot agent', href: '#platform', detail: 'Run workflows on your own machines' },
  ] },
  { label: 'Software testing', items: [
    { name: 'Testing', href: '#solutions', detail: 'Repeatable UI checks and API tests' },
  ] },
];

const pillars = [
  {
    number: '01',
    eyebrow: 'Studio',
    title: 'UiPath Studio',
    lead: 'Where the workflow is created.',
    points: [
      ['Build the flow', 'A workflow is a sequence: Read Excel, Validate, Enter data, Save.'],
      ['Keep a draft', 'Save the definition, then validate it before anyone can run it.'],
      ['Publish a version', 'Only a published version can be queued.'],
      ['Hand it off', 'The published package is what the robot is asked to run.'],
    ],
    nodes: [
      ['Read Excel', 'Stage 01', 22, 18],
      ['Validate', 'Stage 02', 74, 18],
      ['Enter data', 'Stage 03', 22, 52],
      ['Review', 'Stage 03', 74, 52],
      ['Save', 'Stage 04', 48, 84],
    ],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4]],
    tags: { 1: 'Checked', 4: 'Saved' },
  },
  {
    number: '02',
    eyebrow: 'Robot',
    title: 'UiPath Robot',
    lead: 'Where the workflow actually runs.',
    points: [
      ['Claim the job', 'A queued job is claimed by an authorized robot.'],
      ['Run the steps', 'The robot acts on the desktop, browser, or supported application.'],
      ['Return the output', 'Status, artifacts, and a safe error message come back to the platform.'],
      ['Keep the attempt', 'A retry creates a new attempt and leaves the previous one in history.'],
    ],
    nodes: [
      ['Claim job', 'Queue', 24, 16],
      ['Desktop run', 'Computer', 74, 16],
      ['Browser action', 'Web app', 24, 50],
      ['Return output', 'Result', 74, 50],
      ['Attempt log', 'History', 48, 84],
    ],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4]],
    tags: { 0: 'Queued', 3: 'Returned' },
  },
  {
    number: '03',
    eyebrow: 'Orchestrator',
    title: 'UiPath Orchestrator',
    lead: 'Where robots, jobs, and schedules are managed.',
    points: [
      ['Robots', 'See which robot is allowed to process a project.'],
      ['Jobs', 'Track queue time, start, finish, and the final status.'],
      ['Schedules', 'Run once, or on a recurring timetable, without overlapping runs.'],
      ['Queues and logs', 'Follow execution monitoring when that setup is available.'],
    ],
    nodes: [
      ['Robot', 'Assigned', 24, 16],
      ['Job', 'Running', 74, 16],
      ['Schedule', 'Next run', 24, 50],
      ['Queue', 'Work items', 74, 50],
      ['Audit', 'Record', 48, 84],
    ],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4]],
    tags: { 1: 'Running', 4: 'Logged' },
  },
];

// UiPath-style orthogonal connector between two node boxes ({x, y, w, h} in board pixels).
// Same row: right edge -> left edge. Next row: down from the bottom edge, across, down into the
// top edge, with rounded corners. The path ends `gap` px short of the border for the arrowhead.
export function elbowPath(a, b, { gap = 7, radius = 10 } = {}) {
  const acx = a.x + a.w / 2; const bcx = b.x + b.w / 2;
  if (Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) < Math.min(a.h, b.h) / 2) {
    const y = (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2;
    const forward = bcx >= acx;
    const x1 = forward ? a.x + a.w : a.x; const x2 = forward ? b.x - gap : b.x + b.w + gap;
    return `M${x1} ${y} H${x2}`;
  }
  const down = b.y > a.y;
  const y1 = down ? a.y + a.h : a.y; const y2 = down ? b.y - gap : b.y + b.h + gap;
  const mid = (y1 + (down ? b.y : b.y + b.h)) / 2;
  const dx = bcx - acx;
  if (Math.abs(dx) < 1) return `M${acx} ${y1} V${y2}`;
  const r = Math.min(radius, Math.abs(dx) / 2, Math.abs(mid - y1), Math.abs(y2 - mid));
  const sx = Math.sign(dx); const sy = down ? 1 : -1;
  return `M${acx} ${y1} V${mid - sy * r} Q${acx} ${mid} ${acx + sx * r} ${mid} H${bcx - sx * r} Q${bcx} ${mid} ${bcx} ${mid + sy * r} V${y2}`;
}

/** Share of edge `index` drawn at board progress p (0..1); edges finish by 92% of the scroll. */
export function edgeProgress(p, index, count) {
  const span = 0.92 / Math.max(count, 1);
  return Math.min(Math.max((p - index * span) / span, 0), 1);
}

function FlowBoard({ pillar, sectionRef }) {
  const board = useRef(null);
  const boxes = useRef([]);
  const lines = useRef([]);
  const [rects, setRects] = useState([]);
  const [reached, setReached] = useState(0); // number of edges fully drawn
  useEffect(() => {
    const measure = () => {
      const root = board.current?.getBoundingClientRect();
      if (!root) return;
      setRects(boxes.current.map((el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left - root.left, y: r.top - root.top, w: r.width, h: r.height };
      }));
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (observer && board.current) observer.observe(board.current);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [pillar]);
  // Scroll-linked drawing: writes stroke-dashoffset straight to the DOM in rAF (no re-render per
  // frame); React state only changes when another edge completes, to light the next node.
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    const count = pillar.edges.length;
    const render = () => {
      frame = 0;
      const el = sectionRef?.current;
      let p = 1;
      if (el && !reduced) {
        const total = Math.max(el.offsetHeight - window.innerHeight, 1);
        p = Math.min(Math.max(-el.getBoundingClientRect().top, 0), total) / total;
      }
      let done = 0;
      lines.current.forEach((line, i) => {
        const t = edgeProgress(p, i, count);
        if (t >= 0.999) done += 1;
        if (line) line.style.strokeDashoffset = String(1 - t);
      });
      setReached((prev) => (prev === done ? prev : done));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(render); };
    render();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, [pillar, sectionRef, rects]);
  const lit = (index) => index <= reached;
  const markerId = `flow-arrow-${pillar.number}`;
  return (
    <div ref={board} className="relative h-[520px] overflow-hidden bg-[#10181e]" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.16) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
      <svg className="absolute inset-0 h-full w-full" fill="none" aria-hidden="true">
        <defs>
          <marker id={markerId} viewBox="0 0 10 10" refX="1" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto" overflow="visible">
            <path d="M1 1.2 L9 5 L1 8.8 L3 5 Z" fill="#2ee0ef" />
          </marker>
        </defs>
        {pillar.edges.map(([from, to], i) => {
          if (!rects[from] || !rects[to]) return null;
          const d = elbowPath(rects[from], rects[to]);
          const arrived = i < reached;
          return (
            <g key={`${from}-${to}`}>
              <path d={d} stroke="#1d4e57" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path ref={(el) => { lines.current[i] = el; }} d={d} pathLength="1" strokeDasharray="1 1" strokeDashoffset="1" stroke="#2ee0ef" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                markerEnd={arrived ? `url(#${markerId})` : undefined} style={{ filter: 'drop-shadow(0 0 3px rgba(46,224,239,0.45))' }} />
            </g>
          );
        })}
      </svg>
      {pillar.nodes.map(([title, stage, x, y], index) => {
        const on = lit(index);
        return (
          <div key={title} className="absolute w-[168px] -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
            {pillar.tags[index] && <span className={`mb-1 inline-block px-2 py-0.5 text-[10px] font-semibold ${on ? 'bg-[#2ee0ef] text-[#082126]' : 'bg-[#16343a] text-[#8fdbe3]'}`}>{pillar.tags[index]}</span>}
            <div ref={(el) => { boxes.current[index] = el; }} className={`flex items-center gap-2 border px-3 py-2 ${on ? 'border-[#2ee0ef] bg-[#0f3c44] shadow-[0_0_22px_rgba(46,224,239,0.28)]' : 'border-[#1d6670] bg-[#121c24]'}`}>
              <span className={`grid h-8 w-8 shrink-0 place-items-center text-xs font-bold ${on ? 'bg-[#2ee0ef] text-[#082126]' : 'border border-[#2ee0ef] text-[#2ee0ef]'}`}>{index + 1}</span>
              <span>
                <span className="block text-sm font-semibold leading-tight text-white">{title}</span>
                <span className="block text-[11px] text-white/60">{stage}</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const solutions = [
  ['ERP', 'Orders, inventory, shipments'],
  ['CRM', 'Leads, records, follow-ups'],
  ['Finance', 'Invoices and reconciliation'],
  ['Files', 'Excel, CSV and PDF'],
  ['Testing', 'UI and API checks'],
  ['Reporting', 'Scheduled reports'],
];

function useReveal(root) {
  useEffect(() => {
    const scope = root.current;
    if (!scope) return undefined;
    const nodes = scope.querySelectorAll('[data-reveal]');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add('is-in');
      });
    }, { threshold: 0.22 });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [root]);
}

function useScrollStep(ref, count) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const el = ref.current;
      if (!el) return;
      const total = el.offsetHeight - window.innerHeight;
      const passed = Math.min(Math.max(-el.getBoundingClientRect().top, 0), Math.max(total, 1));
      const next = Math.min(count - 1, Math.floor((passed / Math.max(total, 1)) * count));
      setStep(next);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [ref, count]);
  return step;
}

// Tiles in three close tones of the next section's cream background, so the hero's bottom edge
// dissolves into the section that scrolls up right behind it (like uipath.com).
const HERO_TILE_TONES = ['#0B1A33', '#0E1F3D', '#112544', '#13294B', '#0D1C38'];
const HERO_NAVY = '#0B1A33';
const HERO_TILE_ALPHA = 0.48; // the hero image shows through softly
const HERO_NEXT_BG = '#FBF8F4'; // the 'See the path in action' section
const HERO_TILE_COLOR = HERO_TILE_TONES[0];

/**
 * Drives the hero scroll effect with one rAF-throttled scroll listener. Writes styles straight to
 * the DOM (no React renders): transform/opacity on the image and text, and a canvas of square
 * tiles that fill in from the bottom with a random stagger.
 */
function useHeroScroll({ heroRef, imageRef, fadeRef, canvasRef }) {
  useEffect(() => {
    const hero = heroRef.current;
    const canvas = canvasRef.current;
    if (!hero || !canvas) return undefined;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const words = [...hero.querySelectorAll('[data-hero-word]')];
    const ctx = canvas.getContext('2d');
    let tiles = [];
    let size = 72;
    let frame = 0;
    let last = -1;

    const layout = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      size = width < 640 ? 96 : width < 1024 ? 80 : 72; // fewer, larger tiles on small screens
      const cols = Math.ceil(width / size);
      const rows = Math.ceil(height / size);
      tiles = [];
      // Only the lower ~40% of the hero gets tiles: a stepped pixel edge, never a full wall.
      const bandRows = Math.max(2, Math.ceil((height * 0.4) / size));
      for (let r = rows - bandRows; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const fromBottom = (rows - 1 - r) / Math.max(bandRows - 1, 1);
          // Bottom rows start first; a random jitter breaks the rows into a pixel dissolve.
          // Small jitter keeps the front dense and connected (no stray holes); the last tile
          // finishes exactly at progress 1, when the pin releases and the dark frame scrolls away.
          const start = fromBottom * 0.7 + Math.random() * 0.2 - 0.12; // bottom row already stepped at rest
          tiles.push({ x: c * size, y: r * size, start: r === rows - 1 ? Math.min(start, -0.1) : start, color: HERO_TILE_TONES[Math.floor(Math.random() * HERO_TILE_TONES.length)] });
        }
      }
      last = -1;
    };

    const render = () => {
      frame = 0;
      const rect = hero.getBoundingClientRect();
      // No pin: progress runs while the hero scrolls away normally (done at 60% of its height).
      const travel = Math.max(hero.offsetHeight * 0.6, 1);
      const progress = Math.min(Math.max(-rect.top / travel, 0), 1);
      if (Math.abs(progress - last) < 0.001) return;
      last = progress;
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = HERO_TILE_COLOR;
      if (reduced) {
        // Reduced motion: one simple cross-fade, no tiles, no movement.
        ctx.globalAlpha = progress;
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
        if (fadeRef.current) fadeRef.current.style.opacity = String(1 - progress);
        return;
      }
      for (const tile of tiles) {
        const local = (progress - tile.start) / 0.1;
        if (local <= 0) continue;
        ctx.globalAlpha = Math.min(local, 1) * HERO_TILE_ALPHA;
        ctx.fillStyle = tile.color;
        ctx.fillRect(tile.x, tile.y, size + 0.5, size + 0.5);
        // Soft cube shading: a faint top/left highlight and a slightly darker bottom/right edge.
        ctx.fillStyle = 'rgba(120,160,230,0.10)';
        ctx.fillRect(tile.x, tile.y, size, 1.5);
        ctx.fillRect(tile.x, tile.y, 1.5, size);
        ctx.fillStyle = 'rgba(2,8,20,0.28)';
        ctx.fillRect(tile.x, tile.y + size - 1.5, size, 1.5);
        ctx.fillRect(tile.x + size - 1.5, tile.y, 1.5, size);
      }
      ctx.globalAlpha = 1;
      // The last row melts into the next section inside the hero's own height (no added strip).
      const melt = Math.min(size * 0.75, height);
      const gradient = ctx.createLinearGradient(0, height - melt, 0, height);
      gradient.addColorStop(0, 'rgba(251,248,244,0)');
      gradient.addColorStop(1, HERO_NEXT_BG);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, height - melt, width, melt);
      if (imageRef.current) imageRef.current.style.transform = `translate3d(-50%, calc(-50% - ${progress * 60}px), 0) scale(${1 + progress * 0.08})`;
      // Words dim one after another, last word first, down to a soft grey.
      words.forEach((word, index) => {
        const order = words.length - 1 - index;
        const local = Math.min(Math.max((progress * 2.2 - order * 0.12), 0), 1);
        word.style.opacity = String(1 - local * 0.72);
      });
      if (fadeRef.current) {
        const fade = Math.min(progress * 2.4, 1);
        fadeRef.current.style.opacity = String(1 - fade);
        fadeRef.current.style.transform = `translate3d(0, ${fade * -16}px, 0)`;
      }
    };

    const onScroll = () => { if (!frame) frame = requestAnimationFrame(render); };
    const onResize = () => { layout(); onScroll(); };
    layout();
    render();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [heroRef, imageRef, fadeRef, canvasRef]);
}

export default function LandingPage() {
  const signedIn = Boolean(currentUser());
  const startHref = signedIn ? '/dashboard' : '/signup';
  const pageRef = useRef(null);
  const pathRef = useRef(null);
  const heroRef = useRef(null);
  const heroImageRef = useRef(null);
  const heroFadeRef = useRef(null);
  const heroTilesRef = useRef(null);
  useHeroScroll({ heroRef, imageRef: heroImageRef, fadeRef: heroFadeRef, canvasRef: heroTilesRef });
  const pillarRefs = [useRef(null), useRef(null), useRef(null)];
  const [solidHeader, setSolidHeader] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [megaOpen, setMegaOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');

  function submitSearch(event) {
    event.preventDefault();
    const query = searchText.trim().toLowerCase();
    if (!query) return;
    const entries = navMenus.flatMap((menu) => [{ name: menu.label, detail: '', href: menu.items[0].href }, ...menu.items]);
    const match = entries.find((entry) => `${entry.name} ${entry.detail}`.toLowerCase().includes(query));
    if (match) window.location.hash = match.href.slice(1);
    setSearchOpen(false);
    setSearchText('');
  }
  const pathStep = useScrollStep(pathRef, pathSteps.length);
  const [pathPaused, setPathPaused] = useState(false);
  const [pathPoints, setPathPoint] = usePathPoints(pathStep, 3, pathPaused);
  const pillarSteps = [
    useScrollStep(pillarRefs[0], pillars[0].points.length),
    useScrollStep(pillarRefs[1], pillars[1].points.length),
    useScrollStep(pillarRefs[2], pillars[2].points.length),
  ];
  useReveal(pageRef);

  useEffect(() => {
    const onScroll = () => setSolidHeader(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div ref={pageRef} className="landing min-h-screen">
      <div className="border-b border-[#f3ddd4] bg-[#fff6f2] px-4 py-2.5 text-center text-[13px] text-[#3d474b]">
        Studio designs the workflow. Robot runs it. Orchestrator monitors the jobs.{' '}
        <a href="#platform" className="font-semibold text-[#fa4616]">See the components →</a>
      </div>

      <header className={`sticky top-0 z-30 border-b transition-colors duration-300 ${solidHeader || menuOpen || megaOpen ? 'border-[#eadccd] bg-[#f6ebe0] shadow-[0_8px_24px_rgba(23,33,37,0.06)]' : 'border-[#172125]/10 bg-transparent hover:border-[#eadccd] hover:bg-[#f6ebe0] focus-within:border-[#eadccd] focus-within:bg-[#f6ebe0]'}`}>
        <div className="flex h-20 items-stretch px-5 sm:px-8 lg:px-10">
          <a href="#top" className="mr-6 flex shrink-0 items-center" aria-label="URAP home">
            <img src={logoImage} alt="URAP" className="h-[52px] w-auto max-w-[200px] object-contain" />
          </a>
          <DesktopMegaNav onOpenChange={setMegaOpen} />
          <div className="ml-auto flex items-stretch">
            <div className="relative hidden items-center pr-2 sm:flex">
              {searchOpen && (
                <form onSubmit={submitSearch} className="absolute right-12 top-1/2 -translate-y-1/2">
                  <input
                    autoFocus
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    onBlur={() => !searchText && setSearchOpen(false)}
                    placeholder="Search URAP"
                    aria-label="Search URAP"
                    className="w-56 border border-[#d9cbbd] bg-white px-3 py-1.5 text-sm text-[#172125] outline-none focus:border-[#fa4616]"
                  />
                </form>
              )}
              <button type="button" onClick={() => setSearchOpen((open) => !open)} className="grid h-9 w-9 place-items-center text-[#172125] hover:text-[#fa4616]" aria-label="Search">
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m15 15 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
              <span className="ml-2 h-7 w-px bg-[#d9cbbd]" aria-hidden="true" />
            </div>
            <a href="#contact" className="hidden items-center gap-2 whitespace-nowrap px-3 text-sm font-medium text-[#172125] hover:text-[#fa4616] lg:inline-flex">
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
              Contact us
            </a>
            <Link to="/login" className="hidden items-center gap-2 whitespace-nowrap px-3 text-sm font-medium text-[#172125] hover:text-[#fa4616] sm:inline-flex">
              <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="10" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M6.5 18.2c1.3-2.2 3.2-3.2 5.5-3.2s4.2 1 5.5 3.2" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
              Sign in
            </Link>
            <Link to={startHref} className="my-auto ml-3 inline-flex items-center whitespace-nowrap bg-[#fa4616] px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#e23d12]">
              {signedIn ? 'Open platform' : 'Try URAP free'}
            </Link>
            <button type="button" className="my-auto ml-2 mr-3 border border-[#d9cbbd] px-2 py-1 text-sm xl:hidden" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>Menu</button>
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-[#eadccd] bg-[#f6ebe0] px-5 py-3 xl:hidden">
            <MobileMegaNav onPick={() => setMenuOpen(false)} />
            <a className="block py-2" href="#contact" onClick={() => setMenuOpen(false)}>Contact us</a>
            <Link className="block py-2" to="/login">Sign in</Link>
          </div>
        )}
      </header>

      {/* Hero: pinned for ~120vh of scroll while pixel tiles in the next section's colour fill in
          from the bottom, the headline dims word by word, and the image slowly scales. */}
      <section id="top" ref={heroRef} className="relative -mt-20">
        <div className="relative h-screen min-h-[820px] overflow-hidden bg-[#0B1A33]">
          <div ref={heroImageRef} className="pointer-events-none absolute left-1/2 top-1/2 will-change-transform" style={{ width: 'max(100%, calc(820px * 1672 / 941))', aspectRatio: '1672 / 941', transform: 'translate3d(-50%, -50%, 0)' }} aria-hidden="true">
            <img src={heroImage} alt="" className="absolute inset-0 h-full w-full" />
            {heroCubes.map((cube, index) => (
              <img
                key={index}
                src={cube.src}
                alt=""
                className="hero-cube absolute"
                style={{ left: `${cube.left}%`, top: `${cube.top}%`, width: `${cube.width}%`, animationDuration: `${cube.duration}s`, animationDelay: `-${cube.delay}s`, '--float': `${cube.distance}px` }}
              />
            ))}
          </div>
          <div className="absolute inset-y-0 left-0 w-[42%] bg-gradient-to-r from-[#fff4e8]/70 to-transparent" />
          <div className="relative z-10 flex min-h-[820px] items-start px-5 pt-52 sm:px-8 sm:pt-64 lg:px-10 lg:pt-[17rem]">
            <div className="max-w-3xl">
              <h1 aria-label="Your clear path to automation results" className="text-5xl font-extrabold leading-[0.98] tracking-[-0.03em] sm:text-6xl lg:text-[68px]">
                {[['Your', 'clear', 'path'], ['to', 'automation', 'results']].map((line, l) => (
                  <span key={l} aria-hidden="true" className={`block ${l === 0 ? 'whitespace-nowrap' : 'sm:whitespace-nowrap'}`}>
                    {line.map((word, w) => <span key={word} data-hero-word className="inline-block will-change-[opacity]">{word}{w < line.length - 1 ? '\u00a0' : ''}</span>)}
                  </span>
                ))}
              </h1>
              <div ref={heroFadeRef} className="will-change-[opacity,transform]">
                <p className="mt-7 max-w-lg text-lg leading-relaxed text-[#172125]">
                  Design workflows, run them on robots, and monitor every job from one platform. Built for web, desktop, and document automation, with a full record of every run.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <a href="#path" className="bg-[#fa4616] px-6 py-3.5 text-base font-semibold text-white hover:bg-[#e23d12]">See how →</a>
                  <a href="#platform" className="border border-[#172125] bg-white/80 px-6 py-3.5 text-base font-semibold hover:bg-white">Explore the platform →</a>
                </div>
              </div>
            </div>
          </div>
          <canvas ref={heroTilesRef} className="pointer-events-none absolute inset-0 z-20 h-full w-full" aria-hidden="true" />
        </div>
      </section>

      <section id="path" ref={pathRef} className="relative h-[340vh] bg-[#FBF8F4] text-[#14213D]">
        <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-hidden bg-[linear-gradient(115deg,#FFFEFC_0%,#FCF8F3_42%,#F3F4FA_100%)]">
          <div className="pointer-events-none absolute -left-40 top-1/4 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(255,196,160,0.35),transparent)]" />
          <div className="relative z-10 mx-auto grid h-full w-full max-w-[1360px] items-center gap-16 px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:px-14 xl:gap-20">
            <div key={pathStep} className="landing-path-copy max-w-xl">
              <p className="inline-flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.24em] text-[#E8611A]"><span className="h-px w-6 bg-[linear-gradient(90deg,#F26B1D,transparent)]" />See the path in action</p>
              <h2 className="mt-5 text-[52px] font-extrabold leading-[0.92] tracking-[-0.045em] text-[#121C33] sm:text-[78px]">
                {pathSteps[pathStep].lead}<br /><span className="bg-[linear-gradient(100deg,#FF9A4D_0%,#F26B1D_45%,#D9480F_100%)] bg-clip-text pb-1 text-transparent">{pathSteps[pathStep].accent}</span>
              </h2>
              <p className="mt-6 max-w-[440px] text-[16.5px] leading-[1.7] tracking-[-0.005em] text-[#5B6474]">{pathSteps[pathStep].body}</p>
              <ul className="mt-9 grid max-w-[460px] gap-3.5">
                {pathSteps[pathStep].points.map(([icon, title, sub], index) => {
                  const active = index === pathPoints.point;
                  const shown = index < pathPoints.revealed;
                  return (
                    <li key={title} className={`transition-all duration-500 ${shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'}`}>
                      {/* Gradient border: a 1px padded gradient shell around a frosted card. */}
                      <div className={`rounded-[18px] p-px transition-shadow duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${active ? 'bg-[linear-gradient(135deg,#FFB27A_0%,#F26B1D_40%,#F7D9C6_100%)] shadow-[0_2px_4px_rgba(242,107,29,0.06),0_24px_44px_-24px_rgba(242,107,29,0.55)]' : 'bg-[linear-gradient(135deg,#EFE8E1,#F2EEE9)] shadow-[0_1px_2px_rgba(20,33,61,0.04),0_14px_30px_-24px_rgba(20,33,61,0.3)]'}`}>
                        <button type="button" onMouseEnter={() => { setPathPaused(true); setPathPoint(index); }} onMouseLeave={() => setPathPaused(false)} onFocus={() => { setPathPaused(true); setPathPoint(index); }} onBlur={() => setPathPaused(false)} onClick={() => setPathPoint(index)} aria-pressed={active}
                          className="relative flex w-full items-center gap-4 overflow-hidden rounded-[17px] bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(255,252,249,0.94))] py-3.5 pl-5 pr-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.95)] backdrop-blur-xl focus:outline-none">
                          <span className={`absolute inset-y-3 left-0 w-[3px] origin-center rounded-r-full bg-[linear-gradient(180deg,#FFA060,#E5520F)] transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${active ? 'scale-y-100 opacity-100' : 'scale-y-0 opacity-0'}`} />
                          <PathIcon name={icon} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-semibold tracking-[-0.01em] text-[#121C33]">{title}</span>
                            <span className="mt-0.5 block text-[13px] leading-5 text-[#6B7280]">{sub}</span>
                          </span>
                          <span className={`h-2 w-2 shrink-0 rounded-full transition-[transform,opacity] duration-500 ${active ? 'scale-100 bg-[#F26B1D] opacity-100' : 'scale-75 bg-[#E3DBD3] opacity-80'}`} />
                          {active && (
                            <span className="absolute inset-x-5 bottom-0 h-[2px] overflow-hidden rounded-full bg-[#F8E7DC]">
                              <span key={`${pathStep}-${index}-${pathPaused}`} className={`block h-full origin-left rounded-full bg-[linear-gradient(90deg,#FFB27A,#F26B1D)] ${pathPaused ? '' : 'landing-path-progress'}`} />
                            </span>
                          )}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-10 flex items-center gap-6">
                <a href={pathSteps[pathStep].href} className="group relative inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#FF8A3D_0%,#F26B1D_50%,#DE5410_100%)] px-6 py-3.5 text-[14px] font-semibold tracking-[-0.005em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_1px_2px_rgba(190,70,10,0.25),0_14px_28px_-14px_rgba(242,107,29,0.8)]">
                  <span className="pointer-events-none absolute -inset-1 rounded-2xl bg-[radial-gradient(closest-side,rgba(255,140,70,0.55),transparent)] opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-100" />
                  <span className="relative">{pathSteps[pathStep].cta}</span><span aria-hidden="true" className="relative transition-transform duration-300 ease-out group-hover:translate-x-1">→</span>
                </a>
                <ol className="flex items-center gap-1.5" aria-label="Path steps">
                  {pathSteps.map((item, index) => (
                    <li key={item.kicker} title={item.kicker} aria-current={index === pathStep ? 'step' : undefined} className={`h-1.5 rounded-full transition-all duration-300 ${index === pathStep ? 'w-7 bg-[#F26B1D]' : 'w-1.5 bg-[#E3D9CF]'}`} />
                  ))}
                </ol>
              </div>
            </div>
            <div className="hidden lg:block"><PathIllustration step={pathStep} point={pathPoints.point} /></div>
          </div>
        </div>
      </section>

      <section id="platform" className="bg-[#0e161c] text-white">
        <div data-reveal className="reveal mx-auto max-w-6xl px-5 pb-6 pt-20">
          <h2 className="max-w-3xl text-4xl font-bold text-white sm:text-5xl">Three components. Design, run, and monitor.</h2>
          <p className="mt-4 max-w-2xl text-lg text-white/75">Scroll each component. The active point stays on screen while the rest of the page moves.</p>
        </div>
        {pillars.map((pillar, index) => (
          <div key={pillar.number} ref={pillarRefs[index]} className="relative h-[240vh]">
            <div className="sticky top-20 mx-auto grid h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 px-5 lg:grid-cols-[0.82fr_1.18fr]">
              <div>
                <p className="landing-num text-6xl font-extrabold sm:text-7xl">{pillar.number}</p>
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#2ee0ef]">{pillar.eyebrow}</p>
                <h3 className="mt-2 text-3xl font-bold text-white">{pillar.title}</h3>
                <p className="mt-3 text-white/75">{pillar.lead}</p>
                <ul className="mt-6 space-y-3">
                  {pillar.points.map(([title, body], pointIndex) => (
                    <li key={title} className={`transition-opacity duration-500 ${pointIndex === pillarSteps[index] ? 'border border-white/10 bg-white/5 p-3 opacity-100' : 'opacity-40'}`}>
                      <p className="font-semibold">{title}</p>
                      <p className="mt-1 text-sm text-white/70">{body}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <FlowBoard pillar={pillar} sectionRef={pillarRefs[index]} />
            </div>
          </div>
        ))}
      </section>

      <UseCasesSection solutions={solutions} />

      <section id="start" className="bg-[#172125] py-20 text-white">
        <div data-reveal className="reveal mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-6 px-5">
          <div>
            <h2 className="text-4xl font-bold sm:text-5xl">Ready to start?</h2>
            <p className="mt-4 max-w-xl text-lg text-[#d7dde0]">Sign in, create a project, and publish a workflow. Dashboard counts come from the database after a run finishes.</p>
          </div>
          <Link to={startHref} className="bg-[#fa4616] px-6 py-3.5 font-semibold text-white hover:bg-[#e23d12]">
            {signedIn ? 'Open platform' : 'Try URAP free'}
          </Link>
        </div>
      </section>

      <LandingFooter />
      <AskAi />
    </div>
  );
}
