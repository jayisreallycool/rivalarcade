/**
 * Canopy Swing — vine-swing physics in the vertical plane of travel (`f` = metres forward, `y` = up).
 * Pure and deterministic, so the course generator can prove every gap is makeable and tests can too.
 *
 * One tap: TAP to let go and fly. You catch the next branch by yourself when you fly through its
 * ring — no tap, no aiming, no holding. The longer you stay on a vine the harder it pumps (bigger
 * swings, then loops over the top), so you launch faster and can fly over 1, 2, 3 or more rings.
 * Stay too long and it spins out and throws you off. Thorny branches (later) throw you off if you
 * fly into their ring: go over or under them.
 *
 * The course runs through four stages — SLOW → MIDDLE → FINAL → CRAZY — with wider gaps, shorter
 * reach, bobbing branches, thorns and faster spin-outs, so every run ends.
 */

export const G = 13;
export const WATER_Y = 0;
export const MAX_SPEED = 19;
/** Ideal rope length the vine settles to after a grab. */
export const ROPE = 3.4;
export const REEL_SPEED = 1.6;
/** A grab never makes the rope shorter than this. */
export const MIN_ROPE = 2.2;
/** Full turns over the top before you spin out. */
export const SPIN_OUT_TURNS = 2;

export interface Stage {
  name: 'SLOW' | 'MIDDLE' | 'FINAL' | 'CRAZY';
  /** First anchor index of the stage. */
  from: number;
  /** You catch a branch automatically when you fly within this distance of it (its ring). */
  reach: number;
  /** Swing size when you first grab (rad) and how fast holding pumps it bigger (rad/s). */
  amp0: number;
  pump: number;
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
  { name: 'SLOW', from: 0, reach: 2.1, amp0: 1.0, pump: 0.38, speed: 0.92, gap: [5.0, 6.0], dy: 0.6, bob: 0, color: '#4ade80' },
  { name: 'MIDDLE', from: 12, reach: 1.9, amp0: 1.05, pump: 0.5, speed: 1, gap: [5.8, 7.0], dy: 1.3, bob: 0.35, color: '#facc15' },
  { name: 'FINAL', from: 30, reach: 1.7, amp0: 1.1, pump: 0.65, speed: 1.08, gap: [6.6, 7.8], dy: 1.8, bob: 0.75, color: '#fb923c' },
  { name: 'CRAZY', from: 55, reach: 1.55, amp0: 1.15, pump: 0.85, speed: 1.16, gap: [7.2, 8.6], dy: 2.2, bob: 1.15, color: '#f43f5e' },
];

/** Stage settings at anchor index `i`; CRAZY keeps ramping until nobody can keep up. */
export function stageAt(i: number): Stage {
  let s = STAGES[0];
  for (const st of STAGES) if (i >= st.from) s = st;
  if (s.name !== 'CRAZY') return s;
  const k = Math.min(1, (i - s.from) / 45);
  return { ...s, reach: s.reach - 0.2 * k, pump: s.pump + 0.4 * k, speed: s.speed + 0.1 * k, gap: [s.gap[0] + 0.4 * k, s.gap[1] + 0.8 * k], bob: s.bob + 0.4 * k };
}

export interface Anchor {
  f: number;
  y0: number;
  bob: number;
  bobSpeed: number;
  phase: number;
  /** Thorny vine: grabbing it throws you off — fly past it. */
  thorn?: boolean;
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
  /** Seconds held on this vine — drives the pump. */
  t: number;
  /** Swing size at the moment of the grab, and the stage's pump rate. */
  amp0: number;
  pump: number;
  /** Rope angle last step and total turn (rad), for spin-out detection. */
  lastAngle: number;
  turned: number;
}

/** The swing size you're being pumped toward right now (grows while you hold on). */
export const targetAmp = (r: Rope) => r.amp0 + r.pump * r.t;

/** Rope angle from straight down (0) — forward is positive, ±π is straight up. */
export const ropeAngle = (b: Body, A: { f: number; y: number }) => Math.atan2(b.f - A.f, A.y - b.y);

