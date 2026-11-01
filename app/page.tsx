'use client';

import React, { useState } from 'react';
import { SEASON_TIERS, useUserStore } from '@/lib/user-store';
import { leagueFor, LEAGUES } from '@/lib/game-types';
import { sound } from '@/lib/sound';
import GameLibraryView from '@/components/games/GameLibraryView';
import TournamentView from '@/components/tournaments/TournamentView';
import DressingRoom from '@/components/wardrobe/DressingRoom';
import LeaderboardView from '@/components/leaderboards/LeaderboardView';
import StoreView from '@/components/store/StoreView';
import ProfileView from '@/components/profile/ProfileView';
import ResultsView from '@/components/results/ResultsView';
import AvatarView from '@/components/avatar/AvatarView';
import { Trophy, Crown, Gamepad2, Gift, CircleUser, Plus } from 'lucide-react';

type Tab = 'results' | 'leagues' | 'play' | 'rewards' | 'profile';

const DISPLAY = { fontFamily: "'Lilita One', system-ui, sans-serif" };

/** Gold crown with a soft highlight (header badge). */
function CrownBadge() {
  return (
    <svg viewBox="0 0 48 40" className="w-11 h-9 drop-shadow-[0_2px_6px_rgba(250,204,21,0.35)]" aria-hidden>
      <defs>
        <linearGradient id="hdr-crown" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <path d="M4 14 L14 22 L24 4 L34 22 L44 14 L40 34 H8 Z" fill="url(#hdr-crown)" stroke="#92400e" strokeWidth="2" strokeLinejoin="round" />
      <rect x="8" y="31" width="32" height="6" rx="2" fill="#f59e0b" stroke="#92400e" strokeWidth="2" />
      <circle cx="24" cy="4" r="3" fill="#fef3c7" />
      <circle cx="4" cy="14" r="2.6" fill="#fef3c7" />
      <circle cx="44" cy="14" r="2.6" fill="#fef3c7" />
    </svg>
  );
}

/** Stack of Rival Coins (header balance). */
function CoinStack() {
  return (
    <svg viewBox="0 0 40 32" className="w-9 h-7" aria-hidden>
      {[18, 12, 6].map((y, i) => (
        <g key={y}>
          <ellipse cx={18 + i * 2} cy={y + 6} rx="13" ry="5" fill="#b45309" />
          <rect x={5 + i * 2} y={y} width="26" height="6" fill="#d97706" />
          <ellipse cx={18 + i * 2} cy={y} rx="13" ry="5" fill="#fbbf24" stroke="#92400e" strokeWidth="1.2" />
          <text x={18 + i * 2} y={y + 2.4} textAnchor="middle" fontSize="6" fontWeight="900" fill="#92400e">
            R
          </text>
        </g>
      ))}
    </svg>
  );
}

