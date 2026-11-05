/**
 * Canopy Swing physics, in the vertical plane of travel: `f` = metres forward, `y` = height.
 * Pure and deterministic so the generator can prove every gap is makeable, and tests can too.
 *
 * Hanging on a vine is a pendulum (θ = 0 straight down, + = forward) that the player pumps to a
 * steady amplitude. Letting go launches along the swing's tangent; the next vine is caught when
 * the hands pass close enough to its rope. After a catch you slide down to the vine's grip knot,
 * so every swing from a vine is the same — which is what makes the release timing learnable.
 */

export const G = 14;
export const AMPLITUDE = 1.1; // rad: the steady swing the player pumps up to
export const WATER_Y = 0;

export interface Vine {
  /** Anchor (branch) position. */
  f: number;
  y: number;
  /** Rope length to the grip knot. */
  len: number;
  /** Late-game vines sway on their own: angle = sway·sin(speed·t + phase). */
  sway: number;
  speed: number;
  phase: number;
  /** Release window from THIS vine that reaches the next one (rad, forward swing). */
  window: [number, number];
}

export interface Hang {
  kind: 'hang';
  vine: number;
  L: number;
  theta: number;
  omega: number;
}
export interface Fly {
  kind: 'fly';
  f: number;
  y: number;
  vf: number;
  vy: number;
  from: number;
}
export type SwingState = Hang | Fly;

export const handPos = (v: Vine, s: Hang) => ({ f: v.f + s.L * Math.sin(s.theta), y: v.y - s.L * Math.cos(s.theta) });

/** Angular speed on the pumped swing at angle θ (forward = +). */
export const swingOmega = (L: number, theta: number, amp = AMPLITUDE) => Math.sqrt(Math.max(0, (2 * G * (Math.cos(theta) - Math.cos(amp))) / L));

/** Advance a hanging player; pumps toward the steady amplitude. */
export function stepHang(s: Hang, dt: number, targetL: number, amp = AMPLITUDE) {
  // slide down to the grip knot
  s.L += (targetL - s.L) * Math.min(1, dt * 7);
  const alpha = -(G / s.L) * Math.sin(s.theta);
  s.omega += alpha * dt;
  // pump: steer the swing's energy toward the target amplitude
  const want = swingOmega(s.L, s.theta, amp);
  if (want > 0.05) {
    const dir = Math.sign(s.omega) || 1;
    s.omega += (dir * want - s.omega) * Math.min(1, dt * 1.6);
  }
  s.theta += s.omega * dt;
  s.theta = Math.max(-amp - 0.05, Math.min(amp + 0.05, s.theta));
}

/** Let go: launch along the tangent. */
export function release(v: Vine, s: Hang, vineIndex: number): Fly {
  const p = handPos(v, s);
  return { kind: 'fly', f: p.f, y: p.y, vf: s.L * s.omega * Math.cos(s.theta), vy: s.L * s.omega * Math.sin(s.theta), from: vineIndex };
}

export function stepFly(s: Fly, dt: number) {
  s.vy -= G * dt;
  s.f += s.vf * dt;
  s.y += s.vy * dt;
}

/** Rope angle of a (possibly swaying) vine at time t. */
export const vineAngle = (v: Vine, t: number) => v.sway * Math.sin(v.speed * t + v.phase);

/** Distance from point to the vine's rope (anchor → knot) and where along it (0..1). */
export function ropeDistance(v: Vine, t: number, f: number, y: number) {
  const a = vineAngle(v, t);
  const tf = v.f + v.len * Math.sin(a);
  const ty = v.y - v.len * Math.cos(a);
  const df = tf - v.f;
  const dy = ty - v.y;
  const u = Math.max(0.25, Math.min(1, ((f - v.f) * df + (y - v.y) * dy) / (df * df + dy * dy)));
  const cf = v.f + df * u;
  const cy = v.y + dy * u;
  return { d: Math.hypot(f - cf, y - cy), u };
}

/** In-play catch test: the swaying rope, or where it would hang still — sway never robs a fair release. */
export function canCatch(v: Vine, t: number, f: number, y: number, k: number) {
  const r = catchRadius(k);
  return ropeDistance(v, t, f, y).d < r || ropeDistance({ ...v, sway: 0 }, 0, f, y).d < r;
}

