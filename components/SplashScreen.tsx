'use client';

import { useEffect } from 'react';

/**
 * Launch splash. The markup (SplashMarkup) is server-rendered into the page so it shows the
 * instant the app opens — before any JavaScript runs. SplashGate removes it once the app has
 * hydrated and the display font is ready (with a short minimum so it never just flickers).
 * It never takes taps (pointer-events: none), so it can't block the app.
 */

const TIPS = [
  'Every basket, gem, brick and vine is worth 1 point.',
  'Gold items are worth 3 — jackpots are worth 5.',
  '5 in a row sets you ON FIRE: points ×2.',
  'The last 10 seconds are CLUTCH time: points ×2.',
  'Same seed for everyone — pure skill decides it.',
];

export function SplashMarkup() {
  const tip = TIPS.slice(0, 3).join(' · ');
  return (
    <div id="ra-splash" className="ra-splash" aria-hidden suppressHydrationWarning>
      <div className="ra-splash-glow" />
      <svg viewBox="0 0 512 512" className="ra-splash-logo" aria-hidden>
        <defs>
          <linearGradient id="spl-c" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fde68a" />
            <stop offset="1" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <path d="M96 196 L176 268 L256 120 L336 268 L416 196 L388 368 H124 Z" fill="url(#spl-c)" stroke="#92400e" strokeWidth="14" strokeLinejoin="round" />
        <rect x="124" y="356" width="264" height="44" rx="14" fill="#f59e0b" stroke="#92400e" strokeWidth="14" />
        <circle cx="256" cy="120" r="22" fill="#fef3c7" />
        <circle cx="96" cy="196" r="18" fill="#fef3c7" />
        <circle cx="416" cy="196" r="18" fill="#fef3c7" />
      </svg>
      <div className="ra-splash-word">
        <span>RIVAL</span>
        <span className="ra-splash-word2">ARCADE</span>
      </div>
      <div className="ra-splash-loading">
        <span className="ra-splash-label">LOADING</span>
        <span className="ra-splash-dots">
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="ra-splash-bar">
        <span />
      </div>
      <p className="ra-splash-tip">{tip}</p>
    </div>
  );
}

export function SplashGate() {
  useEffect(() => {
    const el = document.getElementById('ra-splash');
    if (!el) return;
    let gone = false;
    const MIN_MS = 900;
    const wait = Math.max(0, MIN_MS - performance.now());
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
    const timeout = new Promise((r) => setTimeout(r, 2500)); // never wait on fonts forever
    const t = setTimeout(() => {
      void Promise.race([fonts, timeout]).then(() => {
        if (gone) return;
        el.classList.add('ra-splash-done');
        // Hidden, not removed: React owns this node.
        setTimeout(() => (el.style.display = 'none'), 450);
      });
    }, wait);
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, []);
  return null;
}
