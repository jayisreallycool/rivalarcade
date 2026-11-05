'use client';

import React, { useState } from 'react';
import { AvatarConfig, CosmeticCategory, CosmeticItem } from '@/lib/avatar-types';
import { COSMETICS_CATALOG, SKIN_TONES, HAIR_COLORS, findItem } from '@/lib/cosmetics-catalog';
import { userStore, useUserStore } from '@/lib/user-store';
import Avatar3DView from '@/components/avatar/Avatar3DView';
import { sound } from '@/lib/sound';
import { Check, Lock, Sparkles, Coins, Ban, RotateCcw } from 'lucide-react';
import BannerBackdrop from '@/components/avatar/BannerBackdrop';
import { equippedIn, withItem } from '@/lib/avatar-slots';
import ItemImage from '@/components/items/ItemImage';

export default function DressingRoom() {
  const userState = useUserStore();
  const saved = userState.avatar;
  // Locked items being tried on, per slot. Owned items never live here — they're equipped for real.
  const [previews, setPreviews] = useState<Partial<Record<CosmeticCategory, string>>>({});
  const lockedPreviews = (Object.entries(previews) as [CosmeticCategory, string][]).filter(([, id]) => !userStore.owns(id));
  const workingAvatar = lockedPreviews.reduce((a, [category, id]) => withItem(a, { id, category }), saved);
  const [activeTab, setActiveTab] = useState<'base' | CosmeticCategory>('base');
  const [previewAction, setPreviewAction] = useState<'idle' | 'run' | 'jump' | 'shoot' | 'celebrate'>('idle');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Body & face options are free: they save the moment you pick them.
  const updateBase = (patch: Partial<AvatarConfig>) => {
    sound.playTap();
    userStore.setAvatar({ ...saved, ...patch });
  };
  const handleGenderSwitch = (gender: 'male' | 'female' | 'neutral') => updateBase({ gender });
  const handleSkinSelect = (skinToneId: string) => updateBase({ skinToneId });
  const handleHairColorSelect = (hairColorId: string) => updateBase({ hairColorId });
  const handleExpressionSelect = (expression: AvatarConfig['expression']) => updateBase({ expression });
  const handleEyeColorSelect = (eyeColor: string) => updateBase({ eyeColor });

  const dropPreview = (category: CosmeticCategory) =>
    setPreviews((p) => {
      const next = { ...p };
      delete next[category];
      return next;
    });

  const handleItemSelect = (item: CosmeticItem) => {
    sound.playTap();
    if (item.category === 'pose') setPreviewAction('idle'); // let the emote play
    if (userStore.owns(item.id)) {
      // Owned: equip for real (saved everywhere), and stop previewing anything else in this slot.
      userStore.equipCosmetic(item.category, item.id);
      dropPreview(item.category);
      triggerToast(`Equipped ${item.name}`);
      return;
    }
    // Locked: try it on. Tapping the same locked item again takes it back off.
    if (previews[item.category] === item.id) {
      dropPreview(item.category);
      return;
    }
    setPreviews((p) => ({ ...p, [item.category]: item.id }));
    triggerToast(`Previewing ${item.name} — unlock to keep it`);
  };

  const handleUnlockItem = async (item: CosmeticItem) => {
    if (userState.stats.coins < item.cost) {
      sound.playLose();
      triggerToast('Not enough Rival Coins!');
      return;
    }
    if (await userStore.unlockCosmetic(item.id)) {
      sound.playPowerup();
      userStore.equipCosmetic(item.category, item.id);
      dropPreview(item.category);
      triggerToast(`Unlocked & equipped ${item.name}!`);
    }
  };

  const lockedItems = lockedPreviews.map(([, id]) => findItem(id)).filter((i): i is CosmeticItem => Boolean(i));
  const lockedCost = lockedItems.reduce((a, i) => a + i.cost, 0);
  const handleUnlockAll = async () => {
    if (userState.stats.coins < lockedCost) {
      sound.playLose();
      triggerToast(`Need ${lockedCost - userState.stats.coins} more coins`);
      return;
    }
    for (const i of lockedItems) {
      if (await userStore.unlockCosmetic(i.id)) userStore.equipCosmetic(i.category, i.id);
    }
    setPreviews({});
    sound.playPowerup();
    triggerToast(`Unlocked & equipped ${lockedItems.length} item${lockedItems.length > 1 ? 's' : ''}!`);
  };
  const handleResetPreview = () => {
    sound.playTap();
    setPreviews({});
  };

  // Filter items for active tab
  const tabItems = COSMETICS_CATALOG.filter((c) => c.category === activeTab);

  const getRarityBadgeStyle = (rarity: string) => {
    if (rarity === 'mythic') return 'border-fuchsia-300 text-fuchsia-200 bg-fuchsia-950/40';
    if (rarity === 'legendary') return 'border-amber-400 text-amber-300 bg-amber-950/40';
    if (rarity === 'epic') return 'border-purple-400 text-purple-300 bg-purple-950/40';
    if (rarity === 'rare') return 'border-sky-400 text-sky-300 bg-sky-950/40';
    return 'border-slate-700 text-slate-400 bg-slate-900/40';
  };

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col md:flex-row gap-6 p-4">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 bg-cyan-500 text-black font-extrabold px-4 py-2 rounded-lg shadow-xl shadow-cyan-500/30 flex items-center gap-2 animate-in slide-in-from-top-4 duration-200">
          <Sparkles className="w-4 h-4" /> {toastMessage}
        </div>
      )}

      {/* LEFT: Live Avatar Preview Stage */}
      <div className="w-full md:w-[380px] md:shrink-0 md:self-start md:sticky md:top-4 flex flex-col items-center bg-[#12131d] border border-[#242738] rounded-2xl p-5 shadow-xl">
        <div className="w-full flex items-center justify-between mb-3 text-xs text-slate-400">
          <span className="font-bold uppercase tracking-wider text-cyan-400">LIVE PREVIEW</span>
          <div className="flex items-center gap-1.5 text-amber-400 font-bold">
            <Coins className="w-4 h-4" /> {userState.stats.coins}
          </div>
        </div>

        {/* 360° 3D preview: drag to spin, pinch / scroll / buttons to zoom */}
        <div className="relative w-full aspect-[4/5] bg-[#0a0b12] rounded-xl border border-[#1e202f] overflow-hidden mb-4" data-testid="wardrobe-preview" data-avatar={JSON.stringify(workingAvatar)}>
          <BannerBackdrop bannerId={workingAvatar.bannerId} />
          <Avatar3DView avatar={workingAvatar} action={previewAction} className="absolute inset-0" />
        </div>

        {/* Animation & Pose Testing Buttons */}
        <div className="w-full flex items-center justify-between gap-1 mb-4 p-1 bg-[#181a27] rounded-lg">
          {(['idle', 'run', 'jump', 'shoot', 'celebrate'] as const).map((act) => (
            <button
              key={act}
              onClick={() => {
                sound.playTap();
                setPreviewAction(act);
              }}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded capitalize transition-colors ${
                previewAction === act
                  ? 'bg-cyan-500 text-black shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {act}
            </button>
          ))}
        </div>

        {lockedItems.length > 0 ? (
          <div className="w-full rounded-xl border border-amber-600/40 bg-amber-950/30 p-3 space-y-2" data-testid="locked-preview-note">
            <p className="text-[11px] text-amber-200">
              Previewing {lockedItems.length} locked item{lockedItems.length > 1 ? 's' : ''}: {lockedItems.map((i) => i.name).join(', ')}. Unlock to equip — previews aren&apos;t saved.
            </p>
            <div className="flex gap-2">
              <button onClick={handleUnlockAll} className="flex-1 h-10 rounded-lg bg-amber-400 text-black font-black text-xs flex items-center justify-center gap-1.5" data-testid="unlock-previewed">
                <Lock className="w-3.5 h-3.5" /> Unlock {lockedItems.length > 1 ? 'all' : ''} · {lockedCost.toLocaleString()}
              </button>
              <button onClick={handleResetPreview} className="h-10 px-4 rounded-lg bg-white/10 text-white font-bold text-xs flex items-center gap-1.5" data-testid="reset-preview">
                <RotateCcw className="w-3.5 h-3.5" /> Reset
              </button>
            </div>
          </div>
        ) : (
          <p className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-300 bg-emerald-950/30 border border-emerald-700/30 rounded-lg py-2.5" data-testid="look-saved">
            <Check className="w-4 h-4" /> Your look is saved — it shows in every game and on your profile
          </p>
        )}
      </div>

      {/* RIGHT: Wardrobe & Customization Shelves */}
      <div className="flex-1 min-w-0 flex flex-col bg-[#12131d] border border-[#242738] rounded-2xl p-5 shadow-xl">
        {/* Category Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-2 border-b border-[#242738] mb-5 scrollbar-thin">
          {[
            { id: 'base', label: 'Body & Face' },
            { id: 'hair', label: 'Hair' },
            { id: 'shirt', label: 'Tops' },
            { id: 'pants', label: 'Pants' },
            { id: 'shoes', label: 'Shoes' },
            { id: 'headwear', label: 'Headwear' },
            { id: 'eyewear', label: 'Eyewear' },
            { id: 'back', label: 'Back Gear' },
            { id: 'trail', label: 'Trails' },
            { id: 'pose', label: 'Emotes' },
            { id: 'banner', label: 'Banners' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                sound.playTap();
                setActiveTab(tab.id as 'base' | CosmeticCategory);
              }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-cyan-500 text-black'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content: Base Character Customization */}
        {activeTab === 'base' && (
          <div className="space-y-6">
            {/* Gender / Body Frame Presentation */}
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block mb-2.5">
                Character Frame
              </span>
              <div className="grid grid-cols-3 gap-2">
                {(['female', 'male', 'neutral'] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => handleGenderSwitch(g)}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold capitalize transition-all ${
                      workingAvatar.gender === g
                        ? 'border-cyan-400 bg-cyan-950/40 text-cyan-300'
                        : 'border-[#242738] bg-[#181a27] text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    {g === 'female' ? 'Female-Presenting' : g === 'male' ? 'Male-Presenting' : 'Neutral / Athletic'}
                  </button>
                ))}
              </div>
            </div>

            {/* Skin Tone Selector */}
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block mb-2.5">
                Skin Tone
              </span>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {SKIN_TONES.map((st) => (
                  <button
                    key={st.id}
                    onClick={() => handleSkinSelect(st.id)}
                    className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all ${
                      workingAvatar.skinToneId === st.id
                        ? 'border-cyan-400 bg-[#181a27]'
                        : 'border-[#242738] bg-[#141522] hover:border-slate-600'
                    }`}
                  >
                    <div
                      className="w-8 h-8 rounded-full border border-black/40 shadow-inner"
                      style={{ backgroundColor: st.color }}
                    />
                    <span className="text-[10px] text-slate-300 truncate w-full text-center">
                      {st.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Hair Color Dye */}
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block mb-2.5">
                Hair Color Dye
              </span>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                {HAIR_COLORS.map((hc) => (
                  <button
                    key={hc.id}
                    onClick={() => handleHairColorSelect(hc.id)}
                    className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all ${
                      workingAvatar.hairColorId === hc.id
                        ? 'border-cyan-400 bg-[#181a27]'
                        : 'border-[#242738] bg-[#141522] hover:border-slate-600'
                    }`}
                  >
                    <div
                      className="w-6 h-6 rounded-full border border-black/40"
                      style={{ backgroundColor: hc.color }}
                    />
                    <span className="text-[9px] text-slate-300 truncate w-full text-center">
                      {hc.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Eye Iris Color */}
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block mb-2.5">
                Eye Iris Color
              </span>
              <div className="flex items-center gap-2">
                {['#00f0ff', '#ffb800', '#ff0055', '#10b981', '#a855f7', '#ffffff'].map((color) => (
                  <button
                    key={color}
                    onClick={() => handleEyeColorSelect(color)}
                    className={`w-7 h-7 rounded-full border-2 transition-transform active:scale-90 ${
                      workingAvatar.eyeColor === color ? 'border-white scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            {/* Expression */}
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block mb-2.5">
                Default Expression
              </span>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {(['focused', 'fierce', 'confident', 'chill', 'victory'] as const).map((exp) => (
                  <button
                    key={exp}
                    onClick={() => handleExpressionSelect(exp)}
                    className={`py-2 px-2 rounded-xl border text-xs font-bold capitalize transition-all ${
                      workingAvatar.expression === exp
                        ? 'border-cyan-400 bg-cyan-950/40 text-cyan-300'
                        : 'border-[#242738] bg-[#181a27] text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    {exp}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab Content: Collectible Cosmetic Item Grid */}
        {activeTab !== 'base' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[560px] overflow-y-auto pr-1">
            {tabItems.map((item) => {
              const isOwned = userStore.owns(item.id);
              const isEquipped = equippedIn(saved, item.category) === item.id;
              const isPreviewing = !isOwned && previews[item.category] === item.id;

              return (
                <div
                  key={item.id}
                  onClick={() => handleItemSelect(item)}
                  data-testid={`wardrobe-item-${item.id}`}
                  data-state={isEquipped ? 'equipped' : isPreviewing ? 'previewing' : isOwned ? 'owned' : 'locked'}
                  className={`relative flex flex-col p-3 rounded-xl border cursor-pointer transition-all ${
                    isEquipped
                      ? 'border-cyan-400 bg-[#161928] shadow-md shadow-cyan-500/10'
                      : isPreviewing
                      ? 'border-amber-400 bg-[#1a1610] shadow-md shadow-amber-500/10'
                      : isOwned
                      ? 'border-[#242738] bg-[#141522] hover:border-slate-600'
                      : 'border-[#1e202f] bg-[#0e1018] opacity-80 hover:opacity-100 hover:border-slate-700'
                  }`}
                >
                  {item.id === 'none' ? (
                    <div className="aspect-square mb-2 rounded-xl border border-dashed border-slate-700 bg-[#0a0b12] flex items-center justify-center text-slate-600">
                      <Ban className="w-8 h-8" />
                    </div>
                  ) : (
                    <ItemImage item={item} badge={false} className="mb-2" />
                  )}
                  {/* Top Line: Item Name & Rarity */}
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span className="font-bold text-xs text-white truncate">{item.name}</span>
                    <span className={`text-[9px] uppercase font-black px-1.5 py-0.5 rounded border ${getRarityBadgeStyle(item.rarity)}`}>
                      {item.rarity}
                    </span>
                  </div>

                  {/* Description */}
                  <p className="text-[11px] text-slate-400 line-clamp-2 mb-3">
                    {item.description}
                  </p>

                  {/* Bottom Action Area */}
                  <div className="mt-auto flex items-center justify-between pt-2 border-t border-[#1e202f]">
                    {isEquipped ? (
                      <span className="flex items-center gap-1 text-[11px] font-extrabold text-cyan-400">
                        <Check className="w-3.5 h-3.5" /> EQUIPPED
                      </span>
                    ) : isOwned ? (
                      <span className="text-[11px] font-bold text-slate-400 hover:text-white">
                        Tap to equip
                      </span>
                    ) : (
                      <div className="w-full flex items-center justify-between">
                        <span className="flex items-center gap-1 text-xs font-bold text-amber-400">
                          {isPreviewing ? <span className="text-[10px] font-black">PREVIEWING</span> : <><Coins className="w-3.5 h-3.5" /> {item.cost}</>}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnlockItem(item);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-[10px] rounded shadow transition-colors"
                        >
                          <Lock className="w-3 h-3" /> {isPreviewing ? item.cost : 'UNLOCK'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
