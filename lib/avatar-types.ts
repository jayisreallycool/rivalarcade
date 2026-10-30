// Avatar System Data Definitions

export type GenderType = 'male' | 'female' | 'neutral';

export type PoseType = 'ready' | 'run' | 'jump' | 'shoot' | 'victory' | 'defeat';

export type CosmeticCategory = 
  | 'hair'
  | 'shirt'
  | 'pants'
  | 'shoes'
  | 'headwear'
  | 'eyewear'
  | 'back'
  | 'trail'
  | 'pose'
  | 'banner';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

export interface SkinTone {
  id: string;
  name: string;
  color: string;
  shadow: string;
}

export interface HairColor {
  id: string;
  name: string;
  color: string;
  highlight: string;
}

export interface CosmeticItem {
  id: string;
  name: string;
  category: CosmeticCategory;
  rarity: Rarity;
  cost: number; // in Rival Coins (free = 0)
  isUnlockedDefault: boolean;
  unlockRequirement?: string;
  description: string;
  // Visual asset specifications
  color?: string;
  accentColor?: string;
  styleName?: string;
  icon?: string;
  glowColor?: string;
}

export interface AvatarConfig {
  gender: GenderType;
  skinToneId: string;
  hairStyleId: string;
  hairColorId: string;
  eyeColor: string;
  expression: 'focused' | 'fierce' | 'confident' | 'chill' | 'victory';
  shirtId: string;
  pantsId: string;
  shoesId: string;
  headwearId: string; // or 'none'
  eyewearId: string;  // or 'none'
  backId: string;     // or 'none'
  trailId: string;    // or 'none'
  pose: PoseType;
  bannerId: string;
}

export interface PlayerStats {
  rating: number; // Skill Rating (Elo, e.g. 1200)
  tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond' | 'Master' | 'Apex';
  wins: number;
  losses: number;
  streak: number;
  bestStreak: number;
  tournamentsWon: number;
  totalMatches: number;
  coins: number;
  trophies: number;
  xp: number;
  level: number;
  highScores: {
    'neon-dash': number;
    'dunk-rush': number;
    'cyber-reflex': number;
    'gem-surge': number;
  };
}

export interface MatchHistoryItem {
  id: string;
  gameId: 'neon-dash' | 'dunk-rush' | 'cyber-reflex' | 'gem-surge';
  gameName: string;
  mode: 'practice' | 'duel' | 'tournament';
  /** Legacy display string; prefer `at`. */
  date: string;
  /** Epoch ms when the match finished. */
  at?: number;
  playerScore: number;
  opponentScore: number;
  opponentName: string;
  opponentAvatar: AvatarConfig;
  result: 'win' | 'loss' | 'tie' | 'practice';
  ratingDelta: number;
  coinsEarned: number;
}
