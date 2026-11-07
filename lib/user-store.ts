'use client';
/**
 * The signed-in player's state, loaded from the game server. Nothing here is trusted: balances,
 * inventory, ratings and results all come from the server, and every action is a server call.
 * Components read it with useUserStore(); actions are on userStore.
 */
import { useSyncExternalStore } from 'react';
import type { AvatarConfig, CosmeticCategory, MatchHistoryItem, PlayerStats } from './avatar-types';
import { COSMETICS_CATALOG, getStarterAvatar } from './cosmetics-catalog';
import { GAME_NAMES, type GameId, type MatchMode } from './game-types';
import { itemsOn, withItem } from './avatar-slots';
import type { DailyQuest } from './quests';
import { SEASON_TIERS, type SeasonTierReward } from './season';
import { GUEST, LIVE_SYNC, TEST_AUTH, authConfigured, deviceHash, onSession, signOut, type Session } from './client/auth';

export { SEASON_TIERS };
export type { SeasonTierReward, DailyQuest };

export type Phase = 'loading' | 'unconfigured' | 'signed_out' | 'needs_phone' | 'needs_profile' | 'ready' | 'error';

export interface CashInfo {
  mode: 'off' | 'test' | 'live';
  allowed: boolean;
  region: string | null;
  entries: number[];
  minWithdrawalCents: number;
}

export interface Account {
  phone: string | null;
  kycStatus: 'none' | 'pending' | 'verified' | 'rejected';
  payoutsEnabled: boolean;
  depositLimitCents: number | null;
  selfExcludedUntil: number | null;
  adult: boolean;
  underReview: boolean;
}

export interface Cup {
  id: string;
  title: string;
  badge: string;
  description: string;
  gameId: GameId;
  entry: number;
  currency: 'coins' | 'usd';
  size: number;
  count: number;
  startsAt: number;
  closesAt: number;
  prizeItem: string | null;
  pool: number;
  payoutBps: number[];
  status: string;
  top: { uid: string; username: string; avatar: AvatarConfig | null; score: number | null }[];
  mine: { joined: boolean; played: boolean; score: number | null } | null;
}

export interface LeaderRow {
  uid: string;
  username: string;
  avatar: AvatarConfig | null;
  rating: number;
  crowns: number;
  wins: number;
  losses: number;
  matches: number;
  place: number;
  highScores: Record<string, number>;
}

/** Server match record (users/{uid}/matches/{id}). */
export interface ServerMatch {
  id: string;
  contestId: string | null;
  kind: 'h2h' | 'arena' | 'cup' | 'practice';
  gameId: GameId;
  currency: 'coins' | 'usd';
  entry: number;
  title: string | null;
  status: 'joined' | 'playing' | 'waiting' | 'settled' | 'cancelled';
  at: number;
  closesAt: number | null;
  score: number | null;
  flagged: string | null;
  rank: number | null;
  size: number;
  payout: number;
  ratingDelta: number;
  coins: number;
  xp: number;
  crowns: number;
  prizeItem: string | null;
  opponents: { uid: string; username: string; avatar: AvatarConfig | null; score: number | null; rank: number | null }[];
}

export interface UserState {
  phase: Phase;
  /** Playing without an account (progress on this device; no real-player matches). */
  guest: boolean;
  error: string | null;
  session: { uid: string; phone: string | null; provider: Session['provider'] } | null;
  username: string;
  tagline: string;
  avatar: AvatarConfig;
  stats: PlayerStats;
  cashCents: number;
  inventory: string[];
  matchHistory: MatchHistoryItem[];
  serverMatches: ServerMatch[];
  quests: DailyQuest[];
  questDay: string;
  seasonXp: number;
  seasonTier: number;
  isVip: boolean;
  vipCost: number;
  claimedFreeTiers: number[];
  claimedVipTiers: number[];
  account: Account;
  cash: CashInfo;
  coinEntries: number[];
  cups: Cup[];
  leaderboard: LeaderRow[];
}

