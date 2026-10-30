import { useSyncExternalStore } from 'react';
import { AvatarConfig, CosmeticCategory, MatchHistoryItem, PlayerStats } from './avatar-types';
import { COSMETICS_CATALOG, getStarterAvatar } from './cosmetics-catalog';
import { GAME_NAMES, GameId, MatchMode, RunStats, SCORE_BASELINE } from './game-types';
import { applyQuestEvent, DailyQuest, localDayKey, questsForDay } from './quests';
import { referenceScore } from './bots';
import {
  createTournament,
  settle,
  standings,
  Tournament,
  TOURNAMENT_TEMPLATES,
  tournamentStatus,
} from './tournaments-data';

export type { DailyQuest } from './quests';

export interface SeasonTierReward {
  tier: number;
  xpRequired: number;
  freeReward: { type: 'coins' | 'cosmetic'; value: number | string; name: string };
  vipReward: { type: 'coins' | 'cosmetic'; value: number | string; name: string };
}

export interface UserState {
  version: number;
  username: string;
  tagline: string;
  avatar: AvatarConfig;
  stats: PlayerStats;
  inventory: string[];
  matchHistory: MatchHistoryItem[];
  quests: DailyQuest[];
  questDay: string;
  seasonXp: number;
  seasonTier: number;
  isVip: boolean;
  claimedFreeTiers: number[];
  claimedVipTiers: number[];
  /** Last 5 scores per game (any mode) — drives skill-matched rivals. */
  recentScores: Partial<Record<GameId, number[]>>;
  tournaments: Tournament[];
  tournamentInstance: number;
}

const STORAGE_KEY = 'rival_arcade_user_state_v3';
const LEGACY_KEYS = ['rival_arcade_user_state_v2'];
const STATE_VERSION = 3;

export const SEASON_TIERS: SeasonTierReward[] = [
  { tier: 1, xpRequired: 100, freeReward: { type: 'coins', value: 200, name: '200 Rival Coins' }, vipReward: { type: 'cosmetic', value: 'eyewear_pixel_shades', name: '8-Bit Pixel Shades' } },
  { tier: 2, xpRequired: 250, freeReward: { type: 'coins', value: 300, name: '300 Rival Coins' }, vipReward: { type: 'cosmetic', value: 'trail_cyan_spark', name: 'Cyan Ion Trail' } },
  { tier: 3, xpRequired: 450, freeReward: { type: 'cosmetic', value: 'headwear_beanie', name: 'Skater Slouch Beanie' }, vipReward: { type: 'coins', value: 600, name: '600 Rival Coins' } },
  { tier: 4, xpRequired: 700, freeReward: { type: 'coins', value: 500, name: '500 Rival Coins' }, vipReward: { type: 'cosmetic', value: 'shirt_cyber_jumpsuit', name: 'Vector Carbon Top' } },
  { tier: 5, xpRequired: 1000, freeReward: { type: 'cosmetic', value: 'pose_victory_flex', name: 'Champion Flex Emote' }, vipReward: { type: 'cosmetic', value: 'back_cyber_wings', name: 'Plasma Light Wings' } },
];

export const tierForRating = (rating: number): PlayerStats['tier'] =>
  rating >= 2000 ? 'Apex' : rating >= 1800 ? 'Master' : rating >= 1600 ? 'Diamond' : rating >= 1400 ? 'Platinum' : rating >= 1200 ? 'Gold' : rating >= 1000 ? 'Silver' : 'Bronze';

const seasonTierFor = (xp: number) => SEASON_TIERS.reduce((t, st) => (xp >= st.xpRequired ? Math.max(t, st.tier) : t), 0);
const levelFor = (xp: number) => 1 + Math.floor(xp / 250);

/**
 * Deterministic starting state (no clocks, no randomness) so the server render and the
 * client's first render match. Time-based data (daily quests, tournaments) is filled in on
 * the client right after load.
 */
