'use client';

import React, { useEffect, useRef, useState } from 'react';
import { userStore, useUserStore, errorText } from '@/lib/user-store';
import { authMessage, confirmCode, sendCode, signInWithGoogle } from '@/lib/client/auth';
import { getStarterAvatar } from '@/lib/cosmetics-catalog';
import AvatarView from '@/components/avatar/AvatarView';
import { ShieldCheck, Smartphone, ChevronLeft, Loader2 } from 'lucide-react';

const DISPLAY = { fontFamily: "'Lilita One', system-ui, sans-serif" };

function Logo() {
  return (
    <div className="flex flex-col items-center gap-2 mb-8">
      <svg viewBox="0 0 512 512" className="w-20 h-20 drop-shadow-[0_8px_24px_rgba(245,158,11,0.35)]" aria-hidden>
        <defs>
          <linearGradient id="ag-c" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fde68a" />
            <stop offset="1" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <path d="M96 196 L176 268 L256 120 L336 268 L416 196 L388 368 H124 Z" fill="url(#ag-c)" stroke="#92400e" strokeWidth="14" strokeLinejoin="round" />
        <rect x="124" y="356" width="264" height="44" rx="14" fill="#f59e0b" stroke="#92400e" strokeWidth="14" />
      </svg>
      <div className="text-4xl leading-none text-white tracking-wide" style={DISPLAY}>
        RIVAL<span className="text-amber-400">ARCADE</span>
      </div>
      <p className="text-sm text-slate-400">Skill games. Real rivals.</p>
    </div>
  );
}

