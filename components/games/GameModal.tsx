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
import { X, Swords, ShieldCheck, Hash } from 'lucide-react';

function GameLoading() {
  return (
    <div className="w-full aspect-[16/9] flex flex-col items-center justify-center gap-3 bg-[#070810] text-slate-400">
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md" data-testid="game-modal">
      <div className="relative w-full max-w-2xl max-h-full overflow-y-auto bg-[#0e1018] border border-[#242738] rounded-2xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#12131d] border-b border-[#242738]">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider truncate">
              {mode === 'practice' ? 'Practice Arena' : mode === 'tournament' ? tournament?.title ?? 'Tournament Match' : '1v1 Ranked Match'}
            </span>
            {mode !== 'practice' && !matchmaking && (
              <span className="hidden sm:flex items-center gap-1 text-[10px] font-mono text-slate-500" title="Every player in this match gets this exact seed">
                <Hash className="w-3 h-3" /> SEED {seedCode(matchSeed)}
              </span>
            )}
          </div>
          <button onClick={onClose} aria-label="Close match" className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {matchmaking ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="relative w-36 h-36 flex items-center justify-center mb-6">
              <div className="absolute inset-0 rounded-full border-2 border-cyan-500/40 animate-ping" />
              <div className="absolute inset-2 rounded-full border border-cyan-500/20" />
              <div className="w-20 h-20 rounded-full bg-[#161826] flex items-center justify-center border border-cyan-500/60 shadow-lg shadow-cyan-500/20">
                <Swords className="w-8 h-8 text-cyan-400 animate-pulse" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-white mb-1">SEARCHING FOR OPPONENT</h3>
            <p className="text-xs text-slate-400 max-w-xs mb-4">
              Matching by Skill Rating ({userState.stats.rating} Elo) on certified seed <span className="font-mono text-slate-300">{seedCode(seed)}</span>…
            </p>
            <div className="flex items-center gap-3">
              <AvatarView avatar={userState.avatar} size={50} />
              <span className="text-sm font-bold text-cyan-400">{userState.username}</span>
            </div>
          </div>
        ) : tournamentClosed ? (
          <div className="py-16 px-6 text-center">
            <h3 className="text-lg font-bold text-white mb-2">This cup isn’t live</h3>
            <p className="text-xs text-slate-400 mb-6">Runs can be submitted only while the tournament is live.</p>
            <button onClick={onClose} className="px-5 py-2.5 bg-cyan-500 text-black font-bold text-sm rounded-lg">Back to Arena</button>
          </div>
        ) : (
          <div className="w-full">
            {opponent && (
              <div className="flex items-center justify-between px-4 py-2 bg-[#0b0c14] border-b border-[#242738] text-xs" data-testid="duel-header">
                <div className="flex items-center gap-2">
                  <AvatarView avatar={userState.avatar} size={32} animate={false} />
                  <span className="font-bold text-cyan-400">{userState.username}</span>
                  <span className="text-slate-500 font-mono">{userState.stats.rating}</span>
                </div>
                <span className="text-[10px] font-black text-slate-500 italic">VS</span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-mono">{opponent.rating}</span>
                  <span className="font-bold text-rose-300">{opponent.name}</span>
                  <AvatarView avatar={opponent.avatar} size={32} animate={false} />
                </div>
              </div>
            )}
            {use2D ? (
              <>
                <div className="px-4 py-1.5 text-[11px] text-amber-300 bg-amber-950/30 border-b border-amber-700/30">
                  3D isn’t available on this device, so you’re playing the 2D edition.
                </div>
                <Game2D key={runKey} avatar={userState.avatar} onFinish={(s) => handleGameFinish(s)} modeName={MODE_LABEL[mode]} />
              </>
            ) : (
              <Game3D key={runKey} avatar={userState.avatar} onFinish={handleGameFinish} modeName={MODE_LABEL[mode]} seed={matchSeed} rival={rival} />
            )}
          </div>
        )}
      </div>

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
