import { useEffect, useRef, useState } from 'react';
import markImg from '../assets/logo-mark-3d.png';

// Landing "#solutions" section: copy on the left, hub diagram of use cases on the right, benefit strip below.

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
const GLYPHS = {
  cart: <><path {...P} d="M3 4h2l2.2 10.5a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2" /><circle {...P} cx="9.5" cy="19.5" r="1.3" /><circle {...P} cx="17" cy="19.5" r="1.3" /></>,
  people: <><circle {...P} cx="9" cy="8" r="3.2" /><path {...P} d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><circle {...P} cx="16.8" cy="9" r="2.5" /><path {...P} d="M16.5 13.6c2.3.2 3.8 1.8 4.2 4.4" /></>,
  file: <><path {...P} d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path {...P} d="M14 3v5h5M9 13h6M9 17h4" /></>,
  database: <><ellipse {...P} cx="12" cy="5.5" rx="7" ry="2.8" /><path {...P} d="M5 5.5v13c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-13M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" /></>,
  gear: <><circle {...P} cx="12" cy="12" r="3" /><path {...P} d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" /><circle {...P} cx="12" cy="12" r="6.6" /></>,
  chart: <><path {...P} d="M4 20h16" /><rect {...P} x="5.5" y="12" width="3" height="6" rx=".6" /><rect {...P} x="10.5" y="7" width="3" height="11" rx=".6" /><rect {...P} x="15.5" y="10" width="3" height="8" rx=".6" /></>,
  bolt: <path {...P} d="M13 2.5 5 13.5h6l-1 8 8-11h-6z" />,
  shield: <><path {...P} d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6z" /><path {...P} d="m9 12 2.2 2.2L15.5 10" /></>,
  bars: <><path {...P} d="M6 20v-6M12 20V9M18 20V4" strokeWidth="3" /></>,
  chevron: <path {...P} d="m10 7 5 5-5 5" />,
  arrow: <path {...P} d="M5 12h14m-5-5 5 5-5 5" />,
};
function Glyph({ name, className = 'h-5 w-5' }) {
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true">{GLYPHS[name]}</svg>;
}

// Desktop (lg+) layout is a 3x3 grid: cards in the outer columns, the hub tile in the middle column.
// The middle column is clamp()-sized so there is always >= 40px between the tile's pedestal and any card.
export const USE_CASES = [
  { title: 'ERP', icon: 'cart', tint: 'bg-[#FFEDE4] text-[#F2551C]', cell: 'lg:col-start-1 lg:row-start-1 lg:ml-[6%]' },
  { title: 'CRM', icon: 'people', tint: 'bg-[#F1EBFF] text-[#7C5CE0]', cell: 'lg:col-start-3 lg:row-start-1 lg:mr-[6%]' },
  { title: 'Files', icon: 'file', tint: 'bg-[#E8F0FF] text-[#3B6FE0]', cell: 'lg:col-start-1 lg:row-start-2' },
  { title: 'Finance', icon: 'database', tint: 'bg-[#E3F6EA] text-[#1E9E57]', cell: 'lg:col-start-3 lg:row-start-2' },
  { title: 'Testing', icon: 'gear', tint: 'bg-[#FFF3D9] text-[#E09B0B]', cell: 'lg:col-start-1 lg:row-start-3 lg:ml-[6%]' },
  { title: 'Reporting', icon: 'chart', tint: 'bg-[#FFE8E8] text-[#E2453C]', cell: 'lg:col-start-3 lg:row-start-3 lg:mr-[6%]' },
];

export const BENEFITS = [
  ['Save time', 'Automate repetitive tasks', 'bolt', 'bg-[#FFEDE4] text-[#F2551C]'],
  ['Reduce errors', 'Get consistent results', 'shield', 'bg-[#E3F6EA] text-[#1E9E57]'],
  ['Improve productivity', 'Focus on high-value work', 'bars', 'bg-[#E8F0FF] text-[#3B6FE0]'],
  ['Scale easily', 'Across teams and systems', 'people', 'bg-[#F1EBFF] text-[#7C5CE0]'],
];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (t) => 1 - (1 - t) ** 3;
const span = (p, a, b) => ease(clamp01((p - a) / (b - a)));

