'use client';

import React, { useState } from 'react';
import { timeAgo, useUserStore } from '@/lib/user-store';
import { AvatarConfig } from '@/lib/avatar-types';
import { getStarterAvatar } from '@/lib/cosmetics-catalog';
import AvatarView from '@/components/avatar/AvatarView';
import { sound } from '@/lib/sound';
import { Trophy, Flame } from 'lucide-react';

interface LeaderboardPlayer {
  rank: number;
  name: string;
  avatar: AvatarConfig;
  rating: number;
  tier: string;
  winRate: number;
  streak: number;
  isUser?: boolean;
}

const GLOBAL_LEADERBOARD: LeaderboardPlayer[] = [
  {
    rank: 1,
    name: 'PhantomZero',
    avatar: getStarterAvatar('female'),
    rating: 2340,
    tier: 'Apex',
    winRate: 84,
    streak: 14,
  },
  {
    rank: 2,
    name: 'ViperX',
    avatar: getStarterAvatar('male'),
    rating: 2180,
    tier: 'Apex',
    winRate: 78,
    streak: 9,
  },
  {
    rank: 3,
    name: 'ChromaQueen',
    avatar: getStarterAvatar('female'),
    rating: 2050,
    tier: 'Master',
    winRate: 76,
    streak: 6,
  },
  {
    rank: 4,
    name: 'NeonStriker',
    avatar: getStarterAvatar('neutral'),
    rating: 1940,
    tier: 'Master',
    winRate: 72,
    streak: 4,
  },
  {
    rank: 5,
    name: 'ApexRival (You)',
    avatar: getStarterAvatar('neutral'),
    rating: 1250,
    tier: 'Silver',
    winRate: 72,
    streak: 3,
    isUser: true,
  },
  {
    rank: 6,
    name: 'OrbitSurge',
    avatar: getStarterAvatar('male'),
    rating: 1210,
    tier: 'Silver',
    winRate: 61,
    streak: 2,
  },
  {
    rank: 7,
    name: 'SubZero_Kid',
    avatar: getStarterAvatar('male'),
    rating: 1180,
    tier: 'Silver',
    winRate: 59,
    streak: 1,
  },
  {
    rank: 8,
    name: 'PulseDrift',
    avatar: getStarterAvatar('female'),
    rating: 1120,
    tier: 'Bronze',
    winRate: 54,
    streak: 0,
  },
];

