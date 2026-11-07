import { NextResponse } from 'next/server';
import { adminAuth, firestoreDb, serviceAccountInfo } from '@/lib/server/firestore-store';
import { cashMode } from '@/lib/server/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CLIENT_PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'rivalarcadedev';

const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);

/**
 * Setup status, safe to open in a browser: says whether sign-in, the database and payments are
 * configured and reachable — never any key or secret.
 */
export async function GET() {
  const key = serviceAccountInfo();
  const out: Record<string, unknown> = {
    signIn: key.valid && key.projectId === CLIENT_PROJECT ? 'ready' : 'not ready',
    serverKey: key.valid ? 'valid' : key.present ? `invalid — ${key.problem}` : 'missing — add FIREBASE_SERVICE_ACCOUNT in Vercel',
    keyProject: key.projectId,
    appProject: CLIENT_PROJECT,
    sameProject: key.projectId ? key.projectId === CLIENT_PROJECT : null,
  };
  if (key.valid) {
    try {
      await withTimeout(adminAuth().listUsers(1), 8000);
      out.authAdmin = 'ok';
    } catch (e) {
      const err = e as { code?: string; message?: string };
      out.authAdmin = `error — ${err.code ?? ''} ${String(err.message ?? '').slice(0, 160)}`.trim();
    }
    try {
      await withTimeout(firestoreDb().collection('_health').doc('ping').get(), 8000);
      out.database = 'ok';
    } catch (e) {
      const err = e as { code?: number | string; message?: string };
      const msg = String(err.message ?? '');
      out.database =
        err.code === 5 || /NOT_FOUND/.test(msg)
          ? 'missing — create the Firestore database (Firebase → Firestore Database → Create database)'
          : err.code === 7 || /PERMISSION_DENIED/.test(msg)
            ? 'permission denied — the server key needs access to Firestore'
            : `error — ${msg.slice(0, 160)}`;
    }
  }
  out.payments = { cashMode: cashMode(), stripeKey: process.env.STRIPE_SECRET_KEY ? (process.env.STRIPE_SECRET_KEY.startsWith('sk_test') ? 'test key set' : 'live key set') : 'missing', webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ? 'set' : 'missing' };
  return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
}
