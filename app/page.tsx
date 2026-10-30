'use client';

import React, { useState, useEffect } from 'react';
import { useUserStore } from '@/lib/user-store';
import { sound, useMuted } from '@/lib/sound';
import GameLibraryView from '@/components/games/GameLibraryView';
import TournamentView from '@/components/tournaments/TournamentView';
import DressingRoom from '@/components/wardrobe/DressingRoom';
import LeaderboardView from '@/components/leaderboards/LeaderboardView';
import StoreView from '@/components/store/StoreView';
import ProfileView from '@/components/profile/ProfileView';
import AvatarView from '@/components/avatar/AvatarView';
import {
  Gamepad2,
  Trophy,
  Shirt,
  BarChart3,
  Sparkles,
  User,
  Coins,
  Volume2,
  VolumeX,
} from 'lucide-react';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'games' | 'tournaments' | 'wardrobe' | 'ranks' | 'store' | 'profile'>('games');
  const userState = useUserStore();
  const isMuted = useMuted();

  const handleTabChange = (tab: typeof activeTab) => {
    sound.playTap();
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleSound = () => {
    sound.toggleMute();
  };

  return (
    <div className="min-h-screen bg-[#0a0b10] text-slate-100 flex flex-col pb-20 md:pb-6">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-40 w-full bg-[#0e1018]/90 backdrop-blur-md border-b border-[#242738] px-4 py-2.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          {/* Brand Logo */}
          <div
            onClick={() => handleTabChange('games')}
            className="flex items-center gap-2 cursor-pointer select-none"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-black text-black shadow-md shadow-cyan-500/20 text-sm">
              R
            </div>
            <div className="leading-tight">
              <span className="font-black text-base tracking-wider text-white italic">
                RIVAL<span className="text-cyan-400">ARCADE</span>
              </span>
              <span className="text-[9px] uppercase tracking-widest text-slate-400 block font-bold -mt-0.5">
                SKILL ARENA
              </span>
            </div>
          </div>

          {/* User Currency, Trophies & Quick Avatar */}
          <div className="flex items-center gap-3">
            {/* Coins */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#141624] border border-[#242738] text-xs font-mono font-bold text-amber-400">
              <Coins className="w-3.5 h-3.5" />
              <span suppressHydrationWarning>{userState.stats.coins}</span>
            </div>

            {/* Trophies */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#141624] border border-[#242738] text-xs font-mono font-bold text-cyan-400">
              <Trophy className="w-3.5 h-3.5" />
              <span suppressHydrationWarning>{userState.stats.trophies}</span>
            </div>

            {/* Audio Toggle */}
            <button
              onClick={toggleSound}
              className="p-1.5 rounded-lg bg-[#141624] border border-[#242738] text-slate-400 hover:text-white transition-colors"
              title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
            </button>

            {/* Quick Avatar Avatar Preview in Header */}
            <button
              onClick={() => handleTabChange('wardrobe')}
              className="relative w-8 h-8 rounded-full bg-[#161826] border border-cyan-400 overflow-hidden flex items-center justify-center shadow-md shadow-cyan-500/20 hover:scale-105 transition-transform"
              title="Open Dressing Room"
            >
              <AvatarView avatar={userState.avatar} size={42} animate={false} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-5xl mx-auto pt-3">
        {activeTab === 'games' && (
          <GameLibraryView onNavigateWardrobe={() => handleTabChange('wardrobe')} />
        )}
        {activeTab === 'tournaments' && <TournamentView />}
        {activeTab === 'wardrobe' && <DressingRoom />}
        {activeTab === 'ranks' && <LeaderboardView />}
        {activeTab === 'store' && <StoreView />}
        {activeTab === 'profile' && <ProfileView />}
      </main>

      {/* Mobile-First Persistent Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#0e1018]/95 backdrop-blur-lg border-t border-[#242738] px-2 py-1">
        <div className="max-w-md mx-auto flex items-center justify-around">
          {[
            { id: 'games', label: 'Games', icon: Gamepad2 },
            { id: 'tournaments', label: 'Arena', icon: Trophy },
            { id: 'wardrobe', label: 'Wardrobe', icon: Shirt },
            { id: 'ranks', label: 'Rankings', icon: BarChart3 },
            { id: 'store', label: 'Pass', icon: Sparkles },
            { id: 'profile', label: 'Profile', icon: User },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleTabChange(item.id as typeof activeTab)}
                className={`flex flex-col items-center py-1.5 px-3 rounded-xl transition-all ${
                  isActive
                    ? 'text-cyan-400 font-bold scale-105'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
                <span className="text-[10px] mt-0.5 tracking-tight">{item.label}</span>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 -mb-1 mt-0.5" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