export const tierForRating = (rating: number): PlayerStats['tier'] =>
  rating >= 2000 ? 'Apex' : rating >= 1800 ? 'Master' : rating >= 1600 ? 'Diamond' : rating >= 1400 ? 'Platinum' : rating >= 1200 ? 'Gold' : rating >= 1000 ? 'Silver' : 'Bronze';
const seasonTierFor = (xp: number) => SEASON_TIERS.reduce((t, st) => (xp >= st.xpRequired ? Math.max(t, st.tier) : t), 0);
const levelFor = (xp: number) => 1 + Math.floor(xp / 250);
const DEFAULTS = COSMETICS_CATALOG.filter((c) => c.isUnlockedDefault).map((c) => c.id);

function emptyState(phase: Phase): UserState {
  return {
    phase,
    guest: GUEST,
    error: null,
    session: null,
    username: '',
    tagline: '',
    avatar: getStarterAvatar('neutral'),
    stats: { rating: 1200, tier: 'Gold', wins: 0, losses: 0, streak: 0, bestStreak: 0, tournamentsWon: 0, totalMatches: 0, coins: 0, trophies: 0, xp: 0, level: 1, highScores: {} as Record<GameId, number>, crowns: 0 },
    cashCents: 0,
    inventory: DEFAULTS,
    matchHistory: [],
    serverMatches: [],
    quests: [],
    questDay: '',
    seasonXp: 0,
    seasonTier: 0,
    isVip: false,
    vipCost: 1500,
    claimedFreeTiers: [],
    claimedVipTiers: [],
    account: { phone: null, kycStatus: 'none', payoutsEnabled: false, depositLimitCents: null, selfExcludedUntil: null, adult: false, underReview: false },
    cash: { mode: 'off', allowed: false, region: null, entries: [], minWithdrawalCents: 500 },
    coinEntries: [0, 25, 50, 100, 250],
    cups: [],
    leaderboard: [],
  };
}

const SERVER_SNAPSHOT = emptyState('loading');

export class ApiError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

/** Plain-language messages for server error codes. */
export function errorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : e instanceof Error ? e.message : String(e);
  const map: Record<string, string> = {
    insufficient_funds: 'Not enough balance for that.',
    rate_limited: 'Slow down a little and try again.',
    username_taken: 'That name is taken.',
    invalid_username: 'Use 3–16 letters, numbers or _.',
    too_young: 'You must be at least 13 to play.',
    invalid_dob: 'Enter a real date of birth.',
    region_blocked: 'Cash games aren’t available in your location.',
    underage: 'Cash games are 18+.',
    cash_disabled: 'Cash games are switched off right now.',
    self_excluded: 'You’ve paused paid play on this account.',
    account_review: 'Your account is under review. Paid play and withdrawals are paused.',
    account_suspended: 'This account is suspended.',
    id_not_verified: 'Verify your ID before withdrawing.',
    payouts_not_set_up: 'Set up payouts before withdrawing.',
    min_withdrawal: 'The minimum withdrawal is $5.',
    deposit_limit: 'That’s over your daily deposit limit.',
    contest_closed: 'That contest has closed.',
    already_played: 'You already played this one.',
    already_joined: 'You’re already in.',
    quest_not_complete: 'Finish the quest first.',
    already_claimed: 'Already claimed.',
    tier_locked: 'Earn more XP to unlock this tier.',
    not_vip: 'This reward is for VIP pass holders.',
    phone_in_use: 'This phone number already has an account.',
    voip_not_allowed: 'Internet / VoIP and toll-free numbers can’t be used. Use your mobile number.',
    server_not_configured: 'The game server isn’t set up yet.',
    signin_required: 'Matches against real players need an account — sign-in is coming soon.',
    network: 'Can’t reach the server. Check your connection.',
    payout_failed: 'The payout failed and your balance was returned.',
  };
  if (code.startsWith('item_not_owned')) return 'You don’t own that item yet.';
  return map[code] ?? 'Something went wrong. Try again.';
}