/**
 * One physics step. With a rope: gravity, the rope's length constraint (it never stretches), a
 * gentle winch to the ideal length, and the pump that grows the swing while you hold on — past
 * straight-up it keeps you looping. Returns true when the swing has spun out of control.
 */
export function step(b: Body, rope: Rope | null, A: { f: number; y: number } | null, dt: number): boolean {
  b.vy -= G * dt;
  b.f += b.vf * dt;
  b.y += b.vy * dt;
  let spun = false;
  if (rope && A) {
    rope.t += dt;
    const Lold = rope.L;
    if (Math.abs(rope.L - ROPE) > 0.01) rope.L += Math.sign(ROPE - rope.L) * Math.min(Math.abs(ROPE - rope.L), REEL_SPEED * dt);
    rope.L = Math.max(MIN_ROPE, rope.L);
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
      const tf = -dy;
      const ty = df; // tangent, forward when the angle increases
      // winching in spins you faster (angular momentum is kept)
      if (Lold > rope.L) {
        const s0 = b.vf * tf + b.vy * ty;
        const k = Lold / rope.L - 1;
        b.vf += s0 * k * tf;
        b.vy += s0 * k * ty;
      }
      // pump toward the growing swing size; past π it drives full loops
      const theta = Math.atan2(df, -dy);
      const amp = targetAmp(rope);
      const want =
        amp < Math.PI
          ? Math.sqrt(Math.max(0, 2 * G * rope.L * (Math.cos(theta) - Math.cos(amp))))
          : Math.sqrt(2 * G * rope.L * (Math.cos(theta) + 1) + G * rope.L * (amp - Math.PI) * 4);
      const s = b.vf * tf + b.vy * ty;
      if (Math.abs(s) < want && want > 0.4) {
        const dir = Math.sign(s) || 1;
        const ns = s + (dir * want - s) * Math.min(1, dt * 5);
        b.vf += (ns - s) * tf;
        b.vy += (ns - s) * ty;
      }
      // spin-out: count how far round the rope has turned
      let da = theta - rope.lastAngle;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      rope.turned += da;
      rope.lastAngle = theta;
      if (Math.abs(rope.turned) > Math.PI * 2 * SPIN_OUT_TURNS) spun = true;
    }
  }
  const sp = Math.hypot(b.vf, b.vy);
  if (sp > MAX_SPEED) {
    b.vf *= MAX_SPEED / sp;
    b.vy *= MAX_SPEED / sp;
  }
  return spun;
}

/** A new rope on branch `i` at `A`, grabbed from `b`. */
export function grab(b: Body, i: number, A: { f: number; y: number }, s: Stage): Rope {
  const angle = ropeAngle(b, A);
  return { anchor: i, L: Math.max(MIN_ROPE, Math.hypot(b.f - A.f, b.y - A.y)), t: 0, amp0: s.amp0, pump: s.pump, lastAngle: angle, turned: 0 };
}

/** Full loops made on this vine so far. */
export const loops = (r: Rope) => Math.floor(Math.max(0, Math.abs(r.turned) - Math.PI) / (Math.PI * 2) + (Math.abs(r.turned) > Math.PI ? 1 : 0));

/** The branch you'd grab now: the nearest one ahead (from `from`) that's within reach. */
export function grabbable(b: Body, anchors: Anchor[], from: number, t: number, reach: number) {
  for (let i = from; i < Math.min(anchors.length, from + 6); i++) {
    const A = anchorPos(anchors[i], t);
    if (A.f < b.f - 0.4) continue;
    if (Math.hypot(A.f - b.f, A.y - b.y) <= reach && b.y < A.y + 0.5) return i;
  }
  return -1;
}

/**
 * Let go now from `b`: does the flight come within reach of branch `B` (with margin) while you're
 * clear of the river, at a point from which the new swing also clears the river? Used to prove
 * gaps are makeable and for the early "LET GO!" cue.
 */