/** Grab a vine at point (f, y) with velocity — keeps the swing's tangential speed. */
export function grab(v: Vine, index: number, f: number, y: number, vf: number, vy: number): Hang {
  const L = Math.max(0.8, Math.hypot(f - v.f, y - v.y));
  const theta = Math.atan2(f - v.f, v.y - y);
  const omega = (vf * Math.cos(theta) + vy * Math.sin(theta)) / L;
  return { kind: 'hang', vine: index, L, theta, omega };
}

/**
 * Does releasing from `a` at angle `alpha` (on the forward swing) reach `b`? Simulated with
 * the same integrator the game uses. Sway is ignored (it only ever widens or narrows a little).
 */
export function reaches(a: Vine, b: Vine, alpha: number, catchR: number) {
  const s: Hang = { kind: 'hang', vine: 0, L: a.len, theta: alpha, omega: swingOmega(a.len, alpha) };
  if (s.omega <= 0) return false;
  const fl = release(a, s, 0);
  const still = { ...b, sway: 0 };
  for (let i = 0; i < 400; i++) {
    stepFly(fl, 1 / 120);
    if (ropeDistance(still, 0, fl.f, fl.y).d < catchR) return true;
    if (fl.y < WATER_Y || fl.f > b.f + b.len + 1) return false;
  }
  return false;
}

/** Longest contiguous window of release angles from `a` that reach `b`. */
export function releaseWindow(a: Vine, b: Vine, catchR: number): [number, number] {
  let best: [number, number] = [0, 0];
  let start = -1;
  const step = 0.01;
  for (let x = -0.3; x <= AMPLITUDE - 0.02 + 1e-9; x += step) {
    const ok = reaches(a, b, x, catchR);
    if (ok && start < 0) start = x;
    if ((!ok || x + step > AMPLITUDE - 0.02) && start >= 0) {
      const end = ok ? x : x - step;
      if (end - start > best[1] - best[0]) best = [start, end];
      start = -1;
    }
  }
  return best;
}

/** The flight path for a release angle (for placing fruit on the ideal line). */
export function flightPath(a: Vine, alpha: number, steps = 60, dt = 1 / 30) {
  const s: Hang = { kind: 'hang', vine: 0, L: a.len, theta: alpha, omega: swingOmega(a.len, alpha) };
  const fl = release(a, s, 0);
  const pts: { f: number; y: number }[] = [];
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < 4; k++) stepFly(fl, dt / 4);
    pts.push({ f: fl.f, y: fl.y });
  }
  return pts;
}

/** Difficulty 0…1 by vines caught. */
export const swingK = (vines: number) => Math.min(1, vines / 45);
export const catchRadius = (k: number) => 0.62 - 0.24 * k;

/**
 * Next vine after `prev`, seeded. Gap, height step and rope length tighten with `k`; the window
 * that reaches it must stay at least `minWindow(k)` wide, otherwise the gap is pulled in.
 */
export function nextVine(prev: Vine, k: number, rng: () => number, index: number): Vine {
  // Windows are proven with a tighter radius than play uses, so any release inside the window
  // always lands — even on a swaying vine (see canCatch).
  const catchR = catchRadius(k) * 0.85;
  const minWindow = 0.42 - 0.16 * k;
  let gap = 3.6 + (1.6 + rng() * 0.9) * k + rng() * 0.6;
  const dy = (rng() - 0.5) * (0.6 + 2.2 * k);
  const len = 3.1 + rng() * (0.9 - 0.4 * k);
  const sway = index > 10 && rng() < 0.25 + 0.4 * k ? 0.12 + 0.18 * k * rng() : 0;
  for (let tries = 0; tries < 14; tries++) {
    const cand: Vine = { f: prev.f + gap, y: Math.max(8.5, Math.min(12, prev.y + dy)), len, sway, speed: 1.4 + rng() * 0.8, phase: rng() * Math.PI * 2, window: [0, 0] };
    const w = releaseWindow(prev, cand, catchR);
    if (w[1] - w[0] >= minWindow) {
      prev.window = w;
      return cand;
    }
    gap -= 0.35;
  }
  // Fallback: a short, easy hop.
  const easy: Vine = { f: prev.f + 4.2, y: prev.y, len: 3.4, sway: 0, speed: 1.6, phase: 0, window: [0, 0] };
  prev.window = releaseWindow(prev, easy, catchR);
  return easy;
}
