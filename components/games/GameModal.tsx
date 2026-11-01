'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AvatarConfig } from '@/lib/avatar-types';
import { userStore, useUserStore } from '@/lib/user-store';
import { getStarterAvatar } from '@/lib/cosmetics-catalog';
import {
  ARENA_SIZE,
  GAME_NAMES,
  GameId,
  GameProps,
  MatchExtras,
  MatchMode,
  MODE_LABEL,
  RivalInfo,
  RunStats,
  STREAK_TARGETS,
  arenaPrizes,
  blitzPayout,
  blitzRate,
  duelPrize,
  streakPrize,
} from '@/lib/game-types';
import { botAvatar, botName, botScore } from '@/lib/bots';
import { mulberry32, randomSeed, seedCode } from '@/lib/rng';
import { standings, tournamentStatus } from '@/lib/tournaments-data';
import { enableSafeMode, isSafeMode, supportsWebGL2 } from '@/lib/engine/quality';
import { ENGINE_FAILURE_EVENT } from '@/lib/engine/GameEngine';
import MatchResultsModal, { ResultData } from './MatchResultsModal';
import { MatchExtrasContext } from './GameShell';
import AvatarView from '@/components/avatar/AvatarView';
import { X, Swords, Users } from 'lucide-react';

/**
 * Catches anything that blows up while loading or running a game (a stale code chunk after a
 * new deploy, a GPU error thrown during render…) so the player gets a retry, not a blank page.
 */
class GameErrorBoundary extends React.Component<{ onCrash: () => void; onRetry: () => void; onLite?: () => void; onClose: () => void; children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.warn('[RivalArcade] game crashed', error);
    this.props.onCrash();
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = /ChunkLoadError|Loading chunk|dynamically imported module|Failed to fetch/i.test(`${error.name} ${error.message}`);
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center bg-[#070810]" data-testid="game-error">
        <h3 className="text-lg font-black text-white">{stale ? 'A new version is available' : 'This game hit a snag'}</h3>
        <p className="text-xs text-slate-400 max-w-xs">{stale ? 'Reload to get the latest update, then jump back in.' : 'Your stake was not lost. Try again, or play the lite edition built for every phone.'}</p>
        <div className="flex flex-wrap justify-center gap-2 mt-2">
          {stale ? (
            <button onClick={() => window.location.reload()} className="h-11 px-5 rounded-full bg-cyan-400 text-black font-black">
              Reload
            </button>
          ) : (
            <>
              <button
                onClick={() => {
                  this.setState({ error: null });
                  this.props.onRetry();
                }}
                className="h-11 px-5 rounded-full bg-cyan-400 text-black font-black"
              >
                Try again
              </button>
              {this.props.onLite && (
                <button
                  onClick={() => {
                    this.setState({ error: null });
                    this.props.onLite?.();
                  }}
                  className="h-11 px-5 rounded-full bg-white/10 text-white font-black"
                >
                  Play lite edition
                </button>
              )}
            </>
          )}
          <button onClick={this.props.onClose} className="h-11 px-5 rounded-full bg-white/5 text-white/70 font-bold">
            Back
          </button>
        </div>
      </div>
    );
  }
}

const force2D = () => {
  try {
    return sessionStorage.getItem('ra.force2d') === '1';
  } catch {
    return false;
  }
};

function GameLoading() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[#070810] text-slate-400">
      <div className="w-10 h-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
      <span className="text-[11px] font-bold uppercase tracking-widest">Loading arena…</span>
    </div>
  );
}

const BrickBlitz = dynamic(() => import('./BrickBlitzGame'), { ssr: false, loading: GameLoading });

// 3D games (and three.js) are code-split so they only download when a match opens.
const GAMES_3D: Record<GameId, React.ComponentType<GameProps>> = {
  'neon-dash': dynamic(() => import('./NeonDash3DGame'), { ssr: false, loading: GameLoading }),
  'dunk-rush': dynamic(() => import('./DunkRush3DGame'), { ssr: false, loading: GameLoading }),
  'cyber-reflex': dynamic(() => import('./CyberReflex3DGame'), { ssr: false, loading: GameLoading }),
  'gem-surge': dynamic(() => import('./GemSurge3DGame'), { ssr: false, loading: GameLoading }),
  'brick-blitz': BrickBlitz,
};

