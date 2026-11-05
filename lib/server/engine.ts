/**
 * RivalArcade game server: accounts, wallets, matchmaking, anti-cheat, settlement, rewards and
 * cash. Runs only on the server (Next.js route handlers) with admin access to the store; the
 * client can never write data directly. Every balance change is a ledger entry written in the
 * same transaction as the balance, with a deterministic id so a retried request can't pay twice.
 */
import type { AvatarConfig } from '../avatar-types';
import { COSMETICS_CATALOG } from '../cosmetics-catalog';
import { itemsOn } from '../avatar-slots';
import { SEASON_TIERS } from '../season';
import { questsForDay } from '../quests';
import type { Data, Row, Store, Tx } from './store';

// ============================================================================ config

export const CONFIG = {
  /** States where paid skill contests are commonly restricted. Have counsel confirm before launch. */
  blockedRegions: (process.env.CASH_BLOCKED_REGIONS ?? 'US-AZ,US-AR,US-CT,US-DE,US-LA,US-MT,US-SC,US-SD,US-TN').split(',').map((s) => s.trim()).filter(Boolean),
  allowedCountries: ['US'],
  minCashAge: 18,
  minAge: 13,
  rakeBps: 1000, // 10% service fee on paid pots
  maxDailyDepositCents: 50_000,
  maxAccountsPerDevice: 2,
  practiceCoinCapDaily: 300,
  signupCoins: 850,
  vipCost: 1500,
  minWithdrawalCents: 500,
  coinEntries: [0, 25, 50, 100, 250],
  cashEntries: [100, 200, 500, 1000, 2000],
  contestHours: 24,
};

export interface GameRule {
  timed: boolean;
  roundSeconds: number;
  maxScore: number;
  maxPointsPerSec: number;
  maxDurationS: number;
  baseline: number;
}
/** Per-game limits used to reject impossible scores. Timed games run 60s. */
export const GAME_RULES: Record<string, GameRule> = {
  'dunk-rush': { timed: true, roundSeconds: 60, maxScore: 500, maxPointsPerSec: 9, maxDurationS: 600, baseline: 40 },
  'neon-dash': { timed: true, roundSeconds: 60, maxScore: 600, maxPointsPerSec: 11, maxDurationS: 600, baseline: 70 },
  'cyber-reflex': { timed: true, roundSeconds: 60, maxScore: 700, maxPointsPerSec: 13, maxDurationS: 600, baseline: 90 },
  'gem-surge': { timed: true, roundSeconds: 60, maxScore: 1600, maxPointsPerSec: 30, maxDurationS: 600, baseline: 150 },
  'brick-blitz': { timed: false, roundSeconds: 0, maxScore: 5000, maxPointsPerSec: 6, maxDurationS: 3600, baseline: 220 },
  'canopy-swing': { timed: false, roundSeconds: 0, maxScore: 3000, maxPointsPerSec: 6, maxDurationS: 3600, baseline: 45 },
};

export interface CupTemplate {
  id: string;
  gameId: string;
  title: string;
  badge: string;
  description: string;
  entry: number;
  size: number;
  hours: number;
  prizeItem?: string;
  /** Coin pool for free cups (paid cups pay out the entry pot). */
  freePool: number;
}
export const CUPS: CupTemplate[] = [
  { id: 'neon-gp', gameId: 'neon-dash', title: 'Neon Dash Grand Prix', badge: 'Daily Cup', description: 'Best run on the cup seed takes 1st and the Phoenix Crimson Flare trail.', entry: 0, size: 64, hours: 6, prizeItem: 'trail_crimson_burn', freePool: 1000 },
  { id: 'dunk-shootout', gameId: 'dunk-rush', title: 'Sub-Zero 3-Point Shootout', badge: 'Pro Bracket', description: 'Moving-hoop swish frenzy. The champion takes Aureus Court Cleats.', entry: 100, size: 32, hours: 12, prizeItem: 'shoes_gold_cleats', freePool: 0 },
  { id: 'reflex-major', gameId: 'cyber-reflex', title: 'Matrix Reflex Championship', badge: 'Weekly Major', description: 'Same targets for the whole field. Fastest hands win.', entry: 0, size: 64, hours: 24, prizeItem: 'eyewear_speed_shades', freePool: 1500 },
  { id: 'gem-flash', gameId: 'gem-surge', title: 'Gem Surge Flash Cup', badge: 'Flash', description: 'A short sprint cup on one shared board.', entry: 50, size: 32, hours: 3, prizeItem: 'shirt_retro_tracksuit', freePool: 0 },
  { id: 'canopy-classic', gameId: 'canopy-swing', title: 'Canopy Swing Classic', badge: 'New Game Cup', description: 'Same jungle for everyone. Swing the furthest to take the Jade Spirit Blade.', entry: 25, size: 32, hours: 8, prizeItem: 'back_jade_blade', freePool: 0 },
];
const CUP_BPS = [3500, 2200, 1500, 1000, 800, 600, 400];

const QUEST_METRIC: Record<string, string> = {
  'neon-score': 'neon-dash:score:max',
  'neon-distance': 'neon-dash:distance:max',
  'dunk-baskets': 'dunk-rush:baskets:sum',
  'dunk-streak': 'dunk-rush:maxCombo:max',
  'reflex-combo': 'cyber-reflex:maxCombo:max',
  'gem-cascade': 'gem-surge:maxCombo:max',
  'gem-score': 'gem-surge:score:max',
  'swing-vines': 'canopy-swing:vines:max',
  'swing-fire': 'canopy-swing:maxCombo:max',
  'duel-wins': 'h2hWins',
  'play-three': 'runs',
  'tourney-run': 'cupRuns',
};

// ============================================================================ types

export class AppError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}
const fail = (code: string, status = 400): never => {
  throw new AppError(code, status);
};

export type Currency = 'coins' | 'usd';
export type ContestKind = 'h2h' | 'arena' | 'cup';

export interface Daily {
  day: string;
  runs: number;
  h2hWins: number;
  cupRuns: number;
  practiceCoins: number;
  stat: Record<string, number>;
  claimed: string[];
}

export interface UserDoc {
  uid: string;
  phone: string;
  email: string | null;
  username: string | null;
  usernameLower: string | null;
  dob: string | null;
  avatar: AvatarConfig | null;
  coins: number;
  cashCents: number;
  inventory: string[];
  rating: number;
  crowns: number;
  xp: number;
  wins: number;
  losses: number;
  matches: number;
  streak: number;
  bestStreak: number;
  cupsWon: number;
  highScores: Record<string, number>;
  isVip: boolean;
  seasonClaims: { free: number[]; vip: number[] };
  kycStatus: 'none' | 'pending' | 'verified' | 'rejected';
  kycDob: string | null;
  stripeCustomerId: string | null;
  stripeAccountId: string | null;
  payoutsEnabled: boolean;
  depositLimitCents: number | null;
  selfExcludedUntil: number | null;
  banned: boolean;
  banReason: string | null;
  riskFlags: string[];
  devices: string[];
  lastRegion: string | null;
  lineType: string | null;
  daily: Daily;
  rate: Record<string, number[]>;
  deposits: { at: number; cents: number }[];
  createdAt: number;
  updatedAt: number;
}

