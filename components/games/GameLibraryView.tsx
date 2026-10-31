'use client';

import React, { useEffect, useState } from 'react';
import { useUserStore } from '@/lib/user-store';
import AvatarView from '@/components/avatar/AvatarView';
import GameModal from './GameModal';
import { sound } from '@/lib/sound';
import { ARENA_SIZE, GAME_IDS, GameId, MatchMode, STAKES, arenaPrizes, duelPrize, leagueFor, streakPrize } from '@/lib/game-types';
import { Swords, Crown, Coins, Zap, Flame, Users, Target, Play, X, ChevronRight, Lock } from 'lucide-react';

interface GameTile {
  id: GameId;
  title: string;
  genre: string;
  blurb: string;
  from: string;
  to: string;
  glyph: string;
  isNew?: boolean;
}

const TILES: Record<GameId, GameTile> = {
  'brick-blitz': { id: 'brick-blitz', title: 'Brick Blitz', genre: 'Aim & Launch', blurb: 'Drag, aim, release a volley. Break the wall before it lands.', from: '#0ea5e9', to: '#6d28d9', glyph: '▦', isNew: true },
  'dunk-rush': { id: 'dunk-rush', title: 'Dunk Rush', genre: 'Flick Basketball', blurb: 'Flick to shoot. Swishes, banks and streak multipliers.', from: '#f97316', to: '#be123c', glyph: '🏀' },
  'neon-dash': { id: 'neon-dash', title: 'Neon Dash', genre: 'Swipe Runner', blurb: 'Swipe lanes, jump and slide through a neon highway.', from: '#06b6d4', to: '#1d4ed8', glyph: '⚡' },
  'cyber-reflex': { id: 'cyber-reflex', title: 'Cyber Reflex', genre: 'Tap & Slash', blurb: 'Hit targets dead-centre, chain perfects, dodge hazards.', from: '#10b981', to: '#0f766e', glyph: '◎' },
  'gem-surge': { id: 'gem-surge', title: 'Gem Surge', genre: 'Match-3', blurb: 'Swipe to swap. Cascades multiply every clear.', from: '#c084fc', to: '#7e22ce', glyph: '◆' },
};

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

