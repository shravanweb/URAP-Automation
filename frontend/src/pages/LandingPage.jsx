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
import logoLightImage from '../assets/logo-light.png';
import './landing-legacy.css';

// Floating cubes cut out of the hero image; positions are percentages of the 1672x941 artwork.
const heroCubes = [
  { src: cube1, left: 53.289, top: 27.949, width: 3.648, duration: 6.5, delay: 0, distance: 14 },
  { src: cube2, left: 68.78, top: 21.254, width: 3.289, duration: 5.5, delay: 1.2, distance: 10 },
  { src: cube3, left: 92.524, top: 19.66, width: 4.665, duration: 7.5, delay: 0.6, distance: 16 },
  { src: cube4, left: 66.208, top: 32.837, width: 2.093, duration: 5, delay: 2, distance: 8 },
  { src: cube5, left: 94.019, top: 42.508, width: 4.725, duration: 7, delay: 1.6, distance: 14 },
  { src: cube6, left: 52.512, top: 48.247, width: 2.033, duration: 6, delay: 0.9, distance: 8 },
];

const pathSteps = [
  { kicker: 'Read', title: 'Read the file', points: ['Excel and CSV rows', 'PDF text', 'The columns you choose'] },
  { kicker: 'Check', title: 'Validate the rows', points: ['Required fields', 'Duplicate values', 'Rules on the workflow'] },
  { kicker: 'Act', title: 'Enter the data', points: ['Robot on the desktop', 'Browser form', 'Approved connector'] },
  { kicker: 'Save', title: 'Save the result', points: ['Job status', 'Output file', 'Attempt history'] },
];

function PathStage({ step }) {
  const vp = { x: 430, y: 70 };
  const bottom = 520;
  const progress = 0.42 + step * 0.18;
  const start = { x: 210, y: bottom };
  const end = {
    x: start.x + (vp.x - start.x) * progress,
    y: start.y + (vp.y + 30 - start.y) * progress,
  };
  return (
    <svg viewBox="0 0 760 540" className="absolute inset-y-0 right-0 h-full w-[68%]" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => {
        const x = -80 + index * 78;
        return <line key={`v${x}`} x1={vp.x} y1={vp.y} x2={x} y2={bottom} stroke="rgba(255,255,255,0.32)" strokeWidth="1.4" />;
      })}
      {Array.from({ length: 8 }, (_, index) => {
        const t = ((index + 1) / 8) ** 1.45;
        const y = vp.y + (bottom - vp.y) * t;
        const spread = 40 + 460 * t;
        return <line key={`h${index}`} x1={vp.x - spread} y1={y} x2={vp.x + spread} y2={y} stroke="rgba(255,255,255,0.32)" strokeWidth="1.4" />;
      })}
      <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#ff5a1f" strokeWidth="14" strokeLinecap="round" />
    </svg>
  );
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
    edges: [[0, 1], [1, 3], [0, 2], [2, 4], [3, 4]],
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
    edges: [[0, 1], [1, 3], [0, 2], [2, 4], [3, 4]],
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
    edges: [[0, 1], [1, 3], [0, 2], [2, 4], [3, 4]],
    tags: { 1: 'Running', 4: 'Logged' },
  },
];

