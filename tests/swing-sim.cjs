// Offline Canopy Swing check: simulated hold-to-grab players (different reaction times) on seeded
// courses, using the same rules as the game loop (brambles, pads, berries).
// Run after: sh scripts/build-tests.sh   →   node tests/swing-sim.cjs
const P = require('../.test-build/grapple-physics');
const { mulberry32 } = require('../.test-build/rng');
function run(seed, react, noise, r2) {
  const rng = mulberry32(seed);
  const as = [{ ...P.FIRST_ANCHOR }];
  const ensure = (n) => { while (as.length < n + 6) { const i = as.length; as.push(P.nextAnchor(as[i - 1], i, rng)); } };
  ensure(5);
  let t = 0;
  const A0 = P.anchorPos(as[0], 0);
  const b = { f: A0.f + P.ROPE * Math.sin(-0.8), y: A0.y - P.ROPE * Math.cos(-0.8), vf: 0, vy: 0 };
  let line = P.grab(b, 0, A0);
  let target = 1, passed = 0, pendingRel = -1, hits = 0, bounces = 0, bigAir = 0, last = 0, berries = 0;
  const taken = new Set();
  const knocked = new Set();
  let stun = 0;
  const h = 1 / 240;
  for (let k = 0; k < 240 * 900; k++) {
    const st = P.stageAt(target);
    const dt = h * st.speed;
    t += dt;
    stun = Math.max(0, stun - h);
    const pv = line ? P.anchorPos(as[line.anchor], t) : null;
    P.step(b, line, pv, dt);
    // holding on the rope: let go (after reaction time) once the release would carry you to the next point
    if (line && pendingRel < 0 && P.releaseWorks(b, as[target], st.reach, t, as[target - 1].bramble)) pendingRel = t + react + (r2() - 0.5) * noise;
    if (line && pendingRel >= 0 && t >= pendingRel) { line = null; pendingRel = -1; }
    if (!line && stun <= 0) {
      // the finger goes back down right away: catch whatever comes in reach
      const g = P.grabbable(b, as, target + 1, t, st.reach);
      if (g >= target) { const Ag = P.anchorPos(as[g], t); as[g].y0 = Ag.y; as[g].bob = 0; line = P.grab(b, g, Ag); if (g - last >= 2) bigAir++; last = g; target = g + 1; ensure(target); }
    }
    for (const br of [as[target - 2]?.bramble, as[target - 1]?.bramble, as[target]?.bramble]) {
      if (br && !knocked.has(br) && P.hitsBramble(b, br)) { knocked.add(br); hits++; line = null; b.vf = -2.5; b.vy = Math.min(b.vy, -2) - 2; stun = 0.6; }
    }
    if (!line && P.padBounce(b, as, target)) bounces++;
    for (let i = Math.max(0, target - 2); i <= target; i++) for (const bb of as[i].berries || []) if (!taken.has(bb) && Math.hypot(b.f - bb.f, b.y - bb.y) < 0.7) { taken.add(bb); berries++; }
    while (passed + 1 < as.length && b.f > as[passed + 1].f) passed++;
    if (!line && b.f > as[target].f + 0.6) { target++; ensure(target); }
    if (b.y < P.WATER_Y + 0.35) return { passed, secs: Math.round(t), hits, bounces, bigAir, berries };
  }
  return { passed, secs: Math.round(t), timeout: true, berries };
}
for (const [react, noise] of [[0.05, 0.03], [0.12, 0.08], [0.2, 0.14], [0.3, 0.2]]) {
  const res = [];
  for (let s = 1; s <= 8; s++) res.push(run(s * 97, react, noise, mulberry32(s)));
  console.log('react', react, 'noise', noise, res.map((r) => `${r.passed}${r.timeout ? '+' : ''}/${r.secs}s/b${r.berries}${r.hits ? '/x' + r.hits : ''}`).join(' '));
}