export default function GameLibraryView({ onNavigateWardrobe }: { onNavigateWardrobe: () => void }) {
  const userState = useUserStore();
  const [sheet, setSheet] = useState<GameId | null>(null);
  const [entry, setEntry] = useState<number>(25);
  const [activeGame, setActiveGame] = useState<{ gameId: GameId; mode: MatchMode; entry: number } | null>(null);
  const league = leagueFor(userState.stats.crowns ?? 0);
  const coins = userState.stats.coins;

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

  const tile = sheet ? TILES[sheet] : null;

  return (
    <div className="w-full max-w-5xl mx-auto px-4 pb-6 space-y-5">
      {/* League card */}
      <div className="w-full text-left relative overflow-hidden rounded-3xl border border-white/10 p-4 bg-[radial-gradient(120%_120%_at_0%_0%,#1e1b4b_0%,#0b0c16_60%)]" data-testid="league-card">
        <div className="flex items-center gap-4">
          <div className="relative w-16 h-16 shrink-0 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center">
            <AvatarView avatar={userState.avatar} size={70} animate={false} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white/50 font-bold truncate">{userState.username}</div>
            <div className="flex items-center gap-1.5">
              <Crown className="w-5 h-5" style={{ color: league.color }} />
              <span className="text-xl font-black italic" style={{ color: league.color }} data-testid="league-name">
                {league.name.toUpperCase()} LEAGUE
              </span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.round(league.progress * 100)}%`, background: league.color }} />
            </div>
            <div className="mt-1 text-[11px] text-white/50 font-bold" suppressHydrationWarning>
              {userState.stats.crowns ?? 0} crowns{league.next ? ` · ${league.next.crowns - (userState.stats.crowns ?? 0)} to ${league.next.name}` : ' · top league'}
            </div>
          </div>
          <button onClick={onNavigateWardrobe} className="shrink-0 self-start px-2.5 py-1 rounded-full bg-white/10 text-[10px] font-black text-white/70">
            STYLE
          </button>
        </div>
      </div>

      {/* Featured */}
      <button
        onClick={() => setSheet('brick-blitz')}
        className="w-full relative overflow-hidden rounded-3xl p-5 text-left shadow-xl active:scale-[0.99] transition-transform"
        style={{ background: `linear-gradient(135deg, ${TILES['brick-blitz'].from}, ${TILES['brick-blitz'].to})` }}
        data-testid="featured-game"
      >
        <div className="absolute -right-6 -bottom-8 text-[140px] leading-none opacity-25 select-none">▦</div>
        <span className="inline-block px-2 py-0.5 rounded-full bg-black/30 text-white text-[10px] font-black tracking-widest">FEATURED · NEW</span>
        <h2 className="mt-2 text-3xl font-black italic text-white drop-shadow">BRICK BLITZ</h2>
        <p className="text-sm text-white/85 max-w-xs">Aim, launch and smash the wall. Same bricks for every player — pure skill.</p>
        <span className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-black text-sm font-black">
          <Play className="w-4 h-4 fill-black" /> PLAY NOW
        </span>
      </button>

      {/* Game grid */}
      <div>
        <div className="flex items-end justify-between mb-2.5">
          <h2 className="text-base font-black text-white tracking-wider">GAMES</h2>
          <span className="text-[11px] text-white/40 font-bold">Same seed for both players · skill decides</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {GAME_IDS.map((id) => {
            const g = TILES[id];
            const best = userState.stats.highScores[id] || 0;
            return (
              <button
                key={id}
                onClick={() => {
                  sound.playTap();
                  setSheet(id);
                }}
                className="relative aspect-[4/5] overflow-hidden rounded-3xl p-3 text-left flex flex-col justify-end shadow-lg active:scale-[0.97] transition-transform"
                style={{ background: `linear-gradient(160deg, ${g.from}, ${g.to})` }}
                data-testid={`tile-${id}`}
              >
                <span className="absolute top-2 right-3 text-6xl opacity-30 select-none">{g.glyph}</span>
                {g.isNew && <span className="absolute top-3 left-3 px-2 py-0.5 rounded-full bg-white text-black text-[9px] font-black">NEW</span>}
                <span className="text-[10px] font-black tracking-widest text-white/70 uppercase">{g.genre}</span>
                <span className="text-lg font-black italic text-white leading-tight">{g.title}</span>
                <span className="text-[10px] font-bold text-white/70 mt-0.5" suppressHydrationWarning>
                  BEST {best.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mode sheet */}
      {tile && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setSheet(null)} data-testid="mode-sheet">
          <div
            className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#0e1018] border border-white/10 pb-[max(env(safe-area-inset-bottom),16px)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative p-5 pb-4" style={{ background: `linear-gradient(160deg, ${tile.from}, ${tile.to})` }}>
              <button onClick={() => setSheet(null)} aria-label="Close" className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/30 flex items-center justify-center text-white">
                <X className="w-5 h-5" />
              </button>
              <span className="text-[10px] font-black tracking-widest text-white/70 uppercase">{tile.genre}</span>
              <h3 className="text-3xl font-black italic text-white">{tile.title}</h3>
              <p className="text-xs text-white/85 mt-0.5 max-w-[85%]">{tile.blurb}</p>
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
                      className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/10 text-left active:scale-[0.98] transition-transform disabled:opacity-40"
                      data-testid={`mode-${m.mode}`}
                    >
                      <span className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-black" style={{ background: m.color }}>
                        {m.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-base font-black text-white">{m.title}</span>
                          {m.paid && (
                            <span className="px-1.5 py-0.5 rounded bg-black/40 text-[10px] font-black text-amber-300">{stake === 0 ? 'FREE' : `${stake} ENTRY`}</span>
                          )}
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
