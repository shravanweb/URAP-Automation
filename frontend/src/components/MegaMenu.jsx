import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

// UiPath-style mega menus for the landing navbar: a cream panel under the bar with a small caret
// under the active item, one or two groups (teal and orange headings) split by a soft divider,
// and a "Browse all …" footer row per group. Desktop opens on hover (with a short delay), click,
// or keyboard focus; Esc, an outside click, or leaving the menu closes it. Mobile is an accordion.

const S = (heading, href, links = [], badge) => ({ heading, href, links, badge });

export const MEGA_MENUS = [
  { label: 'Platform', groups: [
    { title: 'Products', tone: 'teal', cols: 2, sections: [
      S('Studio', '#platform', [['Visual workflow designer', '/workflows/new'], ['Recorder & codegen import', '#platform']]),
      S('Robots', '#platform', [['Server workers', '#platform'], ['UiPath & URAP agent', '#platform']]),
      S('Orchestrator', '#platform', [['Jobs, schedules & queues', '#platform'], ['Logs & metrics', '#platform']]),
      S('Action Center', '#path', [['Approvals & validations', '#path'], ['Human-in-the-loop review', '#path']]),
      S('Document Understanding', '#path', [['Invoice & receipt extraction', '#path'], ['OCR with confidence', '#path']]),
      S('AI agents', '#platform', [['Tools and providers', '#platform']], 'NEW'),
    ], browse: ['the platform', '#platform'] },
    { title: 'Capabilities', tone: 'orange', sections: [
      S('Templates', '#path'), S('Connections & credentials', '#platform'), S('Roles & audit logs', '#platform'), S('Apps, cases & BPMN', '#platform'),
    ], browse: ['capabilities', '#platform'] },
  ] },
  { label: 'Solutions', groups: [
    { title: 'Industries', tone: 'teal', cols: 2, sections: [
      S('Banking & financial services', '#solutions', [['Loan document intake', '#solutions'], ['Reconciliation', '#solutions']]),
      S('Manufacturing', '#solutions', [['Purchase order processing', '#solutions'], ['Inventory sync', '#solutions']]),
      S('Healthcare', '#solutions', [['Claims intake', '#solutions'], ['Referral documents', '#solutions']]),
      S('Insurance', '#solutions', [['Policy & claim updates', '#solutions']]),
      S('Retail & e-commerce', '#solutions', [['Order and catalog updates', '#solutions']], 'NEW'),
      S('Public sector', '#solutions', [['Citizen requests', '#solutions']]),
    ], browse: ['industries', '#solutions'] },
    { title: 'Departments', tone: 'orange', sections: [
      S('Finance & accounting', '#solutions', [['Invoice processing', '#path'], ['Procure-to-pay', '#solutions'], ['Order-to-cash', '#solutions']]),
      S('Human resources', '#solutions'), S('IT operations', '#solutions'), S('Customer service', '#solutions'), S('QA / testing', '#solutions'),
    ], browse: ['departments', '#solutions'] },
  ] },
  { label: 'Resources', groups: [
    { title: 'Learn', tone: 'teal', cols: 2, sections: [
      S('Documentation', '#', [['Getting started', '#path'], ['Workflow activities', '#']]),
      S('Tutorials', '#', [['Build your first workflow', '#path'], ['Invoice extraction', '#path']]),
      S('Blog', '#'), S('Webinars', '#'),
    ], browse: ['resources', '#'] },
    { title: 'Community & help', tone: 'orange', sections: [
      S('Community', '#'), S('Support', '#contact'), S('Terms of Use', '/legal'), S('Privacy Notice', '/legal'),
    ], browse: ['help', '#contact'] },
  ] },
  { label: 'Developers', icon: 'code', groups: [
    { title: 'Build', tone: 'teal', cols: 2, sections: [
      S('API reference', '#', [['Jobs & workflows API', '#'], ['Webhooks', '#']]),
      S('SDKs', '#', [['Robot agent (npm run robot)', '#platform']]),
      S('Developer portal', '/login', [['Sign in to your tenant', '/login']]),
      S('Examples', '#', [['Playwright codegen import', '#platform']]),
    ], browse: ['developer docs', '#'] },
    { title: 'Stay current', tone: 'orange', sections: [S('Changelog', '#', [], 'NEW'), S('Status', '#'), S('Contribute', '#')], browse: ['updates', '#'] },
  ] },
  { label: 'Software testing', groups: [
    { title: 'Testing', tone: 'teal', cols: 2, sections: [
      S('UI test automation', '#solutions', [['Browser checks with Playwright', '#solutions']]),
      S('API testing', '#solutions', [['Request & response assertions', '#solutions']]),
      S('Data validation', '#solutions', [['Excel & CSV rules', '#path']]),
      S('Test runs in Orchestrator', '#platform', [['Schedules & history', '#platform']]),
    ], browse: ['testing', '#solutions'] },
  ] },
];

