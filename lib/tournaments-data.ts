import type { AvatarConfig } from './avatar-types';
import { botAvatar, botName, botScore } from './bots';
import { GAME_NAMES, GameId } from './game-types';
import { hashSeed, mulberry32 } from './rng';

/**
 * Asynchronous score-attack tournaments.
 *
 * Each cup has a registration window, then a live window where entrants submit runs on the
 * same seed (best run counts). Bot entrants post their scores at staggered times so the
 * bracket fills in live. When the window closes the cup settles, the player claims any
 * prize, and a fresh cup from the same template is scheduled.
 */

export interface TournamentTemplate {
  templateId: string;
  title: string;
  gameId: GameId;
  badge: string;
  description: string;
  entryFee: number;
  prizePoolCoins: number;
  prizeCosmetic?: string;
  maxParticipants: number;
  durationMin: number;
}

export const TOURNAMENT_TEMPLATES: TournamentTemplate[] = [
  {
    templateId: 'neon-gp',
    title: 'Neon Dash Grand Prix',
    gameId: 'neon-dash',
    badge: 'Daily Cup',
    description: 'High-speed rooftop sprint. Best run on the cup seed takes 1st place and the Phoenix Crimson Flare trail!',
    entryFee: 0,
    prizePoolCoins: 2500,
    prizeCosmetic: 'trail_crimson_burn',
    maxParticipants: 32,
    durationMin: 20,
  },
  {
    templateId: 'dunk-shootout',
    title: 'Sub-Zero 3-Point Shootout',
    gameId: 'dunk-rush',
    badge: 'Pro Bracket',
    description: '45-second swish frenzy with a moving hoop. Champion receives Aureus Court Cleats and the lion’s share of the pool!',
    entryFee: 100,
    prizePoolCoins: 4000,
    prizeCosmetic: 'shoes_gold_cleats',
    maxParticipants: 16,
    durationMin: 40,
  },
  {
    templateId: 'reflex-major',
    title: 'Matrix Reflex Championship',
    gameId: 'cyber-reflex',
    badge: 'Weekly Major',
    description: 'Ultra-low latency target deflection. Test your reactions against the whole field on one shared seed!',
    entryFee: 0,
    prizePoolCoins: 5000,
    prizeCosmetic: 'eyewear_speed_shades',
    maxParticipants: 64,
    durationMin: 45,
  },
  {
    templateId: 'gem-flash',
    title: 'Cascade Prism Invitational',
    gameId: 'gem-surge',
    badge: 'Flash Event',
    description: '60-second cascade clash. Chain big cascades for maximum multipliers!',
    entryFee: 50,
    prizePoolCoins: 1800,
    prizeCosmetic: 'shirt_retro_tracksuit',
    maxParticipants: 24,
    durationMin: 10,
  },
];

export interface TournamentBot {
  name: string;
  avatarSeed: number;
  score: number;
  submitAt: number;
}

export interface TournamentResult {
  rank: number;
  total: number;
  coins: number;
  cosmetic?: string;
  /** Prize cosmetic already owned → paid out as coins instead. */
  cosmeticAsCoins?: number;
  claimed: boolean;
}

export interface Tournament extends TournamentTemplate {
  id: string;
  seed: number;
  startsAt: number;
  endsAt: number;
  bots: TournamentBot[];
  entered: boolean;
  userBest: number | null;
  attempts: number;
  result?: TournamentResult;
}

export type TournamentStatus = 'registering' | 'live' | 'completed';

export interface StandingRow {
  rank: number;
  name: string;
  avatar: AvatarConfig | null;
  avatarSeed?: number;
  score: number;
  isUser?: boolean;
}

export function tournamentStatus(t: Tournament, now: number): TournamentStatus {
  if (now < t.startsAt) return 'registering';
  if (now < t.endsAt) return 'live';
  return 'completed';
}

/**
 * Build one cup. `progress` (0–1) lets the very first set of cups start part-way through,
 * so a new player lands in an arena that is already busy.
 */
export function createTournament(
  template: TournamentTemplate,
  now: number,
  instance: number,
  reference: number,
  opts: { progress?: number; startDelayMin?: number } = {},
): Tournament {
  const id = `${template.templateId}-${instance}`;
  const seed = hashSeed(`${id}:${Math.floor(now / 60000)}`);
  const rng = mulberry32(seed);
  const duration = template.durationMin * 60_000;
  let startsAt: number;
  if (opts.progress !== undefined) startsAt = now - duration * opts.progress;
  else startsAt = now + (opts.startDelayMin ?? 3 + Math.floor(rng() * 6)) * 60_000;
  const endsAt = startsAt + duration;

  const botCount = Math.max(3, template.maxParticipants - 2 - Math.floor(rng() * 4));
  const taken = new Set<string>();
  const bots: TournamentBot[] = [];
  for (let i = 0; i < botCount; i++) {
    bots.push({
      name: botName(rng, taken),
      avatarSeed: Math.floor(rng() * 1e9),
      // Field spans weaker to stronger than the player's typical score; the top few are tough.
      score: botScore(rng, reference, 0.45, 1.3),
      submitAt: startsAt + rng() * duration * 0.95,
    });
  }

  return { ...template, id, seed, startsAt, endsAt, bots, entered: false, userBest: null, attempts: 0 };
}

/** Bots that have posted a score by `now` (all of them once the cup has ended). */
export function submittedBots(t: Tournament, now: number) {
  return now >= t.endsAt ? t.bots : t.bots.filter((b) => b.submitAt <= now);
}

export function participantsCount(t: Tournament) {
  return Math.min(t.maxParticipants, t.bots.length + (t.entered ? 1 : 0));
}

export function standings(t: Tournament, now: number, user: { name: string; avatar: AvatarConfig }): StandingRow[] {
  const rows: StandingRow[] = submittedBots(t, now).map((b) => ({ rank: 0, name: b.name, avatar: null, avatarSeed: b.avatarSeed, score: b.score }));
  if (t.userBest !== null) rows.push({ rank: 0, name: `${user.name} (You)`, avatar: user.avatar, score: t.userBest, isUser: true });
  // Ties go to whoever posted first; the player's latest run is treated as later.
  rows.sort((a, b) => b.score - a.score || (a.isUser ? 1 : b.isUser ? -1 : 0));
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export function botRowAvatar(row: StandingRow): AvatarConfig {
  return row.avatar ?? botAvatar(row.avatarSeed ?? 0);
}

/** Final placement & payout for an entered cup. */
export function settle(t: Tournament, ownedCosmetics: string[]): TournamentResult {
  const total = t.bots.length + 1;
  const best = t.userBest ?? 0;
  const better = t.bots.filter((b) => b.score > best).length;
  const rank = t.userBest === null ? total : better + 1;
  const pool = t.prizePoolCoins;

  let coins: number;
  if (t.userBest === null) coins = 0;
  else if (rank === 1) coins = Math.round(pool * 0.5);
  else if (rank === 2) coins = Math.round(pool * 0.25);
  else if (rank === 3) coins = Math.round(pool * 0.12);
  else if (rank <= Math.ceil(total / 2)) coins = Math.max(40, Math.round(t.entryFee * 1.5));
  else coins = 15;

  const result: TournamentResult = { rank, total, coins, claimed: false };
  if (rank === 1 && t.userBest !== null && t.prizeCosmetic) {
    if (ownedCosmetics.includes(t.prizeCosmetic)) result.cosmeticAsCoins = 400;
    else result.cosmetic = t.prizeCosmetic;
  }
  return result;
}

export function formatTimeLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

export const gameNameOf = (t: Tournament) => GAME_NAMES[t.gameId];
