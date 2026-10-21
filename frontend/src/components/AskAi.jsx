import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';
import { Icon } from './brand.jsx';

// Landing-page "Ask AI" assistant (UiPath style): a dark glass pill bottom-right that opens a
// blurred overlay with a glass panel bottom-centre. Questions go to POST /api/public/ask, which
// uses the server's AI provider or a built-in FAQ; the UI never shows raw errors.
export const ASK_CHIPS = [
  { topic: 'finance', label: 'Finance', question: 'How can URAP automate finance work like invoices?' },
  { topic: 'healthcare', label: 'Healthcare', question: 'How can URAP help healthcare teams?' },
  { topic: 'manufacturing', label: 'Manufacturing', question: 'How can URAP help manufacturing?' },
  { topic: 'hr', label: 'HR / Public sector', question: 'How can URAP help HR and public sector teams?' },
];
const FOLLOW_UPS = ['How do I get started?', 'Can it run on UiPath robots?', 'Which AI providers are supported?'];
const OFFLINE = 'I could not reach the assistant just now. You can still use "Try URAP free" to get started, or "Contact us" to talk to the team.';

function Sparkle({ className = 'h-4 w-4' }) {
  return <Icon name="sparkle" className={`${className} text-[#FF7A45]`} />;
}

function Typing() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Assistant is typing">
      {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60" style={{ animationDelay: `${i * 0.15}s` }} />)}
    </span>
  );
}

export default function AskAi({ ask = (body) => api('/api/public/ask', { method: 'POST', body }) }) {
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [text, setText] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const list = useRef(null);
  const pill = useRef(null);

  useEffect(() => { const t = setTimeout(() => setVisible(true), 600); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (!open) { setShown(false); return undefined; }
    const raf = requestAnimationFrame(() => setShown(true));
    const focus = setTimeout(() => input.current?.focus(), 60);
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(raf); clearTimeout(focus); window.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);

  function close() { setOpen(false); setTimeout(() => pill.current?.focus(), 0); }

  async function send(question, topic) {
    const q = String(question || '').trim().slice(0, 500);
    if (!q || busy) return;
    const history = messages.slice(-6).map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: 'user', content: q }]);
    setText('');
    setBusy(true);
    try {
      const result = await ask({ question: q, ...(topic ? { topic } : {}), history });
      setMessages((m) => [...m, { role: 'assistant', content: result?.data?.answer || OFFLINE }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: err?.status === 429 ? 'You are asking quickly. Please wait a minute and try again.' : OFFLINE }]);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  const chat = messages.length > 0;
  return (
    <>
      <button ref={pill} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="Ask AI about URAP"
        className={`fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-full border border-white/15 bg-[#172125]/80 py-2.5 pl-3.5 pr-5 text-[13.5px] text-white/85 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md transition-all duration-500 ease-out hover:bg-[#172125]/90 hover:text-white sm:bottom-6 sm:right-6 ${visible && !open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'}`}>
        <Sparkle />Ask AI about URAP…
      </button>

      {open && (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Ask AI about URAP">
          <div className={`absolute inset-0 bg-[#0B1A33]/40 backdrop-blur-[6px] transition-opacity duration-300 ${shown ? 'opacity-100' : 'opacity-0'}`} onClick={close} data-testid="ask-ai-backdrop" />
          <div className={`absolute bottom-3 left-1/2 w-[min(880px,calc(100%-24px))] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#1A252B]/85 p-3 text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-all duration-300 ease-out sm:bottom-6 ${shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}>
            {chat && (
              <div ref={list} className="mb-3 max-h-[min(52vh,460px)] space-y-3 overflow-y-auto px-1 pt-1 [scrollbar-width:thin]" aria-live="polite">
                {messages.map((m, i) => (m.role === 'user' ? (
                  <div key={i} className="flex justify-end"><p className="max-w-[85%] rounded-2xl rounded-br-md bg-[#FA4616] px-3.5 py-2 text-[14px] leading-relaxed text-white">{m.content}</p></div>
                ) : (
                  <div key={i} className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10"><Sparkle className="h-3.5 w-3.5" /></span>
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-md bg-white/[0.07] px-3.5 py-2 text-[14px] leading-relaxed text-white/90">{m.content}</p>
                  </div>
                )))}
                {busy && <div className="flex items-start gap-2.5"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10"><Sparkle className="h-3.5 w-3.5" /></span><div className="rounded-2xl rounded-tl-md bg-white/[0.07] px-3.5 py-1.5"><Typing /></div></div>}
              </div>
            )}
            <div className="flex items-center gap-2">
              <form className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-white/10 focus-within:border-[#FA4616]/50 bg-[#0F171C]/80 pl-3.5 pr-1.5" onSubmit={(event) => { event.preventDefault(); send(text); }}>
                <Sparkle />
                <input ref={input} value={text} maxLength={500} onChange={(event) => setText(event.target.value)} placeholder="Ask AI about URAP and automation…" aria-label="Your question"
                  style={{ outline: 'none', boxShadow: 'none', border: 0 }} className="min-w-0 flex-1 bg-transparent text-[16px] text-white placeholder:text-white/45 focus:outline-none sm:text-[14.5px]" />
                <button type="submit" disabled={!text.trim() || busy} aria-label="Send" title="Send"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10 text-white/80 transition-colors hover:bg-[#FA4616] hover:text-white disabled:opacity-40 disabled:hover:bg-white/10">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                </button>
              </form>
              <button type="button" onClick={close} aria-label="Close" title="Close" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white">
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            {!chat ? (
              <>
                <p className="mt-3 text-center text-[13px] text-white/55">Not sure where to start? Find out how to automate any business:</p>
                <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {ASK_CHIPS.map((chip) => (
                    <button key={chip.topic} type="button" onClick={() => send(chip.question, chip.topic)}
                      className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2.5 text-left text-[12px] font-semibold uppercase tracking-[0.04em] text-white/90 transition-colors hover:border-[#FA4616]/50 hover:bg-white/[0.1]">
                      <span className="text-[#FF6A33]" aria-hidden="true">→</span>{chip.label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {FOLLOW_UPS.map((q) => <button key={q} type="button" disabled={busy} onClick={() => send(q)} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[12px] text-white/75 hover:border-[#FA4616]/50 hover:text-white disabled:opacity-40">{q}</button>)}
                <a href="#contact" onClick={close} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[12px] text-white/75 hover:text-white">Contact us</a>
                <a href="/signup" className="rounded-full bg-[#FA4616] px-3 py-1 text-[12px] font-semibold text-white hover:bg-[#e23d12]">Try URAP free</a>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