export function getInitialState(): UserState {
  const starter = getStarterAvatar('neutral');
  const unlockedDefaults = COSMETICS_CATALOG.filter((c) => c.isUnlockedDefault).map((c) => c.id);
  const t0 = 0;
  return {
    version: STATE_VERSION,
    username: 'ApexRival',
    tagline: 'Cyber Contender',
    avatar: starter,
    stats: {
      rating: 1250,
      tier: 'Gold',
      wins: 8,
      losses: 3,
      streak: 3,
      bestStreak: 5,
      tournamentsWon: 1,
      totalMatches: 11,
      coins: 850,
      trophies: 420,
      xp: 320,
      level: levelFor(320),
      highScores: { 'neon-dash': 2450, 'dunk-rush': 18, 'cyber-reflex': 3120, 'gem-surge': 4800 },
    },
    inventory: [...new Set([...unlockedDefaults, 'headwear_snapback'])],
    matchHistory: [
      { id: 'hist-1', gameId: 'neon-dash', gameName: 'Neon Dash', mode: 'duel', date: '', at: t0, playerScore: 2450, opponentScore: 2180, opponentName: 'Viper_X', opponentAvatar: getStarterAvatar('female'), result: 'win', ratingDelta: 24, coinsEarned: 120 },
      { id: 'hist-2', gameId: 'dunk-rush', gameName: 'Dunk Rush', mode: 'duel', date: '', at: t0, playerScore: 18, opponentScore: 15, opponentName: 'GhostJumper', opponentAvatar: getStarterAvatar('male'), result: 'win', ratingDelta: 22, coinsEarned: 110 },
      { id: 'hist-3', gameId: 'gem-surge', gameName: 'Gem Surge', mode: 'tournament', date: '', at: t0, playerScore: 4800, opponentScore: 5100, opponentName: 'PrismQueen', opponentAvatar: getStarterAvatar('female'), result: 'loss', ratingDelta: 0, coinsEarned: 40 },
    ],
    quests: [],
    questDay: '',
    seasonXp: 320,
    seasonTier: seasonTierFor(320),
    isVip: false,
    claimedFreeTiers: [1],
    claimedVipTiers: [],
    recentScores: {},
    tournaments: [],
    tournamentInstance: 0,
  };
}

const SERVER_SNAPSHOT: UserState = getInitialState();

/** Bring any saved shape (older versions, missing fields) up to the current one. */
function migrate(raw: unknown): UserState {
  const base = getInitialState();
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Partial<UserState> & { stats?: Partial<PlayerStats> };
  const stats = { ...base.stats, ...(p.stats ?? {}), highScores: { ...base.stats.highScores, ...(p.stats?.highScores ?? {}) } };
  stats.tier = tierForRating(stats.rating);
  stats.level = levelFor(stats.xp);
  const seasonXp = typeof p.seasonXp === 'number' ? p.seasonXp : base.seasonXp;
  return {
    ...base,
    ...p,
    version: STATE_VERSION,
    avatar: { ...base.avatar, ...(p.avatar ?? {}) },
    stats,
    inventory: Array.isArray(p.inventory) ? [...new Set(p.inventory)] : base.inventory,
    matchHistory: Array.isArray(p.matchHistory) ? p.matchHistory : base.matchHistory,
    // v2 quests had no day stamp and shared object identity with the defaults: rebuild.
    quests: p.version === STATE_VERSION && Array.isArray(p.quests) ? p.quests : [],
    questDay: p.version === STATE_VERSION ? p.questDay ?? '' : '',
    seasonXp,
    seasonTier: seasonTierFor(seasonXp),
    claimedFreeTiers: Array.isArray(p.claimedFreeTiers) ? p.claimedFreeTiers : base.claimedFreeTiers,
    claimedVipTiers: Array.isArray(p.claimedVipTiers) ? p.claimedVipTiers : base.claimedVipTiers,
    recentScores: p.recentScores ?? {},
    tournaments: Array.isArray(p.tournaments) ? p.tournaments : [],
    tournamentInstance: p.tournamentInstance ?? 0,
  };
}

export interface MatchOutcome {
  isWin: boolean;
  isTie: boolean;
  isPractice: boolean;
  ratingDelta: number;
  coinsEarned: number;
  xpEarned: number;
}

