/**
 * Content for the public info & legal pages (/terms, /privacy, /rules, …).
 * Plain data so pages stay consistent and easy to update. Have counsel review before launch.
 */

export interface InfoSection {
  id: string;
  heading: string;
  /** Paragraphs; a paragraph starting with "• " renders as a bullet. */
  body: string[];
}
export interface InfoPage {
  slug: string;
  title: string;
  kicker: string;
  summary: string;
  updated: string;
  sections: InfoSection[];
}

const UPDATED = 'November 5, 2026';
const FEE = '10%';

export const INFO_PAGES: InfoPage[] = [
  {
    slug: 'terms',
    title: 'Terms of Service',
    kicker: 'Legal',
    summary: 'The agreement between you and RivalArcade when you create an account, play, enter contests or use the wallet.',
    updated: UPDATED,
    sections: [
      { id: 'agreement', heading: '1. Agreement', body: ['By creating an account or using RivalArcade (the “Service”) you agree to these Terms, the Official Contest Rules, the Fair Play Policy, the Responsible Play Policy and the Privacy Policy. If you don’t agree, don’t use the Service.', 'We may update these Terms. We’ll post the new version here with a new “last updated” date and, for material changes, tell you in the app. Continuing to use the Service after a change means you accept it.'] },
      { id: 'eligibility', heading: '2. Eligibility', body: ['• You must be at least 13 to create an account and play for Rival Coins. If you are under 18, a parent or guardian must agree to these Terms for you.', '• Cash contests are only for people 18 or older (or the age of majority where you live, if higher) who are physically located in a US state where we offer them. See the Official Rules for the current list of excluded states.', '• You may not use the Service if you’ve been banned, or if using it would break the law where you are.'] },
      { id: 'accounts', heading: '3. Your account', body: ['• One account per person. Every account is tied to a verified mobile phone number; a number can only be used for one account. Internet/VoIP numbers may be refused.', '• Keep your phone and sign-in secure. You are responsible for everything done through your account.', '• The information you give us — including your date of birth — must be true. For withdrawals we verify your identity, and your verified details must match your account.', '• You may not sell, share, transfer or let anyone else use your account.'] },
      { id: 'skill', heading: '4. Skill-based contests', body: ['RivalArcade contests are games of skill. In every head-to-head, arena and cup, all players get the identical game seed (the same layout, targets and timing), so the outcome is decided by how well each player plays — not by chance. There is no house player and no computer opponent: you only ever play against real people.', 'Entry fees, prize amounts and the service fee are shown before you enter. We keep a service fee (currently ' + FEE + ') from paid prize pools; free contests have no fee.'] },
      { id: 'coins', heading: '5. Rival Coins', body: ['Rival Coins are a virtual, in-app currency with no cash value. They can’t be sold, transferred, redeemed or exchanged for money or anything of value outside the app, and they are never withdrawable. We may change how coins are earned or spent, and coins in a closed account are forfeited.'] },
      { id: 'cash', heading: '6. Cash balance, deposits & withdrawals', body: ['• Deposits are processed by our payment partner. Daily deposit limits apply, and you can set a lower personal limit at any time.', '• Your cash balance holds deposits and prizes. It is not a bank account and earns no interest.', '• Withdrawals require a verified identity and a payout account in your name. We may hold or refuse a withdrawal while we review suspected fraud, cheating, chargebacks or rule breaks.', '• Chargebacks or reversed deposits may result in negative balances, account suspension and recovery of prizes paid from those funds.', '• You are responsible for any taxes on your winnings. Where required by law we may collect tax information and issue tax forms.'] },
      { id: 'conduct', heading: '7. Fair play & conduct', body: ['You agree not to cheat, collude, use bots, scripts, emulators, modified clients or automation, exploit bugs, share an account, use multiple accounts, or interfere with the Service. See the Fair Play Policy. We may void results, withhold or reclaim prizes, and suspend or close accounts that break these rules.', 'Usernames must not impersonate others or contain hateful, sexual or offensive content.'] },
      { id: 'ip', heading: '8. Our content', body: ['The games, art, code and brand are owned by RivalArcade or its licensors. We give you a personal, non-transferable licence to use the Service as intended. Don’t copy, reverse-engineer or resell it.'] },
      { id: 'availability', heading: '9. Availability & changes', body: ['We work to keep the Service running but don’t guarantee it will always be available or error-free. If a technical problem on our side voids a contest, entry fees for that contest are refunded. We may change, suspend or retire games, modes and features.'] },
      { id: 'termination', heading: '10. Closing your account', body: ['You can close your account at any time from Help → Contact. Withdrawable cash will be paid out after the usual verification. We may suspend or close accounts that break these Terms; where the law allows, prizes obtained by breaking the rules are forfeited.'] },
      { id: 'disclaimers', heading: '11. Disclaimers & liability', body: ['The Service is provided “as is”. To the extent the law allows, we disclaim all implied warranties, and our total liability to you for any claim is limited to the greater of the amount you paid us in the 6 months before the claim or US $100. We aren’t liable for indirect or consequential losses.'] },
      { id: 'disputes', heading: '12. Disputes', body: ['Contact us first — most problems are solved quickly. These Terms are governed by the laws of the State of California, USA, without regard to conflict-of-law rules. Any dispute that can’t be resolved informally will be settled by the state or federal courts located in Los Angeles County, California, unless applicable law requires otherwise.'] },
      { id: 'contact', heading: '13. Contact', body: ['Questions about these Terms? Use the form on the Contact page.'] },
    ],
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    kicker: 'Legal',
    summary: 'What we collect, why, who we share it with, and the choices and rights you have.',
    updated: UPDATED,
    sections: [
      { id: 'collect', heading: 'What we collect', body: ['• Account: mobile phone number (required and verified), your Google account name and email if you sign in with Google, username, avatar and date of birth.', '• Gameplay: matches entered, scores, run timings and stats, results, ratings, quests and items.', '• Money: deposits, prizes, withdrawals and your transaction history. Card and bank details are collected and held by our payment partner — we never see or store full card numbers.', '• Identity checks: when you verify your ID for withdrawals, our verification partner processes your ID document and selfie and tells us the result and your verified date of birth.', '• Device & location: a hashed device identifier (used to stop multi-accounting), browser/app information, and your approximate location (country and state) derived from your IP address to decide whether cash contests are available.', '• Support: what you send us through the contact form.'] },
      { id: 'use', heading: 'How we use it', body: ['• To run your account, matchmaking, contests, prizes and payouts.', '• To keep play fair and the Service secure: detect cheating, collusion, fraud and multiple accounts.', '• To meet legal duties such as age and location checks, identity verification, tax and anti-money-laundering obligations.', '• To support you and improve the games.', 'We don’t sell your personal information and we don’t use it for third-party advertising.'] },
      { id: 'share', heading: 'Who we share it with', body: ['• Service providers who run parts of the Service for us: Google Firebase (sign-in and database), Vercel (hosting), our payment and identity-verification partner, and Twilio (phone number checks), each only for that purpose.', '• Other players see your username, avatar, rating, record and contest scores — never your phone number, date of birth or balances.', '• Authorities, when required by law or to protect players and the Service.', '• A buyer or successor if the business is sold, under this policy.'] },
      { id: 'retention', heading: 'How long we keep it', body: ['We keep account and transaction records while your account is open and afterwards for as long as the law requires (financial records are typically kept for several years). Gameplay data not needed for those purposes is deleted or anonymised.'] },
      { id: 'rights', heading: 'Your choices & rights', body: ['You can see most of your data in the app. You can ask us to access, correct or delete your personal information, or to close your account, through the Contact page. California residents have the rights described in the CCPA/CPRA, including to know, delete, correct and opt out of sale or sharing (we don’t sell or share for advertising). We won’t treat you differently for using these rights. Some records must be kept by law even after deletion.'] },
      { id: 'children', heading: 'Children', body: ['The Service is not for children under 13 and we don’t knowingly collect their information. If you believe a child under 13 has an account, contact us and we’ll delete it. Cash contests are 18+.'] },
      { id: 'security', heading: 'Security', body: ['Data is encrypted in transit, access is restricted, players can only read their own records, and every balance change is recorded in an append-only ledger. No system is perfectly secure, so please keep your phone and sign-in safe.'] },
      { id: 'storage', heading: 'Cookies & local storage', body: ['We use your browser’s local storage to keep you signed in, remember settings (sound, graphics quality) and identify your device for fraud prevention. We don’t use advertising cookies.'] },
      { id: 'changes', heading: 'Changes & contact', body: ['We’ll post updates here with a new date and tell you in the app about material changes. Privacy questions or requests: use the Contact page.'] },
    ],
  },
  {
    slug: 'rules',
    title: 'Official Contest Rules',
    kicker: 'How contests work',
    summary: 'Formats, entry fees, prizes, ties, eligibility and how results are decided — the same for every player.',
    updated: UPDATED,
    sections: [
      { id: 'formats', heading: 'Contest formats', body: ['• Practice — solo and free. No opponent, no entry fee; earns a small amount of Rival Coins and XP (daily cap applies). No cash.', '• 1v1 Head-to-Head — two real players, same seed, one run each, played asynchronously. Higher score wins the prize.', '• Live Arena — up to 5 real players on one seed. 1st, 2nd and 3rd share the prize pool 50% / 30% / 20%.', '• Cups — scheduled contests open to everyone for a set window. One run each; when the cup closes, the top 7 share the pool (35/22/15/10/8/6/4%) and 1st wins the cup’s exclusive item.'] },
      { id: 'entry', heading: 'Entry fees & prizes', body: ['Entry fees and prizes are shown before you join. Paid prize pools equal the total entry fees minus a ' + FEE + ' service fee. Free contests pay fixed Rival Coin prizes. Prizes are credited automatically when a contest settles.', '• If a 1v1 ends in a tie, both entry fees are refunded in full.', '• If nobody else joins your contest before it closes (24 hours for 1v1s and arenas), your entry fee is refunded.', '• Tied places in arenas and cups split the combined prize for those places equally.'] },
      { id: 'play', heading: 'Playing your run', body: ['Each entry gets exactly one run. The game seed is revealed only when your run starts and the server times the run. Leaving or closing the game mid-run ends the run with the score you had (a forfeit scores 0). A run that is started but never finished counts as 0 once its time limit passes.'] },
      { id: 'decide', heading: 'How results are decided', body: ['Results are decided by score only. Everyone in a contest plays the identical seed, so luck plays no part in who wins. Matchmaking pairs you with the oldest open contest at the same game and entry level; players who share a device are never matched together.'] },
      { id: 'review', heading: 'Score review', body: ['Scores that are impossible for the game, faster than the game allows, or far beyond a player’s history are rejected (scored 0) or held for review before any prize is paid. See the Fair Play Policy.'] },
      { id: 'eligible', heading: 'Eligibility for cash contests', body: ['Cash contests are open to players 18+ located in US states where we offer them, with a verified phone number. Withdrawals need a verified ID. Cash contests are currently not offered in: Arizona, Arkansas, Connecticut, Delaware, Louisiana, Montana, South Carolina, South Dakota and Tennessee. This list can change. Void where prohibited. Employees of RivalArcade and their households may not play for cash.'] },
      { id: 'disputes', heading: 'Questions about a result', body: ['If you think a result is wrong, contact us within 14 days with the date and game. We review the server’s run records; our decision after review is final, subject to the Terms of Service.'] },
    ],
  },
  {
    slug: 'fair-play',
    title: 'Fair Play Policy',
    kicker: 'Integrity',
    summary: 'How we keep every match fair, and what happens to accounts that try to cheat.',
    updated: UPDATED,
    sections: [
      { id: 'how', heading: 'How we keep it fair', body: ['• Same seed for everyone in a contest, kept secret until your run starts.', '• The server times every run and checks every score against what the game physically allows.', '• One account per verified mobile phone; internet/VoIP numbers may be refused.', '• Device checks: accounts that share a device are never matched against each other, and repeated multi-accounting is held for review.', '• No bots and no house players — every opponent is a real person.'] },
      { id: 'not-allowed', heading: 'Not allowed', body: ['• Cheats, hacks, bots, macros, auto-clickers, emulators or modified apps.', '• Multiple accounts, sharing an account, or playing on someone else’s account.', '• Colluding with other players, intentionally losing, or arranging results.', '• Exploiting bugs instead of reporting them.'] },
      { id: 'consequences', heading: 'What happens', body: ['Rejected runs score 0. Accounts under review can’t enter cash contests or withdraw until the review is complete. Confirmed cheating leads to voided results, forfeited prizes and a permanent ban. Report suspected cheating from the Contact page.'] },
    ],
  },
  {
    slug: 'responsible-play',
    title: 'Responsible Play',
    kicker: 'Play well',
    summary: 'Tools to stay in control, signs to watch for, and where to get help.',
    updated: UPDATED,
    sections: [
      { id: 'tools', heading: 'Your tools', body: ['• Daily deposit limit — set it in Profile → Wallet. Lowering it takes effect immediately.', '• Take a break — pause all paid play for 7 days or longer from the Wallet. Free practice stays available.', '• Close your account — contact us any time.'] },
      { id: 'tips', heading: 'Good habits', body: ['• Play for fun; treat entry fees as the cost of entertainment, never as a way to make money.', '• Set a budget and a time limit before you play.', '• Don’t chase losses or play when upset, tired or under the influence.', '• Take regular breaks — every run is short on purpose.'] },
      { id: 'signs', heading: 'Signs it may be a problem', body: ['• Spending more money or time than you planned.', '• Hiding how much you play, or borrowing money to play.', '• Feeling restless or irritable when you can’t play.'] },
      { id: 'help', heading: 'Get help', body: ['If you’re worried about your play or someone else’s, free confidential help is available 24/7 in the US: call or text 1-800-GAMBLER (National Problem Gambling Helpline). You can also reach us through the Contact page and we’ll help you set limits or close your account.'] },
      { id: 'minors', heading: 'Under 18', body: ['Cash contests are strictly 18+. We check age at sign-up and verify ID before any withdrawal. Parents can use device-level parental controls to restrict app access.'] },
    ],
  },
  {
    slug: 'about',
    title: 'About RivalArcade',
    kicker: 'Who we are',
    summary: 'Fast, fair, skill-based arcade games where you only ever play real people.',
    updated: UPDATED,
    sections: [
      { id: 'what', heading: 'What it is', body: ['RivalArcade is a collection of short 3D arcade games — Dunk Rush, Canopy Swing, Brick Blitz, Neon Dash, Gem Surge and Cyber Reflex — built for head-to-head competition. Practice solo for free, then challenge real players in 1v1s, 5-player arenas and scheduled cups.'] },
      { id: 'fair', heading: 'Fair by design', body: ['Everyone in a contest plays the identical seed, runs are timed by our server, and there are no bots or house players. Points are small and simple — usually 1 per hit — so every point is earned.'] },
      { id: 'play', heading: 'Play your way', body: ['Earn Rival Coins and XP, climb the leagues with crowns, unlock gear for your 3D avatar, and — where available and if you’re 18+ — play for cash prizes.'] },
    ],
  },
];