// Scroll-linked choreography (p = 0..1 through the section). Everything has finished by p = 0.8.
export function revealPlan(p) {
  return {
    text: span(p, 0, 0.14),
    hub: span(p, 0.04, 0.18),
    cards: USE_CASES.map((_, i) => {
      const a = 0.18 + i * 0.09;
      return { line: span(p, a, a + 0.06), dot: span(p, a + 0.04, a + 0.07), card: span(p, a + 0.05, a + 0.11) };
    }),
    benefits: BENEFITS.map((_, j) => span(p, 0.64 + j * 0.03, 0.7 + j * 0.03)),
  };
}

function UseCaseCard({ item, body, cardRef, t = 1, side = 'left' }) {
  const dx = (1 - t) * (side === 'left' ? -36 : 36);
  return (
    <a ref={cardRef} href="/signup" style={t < 1 ? { opacity: t, translate: `${dx}px ${(1 - t) * 10}px`, scale: `${0.94 + 0.06 * t}` } : undefined} className={`group relative flex items-start gap-3 rounded-2xl border border-[#F1E4D8] bg-white/95 p-4 shadow-[0_10px_30px_-18px_rgba(120,60,20,0.35)] transition-[opacity,translate,scale,transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_18px_40px_-18px_rgba(250,70,22,0.35)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 lg:z-10 lg:self-center ${item.cell}`}>
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${item.tint}`}><Glyph name={item.icon} className="h-[22px] w-[22px]" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-[#FA4616]">Use case</span>
        <span className="mt-0.5 block text-[15px] font-bold text-[#172125]">{item.title}</span>
        <span className="mt-0.5 block whitespace-nowrap text-[12.5px] leading-[1.45] text-[#5B6569]">{body}</span>
      </span>
      <span className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-[#FFF3EC] text-[#FA4616] shadow-sm transition group-hover:bg-[#FA4616] group-hover:text-white"><Glyph name="chevron" className="h-3.5 w-3.5" /></span>
    </a>
  );
}

function Target({ x, y, pop = 1 }) {
  return (
    <span style={{ left: x, top: y, opacity: Math.min(1, pop * 1.5), scale: `${pop < 1 ? 0.3 + 0.7 * pop + Math.sin(pop * Math.PI) * 0.35 : 1}` }} className="hub-target absolute grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-[#FA4616]/75 bg-white shadow-[0_0_0_5px_rgba(250,70,22,0.12)]">
      <span className="h-2 w-2 rounded-full bg-[#FA4616]" />
    </span>
  );
}

// Point where the ray from the box centre towards (tx, ty) leaves the box.
function edgeToward(r, tx, ty) {
  const cx = r.x + r.w / 2; const cy = r.y + r.h / 2;
  const dx = tx - cx; const dy = ty - cy;
  const k = Math.min(Math.abs(dx) > 0 ? (r.w / 2) / Math.abs(dx) : Infinity, Math.abs(dy) > 0 ? (r.h / 2) / Math.abs(dy) : Infinity);
  return [cx + dx * k, cy + dy * k];
}

export function hubGeometry(box, tile, cards) {
  const cx = tile.x + tile.w / 2 - box.x;
  const cy = tile.y + tile.h / 2 - box.y;
  const nearest = Math.min(...cards.map((c) => {
    const [ex, ey] = edgeToward({ ...c, x: c.x - box.x, y: c.y - box.y }, cx, cy);
    return Math.hypot(ex - cx, ey - cy);
  }));
  // Inner ring sits in the clear band between the pedestal and the nearest card; outer ring runs under the cards.
  const r1 = Math.max(tile.w * 0.62, (tile.w * 0.6 + nearest) / 2);
  const r2 = r1 * 1.55;
  const links = cards.map((c) => {
    const [ex, ey] = edgeToward({ ...c, x: c.x - box.x, y: c.y - box.y }, cx, cy);
    const len = Math.hypot(ex - cx, ey - cy) || 1;
    return { x1: cx, y1: cy, x2: ex, y2: ey, tx: cx + ((ex - cx) / len) * r1, ty: cy + ((ey - cy) / len) * r1 };
  });
  return { cx, cy, r1, r2, links };
}

function HubOverlay({ geo, plan }) {
  if (!geo) return null;
  const { cx, cy, r1, r2, links } = geo;
  const hub = plan.hub;
  return (
    <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full overflow-visible" style={{ opacity: hub }}>
        <circle cx={cx} cy={cy} r={r2 * (0.85 + 0.15 * hub)} fill="none" stroke="#FA4616" strokeOpacity="0.28" strokeWidth="1.4" strokeDasharray="5 7" />
        <circle cx={cx} cy={cy} r={r1 * (0.85 + 0.15 * hub)} fill="none" stroke="#FA4616" strokeOpacity="0.38" strokeWidth="1.6" />
        {links.map((l, i) => { const t = plan.cards[i]?.line ?? 1; return t <= 0 ? null : <line key={i} className="usecase-link" x1={l.x1} y1={l.y1} x2={l.x1 + (l.x2 - l.x1) * t} y2={l.y1 + (l.y2 - l.y1) * t} stroke="#FA4616" strokeOpacity="0.6" strokeWidth="1.5" strokeDasharray="5 6" />; })}
      </svg>
      {links.map((l, i) => { const d = plan.cards[i]?.dot ?? 1; return d <= 0 ? null : <Target key={i} x={l.tx} y={l.ty} pop={d} />; })}
    </div>
  );
}

function HubTile({ tileRef, t = 1 }) {
  return (
    <div style={t < 1 ? { opacity: t, scale: `${0.8 + 0.2 * t}` } : undefined} className="pointer-events-none relative z-[5] hidden place-items-center lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:grid" aria-hidden="true">
      <div className="hub-glow absolute left-1/2 top-1/2 aspect-square w-[190%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,140,90,0.42)_0%,rgba(255,175,135,0.2)_38%,rgba(255,200,170,0)_68%)]" />
      <div ref={tileRef} className="hub-float relative aspect-[1/0.92] w-[clamp(120px,10.5vw,150px)]">
        {/* pedestal layers (lowest first) */}
        <div className="absolute left-[-8.5%] right-[-8.5%] top-[26%] bottom-[-26%] rounded-[30%] border border-white/80 bg-gradient-to-b from-white/50 to-[#FFD9C4]/50 shadow-[0_34px_50px_-26px_rgba(190,80,20,0.55)] backdrop-blur-[2px]" />
        <div className="absolute left-[-4%] right-[-4%] top-[13%] bottom-[-13%] rounded-[29%] border border-white bg-gradient-to-b from-white/85 to-[#FFE3D2]/80 shadow-[0_16px_26px_-16px_rgba(190,80,20,0.45)]" />
        {/* thick top: side band + face with bevel highlight */}
        <div className="absolute inset-0 translate-y-[7%] rounded-[28%] bg-gradient-to-b from-[#F7E3D6] to-[#EFCDB8]" />
        <div className="absolute inset-0 grid place-items-center rounded-[28%] border border-white bg-[radial-gradient(120%_90%_at_30%_15%,#FFFFFF_0%,#FFFBF8_45%,#FFEDE2_100%)] shadow-[inset_0_3px_0_rgba(255,255,255,1),inset_0_-10px_18px_rgba(250,110,50,0.10),0_10px_18px_-10px_rgba(160,70,20,0.35)]">
          <img src={markImg} alt="" className="h-[54%] w-[54%] object-contain drop-shadow-[0_8px_10px_rgba(200,70,20,0.28)]" />
        </div>
      </div>
    </div>
  );
}

export default function UseCasesSection({ solutions }) {
  const bodies = Object.fromEntries(solutions);
  const boxRef = useRef(null);
  const tileRef = useRef(null);
  const cardRefs = useRef([]);
  const [geo, setGeo] = useState(null);

  const sectionRef = useRef(null);
  const [progress, setProgress] = useState(1); // SSR / no-JS: everything visible
  const [desktop, setDesktop] = useState(true);
  const [seen, setSeen] = useState(() => USE_CASES.map(() => true));

  // Layout boxes from offsets (ignores the reveal/float transforms), relative to the diagram box.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    const rel = (el) => {
      let x = 0; let y = 0; let n = el;
      while (n && n !== box) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
      return { x, y, w: el.offsetWidth, h: el.offsetHeight };
    };
    const measure = () => {
      const tile = tileRef.current;
      if (!tile || !tile.offsetParent) { setGeo(null); return; }
      setGeo(hubGeometry({ x: 0, y: 0 }, rel(tile), cardRefs.current.filter(Boolean).map(rel)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  // Desktop: progress tied to scroll position (reversible). Mobile: per-card fade-up on intersection.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const mq = window.matchMedia('(min-width: 1024px)');
    let frame = 0; let io = null;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = sectionRef.current; if (!el) return;
        const r = el.getBoundingClientRect(); const vh = window.innerHeight;
        setProgress(clamp01((vh * 0.85 - r.top) / (Math.min(r.height, vh) * 0.9)));
      });
    };
    const setup = () => {
      window.removeEventListener('scroll', onScroll); io?.disconnect(); io = null;
      setDesktop(mq.matches);
      if (mq.matches) { setSeen(USE_CASES.map(() => true)); onScroll(); window.addEventListener('scroll', onScroll, { passive: true }); return; }
      setProgress(1);
      setSeen(USE_CASES.map(() => false));
      io = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { const i = cardRefs.current.indexOf(e.target); setSeen((v) => v.map((x, k) => x || k === i)); io.unobserve(e.target); }
      }, { threshold: 0.2 });
      cardRefs.current.forEach((c) => c && io.observe(c));
    };
    setup();
    mq.addEventListener('change', setup);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', onScroll); io?.disconnect(); mq.removeEventListener('change', setup); };
  }, []);

  const plan = revealPlan(progress);
  const fadeUp = (t) => (t < 1 ? { opacity: t, translate: `0 ${(1 - t) * 18}px` } : undefined);

  return (
    <section ref={sectionRef} id="solutions" className="relative overflow-hidden bg-gradient-to-br from-[#FFF8F2] via-[#FFF3EA] to-[#FDEADF] py-20">
      <div className="pointer-events-none absolute -left-40 bottom-0 h-80 w-[60%] rounded-[50%] bg-[#FBE0CF]/60 blur-3xl" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl px-5">
        <div className="grid items-center gap-12 xl:grid-cols-[minmax(0,0.52fr)_minmax(0,1.48fr)] xl:gap-10">
          <div style={fadeUp(plan.text)}>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#FA4616]">Automation across your business</p>
            <h2 className="mt-4 text-[34px] font-bold leading-[1.1] text-[#172125] sm:text-[40px] xl:text-[42px]">
              Automate the work you{' '}
              <span className="bg-gradient-to-r from-[#FA4616] to-[#FF8A4C] bg-clip-text text-transparent">already do</span>
            </h2>
            <p className="mt-5 max-w-md text-[17px] leading-relaxed text-[#3D474B]">Automate repetitive work across your business systems.</p>
            <a href="/signup" className="mt-8 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#FA4616] to-[#FF6A2B] px-5 py-3 text-[15px] font-semibold text-white shadow-[0_12px_24px_-12px_rgba(250,70,22,0.7)] transition hover:-translate-y-0.5 motion-reduce:transition-none">
              Explore all use cases <Glyph name="arrow" className="h-4 w-4" />
            </a>
          </div>
          <div ref={boxRef} className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_clamp(240px,22vw,280px)_minmax(0,1fr)] lg:gap-x-0 lg:gap-y-16 lg:py-6">
            <HubOverlay geo={geo} plan={plan} />
            <HubTile tileRef={tileRef} t={plan.hub} />
            {USE_CASES.map((item, i) => <UseCaseCard key={item.title} item={item} body={bodies[item.title]} cardRef={(el) => { cardRefs.current[i] = el; }} t={desktop ? plan.cards[i].card : (seen[i] ? 1 : 0)} side={desktop && i % 2 ? 'right' : 'left'} />)}
          </div>
        </div>
        <div className="mt-14 grid gap-5 rounded-2xl border border-[#F1E4D8] bg-white/90 p-5 shadow-[0_10px_30px_-20px_rgba(120,60,20,0.35)] sm:grid-cols-2 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-[#F1E4D8]">
          {BENEFITS.map(([title, body, icon, tint], j) => (
            <div key={title} style={fadeUp(plan.benefits[j])} className="flex items-center gap-3.5 lg:px-6 lg:first:pl-2">
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${tint}`}><Glyph name={icon} className="h-5 w-5" /></span>
              <span><span className="block text-[15px] font-bold text-[#172125]">{title}</span><span className="block text-[13px] text-[#5B6569]">{body}</span></span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
