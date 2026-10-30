import type { AvatarConfig } from './avatar-types';

export type GameId = 'neon-dash' | 'dunk-rush' | 'cyber-reflex' | 'gem-surge';
export type MatchMode = 'practice' | 'duel' | 'tournament';

export const GAME_NAMES: Record<GameId, string> = {
  'neon-dash': 'Neon Dash',
  'dunk-rush': 'Dunk Rush',
  'cyber-reflex': 'Cyber Reflex',
  'gem-surge': 'Gem Surge',
};

/** What a finished run reports, beyond the score. Drives quests and history. */
export interface RunStats {
  maxCombo?: number;
  baskets?: number;
  distance?: number;
  /** How the final score was built, shown on the results screen. Values sum to the score. */
  breakdown?: { label: string; points: number }[];
}

export type FinishHandler = (score: number, stats?: RunStats) => void;

/** A rival shown live in the game HUD. */
export interface RivalInfo {
  name: string;
  score: number;
  /** Label for the comparison, e.g. "RIVAL" or "#1". */
  label?: string;
}

/** Props every playable game accepts. */
export interface GameProps {
  avatar: AvatarConfig;
  onFinish: FinishHandler;
  modeName?: string;
  /** Same seed → same obstacle/board/target sequence. */
  seed?: number;
  rival?: RivalInfo | null;
  /** Shown on the pre-game VS card. */
  match?: MatchInfo;
  /** Leave the match (close button in the full-screen HUD). */
  onExit?: () => void;
}

export interface MatchInfo {
  modeLabel: string;
  seedCode?: string;
  rivalName?: string;
  rivalAvatar?: AvatarConfig;
  rivalRating?: number;
  playerName: string;
  playerRating?: number;
}

/**
 * Typical scores by a mid-level player, used to scale bot opponents and tournament fields.
 * Tuned against the 3D games' actual scoring.
 */
export const SCORE_BASELINE: Record<GameId, number> = {
  'neon-dash': 2200,
  'dunk-rush': 2600,
  'cyber-reflex': 6000,
  'gem-surge': 5000,
};
