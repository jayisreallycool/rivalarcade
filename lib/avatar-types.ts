// Avatar System Data Definitions
import type { GameId, MatchMode } from './game-types';

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
  highScores: Record<GameId, number>;
  /** League ladder currency: earned by winning 1v1s, placing in arenas, finishing streaks. */
  crowns: number;
}

export interface MatchHistoryItem {
  id: string;
  gameId: GameId;
  gameName: string;
  mode: MatchMode;
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
  /** Coins staked to enter (paid modes). */
  entry?: number;
  /** Arena placement / streak rounds cleared, for the history label. */
  detail?: string;
}