function modeOf(kind: ServerMatch['kind']): MatchMode {
  return kind === 'h2h' ? 'duel' : kind === 'cup' ? 'tournament' : kind === 'arena' ? 'arena' : 'practice';
}
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export function historyItem(m: ServerMatch): MatchHistoryItem {
  const opp = m.opponents.slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0];
  const tie = m.kind === 'h2h' && m.status === 'settled' && opp && opp.score === m.score;
  const result: MatchHistoryItem['result'] =
    m.kind === 'practice' ? 'practice' : m.status === 'cancelled' ? 'cancelled' : m.status !== 'settled' ? 'pending' : tie ? 'tie' : m.rank === 1 || (m.kind !== 'h2h' && m.payout > 0) ? 'win' : 'loss';
  return {
    id: m.id,
    contestId: m.contestId,
    gameId: m.gameId,
    gameName: GAME_NAMES[m.gameId] ?? m.gameId,
    mode: modeOf(m.kind),
    date: '',
    at: m.at,
    playerScore: m.score ?? 0,
    opponentScore: opp?.score ?? 0,
    opponentName: m.kind === 'practice' ? 'Practice' : m.kind === 'cup' ? (m.title ?? 'Cup') : (opp?.username ?? (m.status === 'cancelled' ? 'No opponent' : 'Waiting for opponent')),
    opponentAvatar: opp?.avatar ?? getStarterAvatar('neutral'),
    result,
    ratingDelta: m.ratingDelta,
    coinsEarned: m.currency === 'coins' ? m.payout + m.coins : m.coins,
    currency: m.currency,
    payout: m.payout,
    entry: m.entry,
    flagged: m.flagged,
    detail: m.kind === 'practice' ? undefined : m.status === 'cancelled' ? 'Refunded — no opponent' : m.status !== 'settled' ? 'Waiting for results' : m.kind !== 'h2h' && m.rank ? `${ordinal(m.rank)} of ${m.size}` : undefined,
  };
}