export function releaseWorks(b: Body, B: Anchor, reach: number, t0 = 0, avoid?: Anchor) {
  const body = { ...b };
  const dtS = 1 / 120;
  for (let k = 0; k < 360; k++) {
    if (avoid) {
      const T = anchorPos(avoid, t0 + k * dtS);
      if (Math.hypot(T.f - body.f, T.y - body.y) <= reach * 1.15 && body.y < T.y + 0.5) return false; // would fly into the thorns
    }
    const P = anchorPos(B, t0 + k * dtS);
    const d = Math.hypot(P.f - body.f, P.y - body.y);
    if (d <= reach * 0.85 && body.y < P.y + 0.5 && P.y - Math.max(d, ROPE) > WATER_Y + 1.6) return true;
    step(body, null, null, dtS);
    if (body.y < WATER_Y + 1) return false;
  }
  return false;
}

/**
 * Can a typical swing from `a` make it to `b`? Simulates the steady swing on the ideal rope at the
 * stage's starting size, letting go at every point of the forward swing; true if some release works.
 */
export function reachable(a: Anchor, b: Anchor, s: Stage, t0 = 0, amp = s.amp0 + s.pump * 0.8, avoid?: Anchor) {
  const A = anchorPos(a, t0);
  // (amp ≥ π: a looping power swing; otherwise a normal swing pumped for a moment)
  for (let rel = 0; rel <= Math.min(amp, 2.6) - 0.05; rel += 0.04) {
    const w =
      amp < Math.PI
        ? Math.sqrt(Math.max(0, 2 * G * ROPE * (Math.cos(rel) - Math.cos(amp))))
        : Math.min(MAX_SPEED, Math.sqrt(2 * G * ROPE * (Math.cos(rel) + 1) + G * ROPE * (amp - Math.PI) * 4));
    const body: Body = { f: A.f + ROPE * Math.sin(rel), y: A.y - ROPE * Math.cos(rel), vf: w * Math.cos(rel), vy: w * Math.sin(rel) };
    if (releaseWorks(body, b, s.reach, t0, avoid)) return true;
  }
  return false;
}

/** A power swing (looping) — what you need to clear a thorny vine. */
export const POWER_AMP = Math.PI + 0.6;
const THORN_CHANCE: Record<Stage['name'], number> = { SLOW: 0, MIDDLE: 0.06, FINAL: 0.14, CRAZY: 0.22 };

/**
 * Next anchor after `prev` (index `i`), seeded; gaps a typical swing can't make are pulled in.
 * After a thorny vine, the next one must be reachable from the vine before the thorn with a
 * power swing. Thorns are never back to back.
 */
export function nextAnchor(prev: Anchor, i: number, rng: () => number, before?: Anchor): Anchor {
  const s = stageAt(i);
  let gap = s.gap[0] + rng() * (s.gap[1] - s.gap[0]);
  const y0 = Math.max(9, Math.min(13, prev.y0 + (rng() - 0.5) * 2 * s.dy));
  const bob = s.bob > 0 && rng() < 0.4 + 0.5 * (s.bob / 1.55) ? s.bob * (0.5 + rng() * 0.5) : 0;
  const bobSpeed = 1.1 + rng() * 0.9 + (s.name === 'CRAZY' ? 0.5 : 0);
  const phase = rng() * Math.PI * 2;
  const thorn = !prev.thorn && i > 14 && rng() < THORN_CHANCE[s.name];
  for (let tries = 0; tries < 20; tries++) {
    const cand: Anchor = { f: prev.f + gap, y0, bob, bobSpeed, phase, thorn };
    const ok = (from: Anchor, amp?: number, avoid?: Anchor) => {
      const f0 = { ...from, bob: 0 };
      return reachable(f0, { ...cand, bob: 0, y0: y0 + bob }, s, 0, amp, avoid) && reachable(f0, { ...cand, bob: 0, y0: y0 - bob }, s, 0, amp, avoid);
    };
    if (prev.thorn && before ? ok(before, POWER_AMP, { ...prev, bob: 0 }) : ok(prev)) return cand;
    gap -= 0.3;
  }
  return { f: prev.f + 4.6, y0: prev.y0, bob: 0, bobSpeed: 1, phase: 0, thorn: false };
}

export const FIRST_ANCHOR: Anchor = { f: 0, y0: 10.5, bob: 0, bobSpeed: 1, phase: 0 };
