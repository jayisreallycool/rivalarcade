import type Stripe from 'stripe';
import { engine, errorResponse, json, stripe } from '@/lib/server/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stripe → balances. Signature-verified; every handler is idempotent (deposits are keyed by the
 * Checkout Session id), so Stripe's retries can't credit twice.
 */
export async function POST(req: Request) {
  const s = stripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s || !secret) return json({ error: 'not_configured' }, 503);
  let event: Stripe.Event;
  try {
    event = s.webhooks.constructEvent(await req.text(), req.headers.get('stripe-signature') ?? '', secret);
  } catch {
    return json({ error: 'bad_signature' }, 400);
  }
  try {
    const eng = engine();
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const cs = event.data.object as Stripe.Checkout.Session;
        if (cs.metadata?.kind === 'deposit' && cs.payment_status === 'paid' && cs.metadata.uid && cs.amount_total) {
          await eng.creditDeposit(cs.metadata.uid, cs.amount_total, cs.id);
        }
        break;
      }
      case 'identity.verification_session.verified': {
        const v = await s.identity.verificationSessions.retrieve((event.data.object as Stripe.Identity.VerificationSession).id, { expand: ['verified_outputs.dob'] });
        const d = v.verified_outputs?.dob;
        const dob = d?.year && d.month && d.day ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null;
        if (v.metadata?.uid) await eng.setKyc(v.metadata.uid, 'verified', dob);
        break;
      }
      case 'identity.verification_session.requires_input': {
        const v = event.data.object as Stripe.Identity.VerificationSession;
        if (v.metadata?.uid) await eng.setKyc(v.metadata.uid, 'rejected', null);
        break;
      }
      case 'account.updated': {
        const a = event.data.object as Stripe.Account;
        if (a.metadata?.uid) await eng.setStripe(a.metadata.uid, { accountId: a.id, payoutsEnabled: !!a.payouts_enabled });
        break;
      }
    }
    return json({ received: true });
  } catch (e) {
    return errorResponse(e);
  }
}
