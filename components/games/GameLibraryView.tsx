'use client';

import React, { useState } from 'react';
import { userStore, useUserStore } from '@/lib/user-store';
import AvatarView from '@/components/avatar/AvatarView';
import GameModal from './GameModal';
import { sound } from '@/lib/sound';
import { Play, Swords, Flame, Sparkles } from 'lucide-react';

interface GameItem {
  id: 'neon-dash' | 'dunk-rush' | 'cyber-reflex' | 'gem-surge';
  title: string;
  category: string;
  tagline: string;
  avatarRole: string;
  accentColor: string;
  badge: string;
  controls: string;
  highScoreUnit: string;
}

const GAMES_CATALOG: GameItem[] = [
  {
    id: 'neon-dash',
    title: 'Neon Dash 3D',
    category: '3D 3-Lane Endless Runner',
    tagline: 'High-speed 3D rooftop highway sprint with swipe lane shifting, jumping, and sliding.',
    avatarRole: 'Your 3D custom avatar runs, jumps, slides, and leaves equipped particle spark trails.',
    accentColor: '#00f0ff',
    badge: 'Real 3D',
    controls: 'Swipe Left/Right, Swipe Up to Jump, Swipe Down to Slide',
    highScoreUnit: 'PTS',
  },
  {
    id: 'dunk-rush',
    title: 'Dunk Rush 3D',
    category: '3D Basketball Arena Shootout',
    tagline: '45-second timed 3D swish shootout with moving backboards and trajectory physics.',
    avatarRole: '3D Avatar holds court, shoots with true trajectory arc, and celebrates swishes.',
    accentColor: '#ea580c',
    badge: 'Drag & Shoot 3D',
    controls: 'Touch drag backward to aim 3D power arc, release to shoot',
    highScoreUnit: 'PTS',
  },
  {
    id: 'cyber-reflex',
    title: 'Cyber Reflex 3D',
    category: '3D Orbital Reaction Matrix',
    tagline: 'Deflect rapid 3D orbital holographic nodes and avoid red hazard mines.',
    avatarRole: '3D Avatar stands at the central command platform projecting 3D energy shields.',
    accentColor: '#00f0ff',
    badge: '3D Slashing',
    controls: 'Tap or slide across 3D orbiting nodes with precision timing',
    highScoreUnit: 'PTS',
  },
  {
    id: 'gem-surge',
    title: 'Gem Surge 3D',
    category: '3D Cascading Polyhedron Puzzle',
    tagline: '60-second score-attack 3D crystal cascade match-3 with dynamic lighting.',
    avatarRole: '3D Avatar stands stage-side cheering combo cascades and 3D crystal blasts.',
    accentColor: '#a855f7',
    badge: '3D Slide & Swap',
    controls: 'Drag & slide adjacent 3D crystals to trigger combo chains',
    highScoreUnit: 'PTS',
  },
];

