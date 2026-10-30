'use client';

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { MatchInfo, RivalInfo } from '@/lib/game-types';
import { sound, useMuted } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
import { useLatest } from '@/lib/engine/react';
import AvatarView from '@/components/avatar/AvatarView';
import { X, Volume2, VolumeX, Play, Zap } from 'lucide-react';

/* ------------------------------------------------------------------ score popups */

export interface PopupApi {
  /** Floating "+150" style text at a screen position (CSS px within the game surface). */
  pop: (text: string, x: number, y: number, opts?: { color?: string; size?: 'sm' | 'md' | 'lg' }) => void;
  /** Big centred banner ("SWISH!", "ON FIRE", "CLUTCH TIME"). */
  banner: (text: string, color?: string) => void;
}

/** Imperative DOM layer: popups never trigger React renders, so they're free at 60fps. */
const PopupLayer = forwardRef<PopupApi>(function PopupLayer(_, ref) {
  const layer = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(ref, () => ({
    pop(text, x, y, opts = {}) {
      const el = document.createElement('div');
      const size = opts.size === 'lg' ? '30px' : opts.size === 'sm' ? '15px' : '21px';
      el.textContent = text;
      el.className = 'ra-pop';
      el.style.cssText = `left:${x}px;top:${y}px;color:${opts.color ?? '#fff'};font-size:${size}`;
      layer.current?.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    },
    banner(text, color = '#fff') {
      const el = document.createElement('div');
      el.textContent = text;
      el.className = 'ra-banner';
      el.style.color = color;
      layer.current?.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    },
  }));
  return <div ref={layer} className="absolute inset-0 pointer-events-none z-20 overflow-hidden" aria-hidden />;
});

/* ------------------------------------------------------------------ swipe gestures */

