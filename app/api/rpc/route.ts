import { AppError, CONFIG } from '@/lib/server/engine';
import { gameDispatch, int, str } from '@/lib/server/dispatch';
import { caller, cashMode, clock, engine, errorResponse, geo, json, siteOrigin, stripe, testBackend, vetPhone } from '@/lib/server/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


/**
 * Single endpoint for everything the app does. Every call is authenticated with the player's
 * Firebase ID token; the player's location for cash play comes from Vercel's edge headers.
 */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 16_000) throw new AppError('too_large', 413);
    const { fn, args = {} } = JSON.parse(raw || '{}') as { fn: string; args?: Record<string, unknown> };
    const who = await caller(req);
    const eng = engine();
    const where = geo(req);
    const cash = cashMode();
    const cashOpts = { ...where, cashEnabled: cash !== 'off' };
    const uid = who.uid;

    switch (fn) {
      case 'me': {
        if (!who.phone) return json({ status: 'needs_phone' });
        await eng.ensureUser(uid, who.phone, who.email, vetPhone);
        let me = await eng.me(uid);
        // Pick up Stripe payout onboarding the moment the player comes back from it.
        const s = stripe();
        if (s && me && !me.payoutsEnabled && args.refreshPayouts) {
          const { user } = await eng.depositAllowance(uid).catch(() => ({ user: null }));
          if (user?.stripeAccountId) {
            const acct = await s.accounts.retrieve(user.stripeAccountId);
            if (acct.payouts_enabled) {
              await eng.setStripe(uid, { payoutsEnabled: true });
              me = await eng.me(uid);
            }
          }
        }
        const cashAllowed = cash !== 'off' && !!where.country && CONFIG.allowedCountries.includes(where.country) && !!where.region && !CONFIG.blockedRegions.includes(where.region);
        return json({
          status: me?.username ? 'ready' : 'needs_profile',
          me,
          cash: { mode: cash, allowed: cashAllowed, region: where.region, entries: CONFIG.cashEntries, minWithdrawalCents: CONFIG.minWithdrawalCents },
          coinEntries: CONFIG.coinEntries,
          vipCost: CONFIG.vipCost,
        });
      }
      default: {
        const out = await gameDispatch(eng, uid, fn, args, cashOpts);
        if (out !== undefined) return json(out);
        break;
      }
      // ------------------------------------------------------------- cash (Stripe)
      case 'deposit': {
        const s = stripe();
        if (cash === 'off' || !s) throw new AppError('cash_disabled', 403);
        const cents = int(args.cents, 'amount');
        if (cents < 500 || cents > 50_000) throw new AppError('bad_amount');
        const { remaining, user } = await eng.depositAllowance(uid);
        if (user.selfExcludedUntil && user.selfExcludedUntil > Date.now()) throw new AppError('self_excluded', 403);
        if (!user.dob || !(await eng.me(uid))?.adult) throw new AppError('underage', 403);
        if (!cashOpts.country || !CONFIG.allowedCountries.includes(cashOpts.country) || !cashOpts.region || CONFIG.blockedRegions.includes(cashOpts.region)) throw new AppError('region_blocked', 403);
        if (cents > remaining) throw new AppError('deposit_limit', 403);
        let customer = user.stripeCustomerId;
        if (!customer) {
          customer = (await s.customers.create({ phone: user.phone, metadata: { uid } }, { idempotencyKey: `cust-${uid}` })).id;
          await eng.setStripe(uid, { customerId: customer });
        }
        const origin = siteOrigin(req);
        const session = await s.checkout.sessions.create({
          mode: 'payment',
          customer,
          client_reference_id: uid,
          metadata: { uid, kind: 'deposit' },
          payment_intent_data: { metadata: { uid, kind: 'deposit' } },
          line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: 'RivalArcade cash balance' } } }],
          success_url: `${origin}/?wallet=deposited`,
          cancel_url: `${origin}/?wallet=cancelled`,
        });
        return json({ url: session.url });
      }
      case 'kycStart': {
        const s = stripe();
        if (!s) throw new AppError('cash_disabled', 403);
        const v = await s.identity.verificationSessions.create({
          type: 'document',
          metadata: { uid },
          options: { document: { require_matching_selfie: true, require_live_capture: true, allowed_types: ['driving_license', 'id_card', 'passport'] } },
          return_url: `${siteOrigin(req)}/?wallet=kyc`,
        });
        await eng.setKyc(uid, 'pending', null);
        return json({ url: v.url });
      }
      case 'payoutsOnboard': {
        const s = stripe();
        if (!s) throw new AppError('cash_disabled', 403);
        const { user } = await eng.depositAllowance(uid);
        let account = user.stripeAccountId;
        if (!account) {
          account = (
            await s.accounts.create(
              { type: 'express', country: 'US', business_type: 'individual', capabilities: { transfers: { requested: true } }, metadata: { uid } },
              { idempotencyKey: `acct-${uid}` },
            )
          ).id;
          await eng.setStripe(uid, { accountId: account });
        }
        const origin = siteOrigin(req);
        const link = await s.accountLinks.create({ account, type: 'account_onboarding', refresh_url: `${origin}/?wallet=payouts`, return_url: `${origin}/?wallet=payouts` });
        return json({ url: link.url });
      }
      case 'withdraw': {
        const s = stripe();
        if (!s) throw new AppError('cash_disabled', 403);
        const cents = int(args.cents, 'amount');
        const id = await eng.requestWithdrawal(uid, cents);
        const { user } = await eng.depositAllowance(uid);
        try {
          const tr = await s.transfers.create({ amount: cents, currency: 'usd', destination: user.stripeAccountId!, metadata: { uid, withdrawal: id } }, { idempotencyKey: `wd-${id}` });
          await eng.finishWithdrawal(id, true, tr.id, null);
          return json({ ok: true, id });
        } catch (e) {
          await eng.finishWithdrawal(id, false, null, e instanceof Error ? e.message.slice(0, 200) : 'transfer_failed');
          throw new AppError('payout_failed', 502);
        }
      }

      // ------------------------------------------------------------- local test runs only
      case '__test': {
        if (!testBackend()) throw new AppError('unknown_fn', 404);
        if (args.credit) await eng.creditDeposit(uid, int(args.credit), `test-${Date.now()}-${Math.random()}`);
        if (args.advanceMs) clock().offset += int(args.advanceMs);
        if (args.tick) await eng.tick();
        if (args.kyc) {
          await eng.setKyc(uid, 'verified', '1990-01-01');
          await eng.setStripe(uid, { accountId: 'acct_test', payoutsEnabled: true });
        }
        return json({ ok: true });
      }
    }
    throw new AppError('unknown_fn', 404);
  } catch (e) {
    return errorResponse(e);
  }
}
