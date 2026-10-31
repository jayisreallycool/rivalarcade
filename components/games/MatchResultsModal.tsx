'use client';

import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { AvatarConfig } from '@/lib/avatar-types';
import type { MatchMode } from '@/lib/game-types';
import AvatarView from '@/components/avatar/AvatarView';
import { sound } from '@/lib/sound';
import { Trophy, Coins, Zap, RotateCcw, ArrowRight, Medal, Crown } from 'lucide-react';

export interface ResultData {
  userScore: number;
  opponentScore: number;
  opponentName: string;
  opponentAvatar: AvatarConfig;
  ratingDelta: number;
  coinsEarned: number;
  xpEarned: number;
  tournament?: { rank: number; total: number; improved: boolean; best: number; title: string };
  note?: string;
  breakdown?: { label: string; points: number }[];
  /** Coins staked (paid modes) — shown as net result. */
  entry?: number;
  crownsEarned?: number;
  headline?: { text: string; tone: 'win' | 'loss' | 'neutral' };
  arena?: { rows: { name: string; score: number; you: boolean }[]; place: number; prizes: number[] };
  streak?: { round: number; total: number; target: number; cleared: boolean; prize: number };
  rematchLabel?: string;
  /** Mid-streak round result: nothing settled yet. */
  pending?: boolean;
}

interface MatchResultsModalProps {
  gameName: string;
  mode: MatchMode;
  userAvatar: AvatarConfig;
  userName: string;
  data: ResultData;
  onRematch: () => void;
  onClose: () => void;
}