export interface Swipe {
  dx: number;
  dy: number;
  /** Pixels per millisecond. */
  speed: number;
  durationMs: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

/**
 * Pointer-based gesture recognizer (works for touch, mouse and pen).
 * Fires `onSwipe` as soon as the finger has travelled far enough — no need to lift — so lane
 * changes feel instant; `onTap` fires on short presses; `onDrag` streams live movement.
 */
export function useSwipe(handlers: {
  onSwipe?: (s: Swipe) => void;
  onTap?: (x: number, y: number) => void;
  onDrag?: (s: Swipe, phase: 'start' | 'move' | 'end') => void;
  /** Fire swipes mid-gesture once this many px are covered (runner lanes). 0 = on release only. */
  earlyThreshold?: number;
}) {
  const h = useLatest(handlers);
  const start = useRef<{ x: number; y: number; t: number; id: number; fired: boolean; rx: number; ry: number } | null>(null);

  const rel = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const build = (e: React.PointerEvent): Swipe => {
    const s = start.current!;
    const p = rel(e);
    const durationMs = Math.max(1, performance.now() - s.t);
    const dx = p.x - s.rx;
    const dy = p.y - s.ry;
    return { dx, dy, speed: Math.hypot(dx, dy) / durationMs, durationMs, startX: s.rx, startY: s.ry, endX: p.x, endY: p.y };
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (start.current) return; // first finger only
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      const p = rel(e);
      start.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, fired: false, rx: p.x, ry: p.y };
      h.current.onDrag?.(build(e), 'start');
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const sw = build(e);
      h.current.onDrag?.(sw, 'move');
      const th = h.current.earlyThreshold ?? 0;
      if (th > 0 && !s.fired && Math.hypot(sw.dx, sw.dy) >= th) {
        s.fired = true;
        h.current.onSwipe?.(sw);
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const sw = build(e);
      start.current = null;
      h.current.onDrag?.(sw, 'end');
      if (s.fired) return;
      if (Math.hypot(sw.dx, sw.dy) < 14 && sw.durationMs < 350) h.current.onTap?.(sw.endX, sw.endY);
      else if (Math.hypot(sw.dx, sw.dy) >= 24) h.current.onSwipe?.(sw);
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}

/* ------------------------------------------------------------------ shell */

export type ShellPhase = 'ready' | 'playing' | 'over';

interface GameShellProps {
  title: string;
  accent: string;
  hostRef: React.Ref<HTMLDivElement>;
  popupsRef: React.Ref<PopupApi>;
  phase: ShellPhase;
  /** Called when the 3-2-1 countdown hits GO. */
  onStart: () => void;
  score: number;
  timeLeft?: number;
  roundSeconds?: number;
  /** Small chips under the score (combo, streak, level). */
  chips?: React.ReactNode;
  clutch?: boolean;
  rival?: RivalInfo | null;
  match?: MatchInfo;
  onExit?: () => void;
  tutorial: { icon: React.ReactNode; label: string }[];
  scoring: string;
  /** Pointer handlers for the play surface (from useSwipe). */
  surface: React.HTMLAttributes<HTMLDivElement>;
  /** Hint shown at the bottom for the first seconds of play. */
  hint?: string;
  children?: React.ReactNode;
}

export default function GameShell(props: GameShellProps) {
  const { title, accent, hostRef, popupsRef, phase, onStart, score, timeLeft, roundSeconds, chips, clutch, rival, match, onExit, tutorial, scoring, surface, hint, children } = props;
  const [count, setCount] = useState<number | 'GO' | null>(null);
  const [showHint, setShowHint] = useState(false);
  const muted = useMuted();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Leave browser fullscreen when the game closes.
  useEffect(
    () => () => {
      try {
        if (document.fullscreenElement) void document.exitFullscreen();
      } catch {
        /* not supported */
      }
    },
    [],
  );

  const begin = useCallback(() => {
    // True fullscreen on phones that allow it (Android); iOS keeps the in-page full-screen layout.
    try {
      if (window.matchMedia('(pointer: coarse)').matches && !document.fullscreenElement) {
        void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
      }
    } catch {
      /* not supported */
    }
    const steps: (number | 'GO')[] = [3, 2, 1, 'GO'];
    steps.forEach((v, i) => {
      timers.current.push(
        setTimeout(() => {
          setCount(v);
          if (v === 'GO') {
            sound.playPowerup();
            haptic('go');
            onStart();
            setShowHint(true);
            timers.current.push(setTimeout(() => setCount(null), 550));
            timers.current.push(setTimeout(() => setShowHint(false), 4500));
          } else {
            sound.playScore(0.7);
            haptic('countdown');
          }
        }, i * 650),
      );
    });
  }, [onStart]);

  const rivalNow = rival && roundSeconds && timeLeft !== undefined && phase !== 'ready' ? Math.round(rival.score * Math.min(1, 1 - timeLeft / roundSeconds)) : rival?.score ?? 0;
  const lowTime = timeLeft !== undefined && timeLeft <= 10 && phase === 'playing';

  return (
    <div
      className="relative w-full h-full overflow-hidden bg-black select-none touch-none overscroll-none"
      style={{ ['--accent' as string]: accent, WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
      data-testid="game-shell"
    >
      {/* Play surface */}
      <div {...surface} className="absolute inset-0 touch-none" data-testid="game-surface">
        <div ref={hostRef} className="absolute inset-0" />
      </div>

      <PopupLayer ref={popupsRef} />

      {/* HUD */}
      <div className="absolute top-0 inset-x-0 z-50 pointer-events-none px-3 pt-[max(env(safe-area-inset-top),10px)]">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 pointer-events-auto">
            {onExit && (
              <button onClick={onExit} aria-label="Close match" className="w-10 h-10 rounded-full bg-black/50 backdrop-blur border border-white/10 flex items-center justify-center text-white/80 active:scale-90">
                <X className="w-5 h-5" />
              </button>
            )}
            <button onClick={() => sound.toggleMute()} aria-label={muted ? 'Unmute' : 'Mute'} className="w-10 h-10 rounded-full bg-black/50 backdrop-blur border border-white/10 flex items-center justify-center text-white/80 active:scale-90">
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex flex-col items-center -mt-0.5">
            <span className="text-[10px] font-black tracking-[0.2em] text-white/60">{title}</span>
            <span className="text-4xl font-black text-white tabular-nums leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]" data-testid="hud-score">
              {score.toLocaleString()}
            </span>
            {chips && <div className="flex items-center gap-1.5 mt-1">{chips}</div>}
          </div>

          <div className="flex flex-col items-end gap-1 min-w-[84px]">
            {timeLeft !== undefined && (
              <div
                className={`px-3 h-10 rounded-full backdrop-blur border flex items-center font-black tabular-nums text-lg ${
                  lowTime ? 'bg-rose-600/80 border-rose-300/60 text-white animate-pulse' : 'bg-black/50 border-white/10 text-white'
                }`}
                data-testid="hud-time"
              >
                {Math.max(0, Math.ceil(timeLeft))}s
              </div>
            )}
            {clutch && phase === 'playing' && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400 text-black text-[10px] font-black animate-pulse">
                <Zap className="w-3 h-3 fill-black" /> CLUTCH ×2
              </span>
            )}
          </div>
        </div>

        {rival && (
          <div className="mt-2 mx-auto max-w-md flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/45 backdrop-blur border border-white/10 text-[11px] font-bold" data-testid="rival-bar">
            <span className={score > rivalNow ? 'text-emerald-300' : 'text-white/80'}>YOU</span>
            <div className="relative flex-1 h-1.5 rounded-full bg-white/15 overflow-hidden">
              <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-200" style={{ width: `${(score / Math.max(1, score, rivalNow, roundSeconds ? 0 : rival.score)) * 100}%`, background: 'var(--accent)' }} />
              <div className="absolute inset-y-0 w-1 bg-rose-400 shadow-[0_0_6px_#fb7185]" style={{ left: `calc(${(rivalNow / Math.max(1, score, rivalNow, roundSeconds ? 0 : rival.score)) * 100}% - 2px)` }} />
            </div>
            <span className="text-rose-300 tabular-nums">{rivalNow.toLocaleString()}</span>
            <span className="text-white/50 truncate max-w-[90px]">
              {rival.label ?? ''} {rival.name}
            </span>
          </div>
        )}
      </div>

      {children}

      {/* First-seconds control hint */}
      {hint && showHint && phase === 'playing' && (
        <div className="absolute bottom-[max(env(safe-area-inset-bottom),18px)] inset-x-0 z-20 flex justify-center pointer-events-none">
          <span className="px-4 py-2 rounded-full bg-black/55 backdrop-blur text-white/90 text-sm font-bold animate-pulse">{hint}</span>
        </div>
      )}

      {/* Countdown */}
      {count !== null && (
        <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none" data-testid="countdown">
          <span key={String(count)} className="ra-count text-9xl font-black italic text-white" style={{ WebkitTextStroke: `3px ${accent}`, textShadow: `0 0 30px ${accent}, 0 6px 0 rgba(0,0,0,0.6)` }}>
            {count}
          </span>
        </div>
      )}

      {/* Ready / VS card */}
      {phase === 'ready' && count === null && (
        <div className="absolute inset-0 z-40 flex items-end sm:items-center justify-center bg-gradient-to-t from-black via-black/70 to-black/20 p-4 pb-[max(env(safe-area-inset-bottom),20px)]">
          <div className="w-full max-w-sm rounded-3xl bg-[#0e1018]/90 backdrop-blur border border-white/10 p-5 shadow-2xl">
            <div className="text-center mb-4">
              <div className="text-[10px] font-black tracking-[0.25em] text-white/50">{match?.modeLabel?.toUpperCase() ?? 'PRACTICE'}</div>
              <h2 className="text-3xl font-black italic tracking-tight" style={{ color: accent }}>
                {title}
              </h2>
              {match?.seedCode && <div className="text-[10px] font-mono text-white/40 mt-0.5">SEED {match.seedCode} · same for every player</div>}
            </div>

            {rival && (
              <div className="flex items-center justify-between rounded-2xl bg-black/40 border border-white/10 px-3 py-2.5 mb-4" data-testid="vs-card">
                <div className="flex flex-col items-center w-24 min-w-0">
                  <span className="text-xs font-bold text-cyan-300 truncate max-w-full">{match?.playerName ?? 'You'}</span>
                  {match?.playerRating && <span className="text-[10px] text-white/40 font-mono">{match.playerRating}</span>}
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-lg font-black italic text-white/70">VS</span>
                  <span className="text-[10px] text-white/50">Score to beat</span>
                  <span className="text-base font-black text-rose-300 tabular-nums">{rival.score.toLocaleString()}</span>
                </div>
                <div className="flex flex-col items-center w-24 min-w-0">
                  {match?.rivalAvatar && <AvatarView avatar={match.rivalAvatar} size={40} animate={false} />}
                  <span className="text-xs font-bold text-rose-300 truncate max-w-full">{rival.name}</span>
                  {match?.rivalRating && <span className="text-[10px] text-white/40 font-mono">{match.rivalRating}</span>}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 mb-3">
              {tutorial.map((t, i) => (
                <div key={i} className="flex flex-col items-center gap-1 rounded-xl bg-white/5 border border-white/10 py-2.5 px-1 text-center">
                  <span className="text-white/90" style={{ color: accent }}>
                    {t.icon}
                  </span>
                  <span className="text-[10px] font-bold text-white/70 leading-tight">{t.label}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-white/50 text-center mb-4 leading-snug">{scoring}</p>

            <button
              onClick={begin}
              className="w-full h-14 rounded-2xl text-black font-black text-lg flex items-center justify-center gap-2 active:scale-[0.97] transition-transform shadow-lg"
              style={{ background: accent, boxShadow: `0 8px 30px -8px ${accent}` }}
            >
              <Play className="w-5 h-5 fill-black" /> TAP TO PLAY
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
