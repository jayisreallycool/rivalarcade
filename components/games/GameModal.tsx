'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { userStore, useUserStore, errorText, ApiError, usd, type ServerMatch } from '@/lib/user-store';
import { ARENA_SIZE, GAME_NAMES, GameId, GameProps, MatchExtras, MatchMode, RunStats, arenaPrizes, duelPrize } from '@/lib/game-types';
import { seedCode } from '@/lib/rng';
import { enableSafeMode, gpuInfo, isSafeMode } from '@/lib/engine/quality';
import { ENGINE_FAILURE_EVENT, type EngineFailureDetail } from '@/lib/engine/GameEngine';
import { isIOS, enterGameFullscreen, exitGameFullscreen } from '@/lib/fullscreen';
import { TEST_AUTH } from '@/lib/client/auth';
import { MatchExtrasContext } from './GameShell';
import ResultScreen from './ResultScreen';
import { X, Swords, Users, Trophy, Loader2 } from 'lucide-react';

/**
 * Catches anything that blows up while loading or running a game (a stale code chunk after a
 * new deploy, a GPU error thrown during render…) so the player gets a retry, not a blank page.
 */
class GameErrorBoundary extends React.Component<{ onRetry: () => void; onClose: () => void; children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.warn('[RivalArcade] game crashed', error);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = /ChunkLoadError|Loading chunk|dynamically imported module|Failed to fetch/i.test(`${error.name} ${error.message}`);
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center bg-[#070810]" data-testid="game-error">
        <h3 className="text-lg font-black text-white">{stale ? 'A new version is available' : 'This game hit a snag'}</h3>
        <p className="text-xs text-slate-400 max-w-xs">{stale ? 'Reload to get the latest update, then jump back in.' : 'Tap Try again to reload the 3D arena. Your match stays open.'}</p>
        <div className="flex flex-wrap justify-center gap-2 mt-2">
          {stale ? (
            <button onClick={() => window.location.reload()} className="h-11 px-5 rounded-full bg-cyan-400 text-black font-black">
              Reload
            </button>
          ) : (
            <button
              onClick={() => {
                this.setState({ error: null });
                this.props.onRetry();
              }}
              className="h-11 px-5 rounded-full bg-cyan-400 text-black font-black"
            >
              Try again
            </button>
          )}
          <button onClick={this.props.onClose} className="h-11 px-5 rounded-full bg-white/5 text-white/70 font-bold">
            Back
          </button>
        </div>
      </div>
    );
  }
}

function GameLoading() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[#070810] text-slate-400">
      <div className="w-10 h-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
      <span className="text-[11px] font-bold uppercase tracking-widest">Loading arena…</span>
    </div>
  );
}

// Every game is full 3D; each (and three.js) is code-split so it only downloads when a match opens.
const GAMES_3D: Record<GameId, React.ComponentType<GameProps>> = {
  'neon-dash': dynamic(() => import('./NeonDash3DGame'), { ssr: false, loading: GameLoading }),
  'dunk-rush': dynamic(() => import('./DunkRush3DGame'), { ssr: false, loading: GameLoading }),
  'cyber-reflex': dynamic(() => import('./CyberReflex3DGame'), { ssr: false, loading: GameLoading }),
  'gem-surge': dynamic(() => import('./GemSurge3DGame'), { ssr: false, loading: GameLoading }),
  'brick-blitz': dynamic(() => import('./BrickBlitz3DGame'), { ssr: false, loading: GameLoading }),
  'canopy-swing': dynamic(() => import('./CanopySwing3DGame'), { ssr: false, loading: GameLoading }),
};

export interface GameModalProps {
  gameId: GameId;
  /** practice = solo & free · duel = async 1v1 · arena = 5 players · tournament = a cup. */
  mode: MatchMode;
  entry?: number;
  currency?: 'coins' | 'usd';
  /** Cup to play, or an already-joined contest to play now. */
  contestId?: string;
  onClose: () => void;
}

export interface PracticeResult {
  score: number;
  coins: number;
  xp: number;
  flagged: string | null;
  breakdown?: RunStats['breakdown'];
}

type Phase = { k: 'entering' } | { k: 'error'; msg: string } | { k: 'play'; runToken: string; seed: number; contestId: string | null } | { k: 'submitting'; score: number } | { k: 'done' };

const kindOf = (mode: MatchMode) => (mode === 'duel' ? 'h2h' : mode === 'arena' ? 'arena' : 'cup');

