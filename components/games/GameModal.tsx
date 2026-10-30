'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { AvatarConfig } from '@/lib/avatar-types';
import { userStore, useUserStore } from '@/lib/user-store';
import { getStarterAvatar } from '@/lib/cosmetics-catalog';
import { GAME_NAMES, GameId, GameProps, MatchMode, RivalInfo, RunStats } from '@/lib/game-types';
import { botAvatar, botName, botScore } from '@/lib/bots';
import { mulberry32, randomSeed, seedCode } from '@/lib/rng';
import { standings, tournamentStatus } from '@/lib/tournaments-data';
import { supportsWebGL2 } from '@/lib/engine/quality';
import MatchResultsModal, { ResultData } from './MatchResultsModal';
import AvatarView from '@/components/avatar/AvatarView';
import { X, Swords } from 'lucide-react';

function GameLoading() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[#070810] text-slate-400">
      <div className="w-10 h-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
      <span className="text-[11px] font-bold uppercase tracking-widest">Loading 3D arena…</span>
    </div>
  );
}

// 3D games (and three.js) are code-split so they only download when a match opens.
const GAMES_3D: Record<GameId, React.ComponentType<GameProps>> = {
  'neon-dash': dynamic(() => import('./NeonDash3DGame'), { ssr: false, loading: GameLoading }),
  'dunk-rush': dynamic(() => import('./DunkRush3DGame'), { ssr: false, loading: GameLoading }),
  'cyber-reflex': dynamic(() => import('./CyberReflex3DGame'), { ssr: false, loading: GameLoading }),
  'gem-surge': dynamic(() => import('./GemSurge3DGame'), { ssr: false, loading: GameLoading }),
};

type Game2DProps = { avatar: AvatarConfig; onFinish: (score: number) => void; modeName?: string };
// Canvas 2D versions for devices without WebGL2.
const GAMES_2D: Record<GameId, React.ComponentType<Game2DProps>> = {
  'neon-dash': dynamic(() => import('./NeonDashGame'), { ssr: false }),
  'dunk-rush': dynamic(() => import('./DunkRushGame'), { ssr: false }),
  'cyber-reflex': dynamic(() => import('./CyberReflexGame'), { ssr: false }),
  'gem-surge': dynamic(() => import('./GemSurgeGame'), { ssr: false }),
};

