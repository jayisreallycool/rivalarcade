/* Game-server checks against the in-memory store (same transaction rules as Firestore). */
const assert = require('assert');
const { Engine, CONFIG, utcDay } = require('../.test-build/server/engine');
const { MemoryStore } = require('../.test-build/server/store');
const { getStarterAvatar } = require('../.test-build/cosmetics-catalog');
const { questsForDay } = require('../.test-build/quests');

let t = Date.UTC(2026, 10, 5, 12, 0, 0);
const clock = { now: () => t };
const store = new MemoryStore();
const eng = new Engine(store, clock);
const av = getStarterAvatar('neutral');
const adultOpts = { cashEnabled: true, country: 'US', region: 'US-CA' };
let checks = 0;
const ok = (name) => {
  checks++;
  console.log(`  ✓ ${name}`);
};
async function rejects(p, code) {
  try {
    await p;
  } catch (e) {
    assert.strictEqual(e.code ?? e.message, code);
    return;
  }
  throw new Error(`expected ${code}`);
}
async function signup(uid, phone, name, dob = '1995-04-02') {
  await eng.ensureUser(uid, phone, null);
  await eng.completeProfile(uid, name, dob, av);
  return eng.me(uid);
}
async function play(uid, cid, score, secs = 61) {
  const { runToken } = await eng.startContestRun(uid, cid);
  t += secs * 1000;
  return eng.submitContestScore(uid, runToken, score, { baskets: 3 });
}

