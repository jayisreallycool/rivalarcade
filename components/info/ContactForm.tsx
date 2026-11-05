'use client';

import React, { useState } from 'react';

const TOPICS = ['Account & sign-in', 'Match result', 'Deposits & withdrawals', 'Report cheating', 'Privacy or data request', 'Delete my account', 'Something else'];

export default function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', username: '', topic: TOPICS[0], message: '', website: '' });
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return setErr('Enter a valid email so we can reply.');
    if (form.message.trim().length < 10) return setErr('Tell us a little more (at least 10 characters).');
    setState('sending');
    try {
      const r = await fetch('/api/support', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'error');
      setState('sent');
    } catch (x) {
      setState('error');
      setErr(x instanceof Error && x.message === 'rate_limited' ? 'You’ve sent a few messages already — please wait a bit.' : 'Couldn’t send right now. Please try again.');
    }
  };

  if (state === 'sent')
    return (
      <div className="rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-400/30 p-6" role="status" data-testid="contact-sent">
        <div className="text-white font-black text-lg">Message received ✓</div>
        <p className="text-slate-300 mt-1">Thanks — we’ll reply to {form.email}. For deletion or data requests we may ask you to confirm from your signed-in phone.</p>
      </div>
    );

  const field = 'w-full h-12 rounded-xl bg-white/[0.04] ring-1 ring-white/10 focus:ring-cyan-400 outline-none px-4 text-white placeholder:text-slate-600';
  return (
    <form onSubmit={submit} className="rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06] p-5 sm:p-6 space-y-4" data-testid="contact-form" noValidate>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs font-bold text-slate-400">Name</span>
          <input className={`${field} mt-1`} value={form.name} onChange={set('name')} autoComplete="name" maxLength={80} />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-400">Email *</span>
          <input className={`${field} mt-1`} value={form.email} onChange={set('email')} type="email" autoComplete="email" maxLength={120} required data-testid="contact-email" />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-400">Player name (if you have an account)</span>
          <input className={`${field} mt-1`} value={form.username} onChange={set('username')} maxLength={16} />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-400">Topic</span>
          <select className={`${field} mt-1`} value={form.topic} onChange={set('topic')}>
            {TOPICS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-bold text-slate-400">Message *</span>
        <textarea className={`${field} mt-1 h-36 py-3 resize-y`} value={form.message} onChange={set('message')} maxLength={3000} required data-testid="contact-message" />
      </label>
      {/* spam trap: real people never see or fill this */}
      <input tabIndex={-1} autoComplete="off" className="hidden" value={form.website} onChange={set('website')} aria-hidden />
      {err && <p className="text-sm text-rose-300" role="alert">{err}</p>}
      <button disabled={state === 'sending'} className="h-12 px-6 rounded-xl bg-amber-400 text-black font-black disabled:opacity-50" data-testid="contact-send">
        {state === 'sending' ? 'Sending…' : 'Send message'}
      </button>
      <p className="text-xs text-slate-500">Never include card numbers or passwords. If you need help with gambling-related harm, call or text 1-800-GAMBLER any time.</p>
    </form>
  );
}