function FlowBoard({ pillar, active }) {
  const lit = new Set([active, active === pillar.points.length - 1 ? pillar.nodes.length - 1 : active]);
  return (
    <div className="relative h-[520px] overflow-hidden bg-[#10181e]" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.16) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        {pillar.edges.map(([from, to]) => (
          <line key={`${from}-${to}`} x1={`${pillar.nodes[from][2]}%`} y1={`${pillar.nodes[from][3]}%`} x2={`${pillar.nodes[to][2]}%`} y2={`${pillar.nodes[to][3]}%`} stroke={lit.has(from) || lit.has(to) ? '#2ee0ef' : '#1d4e57'} strokeWidth="2" />
        ))}
      </svg>
      {pillar.nodes.map(([title, stage, x, y], index) => {
        const on = lit.has(index);
        return (
          <div key={title} className="absolute w-[168px] -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
            {pillar.tags[index] && <span className={`mb-1 inline-block px-2 py-0.5 text-[10px] font-semibold ${on ? 'bg-[#2ee0ef] text-[#082126]' : 'bg-[#16343a] text-[#8fdbe3]'}`}>{pillar.tags[index]}</span>}
            <div className={`flex items-center gap-2 border px-3 py-2 ${on ? 'border-[#2ee0ef] bg-[#0f3c44] shadow-[0_0_22px_rgba(46,224,239,0.28)]' : 'border-[#1d6670] bg-[#121c24]'}`}>
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
  ['ERP', 'Sales orders, inventory, purchase orders, and shipment updates.'],
  ['CRM', 'Customer records, lead processing, and follow-up tasks.'],
  ['Finance', 'Invoice extraction, reconciliation, and report generation.'],
  ['Files', 'Excel, CSV, and PDF text processing with a saved result.'],
  ['Testing', 'Repeatable UI checks, API tests, and validation workflows.'],
  ['Reporting', 'Scheduled exports and a history of every run.'],
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

export default function LandingPage() {
  const signedIn = Boolean(currentUser());
  const startHref = signedIn ? '/dashboard' : '/signup';
  const pageRef = useRef(null);
  const pathRef = useRef(null);
  const pillarRefs = [useRef(null), useRef(null), useRef(null)];
  const [solidHeader, setSolidHeader] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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

      <header className={`sticky top-0 z-30 border-b transition-colors duration-300 ${solidHeader || menuOpen ? 'border-[#eadccd] bg-[#f6ebe0] shadow-[0_8px_24px_rgba(23,33,37,0.06)]' : 'border-[#172125]/10 bg-transparent hover:border-[#eadccd] hover:bg-[#f6ebe0] focus-within:border-[#eadccd] focus-within:bg-[#f6ebe0]'}`}>
        <div className="flex h-20 items-stretch px-5 sm:px-8 lg:px-10">
          <a href="#top" className="mr-6 flex shrink-0 items-center" aria-label="URAP home">
            <img src={logoImage} alt="URAP" className="h-[52px] w-auto max-w-[200px] object-contain" />
          </a>
          <nav className="hidden items-stretch xl:flex" aria-label="Main">
            {navMenus.map((menu) => (
              <div key={menu.label} className="group relative flex items-stretch">
                <a href={menu.items[0].href} className="inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 text-[15px] font-medium text-[#172125] hover:text-[#fa4616] 2xl:px-3 2xl:text-[16px]">
                  {menu.icon === 'code' && (
                    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M6.2 5.5 3.8 8l2.4 2.5M9.8 5.5 12.2 8l-2.4 2.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
                  )}
                  {menu.label}
                </a>
                <div className="invisible absolute left-0 top-full z-40 w-80 border border-[#e6e1da] bg-white p-2 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                  {menu.items.map((item) => (
                    <a key={item.name} href={item.href} className="block px-3 py-2 hover:bg-[#fff6f2]">
                      <span className="block text-sm font-semibold text-[#172125]">{item.name}</span>
                      <span className="block text-xs text-[#5c656a]">{item.detail}</span>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </nav>
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
            {navMenus.map((menu) => (
              <a key={menu.label} className="block py-2" href={menu.items[0].href} onClick={() => setMenuOpen(false)}>{menu.label}</a>
            ))}
            <a className="block py-2" href="#contact" onClick={() => setMenuOpen(false)}>Contact us</a>
            <Link className="block py-2" to="/login">Sign in</Link>
          </div>
        )}
      </header>

      <section id="top" className="relative -mt-20 min-h-[820px] overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: 'max(100%, calc(820px * 1672 / 941))', aspectRatio: '1672 / 941' }} aria-hidden="true">
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
            <h1 className="text-5xl font-extrabold leading-[0.98] tracking-[-0.03em] sm:text-6xl lg:text-[68px]">
              <span className="block whitespace-nowrap">Your clear path</span>
              <span className="block sm:whitespace-nowrap">to automation results</span>
            </h1>
            <p className="mt-7 max-w-lg text-lg leading-relaxed text-[#172125]">
              Design workflows, run them on robots, and monitor every job from one platform. Built for web, desktop, and document automation, with a full record of every run.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="#path" className="bg-[#fa4616] px-6 py-3.5 text-base font-semibold text-white hover:bg-[#e23d12]">See how →</a>
              <a href="#platform" className="border border-[#172125] bg-white/80 px-6 py-3.5 text-base font-semibold hover:bg-white">Explore the platform →</a>
            </div>
          </div>
        </div>
      </section>

      <section id="path" ref={pathRef} className="relative h-[340vh] bg-[#10161b] text-white">
        <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-hidden">
          <PathStage step={pathStep} />
          <div className="relative z-10 mx-auto flex h-full max-w-6xl flex-col justify-center px-5">
            <p className="text-sm font-medium text-white/60">See the path in action</p>
            <h2 className="mt-4 max-w-xl text-5xl font-extrabold leading-[0.95] text-[#2ec4c8] sm:text-7xl">{pathSteps[pathStep].title}</h2>
            <ul className="mt-8 w-full max-w-md border border-white/10 bg-[#10161b]/55 p-6 backdrop-blur-sm">
              {pathSteps[pathStep].points.map((point) => (
                <li key={point} className="flex items-center gap-3 py-1.5 text-lg">
                  <span className="inline-block h-2.5 w-2.5 bg-[#2ec4c8]" />
                  {point}
                </li>
              ))}
            </ul>
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
              <FlowBoard pillar={pillar} active={pillarSteps[index]} />
            </div>
          </div>
        ))}
      </section>

      <section id="solutions" className="bg-[#fff7f0] py-20">
        <div data-reveal className="reveal mx-auto max-w-6xl px-5">
          <h2 className="max-w-3xl text-4xl font-bold sm:text-5xl">Automation across the work you already do</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {solutions.map(([title, body]) => (
              <article key={title} className="border-t-4 border-[#fa4616] bg-white p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#fa4616]">Use case</p>
                <h3 className="mt-3 text-2xl font-bold">{title}</h3>
                <p className="mt-3 text-[#3d474b]">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

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

      <footer id="contact" className="bg-[#172125] px-5 py-10 text-sm text-white/70">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-6">
          <img src={logoLightImage} alt="URAP" className="h-9 w-auto" />
          <div className="flex gap-6">
            <a href="#platform">Platform</a>
            <a href="#solutions">Solutions</a>
            <Link to="/login">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