export default function GameLibraryView({ onNavigateWardrobe }: { onNavigateWardrobe: () => void }) {
  const userState = useUserStore();
  const [activeGame, setActiveGame] = useState<{
    gameId: 'neon-dash' | 'dunk-rush' | 'cyber-reflex' | 'gem-surge';
    mode: 'practice' | 'duel';
  } | null>(null);

  const handleLaunch = (gameId: GameItem['id'], mode: 'practice' | 'duel') => {
    sound.playTap();
    setActiveGame({ gameId, mode });
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-4 space-y-6">
      {/* Featured Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#171926] via-[#11121d] to-[#0a0b12] border border-[#242738] p-6 shadow-xl">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-3 max-w-xl text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2">
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                Playable Avatars Everywhere
              </span>
              <span className="text-xs text-amber-400 font-bold flex items-center gap-1">
                <Flame className="w-3.5 h-3.5" /> 1v1 Skill Duels Active
              </span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-black text-white italic tracking-tight leading-none">
              RIVAL ARCADE
            </h1>

            <p className="text-xs sm:text-sm text-slate-300">
              Welcome back, <span className="text-cyan-400 font-bold">{userState.username}</span>! Jump into free practice to master mechanics or enter 1v1 ranked matches with your playable custom avatar.
            </p>

            <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 pt-1">
              <button
                onClick={() => handleLaunch('neon-dash', 'duel')}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-extrabold text-xs rounded-xl shadow-lg shadow-cyan-500/20 transition-transform active:scale-95"
              >
                <Swords className="w-4 h-4" /> QUICK 1V1 DUEL
              </button>
              <button
                onClick={onNavigateWardrobe}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#181a27] hover:bg-[#202334] text-slate-200 font-bold text-xs rounded-xl border border-[#2f334a] transition-colors"
              >
                <Sparkles className="w-4 h-4 text-amber-400" /> CUSTOMIZE AVATAR
              </button>
            </div>
          </div>

          {/* User's Avatar Spotlight */}
          <div className="flex flex-col items-center">
            <div className="relative w-32 h-32 sm:w-36 sm:h-36 bg-[#080911] rounded-2xl border border-cyan-500/30 flex items-center justify-center shadow-xl shadow-cyan-500/10">
              <AvatarView
                avatar={userState.avatar}
                size={135}
                action="idle"
                animate={true}
              />
              <span className="absolute -bottom-2 px-2.5 py-0.5 rounded-full bg-cyan-500 text-black text-[10px] font-black uppercase tracking-wider shadow">
                {userState.stats.tier} · {userState.stats.rating}
              </span>
            </div>
            <span className="text-[11px] font-bold text-slate-400 mt-3">
              {userState.avatar.gender === 'female' ? 'Female Character' : userState.avatar.gender === 'male' ? 'Male Character' : 'Neutral Character'}
            </span>
          </div>
        </div>
      </div>

      {/* Game Catalog Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-white uppercase tracking-wider">
              SKILL GAMES ARENA
            </h2>
            <p className="text-xs text-slate-400">
              Pick a game to practice freely or duel real opponents on certified fair seeds.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {GAMES_CATALOG.map((game) => {
            const userHighScore = userState.stats.highScores[game.id] || 0;
            return (
              <div
                key={game.id}
                className="relative flex flex-col justify-between p-5 rounded-2xl border border-[#242738] bg-[#12131d] hover:border-slate-600 transition-all shadow-lg"
              >
                {/* Header */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {game.category}
                    </span>
                    <span className="text-[10px] font-mono text-amber-400 font-bold">
                      BEST: {userHighScore} {game.highScoreUnit}
                    </span>
                  </div>

                  <h3 className="text-xl font-black text-white mb-1">{game.title}</h3>
                  <p className="text-xs text-slate-300 mb-2">{game.tagline}</p>

                  {/* Avatar Integration Callout */}
                  <div className="p-2.5 rounded-lg bg-[#0a0b12] border border-[#1e202f] mb-3">
                    <span className="text-[10px] uppercase font-bold text-cyan-400 block mb-0.5">
                      🎮 3D Avatar Integration
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {game.avatarRole}
                    </span>
                  </div>

                  {/* Controls Callout */}
                  <div className="text-[11px] text-amber-400/90 font-mono mb-3">
                    <span className="font-bold text-amber-300">Controls:</span> {game.controls}
                  </div>
                </div>

                {/* Bottom Action Buttons */}
                <div className="flex items-center gap-2 pt-2 border-t border-[#1e202f]">
                  <button
                    onClick={() => handleLaunch(game.id, 'practice')}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-[#181a27] hover:bg-[#202334] text-slate-300 font-bold text-xs rounded-xl border border-[#2f334a] transition-colors active:scale-95"
                  >
                    <Play className="w-3.5 h-3.5" /> FREE PRACTICE
                  </button>
                  <button
                    onClick={() => handleLaunch(game.id, 'duel')}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-extrabold text-xs rounded-xl shadow-md shadow-cyan-500/20 transition-transform active:scale-95"
                  >
                    <Swords className="w-3.5 h-3.5" /> 1V1 DUEL
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Game Modal */}
      {activeGame && (
        <GameModal
          gameId={activeGame.gameId}
          mode={activeGame.mode}
          onClose={() => setActiveGame(null)}
        />
      )}
    </div>
  );
}
