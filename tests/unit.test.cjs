const assert = require('assert');
const { mulberry32, hashSeed, seedCode } = require('../.test-build/rng');
const { questsForDay, applyQuestEvent, msUntilLocalMidnight, localDayKey } = require('../.test-build/quests');
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

const G = require('../.test-build/game-types');
ok('stakes & payouts mirror the server: 10% fee, arena pays at most the pot', () => {
  for (const e of G.STAKES) {
    if (e === 0) continue;
    assert.strictEqual(G.duelPrize(e), Math.floor(e * 2 * 0.9));
    const p = G.arenaPrizes(e);
    assert(p[0] > p[1] && p[1] > p[2]);
    assert(p.reduce((a, b) => a + b, 0) <= G.ARENA_SIZE * e * 0.9, 'arena pays out at most the pot minus fee');
  }
  assert.strictEqual(G.duelPrize(0), 40);
  assert.deepStrictEqual(G.arenaPrizes(0), [60, 36, 24]);
  assert.deepStrictEqual(G.arenaPrizes(100), [225, 135, 90]);
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

ok('item catalog: unique ids + names, priced inside their rarity band, image per item', () => {
  const C = require('../.test-build/cosmetics-catalog');
  const items = C.SHOP_ITEMS();
  assert(items.length >= 70, `catalog size ${items.length}`);
  assert.strictEqual(new Set(items.map((i) => i.id)).size, items.length, 'duplicate item id');
  assert.strictEqual(new Set(items.map((i) => i.name.toLowerCase())).size, items.length, 'duplicate item name');
  const fs = require('fs');
  for (const i of items) {
    const [lo, hi] = C.RARITY[i.rarity].price;
    if (!i.isUnlockedDefault) assert(i.cost >= lo && i.cost <= hi, `${i.id} costs ${i.cost}, ${i.rarity} band is ${lo}-${hi}`);
    assert(fs.existsSync(`public${C.itemImage(i.id)}`), `missing image for ${i.id}`);
  }
  // Higher rarity never cheaper on average.
  const avg = (r) => { const xs = items.filter((i) => i.rarity === r && !i.isUnlockedDefault).map((i) => i.cost); return xs.reduce((a, b) => a + b, 0) / xs.length; };
  const order = ['common', 'rare', 'epic', 'legendary', 'mythic'].map(avg);
  assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order);
});

ok('item looks: every item has its own design, and named features are really there', () => {
  const C = require('../.test-build/cosmetics-catalog');
  const L = require('../.test-build/item-looks');
  const items = C.SHOP_ITEMS();
  // No two items in a slot share a design (shape + features + print + finish + colours).
  const sigs = new Map();
  for (const i of items) {
    const sig = L.signature(i);
    assert(!sigs.has(sig), `${i.id} looks identical to ${sigs.get(sig)}`);
    sigs.set(sig, i.id);
  }
  // Every top, bottom, shoe and trail has an explicit look (no silent default).
  for (const i of items) {
    const shape = C.itemShape(i);
    if (i.category === 'shirt') assert(L.TOP_LOOKS[shape], `no top look for ${i.id}`);
    if (i.category === 'pants') assert(L.BOTTOM_LOOKS[shape], `no bottom look for ${i.id}`);
    if (i.category === 'shoes') assert(L.SHOE_LOOKS[shape], `no shoe look for ${i.id}`);
    if (i.category === 'trail') assert(L.TRAIL_STYLE[shape], `no trail style for ${i.id}`);
  }
  // Trails each move differently.
  const trails = items.filter((i) => i.category === 'trail');
  assert.strictEqual(new Set(trails.map((t) => L.trailStyle(t))).size, trails.length, 'two trails share a style');
  // Names promise features: check the ones a player would notice.
  const find = (id) => items.find((i) => i.id === id);
  const promise = [
    [/hoodie/i, (i) => L.topLook(i).hood],
    [/jersey|tee\b/i, (i) => L.topLook(i).sleeves === 'short'],
    [/vest/i, (i) => L.topLook(i).sleeves === 'none'],
    [/coat/i, (i) => L.topLook(i).coat],
    [/bomber|windbreaker|jacket/i, (i) => L.topLook(i).sleeves === 'long' && L.topLook(i).collar],
    [/#\s?(\d+)/, (i) => L.topLook(i).emblem?.text === i.name.match(/#\s?(\d+)/)[1]],
    [/shorts/i, (i) => L.bottomLook(i).length === 'shorts'],
    [/leggings/i, (i) => L.bottomLook(i).length === 'leggings'],
    [/cargo/i, (i) => L.bottomLook(i).cargo],
    [/high-tops/i, (i) => L.shoeLook(i).height === 'high'],
    [/boots/i, (i) => L.shoeLook(i).height === 'boot'],
    [/cleats/i, (i) => L.shoeLook(i).studs],
    [/lows/i, (i) => L.shoeLook(i).height === 'low'],
  ];
  for (const i of items.filter((x) => ['shirt', 'pants', 'shoes'].includes(x.category)))
    for (const [re, has] of promise) if (re.test(i.name)) assert(has(i), `"${i.name}" is missing what its name promises (${re})`);
  // Recolours that share a base shape still differ in print or colour.
  assert(find('headwear_lava_snapback').pattern === 'flames');
  assert(C.itemShape(find('eyewear_ruby_shades')) !== C.itemShape(find('eyewear_pixel_shades')));
  // A hairstyle's shop colour is one the player can pick, so equipping it matches the image.
  for (const h of items.filter((x) => x.category === 'hair')) assert(C.HAIR_COLORS.some((c) => c.color === h.color), `${h.id} colour not in HAIR_COLORS`);
});

ok('canopy swing: deterministic course, every gap makeable, holding too long spins you out', () => {
  const P = require('../.test-build/grapple-physics');
  const { mulberry32 } = require('../.test-build/rng');
  const gen = (seed, n) => {
    const rng = mulberry32(seed);
    const as = [P.FIRST_ANCHOR];
    for (let i = 1; i <= n; i++) as.push(P.nextAnchor(as[i - 1], i, rng, as[i - 2]));
    return as;
  };
  const as = gen(1234, 90);
  for (let i = 1; i < as.length; i++) {
    const st = P.stageAt(i);
    const b = as[i];
    if (b.thorn) continue; // thorns are flown past
    const viaThorn = as[i - 1].thorn;
    const from = { ...as[viaThorn ? i - 2 : i - 1], bob: 0 };
    const amp = viaThorn ? P.POWER_AMP : undefined;
    assert(P.reachable(from, { ...b, bob: 0, y0: b.y0 + b.bob }, st, 0, amp) && P.reachable(from, { ...b, bob: 0, y0: b.y0 - b.bob }, st, 0, amp), `gap ${i} not makeable${viaThorn ? ' (past a thorn)' : ''}`);
  }
  assert(as.some((a) => a.thorn) && as.slice(0, 15).every((a) => !a.thorn), 'thorns only after the start');
  assert(!as.some((a, i) => a.thorn && as[i - 1]?.thorn), 'never two thorns in a row');
  const gap = (x, y) => (as[y].f - as[x].f) / (y - x);
  assert(gap(60, 90) > gap(1, 12) + 1, `crazy gaps (${gap(60, 90)}) should be wider than slow (${gap(1, 12)})`);
  assert(as.slice(56).some((a) => a.bob > 0) && as.slice(1, 12).every((a) => a.bob === 0), 'only later branches bob');
  assert.deepStrictEqual(['SLOW', 'MIDDLE', 'FINAL', 'CRAZY'], [0, 12, 30, 55].map((i) => P.stageAt(i).name));
  assert(P.stageAt(80).pump > P.stageAt(0).pump && P.stageAt(80).reach < P.stageAt(0).reach, 'later stages pump faster, reach less');
  assert.deepStrictEqual(gen(77, 30).map((a) => a.f), gen(77, 30).map((a) => a.f));
  // Hang on: the rope never stretches, the swing grows, and holding too long spins out.
  const A = { f: 0, y: 10.5 };
  const b = { f: 1.5, y: 10.5 - 3, vf: 0, vy: 0 };
  const rope = P.grab(b, 0, A, P.stageAt(0));
  let maxD = 0;
  let spunAt = -1;
  for (let k = 0; k < 240 * 15 && spunAt < 0; k++) {
    if (P.step(b, rope, A, 1 / 240)) spunAt = k / 240;
    maxD = Math.max(maxD, Math.hypot(b.f - A.f, b.y - A.y));
  }
  assert(maxD <= Math.max(rope.L, 3.4) + 0.02, `rope stretched to ${maxD}`);
  assert(spunAt > 5 && spunAt < 16, `spin-out after ${spunAt}s`);
  // Short holds are safe: 2 seconds in, no spin-out.
  const b2 = { f: 1.5, y: 7.5, vf: 0, vy: 0 };
  const r2 = P.grab(b2, 0, A, P.stageAt(0));
  for (let k = 0; k < 480; k++) assert(!P.step(b2, r2, A, 1 / 240), 'spun out too soon');
  // Grab only works within reach, ahead of you.
  assert.strictEqual(P.grabbable({ f: 0, y: 8 }, [P.FIRST_ANCHOR, { f: 3, y0: 10, bob: 0, bobSpeed: 1, phase: 0 }], 1, 0, 4), 1);
  assert.strictEqual(P.grabbable({ f: 0, y: 8 }, [P.FIRST_ANCHOR, { f: 9, y0: 10, bob: 0, bobSpeed: 1, phase: 0 }], 1, 0, 4), -1);
});

ok('scoring: 1 point per action, specials and multipliers', () => {
  const S = require('../.test-build/scoring');
  assert.strictEqual(S.award(1).total, 1);
  assert.strictEqual(S.award(S.PTS.gold).total, 3);
  assert.strictEqual(S.award(1, { streak: 5 }).total, 2);
  assert.strictEqual(S.award(1, { timeLeft: 5 }).total, 2);
  assert.strictEqual(S.award(2, { streak: 6, timeLeft: 3 }).total, 8);
  const b = new S.ScoreBook();
  b.record(S.award(2, { streak: 5, timeLeft: 4 }), { Baskets: 1, 'Swish bonus': 1 });
  b.record(S.award(1), { Baskets: 1 });
  assert.strictEqual(b.score, 9);
  assert.strictEqual(b.breakdown().reduce((a, x) => a + x.points, 0), 9, 'breakdown sums to score');
});

console.log(`\n${n} unit checks passed`);
