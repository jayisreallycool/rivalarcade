'use client';

import React, { useState } from 'react';
import { userStore, useUserStore, SEASON_TIERS, errorText } from '@/lib/user-store';
import { RARITY, SHOP_ITEMS, findItem } from '@/lib/cosmetics-catalog';
import type { CosmeticCategory, CosmeticItem, Rarity } from '@/lib/avatar-types';
import ItemImage from '@/components/items/ItemImage';
import Avatar3DView from '@/components/avatar/Avatar3DView';
import BannerBackdrop from '@/components/avatar/BannerBackdrop';
import { equippedIn, withItem } from '@/lib/avatar-slots';

const CATEGORY_LABEL: Record<CosmeticCategory, string> = {
  hair: 'Hairstyle',
  shirt: 'Top',
  pants: 'Bottoms',
  shoes: 'Shoes',
  headwear: 'Headwear',
  eyewear: 'Eyewear',
  back: 'Back gear',
  trail: 'Trail',
  pose: 'Emote',
  banner: 'Banner',
};
import { sound } from '@/lib/sound';
import { Crown, Sparkles, Check, Lock, Coins, ShieldCheck } from 'lucide-react';

const rewardItem = (r: { type: string; value: string | number }) => (r.type === 'cosmetic' ? findItem(String(r.value)) : undefined);

