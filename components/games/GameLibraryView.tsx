'use client';

import React, { useEffect, useState } from 'react';
import { useUserStore } from '@/lib/user-store';
import GameArt from './GameArt';
import { tournamentStatus } from '@/lib/tournaments-data';
import GameModal from './GameModal';
import { sound } from '@/lib/sound';
import { ARENA_SIZE, GameId, MatchMode, STAKES, arenaPrizes, duelPrize, streakPrize } from '@/lib/game-types';
import { Swords, Coins, Zap, Flame, Users, Target, X, ChevronRight, Lock, Sparkles } from 'lucide-react';

interface GameTile {
  id: GameId;
  title: string;
  genre: string;
  blurb: string;
  from: string;
  to: string;
  tags: Category[];
}

type Category = 'action' | 'puzzle' | 'sports' | 'new' | 'popular';
const CHIPS: { id: 'all' | 'live' | Category; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'action', label: 'Action' },
  { id: 'puzzle', label: 'Puzzle' },
  { id: 'sports', label: 'Sports' },
  { id: 'new', label: 'New' },
  { id: 'popular', label: 'Popular' },
];

export const TILES: Record<GameId, GameTile> = {
  'dunk-rush': { id: 'dunk-rush', title: 'Dunk Rush', genre: 'Flick Basketball', blurb: 'Flick to shoot. Swishes, banks and streak multipliers.', from: '#f97316', to: '#7c2d12', tags: ['sports', 'popular'] },
  'brick-blitz': { id: 'brick-blitz', title: 'Brick Blitz', genre: 'Aim & Launch', blurb: 'Drag, aim, release a volley. Break the wall before it lands.', from: '#38bdf8', to: '#4338ca', tags: ['puzzle', 'new', 'popular'] },
  'neon-dash': { id: 'neon-dash', title: 'Neon Dash', genre: 'Swipe Runner', blurb: 'Swipe lanes, jump and slide down a neon highway.', from: '#ec4899', to: '#1e0b4b', tags: ['action', 'popular'] },
  'gem-surge': { id: 'gem-surge', title: 'Gem Surge', genre: 'Match-3', blurb: 'Swipe to swap. Cascades multiply every clear.', from: '#c084fc', to: '#2e1065', tags: ['puzzle'] },
  'cyber-reflex': { id: 'cyber-reflex', title: 'Cyber Reflex', genre: 'Tap & Slash', blurb: 'Hit targets dead-centre, chain perfects, dodge hazards.', from: '#14b8a6', to: '#042f2e', tags: ['action', 'new'] },
};
const ORDER: GameId[] = ['dunk-rush', 'brick-blitz', 'neon-dash', 'gem-surge', 'cyber-reflex'];

interface ModeCard {
  mode: Exclude<MatchMode, 'tournament'>;
  title: string;
  icon: React.ReactNode;
  color: string;
  desc: string;
  prize: (entry: number) => string;
  paid: boolean;
}

const MODES: ModeCard[] = [
  { mode: 'duel', title: '1v1', icon: <Swords className="w-5 h-5" />, color: '#22d3ee', desc: 'Same seed as a skill-matched rival. Higher score takes the pot.', prize: (e) => `Win ${duelPrize(e)} · +1 crown`, paid: true },
  { mode: 'arena', title: 'Live Arena', icon: <Users className="w-5 h-5" />, color: '#f472b6', desc: `${ARENA_SIZE} players, one seed, live leaderboard. Top 3 paid.`, prize: (e) => `1st ${arenaPrizes(e)[0]} · 2nd ${arenaPrizes(e)[1]} · 3rd ${arenaPrizes(e)[2]}`, paid: true },
  { mode: 'streak', title: 'Streak', icon: <Flame className="w-5 h-5" />, color: '#f59e0b', desc: 'Beat 3 rising targets in a row. Miss once and the streak ends.', prize: (e) => `Clear all 3 → ${streakPrize(e)} · +3 crowns`, paid: true },
  { mode: 'blitz', title: 'Blitz', icon: <Zap className="w-5 h-5" />, color: '#a3e635', desc: 'No opponent. Every point you score pays coins instantly.', prize: (e) => (e === 0 ? 'Up to 120 coins' : `Up to ${e * 8} coins`), paid: true },
  { mode: 'practice', title: 'Practice', icon: <Target className="w-5 h-5" />, color: '#94a3b8', desc: 'Free warm-up on a random seed. No stakes.', prize: () => 'Free · small XP', paid: false },
];