export interface ContestDoc {
  id: string;
  kind: ContestKind;
  gameId: string;
  currency: Currency;
  entry: number;
  size: number;
  rakeBps: number;
  payoutBps: number[];
  status: 'open' | 'full' | 'settled' | 'cancelled';
  /** Matchmaking pool key while joinable (null once full/closed). */
  openKey: string | null;
  /** closesAt while unsettled (for the settle-due query). */
  activeCloses: number | null;
  title: string | null;
  badge: string | null;
  description: string | null;
  templateId: string | null;
  prizeItem: string | null;
  freePool: number;
  startsAt: number;
  closesAt: number;
  createdAt: number;
  settledAt: number | null;
  count: number;
  players: string[];
  devices: string[];
}

export interface EntryDoc {
  uid: string;
  username: string;
  avatar: AvatarConfig | null;
  joinedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  score: number | null;
  flagged: string | null;
  rank: number | null;
  payout: number;
  ratingDelta: number;
  runToken: string | null;
}

export interface MatchDoc {
  id: string;
  contestId: string | null;
  kind: ContestKind | 'practice';
  gameId: string;
  currency: Currency;
  entry: number;
  title: string | null;
  /** joined → playing → waiting (for others) → settled | cancelled; practice runs are 'settled'. */
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

export interface RunDoc {
  token: string;
  uid: string;
  gameId: string;
  mode: ContestKind | 'practice';
  contestId: string | null;
  seed: number;
  startedAt: number;
  finishedAt: number | null;
  score: number | null;
  flagged: string | null;
}

// ============================================================================ helpers

const ITEMS = new Map(COSMETICS_CATALOG.map((c) => [c.id, c]));
const uuid = () => globalThis.crypto.randomUUID();
const newSeed = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
export const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const P = {
  user: (uid: string) => `users/${uid}`,
  pub: (uid: string) => `public/${uid}`,
  match: (uid: string, id: string) => `users/${uid}/matches/${id}`,
  ledger: (uid: string, id: string) => `users/${uid}/ledger/${id.replace(/[/.#$[\]]/g, '_')}`,
  contest: (id: string) => `contests/${id}`,
  seed: (id: string) => `contestSeeds/${id}`,
  entry: (cid: string, uid: string) => `contests/${cid}/entries/${uid}`,
  run: (t: string) => `runs/${t}`,
};

export function ageOn(dob: string, now: number) {
  const d = new Date(`${dob}T00:00:00Z`);
  const n = new Date(now);
  let age = n.getUTCFullYear() - d.getUTCFullYear();
  if (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

function freshDaily(day: string): Daily {
  return { day, runs: 0, h2hWins: 0, cupRuns: 0, practiceCoins: 0, stat: {}, claimed: [] };
}
function daily(u: UserDoc, now: number) {
  const day = utcDay(now);
  if (!u.daily || u.daily.day !== day) u.daily = freshDaily(day);
  return u.daily;
}

function newUser(uid: string, phone: string, email: string | null, now: number): UserDoc {
  return {
    uid, phone, email, username: null, usernameLower: null, dob: null, avatar: null,
    coins: 0, cashCents: 0, inventory: [], rating: 1200, crowns: 0, xp: 0, wins: 0, losses: 0, matches: 0, streak: 0, bestStreak: 0, cupsWon: 0,
    highScores: {}, isVip: false, seasonClaims: { free: [], vip: [] },
    kycStatus: 'none', kycDob: null, stripeCustomerId: null, stripeAccountId: null, payoutsEnabled: false,
    depositLimitCents: null, selfExcludedUntil: null, banned: false, banReason: null, riskFlags: [], devices: [], lastRegion: null, lineType: null,
    daily: freshDaily(utcDay(now)), rate: {}, deposits: [], createdAt: now, updatedAt: now,
  };
}

function player(u: UserDoc | null, needProfile = true): UserDoc {
  if (!u) return fail('no_profile', 403);
  if (u.banned) fail('account_suspended', 403);
  if (needProfile && !u.username) fail('profile_incomplete', 403);
  return u;
}

function rate(u: UserDoc, action: string, max: number, windowMs: number, now: number) {
  const list = (u.rate[action] ?? []).filter((t) => t > now - windowMs);
  if (list.length >= max) fail('rate_limited', 429);
  list.push(now);
  u.rate[action] = list;
}

const flag = (u: UserDoc, f: string) => {
  if (!u.riskFlags.includes(f)) u.riskFlags.push(f);
};

export function publicView(u: UserDoc) {
  return {
    uid: u.uid, username: u.username, avatar: u.avatar, rating: u.rating, crowns: u.crowns, wins: u.wins, losses: u.losses,
    matches: u.matches, bestStreak: u.bestStreak, highScores: u.highScores, banned: u.banned,
  };
}

function putUser(tx: Tx, u: UserDoc, now: number) {
  u.updatedAt = now;
  tx.set(P.user(u.uid), u as unknown as Data);
  if (u.username) tx.set(P.pub(u.uid), publicView(u) as Data);
}

/** The ONLY way balances change. Fails the whole transaction on overdraft or a repeated (kind, ref). */
function post(tx: Tx, u: UserDoc, currency: Currency, amount: number, kind: string, ref: string, now: number) {
  if (!Number.isInteger(amount)) fail('bad_amount');
  const field = currency === 'usd' ? 'cashCents' : 'coins';
  const bal = u[field] + amount;
  if (bal < 0) fail('insufficient_funds', 402);
  u[field] = bal;
  tx.create(P.ledger(u.uid, `${kind}:${ref}`), { uid: u.uid, currency, amount, balanceAfter: bal, kind, ref, at: now });
  return bal;
}

/** Server verdict on a finished run: null = fine, 'review:…' = held for review, else rejected. */
export function judgeRun(gameId: string, score: number, startedAt: number, now: number, best: number): string | null {
  const r = GAME_RULES[gameId];
  const elapsed = (now - startedAt) / 1000;
  if (!Number.isInteger(score) || score < 0) return 'negative';
  if (score === 0) return null; // a forfeit / empty run is never suspicious
  if (score > r.maxScore) return 'over_max';
  if (elapsed > r.maxDurationS) return 'too_late';
  if (r.timed && elapsed < r.roundSeconds - 3) return 'too_fast';
  if (score > Math.max(5, elapsed * r.maxPointsPerSec)) return 'impossible_rate';
  if (best > 0 && score > best * 3 && score > r.baseline * 3) return 'review:leap';
  return null;
}

function cleanStats(stats: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!stats || typeof stats !== 'object') return out;
  for (const [k, v] of Object.entries(stats as Data).slice(0, 40)) {
    if (/^[A-Za-z]{1,24}$/.test(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(-1e7, Math.min(1e7, Math.round(v)));
  }
  return out;
}

/** Shared bookkeeping for any finished run: xp, high score, quest stats, risk flags. */
function finishRun(u: UserDoc, run: RunDoc, score: number, stats: Record<string, number>, verdict: string | null, now: number) {
  const rejected = verdict !== null && !verdict.startsWith('review:');
  const xp = rejected ? 0 : run.mode === 'practice' ? 30 : run.mode === 'cup' ? 60 : 40;
  u.xp += xp;
  const d = daily(u, now);
  d.runs += 1;
  if (run.mode === 'cup') d.cupRuns += 1;
  if (verdict === null) {
    if (score > (u.highScores[run.gameId] ?? 0)) u.highScores[run.gameId] = score;
    const g = run.gameId;
    d.stat[`${g}:score:max`] = Math.max(d.stat[`${g}:score:max`] ?? 0, score);
    for (const [k, v] of Object.entries(stats)) {
      d.stat[`${g}:${k}:max`] = Math.max(d.stat[`${g}:${k}:max`] ?? 0, v);
      d.stat[`${g}:${k}:sum`] = (d.stat[`${g}:${k}:sum`] ?? 0) + v;
    }
  } else {
    flag(u, `run:${verdict.split(':')[0]}`);
  }
  return xp;
}

function questProgress(u: UserDoc, questId: string, now: number) {
  const d = u.daily && u.daily.day === utcDay(now) ? u.daily : freshDaily(utcDay(now));
  const m = QUEST_METRIC[questId];
  if (!m) return 0;
  if (m === 'h2hWins' || m === 'runs' || m === 'cupRuns') return d[m];
  return d.stat[m] ?? 0;
}

const matchKey = (kind: string, gameId: string, currency: Currency, entry: number) => `${kind}|${gameId}|${currency}|${entry}`;
const payoutBps = (kind: ContestKind) => (kind === 'h2h' ? [10000] : kind === 'arena' ? [5000, 3000, 2000] : CUP_BPS);

function validAvatar(a: unknown): a is AvatarConfig {
  if (!a || typeof a !== 'object') return false;
  const keys = ['gender', 'skinToneId', 'hairStyleId', 'hairColorId', 'eyeColor', 'expression', 'shirtId', 'pantsId', 'shoesId', 'headwearId', 'eyewearId', 'backId', 'trailId', 'pose', 'bannerId'];
  const o = a as Data;
  return Object.keys(o).every((k) => keys.includes(k)) && keys.every((k) => typeof o[k] === 'string' && (o[k] as string).length <= 48);
}

// ============================================================================ the engine

export interface Clock {
  now(): number;
}

export class Engine {
  constructor(private store: Store, private clock: Clock = { now: () => Date.now() }) {}
  private get now() {
    return this.clock.now();
  }

  // ---------------------------------------------------------------- accounts

  /**
   * Create or refresh the account for a signed-in Firebase user. A verified phone number is
   * required, and one phone number can only ever belong to one account.
   * `vetPhone` (optional) rejects number types that aren't real mobile lines (VoIP, toll-free…).
   */
  async ensureUser(uid: string, phone: string | null, email: string | null, vetPhone?: (phone: string) => Promise<string | null>) {
    if (!phone) return fail('phone_required', 403);
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) fail('bad_phone');
    const existing = await this.store.get<UserDoc>(P.user(uid));
    if (existing && existing.phone === phone) return existing;
    const lineType = vetPhone ? await vetPhone(phone) : null;
    const now = this.now;
    return this.store.run(async (tx) => {
      const [u0, owner] = await tx.getAll([P.user(uid), `phones/${phone}`]);
      let u = u0 as UserDoc | null;
      if (owner && owner.uid !== uid) fail('phone_in_use', 409);
      if (u && u.phone === phone) return u;
      if (!u) u = newUser(uid, phone, email, now);
      else if (u.phone) tx.del(`phones/${u.phone}`);
      u.phone = phone;
      u.lineType = lineType;
      tx.set(`phones/${phone}`, { uid, at: now });
      putUser(tx, u, now);
      return u;
    });
  }

  async completeProfile(uid: string, username: string, dob: string, avatar: unknown) {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) fail('invalid_username');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(dob))) fail('invalid_dob');
    const now = this.now;
    const age = ageOn(dob, now);
    if (age < CONFIG.minAge || age > 120) fail(age < CONFIG.minAge ? 'too_young' : 'invalid_dob');
    if (!validAvatar(avatar)) fail('bad_avatar');
    const lower = username.toLowerCase();
    return this.store.run(async (tx) => {
      const [u0, taken] = await tx.getAll([P.user(uid), `usernames/${lower}`]);
      const u = player(u0 as UserDoc | null, false);
      if (u.username) fail('profile_exists', 409);
      if (taken && taken.uid !== uid) fail('username_taken', 409);
      u.username = username;
      u.usernameLower = lower;
      u.dob = dob;
      u.avatar = this.ownedOnly(u, avatar as AvatarConfig);
      tx.set(`usernames/${lower}`, { uid });
      post(tx, u, 'coins', CONFIG.signupCoins, 'signup_bonus', 'welcome', now);
      putUser(tx, u, now);
      return u;
    });
  }

