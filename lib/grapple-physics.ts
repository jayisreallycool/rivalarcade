/**
 * Canopy Swing — hook-gun physics in the vertical plane of travel (`f` = metres forward, `y` = up).
 * Pure and deterministic, so the course generator can prove every gap is makeable and tests can too.
 *
 * You hang from a rope hooked to a branch anchor. Tap: let go and fire the hook gun at the next
 * anchor. The hook flies at HOOK_SPEED; if the anchor is within the stage's rope range when it
 * lands, it bites and you swing from there, otherwise it misses and reloads. The rope is a real
 * length constraint (slack when you're closer than its length), so momentum carries through
 * every catch — release on the up-swing to fly far, late to fly high.
 *
 * The course runs through four stages — SLOW → MIDDLE → FINAL → CRAZY — that widen the gaps,
 * shorten the rope, make anchors bob and fray the rope faster (you can't hang around), so every
 * run ends: a strong player lasts a few minutes, nobody lasts forever.
 */

export const G = 15;
export const WATER_Y = 0;
export const HOOK_SPEED = 34;
export const RELOAD_S = 0.35;
/** Swing assist: hanging, you're kept swinging to at least this amplitude (rad). */
export const AMP = 1.05;
export const MAX_SPEED = 19;
export const MIN_ROPE = 2.8;
export const REEL_SPEED = 1.1;

export interface Stage {
  name: 'SLOW' | 'MIDDLE' | 'FINAL' | 'CRAZY';
  /** First anchor index of the stage. */
  from: number;
  /** Max rope length: the hook only bites within this distance. */
  range: number;
  /** Hooking from this distance band is a PERFECT shot. */
  sweet: [number, number];
  /** Seconds before a rope frays and snaps. */
  hold: number;
  /** Game-speed multiplier. */
  speed: number;
  gap: [number, number];
  /** Height change between anchors (±). */
  dy: number;
  /** Anchors bob up and down by up to this much. */
  bob: number;
  color: string;
}

export const STAGES: Stage[] = [
  { name: 'SLOW', from: 0, range: 8.2, sweet: [2.8, 5.0], hold: 9, speed: 0.9, gap: [4.4, 5.4], dy: 0.6, bob: 0, color: '#4ade80' },
  { name: 'MIDDLE', from: 12, range: 7.6, sweet: [3.0, 5.0], hold: 6, speed: 1, gap: [5.4, 6.9], dy: 1.4, bob: 0.35, color: '#facc15' },
  { name: 'FINAL', from: 30, range: 7.0, sweet: [3.2, 4.8], hold: 4.2, speed: 1.1, gap: [6.6, 8.2], dy: 2, bob: 0.8, color: '#fb923c' },
  { name: 'CRAZY', from: 55, range: 6.6, sweet: [3.4, 4.6], hold: 3, speed: 1.2, gap: [7.6, 9.2], dy: 2.4, bob: 1.25, color: '#f43f5e' },
];

/** Stage settings at anchor index `i`; CRAZY keeps ramping until nobody can keep up. */
export function stageAt(i: number): Stage {
  let s = STAGES[0];
  for (const st of STAGES) if (i >= st.from) s = st;
  if (s.name !== 'CRAZY') return s;
  const k = Math.min(1, (i - s.from) / 45);
  return { ...s, range: s.range - 0.7 * k, hold: s.hold - 1.2 * k, speed: s.speed + 0.12 * k, gap: [s.gap[0] + 0.8 * k, s.gap[1] + 1.4 * k], bob: s.bob + 0.5 * k };
}

export interface Anchor {
  f: number;
  y0: number;
  bob: number;
  bobSpeed: number;
  phase: number;
  /** Bonus anchors (gold) are worth 3. */
  gold: boolean;
}

export const anchorPos = (a: Anchor, t: number) => ({ f: a.f, y: a.y0 + a.bob * Math.sin(a.bobSpeed * t + a.phase) });

export interface Body {
  f: number;
  y: number;
  vf: number;
  vy: number;
}
export interface Rope {
  anchor: number;
  L: number;
  /** Seconds hanging on this rope (it frays at the stage's hold time). */
  t: number;
}

/**
 * One physics step. With a rope: gravity, then the rope pulls you back onto its circle (removing
 * outward speed), it reels in a little, and a gentle pump keeps the swing alive.
 */