function Segments<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string }[] }) {
  return (
    <div className="flex p-1 rounded-full bg-white/[0.07] mb-4" role="tablist">
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={value === it.id}
          onClick={() => {
            sound.playTap();
            onChange(it.id);
          }}
          className={`flex-1 h-10 rounded-full text-sm font-black transition-colors ${value === it.id ? 'bg-white text-black' : 'text-white/60'}`}
          data-testid={`seg-${it.id}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>('play');
  const [leagueSeg, setLeagueSeg] = useState<'cups' | 'rankings'>('cups');
  const [profileSeg, setProfileSeg] = useState<'profile' | 'wardrobe'>('profile');
  const userState = useUserStore();
  const crowns = userState.stats.crowns ?? 0;
  const league = leagueFor(crowns);

  const go = (t: Tab) => {
    sound.playTap();
    setTab(t);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cupBadge = userState.tournaments.some((t) => t.result && !t.result.claimed);
  const passBadge = SEASON_TIERS.some((t) => userState.seasonXp >= t.xpRequired && !userState.claimedFreeTiers.includes(t.tier));
  const questBadge = userState.quests.some((q) => q.completed && !q.claimed);

  const NAV: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: boolean }[] = [
    { id: 'results', label: 'Results', icon: Trophy },
    { id: 'leagues', label: 'Leagues', icon: Crown, badge: cupBadge },
    { id: 'play', label: 'Play', icon: Gamepad2 },
    { id: 'rewards', label: 'Rewards', icon: Gift, badge: passBadge },
    { id: 'profile', label: 'Profile', icon: CircleUser, badge: questBadge },
  ];

  return (
    <div className="min-h-[100dvh] bg-[#0b0b10] text-slate-100 flex flex-col pb-[calc(84px+env(safe-area-inset-bottom))]">
      {/* Ambient glow behind the header, like light spilling from the game art */}
      <div className="pointer-events-none fixed inset-x-0 top-0 h-56 z-0 bg-[radial-gradient(60%_80%_at_15%_0%,rgba(234,88,12,0.28),transparent_70%),radial-gradient(60%_80%_at_85%_0%,rgba(132,204,22,0.22),transparent_70%)]" />

      {/* Header: crown progress + coin balance */}
      <header className="sticky top-0 z-40 h-16 px-4 pt-[env(safe-area-inset-top)] flex items-center justify-between bg-[#0b0b10]/70 backdrop-blur-xl">
        <button onClick={() => go('leagues')} className="flex items-center gap-2 min-w-0" aria-label={`${league.name} league, ${crowns} crowns`} data-testid="hdr-crowns">
          <CrownBadge />
          <span className="relative w-28 sm:w-40 h-3.5 rounded-full bg-black/50 ring-1 ring-white/10 overflow-hidden">
            <span className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-500 to-cyan-300 shadow-[0_0_10px_rgba(56,189,248,0.6)]" style={{ width: `${Math.max(6, Math.round(league.progress * 100))}%` }} />
          </span>
          <span className="text-xl font-black text-white tabular-nums" suppressHydrationWarning>
            {crowns}
          </span>
        </button>
        <button onClick={() => go('rewards')} className="flex items-center gap-1.5 h-11 pl-1.5 pr-2 rounded-full bg-black/45 ring-1 ring-white/10" aria-label="Rival Coins balance" data-testid="hdr-coins">
          <CoinStack />
          <span className="text-lg font-black text-white tabular-nums px-1" suppressHydrationWarning>
            {userState.stats.coins.toLocaleString()}
          </span>
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-emerald-400">
            <Plus className="w-5 h-5 stroke-[3]" />
          </span>
        </button>
      </header>

      <main className="relative flex-1 w-full max-w-5xl mx-auto pt-2">
        {tab === 'play' && <GameLibraryView />}

        {tab === 'results' && <ResultsView onPlay={() => go('play')} />}

        {tab === 'leagues' && (
          <div className="px-4 max-w-3xl mx-auto">
            <div className="relative overflow-hidden rounded-3xl p-4 mb-4 ring-1 ring-white/10" style={{ background: `radial-gradient(120% 120% at 0% 0%, ${league.color}40, #12121b 60%)` }} data-testid="league-card">
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-2xl bg-black/40 flex items-center justify-center ring-1 ring-white/10">
                  <AvatarView avatar={userState.avatar} size={70} animate={false} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-2xl leading-none" style={{ ...DISPLAY, color: league.color }} data-testid="league-name">
                    {league.name.toUpperCase()} LEAGUE
                  </div>
                  <div className="mt-2 h-2.5 rounded-full bg-black/40 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.round(league.progress * 100)}%`, background: league.color }} />
                  </div>
                  <div className="mt-1 text-[11px] font-bold text-white/55" suppressHydrationWarning>
                    {crowns} crowns{league.next ? ` · ${league.next.crowns - crowns} to ${league.next.name}` : ' · top league'}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex gap-1">
                {LEAGUES.map((l, i) => (
                  <div key={l.name} className="flex-1 text-center">
                    <div className={`h-1.5 rounded-full ${i <= league.index ? '' : 'opacity-25'}`} style={{ background: l.color }} />
                    <div className={`mt-1 text-[9px] font-black ${i === league.index ? 'text-white' : 'text-white/35'}`}>{l.name.toUpperCase()}</div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-white/50">Earn crowns by winning 1v1s (+1), placing 1st/2nd in Live Arenas (+2/+1) and completing Streaks (+3).</p>
            </div>
            <Segments
              value={leagueSeg}
              onChange={setLeagueSeg}
              items={[
                { id: 'cups', label: 'Cups' },
                { id: 'rankings', label: 'Rankings' },
              ]}
            />
          </div>
        )}
        {tab === 'leagues' && leagueSeg === 'cups' && <TournamentView />}
        {tab === 'leagues' && leagueSeg === 'rankings' && <LeaderboardView />}

        {tab === 'rewards' && <StoreView />}

        {tab === 'profile' && (
          <div className="px-4 max-w-3xl mx-auto">
            <Segments
              value={profileSeg}
              onChange={setProfileSeg}
              items={[
                { id: 'profile', label: 'Profile' },
                { id: 'wardrobe', label: 'Wardrobe' },
              ]}
            />
          </div>
        )}
        {tab === 'profile' && profileSeg === 'profile' && <ProfileView />}
        {tab === 'profile' && profileSeg === 'wardrobe' && <DressingRoom />}
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-[#0b0b10]/95 backdrop-blur-xl border-t border-white/5 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-xl mx-auto grid grid-cols-5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const on = tab === item.id;
            return (
              <button key={item.id} onClick={() => go(item.id)} className={`relative flex flex-col items-center gap-1 pt-2.5 pb-2 ${on ? 'text-white' : 'text-white/45'}`} aria-current={on ? 'page' : undefined}>
                <span className="relative">
                  <Icon className={`w-7 h-7 ${on ? 'stroke-[2.4]' : 'stroke-[1.9]'}`} />
                  {item.badge && (
                    <span className="absolute -top-1.5 -right-2.5 w-4 h-4 rounded-full bg-rose-500 ring-2 ring-[#0b0b10] text-[9px] font-black flex items-center justify-center text-white" aria-label="new">
                      !
                    </span>
                  )}
                </span>
                <span className={`text-[12px] ${on ? 'font-black' : 'font-semibold'}`}>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