export default function GameLibraryView() {
  const userState = useUserStore();
  const [sheet, setSheet] = useState<GameId | null>(null);
  const [entry, setEntry] = useState<number>(25);
  const [chip, setChip] = useState<(typeof CHIPS)[number]['id']>('all');
  const [activeGame, setActiveGame] = useState<{ gameId: GameId; mode: MatchMode; entry: number } | null>(null);
  const [now] = useState(() => Date.now());
  const coins = userState.stats.coins;

  // Games with a cup running right now get a LIVE badge (and the Live filter).
  const liveGames = new Set(userState.tournaments.filter((t) => tournamentStatus(t, now) === 'live').map((t) => t.gameId));

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSheet(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);

  const launch = (gameId: GameId, mode: MatchMode, stake: number) => {
    sound.playTap();
    setSheet(null);
    setActiveGame({ gameId, mode, entry: mode === 'practice' ? 0 : stake });
  };

  const visible = ORDER.filter((id) => chip === 'all' || (chip === 'live' ? liveGames.has(id) : TILES[id].tags.includes(chip)));
  const tile = sheet ? TILES[sheet] : null;

  return (
    <div className="w-full max-w-5xl mx-auto pb-6" data-testid="lobby">
      {/* Category chips */}
      <div className="sticky top-16 z-30 -mt-1 pb-3 pt-1 bg-gradient-to-b from-[#0b0b10]/0 via-[#0b0b10]/0 to-transparent">
        <div className="flex gap-2 overflow-x-auto px-4 py-1 no-scrollbar" role="tablist" aria-label="Game categories">
          {CHIPS.map((c) => {
            const on = chip === c.id;
            return (
              <button
                key={c.id}
                role="tab"
                aria-selected={on}
                onClick={() => {
                  sound.playTap();
                  setChip(c.id);
                }}
                className={`shrink-0 h-10 px-5 rounded-full text-[15px] font-bold transition-colors flex items-center gap-1.5 ${
                  on ? 'bg-[#141420] text-white ring-2 ring-white/85' : 'bg-white/[0.07] text-white/60'
                }`}
                data-testid={`chip-${c.id}`}
              >
                {c.id === 'live' && <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />}
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Game grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 px-4">
        {visible.map((id) => {
          const g = TILES[id];
          return (
            <button
              key={id}
              onClick={() => {
                sound.playTap();
                setSheet(id);
              }}
              className="group relative aspect-[300/430] overflow-hidden rounded-[22px] text-left shadow-[0_10px_30px_-12px_rgba(0,0,0,0.8)] ring-1 ring-white/10 active:scale-[0.97] transition-transform"
              style={{ background: `linear-gradient(160deg, ${g.from}, ${g.to})` }}
              data-testid={`tile-${id}`}
              aria-label={`${g.title} — ${g.genre}`}
            >
              <GameArt id={id} />
              <div className="absolute top-2.5 right-2.5 flex flex-col items-end gap-1">
                {liveGames.has(id) && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur text-[10px] font-black text-emerald-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE
                  </span>
                )}
                {g.tags.includes('new') && <span className="px-2 py-0.5 rounded-full bg-white text-black text-[10px] font-black">NEW</span>}
              </div>
            </button>
          );
        })}
        {chip === 'all' && (
          <div className="relative aspect-[300/430] rounded-[22px] overflow-hidden bg-gradient-to-b from-[#1b1d2a] to-[#0d0e15] ring-1 ring-white/5 flex flex-col items-center justify-center text-center p-4" aria-hidden>
            <Sparkles className="w-8 h-8 text-white/25 mb-2" />
            <span className="text-white/45 font-black text-lg" style={{ fontFamily: "'Lilita One', system-ui" }}>
              MORE GAMES
            </span>
            <span className="text-white/30 text-xs font-bold">coming soon</span>
          </div>
        )}
        {visible.length === 0 && (
          <div className="col-span-2 py-16 text-center text-white/40 text-sm font-bold">No live cups right now — check back soon.</div>
        )}
      </div>

      {/* Mode sheet */}
      {tile && (
        <div className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setSheet(null)} data-testid="mode-sheet">
          <div
            className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-[28px] sm:rounded-[28px] bg-[#101018] border border-white/10 pb-[max(env(safe-area-inset-bottom),16px)] animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative h-44 overflow-hidden">
              <div className="absolute inset-0 [&>svg]:w-full [&>svg]:h-[260%] [&>svg]:-translate-y-[22%]">
                <GameArt id={tile.id} />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-[#101018] via-[#101018]/30 to-transparent" />
              <button onClick={() => setSheet(null)} aria-label="Close" className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-white">
                <X className="w-5 h-5" />
              </button>
              <div className="absolute bottom-2 left-4 right-4">
                <span className="text-[10px] font-black tracking-widest text-white/70 uppercase">{tile.genre}</span>
                <h3 className="text-3xl text-white leading-none drop-shadow" style={{ fontFamily: "'Lilita One', system-ui" }}>
                  {tile.title}
                </h3>
                <p className="text-xs text-white/75 mt-1">
                  {tile.blurb}
                  {(userState.stats.highScores[tile.id] || 0) > 0 && <span className="ml-1 font-black text-amber-300">Best {userState.stats.highScores[tile.id].toLocaleString()}</span>}
                </p>
              </div>
            </div>

            <div className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-black tracking-widest text-white/50">ENTRY</span>
                <span className="flex items-center gap-1 text-xs font-black text-amber-300" suppressHydrationWarning>
                  <Coins className="w-3.5 h-3.5" /> {coins.toLocaleString()}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5 mb-4" role="radiogroup" aria-label="Entry fee">
                {STAKES.map((s) => {
                  const afford = coins >= s;
                  const on = entry === s;
                  return (
                    <button
                      key={s}
                      role="radio"
                      aria-checked={on}
                      disabled={!afford}
                      onClick={() => {
                        sound.playTap();
                        setEntry(s);
                      }}
                      className={`h-11 rounded-xl text-sm font-black border transition-colors ${
                        on ? 'bg-amber-400 text-black border-amber-300' : afford ? 'bg-white/5 text-white border-white/10' : 'bg-white/5 text-white/25 border-white/5'
                      }`}
                      data-testid={`stake-${s}`}
                    >
                      {s === 0 ? 'FREE' : s}
                    </button>
                  );
                })}
              </div>

              <div className="space-y-2">
                {MODES.map((m) => {
                  const stake = m.paid ? entry : 0;
                  const locked = stake > coins;
                  return (
                    <button
                      key={m.mode}
                      disabled={locked}
                      onClick={() => launch(tile.id, m.mode, stake)}
                      className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white/[0.05] border border-white/10 text-left active:scale-[0.98] transition-transform disabled:opacity-40"
                      data-testid={`mode-${m.mode}`}
                    >
                      <span className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-black" style={{ background: m.color }}>
                        {m.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-base font-black text-white">{m.title}</span>
                          {m.paid && <span className="px-1.5 py-0.5 rounded bg-black/40 text-[10px] font-black text-amber-300">{stake === 0 ? 'FREE' : `${stake} ENTRY`}</span>}
                        </span>
                        <span className="block text-[11px] text-white/55 leading-snug">{m.desc}</span>
                        <span className="block text-[11px] font-bold mt-0.5" style={{ color: m.color }}>
                          {m.prize(stake)}
                        </span>
                      </span>
                      {locked ? <Lock className="w-4 h-4 text-white/40" /> : <ChevronRight className="w-5 h-5 text-white/40" />}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[10px] text-white/35 text-center">Rival Coins are a virtual in-game currency with no cash value.</p>
            </div>
          </div>
        </div>
      )}

      {activeGame && <GameModal gameId={activeGame.gameId} mode={activeGame.mode} entry={activeGame.entry} onClose={() => setActiveGame(null)} />}
    </div>
  );
}