type Game2DProps = { avatar: AvatarConfig; onFinish: (score: number) => void; modeName?: string };
// Canvas 2D versions for devices without WebGL2.
const GAMES_2D: Partial<Record<GameId, React.ComponentType<Game2DProps>>> = {
  'neon-dash': dynamic(() => import('./NeonDashGame'), { ssr: false }),
  'dunk-rush': dynamic(() => import('./DunkRushGame'), { ssr: false }),
  'cyber-reflex': dynamic(() => import('./CyberReflexGame'), { ssr: false }),
  'gem-surge': dynamic(() => import('./GemSurgeGame'), { ssr: false }),
};

interface GameModalProps {
  gameId: GameId;
  mode: MatchMode;
  /** Coins staked per match (paid modes). */
  entry?: number;
  tournamentId?: string;
  onClose: () => void;
}

interface Opponent {
  name: string;
  avatar: AvatarConfig;
  rating: number;
  score: number;
}

/** Skill-matched rival: rating near yours, target score near your recent form, all from the seed. */
function makeOpponent(gameId: GameId, seed: number, rating: number): Opponent {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const oppRating = Math.round(rating + (rng() - 0.5) * 160);
  const reference = userStore.referenceFor(gameId) * (1 + (oppRating - rating) / 1000);
  return { name: botName(rng), avatar: botAvatar(Math.floor(rng() * 1e9)), rating: oppRating, score: botScore(rng, reference, 0.8, 1.2) };
}

/** Arena field: 4 others on the same seed, spread from a bit weaker to a bit stronger than you. */
function makeField(gameId: GameId, seed: number): (Opponent & { score: number })[] {
  const rng = mulberry32(seed ^ 0x51ed27);
  const ref = userStore.referenceFor(gameId);
  const taken = new Set<string>();
  const bands: [number, number][] = [
    [1.08, 1.3],
    [0.95, 1.12],
    [0.82, 1.0],
    [0.65, 0.88],
  ];
  return bands.map(([lo, hi]) => ({ name: botName(rng, taken), avatar: botAvatar(Math.floor(rng() * 1e9)), rating: 0, score: botScore(rng, ref, lo, hi) }));
}

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

