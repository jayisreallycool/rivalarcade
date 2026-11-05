# RivalArcade production setup

How the app works:

- **Sign-in.** Players sign in with Firebase Auth, using a phone number or Google.
  - Every account must have a verified mobile number, and each number can belong to only one account.
- **Data.** Everything is stored in Firestore.
- **Server.** The Next.js server holds all the game logic in `lib/server/engine.ts`.
  - Browsers can only *read* their own account. They can never write to the database.
- **Payments.** Stripe handles cash deposits (Checkout), ID checks (Identity) and payouts (Connect Express).

---

## 1. Firebase (about 10 minutes)

1. Go to <https://console.firebase.google.com>, click **Add project** and give it a name. Google Analytics is optional.
2. **Build → Authentication → Get started**:
   - **Sign-in method → Phone → Enable.**
     - Phone sign-in on new projects needs the **Blaze (pay-as-you-go)** plan. US texts cost about $0.01 each.
   - **Sign-in method → Google → Enable.** Choose a support email, then save.
   - **Settings → Authorized domains → Add domain.** Add your Vercel domain (for example `rivalarcade.vercel.app`) and any custom domain.
   - **Settings → SMS region policy → Allow → United States.** This blocks texts to other countries, which cuts off most SMS fraud.
3. **Build → Firestore Database → Create database.** Pick Production mode and a US location.
   - Open the **Rules** tab, paste in the contents of `firestore.rules` from this repo, and click **Publish**.
4. Add the web app keys under **Project settings → General → Your apps → Add app → Web (</>)**. Register the app, then copy these values:
   - `apiKey` → `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `authDomain` → `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `projectId` → `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
   - `appId` → `NEXT_PUBLIC_FIREBASE_APP_ID`
5. Create the server key under **Project settings → Service accounts → Generate new private key**.
   - It downloads a JSON file. Paste its **whole contents** into `FIREBASE_SERVICE_ACCOUNT`.
   - Keep this file secret. It gives full access to your database.

## 2. Stripe (test mode)

1. Go to <https://dashboard.stripe.com> and switch on **Test mode**.
2. **Developers → API keys:** copy the secret key (`sk_test_…`) into `STRIPE_SECRET_KEY`.
3. **Connect → Get started:** choose *Platform* with **Express** accounts. This is needed for payouts.
4. **Identity:** activate it. This is needed for ID checks before withdrawals.
5. Set up the webhook under **Developers → Webhooks → Add endpoint**:
   - URL: `https://YOUR-DOMAIN/api/stripe/webhook`
   - Events:
     - `checkout.session.completed`
     - `checkout.session.async_payment_succeeded`
     - `identity.verification_session.verified`
     - `identity.verification_session.requires_input`
     - `account.updated` (tick **"Listen to events on Connected accounts"**)
   - Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
6. Test card: `4242 4242 4242 4242`, any future date, any CVC.

## 3. Optional: block VoIP numbers

To block internet and VoIP numbers, which can be created in bulk, create a Twilio account and add `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`.

- Each new account's number is checked once with Twilio Lookup. Lookups cost about $0.008 each.
- Without these keys, sign-up still requires a real text code. The VoIP check is simply skipped.

## 4. Vercel

Go to **Project → Settings → Environment Variables** and add every variable in `.env.example` for Production (and Preview if you use it):

- `NEXT_PUBLIC_SITE_URL`: your domain, for example `https://rivalarcade.vercel.app`.
- `CRON_SECRET`: any long random string. A daily cron job in `vercel.json` sweeps contests that have closed.
  - Matches also settle on their own as soon as both players finish, or whenever anyone opens their results.
- `CASH_MODE`: start with `test`.

Redeploy after adding the variables, because `NEXT_PUBLIC_*` values are baked in at build time.

## 5. Going live with real money

Before you switch `CASH_MODE=live` and use `sk_live_…` keys:

- **Legal review.** Skill-gaming laws vary by state. The blocked list (`CASH_BLOCKED_REGIONS`) defaults to AZ, AR, CT, DE, LA, MT, SC, SD and TN. Have a gaming lawyer confirm the list, your terms of service, your privacy policy and your prize rules.
- **Stripe approval.** Stripe treats paid skill contests as a restricted business. Apply and get written approval for this business type before taking live payments, or use a processor that specialises in skill gaming.
- **Terms & Privacy pages.** The sign-in screen refers to them, so publish real ones.
- **Anti-cheat limits.** The server keeps the seed secret until a run starts, times every run, rejects impossible scores and holds unusually large jumps for review.
  - It does **not** replay games on the server. For high-stakes cash play, consider adding server-side replay checks.
- **Account review.** Accounts flagged by the checks (shared devices, rejected runs) can't play for cash or withdraw.
  - To clear a flag, edit `riskFlags` on the player's document under `users/{uid}` in Firestore. To ban someone, set `banned: true` on the same document.

## Local test mode

Test mode needs no cloud accounts. It uses an in-memory database and accepts the text code `123456`:

```bash
RA_TEST_BACKEND=memory NEXT_PUBLIC_RA_TEST_AUTH=1 CASH_MODE=test npm run build && npm start
npm run test:unit     # 30 checks: game rules + the whole game server (wallets, matchmaking, payouts…)
npm run test:e2e      # browser tests: sign-in, PvP between two players, cups, wallet, all six 3D games
```

Test mode is refused automatically on Vercel.