export const FAQ: { q: string; a: string }[] = [
  { q: 'Is RivalArcade gambling?', a: 'No. Every contest is a game of skill: all players get the exact same game seed, so the better score wins. There is no chance element deciding the result and no house player.' },
  { q: 'Who am I playing against?', a: 'Only real people. There are no bots. In a 1v1 you play your run now and your rival plays the same seed — results arrive when they finish (you’ll see them in Results).' },
  { q: 'Why do I need a phone number?', a: 'One account per verified mobile number keeps matches fair and stops people using multiple accounts. Internet/VoIP numbers may not be accepted.' },
  { q: 'What happens if nobody accepts my 1v1?', a: 'If no opponent joins within 24 hours, your entry fee is refunded automatically.' },
  { q: 'What if we tie?', a: 'A 1v1 tie refunds both entry fees in full. Tied places in arenas and cups split the prize for those places.' },
  { q: 'I closed the game mid-run. Can I replay?', a: 'No — each entry gets one run, and the score you had when you left counts. Practice is unlimited and free.' },
  { q: 'Are Rival Coins worth money?', a: 'No. Coins are virtual, can’t be withdrawn or sold, and are used for entries, items and the season pass.' },
  { q: 'Where can I play for cash?', a: 'Cash contests are for players 18+ in US states where we offer them. Arizona, Arkansas, Connecticut, Delaware, Louisiana, Montana, South Carolina, South Dakota and Tennessee are excluded. The app checks your location automatically.' },
  { q: 'How do withdrawals work?', a: 'Verify your ID once, set up your payout account in Profile → Wallet, then withdraw $5 or more. Payouts usually arrive in 2–3 business days.' },
  { q: 'My score was flagged. Why?', a: 'Scores that are faster or higher than the game allows are rejected, and unusually large jumps are reviewed before prizes are paid. If you think we got it wrong, contact us.' },
  { q: 'How do I delete my account or data?', a: 'Send a request from the Contact page. We’ll pay out any withdrawable cash and delete your data, keeping only what the law requires.' },
  { q: 'The 3D games won’t load.', a: 'Update your browser, close other tabs, and open the app in Safari or Chrome (not an in-app browser like TikTok or Instagram). The game automatically switches to a lighter 3D mode on older devices.' },
];

export const PAGE_LINKS: { href: string; label: string }[] = [
  { href: '/help', label: 'Help & FAQ' },
  { href: '/rules', label: 'Contest Rules' },
  { href: '/fair-play', label: 'Fair Play' },
  { href: '/responsible-play', label: 'Responsible Play' },
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];
