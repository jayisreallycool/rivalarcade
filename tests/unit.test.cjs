const assert = require('assert');
const { mulberry32, hashSeed, seedCode } = require('../.test-build/rng');
const { questsForDay, applyQuestEvent, msUntilLocalMidnight, localDayKey } = require('../.test-build/quests');
const T = require('../.test-build/tournaments-data');
const { referenceScore, botScore, botAvatar } = require('../.test-build/bots');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };

ok('same seed → identical sequence', () => {
  const a = mulberry32(42), b = mulberry32(42);
  const sa = Array.from({ length: 1000 }, a), sb = Array.from({ length: 1000 }, b);
  assert.deepStrictEqual(sa, sb);
  assert(sa.every((x) => x >= 0 && x < 1));
  assert.notDeepStrictEqual(sa.slice(0, 10), Array.from({ length: 10 }, mulberry32(43)));
});
ok('rng roughly uniform', () => {
  const r = mulberry32(7); const buckets = Array(10).fill(0);
  for (let i = 0; i < 100000; i++) buckets[Math.floor(r() * 10)]++;
  buckets.forEach((c) => assert(c > 9500 && c < 10500, c));
});
ok('seed code format', () => assert.match(seedCode(hashSeed('x')), /^[0-9A-F]{4}-[0-9A-F]{4}$/));

ok('daily quests: 4 per day, deterministic, always a duel quest', () => {
  const a = questsForDay('2026-10-27'), b = questsForDay('2026-10-27');
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.length, 4);
  assert(a.some((q) => q.id === 'duel-wins'));
  assert.strictEqual(new Set(a.map((q) => q.id)).size, 4);
  const days = new Set(['2026-10-27','2026-10-28','2026-10-29','2026-10-30'].map((d) => questsForDay(d).map((q) => q.id).join()));
  assert(days.size > 1, 'quests should rotate between days');
});
ok('quest progress: sum vs max, caps, completes', () => {
  let q = [{ id: 'dunk-baskets', progress: 0, target: 5, completed: false, claimed: false }, { id: 'reflex-combo', progress: 0, target: 15, completed: false, claimed: false }];
  q = applyQuestEvent(q, { gameId: 'dunk-rush', mode: 'practice', score: 20, stats: { baskets: 3 }, won: false });
  q = applyQuestEvent(q, { gameId: 'dunk-rush', mode: 'practice', score: 20, stats: { baskets: 4 }, won: false });
  assert.strictEqual(q[0].progress, 5); assert(q[0].completed);
  q = applyQuestEvent(q, { gameId: 'cyber-reflex', mode: 'duel', score: 99999, stats: { maxCombo: 9 }, won: true });
  assert.strictEqual(q[1].progress, 9, 'combo quest must use combo, not score'); assert(!q[1].completed);
  q = applyQuestEvent(q, { gameId: 'cyber-reflex', mode: 'duel', score: 1, stats: { maxCombo: 4 }, won: true });
  assert.strictEqual(q[1].progress, 9, 'max kind keeps best');
});
ok('midnight countdown', () => {
  const d = new Date(2026, 9, 27, 23, 30, 0).getTime();
  assert.strictEqual(msUntilLocalMidnight(d), 30 * 60000);
  assert.strictEqual(localDayKey(d), '2026-10-27');
});

