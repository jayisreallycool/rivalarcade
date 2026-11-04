import type { CosmeticItem } from './avatar-types';
import { itemShape } from './cosmetics-catalog';

/**
 * The signature features of every garment — the things its name promises (a hoodie has a hood,
 * shorts end above the knee, cleats have studs, "#99" has a 99 on it).
 *
 * The 3D model (which also renders the product images) and the 2D avatar both read this table,
 * so an item looks the same in the shop, in the wardrobe and on the player. Keyed by shape id.
 */

export type Emblem = { kind: 'number'; text: string } | { kind: 'crest' } | { kind: 'diamond' } | { kind: 'reactor' };

export interface TopLook {
  sleeves: 'long' | 'short' | 'none';
  hood?: boolean;
  drawstrings?: boolean;
  /** crew = round neck band · rib = knit bomber collar · high = stand-up zip collar · varsity = striped knit collar */
  collar?: 'crew' | 'rib' | 'high' | 'varsity';
  zip?: boolean;
  /** Kangaroo pocket across the belly. */
  pocket?: boolean;
  emblem?: Emblem;
  /** Ribbed cuffs and waistband in the accent colour. */
  bands?: boolean;
  /** Long coat tail below the waist. */
  coat?: boolean;
  /** Glowing conduit / reflective seam lines. */
  seams?: boolean;
  /** Diagonal colour-block panel across the chest (retro windbreaker). */
  chevron?: boolean;
  /** Centre accent stripe (default athletic trim). */
  stripe?: boolean;
}

export interface BottomLook {
  length: 'full' | 'shorts' | 'leggings';
  cargo?: boolean;
  /** Elastic jogger ankle cuffs / rolled denim cuffs. */
  cuffs?: boolean;
  knees?: boolean;
  stripe?: boolean;
  stitch?: boolean;
  ankleGlow?: boolean;
}

export interface ShoeLook {
  height: 'low' | 'high' | 'boot';
  laces?: string;
  toeCap?: string;
  studs?: boolean;
  /** Translucent glowing outsole. */
  glowSole?: boolean;
  /** Thick chunky sole. */
  chunky?: boolean;
  swoosh?: boolean;
  rings?: boolean;
  /** Hovers on a glowing pad. */
  float?: boolean;
}

export type TrailStyle = 'bolt' | 'flame' | 'glitter' | 'bubble' | 'glyph' | 'ribbon' | 'rift';

export const TOP_LOOKS: Record<string, TopLook> = {
  shirt_starter_jersey: { sleeves: 'short', collar: 'crew', emblem: { kind: 'number', text: '01' }, stripe: true },
  shirt_street_hoodie: { sleeves: 'none', hood: true, drawstrings: true, pocket: true, zip: true },
  shirt_cyber_jumpsuit: { sleeves: 'long', collar: 'high', seams: true },
  shirt_retro_tracksuit: { sleeves: 'long', collar: 'high', zip: true, chevron: true, bands: true },
  shirt_champion_jacket: { sleeves: 'long', collar: 'rib', zip: true, bands: true, emblem: { kind: 'crest' } },
  shirt_neon_mech: { sleeves: 'none', collar: 'high', seams: true, emblem: { kind: 'reactor' } },
  shirt_checker_retro: { sleeves: 'short', collar: 'crew' },
  shirt_circuit_tee: { sleeves: 'short', collar: 'crew' },
  shirt_camo_shell: { sleeves: 'long', collar: 'high', zip: true, seams: true },
  shirt_inferno_jersey: { sleeves: 'short', collar: 'crew', emblem: { kind: 'number', text: '99' } },
  shirt_deep_space: { sleeves: 'long', hood: true, drawstrings: true, pocket: true },
  shirt_diamond_royale: { sleeves: 'long', collar: 'varsity', bands: true, emblem: { kind: 'diamond' } },
  shirt_aurora_holo: { sleeves: 'long', collar: 'high', coat: true, zip: true },
};

export const BOTTOM_LOOKS: Record<string, BottomLook> = {
  pants_cargo_joggers: { length: 'full', cargo: true, cuffs: true },
  pants_athletic_shorts: { length: 'shorts', stripe: true },
  pants_cyber_greaves: { length: 'full', knees: true },
  pants_gold_trim: { length: 'full', stripe: true },
  pants_raw_denim: { length: 'full', stitch: true, cuffs: true },
  pants_urban_camo: { length: 'full', cargo: true },
  pants_afterburner: { length: 'full', ankleGlow: true },
  pants_prism_leggings: { length: 'leggings' },
};

export const SHOE_LOOKS: Record<string, ShoeLook> = {
  shoes_high_tops: { height: 'high', laces: '#e2e8f0' },
  shoes_neon_runners: { height: 'low', glowSole: true, swoosh: true },
  shoes_cyber_boots: { height: 'boot', rings: true, chunky: true },
  shoes_gold_cleats: { height: 'low', studs: true, laces: '#ffffff' },
  shoes_retro_canvas: { height: 'low', toeCap: '#fef3c7', laces: '#ffffff' },
  shoes_glacier_kicks: { height: 'low', glowSole: true, chunky: true, laces: '#e0f2fe' },
  shoes_magma_step: { height: 'low' }, // glowing cracks come from its 'cracks' print
  shoes_void_walkers: { height: 'low', float: true, glowSole: true },
};

export const TRAIL_STYLE: Record<string, TrailStyle> = {
  trail_cyan_spark: 'bolt',
  trail_crimson_burn: 'flame',
  trail_golden_dust: 'glitter',
  trail_bubblepop: 'bubble',
  trail_matrix_rain: 'glyph',
  trail_rainbow_rush: 'ribbon',
  trail_void_rift: 'rift',
};

const DEFAULT_TOP: TopLook = { sleeves: 'long', collar: 'crew', stripe: true };
const DEFAULT_BOTTOM: BottomLook = { length: 'full' };
const DEFAULT_SHOE: ShoeLook = { height: 'low' };

export const topLook = (item?: CosmeticItem | null): TopLook => TOP_LOOKS[itemShape(item)] ?? DEFAULT_TOP;
export const bottomLook = (item?: CosmeticItem | null): BottomLook => BOTTOM_LOOKS[itemShape(item)] ?? DEFAULT_BOTTOM;
export const shoeLook = (item?: CosmeticItem | null): ShoeLook => SHOE_LOOKS[itemShape(item)] ?? DEFAULT_SHOE;
export const trailStyle = (item?: CosmeticItem | null): TrailStyle => TRAIL_STYLE[itemShape(item)] ?? 'bolt';

/** Every visual signature an item has (used by the uniqueness test). */
export function signature(item: CosmeticItem): string {
  const look =
    item.category === 'shirt' ? topLook(item) : item.category === 'pants' ? bottomLook(item) : item.category === 'shoes' ? shoeLook(item) : item.category === 'trail' ? trailStyle(item) : itemShape(item);
  return JSON.stringify([item.category, look, item.pattern ?? 'solid', item.finish ?? item.rarity, item.color, item.accentColor, item.palette]);
}