const TONE = { teal: 'text-[#0E8A94]', orange: 'text-[#E8611A]' };

function MenuLink({ href, className, children, onClick }) {
  return href.startsWith('/') ? <Link to={href} className={className} onClick={onClick}>{children}</Link> : <a href={href} className={className} onClick={onClick}>{children}</a>;
}

function Badge() {
  return <span className="ml-1.5 inline-block translate-y-[-1px] rounded-[3px] bg-[#FA4616] px-1 py-px align-middle text-[9px] font-bold tracking-wide text-white">NEW</span>;
}

function Group({ group, onPick, last }) {
  const twoCol = group.cols === 2;
  return (
    <div className={`flex min-w-0 flex-col ${last ? '' : ''}`}>
      <p className={`text-[12px] font-bold uppercase tracking-[0.12em] ${TONE[group.tone]}`}>{group.title}</p>
      <div className={`mt-4 grid flex-1 content-start gap-x-10 ${twoCol ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {group.sections.map((section, i) => {
          const rowEnd = twoCol ? i >= group.sections.length - (group.sections.length % 2 || 2) : i === group.sections.length - 1;
          const withLinks = section.links.length > 0;
          return (
            <div key={section.heading} className={withLinks ? `py-3 ${rowEnd ? '' : 'border-b border-[#E4D8CB]'}` : 'py-1.5'}>
              <MenuLink href={section.href} onClick={onPick} className="text-[15px] font-medium text-[#172125] hover:text-[#FA4616]">{section.heading}{section.badge && <Badge />}</MenuLink>
              {withLinks && <ul className="mt-2 space-y-1.5">{section.links.map(([label, href]) => <li key={label}><MenuLink href={href} onClick={onPick} className="text-[12.5px] text-[#3C464C] hover:text-[#FA4616]">{label}</MenuLink></li>)}</ul>}
            </div>
          );
        })}
      </div>
      {group.browse && (
        <div className="mt-4 border-t border-[#E4D8CB] pt-4 text-center text-[13px] text-[#5C656A]">
          Browse <MenuLink href={group.browse[1]} onClick={onPick} className="font-semibold text-[#172125] hover:text-[#FA4616]">all {group.browse[0]} <span aria-hidden="true">→</span></MenuLink>
        </div>
      )}
    </div>
  );
}

export function MegaPanel({ menu, id, onPick }) {
  const two = menu.groups.length > 1;
  return (
    <div id={id} className="rounded-b-[6px] border border-t-0 border-[#E4D8CB] bg-[#F6EDE3] px-8 py-7 shadow-[0_24px_48px_-24px_rgba(23,33,37,0.35)]">
      <div className={`grid gap-10 ${two ? 'grid-cols-[minmax(0,1.85fr)_1px_minmax(0,1fr)]' : 'grid-cols-1'}`}>
        <Group group={menu.groups[0]} onPick={onPick} />
        {two && <span className="bg-[#E4D8CB]" aria-hidden="true" />}
        {two && <Group group={menu.groups[1]} onPick={onPick} last />}
      </div>
    </div>
  );
}

function CodeIcon() {
  return <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M6.2 5.5 3.8 8l2.4 2.5M9.8 5.5 12.2 8l-2.4 2.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>;
}

export function DesktopMegaNav({ menus = MEGA_MENUS, onOpenChange, initialOpen = -1 }) {
  const [open, setOpen] = useState(initialOpen);
  const root = useRef(null);
  const timer = useRef(0);
  const buttons = useRef([]);
  const quietFocus = useRef(false); // focus restored after Esc must not reopen the menu
  const base = useId();
  const schedule = (fn, ms) => { clearTimeout(timer.current); timer.current = setTimeout(fn, ms); };
  useEffect(() => { onOpenChange?.(open >= 0); }, [open, onOpenChange]);
  useEffect(() => {
    if (open < 0) return undefined;
    const onDown = (event) => { if (!root.current?.contains(event.target)) setOpen(-1); };
    const onKey = (event) => { if (event.key === 'Escape') { const i = open; clearTimeout(timer.current); setOpen(-1); quietFocus.current = true; buttons.current[i]?.focus(); quietFocus.current = false; } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const active = open >= 0 ? menus[open] : null;
  return (
    <nav ref={root} className="relative hidden items-stretch xl:flex" aria-label="Main"
      onMouseLeave={() => schedule(() => setOpen(-1), 180)}
      onBlur={(event) => { if (!root.current?.contains(event.relatedTarget)) setOpen(-1); }}>
      {menus.map((menu, i) => (
        <div key={menu.label} className="relative flex items-stretch" onMouseEnter={() => schedule(() => setOpen(i), open >= 0 ? 60 : 140)}>
          <button ref={(el) => { buttons.current[i] = el; }} type="button" aria-expanded={open === i} aria-controls={`${base}-panel-${i}`}
            onClick={() => { clearTimeout(timer.current); setOpen((cur) => (cur === i ? -1 : i)); }}
            onFocus={() => { if (quietFocus.current) return; clearTimeout(timer.current); setOpen(i); }}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 text-[15px] font-medium transition-colors 2xl:px-3 2xl:text-[16px] ${open === i ? 'text-[#0E8A94]' : 'text-[#172125] hover:text-[#FA4616]'}`}>
            {menu.icon === 'code' && <CodeIcon />}{menu.label}
          </button>
          {open === i && <span className="pointer-events-none absolute bottom-2.5 left-1/2 z-50 h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[6px] border-x-transparent border-t-[#172125]" aria-hidden="true" />}
        </div>
      ))}
      {active && (
        <div className="absolute left-0 top-full z-40 w-[min(1000px,calc(100vw-120px))]" onMouseEnter={() => clearTimeout(timer.current)}>
          <MegaPanel menu={active} id={`${base}-panel-${open}`} onPick={() => setOpen(-1)} />
        </div>
      )}
    </nav>
  );
}

export function MobileMegaNav({ menus = MEGA_MENUS, onPick }) {
  const [open, setOpen] = useState(-1);
  return (
    <div className="divide-y divide-[#E4D8CB]">
      {menus.map((menu, i) => (
        <div key={menu.label}>
          <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)} className={`flex w-full items-center justify-between py-3 text-left text-[15px] font-medium ${open === i ? 'text-[#0E8A94]' : 'text-[#172125]'}`}>
            {menu.label}<span aria-hidden="true" className={`transition-transform ${open === i ? 'rotate-180' : ''}`}>▾</span>
          </button>
          {open === i && (
            <div className="space-y-4 pb-4">
              {menu.groups.map((group) => (
                <div key={group.title}>
                  <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${TONE[group.tone]}`}>{group.title}</p>
                  <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">{group.sections.map((s) => <li key={s.heading}><MenuLink href={s.href} onClick={onPick} className="text-[14px] text-[#172125]">{s.heading}{s.badge && <Badge />}</MenuLink></li>)}</ul>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