function Shell({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-[radial-gradient(ellipse_at_top,#1b2350_0%,#090b16_60%)] px-4 py-10" data-testid="auth-gate">
      <div className="relative w-full max-w-sm">
        {onBack && (
          <button onClick={onBack} aria-label="Back" className="absolute -top-2 left-0 w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/70">
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

const fmtPhone = (digits: string) => {
  const d = digits.slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="w-5 h-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Phone number → text code. `link` adds the number to a Google account. */
function PhoneFlow({ link, onBack }: { link: boolean; onBack?: () => void }) {
  const [digits, setDigits] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const phone = `+1${digits}`;
  const send = async () => {
    setErr(null);
    if (digits.length !== 10) return setErr('Enter your 10-digit mobile number.');
    setBusy(true);
    try {
      await sendCode(phone, 'recaptcha-box', link);
      setStep('code');
      setCode('');
      setWait(30);
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (e) {
      setErr(authMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const verify = async (c = code) => {
    if (c.length !== 6 || busy) return;
    setErr(null);
    setBusy(true);
    try {
      await confirmCode(c);
      if (link) await userStore.refresh();
    } catch (e) {
      setErr(authMessage(e));
      setCode('');
      setBusy(false);
    }
  };

  if (step === 'code') {
    return (
      <Shell onBack={() => setStep('phone')}>
        <div className="text-center mb-6 pt-8">
          <Smartphone className="w-10 h-10 text-cyan-300 mx-auto mb-3" />
          <h1 className="text-2xl text-white" style={DISPLAY}>
            Enter your code
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Sent to <span className="text-white font-bold">+1 {fmtPhone(digits)}</span>
          </p>
        </div>
        <label className="relative block" onClick={() => codeRef.current?.focus()}>
          <span className="sr-only">6-digit code</span>
          <input
            ref={codeRef}
            data-testid="code-input"
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 6);
              setCode(v);
              if (v.length === 6) void verify(v);
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            className="absolute inset-0 opacity-0 w-full h-full"
            aria-label="6-digit code"
          />
          <div className="grid grid-cols-6 gap-2" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className={`h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-black text-white ${i === code.length ? 'border-cyan-400 bg-cyan-400/10' : code[i] ? 'border-white/25 bg-white/5' : 'border-white/10 bg-white/[0.03]'}`}>
                {code[i] ?? ''}
              </div>
            ))}
          </div>
        </label>
        {err && <p className="mt-4 text-sm text-rose-300 text-center" role="alert">{err}</p>}
        <button onClick={() => verify()} disabled={code.length !== 6 || busy} className="mt-6 w-full h-14 rounded-2xl bg-amber-400 text-black font-black text-lg disabled:opacity-40 flex items-center justify-center gap-2" data-testid="verify-code">
          {busy && <Loader2 className="w-5 h-5 animate-spin" />} Verify
        </button>
        <button onClick={send} disabled={wait > 0 || busy} className="mt-3 w-full h-11 text-sm font-bold text-cyan-300 disabled:text-slate-500">
          {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
        </button>
        <div id="recaptcha-box" />
      </Shell>
    );
  }

  return (
    <Shell onBack={onBack}>
      {link ? (
        <div className="text-center mb-6 pt-8">
          <ShieldCheck className="w-10 h-10 text-emerald-300 mx-auto mb-3" />
          <h1 className="text-2xl text-white" style={DISPLAY}>
            Add your mobile number
          </h1>
          <p className="text-sm text-slate-400 mt-1">One account per phone keeps every match fair. We’ll text you a code.</p>
        </div>
      ) : (
        <Logo />
      )}
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2" htmlFor="phone">
        Mobile number
      </label>
      <div className="flex items-center h-14 rounded-2xl bg-white/5 border border-white/10 focus-within:border-cyan-400 px-4 gap-3">
        <span className="text-white/70 font-bold">🇺🇸 +1</span>
        <input
          id="phone"
          data-testid="phone-input"
          value={fmtPhone(digits)}
          onChange={(e) => setDigits(e.target.value.replace(/\D/g, '').replace(/^1(?=\d{10})/, '').slice(0, 10))}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="(555) 555-5555"
          className="flex-1 bg-transparent outline-none text-white text-lg font-bold placeholder:text-white/20"
        />
      </div>
      {err && <p className="mt-3 text-sm text-rose-300" role="alert">{err}</p>}
      <button onClick={send} disabled={busy} className="mt-5 w-full h-14 rounded-2xl bg-amber-400 text-black font-black text-lg disabled:opacity-50 flex items-center justify-center gap-2" data-testid="send-code">
        {busy && <Loader2 className="w-5 h-5 animate-spin" />} {link ? 'Text me a code' : 'Continue'}
      </button>
      {!link && (
        <>
          <div className="flex items-center gap-3 my-5 text-[11px] font-bold uppercase tracking-widest text-slate-500">
            <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
          </div>
          <button
            onClick={async () => {
              setErr(null);
              try {
                await signInWithGoogle();
              } catch (e) {
                setErr(authMessage(e));
              }
            }}
            className="w-full h-14 rounded-2xl bg-white text-slate-900 font-bold flex items-center justify-center gap-3"
            data-testid="google-signin"
          >
            <GoogleIcon /> Continue with Google
          </button>
        </>
      )}
      <p className="mt-6 text-[11px] leading-relaxed text-slate-500 text-center">
        Mobile numbers only (no VoIP). Message and data rates may apply. By continuing you agree to the{' '}
        <a href="/terms" className="underline text-slate-300">Terms</a> and <a href="/privacy" className="underline text-slate-300">Privacy Policy</a>. Cash games are 18+ and not available in every state.
      </p>
      <div className="mt-3 flex justify-center gap-4 text-[11px] font-bold text-slate-500">
        <a href="/help">Help</a>
        <a href="/rules">Rules</a>
        <a href="/responsible-play">Responsible play</a>
        <a href="/about">About</a>
      </div>
      {link && (
        <button onClick={() => userStore.signOut()} className="mt-4 w-full text-xs font-bold text-slate-400">
          Use a different account
        </button>
      )}
      <div id="recaptcha-box" />
    </Shell>
  );
}

function ProfileSetup() {
  const s = useUserStore();
  const [name, setName] = useState('');
  const [dob, setDob] = useState({ m: '', d: '', y: '' });
  const [gender, setGender] = useState<'male' | 'female' | 'neutral'>('neutral');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const years = Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - 13 - i);

  const pick = (g: typeof gender) => {
    setGender(g);
    userStore.setAvatar(getStarterAvatar(g));
  };
  const submit = async () => {
    setErr(null);
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return setErr('Use 3–16 letters, numbers or _.');
    if (!dob.m || !dob.d || !dob.y) return setErr('Enter your date of birth.');
    setBusy(true);
    try {
      await userStore.completeProfile(name, `${dob.y}-${dob.m.padStart(2, '0')}-${dob.d.padStart(2, '0')}`);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const sel = 'h-12 rounded-xl bg-white/5 border border-white/10 text-white font-bold px-3 outline-none focus:border-cyan-400';
  return (
    <Shell>
      <div className="text-center mb-5">
        <h1 className="text-2xl text-white" style={DISPLAY}>
          Create your player
        </h1>
        <p className="text-sm text-slate-400 mt-1">You can change your look any time in the Wardrobe.</p>
      </div>
      <div className="flex justify-center gap-3 mb-5">
        {(['male', 'neutral', 'female'] as const).map((g) => (
          <button key={g} onClick={() => pick(g)} className={`rounded-2xl p-1 border-2 ${gender === g ? 'border-amber-400 bg-amber-400/10' : 'border-white/10'}`} aria-label={`Starter look ${g}`}>
            <AvatarView avatar={getStarterAvatar(g)} size={72} />
          </button>
        ))}
      </div>
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2" htmlFor="uname">
        Player name
      </label>
      <input id="uname" data-testid="username-input" value={name} onChange={(e) => setName(e.target.value.replace(/[^\w]/g, '').slice(0, 16))} placeholder="SwishKing" className="w-full h-12 rounded-xl bg-white/5 border border-white/10 focus:border-cyan-400 outline-none px-4 text-white font-bold" />
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mt-4 mb-2">Date of birth</label>
      <div className="grid grid-cols-[1.3fr_1fr_1.2fr] gap-2">
        <select aria-label="Month" data-testid="dob-month" className={sel} value={dob.m} onChange={(e) => setDob({ ...dob, m: e.target.value })}>
          <option value="">Month</option>
          {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => (
            <option key={m} value={String(i + 1)}>
              {m}
            </option>
          ))}
        </select>
        <select aria-label="Day" data-testid="dob-day" className={sel} value={dob.d} onChange={(e) => setDob({ ...dob, d: e.target.value })}>
          <option value="">Day</option>
          {Array.from({ length: 31 }, (_, i) => (
            <option key={i} value={String(i + 1)}>
              {i + 1}
            </option>
          ))}
        </select>
        <select aria-label="Year" data-testid="dob-year" className={sel} value={dob.y} onChange={(e) => setDob({ ...dob, y: e.target.value })}>
          <option value="">Year</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>
      </div>
      <p className="text-[11px] text-slate-500 mt-2">Used to confirm your age. Cash games require 18+ and a matching ID. It can’t be changed later.</p>
      {err && <p className="mt-3 text-sm text-rose-300" role="alert">{err}</p>}
      <button onClick={submit} disabled={busy} className="mt-5 w-full h-14 rounded-2xl bg-amber-400 text-black font-black text-lg disabled:opacity-50 flex items-center justify-center gap-2" data-testid="create-player">
        {busy && <Loader2 className="w-5 h-5 animate-spin" />} Start playing
      </button>
      <p className="text-center text-xs text-emerald-300 font-bold mt-3">+850 welcome coins</p>
      <button onClick={() => userStore.signOut()} className="mt-4 w-full text-xs font-bold text-slate-400">
        Sign out ({s.session?.phone ?? ''})
      </button>
    </Shell>
  );
}

/** Shows sign-in / setup screens until the player is ready, then the app. */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const s = useUserStore();
  useEffect(() => userStore.start(), []);

  if (s.phase === 'ready') return <>{children}</>;
  if (s.phase === 'signed_out') return <PhoneFlow link={false} />;
  if (s.phase === 'needs_phone') return <PhoneFlow link />;
  if (s.phase === 'needs_profile') return <ProfileSetup />;
  if (s.phase === 'unconfigured' || s.phase === 'error') {
    const voip = s.error === 'voip_not_allowed' || s.error === 'phone_in_use';
    return (
      <Shell>
        <Logo />
        <div className="rounded-2xl bg-white/5 border border-white/10 p-5 text-center" data-testid="auth-error">
          <p className="text-white font-bold">{s.phase === 'unconfigured' ? 'Sign-in isn’t set up yet.' : errorText(s.error)}</p>
          <p className="text-xs text-slate-400 mt-2">{s.phase === 'unconfigured' ? 'The app’s Firebase keys haven’t been added.' : voip ? 'Sign out and use a different mobile number.' : 'Check your connection and try again.'}</p>
          {s.phase === 'error' && (
            <div className="flex gap-2 justify-center mt-4">
              {!voip && (
                <button onClick={() => userStore.refresh()} className="h-11 px-5 rounded-full bg-cyan-400 text-black font-black">
                  Try again
                </button>
              )}
              <button onClick={() => userStore.signOut()} className="h-11 px-5 rounded-full bg-white/10 text-white font-bold">
                Sign out
              </button>
            </div>
          )}
        </div>
      </Shell>
    );
  }
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-[#090b16]" data-testid="auth-loading">
      <Loader2 className="w-8 h-8 text-cyan-300 animate-spin" />
    </div>
  );
}
