/** Season pass tiers (shared by the app and the generated database seed). */
export interface SeasonTierReward {
  tier: number;
  xpRequired: number;
  freeReward: { type: 'coins' | 'cosmetic'; value: number | string; name: string };
  vipReward: { type: 'coins' | 'cosmetic'; value: number | string; name: string };
}

export const SEASON_TIERS: SeasonTierReward[] = [
  { tier: 1, xpRequired: 100, freeReward: { type: 'coins', value: 200, name: '200 Rival Coins' }, vipReward: { type: 'cosmetic', value: 'eyewear_pixel_shades', name: '8-Bit Pixel Shades' } },
  { tier: 2, xpRequired: 250, freeReward: { type: 'coins', value: 300, name: '300 Rival Coins' }, vipReward: { type: 'cosmetic', value: 'trail_cyan_spark', name: 'Cyan Ion Trail' } },
  { tier: 3, xpRequired: 450, freeReward: { type: 'cosmetic', value: 'headwear_beanie', name: 'Skater Slouch Beanie' }, vipReward: { type: 'coins', value: 600, name: '600 Rival Coins' } },
  { tier: 4, xpRequired: 700, freeReward: { type: 'coins', value: 500, name: '500 Rival Coins' }, vipReward: { type: 'cosmetic', value: 'shirt_cyber_jumpsuit', name: 'Vector Carbon Top' } },
  { tier: 5, xpRequired: 1000, freeReward: { type: 'cosmetic', value: 'pose_victory_flex', name: 'Champion Flex Emote' }, vipReward: { type: 'cosmetic', value: 'back_cyber_wings', name: 'Plasma Light Wings' } },
];