(async () => {
  // accounts
  await rejects(eng.ensureUser('x', null, null), 'phone_required');
  let me = await signup('a', '+15550000001', 'Alice');
  assert.strictEqual(me.coins, CONFIG.signupCoins);
  await rejects(eng.ensureUser('b2', '+15550000001', null), 'phone_in_use');
  await rejects(eng.completeProfile('a', 'Alice', '1995-04-02', av), 'profile_exists');
  await eng.ensureUser('b', '+15550000002', null);
  await rejects(eng.completeProfile('b', 'alice', '1995-04-02', av), 'username_taken');
  await rejects(eng.completeProfile('b', 'Bo', '2020-01-01', av), 'invalid_username');
  await rejects(eng.completeProfile('b', 'Bobby', '2020-01-01', av), 'too_young');
  await eng.completeProfile('b', 'Bobby', '1990-01-01', av);
  ok('one account per phone, unique usernames, age gate, welcome coins once');

  await rejects(eng.startPractice('ghost', 'dunk-rush'), 'no_profile');
  await eng.ensureUser('np', '+15550000009', null);
  await rejects(eng.startPractice('np', 'dunk-rush'), 'profile_incomplete');
  ok('no play without a finished profile');

  // cosmetics
  const CAT = require('../.test-build/cosmetics-catalog').COSMETICS_CATALOG;
  const pricey = CAT.find((c) => !c.isUnlockedDefault && c.cost > 2000 && c.category === 'headwear');
  await rejects(eng.saveAvatar('a', { ...av, headwearId: pricey.id }), `item_not_owned:${pricey.id}`);
  const cheap = CAT.find((c) => !c.isUnlockedDefault && c.cost > 0 && c.cost < 400 && c.category === 'headwear');
  await eng.buyItem('a', cheap.id);
  await rejects(eng.buyItem('a', cheap.id), 'already_owned');
  await eng.saveAvatar('a', { ...av, headwearId: cheap.id });
  me = await eng.me('a');
  assert.strictEqual(me.coins, CONFIG.signupCoins - cheap.cost);
  assert.strictEqual(me.avatar.headwearId, cheap.id);
  ok('buy and equip items; unowned items refused');

  // practice + anti-cheat
  let { runToken } = await eng.startPractice('a', 'dunk-rush');
  t += 2000;
  let r = await eng.submitPractice('a', runToken, 30, {});
  assert.strictEqual(r.flagged, 'too_fast');
  assert.strictEqual(r.coins, 0);
  ({ runToken } = await eng.startPractice('a', 'dunk-rush'));
  t += 61_000;
  r = await eng.submitPractice('a', runToken, 999, {});
  assert.strictEqual(r.flagged, 'over_max');
  ({ runToken } = await eng.startPractice('b', 'dunk-rush'));
  t += 61_000;
  r = await eng.submitPractice('b', runToken, 40, { baskets: 40 });
  assert.strictEqual(r.flagged, null);
  assert.ok(r.coins > 0 && r.xp === 30);
  await rejects(eng.submitPractice('b', runToken, 40, {}), 'already_submitted');
  me = await eng.me('a');
  assert.ok(me.underReview);
  ok('practice pays capped coins; impossible / instant scores rejected and flagged; one submit per run');

  // h2h coins, async
  await signup('c', '+15550000003', 'Cara');
  await signup('d', '+15550000004', 'Dev');
  const { contestId: h1 } = await eng.joinContest('c', 'h2h', 'dunk-rush', 'coins', 100);
  await rejects(eng.joinContest('c', 'h2h', 'dunk-rush', 'coins', 33), 'bad_entry');
  await play('c', h1, 30);
  let m = await eng.match('c', h1);
  assert.strictEqual(m.status, 'waiting');
  const { contestId: h1b } = await eng.joinContest('d', 'h2h', 'dunk-rush', 'coins', 100);
  assert.strictEqual(h1b, h1, 'matched into the waiting contest');
  await rejects(eng.startContestRun('d', 'nope'), 'not_entered');
  await play('d', h1, 20);
  m = await eng.match('c', h1);
  assert.strictEqual(m.status, 'settled');
  assert.strictEqual(m.rank, 1);
  assert.strictEqual(m.payout, 180);
  assert.strictEqual(m.opponents[0].username, 'Dev');
  const c = await eng.me('c');
  const d = await eng.me('d');
  assert.strictEqual(c.coins, CONFIG.signupCoins - 100 + 180);
  assert.strictEqual(d.coins, CONFIG.signupCoins - 100);
  assert.ok(c.rating > 1200 && d.rating < 1200 && c.rating + d.rating === 2400);
  assert.strictEqual(c.wins, 1);
  assert.strictEqual(d.losses, 1);
  assert.strictEqual(await eng.settle(h1), false);
  await rejects(eng.startContestRun('c', h1), 'already_played');
  ok('async 1v1: matched, one attempt each, winner paid pot minus 10%, Elo, idempotent settle');

  // tie → refunds
  const { contestId: h2 } = await eng.joinContest('c', 'h2h', 'neon-dash', 'coins', 50);
  await eng.joinContest('d', 'h2h', 'neon-dash', 'coins', 50);
  await play('c', h2, 25);
  await play('d', h2, 25);
  assert.strictEqual((await eng.me('c')).coins, c.coins);
  ok('1v1 tie returns both stakes');

  // device peers are never matched; shared device flags
  await signup('e', '+15550000005', 'Eve');
  const hash = 'ab'.repeat(32);
  await eng.registerDevice('c', hash);
  await eng.registerDevice('e', hash);
  const { contestId: h3 } = await eng.joinContest('c', 'h2h', 'gem-surge', 'coins', 25);
  const { contestId: h4 } = await eng.joinContest('e', 'h2h', 'gem-surge', 'coins', 25);
  assert.notStrictEqual(h3, h4);
  await signup('f', '+15550000006', 'Finn');
  await eng.registerDevice('f', hash);
  await rejects(eng.joinContest('f', 'h2h', 'gem-surge', 'usd', 100, adultOpts), 'account_review');
  ok('accounts on the same device are never matched; 3+ accounts on a device are held');

  // unmatched → refunded at close
  const before = (await eng.me('e')).coins;
  t += 25 * 3_600_000;
  await eng.tick();
  assert.strictEqual((await eng.me('e')).coins, before + 25);
  assert.strictEqual((await eng.match('e', h4)).status, 'cancelled');
  ok('a 1v1 that never finds an opponent is refunded when it closes');

  // abandoned run: the opponent who never submits loses
  const { contestId: h5 } = await eng.joinContest('c', 'h2h', 'canopy-swing', 'coins', 25);
  await eng.joinContest('d', 'h2h', 'canopy-swing', 'coins', 25);
  await play('c', h5, 20, 30);
  await eng.startContestRun('d', h5);
  t += 3601_000;
  m = await eng.match('c', h5);
  assert.strictEqual(m.status, 'settled');
  assert.strictEqual(m.rank, 1);
  ok('an abandoned run counts as 0 so the finished player is paid');

  // cash
  await rejects(eng.joinContest('c', 'h2h', 'dunk-rush', 'usd', 100, { ...adultOpts, region: 'US-AZ' }), 'region_blocked');
  await rejects(eng.joinContest('c', 'h2h', 'dunk-rush', 'usd', 100, { ...adultOpts, cashEnabled: false }), 'cash_disabled');
  await rejects(eng.joinContest('c', 'h2h', 'dunk-rush', 'usd', 100, adultOpts), 'insufficient_funds');
  await signup('k', '+15550000010', 'Kid', utcDay(t - 16 * 365.25 * 86_400_000));
  await rejects(eng.joinContest('k', 'h2h', 'dunk-rush', 'usd', 100, adultOpts), 'underage');
  assert.deepStrictEqual(await eng.creditDeposit('c', 1000, 'cs_1'), { credited: true, cashCents: 1000 });
  assert.deepStrictEqual(await eng.creditDeposit('c', 1000, 'cs_1'), { credited: false, cashCents: 1000 });
  await eng.creditDeposit('d', 500, 'cs_2');
  const { contestId: cash } = await eng.joinContest('c', 'h2h', 'dunk-rush', 'usd', 500, adultOpts);
  await eng.joinContest('d', 'h2h', 'dunk-rush', 'usd', 500, adultOpts);
  await play('c', cash, 35);
  await play('d', cash, 22);
  assert.strictEqual((await eng.me('c')).cashCents, 500 + 900);
  assert.strictEqual((await eng.me('d')).cashCents, 0);
  ok('cash 1v1: location / age / funds checks, idempotent deposits, $9 prize from $5 + $5');

  // withdrawals
  await rejects(eng.requestWithdrawal('c', 600), 'id_not_verified');
  await eng.setKyc('c', 'verified', '1995-04-02');
  await rejects(eng.requestWithdrawal('c', 600), 'payouts_not_set_up');
  await eng.setStripe('c', { accountId: 'acct_1', payoutsEnabled: true });
  await rejects(eng.requestWithdrawal('c', 100), 'min_withdrawal');
  await rejects(eng.requestWithdrawal('c', 99_999), 'insufficient_funds');
  const w = await eng.requestWithdrawal('c', 600);
  assert.strictEqual((await eng.me('c')).cashCents, 800);
  await eng.finishWithdrawal(w, false, null, 'bank_error');
  assert.strictEqual((await eng.me('c')).cashCents, 1400);
  await eng.finishWithdrawal(w, false, null, 'bank_error');
  assert.strictEqual((await eng.me('c')).cashCents, 1400);
  await rejects(eng.requestWithdrawal('a', 600), 'id_not_verified');
  ok('withdrawals need ID + payouts; failed payouts are reversed exactly once');

  // deposit limits / self-exclusion
  await eng.setLimits('d', 2000, 0);
  assert.strictEqual((await eng.depositAllowance('d')).remaining, 1500);
  await eng.setLimits('d', 9000, 0);
  assert.strictEqual((await eng.me('d')).depositLimitCents, 2000);
  await eng.setLimits('d', null, 7);
  await rejects(eng.joinContest('d', 'h2h', 'dunk-rush', 'coins', 25), 'self_excluded');
  await eng.joinContest('d', 'h2h', 'dunk-rush', 'coins', 0);
  ok('deposit limits only go down; self-exclusion blocks paid entries');

  // arena 50/30/20 of 90%
  const names = ['g', 'h', 'i', 'j', 'l'];
  for (const [i, n] of names.entries()) await signup(n, `+1555000010${i}`, `Arena${n}`);
  let arena;
  for (const n of names) arena = (await eng.joinContest(n, 'arena', 'cyber-reflex', 'coins', 100)).contestId;
  for (const [i, n] of names.entries()) await play(n, arena, 50 - i * 5);
  const prizes = await Promise.all(names.map((n) => eng.me(n).then((x) => x.coins - (CONFIG.signupCoins - 100))));
  assert.deepStrictEqual(prizes, [225, 135, 90, 0, 0]);
  ok('5-player arena pays 1st/2nd/3rd from the pot');

  // quests
  const day = utcDay(t);
  const qs = questsForDay(day);
  me = await eng.me('c');
  assert.strictEqual(me.quests.length, 4);
  const playThree = qs.find((q) => q.id === 'play-three');
  const notDone = me.quests.find((q) => !q.completed);
  if (notDone) await rejects(eng.claimQuest('c', notDone.id), 'quest_not_complete');
  const done = me.quests.find((q) => q.completed);
  if (done) {
    await eng.claimQuest('c', done.id);
    await rejects(eng.claimQuest('c', done.id), 'already_claimed');
  }
  await rejects(eng.claimQuest('c', 'nope'), 'unknown_quest');
  void playThree;
  ok('quests are measured on the server and claimed once');

  // season + vip
  await rejects(eng.claimSeason('z', 1, false), 'no_profile');
  me = await eng.me('c');
  if (me.xp >= 100) {
    await eng.claimSeason('c', 1, false);
    await rejects(eng.claimSeason('c', 1, false), 'already_claimed');
  }
  await rejects(eng.claimSeason('c', 1, true), 'not_vip');
  await rejects(eng.claimSeason('c', 5, false), 'tier_locked');
  ok('season rewards: locked by xp, VIP-only track, once each');

  // cups
  let cups = await eng.cups('c');
  assert.ok(cups.length >= 5);
  const free = cups.find((x) => x.entry === 0);
  await eng.joinCup('c', free.id);
  await rejects(eng.joinCup('c', free.id), 'already_joined');
  await eng.joinCup('d', free.id);
  await play('c', free.id, 40);
  await play('d', free.id, 45);
  cups = await eng.cups('c');
  const live = cups.find((x) => x.id === free.id);
  assert.strictEqual(live.top[0].username, 'Dev');
  t = live.closesAt + 1000;
  const dBefore = (await eng.me('d')).coins;
  await eng.tick();
  const dm = await eng.match('d', free.id);
  assert.strictEqual(dm.status, 'settled');
  assert.strictEqual(dm.rank, 1);
  assert.ok((await eng.me('d')).coins > dBefore);
  assert.ok((await eng.me('d')).inventory.includes(live.prizeItem));
  assert.strictEqual((await eng.cups('c')).find((x) => x.id === free.id), undefined);
  ok('cups: public standings, settle at close, winner gets coins + the prize item, next cup opens');

  // leaderboard & bans
  const lb = await eng.leaderboard();
  assert.ok(lb.length > 3 && lb[0].rating >= lb[1].rating);
  assert.ok(!('phone' in lb[0]));
  await eng.setBan('d', true, 'test');
  await rejects(eng.startPractice('d', 'dunk-rush'), 'account_suspended');
  assert.ok(!(await eng.leaderboard()).some((p) => p.uid === 'd'));
  ok('leaderboard is public-safe and drops banned players');

  // ledger is complete: balance = sum of entries
  for (const uid of ['a', 'b', 'c', 'd', 'g']) {
    const u = await store.get(`users/${uid}`);
    const rows = [...store.docs.entries()].filter(([p]) => p.startsWith(`users/${uid}/ledger/`)).map(([, v]) => v);
    const sum = (cur) => rows.filter((x) => x.currency === cur).reduce((a, x) => a + x.amount, 0);
    assert.strictEqual(sum('coins'), u.coins, `coins ledger ${uid}`);
    assert.strictEqual(sum('usd'), u.cashCents, `cash ledger ${uid}`);
  }
  ok('every balance equals the sum of its ledger');

  console.log(`\n${checks} game-server checks passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
