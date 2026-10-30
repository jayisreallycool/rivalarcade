'use client';

import React, { useState } from 'react';
import { userStore, useUserStore, SEASON_TIERS } from '@/lib/user-store';
import { COSMETICS_CATALOG } from '@/lib/cosmetics-catalog';
import { sound } from '@/lib/sound';
import { Crown, Sparkles, Check, Lock, Coins, ShieldCheck } from 'lucide-react';

export default function StoreView() {
  const userState = useUserStore();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleClaimTier = (tier: number, isVip: boolean) => {
    sound.playPowerup();
    userStore.claimSeasonReward(tier, isVip);
    triggerToast('Reward claimed to inventory!');
  };

  const handleBuyCosmetic = (itemId: string, cost: number) => {
    if (userState.stats.coins < cost) {
      sound.playLose();
      triggerToast('Insufficient Rival Coins!');
      return;
    }
    const success = userStore.unlockCosmetic(itemId);
    if (success) {
      sound.playPowerup();
      triggerToast('Purchased cosmetic successfully!');
    }
  };

  const handleActivateVip = () => {
    sound.playWin();
    userStore.activateVip();
    triggerToast('VIP Season Pass Activated!');
  };

  const featuredItems = COSMETICS_CATALOG.filter((c) =>
    ['shirt_champion_jacket', 'back_cyber_wings', 'headwear_crown', 'shoes_gold_cleats', 'trail_golden_dust'].includes(c.id)
  );

  return (
    <div className="w-full max-w-5xl mx-auto p-4 space-y-8">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 bg-amber-400 text-black font-extrabold px-4 py-2 rounded-lg shadow-xl shadow-amber-500/30 flex items-center gap-2 animate-in slide-in-from-top-4 duration-200">
          <Sparkles className="w-4 h-4" /> {toastMessage}
        </div>
      )}

      {/* Season Pass Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-950/60 via-[#1a1829] to-[#12131d] border border-amber-500/30 p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2 text-xs font-black uppercase tracking-widest text-amber-400">
              <Crown className="w-4 h-4" /> SEASON 1: CYBER ARENA
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-white italic">
              RIVAL PASS PROGRESSION
            </h1>
            <p className="text-xs md:text-sm text-slate-300 max-w-xl mt-1">
              Earn Season XP in every practice run and tournament. Unlock exclusive cosmetic armor, custom wings, and neon trails.
            </p>
            <div className="flex items-center gap-2 mt-4">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-slate-400">
                100% Skill-based. Zero pay-to-win. Cosmetics have no impact on hitboxes or speed.
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end">
            <div className="text-right mb-2">
              <span className="text-xs text-slate-400">Current Tier: </span>
              <span className="text-base font-black text-amber-400">Tier {userState.seasonTier}</span>
              <div className="text-xs text-cyan-400 font-mono mt-0.5">
                {userState.seasonXp} Season XP
              </div>
            </div>

            {!userState.isVip ? (
              <button
                onClick={handleActivateVip}
                className="px-6 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black font-extrabold text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-transform active:scale-95 flex items-center gap-2"
              >
                <Crown className="w-4 h-4 fill-black" /> UNLOCK VIP PASS (FREE PROMO)
              </button>
            ) : (
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-black">
                <Crown className="w-4 h-4" /> VIP PASS ACTIVE
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Season Pass Track (Free vs VIP Tracks) */}
      <div className="bg-[#12131d] border border-[#242738] rounded-2xl p-5 shadow-xl">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4">
          SEASON ROAD TIERS
        </h2>

        <div className="space-y-4">
          {SEASON_TIERS.map((tier) => {
            const isUnlocked = userState.seasonXp >= tier.xpRequired;
            const freeClaimed = userState.claimedFreeTiers.includes(tier.tier);
            const vipClaimed = userState.claimedVipTiers.includes(tier.tier);

            return (
              <div
                key={tier.tier}
                className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${
                  isUnlocked
                    ? 'border-[#363a54] bg-[#161827]'
                    : 'border-[#1e202f] bg-[#0f1019] opacity-75'
                }`}
              >
                {/* Tier Number & XP */}
                <div className="flex items-center gap-4">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm ${
                      isUnlocked
                        ? 'bg-amber-400 text-black shadow-md shadow-amber-400/20'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    T{tier.tier}
                  </div>
                  <div>
                    <span className="font-bold text-sm text-white block">Tier {tier.tier}</span>
                    <span className="text-xs text-slate-400 font-mono">
                      {tier.xpRequired} XP required {isUnlocked ? '✓ Reached' : ''}
                    </span>
                  </div>
                </div>

                {/* Free & VIP Reward Boxes */}
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  {/* Free Reward */}
                  <div className="flex items-center gap-3 p-2.5 rounded-lg bg-[#0a0b12] border border-[#1e202f] min-w-[200px] justify-between">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-bold block">Free Reward</span>
                      <span className="text-xs font-bold text-slate-200">{tier.freeReward.name}</span>
                    </div>
                    {freeClaimed ? (
                      <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> Claimed
                      </span>
                    ) : isUnlocked ? (
                      <button
                        onClick={() => handleClaimTier(tier.tier, false)}
                        className="px-2.5 py-1 bg-cyan-500 hover:bg-cyan-400 text-black font-extrabold text-[11px] rounded"
                      >
                        Claim
                      </button>
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-slate-600" />
                    )}
                  </div>

                  {/* VIP Reward */}
                  <div className="flex items-center gap-3 p-2.5 rounded-lg bg-[#181524] border border-amber-500/25 min-w-[220px] justify-between">
                    <div>
                      <span className="text-[10px] text-amber-400 uppercase font-bold flex items-center gap-1">
                        <Crown className="w-3 h-3" /> VIP Reward
                      </span>
                      <span className="text-xs font-bold text-amber-200">{tier.vipReward.name}</span>
                    </div>
                    {vipClaimed ? (
                      <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> Claimed
                      </span>
                    ) : isUnlocked && userState.isVip ? (
                      <button
                        onClick={() => handleClaimTier(tier.tier, true)}
                        className="px-2.5 py-1 bg-amber-400 hover:bg-amber-300 text-black font-extrabold text-[11px] rounded"
                      >
                        Claim
                      </button>
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-amber-600/60" />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Featured Cosmetic Vault */}
      <div className="bg-[#12131d] border border-[#242738] rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-black text-white uppercase tracking-wider">
              LEGENDARY COSMETIC VAULT
            </h2>
            <p className="text-xs text-slate-400">
              Limited-edition cosmetic pieces unlockable with Rival Coins earned through matches.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-amber-400 font-bold font-mono">
            <Coins className="w-4 h-4" /> {userState.stats.coins} Balance
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {featuredItems.map((item) => {
            const isOwned = userState.inventory.includes(item.id);
            return (
              <div
                key={item.id}
                className="p-4 rounded-xl border border-[#242738] bg-[#0a0b12] flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm text-white">{item.name}</span>
                    <span className="text-[10px] font-black uppercase text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10">
                      {item.rarity}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mb-3">{item.description}</p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#1e202f]">
                  <span className="text-xs font-bold text-amber-400 flex items-center gap-1 font-mono">
                    <Coins className="w-3.5 h-3.5" /> {item.cost} Coins
                  </span>
                  {isOwned ? (
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Owned
                    </span>
                  ) : (
                    <button
                      onClick={() => handleBuyCosmetic(item.id, item.cost)}
                      className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold text-xs rounded transition-colors active:scale-95"
                    >
                      Buy Item
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
