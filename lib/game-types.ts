import type { AvatarConfig } from './avatar-types';

export type GameId = 'neon-dash' | 'dunk-rush' | 'cyber-reflex' | 'gem-surge' | 'brick-blitz' | 'canopy-swing';
export const GAME_IDS: GameId[] = ['brick-blitz', 'dunk-rush', 'canopy-swing', 'neon-dash', 'cyber-reflex', 'gem-surge'];

/**
 * practice   free, no stakes
 * duel       1v1: both players stake the same entry, best score takes the prize
 * blitz      every point pays coins instantly
 * streak     beat 3 rising targets in a row for a 5× prize
 * arena      5-player live match, top 3 paid
 * tournament scheduled cups (Arena tab)
 */
export type MatchMode = 'practice' | 'duel' | 'tournament' | 'blitz' | 'streak' | 'arena';

export const GAME_NAMES: Record<GameId, string> = {
  'neon-dash': 'Neon Dash',
  'dunk-rush': 'Dunk Rush',
  'cyber-reflex': 'Cyber Reflex',
  'gem-surge': 'Gem Surge',
  'brick-blitz': 'Brick Blitz',
  'canopy-swing': 'Canopy Swing',
};

export const MODE_LABEL: Record<MatchMode, string> = {
  practice: 'Practice',
  duel: '1v1',
  tournament: 'Cup',
  blitz: 'Blitz',
  streak: 'Streak',
  arena: 'Live Arena',
};

/* ------------------------------------------------------------------ stakes & payouts (mirrors the server) */

/** Coin entry tiers. 0 = free entry. */
export const STAKES = [0, 25, 50, 100, 250] as const;
/** Pots pay out after a 10% service fee. */
export const RAKE = 0.1;

/** 1v1: winner takes both entries minus the fee; free 1v1s pay 40 coins. Cash amounts are in cents. */
export const duelPrize = (entry: number) => (entry === 0 ? 40 : Math.floor(entry * 2 * (1 - RAKE)));

/** Live Arena: 5 players, 1st/2nd/3rd share the pot 50/30/20. Free arenas share 120 coins. */
export const ARENA_SIZE = 5;
export const arenaPrizes = (entry: number) => {
  const pool = entry === 0 ? 120 : Math.floor(entry * ARENA_SIZE * (1 - RAKE));
  return [0.5, 0.3, 0.2].map((f) => Math.floor(pool * f));
};

/** Legacy solo-target modes (no longer offered: solo play is free practice). */
export const STREAK_TARGETS = [0.7, 0.95, 1.2];

/* ------------------------------------------------------------------ leagues (crowns) */

export const LEAGUES = [
  { name: 'Bronze', crowns: 0, color: '#c2773b' },
  { name: 'Silver', crowns: 10, color: '#cbd5e1' },
  { name: 'Gold', crowns: 25, color: '#facc15' },
  { name: 'Platinum', crowns: 50, color: '#5eead4' },
  { name: 'Diamond', crowns: 90, color: '#7dd3fc' },
  { name: 'Champion', crowns: 150, color: '#f472b6' },
] as const;

export function leagueFor(crowns: number) {
  let i = 0;
  LEAGUES.forEach((l, idx) => {
    if (crowns >= l.crowns) i = idx;
  });
  const next = LEAGUES[i + 1];
  return { ...LEAGUES[i], index: i, next: next ?? null, progress: next ? (crowns - LEAGUES[i].crowns) / (next.crowns - LEAGUES[i].crowns) : 1 };
}

/** What a finished run reports, beyond the score. Drives quests and history. */
export interface RunStats {
  maxCombo?: number;
  baskets?: number;
  distance?: number;
  /** Canopy Swing: vines caught. */
  vines?: number;
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

/**
 * Mode-specific extras the match flow hands to the game HUD (via React context, so each
 * game doesn't have to thread them through).
 */
export interface MatchExtras {
  mode: MatchMode;
  /** Fired when the countdown hits GO (entry fees are charged here, not on open). */
  onStarted?: () => void;
  entry?: number;
  /** One line on the ready card, e.g. "Entry 50 · Winner takes 90". */
  stakeLine?: string;
  /** Blitz: coins earned per point, shown live in the HUD, capped. */
  coinRate?: number;
  coinCap?: number;
  /** Live Arena: the other players, whose scores climb live during the round. */
  field?: RivalInfo[];
  /** Streak: which round of how many, and how many already cleared. */
  round?: { index: number; total: number };
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
 * Every game scores 1 point per action (see lib/scoring.ts), so these are small numbers.
 */
export const SCORE_BASELINE: Record<GameId, number> = {
  'neon-dash': 70,
  'dunk-rush': 40,
  'cyber-reflex': 90,
  'gem-surge': 150,
  // Endless survival: a steady player clears ~40–50 rows.
  'brick-blitz': 220,
  // Endless distance score (1 per 2 m): a steady player flows ~400 m before a slip.
  'canopy-swing': 200,
};

/** Baselines before the 1-point scoring (v1), for rescaling old saves. */
export const LEGACY_SCORE_BASELINE: Partial<Record<GameId, number>> = {
  'neon-dash': 9000,
  'dunk-rush': 2600,
  'cyber-reflex': 6000,
  'gem-surge': 5000,
  'brick-blitz': 90000,
};
/** Bump when the scoring scale changes; saves with an older scale are rescaled on load. */
export const SCORE_SCALE = 2;
