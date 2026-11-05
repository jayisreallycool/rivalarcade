'use client';
/**
 * Guest mode: the same game server (lib/server/engine.ts) running on this device, with progress
 * saved in local storage. Practice, quests, the store, wardrobe and season pass all work; matches
 * against real players (1v1, arenas, cups) and cash need a signed-in account.
 */
import { AppError, CONFIG, Engine } from '../server/engine';
import { MemoryStore } from '../server/store';
import { gameDispatch } from '../server/dispatch';
import { getStarterAvatar } from '../cosmetics-catalog';

const KEY = 'ra_guest_db_v1';
const GUEST_PHONE = '+19990000000';
const ONLINE_ONLY = new Set(['joinContest', 'joinCup', 'startContestRun', 'submitContestScore', 'cups']);

let store: MemoryStore | null = null;
let eng: Engine | null = null;

function load() {
  store = new MemoryStore();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) store.docs = new Map(JSON.parse(raw));
  } catch {
    /* fresh */
  }
  eng = new Engine(store);
}
function save() {
  try {
    if (store) localStorage.setItem(KEY, JSON.stringify([...store.docs]));
  } catch {
    /* storage full / private mode */
  }
}

export type GuestResult = { ok: true; data: unknown } | { ok: false; code: string; status: number };

export async function guestCall(uid: string, fn: string, args: Record<string, unknown>): Promise<GuestResult> {
  if (!eng) load();
  const e = eng!;
  try {
    if (fn === 'me') {
      await e.ensureUser(uid, GUEST_PHONE, null);
      let me = await e.me(uid);
      if (!me?.username) {
        await e.completeProfile(uid, `Guest${uid.slice(-5).replace(/[^A-Za-z0-9]/g, '0')}`, '2000-01-01', getStarterAvatar('neutral'));
        me = await e.me(uid);
      }
      return { ok: true, data: { status: 'ready', me, guest: true, cash: { mode: 'off', allowed: false, region: null, entries: CONFIG.cashEntries, minWithdrawalCents: CONFIG.minWithdrawalCents }, coinEntries: CONFIG.coinEntries, vipCost: CONFIG.vipCost } };
    }
    if (fn === 'cups') return { ok: true, data: { cups: [] } };
    if (ONLINE_ONLY.has(fn)) return { ok: false, code: 'signin_required', status: 403 };
    const out = await gameDispatch(e, uid, fn, args, { cashEnabled: false });
    if (out === undefined) return { ok: false, code: fn === 'deposit' || fn === 'withdraw' || fn === 'kycStart' || fn === 'payoutsOnboard' ? 'signin_required' : 'unknown_fn', status: 404 };
    return { ok: true, data: out };
  } catch (x) {
    if (x instanceof AppError) return { ok: false, code: x.code, status: x.status };
    return { ok: false, code: 'server_error', status: 500 };
  } finally {
    save();
  }
}
