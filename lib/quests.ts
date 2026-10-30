import type { GameId, MatchMode, RunStats } from './game-types';
import { hashSeed, mulberry32 } from './rng';

/**
 * Daily quests: 4 picked per local day from a pool, deterministic by date,
 * so every player sees the same set on the same day.
 */

export interface DailyQuest {
  id: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  rewardCoins: number;
  rewardXp: number;
  completed: boolean;
  claimed: boolean;
}

export interface QuestEvent {
  gameId: GameId;
  mode: MatchMode;
  score: number;
  stats: RunStats;
  won: boolean;
}

interface QuestDef {
  id: string;
  title: string;
  description: string;
  target: number;
  rewardCoins: number;
  rewardXp: number;
  /** 'max' keeps the best single value, 'sum' accumulates. */
  kind: 'max' | 'sum';
  measure: (e: QuestEvent) => number;
}

const POOL: QuestDef[] = [
  { id: 'neon-score', title: 'Warmup Lap', description: 'Score 1,000+ points in a single Neon Dash run', target: 1000, rewardCoins: 150, rewardXp: 100, kind: 'max', measure: (e) => (e.gameId === 'neon-dash' ? e.score : 0) },
  { id: 'neon-distance', title: 'Long Haul', description: 'Run 600m in a single Neon Dash run', target: 600, rewardCoins: 180, rewardXp: 110, kind: 'max', measure: (e) => (e.gameId === 'neon-dash' ? e.stats.distance ?? 0 : 0) },
  { id: 'dunk-baskets', title: 'Court Dominance', description: 'Sink 5 baskets in Dunk Rush today', target: 5, rewardCoins: 200, rewardXp: 120, kind: 'sum', measure: (e) => (e.gameId === 'dunk-rush' ? e.stats.baskets ?? 0 : 0) },
  { id: 'dunk-streak', title: 'Heat Check', description: 'Hit a 3-basket streak in Dunk Rush', target: 3, rewardCoins: 220, rewardXp: 130, kind: 'max', measure: (e) => (e.gameId === 'dunk-rush' ? e.stats.maxCombo ?? 0 : 0) },
  { id: 'reflex-combo', title: 'Reflex Master', description: 'Reach a 15x streak in Cyber Reflex', target: 15, rewardCoins: 250, rewardXp: 150, kind: 'max', measure: (e) => (e.gameId === 'cyber-reflex' ? e.stats.maxCombo ?? 0 : 0) },
  { id: 'gem-cascade', title: 'Chain Reaction', description: 'Trigger a 3x cascade in Gem Surge', target: 3, rewardCoins: 220, rewardXp: 130, kind: 'max', measure: (e) => (e.gameId === 'gem-surge' ? e.stats.maxCombo ?? 0 : 0) },
  { id: 'gem-score', title: 'Prism Hunter', description: 'Score 2,500+ in a single Gem Surge round', target: 2500, rewardCoins: 200, rewardXp: 120, kind: 'max', measure: (e) => (e.gameId === 'gem-surge' ? e.score : 0) },
  { id: 'duel-wins', title: 'PvP Gladiator', description: 'Win 2 1v1 ranked duels', target: 2, rewardCoins: 300, rewardXp: 200, kind: 'sum', measure: (e) => (e.mode === 'duel' && e.won ? 1 : 0) },
  { id: 'play-three', title: 'Daily Grind', description: 'Finish 3 matches in any mode', target: 3, rewardCoins: 120, rewardXp: 90, kind: 'sum', measure: () => 1 },
  { id: 'tourney-run', title: 'Cup Contender', description: 'Play 1 tournament run', target: 1, rewardCoins: 180, rewardXp: 120, kind: 'sum', measure: (e) => (e.mode === 'tournament' ? 1 : 0) },
];

const DEFS = new Map(POOL.map((q) => [q.id, q]));

export function localDayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function msUntilLocalMidnight(now: number): number {
  const d = new Date(now);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return next.getTime() - now;
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** The day's 4 quests: always one duel quest, plus three others. */
export function questsForDay(dayKey: string): DailyQuest[] {
  const rng = mulberry32(hashSeed(`quests:${dayKey}`));
  const others = POOL.filter((q) => q.id !== 'duel-wins');
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const chosen = [...others.slice(0, 3), DEFS.get('duel-wins')!];
  return chosen.map((q) => ({
    id: q.id,
    title: q.title,
    description: q.description,
    target: q.target,
    progress: 0,
    rewardCoins: q.rewardCoins,
    rewardXp: q.rewardXp,
    completed: false,
    claimed: false,
  }));
}

/** Returns new quest objects with progress applied (pure). */
export function applyQuestEvent(quests: DailyQuest[], event: QuestEvent): DailyQuest[] {
  return quests.map((q) => {
    const def = DEFS.get(q.id);
    if (!def || q.completed) return q;
    const value = def.measure(event);
    const progress = def.kind === 'max' ? Math.max(q.progress, value) : q.progress + value;
    const capped = Math.min(progress, q.target);
    return { ...q, progress: capped, completed: capped >= q.target };
  });
}
