import type { AvatarConfig } from './avatar-types';

export type GameId = 'neon-dash' | 'dunk-rush' | 'cyber-reflex' | 'gem-surge' | 'brick-blitz';
export const GAME_IDS: GameId[] = ['brick-blitz', 'dunk-rush', 'neon-dash', 'cyber-reflex', 'gem-surge'];

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
};

export const MODE_LABEL: Record<MatchMode, string> = {
  practice: 'Practice',
  duel: '1v1',
  tournament: 'Tournament',
  blitz: 'Blitz',
  streak: 'Streak',
  arena: 'Live Arena',
};

/* ------------------------------------------------------------------ stakes & payouts (virtual coins) */

/** Entry tiers offered for paid modes. 0 = free entry. */
export const STAKES = [0, 25, 50, 100, 250] as const;

/** 1v1: winner takes the pot minus a 10% house cut; free 1v1 still pays a small prize. */
export const duelPrize = (entry: number) => (entry === 0 ? 40 : Math.round(entry * 1.8));

/** Live Arena: 5 players, top 3 split 90% of the pot. Free arenas pay small fixed prizes. */
export const ARENA_SIZE = 5;
export const arenaPrizes = (entry: number) => (entry === 0 ? [60, 30, 10] : [Math.round(entry * 2.5), Math.round(entry * 1.4), Math.round(entry * 0.6)]);

/** Streak: beat 3 rising targets in a row. Targets are fractions of the player's typical score. */
export const STREAK_TARGETS = [0.7, 0.95, 1.2];
export const streakPrize = (entry: number) => (entry === 0 ? 100 : entry * 5);

/** Blitz: coins per point, set so a typical score roughly returns the entry (better play profits). Capped at 8× entry. */
export const blitzRate = (entry: number, reference: number) => (entry === 0 ? 30 / reference : entry / (0.9 * reference));
export const blitzPayout = (score: number, entry: number, reference: number) => Math.min(Math.floor(score * blitzRate(entry, reference)), entry === 0 ? 120 : entry * 8);

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
 * Tuned against the 3D games' actual scoring.
 */
export const SCORE_BASELINE: Record<GameId, number> = {
  'neon-dash': 9000,
  'dunk-rush': 2600,
  'cyber-reflex': 6000,
  'gem-surge': 5000,
  'brick-blitz': 10000,
};