interface GameModalProps {
  gameId: GameId;
  mode: MatchMode;
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

const MODE_LABEL: Record<MatchMode, string> = { practice: 'Practice', duel: '1v1 Ranked', tournament: 'Tournament' };

export default function GameModal({ gameId, mode, tournamentId, onClose }: GameModalProps) {
  const userState = useUserStore();
  const [runKey, setRunKey] = useState(0);
  const [seed, setSeed] = useState(() => randomSeed());
  const [matchmaking, setMatchmaking] = useState(mode === 'duel');
  const [result, setResult] = useState<ResultData | null>(null);
  const [use2D] = useState(() => !supportsWebGL2());
  // Wall-clock time the current run opened (a snapshot, so render stays pure).
  const [runStartedAt, setRunStartedAt] = useState(() => Date.now());

  const tournament = mode === 'tournament' ? userState.tournaments.find((t) => t.id === tournamentId) : undefined;
  const matchSeed = tournament ? tournament.seed : seed;

  const opponent = useMemo<Opponent | null>(
    () => (mode === 'duel' && !matchmaking ? makeOpponent(gameId, seed, userState.stats.rating) : null),
    // Opponent is fixed for the whole match; rating changes after it don't regenerate them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, matchmaking, gameId, seed],
  );

  const rival: RivalInfo | null = useMemo(() => {
    if (opponent) return { name: opponent.name, score: opponent.score };
    if (tournament) {
      const leader = standings(tournament, runStartedAt, { name: userState.username, avatar: userState.avatar }).find((r) => !r.isUser);
      return leader ? { name: leader.name, score: leader.score, label: '#1' } : null;
    }
    return null;
    // Leader snapshot taken when the run starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opponent, tournament?.id, runKey, runStartedAt]);

  // Simulated matchmaking (~1.5s)
  useEffect(() => {
    if (!matchmaking) return;
    const timer = setTimeout(() => setMatchmaking(false), 1500);
    return () => clearTimeout(timer);
  }, [matchmaking]);

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

  const handleGameFinish = useCallback(
    (finalScore: number, stats: RunStats = {}) => {
      if (mode === 'tournament' && tournamentId) {
        const out = userStore.submitTournamentRun(tournamentId, finalScore, stats);
        if (out) {
          setResult({
            userScore: finalScore,
            opponentScore: out.leader?.score ?? 0,
            opponentName: out.leader?.name ?? 'Field',
            opponentAvatar: getStarterAvatar('neutral'),
            ratingDelta: 0,
            coinsEarned: out.coinsEarned,
            xpEarned: out.xpEarned,
            tournament: { rank: out.rank, total: out.total, improved: out.improved, best: out.best, title: tournament?.title ?? 'Tournament' },
            breakdown: stats.breakdown,
          });
          return;
        }
        // Cup closed mid-run: keep the rewards of a practice run rather than losing it.
        const fallback = userStore.recordMatchResult({ gameId, mode: 'practice', playerScore: finalScore, stats, opponentScore: 0 });
        setResult({ userScore: finalScore, opponentScore: 0, opponentName: 'Cup closed', opponentAvatar: getStarterAvatar('neutral'), ...fallback, note: 'This cup ended before your run finished, so it was saved as practice.' });
        return;
      }

      const out = userStore.recordMatchResult({
        gameId,
        mode: mode === 'duel' ? 'duel' : 'practice',
        playerScore: finalScore,
        stats,
        opponentScore: opponent?.score ?? 0,
        opponentName: opponent?.name,
        opponentAvatar: opponent?.avatar,
        opponentRating: opponent?.rating,
      });
      setResult({
        userScore: finalScore,
        opponentScore: opponent?.score ?? 0,
        opponentName: opponent?.name ?? 'Target Practice',
        opponentAvatar: opponent?.avatar ?? getStarterAvatar('neutral'),
        breakdown: stats.breakdown,
        ...out,
      });
    },
    [mode, tournamentId, gameId, opponent, tournament?.title],
  );

  const handleRematch = () => {
    setResult(null);
    setRunKey((k) => k + 1); // remount the game → fresh ready screen
    setRunStartedAt(Date.now());
    if (mode === 'duel') {
      setSeed(randomSeed());
      setMatchmaking(true);
    } else if (mode === 'practice') {
      setSeed(randomSeed());
    }
  };

  const tournamentClosed = tournament && tournamentStatus(tournament, runStartedAt) !== 'live';
  const Game3D = GAMES_3D[gameId];
  const Game2D = GAMES_2D[gameId];

  const matchInfo = {
    modeLabel: MODE_LABEL[mode],
    seedCode: mode === 'practice' ? undefined : seedCode(matchSeed),
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
              <Swords className="w-8 h-8 text-cyan-400 animate-pulse" />
            </div>
          </div>
          <h3 className="text-xl font-black text-white mb-1">FINDING YOUR RIVAL</h3>
          <p className="text-xs text-slate-400 max-w-xs mb-4">
            Matching by skill ({userState.stats.rating} Elo) on certified seed <span className="font-mono text-slate-300">{seedCode(seed)}</span>
          </p>
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
      ) : use2D ? (
        <div className="relative h-full flex flex-col items-center justify-center p-2 overflow-y-auto">
          {closeBtn}
          <div className="w-full max-w-2xl">
            <div className="px-4 py-1.5 text-[11px] text-amber-300 bg-amber-950/30 border border-amber-700/30 rounded-t-xl">
              3D isn’t available on this device, so you’re playing the 2D edition.
            </div>
            <Game2D key={runKey} avatar={userState.avatar} onFinish={(s) => handleGameFinish(s)} modeName={MODE_LABEL[mode]} />
          </div>
        </div>
      ) : (
        <Game3D key={runKey} avatar={userState.avatar} onFinish={handleGameFinish} modeName={MODE_LABEL[mode]} seed={matchSeed} rival={rival} match={matchInfo} onExit={onClose} />
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
            setResult(null);
            onClose();
          }}
        />
      )}
    </div>
  );
}