/** "$12.50" */
export const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 && cents >= 10000 ? 0 : 2)}`;

type MeResponse = {
  status: 'ready' | 'needs_profile' | 'needs_phone';
  me: null | {
    uid: string; phone: string; username: string | null; avatar: AvatarConfig | null; adult: boolean;
    coins: number; cashCents: number; inventory: string[]; rating: number; crowns: number; xp: number; wins: number; losses: number; matches: number;
    streak: number; bestStreak: number; cupsWon: number; highScores: Record<GameId, number>; isVip: boolean; seasonClaims: { free: number[]; vip: number[] };
    kycStatus: Account['kycStatus']; payoutsEnabled: boolean; depositLimitCents: number | null; selfExcludedUntil: number | null; underReview: boolean;
    quests: DailyQuest[]; questDay: string;
  };
  cash: CashInfo;
  coinEntries: number[];
  vipCost: number;
};

class UserStore {
  private state: UserState = emptyState('loading');
  private listeners = new Set<() => void>();
  private session: Session | null = null;
  private started = false;
  private deviceSent = '';
  private unwatch: (() => void) | null = null;

  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  getState() {
    return this.state;
  }
  private set(patch: Partial<UserState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Begin following the sign-in session (call once, on the client). */
  start() {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    if (!authConfigured()) return this.set({ phase: 'unconfigured' });
    onSession((s) => {
      const prev = this.session?.uid;
      this.session = s;
      if (!s) {
        this.unwatch?.();
        this.unwatch = null;
        this.state = emptyState('signed_out');
        this.listeners.forEach((l) => l());
        return;
      }
      if (prev !== s.uid) this.set({ ...emptyState('loading'), session: { uid: s.uid, phone: s.phone, provider: s.provider } });
      void this.refresh();
    });
  }

  /** Call the game server. */
  async call<T = Record<string, unknown>>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!this.session) throw new ApiError('signed_out', 401);
    if (GUEST) {
      const { guestCall } = await import('./client/guest');
      const r = await guestCall(this.session.uid, fn, args);
      if (!r.ok) throw new ApiError(r.code, r.status);
      return r.data as T;
    }
    const token = await this.session.token();
    let res: Response;
    try {
      res = await fetch('/api/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(TEST_AUTH && testGeo() ? { 'x-ra-test-geo': testGeo()! } : {}) },
        body: JSON.stringify({ fn, args }),
      });
    } catch {
      throw new ApiError('network', 0);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body.error ?? 'server_error', res.status);
    return body as T;
  }

  /** Reload the player from the server. */
  async refresh(opts: { refreshPayouts?: boolean } = {}) {
    if (!this.session) return;
    try {
      const r = await this.call<MeResponse>('me', opts);
      if (r.status === 'needs_phone') return this.set({ phase: 'needs_phone', error: null });
      const me = r.me!;
      const xp = me.xp;
      this.set({
        phase: r.status === 'ready' ? 'ready' : 'needs_profile',
        error: null,
        username: me.username ?? '',
        tagline: `${tierForRating(me.rating)} League`,
        avatar: me.avatar ?? this.state.avatar,
        stats: {
          rating: me.rating, tier: tierForRating(me.rating), wins: me.wins, losses: me.losses, streak: me.streak, bestStreak: me.bestStreak, tournamentsWon: me.cupsWon,
          totalMatches: me.matches, coins: me.coins, trophies: me.crowns, xp, level: levelFor(xp), highScores: me.highScores, crowns: me.crowns,
        },
        cashCents: me.cashCents,
        inventory: [...new Set([...DEFAULTS, ...me.inventory])],
        quests: me.quests,
        questDay: me.questDay,
        seasonXp: xp,
        seasonTier: seasonTierFor(xp),
        isVip: me.isVip,
        vipCost: r.vipCost,
        claimedFreeTiers: me.seasonClaims.free,
        claimedVipTiers: me.seasonClaims.vip,
        account: { phone: me.phone, kycStatus: me.kycStatus, payoutsEnabled: me.payoutsEnabled, depositLimitCents: me.depositLimitCents, selfExcludedUntil: me.selfExcludedUntil, adult: me.adult, underReview: me.underReview },
        cash: r.cash,
        coinEntries: r.coinEntries,
      });
      if (r.status === 'ready') {
        void this.sendDevice();
        void this.refreshHistory();
        this.watch();
      }
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network';
      if (code === 'signed_out') return this.set({ phase: 'signed_out' });
      this.set({ phase: 'error', error: code });
    }
  }

  private async sendDevice() {
    if (GUEST || !this.session || this.deviceSent === this.session.uid) return;
    this.deviceSent = this.session.uid;
    try {
      await this.call('registerDevice', { hash: await deviceHash() });
    } catch {
      /* best effort */
    }
  }

  /** Live wallet updates from Firestore (prizes landing while you're in the app). */
  private watch() {
    if (this.unwatch || !LIVE_SYNC || !this.session) return;
    const uid = this.session.uid;
    let off = () => {};
    let dead = false;
    let first = true;
    void (async () => {
      const { getApps } = await import('firebase/app');
      const { getFirestore, doc, onSnapshot } = await import('firebase/firestore');
        const { FIRESTORE_DB_ID } = await import('@/lib/firestore-db-id');
      if (dead || !getApps()[0]) return;
      off = onSnapshot(
        doc(getFirestore(getApps()[0], FIRESTORE_DB_ID), 'users', uid),
        () => {
          if (first) return void (first = false);
          void this.refresh();
        },
        () => {},
      );
    })();
    this.unwatch = () => {
      dead = true;
      off();
    };
  }

  async refreshHistory() {
    try {
      const { matches } = await this.call<{ matches: ServerMatch[] }>('history');
      this.set({ serverMatches: matches, matchHistory: matches.map(historyItem) });
    } catch {
      /* keep what we have */
    }
  }
  async refreshCups() {
    try {
      const { cups } = await this.call<{ cups: Cup[] }>('cups');
      this.set({ cups });
    } catch {
      /* keep */
    }
  }
  async refreshLeaderboard() {
    try {
      const { rows } = await this.call<{ rows: LeaderRow[] }>('leaderboard');
      this.set({ leaderboard: rows });
    } catch {
      /* keep */
    }
  }

  async completeProfile(username: string, dob: string) {
    await this.call('completeProfile', { username, dob, avatar: this.state.avatar });
    await this.refresh();
  }

  async signOut() {
    this.deviceSent = '';
    await signOut();
  }

  // ------------------------------------------------------------- cosmetics

  owns(itemId: string) {
    return itemId === 'none' || this.state.inventory.includes(itemId);
  }
  lockedItemsIn(avatar: AvatarConfig) {
    return itemsOn(avatar)
      .map((s) => s.id)
      .filter((id) => !this.owns(id));
  }

  private saving: Promise<unknown> = Promise.resolve();
  /** Save the look (optimistic; reverts if the server refuses). Unowned items are never saved. */
  setAvatar(avatar: AvatarConfig) {
    const prev = this.state.avatar;
    const clean = { ...avatar };
    for (const s of itemsOn(avatar)) if (!this.owns(s.id)) Object.assign(clean, withItem(clean, { id: (itemsOn(prev).find((p) => p.category === s.category)?.id ?? 'none'), category: s.category }));
    this.set({ avatar: clean });
    if (this.state.phase !== 'ready' && this.state.phase !== 'needs_profile') return;
    if (this.state.phase === 'needs_profile') return; // saved with the profile
    this.saving = this.saving.then(() => this.call('saveAvatar', { avatar: clean }).catch(() => this.set({ avatar: prev })));
  }

  setUsername(username: string): Promise<string | null> {
    return this.call('setUsername', { username })
      .then(() => this.refresh())
      .then(() => null)
      .catch((e) => errorText(e));
  }

  resetAvatarGender(gender: 'male' | 'female' | 'neutral') {
    this.setAvatar(getStarterAvatar(gender));
  }

  /** Put an OWNED item on the avatar. Locked items are refused. */
  equipCosmetic(category: CosmeticCategory, itemId: string) {
    if (!this.owns(itemId)) return false;
    this.setAvatar(withItem(this.state.avatar, { id: itemId, category }));
    return true;
  }

  /** Buy an item with coins. Resolves true when owned. */
  async unlockCosmetic(itemId: string): Promise<boolean> {
    if (this.owns(itemId)) return true;
    const item = COSMETICS_CATALOG.find((c) => c.id === itemId);
    if (!item || this.state.stats.coins < item.cost) return false;
    try {
      const { coins } = await this.call<{ coins: number }>('buyItem', { itemId });
      this.set({ inventory: [...this.state.inventory, itemId], stats: { ...this.state.stats, coins } });
      return true;
    } catch {
      await this.refresh();
      return this.owns(itemId);
    }
  }

  // ------------------------------------------------------------- rewards

  async claimQuest(questId: string) {
    await this.call('claimQuest', { questId });
    await this.refresh();
  }
  async claimSeasonReward(tier: number, vip: boolean) {
    await this.call('claimSeason', { tier, vip });
    await this.refresh();
  }
  async activateVip() {
    await this.call('activateVip');
    await this.refresh();
  }

  // ------------------------------------------------------------- cash

  async openUrl(fn: 'deposit' | 'kycStart' | 'payoutsOnboard', args: Record<string, unknown> = {}) {
    const { url } = await this.call<{ url: string }>(fn, args);
    window.location.assign(url);
  }
  async withdraw(cents: number) {
    await this.call('withdraw', { cents });
    await this.refresh();
  }
  async setLimits(dailyDepositCents: number | null, selfExcludeDays: number) {
    await this.call('setLimits', { dailyDepositCents, selfExcludeDays });
    await this.refresh();
  }
}

function testGeo() {
  try {
    return localStorage.getItem('ra_test_geo');
  } catch {
    return null;
  }
}

export const userStore = new UserStore();

const subscribe = (l: () => void) => userStore.subscribe(l);
const getSnapshot = () => userStore.getState();
const getServerSnapshot = () => SERVER_SNAPSHOT;

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

/** "3h 20m" until a timestamp. */
export function timeLeft(at: number, now = Date.now()) {
  const s = Math.max(0, Math.floor((at - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
}
