import { useState } from 'react';
import { Link } from 'react-router-dom';
import logoLightImage from '../assets/logo-light.png';

// Landing page footer: brand + socials, five link columns, newsletter card with lit cubes,
// a features strip, and the legal bar. Subscribe is frontend-only (validates, shows a message).
const COLUMNS = [
  ['Platform', [['Overview', '#platform'], ['Features', '#platform'], ['Use Cases', '#solutions'], ['Integrations', '#'], ['Security', '#'], ['Pricing', '#'], ["What's New", '#']]],
  ['Solutions', [['Finance Automation', '#solutions'], ['HR Automation', '#solutions'], ['IT Operations', '#solutions'], ['Data Processing', '#path'], ['Reporting & Analytics', '#'], ['Testing Automation', '#'], ['Custom Workflows', '#']]],
  ['Resources', [['Documentation', '#'], ['Tutorials', '#'], ['Community', '#'], ['Blog', '#'], ['Webinars', '#'], ['Case Studies', '#'], ['Support', '#contact']]],
  ['Developers', [['API Reference', '#'], ['SDKs', '#'], ['Examples', '#'], ['Changelog', '#'], ['Developer Portal', '/login'], ['Status', '#'], ['Contribute', '#']]],
  ['Company', [['About Us', '#top'], ['Careers', '#'], ['Contact Us', '#contact'], ['Partners', '#'], ['Privacy Policy', '#'], ['Terms of Service', '#'], ['Cookie Policy', '#']]],
];

const SOCIAL = [
  ['LinkedIn', 'M6.5 9.5v8M6.5 6.2v.1M10.5 17.5v-4.6c0-1.9 1.2-3.1 2.8-3.1s2.5 1.1 2.5 3v4.7M10.5 9.5v8'],
  ['YouTube', 'M3.5 8.6c.2-1.5 1.2-2.4 2.7-2.5C8 6 10 6 12 6s4 0 5.8.1c1.5.1 2.5 1 2.7 2.5.2 1.1.2 2.3.2 3.4s0 2.3-.2 3.4c-.2 1.5-1.2 2.4-2.7 2.5C16 18 14 18 12 18s-4 0-5.8-.1c-1.5-.1-2.5-1-2.7-2.5-.2-1.1-.2-2.3-.2-3.4s0-2.3.2-3.4zM10.3 9.4v5.2l4.4-2.6z'],
  ['GitHub', 'M9.5 19c-4 1.2-4-2-5.5-2.5M15 21v-3.2c0-1 .1-1.4-.5-2 2.6-.3 5-1.2 5-5.5a4.3 4.3 0 0 0-1.2-3 4 4 0 0 0-.1-3s-1-.3-3.2 1.2a11 11 0 0 0-5.8 0C6.9 4 5.9 4.3 5.9 4.3a4 4 0 0 0-.1 3 4.3 4.3 0 0 0-1.2 3c0 4.3 2.4 5.2 5 5.5-.6.6-.6 1.2-.5 2V21'],
  ['X', 'M5 5l14 14M19 5L5 19'],
];

