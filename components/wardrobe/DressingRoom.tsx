'use client';

import React, { useState, useEffect } from 'react';
import { AvatarConfig, CosmeticCategory, CosmeticItem } from '@/lib/avatar-types';
import { COSMETICS_CATALOG, SKIN_TONES, HAIR_COLORS } from '@/lib/cosmetics-catalog';
import { userStore, useUserStore } from '@/lib/user-store';
import AvatarView from '@/components/avatar/AvatarView';
import { sound } from '@/lib/sound';
import { Check, Lock, Sparkles, Coins } from 'lucide-react';

export default function DressingRoom() {
  const userState = useUserStore();
  const [customAvatar, setCustomAvatar] = useState<AvatarConfig | null>(null);
  const workingAvatar = customAvatar || userState.avatar;
  const [activeTab, setActiveTab] = useState<'base' | CosmeticCategory>('base');
  const [previewAction, setPreviewAction] = useState<'idle' | 'run' | 'jump' | 'shoot' | 'celebrate'>('idle');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleGenderSwitch = (gender: 'male' | 'female' | 'neutral') => {
    sound.playTap();
    setCustomAvatar((prev) => ({
      ...(prev || userState.avatar),
      gender,
    }));
  };

  const handleSkinSelect = (skinId: string) => {
    sound.playTap();
    setCustomAvatar((prev) => ({
      ...(prev || userState.avatar),
      skinToneId: skinId,
    }));
  };

  const handleHairColorSelect = (hairColorId: string) => {
    sound.playTap();
    setCustomAvatar((prev) => ({
      ...(prev || userState.avatar),
      hairColorId,
    }));
  };

  const handleExpressionSelect = (expression: AvatarConfig['expression']) => {
    sound.playTap();
    setCustomAvatar((prev) => ({
      ...(prev || userState.avatar),
      expression,
    }));
  };

  const handleEyeColorSelect = (colorHex: string) => {
    sound.playTap();
    setCustomAvatar((prev) => ({
      ...(prev || userState.avatar),
      eyeColor: colorHex,
    }));
  };

  const handleItemSelect = (item: CosmeticItem) => {
    sound.playTap();
    const isOwned = userState.inventory.includes(item.id);

    // Update live preview avatar
    setCustomAvatar((prev) => {
      const next = { ...(prev || userState.avatar) };
      if (item.category === 'hair') next.hairStyleId = item.id;
      else if (item.category === 'shirt') next.shirtId = item.id;
      else if (item.category === 'pants') next.pantsId = item.id;
      else if (item.category === 'shoes') next.shoesId = item.id;
      else if (item.category === 'headwear') next.headwearId = item.id;
      else if (item.category === 'eyewear') next.eyewearId = item.id;
      else if (item.category === 'back') next.backId = item.id;
      else if (item.category === 'trail') next.trailId = item.id;
      else if (item.category === 'banner') next.bannerId = item.id;
      else if (item.category === 'pose') {
        next.pose = item.id === 'pose_victory_flex' ? 'victory' : 'ready';
        setPreviewAction(item.id === 'pose_victory_flex' ? 'celebrate' : 'idle');
      }
      return next;
    });

    if (isOwned) {
      // Auto equip to persistent store
      userStore.equipCosmetic(item.category, item.id);
      triggerToast(`Equipped ${item.name}!`);
    }
  };

  const handleUnlockItem = (item: CosmeticItem) => {
    if (userState.stats.coins < item.cost) {
      sound.playLose();
      triggerToast('Not enough Rival Coins!');
      return;
    }

    const success = userStore.unlockCosmetic(item.id);
    if (success) {
      sound.playPowerup();
      userStore.equipCosmetic(item.category, item.id);
      triggerToast(`Unlocked & equipped ${item.name}!`);
    }
  };

  const lockedInPreview = userStore.lockedItemsIn(workingAvatar);
  const hasUnsaved = !!customAvatar && JSON.stringify(customAvatar) !== JSON.stringify(userState.avatar);

  const handleSaveAvatar = () => {
    sound.playPowerup();
    userStore.setAvatar(workingAvatar);
    setCustomAvatar(null); // re-sync preview with what was actually saved
    triggerToast(lockedInPreview.length ? 'Saved — locked items were skipped' : 'Appearance saved!');
  };

  // Filter items for active tab
  const tabItems = COSMETICS_CATALOG.filter((c) => c.category === activeTab);

  const getRarityBadgeStyle = (rarity: string) => {
    if (rarity === 'mythic') return 'border-cyan-400 text-cyan-300 bg-cyan-950/40';
    if (rarity === 'legendary') return 'border-amber-400 text-amber-300 bg-amber-950/40';
    if (rarity === 'epic') return 'border-purple-400 text-purple-300 bg-purple-950/40';
    if (rarity === 'rare') return 'border-blue-400 text-blue-300 bg-blue-950/40';
    return 'border-slate-700 text-slate-400 bg-slate-900/40';
  };

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col md:flex-row gap-6 p-4">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 bg-cyan-500 text-black font-extrabold px-4 py-2 rounded-lg shadow-xl shadow-cyan-500/30 flex items-center gap-2 animate-in slide-in-from-top-4 duration-200">
          <Sparkles className="w-4 h-4" /> {toastMessage}
        </div>
      )}

      {/* LEFT: Live Avatar Preview Stage */}
      <div className="w-full md:w-80 flex flex-col items-center bg-[#12131d] border border-[#242738] rounded-2xl p-5 shadow-xl">
        <div className="w-full flex items-center justify-between mb-3 text-xs text-slate-400">
          <span className="font-bold uppercase tracking-wider text-cyan-400">LIVE PREVIEW</span>
          <div className="flex items-center gap-1.5 text-amber-400 font-bold">
            <Coins className="w-4 h-4" /> {userState.stats.coins}
          </div>
        </div>

        {/* 360 / Animation Test Canvas */}
        <div className="relative w-full aspect-square bg-[#0a0b12] rounded-xl border border-[#1e202f] flex items-center justify-center overflow-hidden mb-4">
          {/* Cyber stage rings */}
          <div className="absolute bottom-6 w-44 h-12 bg-cyan-500/10 rounded-full border border-cyan-500/30 blur-[1px]" />
          <AvatarView
            avatar={workingAvatar}
            size={220}
            action={previewAction}
            animate={true}
          />
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

        {lockedInPreview.length > 0 && (
          <p className="w-full text-[11px] text-amber-300 bg-amber-950/30 border border-amber-700/40 rounded-lg px-2.5 py-1.5 mb-2" data-testid="locked-preview-note">
            Previewing {lockedInPreview.length} locked item{lockedInPreview.length > 1 ? 's' : ''} — unlock to keep {lockedInPreview.length > 1 ? 'them' : 'it'}.
          </p>
        )}
        {/* Save Appearance Button */}
        <button
          onClick={handleSaveAvatar}
          className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-extrabold text-sm rounded-xl shadow-lg shadow-cyan-500/20 transition-transform active:scale-95 flex items-center justify-center gap-2"
        >
          <Check className="w-4 h-4 stroke-[3]" /> {hasUnsaved ? 'SAVE APPEARANCE' : 'SAVED'}
        </button>
      </div>

      {/* RIGHT: Wardrobe & Customization Shelves */}
      <div className="flex-1 flex flex-col bg-[#12131d] border border-[#242738] rounded-2xl p-5 shadow-xl">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[460px] overflow-y-auto pr-1">
            {tabItems.map((item) => {
              const isOwned = userState.inventory.includes(item.id);
              const isEquipped =
                (item.category === 'hair' && workingAvatar.hairStyleId === item.id) ||
                (item.category === 'shirt' && workingAvatar.shirtId === item.id) ||
                (item.category === 'pants' && workingAvatar.pantsId === item.id) ||
                (item.category === 'shoes' && workingAvatar.shoesId === item.id) ||
                (item.category === 'headwear' && workingAvatar.headwearId === item.id) ||
                (item.category === 'eyewear' && workingAvatar.eyewearId === item.id) ||
                (item.category === 'back' && workingAvatar.backId === item.id) ||
                (item.category === 'trail' && workingAvatar.trailId === item.id) ||
                (item.category === 'banner' && workingAvatar.bannerId === item.id) ||
                (item.category === 'pose' && workingAvatar.pose === (item.id === 'pose_victory_flex' ? 'victory' : 'ready'));

              return (
                <div
                  key={item.id}
                  onClick={() => handleItemSelect(item)}
                  className={`relative flex flex-col p-3 rounded-xl border cursor-pointer transition-all ${
                    isEquipped
                      ? 'border-cyan-400 bg-[#161928] shadow-md shadow-cyan-500/10'
                      : isOwned
                      ? 'border-[#242738] bg-[#141522] hover:border-slate-600'
                      : 'border-[#1e202f] bg-[#0e1018] opacity-80 hover:opacity-100 hover:border-slate-700'
                  }`}
                >
                  {/* Top Line: Item Name & Rarity */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-xs text-white truncate max-w-[140px]">{item.name}</span>
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
                        Click to Equip
                      </span>
                    ) : (
                      <div className="w-full flex items-center justify-between">
                        <span className="flex items-center gap-1 text-xs font-bold text-amber-400">
                          <Coins className="w-3.5 h-3.5" /> {item.cost}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnlockItem(item);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-[10px] rounded shadow transition-colors"
                        >
                          <Lock className="w-3 h-3" /> UNLOCK
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