/** Runs one match against the game server: enter → play (server-timed, secret seed) → submit → results. */
export default function GameModal({ gameId, mode, entry = 0, currency = 'coins', contestId: givenContest, onClose }: GameModalProps) {
  const userState = useUserStore();
  const [phase, setPhase] = useState<Phase>({ k: 'entering' });
  const [runKey, setRunKey] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [practice, setPractice] = useState<PracticeResult | null>(null);
  const [contestResult, setContestResult] = useState<{ contestId: string; score: number; flagged: string | null; breakdown?: RunStats['breakdown'] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [no3D, setNo3D] = useState(false);
  const [diag, setDiag] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const failures = useRef(0);
  const inAppBrowser = typeof navigator !== 'undefined' && /Instagram|FBAN|FBAV|TikTok|musical_ly|Bytedance|Snapchat|Line\//i.test(navigator.userAgent);
  const isPractice = mode === 'practice';

  // Enter the match on the server (charges the entry, returns the secret seed).
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        if (isPractice) {
          const r = await userStore.call<{ runToken: string; seed: number }>('startPractice', { gameId });
          if (!dead) setPhase({ k: 'play', runToken: r.runToken, seed: r.seed, contestId: null });
          return;
        }
        let cid = givenContest ?? null;
        if (mode === 'tournament' && cid) {
          await userStore.call('joinCup', { contestId: cid }).catch((e) => {
            if (!(e instanceof ApiError && e.code === 'already_joined')) throw e;
          });
        } else if (!cid) {
          cid = (await userStore.call<{ contestId: string }>('joinContest', { kind: kindOf(mode), gameId, currency, entry })).contestId;
        }
        void userStore.refresh();
        const r = await userStore.call<{ runToken: string; seed: number }>('startContestRun', { contestId: cid });
        if (!dead) setPhase({ k: 'play', runToken: r.runToken, seed: r.seed, contestId: cid });
      } catch (e) {
        if (!dead) setPhase({ k: 'error', msg: errorText(e) });
      }
    })();
    return () => {
      dead = true;
    };
  }, [attempt, gameId, mode, entry, currency, givenContest, isPractice]);

  // GPU trouble: rebuild the 3D arena with the compatibility renderer and try again (same run).
  useEffect(() => {
    const onFail = (e: Event) => {
      const d = (e as CustomEvent<EngineFailureDetail>).detail;
      const gpu = gpuInfo();
      setDiag(`${d?.reason ?? 'unknown'} · ${gpu.renderer} · webgl2 ${gpu.webgl2 ? 'yes' : 'no'}${gpu.webgl2 ? '' : ` · webgl1 ${gpu.webgl1 ? 'yes' : 'no'}`}${isSafeMode() ? ' · safe' : ''}${d?.message ? ` · ${d.message}` : ''}`);
      failures.current += 1;
      enableSafeMode();
      if (failures.current <= 3) {
        setNotice('Optimizing 3D graphics for this device…');
        setRunKey((k) => k + 1);
      } else {
        setNo3D(!gpu.webgl2);
        setFailed(true);
      }
    };
    window.addEventListener(ENGINE_FAILURE_EVENT, onFail);
    return () => window.removeEventListener(ENGINE_FAILURE_EVENT, onFail);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    enterGameFullscreen();
    return () => exitGameFullscreen();
  }, []);

  const playing = phase.k === 'play';
  const leave = useCallback(() => {
    if (playing && !isPractice) return setConfirmLeave(true);
    onClose();
  }, [playing, isPractice, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && phase.k !== 'done' && leave();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [leave, phase.k]);

  const submit = useCallback(
    async (score: number, stats: RunStats = {}) => {
      if (phase.k !== 'play') return;
      const { runToken, contestId } = phase;
      setPhase({ k: 'submitting', score });
      const { breakdown, ...numbers } = stats;
      for (let i = 0; i < 4; i++) {
        try {
          if (!contestId) {
            const r = await userStore.call<{ score: number; coins: number; xp: number; flagged: string | null }>('submitPractice', { runToken, score, stats: numbers });
            setPractice({ ...r, breakdown });
          } else {
            const r = await userStore.call<{ score: number; flagged: string | null }>('submitContestScore', { runToken, score, stats: numbers });
            setContestResult({ contestId, score: r.score, flagged: r.flagged, breakdown });
          }
          setPhase({ k: 'done' });
          void userStore.refresh();
          return;
        } catch (e) {
          if (e instanceof ApiError && e.code !== 'network' && e.status < 500) {
            setPhase({ k: 'error', msg: errorText(e) });
            return;
          }
          await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        }
      }
      setPhase({ k: 'error', msg: 'Couldn’t reach the server to submit your score. Your match stays open — check History in a moment.' });
    },
    [phase],
  );

  const playAgain = () => {
    setPractice(null);
    setContestResult(null);
    failures.current = 0;
    setPhase({ k: 'entering' });
    setRunKey((k) => k + 1);
    setAttempt((a) => a + 1);
  };

  const entryLabel = entry ? (currency === 'usd' ? usd(entry) : `${entry} coins`) : 'Free';
  const prize = (n: number) => (currency === 'usd' ? usd(n) : `${n}`);
  const modeLabel = mode === 'practice' ? 'Practice' : mode === 'duel' ? `1v1 · ${entryLabel}` : mode === 'arena' ? `Live Arena · ${entryLabel}` : 'Cup';
  const extras: MatchExtras = useMemo(() => {
    const e: MatchExtras = { mode, entry: currency === 'usd' ? 0 : entry };
    if (mode === 'duel') e.stakeLine = `${entry ? `Entry ${entryLabel} · ` : ''}Winner takes ${prize(duelPrize(entry))}`;
    if (mode === 'arena') {
      const p = arenaPrizes(entry);
      e.stakeLine = `${entry ? `Entry ${entryLabel} · ` : ''}1st ${prize(p[0])} · 2nd ${prize(p[1])} · 3rd ${prize(p[2])}`;
    }
    if (mode === 'practice') e.stakeLine = 'Solo practice · earn coins & XP';
    if (mode === 'tournament') e.stakeLine = 'One run counts · best score wins the cup';
    return e;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, entry, currency]);

  const Game3D = GAMES_3D[gameId];
  const closeBtn = (
    <button onClick={leave} aria-label="Close match" className="absolute top-[max(env(safe-area-inset-top),10px)] left-3 z-50 w-10 h-10 rounded-full bg-black/50 border border-white/10 flex items-center justify-center text-white/80">
      <X className="w-5 h-5" />
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black h-[100dvh] w-screen overflow-hidden overscroll-none" data-testid="game-modal" data-phase={phase.k}>
      {phase.k === 'entering' || phase.k === 'submitting' ? (
        <div className="relative h-full flex flex-col items-center justify-center px-6 text-center bg-[radial-gradient(ellipse_at_center,#12203a_0%,#05060b_70%)]" data-testid="matchmaking">
          {phase.k === 'entering' && closeBtn}
          <div className="relative w-32 h-32 flex items-center justify-center mb-6">
            <div className="absolute inset-0 rounded-full border-2 border-cyan-500/40 animate-ping" />
            <div className="w-20 h-20 rounded-full bg-[#161826] flex items-center justify-center border border-cyan-500/60">
              {phase.k === 'submitting' ? <Loader2 className="w-8 h-8 text-cyan-300 animate-spin" /> : mode === 'arena' ? <Users className="w-8 h-8 text-pink-400" /> : mode === 'tournament' ? <Trophy className="w-8 h-8 text-amber-400" /> : <Swords className="w-8 h-8 text-cyan-400" />}
            </div>
          </div>
          <h3 className="text-xl font-black text-white mb-1">{phase.k === 'submitting' ? 'SUBMITTING YOUR SCORE' : isPractice ? 'SETTING UP PRACTICE' : 'ENTERING MATCH'}</h3>
          <p className="text-xs text-slate-400 max-w-xs">
            {phase.k === 'submitting'
              ? 'Verifying your run with the server…'
              : isPractice
                ? 'Solo, free, no opponent.'
                : mode === 'arena'
                  ? `Up to ${ARENA_SIZE} real players, same seed. Play now — results land when everyone has played.`
                  : mode === 'tournament'
                    ? 'Everyone in the cup plays the same seed.'
                    : 'You’ll play now; your rival plays the same seed. Results land when they finish.'}
          </p>
          {!isPractice && entry > 0 && <p className="mt-3 text-xs font-black text-amber-300">{entryLabel} entry</p>}
        </div>
      ) : phase.k === 'error' ? (
        <div className="relative h-full flex flex-col items-center justify-center px-6 text-center bg-[#070810]" data-testid="match-error">
          {closeBtn}
          <h3 className="text-lg font-black text-white mb-2">Couldn’t start this match</h3>
          <p className="text-sm text-slate-300 max-w-xs mb-6">{phase.msg}</p>
          <button onClick={onClose} className="h-11 px-6 rounded-full bg-cyan-400 text-black font-black">
            Back
          </button>
        </div>
      ) : phase.k === 'done' ? (
        <ResultScreen
          gameName={GAME_NAMES[gameId]}
          mode={mode}
          practice={practice}
          contest={contestResult}
          avatar={userState.avatar}
          username={userState.username}
          best={userState.stats.highScores[gameId] ?? 0}
          onAgain={mode === 'tournament' ? onClose : playAgain}
          onClose={onClose}
        />
      ) : no3D || failed ? (
        <div className="relative h-full flex flex-col items-center justify-center gap-3 px-6 text-center bg-[#070810]" data-testid="no-3d">
          {closeBtn}
          <h3 className="text-lg font-black text-white">{no3D ? 'This browser blocked 3D graphics' : '3D graphics stopped responding'}</h3>
          <p className="text-xs text-slate-400 max-w-xs">
            {no3D
              ? inAppBrowser
                ? 'In-app browsers (TikTok, Instagram, Facebook…) often block 3D. Tap ••• and choose “Open in browser”, then play in Safari or Chrome.'
                : isIOS()
                  ? 'Update iOS to 15 or later. If you’re up to date, check Settings → Apps → Safari → Advanced → Feature Flags and make sure WebGL 2.0 is on.'
                  : 'Update Chrome, then open chrome://flags and make sure WebGL is not disabled. Turning on “Use graphics acceleration” in Chrome settings also helps.'
              : 'Close other apps or tabs to free up graphics memory, then try again.'}
          </p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => {
                failures.current = 0;
                setNo3D(false);
                setFailed(false);
                setRunKey((k) => k + 1);
              }}
              className="h-11 px-5 rounded-full bg-cyan-400 text-black font-black"
            >
              Try again
            </button>
            <button onClick={leave} className="h-11 px-5 rounded-full bg-white/10 text-white font-bold">
              Back
            </button>
          </div>
          {diag && (
            <p className="mt-3 max-w-xs break-words font-mono text-[10px] text-slate-600" data-testid="gpu-diag">
              {diag}
            </p>
          )}
        </div>
      ) : (
        <GameErrorBoundary key={`b${runKey}`} onRetry={() => setRunKey((k) => k + 1)} onClose={leave}>
          <MatchExtrasContext.Provider value={extras}>
            <Game3D
              key={runKey}
              avatar={userState.avatar}
              onFinish={submit}
              modeName={modeLabel}
              seed={phase.seed}
              rival={null}
              match={{ modeLabel, seedCode: isPractice ? undefined : seedCode(phase.seed), playerName: userState.username, playerRating: mode === 'duel' ? userState.stats.rating : undefined, rivalName: isPractice ? undefined : mode === 'duel' ? 'Mystery rival' : 'Live field' }}
              onExit={leave}
            />
          </MatchExtrasContext.Provider>
        </GameErrorBoundary>
      )}

      {TEST_AUTH && playing && (
        <button data-testid="test-finish" onClick={() => submit(Number(localStorage.getItem('ra_test_score') ?? '10'), { baskets: 3 })} className="absolute bottom-2 right-2 z-[70] text-[10px] text-white/30">
          test-finish
        </button>
      )}

      {confirmLeave && (
        <div className="absolute inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center px-6" data-testid="confirm-leave">
          <div className="w-full max-w-xs rounded-2xl bg-[#121423] border border-white/10 p-5 text-center">
            <h3 className="text-white font-black text-lg">Leave this match?</h3>
            <p className="text-xs text-slate-400 mt-2">You get one run per match. If you leave now, your run ends and scores 0.</p>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setConfirmLeave(false)} className="flex-1 h-11 rounded-full bg-cyan-400 text-black font-black">
                Keep playing
              </button>
              <button
                onClick={() => {
                  setConfirmLeave(false);
                  void submit(0, {});
                }}
                className="flex-1 h-11 rounded-full bg-white/10 text-white font-bold"
              >
                Forfeit
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && !failed && (
        <div className="absolute top-[calc(env(safe-area-inset-top)+64px)] inset-x-0 z-[60] flex justify-center pointer-events-none" data-testid="compat-notice">
          <span className="px-4 py-2 rounded-full bg-black/75 backdrop-blur text-xs font-bold text-cyan-200">{notice}</span>
        </div>
      )}
    </div>
  );
}

export type { ServerMatch };
