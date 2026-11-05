/**
 * Server wiring: which store, who is calling, where they are, and the Stripe / Twilio clients.
 * Production: Firestore + Firebase Auth ID tokens. Local test runs (RA_TEST_BACKEND=memory,
 * never on Vercel) use an in-memory store and plain test tokens so the whole app can be
 * exercised end to end without any cloud accounts.
 */
import Stripe from 'stripe';
import { AppError, Engine } from './engine';
import { MemoryStore, type Store } from './store';
import { FirestoreStore, adminAuth, firebaseConfigured } from './firestore-store';

export const testBackend = () => process.env.RA_TEST_BACKEND === 'memory' && !process.env.VERCEL;

const g = globalThis as unknown as { __raStore?: Store; __raEngine?: Engine; __raClock?: { offset: number } };

export function clock() {
  return (g.__raClock ??= { offset: 0 });
}

export function engine(): Engine {
  if (g.__raEngine) return g.__raEngine;
  if (testBackend()) g.__raStore = new MemoryStore();
  else if (firebaseConfigured()) g.__raStore = new FirestoreStore();
  else throw new AppError('server_not_configured', 503);
  const c = clock();
  g.__raEngine = new Engine(g.__raStore, { now: () => Date.now() + c.offset });
  return g.__raEngine;
}

export interface Caller {
  uid: string;
  phone: string | null;
  email: string | null;
}

/** Verify the Firebase ID token in `Authorization: Bearer …` (revoked tokens are refused). */
export async function caller(req: Request): Promise<Caller> {
  const h = req.headers.get('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw new AppError('signed_out', 401);
  if (testBackend()) {
    const m = /^test\.([\w-]{1,40})\.(\+\d{7,15}|none)$/.exec(token);
    if (!m) throw new AppError('signed_out', 401);
    return { uid: m[1], phone: m[2] === 'none' ? null : m[2], email: null };
  }
  try {
    const d = await adminAuth().verifyIdToken(token, true);
    return { uid: d.uid, phone: d.phone_number ?? null, email: d.email ?? null };
  } catch {
    throw new AppError('signed_out', 401);
  }
}

/** Location from Vercel's edge headers (never from the client). */
export function geo(req: Request) {
  let country = req.headers.get('x-vercel-ip-country');
  let sub = req.headers.get('x-vercel-ip-country-region');
  if (testBackend()) {
    const t = req.headers.get('x-ra-test-geo'); // e.g. "US-CA"
    if (t) [country, sub] = t.split('-');
  }
  return { country: country ?? null, region: country && sub ? `${country}-${sub}` : null };
}

let stripeClient: Stripe | null = null;
export function stripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return (stripeClient ??= new Stripe(key));
}

/** Cash play is on when CASH_MODE is "test" or "live" (and Stripe is set up, outside tests). */
export function cashMode(): 'off' | 'test' | 'live' {
  const m = process.env.CASH_MODE;
  if (m !== 'test' && m !== 'live') return 'off';
  if (!testBackend() && !stripe()) return 'off';
  if (m === 'live' && process.env.STRIPE_SECRET_KEY?.startsWith('sk_test')) return 'test';
  return m;
}

/**
 * Anti-spoofing: look the number up with Twilio (if configured) and refuse internet / VoIP and
 * toll-free numbers, which are cheap to mass-create. Returns the line type.
 */
export async function vetPhone(phone: string): Promise<string | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return null;
  try {
    const r = await fetch(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phone)}?Fields=line_type_intelligence`, {
      headers: { authorization: `Basic ${Buffer.from(`${sid}:${tok}`).toString('base64')}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { line_type_intelligence?: { type?: string } };
    const type = j.line_type_intelligence?.type ?? null;
    const blocked = (process.env.BLOCKED_LINE_TYPES ?? 'nonFixedVoip,fixedVoip,tollFree,voicemail,pager,sharedCost,uan').split(',');
    if (type && blocked.includes(type)) throw new AppError('voip_not_allowed', 403);
    return type;
  } catch (e) {
    if (e instanceof AppError) throw e;
    return null; // lookup outage: don't lock real players out
  }
}

export function siteOrigin(req: Request) {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? new URL(req.url).origin;
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) return json({ error: e.code }, e.status);
  const msg = e instanceof Error ? e.message : String(e);
  if (/already exists|ALREADY_EXISTS/i.test(msg)) return json({ error: 'duplicate' }, 409);
  console.error('[api]', e);
  return json({ error: 'server_error' }, 500);
}
