'use client';

import React, { useState, useEffect } from 'react';
import { userStore, useUserStore } from '@/lib/user-store';
import AvatarView from '@/components/avatar/AvatarView';
import { sound, useMuted } from '@/lib/sound';
import { formatCountdown, msUntilLocalMidnight } from '@/lib/quests';
import { detectDeviceTier, getQualityOverride, setQualityOverride, QualityTier } from '@/lib/engine/quality';
import { Trophy, Flame, Coins, Edit2, Check, Settings, Volume2, VolumeX, MonitorSmartphone, RotateCcw, X } from 'lucide-react';

type QualityChoice = 'auto' | QualityTier;

export default function ProfileView() {
  const userState = useUserStore();
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [resetLeft, setResetLeft] = useState<number | null>(null);
  // Profile only mounts client-side (it's never the first tab), so reading storage here is safe.
  const [quality, setQuality] = useState<QualityChoice>(() => getQualityOverride() ?? 'auto');
  const [detectedTier] = useState<QualityTier>(() => detectDeviceTier());
  const [confirmReset, setConfirmReset] = useState(false);
  const isMuted = useMuted();

  // Daily quest reset countdown; also rolls quests over at local midnight while open.
  useEffect(() => {
    const tick = () => {
      setResetLeft(msUntilLocalMidnight(Date.now()));
      userStore.ensureDaily();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const chooseQuality = (q: QualityChoice) => {
    sound.playTap();
    setQuality(q);
    setQualityOverride(q === 'auto' ? null : q);
    triggerToast(q === 'auto' ? 'Graphics set to automatic' : `Graphics set to ${q}`);
  };

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleSaveName = () => {
    if (userStore.setUsername(nameInput)) {
      sound.playTap();
      setIsEditingName(false);
      triggerToast('Player handle updated!');
    } else {
      sound.playLose();
      triggerToast('Use letters, numbers, spaces, - _ or .');
    }
  };

  const handleClaimQuest = (questId: string) => {
    sound.playPowerup();
    userStore.claimQuest(questId);
    triggerToast('Quest reward claimed!');
  };

  const totalMatches = userState.stats.wins + userState.stats.losses;
  const winRate = totalMatches > 0 ? Math.round((userState.stats.wins / totalMatches) * 100) : 0;

  return (
    <div className="w-full max-w-5xl mx-auto p-4 space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 bg-cyan-400 text-black font-extrabold px-4 py-2 rounded-lg shadow-xl shadow-cyan-500/30 flex items-center gap-2 animate-in slide-in-from-top-4 duration-200">
          {toastMessage}
        </div>
      )}

      {/* Main Profile Header Card */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#181a29] to-[#12131d] border border-[#242738] p-6 shadow-xl">
        <div className="flex flex-col md:flex-row items-center gap-6">
          {/* Avatar Showcase */}
          <div className="relative w-36 h-36 bg-[#0a0b12] rounded-2xl border border-[#242738] flex items-center justify-center shadow-lg">
            <AvatarView
              avatar={userState.avatar}
              size={130}
              action="idle"
              animate={true}
            />
            <span className="absolute -bottom-2 px-2.5 py-0.5 rounded-full bg-cyan-500 text-black text-[10px] font-black uppercase tracking-wider shadow">
              LVL {userState.stats.level}
            </span>
          </div>

          {/* User Details */}
          <div className="flex-1 text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2 mb-1">
              {isEditingName ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveName();
                      if (e.key === 'Escape') setIsEditingName(false);
                    }}
                    autoFocus
                    aria-label="Player name"
                    className="px-2.5 py-1 bg-black/60 border border-cyan-400 rounded-lg text-white font-bold text-lg outline-none"
                    maxLength={16}
                  />
                  <button
                    onClick={handleSaveName}
                    className="p-1.5 bg-cyan-500 text-black rounded-lg hover:bg-cyan-400"
                  >
                    <Check className="w-4 h-4 stroke-[3]" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-black text-white">{userState.username}</h1>
                  <button
                    onClick={() => {
                      setNameInput(userState.username);
                      setIsEditingName(true);
                    }}
                    className="text-slate-400 hover:text-white"
                    aria-label="Edit name"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                </div>
              )}
              <span className="text-xs font-black uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-600/50">
                {userState.stats.tier}
              </span>
            </div>

            <p className="text-xs text-slate-400 mb-4">{userState.tagline}</p>

            {/* Quick Badges */}
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-cyan-400 font-mono font-bold">
                <Trophy className="w-4 h-4 text-cyan-400" /> {userState.stats.rating} Elo
              </span>
              <span className="text-slate-600">·</span>
              <span className="flex items-center gap-1.5 text-amber-400 font-mono font-bold">
                <Coins className="w-4 h-4 text-amber-400" /> {userState.stats.coins} Coins
              </span>
              <span className="text-slate-600">·</span>
              <span className="flex items-center gap-1.5 text-orange-400 font-mono font-bold">
                <Flame className="w-4 h-4 text-orange-400" /> {userState.stats.streak} Streak
              </span>
              <span className="text-slate-600">·</span>
              <span className="flex items-center gap-1.5 text-emerald-400 font-mono font-bold">
                {winRate}% Win Rate
              </span>
            </div>
          </div>

          {/* Quick Baseline Switcher (for testing male / female / neutral character creation) */}
          <div className="flex flex-col items-center gap-2 p-3 bg-[#0a0b12] rounded-xl border border-[#242738]">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              Base Character
            </span>
            <div className="flex items-center gap-1.5">
              {(['female', 'male', 'neutral'] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => {
                    sound.playTap();
                    userStore.resetAvatarGender(g);
                    triggerToast(`Switched to ${g} base character`);
                  }}
                  className={`px-2 py-1 rounded text-[10px] font-bold capitalize transition-colors ${
                    userState.avatar.gender === g
                      ? 'bg-cyan-500 text-black'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Career Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 bg-[#12131d] rounded-xl border border-[#242738] text-center">
          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Total Duels</span>
          <span className="text-2xl font-black text-white font-mono">{userState.stats.totalMatches}</span>
        </div>
        <div className="p-4 bg-[#12131d] rounded-xl border border-[#242738] text-center">
          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Win / Loss</span>
          <span className="text-2xl font-black text-emerald-400 font-mono">
            {userState.stats.wins} <span className="text-slate-500 text-sm">/</span> {userState.stats.losses}
          </span>
        </div>
        <div className="p-4 bg-[#12131d] rounded-xl border border-[#242738] text-center">
          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Tournaments Won</span>
          <span className="text-2xl font-black text-amber-400 font-mono">{userState.stats.tournamentsWon}</span>
        </div>
        <div className="p-4 bg-[#12131d] rounded-xl border border-[#242738] text-center">
          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Unlocked Cosmetics</span>
          <span className="text-2xl font-black text-cyan-400 font-mono">{userState.inventory.length} Items</span>
        </div>
      </div>

      {/* High Scores Across All 4 Games */}
      <div className="bg-[#12131d] border border-[#242738] rounded-2xl p-5 shadow-xl">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4">
          PERSONAL HIGH SCORES
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { id: 'neon-dash', name: 'Neon Dash', score: userState.stats.highScores['neon-dash'], unit: 'PTS' },
            { id: 'dunk-rush', name: 'Dunk Rush', score: userState.stats.highScores['dunk-rush'], unit: 'PTS' },
            { id: 'cyber-reflex', name: 'Cyber Reflex', score: userState.stats.highScores['cyber-reflex'], unit: 'PTS' },
            { id: 'gem-surge', name: 'Gem Surge', score: userState.stats.highScores['gem-surge'], unit: 'PTS' },
          ].map((game) => (
            <div key={game.id} className="p-3.5 bg-[#0a0b12] rounded-xl border border-[#1e202f]">
              <span className="text-xs text-slate-400 block mb-1">{game.name}</span>
              <div className="text-xl font-black text-white font-mono">
                {game.score} <span className="text-[11px] font-normal text-slate-500">{game.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Daily Quests with Real Progress */}
      <div className="bg-[#12131d] border border-[#242738] rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
            DAILY CHALLENGES & BOUNTIES
          </h2>
          <span className="text-xs text-amber-400 font-mono" data-testid="quest-reset">{resetLeft === null ? '' : `Resets in ${formatCountdown(resetLeft)}`}</span>
        </div>

        <div className="space-y-3">
          {userState.quests.map((q) => {
            const pct = Math.min(100, Math.round((q.progress / q.target) * 100));
            return (
              <div
                key={q.id}
                className="p-3.5 bg-[#0a0b12] rounded-xl border border-[#1e202f] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-sm text-white">{q.title}</span>
                    <span className="text-xs text-amber-400 font-bold flex items-center gap-1 font-mono">
                      +{q.rewardCoins} <Coins className="w-3 h-3" />
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mb-2">{q.description}</p>
                  {/* Progress bar */}
                  <div className="w-full max-w-md h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono mt-1 block">
                    {q.progress} / {q.target} ({pct}%)
                  </span>
                </div>

                {q.claimed ? (
                  <span className="text-xs font-bold text-slate-500 flex items-center gap-1 self-end sm:self-center">
                    <Check className="w-4 h-4" /> Claimed
                  </span>
                ) : q.completed ? (
                  <button
                    onClick={() => handleClaimQuest(q.id)}
                    data-testid={`claim-${q.id}`}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs rounded-lg shadow-md transition-transform active:scale-95 self-end sm:self-center"
                  >
                    Claim Reward
                  </button>
                ) : (
                  <span className="text-xs text-slate-500 font-semibold self-end sm:self-center">
                    In Progress
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Settings */}
      <div className="bg-[#12131d] border border-[#242738] rounded-2xl p-5 shadow-xl" data-testid="settings">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
          <Settings className="w-4 h-4" /> SETTINGS
        </h2>
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-white flex items-center gap-2">
                <MonitorSmartphone className="w-4 h-4 text-cyan-400" /> Graphics quality
              </span>
              {detectedTier && <span className="text-[11px] text-slate-500">This device: {detectedTier}</span>}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(['auto', 'low', 'medium', 'high'] as const).map((q) => (
                <button
                  key={q}
                  onClick={() => chooseQuality(q)}
                  aria-pressed={quality === q}
                  className={`py-2 rounded-lg border text-xs font-bold capitalize transition-colors ${
                    quality === q ? 'border-cyan-400 bg-cyan-950/40 text-cyan-300' : 'border-[#242738] bg-[#181a27] text-slate-400 hover:border-slate-600'
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">Low turns off glow and shadows for smoother play on older phones. Applies from the next match.</p>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-white flex items-center gap-2">
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-cyan-400" />} Sound effects
            </span>
            <button
              role="switch"
              aria-checked={!isMuted}
              aria-label="Sound effects"
              onClick={() => sound.toggleMute()}
              className={`relative w-12 h-6 rounded-full transition-colors ${isMuted ? 'bg-slate-700' : 'bg-cyan-500'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${isMuted ? 'left-0.5' : 'left-6'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-[#1e202f]">
            <div>
              <span className="text-sm font-bold text-white block">Reset progress</span>
              <span className="text-[11px] text-slate-500">Clears coins, cosmetics, rating and history on this device.</span>
            </div>
            {confirmReset ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    userStore.resetProgress();
                    setConfirmReset(false);
                    triggerToast('Progress reset');
                  }}
                  className="px-3 py-1.5 bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs rounded-lg"
                >
                  Yes, reset
                </button>
                <button onClick={() => setConfirmReset(false)} aria-label="Cancel reset" className="p-1.5 text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmReset(true)} className="px-3 py-1.5 border border-rose-500/50 text-rose-300 hover:bg-rose-950/40 font-bold text-xs rounded-lg flex items-center gap-1.5">
                <RotateCcw className="w-3.5 h-3.5" /> Reset
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