const FEATURES = [
  ['Enterprise Ready', 'Secure & Reliable', 'M12 3.5l7 3v5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5v-5zM9 12l2 2 4-4'],
  ['Cloud or On-Premise', 'Flexible Deployment', 'M7.5 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6 3.7 3.7 0 0 1-.8 7.4z'],
  ['Scalable Platform', 'For Growing Teams', 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1'],
  ['Reduce Manual Work', 'Save Time & Cost', 'M13 2.5L5 13.5h6l-1 8 8-11h-6z'],
  ['Dedicated Support', "We're Here to Help", 'M4.5 13v-1a7.5 7.5 0 0 1 15 0v1M4.5 13h2.5v5H5.5a1 1 0 0 1-1-1zM19.5 13H17v5h1.5a1 1 0 0 0 1-1zM17 18c0 1.5-2 2.5-4.5 2.5'],
];

const LEGAL = [['Privacy Policy', '#'], ['Terms of Service', '#'], ['Cookie Policy', '#'], ['Sitemap', '#top']];

function Svg({ d, className = 'h-5 w-5' }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

function FooterLink({ href, children }) {
  const cls = 'text-[13px] text-white/60 lg:whitespace-nowrap transition-colors hover:text-white';
  return href.startsWith('/') ? <Link className={cls} to={href}>{children}</Link> : <a className={cls} href={href}>{children}</a>;
}

/** Decorative lit cubes (isometric SVG) for the newsletter card. */
function Cubes() {
  const cube = (x, y, s, glow) => (
    <g transform={`translate(${x} ${y})`}>
      <path d={`M0 ${s * 0.5} L${s} 0 L${s * 2} ${s * 0.5} L${s} ${s} Z`} fill={glow ? 'url(#cube-top-lit)' : 'url(#cube-top)'} />
      <path d={`M0 ${s * 0.5} L${s} ${s} L${s} ${s * 2.1} L0 ${s * 1.6} Z`} fill={glow ? 'url(#cube-left-lit)' : 'url(#cube-left)'} />
      <path d={`M${s} ${s} L${s * 2} ${s * 0.5} L${s * 2} ${s * 1.6} L${s} ${s * 2.1} Z`} fill={glow ? 'url(#cube-right-lit)' : 'url(#cube-right)'} />
      <path d={`M0 ${s * 0.5} L${s} 0 L${s * 2} ${s * 0.5} L${s} ${s} Z`} fill="none" stroke="rgba(255,190,140,0.35)" strokeWidth="0.8" />
    </g>
  );
  return (
    <svg viewBox="0 0 220 190" className="pointer-events-none absolute -right-2 -top-10 hidden h-[210px] w-[240px] md:block" aria-hidden="true">
      <defs>
        <linearGradient id="cube-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5a3a2a" /><stop offset="1" stopColor="#2a2220" /></linearGradient>
        <linearGradient id="cube-left" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a2a24" /><stop offset="1" stopColor="#1c1a1c" /></linearGradient>
        <linearGradient id="cube-right" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6b3d24" /><stop offset="1" stopColor="#2a1e1a" /></linearGradient>
        <linearGradient id="cube-top-lit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffb27a" /><stop offset="1" stopColor="#d9652a" /></linearGradient>
        <linearGradient id="cube-left-lit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f07a35" /><stop offset="1" stopColor="#7a3214" /></linearGradient>
        <linearGradient id="cube-right-lit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c4521c" /><stop offset="1" stopColor="#4a2414" /></linearGradient>
        <radialGradient id="cube-glow"><stop offset="0" stopColor="rgba(250,110,40,0.55)" /><stop offset="1" stopColor="rgba(250,110,40,0)" /></radialGradient>
      </defs>
      <ellipse cx="120" cy="140" rx="100" ry="40" fill="url(#cube-glow)" />
      {cube(100, 10, 42, false)}
      {cube(50, 70, 30, false)}
      {cube(88, 80, 44, true)}
    </svg>
  );
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
}

export default function LandingFooter() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState({ tone: '', text: '' });
  const year = new Date().getFullYear();

  function subscribe(event) {
    event.preventDefault();
    if (!isEmail(email)) { setState({ tone: 'error', text: 'Please enter a valid email address.' }); return; }
    setState({ tone: 'ok', text: "Thanks! You're on the list for URAP updates." });
    setEmail('');
  }

  return (
    <footer id="contact" className="relative overflow-hidden bg-[#121a21] text-white">
      <div className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[620px] rounded-full bg-[radial-gradient(closest-side,rgba(250,110,40,0.22),transparent)]" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" aria-hidden="true" />
      <div className="relative mx-auto max-w-[1360px] px-5 pb-6 pt-14 sm:px-8 lg:px-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,3.85fr)]">
          <div className="max-w-sm">
            <img src={logoLightImage} alt="URAP" className="h-11 w-auto" />
            <p className="mt-5 text-[13.5px] leading-[1.75] text-white/60">URAP is a modern automation platform that helps businesses design, run, and monitor workflows with ease. Automate repetitive tasks, integrate with your systems, and focus on what matters most.</p>
            <div className="mt-6 flex gap-3">
              {SOCIAL.map(([name, d]) => (
                <a key={name} href="#" aria-label={name} title={name} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/80 transition-colors hover:border-[#FA4616]/60 hover:bg-[#FA4616]/10 hover:text-white">
                  <Svg d={d} className="h-[18px] w-[18px]" />
                </a>
              ))}
            </div>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
            {COLUMNS.map(([title, items], i) => (
              <div key={title} className={`min-w-0 lg:px-5 ${i ? 'lg:border-l lg:border-white/[0.07]' : ''}`}>
                <p className="text-[14px] font-semibold text-white">{title}</p>
                <ul className="mt-4 space-y-2.5">{items.map(([label, href]) => <li key={label}><FooterLink href={href}>{label}</FooterLink></li>)}</ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="relative mt-12 overflow-visible rounded-2xl border border-white/[0.08] bg-[linear-gradient(100deg,rgba(255,255,255,0.03)_0%,rgba(250,110,40,0.06)_60%,rgba(250,110,40,0.12)_100%)] px-5 py-6 sm:px-7">
          <Cubes />
          <div className="relative grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:pr-[220px]">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-[#FA4616]/30 bg-[#FA4616]/15 text-[#FF7A45]"><Svg d="M3.5 6.5h17v11h-17zM3.5 7l8.5 6.5L20.5 7" className="h-6 w-6" /></span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#FF7A45]">Stay updated</p>
                <p className="mt-1 text-[22px] font-bold leading-tight tracking-[-0.01em] sm:text-[24px]">Get the latest from URAP</p>
                <p className="mt-1.5 text-[13px] text-white/55">Product updates, new features, automation tips, and more — straight to your inbox.</p>
              </div>
            </div>
            <form className="min-w-0" onSubmit={subscribe} noValidate>
              <div className="flex h-12 items-center overflow-hidden rounded-lg border border-white/15 bg-black/20 focus-within:border-[#FA4616]/60">
                <span className="pl-3.5 text-white/50"><Svg d="M3.5 6.5h17v11h-17zM3.5 7l8.5 6.5L20.5 7" className="h-4 w-4" /></span>
                <input type="email" value={email} onChange={(event) => { setEmail(event.target.value); if (state.tone) setState({ tone: '', text: '' }); }} placeholder="Enter your email address" aria-label="Email address" style={{ outline: 'none', boxShadow: 'none' }}
                  className="h-full min-w-0 flex-1 bg-transparent px-3 text-[14px] text-white placeholder:text-white/40" />
                <button type="submit" className="flex h-full shrink-0 items-center gap-2 bg-[#FA4616] px-4 sm:px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[#e23d12]">Subscribe <span aria-hidden="true">→</span></button>
              </div>
              <p className={`mt-2.5 flex items-center gap-1.5 text-[12px] ${state.tone === 'error' ? 'text-[#FF8A7A]' : state.tone === 'ok' ? 'text-[#7FD9A1]' : 'text-white/45'}`} role={state.tone ? 'status' : undefined}>
                <Svg d={state.tone === 'error' ? 'M12 8v5M12 16v.1M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z' : 'M12 3.5l7 3v5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5v-5zM9 12l2 2 4-4'} className="h-3.5 w-3.5" />
                {state.text || 'No spam. Unsubscribe anytime.'}
              </p>
            </form>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-y-5 border-y border-white/[0.07] py-6 sm:grid-cols-3 lg:grid-cols-5">
          {FEATURES.map(([title, sub, d], i) => (
            <div key={title} className={`flex items-center gap-3 lg:px-5 ${i ? 'lg:border-l lg:border-white/[0.07]' : ''}`}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.05] text-[#7FB2FF]"><Svg d={d} /></span>
              <span><span className="block text-[13px] font-semibold">{title}</span><span className="block text-[12px] text-white/50">{sub}</span></span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 py-5 text-[12.5px] text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} URAP. All rights reserved.</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {LEGAL.map(([label, href], i) => <span key={label} className="flex items-center gap-4">{i > 0 && <span className="h-3 w-px bg-white/15" aria-hidden="true" />}<a className="hover:text-white" href={href}>{label}</a></span>)}
          </div>
        </div>
      </div>
    </footer>
  );
}