const tpl = T.TOURNAMENT_TEMPLATES[0];
const now = Date.UTC(2026, 9, 27, 12);
ok('tournament lifecycle', () => {
  const t = T.createTournament(tpl, now, 1, 2000, { startDelayMin: 5 });
  assert.strictEqual(T.tournamentStatus(t, now), 'registering');
  assert.strictEqual(T.tournamentStatus(t, t.startsAt + 1), 'live');
  assert.strictEqual(T.tournamentStatus(t, t.endsAt), 'completed');
  assert(t.bots.length < tpl.maxParticipants);
  assert(t.bots.every((b) => b.submitAt >= t.startsAt && b.submitAt < t.endsAt));
  const mid = T.submittedBots(t, (t.startsAt + t.endsAt) / 2).length;
  assert(mid > 0 && mid < t.bots.length, 'bracket fills progressively');
  assert.strictEqual(T.submittedBots(t, t.endsAt).length, t.bots.length);
});
ok('standings rank user correctly; ties favour earlier poster', () => {
  const t = T.createTournament(tpl, now, 2, 2000, { progress: 0.5 });
  const sorted = [...t.bots].sort((a, b) => b.score - a.score);
  t.entered = true; t.userBest = sorted[2].score; // tie with 3rd bot
  const rows = T.standings(t, t.endsAt, { name: 'Me', avatar: {} });
  const me = rows.find((r) => r.isUser);
  assert.strictEqual(me.rank, 4);
  rows.forEach((r, i) => assert.strictEqual(r.rank, i + 1));
});
ok('settlement payouts', () => {
  const t = T.createTournament(tpl, now, 3, 2000, { progress: 0.5 });
  t.entered = true; t.userBest = Math.max(...t.bots.map((b) => b.score)) + 1;
  let r = T.settle(t, []);
  assert.strictEqual(r.rank, 1); assert.strictEqual(r.coins, Math.round(tpl.prizePoolCoins * 0.5)); assert.strictEqual(r.cosmetic, tpl.prizeCosmetic);
  r = T.settle(t, [tpl.prizeCosmetic]);
  assert.strictEqual(r.cosmetic, undefined); assert.strictEqual(r.cosmeticAsCoins, 400);
  t.userBest = 0; r = T.settle(t, []);
  assert.strictEqual(r.rank, t.bots.length + 1); assert.strictEqual(r.coins, 15);
});
ok('rival reference adapts to player form', () => {
  assert.strictEqual(referenceScore('neon-dash', []), 2200);
  const strong = referenceScore('neon-dash', [9000, 9500, 10000, 9800, 9200]);
  assert(strong > 8000, strong);
  const r = mulberry32(1); const scores = Array.from({ length: 500 }, () => botScore(r, 1000, 0.8, 1.2));
  assert(Math.min(...scores) >= 800 && Math.max(...scores) <= 1200);
  const avg = scores.reduce((a, b) => a + b) / scores.length; assert(avg > 960 && avg < 1040, avg);
});
ok('bot avatars deterministic and valid', () => {
  assert.deepStrictEqual(botAvatar(5), botAvatar(5));
  const a = botAvatar(99); ['hairStyleId','shirtId','pantsId','shoesId'].forEach((k) => assert(a[k] && a[k] !== 'none'));
});
const G = require('../.test-build/game-types');
ok('stakes & payouts: house edge, caps, free tiers', () => {
  for (const e of G.STAKES) {
    if (e === 0) continue;
    assert(G.duelPrize(e) < 2 * e && G.duelPrize(e) > e, 'duel prize between stake and pot');
    const p = G.arenaPrizes(e);
    assert(p[0] > p[1] && p[1] > p[2]);
    assert(p.reduce((a, b) => a + b, 0) <= G.ARENA_SIZE * e, 'arena pays out at most the pot');
    assert.strictEqual(G.streakPrize(e), e * 5);
    assert(G.blitzPayout(1e9, e, 2000) === e * 8, 'blitz capped at 8x');
    // A typical score roughly returns the stake
    const typical = G.blitzPayout(2000, e, 2000);
    assert(typical >= e && typical <= e * 1.2, `blitz typical ${typical} for ${e}`);
  }
  assert(G.duelPrize(0) > 0 && G.arenaPrizes(0)[0] > 0 && G.blitzPayout(5000, 0, 2000) <= 120);
  assert.deepStrictEqual(G.STREAK_TARGETS.slice().sort((a, b) => a - b), G.STREAK_TARGETS, 'streak targets rise');
});
ok('leagues by crowns', () => {
  assert.strictEqual(G.leagueFor(0).name, 'Bronze');
  assert.strictEqual(G.leagueFor(9).name, 'Bronze');
  assert.strictEqual(G.leagueFor(10).name, 'Silver');
  assert.strictEqual(G.leagueFor(500).name, 'Champion');
  assert.strictEqual(G.leagueFor(500).next, null);
  const s = G.leagueFor(17); assert(s.progress > 0 && s.progress < 1);
  assert(G.GAME_IDS.length === Object.keys(G.GAME_NAMES).length && G.GAME_IDS.every((id) => G.SCORE_BASELINE[id] > 0));
});

console.log(`\n${n} unit checks passed`);
