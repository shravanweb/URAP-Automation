import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { LogoMark } from './brand.jsx';
import { activityCount, subscribeActivity } from '../services/activity.js';

// Motion lives in index.css (urap-loader-*) and is switched off under prefers-reduced-motion.

/** Branded loader: URAP mark inside a soft ring with an orange sweeping arc. */
export function BrandLoader({ label = 'Loading', size = 'md', className = '' }) {
  const box = size === 'sm' ? 'h-10 w-10' : size === 'lg' ? 'h-20 w-20' : 'h-14 w-14';
  const mark = size === 'sm' ? 'h-5 w-5' : size === 'lg' ? 'h-10 w-10' : 'h-7 w-7';
  return (
    <div role="status" aria-live="polite" className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <span className={`relative grid ${box} place-items-center`}>
        <span className="absolute inset-0 rounded-full border-2 border-[#F1E7DD]" aria-hidden="true" />
        <span className="urap-loader-arc absolute inset-0 rounded-full border-2 border-transparent border-t-[#FA4616] border-r-[#FA4616]/40" aria-hidden="true" />
        <span className="urap-loader-pulse grid place-items-center rounded-full bg-white shadow-[0_6px_18px_-8px_rgba(250,70,22,0.45)]" style={{ width: '70%', height: '70%' }}>
          <LogoMark className={mark} />
        </span>
      </span>
      {label ? <span className="text-[13px] font-medium tracking-wide text-[#6B7280]">{label}…</span> : <span className="sr-only">Loading…</span>}
    </div>
  );
}

/** Full-area loader for app boot and lazy route chunks. */
export function PageLoader({ label = 'Loading' }) {
  return (
    <div className="grid min-h-[60vh] w-full place-items-center bg-transparent">
      <BrandLoader label={label} size="lg" />
    </div>
  );
}

/** Inline spinner for buttons and small areas. */
export function Spinner({ className = 'h-4 w-4' }) {
  return <span className={`urap-loader-arc inline-block rounded-full border-2 border-[#F1E7DD] border-t-[#FA4616] ${className}`} aria-hidden="true" />;
}

/** Shimmering placeholder block. */
export function Skeleton({ className = 'h-4 w-full' }) {
  return <span className={`urap-skeleton block rounded-md ${className}`} aria-hidden="true" />;
}

/** Placeholder rows shaped like a list/table while data loads. */
export function SkeletonRows({ rows = 5, cols = 4, label = 'Loading' }) {
  return (
    <div role="status" aria-label={label} className="divide-y divide-[#EFE9E2] overflow-hidden rounded-xl border border-[#EFE9E2] bg-white">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5">
          <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={`h-3.5 ${c === 0 ? 'w-1/4' : c === cols - 1 ? 'w-16 ml-auto' : 'w-1/6'}`} />
          ))}
        </div>
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/** Placeholder metric cards. */
export function SkeletonCards({ count = 4 }) {
  return (
    <div role="status" aria-label="Loading" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-[#EFE9E2] bg-white p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-4 h-7 w-16" />
          <Skeleton className="mt-3 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/**
 * Thin top progress bar. Shows while API requests are in flight (after a short delay so quick
 * requests and background polls don't flicker) and briefly on every route change.
 */
export function TopProgress() {
  const location = useLocation();
  const [busy, setBusy] = useState(() => activityCount() > 0);
  const [routeTick, setRouteTick] = useState(false);
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);
  const delay = useRef(null);
  const first = useRef(true);

  useEffect(() => subscribeActivity((n) => setBusy(n > 0)), []);

  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    setRouteTick(true);
    const t = setTimeout(() => setRouteTick(false), 350);
    return () => clearTimeout(t);
  }, [location.pathname]);

  const active = busy || routeTick;
  useEffect(() => {
    clearTimeout(delay.current);
    if (active) {
      setDone(false);
      delay.current = setTimeout(() => setVisible(true), routeTick ? 0 : 250);
    } else if (visible) {
      setDone(true);
      delay.current = setTimeout(() => { setVisible(false); setDone(false); }, 320);
    }
    return () => clearTimeout(delay.current);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]" role="progressbar" aria-label="Loading" aria-busy={!done}>
      <div className={`urap-progress h-full bg-gradient-to-r from-[#FA4616] via-[#FF7A45] to-[#FFB08A] shadow-[0_0_8px_rgba(250,70,22,0.55)] ${done ? 'urap-progress-done' : ''}`} />
    </div>
  );
}