export default function StoreView() {
  const userState = useUserStore();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleClaimTier = async (tier: number, isVip: boolean) => {
    try {
      await userStore.claimSeasonReward(tier, isVip);
      sound.playPowerup();
      triggerToast('Reward claimed to inventory!');
    } catch (e) {
      triggerToast(errorText(e));
    }
  };

  const handleBuyCosmetic = async (itemId: string, cost: number) => {
    if (userState.stats.coins < cost) {
      sound.playLose();
      triggerToast('Insufficient Rival Coins!');
      return;
    }
    const success = await userStore.unlockCosmetic(itemId);
    if (!success) triggerToast('Purchase failed. Try again.');
    if (success) {
      const item = findItem(itemId);
      if (item) userStore.equipCosmetic(item.category, item.id);
      sound.playPowerup();
      triggerToast(`Unlocked & equipped ${item?.name ?? 'item'}!`);
    }
  };

  const handleActivateVip = async () => {
    try {
      await userStore.activateVip();
      sound.playWin();
      triggerToast('VIP Season Pass Activated!');
    } catch (e) {
      triggerToast(errorText(e));
    }
  };

  const [rarity, setRarity] = useState<'all' | Rarity>('all');
  const [detail, setDetailRaw] = useState<CosmeticItem | null>(null);
  const [view, setView] = useState<'item' | 'avatar'>('item');
  const setDetail = (item: CosmeticItem | null) => {
    setDetailRaw(item);
    setView('item');
  };
  const tryOn = detail ? withItem(userState.avatar, detail) : userState.avatar;
  // Everything you can actually buy, rarest first.
  const shopItems = SHOP_ITEMS()
    .filter((c) => !c.isUnlockedDefault)
    .sort((a, b) => RARITY[b.rarity].rank - RARITY[a.rarity].rank || b.cost - a.cost);
  const featuredItems = shopItems.filter((c) => RARITY[c.rarity].rank >= 3).slice(0, 10);
  const visibleItems = rarity === 'all' ? shopItems : shopItems.filter((c) => c.rarity === rarity);

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
                disabled={userState.stats.coins < userState.vipCost}
                data-testid="vip-activate"
                className="disabled:opacity-40 px-6 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black font-extrabold text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-transform active:scale-95 flex items-center gap-2"
              >
                <Crown className="w-4 h-4 fill-black" /> UNLOCK VIP PASS · {userState.vipCost.toLocaleString()} COINS
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
                    <div className="flex items-center gap-2.5">
                      {rewardItem(tier.freeReward) && <ItemImage item={rewardItem(tier.freeReward)!} size="sm" className="w-11 shrink-0" />}
                      <div>
                      <span className="text-[10px] text-slate-500 uppercase font-bold block">Free Reward</span>
                      <span className="text-xs font-bold text-slate-200">{tier.freeReward.name}</span>
                      </div>
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
                    <div className="flex items-center gap-2.5">
                      {rewardItem(tier.vipReward) && <ItemImage item={rewardItem(tier.vipReward)!} size="sm" className="w-11 shrink-0" />}
                      <div>
                      <span className="text-[10px] text-amber-400 uppercase font-bold flex items-center gap-1">
                        <Crown className="w-3 h-3" /> VIP Reward
                      </span>
                      <span className="text-xs font-bold text-amber-200">{tier.vipReward.name}</span>
                      </div>
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

      {/* Item Shop */}
      <div className="bg-[#12131d] border border-[#242738] rounded-2xl p-4 sm:p-5 shadow-xl" data-testid="item-shop">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-black text-white uppercase tracking-wider">ITEM SHOP</h2>
            <p className="text-xs text-slate-400">{shopItems.length} unique cosmetics · spend the coins you win in matches.</p>
          </div>
          <div className="flex items-center gap-1.5 text-amber-400 font-bold font-mono text-sm">
            <Coins className="w-4 h-4" /> {userState.stats.coins.toLocaleString()}
          </div>
        </div>

        {/* Featured: the rarest pieces */}
        <div className="-mx-1 mb-4 flex gap-3 overflow-x-auto px-1 pb-2 snap-x" data-testid="featured-strip">
          {featuredItems.map((item) => (
            <button key={item.id} onClick={() => setDetail(item)} className="snap-start shrink-0 w-36 text-left">
              <ItemImage item={item} />
              <span className="mt-1.5 block text-xs font-bold text-white truncate">{item.name}</span>
              <span className="text-[11px] font-bold text-amber-400 flex items-center gap-1">
                {userState.inventory.includes(item.id) ? <span className="text-emerald-400">Owned</span> : <><Coins className="w-3 h-3" /> {item.cost.toLocaleString()}</>}
              </span>
            </button>
          ))}
        </div>

        {/* Rarity filter */}
        <div className="flex gap-1.5 overflow-x-auto pb-3 mb-1">
          {(['all', 'mythic', 'legendary', 'epic', 'rare', 'common'] as const).map((r) => (
            <button
              key={r}
              onClick={() => {
                sound.playTap();
                setRarity(r);
              }}
              data-testid={`rarity-${r}`}
              className={`h-8 px-3 rounded-full text-xs font-black whitespace-nowrap border transition-colors ${rarity === r ? 'text-black' : 'text-slate-300 bg-white/[0.04] border-white/10'}`}
              style={rarity === r ? { background: r === 'all' ? '#22d3ee' : RARITY[r].color, borderColor: 'transparent' } : undefined}
            >
              {r === 'all' ? 'All' : RARITY[r].label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {visibleItems.map((item) => {
            const owned = userState.inventory.includes(item.id);
            return (
              <button key={item.id} onClick={() => setDetail(item)} className="text-left rounded-xl bg-[#0a0b12] border border-[#1e202f] p-2 active:scale-[0.98] transition-transform" data-testid={`shop-item-${item.id}`}>
                <ItemImage item={item} />
                <span className="mt-2 block text-[13px] font-bold text-white truncate">{item.name}</span>
                <span className="block text-[10px] uppercase tracking-wide text-slate-500">{CATEGORY_LABEL[item.category]}</span>
                <span className="mt-1 flex items-center justify-between text-xs font-bold">
                  {owned ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Owned
                    </span>
                  ) : item.cost === 0 ? (
                    <span className="text-slate-400">Free</span>
                  ) : (
                    <span className="text-amber-400 flex items-center gap-1 font-mono">
                      <Coins className="w-3.5 h-3.5" /> {item.cost.toLocaleString()}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Item detail sheet */}
      {detail && (
        <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={() => setDetail(null)} data-testid="item-detail">
          <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-[#11121c] border border-white/10 p-5 pb-[max(env(safe-area-inset-bottom),20px)]" onClick={(e) => e.stopPropagation()}>
            {/* Item art, or the item on YOUR avatar (try-on — nothing is saved until you own and equip it). */}
            <div className="relative w-full max-w-[280px] mx-auto">
              {view === 'item' ? (
                <ItemImage item={detail} size="lg" className="w-full" />
              ) : (
                <div className="relative aspect-[4/5] rounded-xl overflow-hidden" style={{ boxShadow: `0 0 0 2px ${RARITY[detail.rarity].color}` }} data-testid="try-on">
                  <BannerBackdrop bannerId={tryOn.bannerId} />
                  <Avatar3DView avatar={tryOn} className="absolute inset-0" testId="try-on-3d" />
                </div>
              )}
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex rounded-full bg-black/80 border border-white/10 p-0.5 text-[11px] font-black">
                {(['item', 'avatar'] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} data-testid={`view-${v}`} className={`px-3 h-7 rounded-full ${view === v ? 'bg-white text-black' : 'text-white/70'}`}>
                    {v === 'item' ? 'Item' : 'On you'}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase text-black" style={{ background: RARITY[detail.rarity].color }}>
                {RARITY[detail.rarity].label}
              </span>
              <span className="text-[11px] uppercase tracking-wide text-slate-400">{CATEGORY_LABEL[detail.category]}</span>
            </div>
            <h3 className="mt-1 text-xl font-black text-white">{detail.name}</h3>
            <p className="mt-1 text-sm text-slate-400">{detail.description}</p>
            {detail.unlockRequirement && !userState.inventory.includes(detail.id) && <p className="mt-1 text-xs text-amber-300/80">{detail.unlockRequirement}</p>}
            <div className="mt-4 flex gap-2">
              {userState.inventory.includes(detail.id) ? (
                equippedIn(userState.avatar, detail.category) === detail.id ? (
                  <span className="flex-1 h-12 rounded-full bg-emerald-500/15 text-emerald-300 font-black flex items-center justify-center gap-2" data-testid="item-equipped">
                    <Check className="w-4 h-4" /> Equipped
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      userStore.equipCosmetic(detail.category, detail.id);
                      sound.playPowerup();
                      triggerToast(`Equipped ${detail.name}`);
                    }}
                    className="flex-1 h-12 rounded-full bg-cyan-400 text-black font-black flex items-center justify-center gap-2"
                    data-testid="equip-item"
                  >
                    <Check className="w-4 h-4" /> Equip now
                  </button>
                )
              ) : (
                <button
                  onClick={() => handleBuyCosmetic(detail.id, detail.cost)}
                  disabled={userState.stats.coins < detail.cost}
                  className="flex-1 h-12 rounded-full bg-amber-400 text-black font-black flex items-center justify-center gap-2 disabled:opacity-40"
                  data-testid="buy-item"
                >
                  <Coins className="w-4 h-4" />{' '}
                  {userState.stats.coins >= detail.cost ? `Buy for ${detail.cost.toLocaleString()}` : `${(detail.cost - userState.stats.coins).toLocaleString()} more coins`}
                </button>
              )}
              <button onClick={() => setDetail(null)} className="h-12 px-5 rounded-full bg-white/10 text-white font-bold">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