export function step(b: Body, rope: Rope | null, A: { f: number; y: number } | null, dt: number) {
  b.vy -= G * dt;
  b.f += b.vf * dt;
  b.y += b.vy * dt;
  if (rope && A) {
    rope.t += dt;
    if (rope.L > MIN_ROPE) rope.L = Math.max(MIN_ROPE, rope.L - REEL_SPEED * dt);
    let df = b.f - A.f;
    let dy = b.y - A.y;
    const d = Math.hypot(df, dy) || 1e-6;
    if (d > rope.L) {
      df /= d;
      dy /= d;
      b.f = A.f + df * rope.L;
      b.y = A.y + dy * rope.L;
      const radial = b.vf * df + b.vy * dy;
      if (radial > 0) {
        b.vf -= radial * df;
        b.vy -= radial * dy;
      }
      // pump: keep at least the steady swing amplitude (only below the anchor)
      if (dy < 0) {
        const theta = Math.atan2(df, -dy);
        const want = Math.sqrt(Math.max(0, 2 * G * rope.L * (Math.cos(theta) - Math.cos(AMP))));
        const tf = -dy;
        const ty = df; // tangent (forward when theta increases)
        const s = b.vf * tf + b.vy * ty;
        if (Math.abs(s) < want && want > 0.4) {
          const dir = Math.sign(s) || 1;
          const ns = s + (dir * want - s) * Math.min(1, dt * 1.4);
          b.vf += (ns - s) * tf;
          b.vy += (ns - s) * ty;
        }
      }
    }
  }
  const sp = Math.hypot(b.vf, b.vy);
  if (sp > MAX_SPEED) {
    b.vf *= MAX_SPEED / sp;
    b.vy *= MAX_SPEED / sp;
  }
}

/** Where the gun hand is relative to the body point (the body point IS the hands). */
export const ropeAngle = (b: Body, A: { f: number; y: number }) => Math.atan2(b.f - A.f, A.y - b.y);

/**
 * Can a typical swing from `a` reach `b`? Simulates hanging on a 4 m rope at the steady swing,
 * letting go at every point of the forward swing and firing the hook; true if some release puts
 * the hook into `b` with margin (90% of the range, hook flight time included) before the river.
 */
export function reachable(a: Anchor, b: Anchor, range: number, t0 = 0) {
  const dtS = 1 / 120;
  for (let rel = -0.2; rel <= AMP - 0.05; rel += 0.05) {
    const L = 4;
    const A = anchorPos(a, t0);
    const w = Math.sqrt(Math.max(0, 2 * G * L * (Math.cos(rel) - Math.cos(AMP))));
    const body: Body = { f: A.f + L * Math.sin(rel), y: A.y - L * Math.cos(rel), vf: w * Math.cos(rel), vy: w * Math.sin(rel) };
    for (let k = 0; k < 360; k++) {
      const B = anchorPos(b, t0 + k * dtS);
      const d = Math.hypot(B.f - body.f, B.y - body.y);
      if (d <= range * 0.9 && d >= 1.2) {
        // where you'll be when the hook gets there
        const tt = d / HOOK_SPEED;
        const fy = body.y + body.vy * tt - 0.5 * G * tt * tt;
        const ff = body.f + body.vf * tt;
        if (Math.hypot(B.f - ff, B.y - fy) <= range * 0.9 && fy > WATER_Y + 1.2) return true;
      }
      step(body, null, null, dtS);
      if (body.y < WATER_Y + 1) break;
    }
  }
  return false;
}

/** Next anchor after `prev` (index `i`), seeded; gaps that a typical swing can't make are pulled in. */
export function nextAnchor(prev: Anchor, i: number, rng: () => number): Anchor {
  const s = stageAt(i);
  let gap = s.gap[0] + rng() * (s.gap[1] - s.gap[0]);
  const y0 = Math.max(8.5, Math.min(13, prev.y0 + (rng() - 0.5) * 2 * s.dy));
  const bob = s.bob > 0 && rng() < 0.4 + 0.5 * (s.bob / 1.75) ? s.bob * (0.5 + rng() * 0.5) : 0;
  const bobSpeed = 1.1 + rng() * 0.9 + (s.name === 'CRAZY' ? 0.6 : 0);
  const phase = rng() * Math.PI * 2;
  const gold = i > 4 && rng() < 0.08;
  for (let tries = 0; tries < 16; tries++) {
    const cand: Anchor = { f: prev.f + gap, y0, bob, bobSpeed, phase, gold };
    // must work with the anchor anywhere on its bob
    if (reachable(prev, { ...cand, bob: 0, y0: y0 + bob }, s.range) && reachable(prev, { ...cand, bob: 0, y0: y0 - bob }, s.range)) return cand;
    gap -= 0.35;
  }
  return { f: prev.f + 4.5, y0: prev.y0, bob: 0, bobSpeed: 1, phase: 0, gold: false };
}

export const FIRST_ANCHOR: Anchor = { f: 0, y0: 10.5, bob: 0, bobSpeed: 1, phase: 0, gold: false };