export interface TournamentRunOutcome extends MatchOutcome {
  rank: number;
  total: number;
  improved: boolean;
  best: number;
  leader: { name: string; score: number } | null;
}

class UserStore {
  private state: UserState;
  private listeners = new Set<() => void>();
  private hydrated = false;

  constructor() {
    this.state = getInitialState();
  }

  /** Load saved progress (client only). Called lazily on first subscription. */
  private hydrate() {
    if (this.hydrated || typeof window === 'undefined') return;
    this.hydrated = true;
    try {
      let stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        for (const k of LEGACY_KEYS) {
          stored = localStorage.getItem(k);
          if (stored) break;
        }
      }
      this.state = migrate(stored ? JSON.parse(stored) : null);
    } catch (err) {
      console.error('Failed to parse saved user state', err);
      this.state = getInitialState();
    }
    // Seed timestamps for the starter history so it reads "earlier today", not 1970.
    const now = Date.now();
    if (this.state.matchHistory.some((m) => m.at === 0)) {
      const offsets = [10, 60, 180];
      this.state.matchHistory = this.state.matchHistory.map((m, i) => (m.at === 0 ? { ...m, at: now - (offsets[i] ?? 240) * 60_000 } : m));
    }
    this.ensureDaily(false);
    this.syncTournaments(false);
    this.save();
  }

  private save() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (err) {
      console.error('Failed to persist user state', err);
    }
  }

  private commit(next: Partial<UserState>) {
    this.state = { ...this.state, ...next };
    this.save();
    this.listeners.forEach((l) => l());
  }

  subscribe(listener: () => void): () => void {
    this.hydrate();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): UserState {
    this.hydrate();
    return this.state;
  }

  // ------------------------------------------------------------- profile

  /** Fields that hold cosmetic item IDs (must be owned to be saved). */
  private static readonly COSMETIC_FIELDS: (keyof AvatarConfig)[] = ['hairStyleId', 'shirtId', 'pantsId', 'shoesId', 'headwearId', 'eyewearId', 'backId', 'trailId', 'bannerId'];

  /** Items in `avatar` the player doesn't own (previewed but locked). */
  lockedItemsIn(avatar: AvatarConfig): string[] {
    return UserStore.COSMETIC_FIELDS.map((f) => String(avatar[f])).filter((id) => id !== 'none' && !this.state.inventory.includes(id));
  }

  /** Save appearance. Locked (unowned) items are never saved — those slots keep what was equipped. */
  setAvatar(avatar: AvatarConfig) {
    const current = this.state.avatar;
    const next = { ...avatar } as Record<string, unknown>;
    for (const f of UserStore.COSMETIC_FIELDS) {
      const id = String(avatar[f]);
      if (id !== 'none' && !this.state.inventory.includes(id)) next[f] = current[f];
    }
    if (avatar.pose === 'victory' && !this.state.inventory.includes('pose_victory_flex')) next.pose = current.pose;
    this.commit({ avatar: next as unknown as AvatarConfig });
  }

  setUsername(username: string) {
    const clean = username.replace(/[^\w\- .]/g, '').trim().slice(0, 16);
    if (!clean) return false;
    this.commit({ username: clean });
    return true;
  }

  resetAvatarGender(gender: 'male' | 'female' | 'neutral') {
    this.commit({ avatar: getStarterAvatar(gender) });
  }

  equipCosmetic(category: CosmeticCategory, itemId: string) {
    if (itemId !== 'none' && !this.state.inventory.includes(itemId)) return false;
    const a = { ...this.state.avatar };
    const field: Partial<Record<CosmeticCategory, keyof AvatarConfig>> = {
      hair: 'hairStyleId', shirt: 'shirtId', pants: 'pantsId', shoes: 'shoesId', headwear: 'headwearId',
      eyewear: 'eyewearId', back: 'backId', trail: 'trailId', banner: 'bannerId',
    };
    if (category === 'pose') a.pose = itemId === 'pose_victory_flex' ? 'victory' : 'ready';
    else if (field[category]) (a as Record<string, unknown>)[field[category]!] = itemId;
    this.commit({ avatar: a });
    return true;
  }

  unlockCosmetic(itemId: string): boolean {
    const item = COSMETICS_CATALOG.find((c) => c.id === itemId);
    if (!item) return false;
    if (this.state.inventory.includes(itemId)) return true;
    if (this.state.stats.coins < item.cost) return false;
    this.commit({
      stats: { ...this.state.stats, coins: this.state.stats.coins - item.cost },
      inventory: [...this.state.inventory, itemId],
    });
    return true;
  }

  /** Wipe all progress back to a fresh account. */
  resetProgress() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
    this.state = getInitialState();
    this.hydrated = false;
    this.hydrate();
    this.listeners.forEach((l) => l());
  }

  // ------------------------------------------------------------- matches

  /** Skill reference for bot opponents in this game. */
  referenceFor(gameId: GameId) {
    return referenceScore(gameId, this.state.recentScores[gameId]);
  }

  private applyRun(params: {
    gameId: GameId;
    mode: MatchMode;
    playerScore: number;
    stats: RunStats;
    opponentScore: number;
    opponentName: string;
    opponentAvatar: AvatarConfig;
    opponentRating?: number;
    extra?: Partial<UserState>;
  }): MatchOutcome {
    const { gameId, mode, playerScore, stats: run, opponentScore, opponentName, opponentAvatar } = params;
    const isPractice = mode === 'practice';
    const isTournament = mode === 'tournament';
    const isWin = !isPractice && playerScore > opponentScore;
    const isTie = !isPractice && playerScore === opponentScore;
    const s = { ...this.state.stats, highScores: { ...this.state.stats.highScores } };

    let ratingDelta = 0;
    let coinsEarned: number;
    const xpEarned = isPractice ? 30 : isTournament ? 60 : isWin ? 100 : 40;
    const skill = Math.min(1, playerScore / SCORE_BASELINE[gameId]);

    if (mode === 'duel') {
      const opp = params.opponentRating ?? s.rating;
      const expected = 1 / (1 + Math.pow(10, (opp - s.rating) / 400));
      const actual = isWin ? 1 : isTie ? 0.5 : 0;
      ratingDelta = Math.round(32 * (actual - expected));
      if (isWin && ratingDelta < 4) ratingDelta = 4;
      if (!isWin && !isTie && ratingDelta > -4) ratingDelta = -4;
      coinsEarned = isWin ? 100 + Math.min(s.streak, 5) * 10 : isTie ? 50 : 30;
      s.totalMatches += 1;
      if (isWin) {
        s.wins += 1;
        s.streak += 1;
        s.bestStreak = Math.max(s.bestStreak, s.streak);
        s.trophies += 15;
      } else if (!isTie) {
        s.losses += 1;
        s.streak = 0;
        s.trophies = Math.max(0, s.trophies - 5);
      }
      s.rating = Math.max(500, s.rating + ratingDelta);
      s.tier = tierForRating(s.rating);
    } else if (isTournament) {
      coinsEarned = Math.round(10 + 20 * skill);
    } else {
      coinsEarned = Math.round(15 + 35 * skill);
    }

    s.coins += coinsEarned;
    s.xp += xpEarned;
    s.level = levelFor(s.xp);
    if (playerScore > (s.highScores[gameId] || 0)) s.highScores[gameId] = playerScore;

    const now = Date.now();
    const historyItem: MatchHistoryItem = {
      id: `match-${now}-${Math.floor(Math.random() * 1e4)}`,
      gameId,
      gameName: GAME_NAMES[gameId],
      mode,
      date: '',
      at: now,
      playerScore,
      opponentScore,
      opponentName,
      opponentAvatar,
      result: isPractice ? 'practice' : isWin ? 'win' : isTie ? 'tie' : 'loss',
      ratingDelta,
      coinsEarned,
    };

    this.ensureDaily(false);
    const quests = applyQuestEvent(this.state.quests, { gameId, mode, score: playerScore, stats: run, won: isWin });
    const recent = [...(this.state.recentScores[gameId] ?? []), playerScore].slice(-5);
    const seasonXp = this.state.seasonXp + xpEarned;

    this.commit({
      stats: s,
      matchHistory: [historyItem, ...this.state.matchHistory].slice(0, 25),
      quests,
      recentScores: { ...this.state.recentScores, [gameId]: recent },
      seasonXp,
      seasonTier: seasonTierFor(seasonXp),
      ...params.extra,
    });

    return { isWin, isTie, isPractice, ratingDelta, coinsEarned, xpEarned };
  }

  recordMatchResult(params: {
    gameId: GameId;
    mode: 'practice' | 'duel';
    playerScore: number;
    stats?: RunStats;
    opponentScore: number;
    opponentName?: string;
    opponentAvatar?: AvatarConfig;
    opponentRating?: number;
  }): MatchOutcome {
    return this.applyRun({
      ...params,
      stats: params.stats ?? {},
      opponentName: params.opponentName ?? 'Target Practice',
      opponentAvatar: params.opponentAvatar ?? getStarterAvatar('neutral'),
    });
  }

  // ------------------------------------------------------------- quests

  ensureDaily(notify = true) {
    if (typeof window === 'undefined') return;
    const today = localDayKey(Date.now());
    if (this.state.questDay === today && this.state.quests.length) return;
    const next = { quests: questsForDay(today), questDay: today };
    if (notify) this.commit(next);
    else this.state = { ...this.state, ...next };
  }

  claimQuest(questId: string) {
    const q = this.state.quests.find((item) => item.id === questId);
    if (!q || !q.completed || q.claimed) return false;
    const xp = this.state.stats.xp + q.rewardXp;
    const seasonXp = this.state.seasonXp + q.rewardXp;
    this.commit({
      quests: this.state.quests.map((item) => (item.id === questId ? { ...item, claimed: true } : item)),
      stats: { ...this.state.stats, coins: this.state.stats.coins + q.rewardCoins, xp, level: levelFor(xp) },
      seasonXp,
      seasonTier: seasonTierFor(seasonXp),
    });
    return true;
  }

  // ------------------------------------------------------------- season pass

  claimSeasonReward(tier: number, isVipReward: boolean) {
    const tierData = SEASON_TIERS.find((t) => t.tier === tier);
    if (!tierData || this.state.seasonXp < tierData.xpRequired) return false;
    const claimed = isVipReward ? this.state.claimedVipTiers : this.state.claimedFreeTiers;
    if (claimed.includes(tier) || (isVipReward && !this.state.isVip)) return false;

    const r = isVipReward ? tierData.vipReward : tierData.freeReward;
    const stats = { ...this.state.stats };
    let inventory = this.state.inventory;
    if (r.type === 'coins') stats.coins += Number(r.value);
    else if (!inventory.includes(String(r.value))) inventory = [...inventory, String(r.value)];

    this.commit({
      stats,
      inventory,
      ...(isVipReward ? { claimedVipTiers: [...claimed, tier] } : { claimedFreeTiers: [...claimed, tier] }),
    });
    return true;
  }

  activateVip() {
    this.commit({ isVip: true });
  }

  // ------------------------------------------------------------- tournaments

  /**
   * Keep one cup per template alive: create missing ones, settle cups whose window closed,
   * and replace finished cups (once any prize is claimed) with freshly scheduled ones.
   */
  syncTournaments(notify = true) {
    if (typeof window === 'undefined') return;
    const now = Date.now();
    let changed = false;
    let instance = this.state.tournamentInstance;
    const firstRun = this.state.tournaments.length === 0;
    const initialProgress: Record<string, number | undefined> = { 'neon-gp': 0.35, 'dunk-shootout': 0.2, 'reflex-major': undefined, 'gem-flash': 0.4 };

    const list = TOURNAMENT_TEMPLATES.map((tpl) => {
      let t = this.state.tournaments.find((x) => x.templateId === tpl.templateId);
      const ref = this.referenceFor(tpl.gameId);

      if (!t) {
        changed = true;
        return createTournament(tpl, now, ++instance, ref, firstRun ? { progress: initialProgress[tpl.templateId], startDelayMin: 15 } : {});
      }

      if (tournamentStatus(t, now) === 'completed') {
        if (t.entered && !t.result) {
          t = { ...t, result: settle(t, this.state.inventory) };
          changed = true;
        }
        // Not entered, or prize already claimed → schedule the next cup.
        if (!t.entered || t.result?.claimed) {
          changed = true;
          return createTournament(tpl, now, ++instance, ref);
        }
      }
      return t;
    });

    if (!changed) return;
    const next = { tournaments: list, tournamentInstance: instance };
    if (notify) this.commit(next);
    else this.state = { ...this.state, ...next };
  }

  private updateTournament(id: string, patch: (t: Tournament) => Tournament) {
    return this.state.tournaments.map((t) => (t.id === id ? patch(t) : t));
  }

  enterTournament(id: string): { ok: true } | { ok: false; reason: string } {
    const t = this.state.tournaments.find((x) => x.id === id);
    if (!t) return { ok: false, reason: 'This cup is no longer available.' };
    if (t.entered) return { ok: true };
    if (tournamentStatus(t, Date.now()) === 'completed') return { ok: false, reason: 'This cup has ended.' };
    if (this.state.stats.coins < t.entryFee) return { ok: false, reason: `You need ${t.entryFee} Rival Coins to enter.` };
    this.commit({
      stats: { ...this.state.stats, coins: this.state.stats.coins - t.entryFee },
      tournaments: this.updateTournament(id, (x) => ({ ...x, entered: true })),
    });
    return { ok: true };
  }

  submitTournamentRun(id: string, score: number, stats: RunStats = {}): TournamentRunOutcome | null {
    const t = this.state.tournaments.find((x) => x.id === id);
    if (!t || !t.entered || tournamentStatus(t, Date.now()) !== 'live') return null;
    const best = Math.max(t.userBest ?? 0, score);
    const improved = t.userBest === null || score > t.userBest;
    const updated: Tournament = { ...t, userBest: best, attempts: t.attempts + 1 };
    const table = standings(updated, Date.now(), { name: this.state.username, avatar: this.state.avatar });
    const me = table.find((r) => r.isUser)!;
    const leaderRow = table.find((r) => !r.isUser) ?? null;
    const outcome = this.applyRun({
      gameId: t.gameId,
      mode: 'tournament',
      playerScore: score,
      stats,
      opponentScore: leaderRow?.score ?? 0,
      opponentName: leaderRow ? `${t.title} #${leaderRow.rank}` : t.title,
      opponentAvatar: getStarterAvatar('neutral'),
      extra: { tournaments: this.updateTournament(id, () => updated) },
    });
    return { ...outcome, rank: me.rank, total: table.length, improved, best, leader: leaderRow ? { name: leaderRow.name, score: leaderRow.score } : null };
  }

  claimTournament(id: string) {
    const t = this.state.tournaments.find((x) => x.id === id);
    if (!t?.result || t.result.claimed) return null;
    const r = t.result;
    const stats = { ...this.state.stats };
    stats.coins += r.coins + (r.cosmeticAsCoins ?? 0);
    if (r.rank === 1) {
      stats.tournamentsWon += 1;
      stats.trophies += 50;
    } else if (r.rank <= 3) {
      stats.trophies += 20;
    }
    const inventory = r.cosmetic && !this.state.inventory.includes(r.cosmetic) ? [...this.state.inventory, r.cosmetic] : this.state.inventory;
    this.commit({ stats, inventory, tournaments: this.updateTournament(id, (x) => ({ ...x, result: { ...r, claimed: true } })) });
    this.syncTournaments();
    return r;
  }
}

export const userStore = new UserStore();

const subscribe = (onStoreChange: () => void) => userStore.subscribe(onStoreChange);
const getSnapshot = () => userStore.getState();
const getServerSnapshot = () => SERVER_SNAPSHOT;

/** SSR-safe hook: server and first client render use the deterministic snapshot. */
export function useUserStore(): UserState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** "5m ago" style label for history rows. */
export function timeAgo(at: number | undefined, now = Date.now()): string {
  if (!at) return '';
  const m = Math.floor((now - at) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
