// Offline Canopy Swing check: simulated players (different reaction times) on seeded courses.
// Run after: sh scripts/build-tests.sh   →   node tests/swing-sim.cjs
const P = require('../.test-build/grapple-physics');
const { mulberry32 } = require('../.test-build/rng');
function run(seed, react, noise, r2) {
  const rng = mulberry32(seed);
  const as = [P.FIRST_ANCHOR];
  const ensure = (n) => { while (as.length < n + 4) { const i = as.length; as.push(P.nextAnchor(as[i - 1], i, rng)); } };
  ensure(5);
  let t = 0;
  const A0 = P.anchorPos(as[0], 0);
  const b = { f: A0.f + 3.4 * Math.sin(-0.75), y: A0.y - 3.4 * Math.cos(-0.75), vf: 0, vy: 0 };
  let line = P.grab(b, 0, A0, P.stageAt(0));
  let target = 1, caught = 0, pendingRel = -1, spins = 0;
  const h = 1 / 240;
  for (let k = 0; k < 240 * 900; k++) {
    const st = P.stageAt(target);
    const dt = h * st.speed;
    t += dt;
    const pv = line ? P.anchorPos(as[line.anchor], t) : null;
    if (P.step(b, line, pv, dt)) { line = null; spins++; }
    if (line && pendingRel < 0 && P.releaseWorks(b, as[target], st.reach, t)) pendingRel = t + react + (r2() - 0.5) * noise;
    if (line && pendingRel >= 0 && t >= pendingRel) { line = null; pendingRel = -1; }
    if (!line) {
      const g = P.grabbable(b, as, target, t, st.reach);
      if (g >= 0) { line = P.grab(b, g, P.anchorPos(as[g], t), P.stageAt(g)); caught += g - target + 1; target = g + 1; ensure(target); }
      else if (b.f > as[target].f + 0.6) target++;
    }
    if (b.y < P.WATER_Y + 0.35) return { caught, secs: Math.round(t), spins };
  }
  return { caught, secs: Math.round(t), timeout: true };
}
for (const [react, noise] of [[0.05, 0.03], [0.12, 0.08], [0.2, 0.14], [0.3, 0.2]]) {
  const res = [];
  for (let s = 1; s <= 8; s++) res.push(run(s * 97, react, noise, mulberry32(s)));
  console.log('react', react, 'noise', noise, res.map((r) => `${r.caught}${r.timeout ? '+' : ''}/${r.secs}s`).join(' '));
}
