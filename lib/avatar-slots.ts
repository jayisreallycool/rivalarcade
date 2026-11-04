import { findItem, hairColorFor } from './cosmetics-catalog';
import type { AvatarConfig, CosmeticCategory, CosmeticItem, PoseType } from './avatar-types';

/**
 * The one mapping between cosmetic items and the avatar slots they occupy. The wardrobe, the
 * store's try-on, saving and loading all go through these helpers so an item always lands on the
 * same slot and "equipped" means the same thing everywhere.
 */

type SlotField = 'hairStyleId' | 'shirtId' | 'pantsId' | 'shoesId' | 'headwearId' | 'eyewearId' | 'backId' | 'trailId' | 'bannerId';

export const SLOT_FIELD: Record<Exclude<CosmeticCategory, 'pose'>, SlotField> = {
  hair: 'hairStyleId',
  shirt: 'shirtId',
  pants: 'pantsId',
  shoes: 'shoesId',
  headwear: 'headwearId',
  eyewear: 'eyewearId',
  back: 'backId',
  trail: 'trailId',
  banner: 'bannerId',
};

/** Emote items ↔ the avatar's stored pose. */
export const POSE_OF_ITEM: Record<string, PoseType> = {
  pose_ready: 'ready',
  pose_victory_flex: 'victory',
  pose_peace_sign: 'peace',
};
const ITEM_OF_POSE: Partial<Record<PoseType, string>> = Object.fromEntries(Object.entries(POSE_OF_ITEM).map(([id, p]) => [p, id]));

export const SLOT_CATEGORIES = [...(Object.keys(SLOT_FIELD) as Exclude<CosmeticCategory, 'pose'>[]), 'pose'] as CosmeticCategory[];

/** Item id the avatar has in this category's slot ('none' for an empty slot). */
export function equippedIn(avatar: AvatarConfig, category: CosmeticCategory): string {
  if (category === 'pose') return ITEM_OF_POSE[avatar.pose] ?? 'pose_ready';
  return String(avatar[SLOT_FIELD[category]] ?? 'none');
}

/**
 * A copy of `avatar` wearing `item` in its slot. Switching hairstyle also takes on the colour the
 * style is shown in, so what you saw in the shop is what you get (the colour can be changed after).
 */
export function withItem(avatar: AvatarConfig, item: Pick<CosmeticItem, 'id' | 'category'>): AvatarConfig {
  if (item.category === 'pose') return { ...avatar, pose: POSE_OF_ITEM[item.id] ?? 'ready' };
  if (item.category === 'hair' && avatar.hairStyleId !== item.id) return { ...avatar, hairStyleId: item.id, hairColorId: hairColorFor(findItem(item.id)) };
  return { ...avatar, [SLOT_FIELD[item.category]]: item.id };
}

/** Every item id the avatar is wearing, one per slot (empty slots excluded). */
export function itemsOn(avatar: AvatarConfig): { category: CosmeticCategory; id: string }[] {
  return SLOT_CATEGORIES.map((category) => ({ category, id: equippedIn(avatar, category) })).filter((s) => s.id !== 'none');
}

/** Animation the 2D/3D avatar should play for its equipped emote. */
export function poseAction(avatar: AvatarConfig): 'celebrate' | 'peace' | null {
  return avatar.pose === 'victory' ? 'celebrate' : avatar.pose === 'peace' ? 'peace' : null;
}