export default function MatchResultsModal({ gameName, mode, userAvatar, userName, data, onRematch, onClose }: MatchResultsModalProps) {
  const { userScore, opponentScore, opponentName, opponentAvatar, ratingDelta, coinsEarned, xpEarned, tournament, note, breakdown, headline, arena, streak, entry = 0, crownsEarned = 0, pending } = data;
  const isPractice = mode === 'practice' || !!note;
  const isTournament = mode === 'tournament' && !!tournament;
  const isWin = mode === 'duel' && userScore > opponentScore;
  const isTie = mode === 'duel' && userScore === opponentScore;
  const isLoss = mode === 'duel' && !isWin && !isTie;
  const podium = isTournament && tournament.rank <= 3;
  const celebrate = isWin || podium || (isTournament && tournament.improved) || headline?.tone === 'win';
  const showVs = mode === 'duel' || mode === 'practice' || mode === 'tournament' || !!note;
  const net = coinsEarned - entry;

  useEffect(() => {
    if (!celebrate) return;
    sound.playWin();
    try {
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 }, colors: ['#00f0ff', '#ffb800', '#ff0055', '#10b981'] });
    } catch {
      /* confetti is cosmetic */
    }
  }, [celebrate]);

  const header = headline
    ? { text: headline.text, cls: headline.tone === 'win' ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-black' : headline.tone === 'loss' ? 'bg-gradient-to-r from-red-600 to-rose-700 text-white' : 'bg-slate-700 text-white' }
    : isPractice
    ? { text: 'PRACTICE SESSION COMPLETE', cls: 'bg-slate-800 text-slate-300' }
    : isTournament
    ? { text: tournament.improved ? `NEW BEST · RANK #${tournament.rank}` : `RUN SUBMITTED · RANK #${tournament.rank}`, cls: 'bg-gradient-to-r from-amber-400 to-orange-500 text-black' }
    : isWin
    ? { text: '🏆 VICTORY!', cls: 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-black' }
    : isTie
    ? { text: 'MATCH TIED', cls: 'bg-slate-700 text-white' }
    : { text: 'DEFEAT', cls: 'bg-gradient-to-r from-red-600 to-rose-700 text-white' };

  const subtitle =
    mode === 'arena' ? 'Live Arena' : mode === 'streak' ? 'Streak' : mode === 'blitz' ? 'Blitz' : isPractice ? 'Solo Practice' : isTournament ? tournament.title : '1v1 Ranked Duel';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200" data-testid="results-modal">
      <div className="relative w-full max-w-lg bg-[#12131d] border border-[#242738] rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-full overflow-y-auto">
        <div className={`py-3 px-6 text-center font-black tracking-widest uppercase text-sm ${header.cls}`} data-testid="results-header">
          {header.text}
        </div>

        <div className="p-6 flex flex-col items-center">
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-4 text-center">
            {gameName} · {subtitle}
          </div>

          {note && <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-700/40 rounded-lg px-3 py-2 mb-3 text-center">{note}</p>}

          {arena && (
            <div className="w-full rounded-xl bg-[#0a0b12] border border-[#1e202f] p-2 my-2" data-testid="arena-results">
              {arena.rows.map((r, i) => (
                <div key={r.name + i} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${r.you ? 'bg-cyan-500/15 text-cyan-200 font-black' : 'text-slate-300'}`}>
                  <span className={`w-6 text-center font-black ${i < 3 ? 'text-amber-400' : 'text-slate-600'}`}>{i + 1}</span>
                  <span className="flex-1 truncate">{r.you ? `${r.name} (you)` : r.name}</span>
                  <span className="font-mono tabular-nums">{r.score.toLocaleString()}</span>
                  <span className="w-14 text-right text-xs font-black text-amber-400">{arena.prizes[i] ? `+${arena.prizes[i]}` : ''}</span>
                </div>
              ))}
            </div>
          )}

          {streak && (
            <div className="w-full rounded-xl bg-[#0a0b12] border border-[#1e202f] p-4 my-2 text-center" data-testid="streak-results">
              <div className="flex items-center justify-center gap-2 mb-3">
                {Array.from({ length: streak.total }, (_, i) => {
                  const done = i < streak.round || (i === streak.round && streak.cleared);
                  const failed = i === streak.round && !streak.cleared;
                  return (
                    <span key={i} className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-black border-2 ${done ? 'bg-emerald-400 border-emerald-300 text-black' : failed ? 'bg-rose-600 border-rose-400 text-white' : 'bg-white/5 border-white/15 text-white/40'}`}>
                      {done ? '✓' : failed ? '✕' : i + 1}
                    </span>
                  );
                })}
              </div>
              <div className="text-3xl font-black text-white tabular-nums">{userScore.toLocaleString()}</div>
              <div className="text-xs text-slate-400">
                target <span className="text-amber-300 font-bold">{streak.target.toLocaleString()}</span>
                {pending && <> · keep going for <span className="text-amber-300 font-bold">{streak.prize}</span> coins</>}
              </div>
            </div>
          )}

          {mode === 'blitz' && (
            <div className="w-full rounded-xl bg-[#0a0b12] border border-[#1e202f] p-4 my-2 text-center" data-testid="blitz-results">
              <div className="text-3xl font-black text-white tabular-nums">{userScore.toLocaleString()}</div>
              <div className="text-xs text-slate-400 mb-2">points</div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400 text-black text-sm font-black">
                <Coins className="w-4 h-4" /> {coinsEarned} coins
              </div>
            </div>
          )}

          {!showVs ? null : isTournament ? (
            <div className="w-full grid grid-cols-3 items-center my-2 py-4 bg-[#0a0b12] rounded-xl border border-[#1e202f] text-center">
              <div>
                <span className="text-[10px] uppercase text-slate-400 block">This run</span>
                <span className="text-2xl font-black text-white tabular-nums">{userScore}</span>
              </div>
              <div className="flex flex-col items-center">
                <Medal className={`w-7 h-7 ${tournament.rank === 1 ? 'text-amber-400' : tournament.rank <= 3 ? 'text-slate-300' : 'text-slate-600'}`} />
                <span className="text-lg font-black text-amber-400">#{tournament.rank}</span>
                <span className="text-[10px] text-slate-500">of {tournament.total}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-slate-400 block">Your best</span>
                <span className="text-2xl font-black text-cyan-300 tabular-nums">{tournament.best}</span>
              </div>
              <div className="col-span-3 text-[11px] text-slate-400 mt-3">
                {tournament.rank === 1 ? 'You lead the bracket — hold on until the cup closes!' : `Leader: ${opponentName} with ${opponentScore}. Your best run counts — try again any time while the cup is live.`}
              </div>
            </div>
          ) : (
            <div className="w-full flex items-center justify-around my-2 py-4 bg-[#0a0b12] rounded-xl border border-[#1e202f]">
              <div className="flex flex-col items-center text-center">
                <div className="relative">
                  <AvatarView avatar={userAvatar} size={100} action={isWin ? 'celebrate' : 'idle'} animate />
                  {isWin && <span className="absolute -top-2 -right-2 bg-amber-400 text-black text-[10px] font-black px-1.5 py-0.5 rounded shadow">WIN</span>}
                </div>
                <span className="font-bold text-sm text-cyan-400 mt-1">{userName}</span>
                <div className="text-3xl font-black text-white mt-1 tabular-nums">{userScore}</div>
              </div>

              {!isPractice && <span className="text-xs font-black text-slate-500 tracking-widest italic">VS</span>}

              {!isPractice && (
                <div className="flex flex-col items-center text-center">
                  <div className="relative">
                    <AvatarView avatar={opponentAvatar} size={100} action={isLoss ? 'celebrate' : 'idle'} animate />
                    {isLoss && <span className="absolute -top-2 -right-2 bg-amber-400 text-black text-[10px] font-black px-1.5 py-0.5 rounded shadow">WIN</span>}
                  </div>
                  <span className="font-bold text-sm text-slate-400 mt-1">{opponentName}</span>
                  <div className="text-3xl font-black text-slate-300 mt-1 tabular-nums">{opponentScore}</div>
                </div>
              )}
            </div>
          )}

          {breakdown && breakdown.length > 0 && (
            <div className="w-full mt-3 rounded-xl bg-[#0a0b12] border border-[#1e202f] p-3 text-xs" data-testid="score-breakdown">
              <div className="text-[10px] font-black tracking-widest text-slate-500 mb-1.5">SCORE BREAKDOWN</div>
              {breakdown.map((b) => (
                <div key={b.label} className="flex items-center justify-between py-0.5">
                  <span className="text-slate-400">{b.label}</span>
                  <span className={`font-mono font-bold tabular-nums ${b.points < 0 ? 'text-rose-400' : 'text-white'}`}>
                    {b.points > 0 ? '+' : ''}
                    {b.points.toLocaleString()}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-[#1e202f]">
                <span className="text-slate-300 font-bold">Total</span>
                <span className="font-mono font-black text-cyan-300 tabular-nums">{userScore.toLocaleString()}</span>
              </div>
            </div>
          )}

          <div className="w-full grid grid-cols-3 gap-2 my-4">
            <div className="flex flex-col items-center p-3 bg-[#181a27] rounded-lg border border-[#242738]">
              {mode === 'duel' || mode === 'practice' || mode === 'tournament' ? (
                <>
                  <Trophy className="w-4 h-4 text-amber-400 mb-1" />
                  <span className="text-[10px] uppercase text-slate-400">Skill Rating</span>
                  <span className={`text-sm font-black ${ratingDelta > 0 ? 'text-emerald-400' : ratingDelta < 0 ? 'text-rose-400' : 'text-slate-300'}`} data-testid="rating-delta">
                    {mode === 'duel' ? (ratingDelta > 0 ? `+${ratingDelta}` : ratingDelta) : '—'}
                  </span>
                </>
              ) : (
                <>
                  <Crown className="w-4 h-4 text-amber-400 mb-1" />
                  <span className="text-[10px] uppercase text-slate-400">Crowns</span>
                  <span className={`text-sm font-black ${crownsEarned > 0 ? 'text-emerald-400' : 'text-slate-300'}`}>{pending ? '…' : `+${crownsEarned}`}</span>
                </>
              )}
            </div>
            <div className="flex flex-col items-center p-3 bg-[#181a27] rounded-lg border border-[#242738]">
              <Coins className="w-4 h-4 text-amber-400 mb-1" />
              <span className="text-[10px] uppercase text-slate-400">{entry > 0 ? 'Net Coins' : 'Rival Coins'}</span>
              <span className={`text-sm font-black ${entry > 0 && net < 0 ? 'text-rose-400' : 'text-amber-400'}`} data-testid="coins-delta">
                {pending ? '…' : entry > 0 ? (net >= 0 ? `+${net}` : net) : `+${coinsEarned}`}
              </span>
            </div>
            <div className="flex flex-col items-center p-3 bg-[#181a27] rounded-lg border border-[#242738]">
              <Zap className="w-4 h-4 text-cyan-400 mb-1" />
              <span className="text-[10px] uppercase text-slate-400">Season XP</span>
              <span className="text-sm font-black text-cyan-400">+{xpEarned} XP</span>
            </div>
          </div>

          <div className="w-full flex items-center gap-3 mt-3">
            <button
              onClick={onRematch}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#1e202f] hover:bg-[#282b3f] text-slate-200 font-bold text-sm rounded-xl border border-[#32364e] transition-colors active:scale-95"
            >
              <RotateCcw className="w-4 h-4 text-amber-400" /> {data.rematchLabel ?? (mode === 'duel' ? 'New Duel' : mode === 'tournament' ? 'Run Again' : mode === 'arena' ? 'New Arena' : 'Play Again')}
            </button>
            <button
              onClick={onClose}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-extrabold text-sm rounded-xl shadow-lg shadow-cyan-500/20 transition-transform active:scale-95"
            >
              {pending ? 'Leave streak' : 'Continue'} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