export default function LeaderboardView() {
  const userState = useUserStore();
  const [activeTab, setActiveTab] = useState<'global' | 'leagues' | 'history'>('global');

  const totalMatches = userState.stats.wins + userState.stats.losses;
  const userWinRate = totalMatches > 0 ? Math.round((userState.stats.wins / totalMatches) * 100) : 0;

  // Sync user state into leaderboard entry
  const displayPlayers = GLOBAL_LEADERBOARD.map((p) => {
    if (p.isUser) {
      return {
        ...p,
        name: `${userState.username} (You)`,
        avatar: userState.avatar,
        rating: userState.stats.rating,
        tier: userState.stats.tier,
        winRate: userWinRate,
        streak: userState.stats.streak,
      };
    }
    return p;
  }).sort((a, b) => b.rating - a.rating).map((p, idx) => ({ ...p, rank: idx + 1 }));

  return (
    <div className="w-full max-w-5xl mx-auto p-4 space-y-6">
      {/* Top Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#181a29] to-[#12131d] border border-[#242738] p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2 text-xs font-black uppercase tracking-widest text-cyan-400">
              <Trophy className="w-4 h-4" /> COMPETITIVE STANDINGS
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-white italic">
              GLOBAL RANKINGS & LEAGUES
            </h1>
            <p className="text-xs md:text-sm text-slate-300 max-w-xl mt-1">
              Skill rating updates authoritatively after every 1v1 duel and competition. Climb from Bronze to Apex Champion!
            </p>
          </div>

          {/* User Rank Card */}
          <div className="flex items-center gap-4 bg-[#0a0b12] p-3.5 rounded-xl border border-[#242738]">
            <AvatarView avatar={userState.avatar} size={50} />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">{userState.username}</span>
                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-600/50">
                  {userState.stats.tier}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                <span className="font-mono text-cyan-400 font-bold">{userState.stats.rating} Elo</span>
                <span>·</span>
                <span className="text-emerald-400 font-bold">{userWinRate}% Win</span>
                <span>·</span>
                <span className="flex items-center gap-0.5 text-orange-400 font-bold">
                  <Flame className="w-3.5 h-3.5" /> {userState.stats.streak} Streak
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[#242738] pb-2">
        {[
          { id: 'global', label: 'Global Leaderboard' },
          { id: 'leagues', label: 'League Tiers' },
          { id: 'history', label: 'My Match History' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              sound.playTap();
              setActiveTab(tab.id as 'global' | 'leagues' | 'history');
            }}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors ${
              activeTab === tab.id
                ? 'bg-cyan-500 text-black'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Global Leaderboard */}
      {activeTab === 'global' && (
        <div className="bg-[#12131d] border border-[#242738] rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-[#242738] grid grid-cols-12 text-xs font-bold uppercase tracking-wider text-slate-400">
            <div className="col-span-1 text-center">#</div>
            <div className="col-span-5">Player & Avatar</div>
            <div className="col-span-2 text-center">Tier</div>
            <div className="col-span-2 text-center">Win Rate</div>
            <div className="col-span-2 text-right">Skill Rating</div>
          </div>

          <div className="divide-y divide-[#1e202f]">
            {displayPlayers.map((player) => (
              <div
                key={player.name}
                className={`p-4 grid grid-cols-12 items-center text-xs transition-colors ${
                  player.isUser
                    ? 'bg-cyan-950/25 border-l-4 border-cyan-400'
                    : 'hover:bg-[#161826]'
                }`}
              >
                {/* Rank Number */}
                <div className="col-span-1 text-center font-mono font-black text-sm">
                  {player.rank === 1 ? (
                    <span className="text-amber-400">🥇 1</span>
                  ) : player.rank === 2 ? (
                    <span className="text-slate-300">🥈 2</span>
                  ) : player.rank === 3 ? (
                    <span className="text-amber-600">🥉 3</span>
                  ) : (
                    <span className="text-slate-500">#{player.rank}</span>
                  )}
                </div>

                {/* Player & Avatar */}
                <div className="col-span-5 flex items-center gap-2 sm:gap-3 min-w-0">
                  <AvatarView avatar={player.avatar} size={42} animate={false} className="shrink-0" />
                  <div className="min-w-0">
                    <span className={`font-bold text-xs sm:text-sm block truncate ${player.isUser ? 'text-cyan-400' : 'text-white'}`}>
                      {player.name}
                    </span>
                    <span className="text-[11px] text-slate-400 flex items-center gap-1 whitespace-nowrap">
                      <Flame className="w-3 h-3 text-orange-400" /> {player.streak}<span className="hidden sm:inline"> win streak</span>
                    </span>
                  </div>
                </div>

                {/* Tier */}
                <div className="col-span-2 text-center">
                  <span className="px-1.5 sm:px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-black uppercase bg-[#1a1c2b] text-slate-300 border border-[#2b2e45]">
                    {player.tier}
                  </span>
                </div>

                {/* Win Rate */}
                <div className="col-span-2 text-center font-mono font-bold text-emerald-400">
                  {player.winRate}%
                </div>

                {/* Elo Rating */}
                <div className="col-span-2 text-right font-mono font-black text-white text-sm">
                  {player.rating} <span className="text-xs text-slate-400 font-normal">Elo</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: League Tiers */}
      {activeTab === 'leagues' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { name: 'Bronze', elo: '0 - 999', desc: 'Rookie arcade circuit. Learn mechanics and timing.', color: '#b45309' },
            { name: 'Silver', elo: '1,000 - 1,199', desc: 'Certified contenders. Sharp reflexes and combo streaks.', color: '#94a3b8' },
            { name: 'Gold', elo: '1,200 - 1,399', desc: 'Tournament tier. Precision shots and high-velocity runs.', color: '#eab308' },
            { name: 'Platinum', elo: '1,400 - 1,599', desc: 'Elite skill tier. Dominant swishes and zero mistakes.', color: '#38bdf8' },
            { name: 'Diamond', elo: '1,600 - 1,799', desc: 'Grandmaster class. Apex APM and flawless cascades.', color: '#818cf8' },
            { name: 'Apex Champion', elo: '2,000+', desc: 'Hall of Fame. Crown holders and global record setters.', color: '#f43f5e' },
          ].map((lg) => {
            const isCurrent = userState.stats.tier.toLowerCase() === lg.name.toLowerCase().split(' ')[0];
            return (
              <div
                key={lg.name}
                className={`p-5 rounded-2xl border flex flex-col justify-between ${
                  isCurrent
                    ? 'border-cyan-400 bg-[#161928] shadow-lg shadow-cyan-500/10'
                    : 'border-[#242738] bg-[#12131d]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-black text-lg text-white" style={{ color: lg.color }}>
                      {lg.name}
                    </h3>
                    {isCurrent && (
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-cyan-500 text-black">
                        CURRENT TIER
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-mono text-slate-400 block mb-2">{lg.elo} Skill Rating</span>
                  <p className="text-xs text-slate-300">{lg.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab: Match History */}
      {activeTab === 'history' && (
        <div className="bg-[#12131d] border border-[#242738] rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-[#242738] text-xs font-bold uppercase tracking-wider text-slate-400">
            RECENT MATCHES
          </div>
          <div className="divide-y divide-[#1e202f]">
            {userState.matchHistory.map((m) => (
              <div key={m.id} className="p-4 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center font-black uppercase text-xs ${
                      m.result === 'win'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : m.mode === 'tournament'
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                        : m.result === 'tie'
                        ? 'bg-slate-600/30 text-slate-300 border border-slate-500'
                        : m.result === 'practice'
                        ? 'bg-slate-700/30 text-slate-400 border border-slate-700'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                    }`}
                  >
                    {m.mode === 'tournament' ? 'C' : m.result === 'win' ? 'W' : m.result === 'tie' ? 'T' : m.result === 'practice' ? 'P' : 'L'}
                  </div>
                  <div>
                    <span className="font-bold text-sm text-white block">{m.gameName}</span>
                    <span className="text-slate-400 text-[11px]">
                      {m.mode === 'practice' ? 'Practice run' : m.mode === 'tournament' ? m.opponentName.replace(/ #\d+$/, '') : `vs ${m.opponentName}`} · {m.at ? timeAgo(m.at) : m.date}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <span className="font-mono font-black text-white text-sm block">
                      {m.playerScore}
                      {m.mode === 'duel' && (
                        <>
                          {' '}
                          <span className="text-slate-500 text-xs">vs</span> {m.opponentScore}
                        </>
                      )}
                    </span>
                    <span
                      className={`text-[11px] font-bold ${
                        m.ratingDelta > 0 ? 'text-emerald-400' : m.ratingDelta < 0 ? 'text-rose-400' : 'text-slate-400'
                      }`}
                    >
                      {m.mode === 'duel' ? (m.ratingDelta > 0 ? `+${m.ratingDelta} Elo` : m.ratingDelta < 0 ? `${m.ratingDelta} Elo` : '±0 Elo') : m.mode === 'tournament' ? 'Cup run' : 'Practice'}
                    </span>
                  </div>
                  <div className="text-amber-400 font-mono font-bold text-xs">
                    +{m.coinsEarned} Coins
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
