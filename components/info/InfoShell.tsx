import Link from 'next/link';
import React from 'react';
import { PAGE_LINKS } from '@/lib/info-pages';

const DISPLAY = { fontFamily: "'Lilita One', system-ui, sans-serif" };

function Crown() {
  return (
    <svg viewBox="0 0 512 512" className="w-7 h-7" aria-hidden>
      <path d="M96 196 L176 268 L256 120 L336 268 L416 196 L388 368 H124 Z" fill="#fbbf24" stroke="#92400e" strokeWidth="18" strokeLinejoin="round" />
      <rect x="124" y="356" width="264" height="44" rx="14" fill="#f59e0b" stroke="#92400e" strokeWidth="18" />
    </svg>
  );
}

/** Shared frame for the public info & legal pages: header, hero, page nav, footer. */
export default function InfoShell({ kicker, title, summary, updated, current, aside, children }: { kicker: string; title: string; summary: string; updated?: string; current: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[#090a12] text-slate-200" data-testid="info-page">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-72 bg-[radial-gradient(50%_90%_at_20%_0%,rgba(56,189,248,0.16),transparent_70%),radial-gradient(50%_90%_at_85%_0%,rgba(250,204,21,0.12),transparent_70%)]" />
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#090a12]/80 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
        <div className="max-w-5xl mx-auto h-14 px-4 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 text-white">
            <Crown />
            <span className="text-xl leading-none" style={DISPLAY}>
              RIVAL<span className="text-amber-400">ARCADE</span>
            </span>
          </Link>
          <Link href="/" className="h-9 px-4 rounded-full bg-amber-400 text-black text-sm font-black flex items-center" data-testid="back-to-app">
            Play
          </Link>
        </div>
        <nav aria-label="Info pages" className="max-w-5xl mx-auto px-4 pb-2 flex gap-1.5 overflow-x-auto no-scrollbar">
          {PAGE_LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={l.href === current ? 'page' : undefined} className={`shrink-0 h-8 px-3 rounded-full text-xs font-bold flex items-center ${l.href === current ? 'bg-white text-black' : 'bg-white/[0.06] text-slate-300 hover:bg-white/10'}`}>
              {l.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="relative max-w-5xl mx-auto px-4 pt-10 pb-16">
        <div className="max-w-3xl">
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-300">{kicker}</div>
          <h1 className="mt-2 text-4xl sm:text-5xl text-white leading-[1.05]" style={DISPLAY}>
            {title}
          </h1>
          <p className="mt-3 text-base sm:text-lg text-slate-400 leading-relaxed">{summary}</p>
          {updated && <p className="mt-3 text-xs font-bold text-slate-500">Last updated {updated}</p>}
        </div>
        <div className={`mt-10 grid gap-10 ${aside ? 'lg:grid-cols-[220px_1fr]' : ''}`}>
          {aside && <aside className="hidden lg:block">{aside}</aside>}
          <div className="min-w-0 max-w-3xl">{children}</div>
        </div>
      </main>

      <footer className="border-t border-white/5 bg-black/20">
        <div className="max-w-5xl mx-auto px-4 py-8 grid gap-6 sm:grid-cols-[1fr_auto] text-sm">
          <div>
            <div className="flex items-center gap-2 text-white">
              <Crown />
              <span style={DISPLAY}>RIVALARCADE</span>
            </div>
            <p className="mt-2 text-xs text-slate-500 max-w-sm">Skill-based contests between real players. Cash contests 18+, void where prohibited. Rival Coins have no cash value. Need help with your play? Call 1-800-GAMBLER.</p>
          </div>
          <ul className="grid grid-cols-2 gap-x-8 gap-y-2 text-slate-400">
            {PAGE_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-white">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-center text-[11px] text-slate-600 pb-6">© {new Date().getFullYear()} RivalArcade</p>
      </footer>
    </div>
  );
}