  async setUsername(uid: string, username: string) {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) fail('invalid_username');
    const lower = username.toLowerCase();
    const now = this.now;
    await this.store.run(async (tx) => {
      const [u0, taken] = await tx.getAll([P.user(uid), `usernames/${lower}`]);
      const u = player(u0 as UserDoc | null);
      if (taken && taken.uid !== uid) fail('username_taken', 409);
      if (u.username === username) return;
      rate(u, 'rename', 3, 86_400_000, now);
      if (u.usernameLower && u.usernameLower !== lower) tx.del(`usernames/${u.usernameLower}`);
      tx.set(`usernames/${lower}`, { uid });
      u.username = username;
      u.usernameLower = lower;
      putUser(tx, u, now);
    });
  }

  private owns(u: UserDoc, id: string) {
    const it = ITEMS.get(id);
    return id === 'none' || (!!it && (it.isUnlockedDefault || u.inventory.includes(id)));
  }
  /** Unowned items in the avatar are refused. */
  private ownedOnly(u: UserDoc, a: AvatarConfig) {
    for (const s of itemsOn(a)) if (ITEMS.has(s.id) && !this.owns(u, s.id)) fail(`item_not_owned:${s.id}`);
    return a;
  }

  async saveAvatar(uid: string, avatar: unknown) {
    if (!validAvatar(avatar)) fail('bad_avatar');
    const now = this.now;
    await this.store.run(async (tx) => {
      const u = player(await tx.get<UserDoc>(P.user(uid)));
      rate(u, 'avatar', 60, 600_000, now);
      u.avatar = this.ownedOnly(u, avatar as AvatarConfig);
      putUser(tx, u, now);
    });
  }

  async buyItem(uid: string, itemId: string) {
    const it = ITEMS.get(itemId) ?? fail('unknown_item');
    const now = this.now;
    return this.store.run(async (tx) => {
      const u = player(await tx.get<UserDoc>(P.user(uid)));
      if (this.owns(u, itemId)) fail('already_owned', 409);
      post(tx, u, 'coins', -it.cost, 'purchase', `item:${itemId}`, now);
      u.inventory.push(itemId);
      putUser(tx, u, now);
      return u.coins;
    });
  }

  /** Device fingerprint (hashed on the client). Too many accounts on one device flags them all. */
  async registerDevice(uid: string, hash: string) {
    if (!/^[a-f0-9]{32,128}$/.test(hash)) fail('bad_device');
    const now = this.now;
    return this.store.run(async (tx) => {
      const [u0, d0] = await tx.getAll([P.user(uid), `devices/${hash}`]);
      const u = player(u0 as UserDoc | null, false);
      const uids = new Set<string>((d0?.uids as string[]) ?? []);
      uids.add(uid);
      if (!u.devices.includes(hash)) u.devices = [...u.devices, hash].slice(-10);
      if (uids.size > CONFIG.maxAccountsPerDevice) flag(u, 'shared_device');
      tx.set(`devices/${hash}`, { uids: [...uids], lastSeen: now });
      putUser(tx, u, now);
      return uids.size;
    });
  }

  /** Responsible play: deposit limits can only be lowered; self-exclusion only extended. */
  async setLimits(uid: string, dailyDepositCents: number | null, selfExcludeDays: number) {
    const now = this.now;
    await this.store.run(async (tx) => {
      const u = player(await tx.get<UserDoc>(P.user(uid)));
      if (dailyDepositCents != null) {
        if (!Number.isInteger(dailyDepositCents) || dailyDepositCents < 0) fail('invalid_limit');
        if (u.depositLimitCents == null || dailyDepositCents <= u.depositLimitCents) u.depositLimitCents = dailyDepositCents;
      }
      if (selfExcludeDays > 0) u.selfExcludedUntil = Math.max(u.selfExcludedUntil ?? now, now + Math.min(3650, selfExcludeDays) * 86_400_000);
      putUser(tx, u, now);
    });
  }

  // ---------------------------------------------------------------- practice (solo, free)

  async startPractice(uid: string, gameId: string) {
    if (!GAME_RULES[gameId]) fail('unknown_game');
    const now = this.now;
    const token = uuid();
    const seed = newSeed();
    await this.store.run(async (tx) => {
      const u = player(await tx.get<UserDoc>(P.user(uid)));
      rate(u, 'start_run', 40, 600_000, now);
      tx.create(P.run(token), { token, uid, gameId, mode: 'practice', contestId: null, seed, startedAt: now, finishedAt: null, score: null, flagged: null } satisfies RunDoc as unknown as Data);
      putUser(tx, u, now);
    });
    return { runToken: token, seed };
  }

  async submitPractice(uid: string, token: string, score: number, rawStats: unknown) {
    const stats = cleanStats(rawStats);
    const now = this.now;
    return this.store.run(async (tx) => {
      const [r0, u0] = await tx.getAll([P.run(token), P.user(uid)]);
      const run = r0 as RunDoc | null;
      const u = player(u0 as UserDoc | null);
      if (!run || run.uid !== uid || run.mode !== 'practice') fail('unknown_run', 404);
      if (run!.finishedAt) fail('already_submitted', 409);
      const verdict = judgeRun(run!.gameId, score, run!.startedAt, now, u.highScores[run!.gameId] ?? 0);
      const xp = finishRun(u, run!, score, stats, verdict, now);
      let coins = 0;
      if (verdict === null) {
        const d = daily(u, now);
        coins = Math.round(5 + 15 * Math.min(1, score / GAME_RULES[run!.gameId].baseline));
        coins = Math.max(0, Math.min(coins, CONFIG.practiceCoinCapDaily - d.practiceCoins));
        if (coins > 0) {
          d.practiceCoins += coins;
          post(tx, u, 'coins', coins, 'reward', `practice:${token}`, now);
        }
      }
      tx.merge(P.run(token), { finishedAt: now, score, flagged: verdict });
      const m: MatchDoc = {
        id: token, contestId: null, kind: 'practice', gameId: run!.gameId, currency: 'coins', entry: 0, title: null, status: 'settled', at: now, closesAt: null,
        score, flagged: verdict, rank: null, size: 1, payout: 0, ratingDelta: 0, coins, xp, crowns: 0, prizeItem: null, opponents: [],
      };
      tx.set(P.match(uid, token), m as unknown as Data);
      putUser(tx, u, now);
      return { score, flagged: verdict, coins, xp };
    });
  }

  // ---------------------------------------------------------------- contests (PvP)

  /**
   * Join a head-to-head (2) or arena (5) contest, async: you're matched into the oldest open
   * contest with the same game and entry that you're not in and whose players never shared a
   * device with you; otherwise a new one opens and waits for opponents.
   * Cash (usd) contests also need: cash enabled, age 18+, an allowed location, no review flags.
   */
  async joinContest(uid: string, kind: ContestKind, gameId: string, currency: Currency, entry: number, opts: { region?: string | null; country?: string | null; cashEnabled?: boolean } = {}) {
    if (kind !== 'h2h' && kind !== 'arena') fail('bad_kind');
    if (!GAME_RULES[gameId]) fail('unknown_game');
    if (currency === 'coins' && !CONFIG.coinEntries.includes(entry)) fail('bad_entry');
    if (currency === 'usd' && !CONFIG.cashEntries.includes(entry)) fail('bad_entry');
    const now = this.now;
    const key = matchKey(kind, gameId, currency, entry);
    return this.store.run(async (tx) => {
      const u = player(await tx.get<UserDoc>(P.user(uid)));
      if (currency === 'usd') this.checkCash(u, opts, now);
      if (entry > 0 && u.selfExcludedUntil && u.selfExcludedUntil > now) fail('self_excluded', 403);
      rate(u, 'join', 30, 600_000, now);
      const open = await tx.query<ContestDoc>('contests', { where: [['openKey', '==', key]], limit: 25 });
      let c = open
        .map((r) => r.data)
        .filter((x) => x.closesAt > now + 600_000 && !x.players.includes(uid) && !x.devices.some((d) => u.devices.includes(d)))
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      const isNew = !c;
      if (!c) {
        c = {
          id: uuid(), kind, gameId, currency, entry, size: kind === 'h2h' ? 2 : 5, rakeBps: entry === 0 ? 0 : CONFIG.rakeBps, payoutBps: payoutBps(kind),
          status: 'open', openKey: key, activeCloses: now + CONFIG.contestHours * 3_600_000, title: null, badge: null, description: null, templateId: null, prizeItem: null,
          freePool: kind === 'h2h' ? 40 : 120, startsAt: now, closesAt: now + CONFIG.contestHours * 3_600_000, createdAt: now, settledAt: null, count: 0, players: [], devices: [],
        };
        tx.create(P.seed(c.id), { seed: newSeed() });
      }
      this.addEntry(tx, u, c, now, isNew);
      putUser(tx, u, now);
      return { contestId: c.id };
    });
  }

  private checkCash(u: UserDoc, opts: { region?: string | null; country?: string | null; cashEnabled?: boolean }, now: number) {
    if (!opts.cashEnabled) fail('cash_disabled', 403);
    if (!u.dob || ageOn(u.dob, now) < CONFIG.minCashAge) fail('underage', 403);
    if (!opts.country || !CONFIG.allowedCountries.includes(opts.country)) fail('region_blocked', 403);
    if (!opts.region || CONFIG.blockedRegions.includes(opts.region)) fail('region_blocked', 403);
    if (u.riskFlags.includes('shared_device')) fail('account_review', 403);
    u.lastRegion = opts.region ?? null;
  }

  private addEntry(tx: Tx, u: UserDoc, c: ContestDoc, now: number, isNew: boolean) {
    if (c.entry > 0) post(tx, u, c.currency, -c.entry, 'entry', c.id, now);
    const e: EntryDoc = { uid: u.uid, username: u.username!, avatar: u.avatar, joinedAt: now, startedAt: null, finishedAt: null, score: null, flagged: null, rank: null, payout: 0, ratingDelta: 0, runToken: null };
    tx.create(P.entry(c.id, u.uid), e as unknown as Data);
    c.count += 1;
    c.players = [...c.players, u.uid];
    c.devices = [...new Set([...c.devices, ...u.devices])];
    if (c.count >= c.size) {
      c.status = 'full';
      if (c.kind !== 'cup') c.openKey = null;
    }
    if (isNew) tx.create(P.contest(c.id), c as unknown as Data);
    else tx.set(P.contest(c.id), c as unknown as Data);
    const m: MatchDoc = {
      id: c.id, contestId: c.id, kind: c.kind, gameId: c.gameId, currency: c.currency, entry: c.entry, title: c.title, status: 'joined', at: now, closesAt: c.closesAt,
      score: null, flagged: null, rank: null, size: c.size, payout: 0, ratingDelta: 0, coins: 0, xp: 0, crowns: 0, prizeItem: c.prizeItem, opponents: [],
    };
    tx.set(P.match(u.uid, c.id), m as unknown as Data);
  }

  async joinCup(uid: string, contestId: string, opts: { region?: string | null; country?: string | null; cashEnabled?: boolean } = {}) {
    const now = this.now;
    await this.store.run(async (tx) => {
      const [u0, c0, e0] = await tx.getAll([P.user(uid), P.contest(contestId), P.entry(contestId, uid)]);
      const u = player(u0 as UserDoc | null);
      const c = c0 as ContestDoc | null;
      if (!c || c.kind !== 'cup') fail('unknown_contest', 404);
      if (c!.status !== 'open' || c!.closesAt <= now + 60_000) fail('contest_closed', 409);
      if (c!.startsAt > now) fail('not_started');
      if (e0) fail('already_joined', 409);
      if (c!.currency === 'usd') this.checkCash(u, opts, now);
      if (c!.entry > 0 && u.selfExcludedUntil && u.selfExcludedUntil > now) fail('self_excluded', 403);
      this.addEntry(tx, u, c!, now, false);
      putUser(tx, u, now);
    });
  }

  /** One attempt per entry: reveals the secret seed and opens a server-timed run. */
  async startContestRun(uid: string, contestId: string) {
    const now = this.now;
    const token = uuid();
    return this.store.run(async (tx) => {
      const [u0, c0, e0, s0] = await tx.getAll([P.user(uid), P.contest(contestId), P.entry(contestId, uid), P.seed(contestId)]);
      player(u0 as UserDoc | null);
      const c = c0 as ContestDoc | null;
      const e = e0 as EntryDoc | null;
      if (!c || !e) fail('not_entered', 404);
      if (e!.startedAt) fail('already_played', 409);
      if (c!.status === 'settled' || c!.status === 'cancelled' || c!.closesAt <= now) fail('contest_closed', 409);
      const seed = Number(s0?.seed);
      tx.merge(P.entry(contestId, uid), { startedAt: now, runToken: token });
      tx.create(P.run(token), { token, uid, gameId: c!.gameId, mode: c!.kind, contestId, seed, startedAt: now, finishedAt: null, score: null, flagged: null } satisfies RunDoc as unknown as Data);
      tx.merge(P.match(uid, contestId), { status: 'playing' });
      return { runToken: token, seed, gameId: c!.gameId };
    });
  }

  async submitContestScore(uid: string, token: string, score: number, rawStats: unknown) {
    const stats = cleanStats(rawStats);
    const now = this.now;
    const out = await this.store.run(async (tx) => {
      const [r0, u0] = await tx.getAll([P.run(token), P.user(uid)]);
      const run = r0 as RunDoc | null;
      const u = player(u0 as UserDoc | null);
      if (!run || run.uid !== uid || !run.contestId) fail('unknown_run', 404);
      if (run!.finishedAt) fail('already_submitted', 409);
      const cid = run!.contestId!;
      const c = (await tx.get<ContestDoc>(P.contest(cid)))!;
      const entries = await tx.query<EntryDoc>(`contests/${cid}/entries`, { limit: 500 });
      const verdict = judgeRun(run!.gameId, score, run!.startedAt, now, u.highScores[run!.gameId] ?? 0);
      // Rejected runs score 0 in the contest; review-flagged runs keep their score but are held.
      const stored = verdict !== null && !verdict.startsWith('review:') ? 0 : score;
      const xp = finishRun(u, run!, stored, stats, verdict, now);
      tx.merge(P.run(token), { finishedAt: now, score: stored, flagged: verdict });
      tx.merge(P.entry(cid, uid), { finishedAt: now, score: stored, flagged: verdict });
      tx.merge(P.match(uid, cid), { status: 'waiting', score: stored, flagged: verdict, xp });
      putUser(tx, u, now);
      const othersDone = entries.every((r) => r.id === uid || r.data.finishedAt != null);
      return { score: stored, flagged: verdict, contestId: cid, xp, ready: c.status === 'full' && othersDone && c.kind !== 'cup' };
    });
    if (out.ready) await this.settle(out.contestId);
    return { score: out.score, flagged: out.flagged, contestId: out.contestId, xp: out.xp };
  }

  /**
   * Pay out a contest. Pot = entries × entry minus the service fee (free contests pay a fixed coin
   * pool); places share it by payoutBps, tied places split their combined share. Unplayed entries
   * score 0. If fewer than 2 players joined, everyone is refunded. Idempotent.
   */
  async settle(contestId: string) {
    const now = this.now;
    return this.store.run(async (tx) => {
      const c = await tx.get<ContestDoc>(P.contest(contestId));
      if (!c || c.status === 'settled' || c.status === 'cancelled') return false;
      const entries = (await tx.query<EntryDoc>(`contests/${contestId}/entries`, { limit: 500 })).map((r) => r.data);
      const users = (await tx.getAll<UserDoc>(entries.map((e) => P.user(e.uid)))).filter(Boolean) as UserDoc[];
      const byId = new Map(users.map((u) => [u.uid, u]));
      const n = entries.length;
      const done = { status: 'settled' as ContestDoc['status'], openKey: null, activeCloses: null, settledAt: now };

      if (n < 2) {
        for (const e of entries) {
          const u = byId.get(e.uid);
          if (!u) continue;
          if (c.entry > 0) post(tx, u, c.currency, c.entry, 'refund', c.id, now);
          tx.merge(P.match(u.uid, c.id), { status: 'cancelled', payout: c.entry, at: now });
          putUser(tx, u, now);
        }
        tx.merge(P.contest(c.id), { ...done, status: 'cancelled' });
        return true;
      }

      for (const e of entries) e.score = e.score ?? 0;
      entries.sort((a, b) => b.score! - a.score!);
      entries.forEach((e) => (e.rank = 1 + entries.filter((o) => o.score! > e.score!).length));

      const pot = c.entry * n;
      const pool = c.entry === 0 ? (c.currency === 'coins' ? c.freePool : 0) : pot - Math.floor((pot * c.rakeBps) / 10000);
      // Places paid: h2h → 1; arenas/cups → up to the table, never everyone.
      const paid = c.kind === 'h2h' ? 1 : Math.min(c.payoutBps.length, Math.max(1, n - 1));
      const bps = c.payoutBps.slice(0, paid);
      const bpsSum = bps.reduce((a, b) => a + b, 0);
      const tie = c.kind === 'h2h' && entries[0].score === entries[1].score;
      for (const e of entries) {
        if (tie) {
          e.payout = c.entry > 0 ? c.entry : Math.floor(pool / 2); // h2h tie: stakes back, no fee
          continue;
        }
        const tied = entries.filter((o) => o.rank === e.rank).length;
        let share = 0;
        for (let i = e.rank!; i < e.rank! + tied; i++) share += bps[i - 1] ?? 0;
        e.payout = share ? Math.floor((pool * share) / bpsSum / tied) : 0;
      }

      // Elo for head-to-head.
      if (c.kind === 'h2h') {
        const [a, b] = entries;
        const ua = byId.get(a.uid);
        const ub = byId.get(b.uid);
        if (ua && ub) {
          const expA = 1 / (1 + Math.pow(10, (ub.rating - ua.rating) / 400));
          const sa = a.score! > b.score! ? 1 : a.score === b.score ? 0.5 : 0;
          const delta = Math.round(24 * (sa - expA));
          a.ratingDelta = delta;
          b.ratingDelta = -delta;
          ua.rating = Math.max(500, ua.rating + delta);
          ub.rating = Math.max(500, ub.rating - delta);
        }
      }

      for (const e of entries) {
        const u = byId.get(e.uid);
        if (!u) continue;
        const won = !tie && e.rank === 1;
        const crowns = c.kind === 'h2h' ? (won ? 1 : 0) : c.kind === 'arena' ? (e.rank === 1 ? 2 : e.rank === 2 ? 1 : 0) : e.rank === 1 ? 3 : e.rank === 2 ? 2 : e.rank === 3 ? 1 : 0;
        if (e.payout > 0) post(tx, u, c.currency, e.payout, 'prize', c.id, now);
        let prizeItem: string | null = null;
        if (won && c.prizeItem) {
          if (this.owns(u, c.prizeItem)) post(tx, u, 'coins', 400, 'reward', `cup_item:${c.id}`, now);
          else {
            u.inventory.push(c.prizeItem);
            prizeItem = c.prizeItem;
          }
        }
        u.matches += 1;
        if (won) u.wins += 1;
        else if (e.payout === 0) u.losses += 1;
        u.crowns += crowns;
        u.streak = won ? u.streak + 1 : e.payout === 0 ? 0 : u.streak;
        u.bestStreak = Math.max(u.bestStreak, u.streak);
        if (won) {
          u.xp += 60;
          if (c.kind === 'cup') u.cupsWon += 1;
          if (c.kind === 'h2h') daily(u, now).h2hWins += 1;
        }
        const opponents = entries
          .filter((o) => o.uid !== e.uid)
          .slice(0, 9)
          .map((o) => ({ uid: o.uid, username: o.username, avatar: o.avatar, score: o.score, rank: o.rank }));
        tx.merge(P.entry(c.id, e.uid), { rank: e.rank, payout: e.payout, ratingDelta: e.ratingDelta, score: e.score });
        tx.merge(P.match(e.uid, c.id), { status: 'settled', rank: e.rank, payout: e.payout, ratingDelta: e.ratingDelta, crowns, score: e.score, size: n, opponents, prizeItem, at: now });
        putUser(tx, u, now);
      }
      tx.merge(P.contest(c.id), done);
      return true;
    });
  }

  /** Settle when everyone in a full contest has finished or abandoned their run. */
  async maybeSettle(contestId: string) {
    const now = this.now;
    const c = await this.store.get<ContestDoc>(P.contest(contestId));
    if (!c || c.status === 'settled' || c.status === 'cancelled') return false;
    if (c.closesAt <= now) return this.settle(contestId);
    if (c.status !== 'full' || c.kind === 'cup') return false;
    const maxMs = GAME_RULES[c.gameId].maxDurationS * 1000;
    const entries = await this.store.query<EntryDoc>(`contests/${contestId}/entries`, { limit: 500 });
    const over = entries.every((r) => r.data.finishedAt != null || (r.data.startedAt != null && r.data.startedAt < now - maxMs));
    return over ? this.settle(contestId) : false;
  }

  /** Cron: settle every contest whose window has closed; keep cups scheduled. */
  async tick() {
    await this.ensureCups();
    const due = await this.store.query<ContestDoc>('contests', { where: [['activeCloses', '<=', this.now]], limit: 100 });
    let n = 0;
    for (const r of due) if (await this.settle(r.id)) n++;
    return n;
  }

  /** Keep one cup per template open for its current time window (deterministic ids: no duplicates). */
  async ensureCups() {
    const now = this.now;
    const slots = CUPS.map((t) => {
      const span = t.hours * 3_600_000;
      const period = Math.floor(now / span);
      return { t, id: `cup-${t.id}-${period}`, startsAt: period * span, closesAt: (period + 1) * span };
    });
    await this.store.run(async (tx) => {
      const have = await tx.getAll<ContestDoc>(slots.map((s) => P.contest(s.id)));
      slots.forEach((s, i) => {
        if (have[i]) return;
        const c: ContestDoc = {
          id: s.id, kind: 'cup', gameId: s.t.gameId, currency: 'coins', entry: s.t.entry, size: s.t.size, rakeBps: s.t.entry ? CONFIG.rakeBps : 0, payoutBps: CUP_BPS,
          status: 'open', openKey: 'cup', activeCloses: s.closesAt, title: s.t.title, badge: s.t.badge, description: s.t.description, templateId: s.t.id, prizeItem: s.t.prizeItem ?? null,
          freePool: s.t.freePool, startsAt: s.startsAt, closesAt: s.closesAt, createdAt: now, settledAt: null, count: 0, players: [], devices: [],
        };
        tx.create(P.contest(s.id), c as unknown as Data);
        tx.create(P.seed(s.id), { seed: newSeed() });
      });
    });
  }

  // ---------------------------------------------------------------- rewards

  async claimQuest(uid: string, questId: string) {
    const now = this.now;
    const q = questsForDay(utcDay(now)).find((x) => x.id === questId) ?? fail('unknown_quest');
    return this.store.run(async (tx) => {
      const u = player(await tx.get<UserDoc>(P.user(uid)));
      const d = daily(u, now);
      if (d.claimed.includes(questId)) fail('already_claimed', 409);
      if (questProgress(u, questId, now) < q.target) fail('quest_not_complete');
      d.claimed.push(questId);
      post(tx, u, 'coins', q.rewardCoins, 'reward', `quest:${questId}:${d.day}`, now);
      u.xp += q.rewardXp;
      putUser(tx, u, now);
      return { coins: q.rewardCoins, xp: q.rewardXp };
    });
  }

  async claimSeason(uid: string, tier: number, vip: boolean) {
    const t = SEASON_TIERS.find((s) => s.tier === tier) ?? fail('unknown_tier');
    const now = this.now;
    return this.store.run(async (tx) => {
      const u = player(await tx.get<UserDoc>(P.user(uid)));
      if (u.xp < t.xpRequired) fail('tier_locked');
      if (vip && !u.isVip) fail('not_vip', 403);
      const key = vip ? 'vip' : 'free';
      if (u.seasonClaims[key].includes(tier)) fail('already_claimed', 409);
      const reward = vip ? t.vipReward : t.freeReward;
      if (reward.type === 'coins') post(tx, u, 'coins', Number(reward.value), 'reward', `season:${key}:${tier}`, now);
      else if (!u.inventory.includes(String(reward.value))) u.inventory.push(String(reward.value));
      u.seasonClaims[key] = [...u.seasonClaims[key], tier];
      putUser(tx, u, now);
      return { reward };
    });
  }

  async activateVip(uid: string) {
    const now = this.now;
    await this.store.run(async (tx) => {
      const u = player(await tx.get<UserDoc>(P.user(uid)));
      if (u.isVip) return;
      post(tx, u, 'coins', -CONFIG.vipCost, 'purchase', 'vip_pass', now);
      u.isVip = true;
      putUser(tx, u, now);
    });
  }

  // ---------------------------------------------------------------- money (server/webhook only)

  /** Remaining deposit allowance for the next 24h, after the player's own limit. */
  async depositAllowance(uid: string) {
    const u = player(await this.store.get<UserDoc>(P.user(uid)));
    const now = this.now;
    const used = u.deposits.filter((d) => d.at > now - 86_400_000).reduce((a, d) => a + d.cents, 0);
    const cap = Math.min(CONFIG.maxDailyDepositCents, u.depositLimitCents ?? Infinity);
    return { remaining: Math.max(0, cap - used), user: u };
  }

  /** Idempotent per Stripe reference (the webhook may deliver twice). */
  async creditDeposit(uid: string, cents: number, ref: string) {
    if (!Number.isInteger(cents) || cents <= 0) fail('bad_amount');
    const now = this.now;
    return this.store.run(async (tx) => {
      const [u0, prior] = await tx.getAll([P.user(uid), P.ledger(uid, `deposit:${ref}`)]);
      const u = u0 as UserDoc | null;
      if (!u) fail('no_profile', 404);
      if (prior) return { credited: false, cashCents: u!.cashCents };
      post(tx, u!, 'usd', cents, 'deposit', ref, now);
      u!.deposits = [...u!.deposits.filter((d) => d.at > now - 86_400_000), { at: now, cents }];
      putUser(tx, u!, now);
      return { credited: true, cashCents: u!.cashCents };
    });
  }

  async requestWithdrawal(uid: string, cents: number) {
    if (!Number.isInteger(cents) || cents < CONFIG.minWithdrawalCents) fail('min_withdrawal');
    const now = this.now;
    const id = uuid();
    await this.store.run(async (tx) => {
      const u = player(await tx.get<UserDoc>(P.user(uid)));
      if (u.kycStatus !== 'verified') fail('id_not_verified', 403);
      if (!u.payoutsEnabled || !u.stripeAccountId) fail('payouts_not_set_up', 403);
      if (ageOn(u.kycDob ?? u.dob!, now) < CONFIG.minCashAge) fail('underage', 403);
      if (u.riskFlags.some((f) => f.startsWith('run:') || f === 'shared_device')) fail('account_review', 403);
      rate(u, 'withdraw', 5, 86_400_000, now);
      post(tx, u, 'usd', -cents, 'withdrawal', id, now);
      tx.create(`withdrawals/${id}`, { id, uid, cents, status: 'pending', account: u.stripeAccountId, transferId: null, failure: null, createdAt: now, updatedAt: now });
      putUser(tx, u, now);
    });
    return id;
  }

  /** A failed payout returns the money to the player's balance. */
  async finishWithdrawal(id: string, ok: boolean, transferId: string | null, failure: string | null) {
    const now = this.now;
    await this.store.run(async (tx) => {
      const w = await tx.get<Data>(`withdrawals/${id}`);
      if (!w || w.status !== 'pending') return;
      const u = await tx.get<UserDoc>(P.user(String(w.uid)));
      tx.merge(`withdrawals/${id}`, { status: ok ? 'paid' : 'failed', transferId, failure, updatedAt: now });
      if (!ok && u) {
        post(tx, u, 'usd', Number(w.cents), 'withdrawal_reversal', id, now);
        putUser(tx, u, now);
      }
    });
  }

  async setKyc(uid: string, status: UserDoc['kycStatus'], dob: string | null) {
    const now = this.now;
    await this.store.run(async (tx) => {
      const u = await tx.get<UserDoc>(P.user(uid));
      if (!u) return;
      if (u.kycStatus === 'verified' && status !== 'verified') return;
      u.kycStatus = status;
      if (dob) u.kycDob = dob;
      if (status === 'verified' && dob && u.dob && dob !== u.dob) flag(u, 'dob_mismatch');
      putUser(tx, u, now);
    });
  }

  async setStripe(uid: string, patch: { customerId?: string; accountId?: string; payoutsEnabled?: boolean }) {
    const now = this.now;
    await this.store.run(async (tx) => {
      const u = await tx.get<UserDoc>(P.user(uid));
      if (!u) return;
      if (patch.customerId) u.stripeCustomerId = patch.customerId;
      if (patch.accountId) u.stripeAccountId = patch.accountId;
      if (patch.payoutsEnabled != null) u.payoutsEnabled = patch.payoutsEnabled;
      putUser(tx, u, now);
    });
  }

  async setBan(uid: string, banned: boolean, reason: string | null) {
    const now = this.now;
    await this.store.run(async (tx) => {
      const u = await tx.get<UserDoc>(P.user(uid));
      if (!u) return;
      u.banned = banned;
      u.banReason = reason;
      putUser(tx, u, now);
    });
  }

  /** Contact-form message (support/{id}); reviewed in the Firebase console. */
  async supportTicket(t: { name: string; email: string; username: string; topic: string; message: string; ip: string }) {
    const id = uuid();
    const now = this.now;
    await this.store.run(async (tx) => {
      tx.create(`support/${id}`, { id, ...t, status: 'open', createdAt: now });
    });
    return id;
  }

  // ---------------------------------------------------------------- reads (what the app shows)

  /** Everything the app needs about the signed-in player (no internal flags). */
  async me(uid: string) {
    const u = await this.store.get<UserDoc>(P.user(uid));
    if (!u) return null;
    const now = this.now;
    const day = utcDay(now);
    const d = u.daily?.day === day ? u.daily : freshDaily(day);
    const quests = questsForDay(day).map((q) => {
      const progress = Math.min(q.target, questProgress(u, q.id, now));
      return { ...q, progress, completed: progress >= q.target, claimed: d.claimed.includes(q.id) };
    });
    return {
      uid: u.uid, phone: u.phone, username: u.username, avatar: u.avatar, dobSet: !!u.dob, adult: !!u.dob && ageOn(u.dob, now) >= CONFIG.minCashAge,
      coins: u.coins, cashCents: u.cashCents, inventory: u.inventory, rating: u.rating, crowns: u.crowns, xp: u.xp, wins: u.wins, losses: u.losses,
      matches: u.matches, streak: u.streak, bestStreak: u.bestStreak, cupsWon: u.cupsWon, highScores: u.highScores, isVip: u.isVip, seasonClaims: u.seasonClaims,
      kycStatus: u.kycStatus, payoutsEnabled: u.payoutsEnabled, depositLimitCents: u.depositLimitCents, selfExcludedUntil: u.selfExcludedUntil,
      banned: u.banned, underReview: u.riskFlags.some((f) => f.startsWith('run:') || f === 'shared_device'), quests, questDay: day, serverTime: now,
    };
  }

  /** Your recent matches; open contests past their window are settled on the way. */
  async history(uid: string) {
    const rows = await this.store.query<MatchDoc>(`users/${uid}/matches`, { orderBy: ['at', 'desc'], limit: 40 });
    let changed = false;
    for (const r of rows) {
      const m = r.data;
      if (m.contestId && (m.status === 'waiting' || m.status === 'joined' || m.status === 'playing') && m.kind !== 'cup') {
        if (await this.maybeSettle(m.contestId)) changed = true;
      }
    }
    return changed ? (await this.store.query<MatchDoc>(`users/${uid}/matches`, { orderBy: ['at', 'desc'], limit: 40 })).map((r) => r.data) : rows.map((r) => r.data);
  }

  async match(uid: string, id: string) {
    const m = await this.store.get<MatchDoc>(P.match(uid, id));
    if (m?.contestId && m.status !== 'settled' && m.status !== 'cancelled' && m.kind !== 'cup') {
      if (await this.maybeSettle(m.contestId)) return this.store.get<MatchDoc>(P.match(uid, id));
    }
    return m;
  }

  async ledger(uid: string) {
    return (await this.store.query<Data>(`users/${uid}/ledger`, { orderBy: ['at', 'desc'], limit: 50 })).map((r) => r.data);
  }

  async leaderboard() {
    const rows = await this.store.query<ReturnType<typeof publicView>>('public', { orderBy: ['rating', 'desc'], limit: 120 });
    return rows
      .map((r) => r.data)
      .filter((p) => p.matches > 0 && !p.banned)
      .slice(0, 50)
      .map((p, i) => ({ ...p, place: i + 1 }));
  }

  /** Live cups with the standings (cups are public), plus your entry. */
  async cups(uid: string) {
    await this.ensureCups();
    const now = this.now;
    const rows: Row<ContestDoc>[] = await this.store.query<ContestDoc>('contests', { where: [['openKey', '==', 'cup']], limit: 40 });
    const live = rows.map((r) => r.data).filter((c) => c.status !== 'settled' && c.status !== 'cancelled');
    const out = [];
    for (const c of live.sort((a, b) => a.closesAt - b.closesAt)) {
      if (c.closesAt <= now) {
        await this.settle(c.id);
        continue;
      }
      const top = await this.store.query<EntryDoc>(`contests/${c.id}/entries`, { orderBy: ['score', 'desc'], limit: 10 });
      const mine = await this.store.get<EntryDoc>(P.entry(c.id, uid));
      const pool = c.entry === 0 ? c.freePool : Math.floor(c.entry * c.count * (1 - c.rakeBps / 10000));
      out.push({
        id: c.id, title: c.title, badge: c.badge, description: c.description, gameId: c.gameId, entry: c.entry, currency: c.currency, size: c.size, count: c.count,
        startsAt: c.startsAt, closesAt: c.closesAt, prizeItem: c.prizeItem, pool, payoutBps: c.payoutBps, status: c.status,
        top: top.map((r) => ({ uid: r.data.uid, username: r.data.username, avatar: r.data.avatar, score: r.data.score })),
        mine: mine ? { joined: true, played: !!mine.startedAt, score: mine.score } : null,
      });
    }
    return out;
  }
}