export default function GameModal({ gameId, mode, entry = 0, tournamentId, onClose }: GameModalProps) {
  const userState = useUserStore();
  const [runKey, setRunKey] = useState(0);
  const [seed, setSeed] = useState(() => randomSeed());
  const [matchmaking, setMatchmaking] = useState(mode === 'duel' || mode === 'arena');
  const [result, setResult] = useState<ResultData | null>(null);
  const [use2D, setUse2D] = useState(() => !supportsWebGL2() || force2D());
  const [notice, setNotice] = useState<string | null>(null);
  // Wall-clock time the current run opened (a snapshot, so render stays pure).
  const [runStartedAt, setRunStartedAt] = useState(() => Date.now());
  // Streak: current round (0-based). The stake is charged once, on round 1.
  const [round, setRound] = useState(0);
  const charged = useRef(false);
  const entryRef = useRef(entry);

  // GPU trouble (shader limits, lost context, no WebGL2): retry once in compatibility mode,
  // then switch to the 2D edition. Any stake already taken for the failed run is returned.
  useEffect(() => {
    const onFail = () => {
      if (charged.current) {
        userStore.refundEntry(entryRef.current);
        charged.current = false;
      }
      if (!isSafeMode()) {
        enableSafeMode();
        setNotice('Switched to compatibility graphics for this device.');
      } else {
        try {
          sessionStorage.setItem('ra.force2d', '1');
        } catch {
          /* ignore */
        }
        setUse2D(true);
        setNotice(null);
      }
      setRunKey((k) => k + 1);
    };
    window.addEventListener(ENGINE_FAILURE_EVENT, onFail);
    return () => window.removeEventListener(ENGINE_FAILURE_EVENT, onFail);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  // Reference score frozen for the whole streak / blitz so targets don't move between rounds.
  const [reference] = useState(() => userStore.referenceFor(gameId));

  const tournament = mode === 'tournament' ? userState.tournaments.find((t) => t.id === tournamentId) : undefined;
  const matchSeed = tournament ? tournament.seed : seed;

  const opponent = useMemo<Opponent | null>(
    () => (mode === 'duel' && !matchmaking ? makeOpponent(gameId, seed, userState.stats.rating) : null),
    // Opponent is fixed for the whole match; rating changes after it don't regenerate them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, matchmaking, gameId, seed],
  );
  const field = useMemo(() => (mode === 'arena' && !matchmaking ? makeField(gameId, seed) : null), [mode, matchmaking, gameId, seed]);
  const streakTarget = mode === 'streak' ? Math.max(1, Math.round(reference * STREAK_TARGETS[round])) : 0;

  const rival: RivalInfo | null = useMemo(() => {
    if (opponent) return { name: opponent.name, score: opponent.score };
    if (mode === 'streak') return { name: `Round ${round + 1}`, score: streakTarget, label: 'TARGET' };
    if (tournament) {
      const leader = standings(tournament, runStartedAt, { name: userState.username, avatar: userState.avatar }).find((r) => !r.isUser);
      return leader ? { name: leader.name, score: leader.score, label: '#1' } : null;
    }
    return null;
    // Leader snapshot taken when the run starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opponent, mode, round, streakTarget, tournament?.id, runKey, runStartedAt]);

  // Simulated matchmaking (1v1 ~1.5s, arena fills seat by seat)
  const [seats, setSeats] = useState(1);
  useEffect(() => {
    if (!matchmaking) return;
    if (mode === 'arena') {
      const timers = [1, 2, 3, 4].map((i) => setTimeout(() => setSeats(1 + i), i * 450));
      const done = setTimeout(() => setMatchmaking(false), 2200);
      return () => {
        timers.forEach(clearTimeout);
        clearTimeout(done);
      };
    }
    const timer = setTimeout(() => setMatchmaking(false), 1500);
    return () => clearTimeout(timer);
  }, [matchmaking, mode]);

  // Esc closes; page behind doesn't scroll while a match is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !result && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, result]);

  const onStarted = useCallback(() => {
    if (charged.current || entry <= 0) return;
    if (mode === 'practice' || mode === 'tournament') return;
    charged.current = userStore.chargeEntry(entry);
  }, [entry, mode]);

  const handleGameFinish = useCallback(
    (finalScore: number, stats: RunStats = {}) => {
      const breakdown = stats.breakdown;
      const base = { userScore: finalScore, breakdown, entry: mode === 'practice' || mode === 'tournament' ? 0 : entry };

      if (mode === 'tournament' && tournamentId) {
        const out = userStore.submitTournamentRun(tournamentId, finalScore, stats);
        if (out) {
          setResult({
            ...base,
            opponentScore: out.leader?.score ?? 0,
            opponentName: out.leader?.name ?? 'Field',
            opponentAvatar: getStarterAvatar('neutral'),
            ratingDelta: 0,
            coinsEarned: out.coinsEarned,
            xpEarned: out.xpEarned,
            tournament: { rank: out.rank, total: out.total, improved: out.improved, best: out.best, title: tournament?.title ?? 'Tournament' },
          });
          return;
        }
        // Cup closed mid-run: keep the rewards of a practice run rather than losing it.
        const fallback = userStore.recordMatchResult({ gameId, mode: 'practice', playerScore: finalScore, stats, opponentScore: 0 });
        setResult({ ...base, opponentScore: 0, opponentName: 'Cup closed', opponentAvatar: getStarterAvatar('neutral'), ...fallback, note: 'This cup ended before your run finished, so it was saved as practice.' });
        return;
      }

      if (mode === 'duel' && opponent) {
        const won = finalScore > opponent.score;
        const tie = finalScore === opponent.score;
        const prize = won ? duelPrize(entry) : tie ? entry : 0;
        const out = userStore.recordMatchResult({
          gameId,
          mode: 'duel',
          playerScore: finalScore,
          stats,
          opponentScore: opponent.score,
          opponentName: opponent.name,
          opponentAvatar: opponent.avatar,
          opponentRating: opponent.rating,
          settlement: { entry, prize, crowns: won ? 1 : 0, won, tie },
        });
        setResult({ ...base, opponentScore: opponent.score, opponentName: opponent.name, opponentAvatar: opponent.avatar, ...out });
        return;
      }

      if (mode === 'arena' && field) {
        const table = [...field.map((f) => ({ name: f.name, score: f.score, you: false })), { name: userState.username, score: finalScore, you: true }].sort((a, b) => b.score - a.score);
        const place = table.findIndex((r) => r.you) + 1;
        const prize = arenaPrizes(entry)[place - 1] ?? 0;
        const crowns = place === 1 ? 2 : place === 2 ? 1 : 0;
        const winner = table[0];
        const out = userStore.recordMatchResult({
          gameId,
          mode: 'arena',
          playerScore: finalScore,
          stats,
          opponentScore: winner.you ? table[1].score : winner.score,
          opponentName: winner.you ? table[1].name : winner.name,
          opponentAvatar: getStarterAvatar('neutral'),
          settlement: { entry, prize, crowns, won: place <= 3, detail: `${ordinal(place)} of ${ARENA_SIZE}` },
        });
        setResult({
          ...base,
          opponentScore: winner.score,
          opponentName: winner.name,
          opponentAvatar: getStarterAvatar('neutral'),
          ...out,
          headline: place === 1 ? { text: '👑 1ST PLACE', tone: 'win' } : place <= 3 ? { text: `${ordinal(place).toUpperCase()} PLACE · IN THE MONEY`, tone: 'win' } : { text: `${ordinal(place).toUpperCase()} PLACE`, tone: 'loss' },
          arena: { rows: table, place, prizes: arenaPrizes(entry) },
        });
        return;
      }

      if (mode === 'streak') {
        const cleared = finalScore >= streakTarget;
        const last = round === STREAK_TARGETS.length - 1;
        if (cleared && !last) {
          // Mid-streak: no settlement yet; just show the round result.
          setResult({
            ...base,
            opponentScore: streakTarget,
            opponentName: 'Target',
            opponentAvatar: getStarterAvatar('neutral'),
            ratingDelta: 0,
            coinsEarned: 0,
            xpEarned: 0,
            headline: { text: `ROUND ${round + 1} CLEARED`, tone: 'win' },
            streak: { round, total: STREAK_TARGETS.length, target: streakTarget, cleared: true, prize: streakPrize(entry) },
            rematchLabel: `ROUND ${round + 2} →`,
            pending: true,
          });
          return;
        }
        const roundsCleared = round + (cleared ? 1 : 0);
        const complete = cleared && last;
        // Two of three gives the stake back.
        const prize = complete ? streakPrize(entry) : roundsCleared === 2 ? entry : 0;
        const out = userStore.recordMatchResult({
          gameId,
          mode: 'streak',
          playerScore: finalScore,
          stats,
          opponentScore: streakTarget,
          opponentName: `Target ${round + 1}`,
          opponentAvatar: getStarterAvatar('neutral'),
          settlement: { entry, prize, crowns: complete ? 3 : 0, won: complete, detail: `${roundsCleared}/${STREAK_TARGETS.length} targets` },
        });
        setResult({
          ...base,
          opponentScore: streakTarget,
          opponentName: 'Target',
          opponentAvatar: getStarterAvatar('neutral'),
          ...out,
          headline: complete ? { text: '🔥 STREAK COMPLETE', tone: 'win' } : { text: `STREAK ENDED · ${roundsCleared}/${STREAK_TARGETS.length}`, tone: 'loss' },
          streak: { round, total: STREAK_TARGETS.length, target: streakTarget, cleared, prize: streakPrize(entry) },
          rematchLabel: 'NEW STREAK',
        });
        return;
      }

      if (mode === 'blitz') {
        const prize = blitzPayout(finalScore, entry, reference);
        const out = userStore.recordMatchResult({
          gameId,
          mode: 'blitz',
          playerScore: finalScore,
          stats,
          opponentScore: 0,
          opponentName: 'Blitz',
          settlement: { entry, prize, crowns: 0, won: prize > entry, detail: `${prize} coins` },
        });
        setResult({
          ...base,
          opponentScore: 0,
          opponentName: 'Blitz',
          opponentAvatar: getStarterAvatar('neutral'),
          ...out,
          headline: prize > entry ? { text: `⚡ +${prize - entry} PROFIT`, tone: 'win' } : { text: `BLITZ · ${prize} COINS`, tone: 'neutral' },
        });
        return;
      }

      const out = userStore.recordMatchResult({ gameId, mode: 'practice', playerScore: finalScore, stats, opponentScore: 0 });
      setResult({ ...base, opponentScore: 0, opponentName: 'Target Practice', opponentAvatar: getStarterAvatar('neutral'), ...out });
    },
    [mode, entry, tournamentId, gameId, opponent, field, streakTarget, round, reference, userState.username, tournament?.title],
  );

  const handleRematch = () => {
    const advancing = mode === 'streak' && result?.pending;
    setResult(null);
    setRunKey((k) => k + 1); // remount the game → fresh ready screen
    setRunStartedAt(Date.now());
    if (advancing) {
      setRound((r) => r + 1);
      setSeed(randomSeed());
      return;
    }
    // A new paid match needs a new stake.
    if (entry > 0 && mode !== 'practice' && mode !== 'tournament') {
      if (userStore.getState().stats.coins < entry) {
        onClose();
        return;
      }
      charged.current = false;
    }
    if (mode === 'streak') setRound(0);
    if (mode === 'duel' || mode === 'arena') {
      setSeed(randomSeed());
      setSeats(1);
      setMatchmaking(true);
    } else if (mode !== 'tournament') {
      setSeed(randomSeed());
    }
  };

  const tournamentClosed = tournament && tournamentStatus(tournament, runStartedAt) !== 'live';
  const Game3D = GAMES_3D[gameId];
  const Game2D = GAMES_2D[gameId];
  const modeLabel = mode === 'duel' ? (entry ? `1v1 · ${entry} entry` : '1v1 Ranked') : MODE_LABEL[mode];

  const extras: MatchExtras = useMemo(() => {
    const e: MatchExtras = { mode, entry, onStarted };
    if (mode === 'duel') e.stakeLine = entry ? `Entry ${entry} · Winner takes ${duelPrize(entry)}` : `Free entry · Win ${duelPrize(0)} coins`;
    if (mode === 'arena') {
      const p = arenaPrizes(entry);
      e.stakeLine = `${entry ? `Entry ${entry} · ` : ''}1st ${p[0]} · 2nd ${p[1]} · 3rd ${p[2]}`;
      if (field) e.field = field.map((f) => ({ name: f.name, score: f.score }));
    }
    if (mode === 'streak') {
      e.round = { index: round, total: STREAK_TARGETS.length };
      e.stakeLine = round === 0 ? `${entry ? `Entry ${entry} · ` : ''}Beat 3 targets → ${streakPrize(entry)}` : `Round ${round + 1} · Prize ${streakPrize(entry)}`;
    }
    if (mode === 'blitz') {
      e.coinRate = blitzRate(entry, reference);
      const cap = entry === 0 ? 120 : entry * 8;
      e.coinCap = cap;
      e.stakeLine = `${entry ? `Entry ${entry} · ` : ''}Every point pays · up to ${cap}`;
    }
    return e;
  }, [mode, entry, onStarted, field, round, reference]);

  const matchInfo = {
    modeLabel,
    seedCode: mode === 'practice' || mode === 'blitz' ? undefined : seedCode(matchSeed),
    playerName: userState.username,
    playerRating: mode === 'duel' ? userState.stats.rating : undefined,
    rivalName: opponent?.name ?? rival?.name,
    rivalAvatar: opponent?.avatar,
    rivalRating: opponent?.rating,
  };

  const closeBtn = (
    <button onClick={onClose} aria-label="Close match" className="absolute top-[max(env(safe-area-inset-top),10px)] left-3 z-50 w-10 h-10 rounded-full bg-black/50 border border-white/10 flex items-center justify-center text-white/80">
      <X className="w-5 h-5" />
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black h-[100dvh] w-screen overflow-hidden overscroll-none" data-testid="game-modal">
      {matchmaking ? (
        <div className="relative h-full flex flex-col items-center justify-center px-6 text-center bg-[radial-gradient(ellipse_at_center,#12203a_0%,#05060b_70%)]">
          {closeBtn}
          <div className="relative w-36 h-36 flex items-center justify-center mb-6">
            <div className="absolute inset-0 rounded-full border-2 border-cyan-500/40 animate-ping" />
            <div className="absolute inset-2 rounded-full border border-cyan-500/20" />
            <div className="w-20 h-20 rounded-full bg-[#161826] flex items-center justify-center border border-cyan-500/60 shadow-lg shadow-cyan-500/20">
              {mode === 'arena' ? <Users className="w-8 h-8 text-pink-400 animate-pulse" /> : <Swords className="w-8 h-8 text-cyan-400 animate-pulse" />}
            </div>
          </div>
          <h3 className="text-xl font-black text-white mb-1">{mode === 'arena' ? 'FILLING THE ARENA' : 'FINDING YOUR RIVAL'}</h3>
          <p className="text-xs text-slate-400 max-w-xs mb-4">
            {mode === 'arena' ? (
              <>
                <span className="text-pink-300 font-black text-base tabular-nums">
                  {seats}/{ARENA_SIZE}
                </span>{' '}
                players on seed <span className="font-mono text-slate-300">{seedCode(seed)}</span>
              </>
            ) : (
              <>
                Matching by skill ({userState.stats.rating} Elo) on certified seed <span className="font-mono text-slate-300">{seedCode(seed)}</span>
              </>
            )}
          </p>
          {entry > 0 && <p className="text-xs font-black text-amber-300 mb-3">{entry} coin entry</p>}
          <div className="flex items-center gap-3">
            <AvatarView avatar={userState.avatar} size={50} />
            <span className="text-sm font-bold text-cyan-400">{userState.username}</span>
          </div>
        </div>
      ) : tournamentClosed ? (
        <div className="relative h-full flex flex-col items-center justify-center px-6 text-center">
          {closeBtn}
          <h3 className="text-lg font-bold text-white mb-2">This cup isn’t live</h3>
          <p className="text-xs text-slate-400 mb-6">Runs can be submitted only while the tournament is live.</p>
          <button onClick={onClose} className="px-5 py-2.5 bg-cyan-500 text-black font-bold text-sm rounded-lg">Back to Arena</button>
        </div>
      ) : use2D && Game2D ? (
        <div className="relative h-full flex flex-col items-center justify-center p-2 overflow-y-auto">
          {closeBtn}
          <div className="w-full max-w-2xl">
            <div className="px-4 py-1.5 text-[11px] text-cyan-200 bg-cyan-950/30 border border-cyan-700/30 rounded-t-xl" data-testid="lite-edition">
              Lite edition — built to run smoothly on every device.
            </div>
            <Game2D
              key={runKey}
              avatar={userState.avatar}
              onFinish={(s) => {
                onStarted();
                handleGameFinish(s);
              }}
              modeName={modeLabel}
            />
          </div>
        </div>
      ) : (
        <GameErrorBoundary
          key={`b${runKey}`}
          onCrash={() => {
            if (charged.current) {
              userStore.refundEntry(entryRef.current);
              charged.current = false;
            }
          }}
          onRetry={() => setRunKey((k) => k + 1)}
          onLite={
            Game2D
              ? () => {
                  try {
                    sessionStorage.setItem('ra.force2d', '1');
                  } catch {
                    /* ignore */
                  }
                  setUse2D(true);
                }
              : undefined
          }
          onClose={onClose}
        >
          <MatchExtrasContext.Provider value={extras}>
            <Game3D key={runKey} avatar={userState.avatar} onFinish={handleGameFinish} modeName={modeLabel} seed={matchSeed} rival={rival} match={matchInfo} onExit={onClose} />
          </MatchExtrasContext.Provider>
        </GameErrorBoundary>
      )}

      {notice && (
        <div className="absolute top-[calc(env(safe-area-inset-top)+64px)] inset-x-0 z-[60] flex justify-center pointer-events-none" data-testid="compat-notice">
          <span className="px-4 py-2 rounded-full bg-black/75 backdrop-blur text-xs font-bold text-cyan-200">{notice}</span>
        </div>
      )}

      {result && (
        <MatchResultsModal
          gameName={GAME_NAMES[gameId]}
          mode={mode}
          userAvatar={userState.avatar}
          userName={userState.username}
          data={result}
          onRematch={handleRematch}
          onClose={() => {
            // Leaving mid-streak banks the rounds already cleared (2/3 refunds the stake).
            if (mode === 'streak' && result.pending) {
              const cleared = round + 1;
              userStore.recordMatchResult({
                gameId,
                mode: 'streak',
                playerScore: result.userScore,
                opponentScore: streakTarget,
                opponentName: `Target ${round + 1}`,
                settlement: { entry, prize: cleared === 2 ? entry : 0, crowns: 0, won: false, detail: `${cleared}/${STREAK_TARGETS.length} targets (left)` },
              });
            }
            setResult(null);
            onClose();
          }}
        />
      )}
    </div>
  );
}
