/**
 * Canopy Swing — swing physics in the vertical plane of travel (`f` = metres forward, `y` = up).
 * Pure and deterministic, so the course generator can prove every section is reachable and tests
 * can check the physics.
 *
 * Controls (one touch): HOLD to grab the nearest swing point in reach and stay on it, RELEASE to
 * let go — you keep your exact velocity. Holding in the air grabs the next point as soon as it's
 * in reach (and in line of sight: you can't grab through a bramble).
 *
 * Physics: a rigid-length rope constraint (slack when you're closer than its length), real
 * gravity, a little air drag, and a pendulum you build up by "pumping" at the bottom of each arc,
 * plus a gentle winch that shortens a long grab (shorter rope → faster swing, angular momentum
 * is kept). Release on the up-swing for the longest flights. Points are never teleported to.
 */

export const G = 13;
export const WATER_Y = 0;
export const MAX_SPEED = 18;
/** Air drag per second (fraction of speed). */
export const DRAG = 0.04;
/** The winch pulls a long rope in to this length. */
export const ROPE = 2.8;
export const REEL_SPEED = 1.4;
export const MIN_ROPE = 1.4;
/** Pumping: tangential push near the bottom of the arc (m/s²), up to this swing size (rad). */
export const PUMP = 11;
export const PUMP_MAX_AMP = 1.45;
/** A bounce pad sends you back up at this speed. */
export const PAD_BOUNCE = 13;
/** Game clock speed-up (a fast-paced game; geometry and reachability are unchanged by it). */
export const PACE = 1.3;
/** The fire wall shows up this far behind the pod you're on and reaches it in FIRE_APPROACH s. */
export const FIRE_START = 5.5;
export const FIRE_APPROACH = 1.5;

export interface Stage {
  name: 'SLOW' | 'MIDDLE' | 'FINAL' | 'CRAZY';
  from: number;
  /** You can grab a point within this distance. */
  reach: number;
  speed: number;
  gap: [number, number];
  dy: number;
  bob: number;
  /** Chance of a bramble obstacle in a gap, and of a bounce pad on the water. */
  bramble: number;
  pad: number;
  /** Real seconds on one pod (since your last catch) before the fire wall comes for you. */
  fire: number;
  color: string;
}

export const STAGES: Stage[] = [
  { name: 'SLOW', from: 0, reach: 3.8, speed: 1, gap: [2.7, 3.4], dy: 0.8, bob: 0, bramble: 0, pad: 0.12, fire: 3.0, color: '#4ade80' },
  { name: 'MIDDLE', from: 20, reach: 3.6, speed: 1.05, gap: [3.0, 3.9], dy: 1.2, bob: 0.25, bramble: 0.2, pad: 0.09, fire: 2.7, color: '#facc15' },
  { name: 'FINAL', from: 50, reach: 3.4, speed: 1.1, gap: [3.4, 4.4], dy: 1.6, bob: 0.5, bramble: 0.32, pad: 0.06, fire: 2.4, color: '#fb923c' },
  { name: 'CRAZY', from: 90, reach: 3.2, speed: 1.16, gap: [3.8, 5.0], dy: 2.0, bob: 0.8, bramble: 0.45, pad: 0.04, fire: 2.1, color: '#f43f5e' },
];

/**
 * The fire wall: dawdle on a pod (or between catches) longer than the stage allows and a wall of
 * fire sweeps in from the left. Catch a new pod before it reaches you and it dies back.
 */
export interface Fire {
  /** Real seconds since your last catch. */
  heat: number;
  /** Front of the wall (`f`), or null when there's no fire. */
  front: number | null;
}
export const newFire = (): Fire => ({ heat: 0, front: null });
/** Advance the fire by `realDt` seconds; returns true if it reached you. */
export function fireStep(fire: Fire, realDt: number, s: Stage, podF: number, bodyF: number) {
  fire.heat += realDt;
  if (fire.front === null && fire.heat > s.fire) fire.front = podF - FIRE_START;
  if (fire.front === null) return false;
  fire.front += (FIRE_START / FIRE_APPROACH) * realDt;
  return fire.front >= bodyF - 0.3;
}
/** You caught a new pod: the fire dies back. Returns true if you escaped a live wall. */
export function fireEscape(fire: Fire) {
  const was = fire.front !== null;
  fire.heat = 0;
  fire.front = null;
  return was;
}

export function stageAt(i: number): Stage {
  let s = STAGES[0];
  for (const st of STAGES) if (i >= st.from) s = st;
  if (s.name !== 'CRAZY') return s;
  const k = Math.min(1, (i - s.from) / 80);
  return { ...s, reach: s.reach - 0.3 * k, speed: s.speed + 0.1 * k, gap: [s.gap[0] + 0.4 * k, s.gap[1] + 0.7 * k], bob: s.bob + 0.3 * k };
}

export interface Bramble {
  f: number;
  y: number;
  r: number;
}
export interface Anchor {
  f: number;
  y0: number;
  bob: number;
  bobSpeed: number;
  phase: number;
  /** Optional bramble floating in the gap after this point. */
  bramble?: Bramble | null;
  /** Optional bounce pad on the water in the gap after this point (centre f, half-width). */
  pad?: { f: number; w: number } | null;
  /** Collectible berries along a proven flight line into the next point. */
  berries?: { f: number; y: number }[];
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
  t: number;
}

export const ropeAngle = (b: Body, A: { f: number; y: number }) => Math.atan2(b.f - A.f, A.y - b.y);

/**
 * One physics step: gravity and drag; with a rope, the length constraint (outward speed removed,
 * swing speed kept), the winch (angular momentum kept, so it speeds you up) and the pump.
 */
export function step(b: Body, rope: Rope | null, A: { f: number; y: number } | null, dt: number) {
  b.vy -= G * dt;
  const drag = 1 - DRAG * dt;
  b.vf *= drag;
  b.vy *= drag;
  b.f += b.vf * dt;
  b.y += b.vy * dt;
  if (!rope || !A) return capSpeed(b);
  rope.t += dt;
  const Lold = rope.L;
  if (rope.L > ROPE) rope.L = Math.max(ROPE, rope.L - REEL_SPEED * dt);
  else if (rope.L < ROPE) rope.L = Math.min(ROPE, rope.L + REEL_SPEED * dt); // short grab: let rope out
  let df = b.f - A.f;
  let dy = b.y - A.y;
  const d = Math.hypot(df, dy) || 1e-6;
  if (d <= rope.L) return capSpeed(b); // slack rope: free flight inside the circle
  df /= d;
  dy /= d;
  b.f = A.f + df * rope.L;
  b.y = A.y + dy * rope.L;
  const radial = b.vf * df + b.vy * dy;
  if (radial > 0) {
    b.vf -= radial * df;
    b.vy -= radial * dy;
  }
  const tf = -dy; // tangent (forward when the rope angle increases)
  const ty = df;
  let s = b.vf * tf + b.vy * ty;
  if (Lold > rope.L) s *= Lold / rope.L; // winch: angular momentum is conserved
  // pump near the bottom of the arc, in the direction you're moving, until the swing is big
  const theta = Math.atan2(df, -dy);
  const energyAmp = Math.acos(Math.max(-1, Math.min(1, Math.cos(theta) - (s * s) / (2 * G * rope.L))));
  if (Math.abs(theta) < 0.6 && energyAmp < PUMP_MAX_AMP) s += Math.sign(s || 1) * PUMP * dt * Math.cos(theta);
  b.vf = s * tf;
  b.vy = s * ty;
  return capSpeed(b);
}

function capSpeed(b: Body) {
  const sp = Math.hypot(b.vf, b.vy);
  if (sp > MAX_SPEED) {
    b.vf *= MAX_SPEED / sp;
    b.vy *= MAX_SPEED / sp;
  }
}

/** Does the segment p→q pass through the bramble? */
export function blocked(p: { f: number; y: number }, q: { f: number; y: number }, br: Bramble | null | undefined) {
  if (!br) return false;
  const vx = q.f - p.f;
  const vy = q.y - p.y;
  const len2 = vx * vx + vy * vy || 1e-9;
  const u = Math.max(0, Math.min(1, ((br.f - p.f) * vx + (br.y - p.y) * vy) / len2));
  return Math.hypot(p.f + vx * u - br.f, p.y + vy * u - br.y) < br.r;
}

/**
 * The point you'd grab now: the nearest one (not behind you) within reach whose rope line isn't
 * blocked by a bramble. -1 if none.
 */
export function grabbable(b: Body, anchors: Anchor[], from: number, t: number, reach: number) {
  let best = -1;
  let bestD = Infinity;
  for (let i = Math.max(0, from - 1); i < Math.min(anchors.length, from + 5); i++) {
    const A = anchorPos(anchors[i], t);
    if (A.f < b.f - 1.2) continue;
    const d = Math.hypot(A.f - b.f, A.y - b.y);
    if (d > reach || d >= bestD || A.y < b.y + 0.3) continue;
    const brs = [anchors[i - 1]?.bramble, anchors[i]?.bramble];
    if (brs.some((br) => blocked(b, A, br))) continue;
    best = i;
    bestD = d;
  }
  return best;
}

/** Share of the speed heading into/away from the grab point that the catch swings round into the arc. */
export const GRAB_KEEP = 0.85;
/**
 * Catch a point. The hook bites and your speed is swung round along the arc (most of it kept),
 * so a well-timed catch carries straight on into the next swing instead of stalling you.
 */
export function grab(b: Body, i: number, A: { f: number; y: number }): Rope {
  const d = Math.hypot(b.f - A.f, b.y - A.y);
  if (d > 1e-6) {
    const tf = -(b.y - A.y) / d; // unit tangent (points forward when you're under the point)
    const ty = (b.f - A.f) / d;
    const speed = Math.hypot(b.vf, b.vy);
    const vt = b.vf * tf + b.vy * ty;
    const vr2 = Math.max(0, speed * speed - vt * vt);
    const mag = Math.sqrt(vt * vt + GRAB_KEEP * GRAB_KEEP * vr2);
    const dir = Math.abs(vt) > 0.3 * speed ? Math.sign(vt) : Math.sign(b.vf * tf || 1) || 1;
    b.vf = tf * mag * dir;
    b.vy = ty * mag * dir;
  }
  return { anchor: i, L: Math.max(MIN_ROPE, d), t: 0 };
}

/** Bounce off a pad on the water (returns true if you hit one). */
export function padBounce(b: Body, anchors: Anchor[], from: number) {
  if (b.vy >= 0 || b.y > WATER_Y + 0.55) return false;
  for (let i = Math.max(0, from - 2); i < Math.min(anchors.length, from + 3); i++) {
    const p = anchors[i].pad;
    if (p && Math.abs(b.f - p.f) <= p.w) {
      b.y = WATER_Y + 0.55;
      b.vy = PAD_BOUNCE;
      b.vf = Math.max(b.vf, 3.5);
      return true;
    }
  }
  return false;
}

export const hitsBramble = (b: Body, br: Bramble | null | undefined) => !!br && Math.hypot(b.f - br.f, b.y - br.y) < br.r + 0.25;

/**
 * Let go now from `b`: does the flight pass within reach of point `B` (with margin, in line of
 * sight, above the river, without touching `avoid`)? Returns the flight path up to that moment.
 */
export function releaseWorks(b: Body, B: Anchor, reach: number, t0 = 0, avoid?: Bramble | null) {
  const body = { ...b };
  const dtS = 1 / 120;
  const path: { f: number; y: number }[] = [];
  for (let k = 0; k < 360; k++) {
    if (hitsBramble(body, avoid)) return null;
    const P = anchorPos(B, t0 + k * dtS);
    const d = Math.hypot(P.f - body.f, P.y - body.y);
    if (d <= reach * 0.85 && P.y > body.y + 0.3 && !blocked(body, P, avoid) && P.y - Math.max(d, ROPE) > WATER_Y + 1.5) return path;
    if (k % 3 === 0) path.push({ f: body.f, y: body.y });
    step(body, null, null, dtS);
    if (body.y < WATER_Y + 1) return null;
  }
  return null;
}

/** Steady-swing state on point `A` at swing size `amp`, rope angle `rel`, moving forward. */
export function swingState(A: { f: number; y: number }, amp: number, rel: number, L = ROPE): Body {
  const w = Math.sqrt(Math.max(0, 2 * G * L * (Math.cos(rel) - Math.cos(amp))));
  return { f: A.f + L * Math.sin(rel), y: A.y - L * Math.cos(rel), vf: w * Math.cos(rel), vy: w * Math.sin(rel) };
}

/** Can a typical pumped swing from `a` reach `b`? Returns a working flight path, or null. */
export function reachable(a: Anchor, b: Anchor, s: Stage, avoid?: Bramble | null, amp = PUMP_MAX_AMP - 0.12) {
  const A = anchorPos(a, 0);
  for (let rel = 0; rel <= amp - 0.04; rel += 0.04) {
    const path = releaseWorks(swingState(A, amp, rel), b, s.reach, 0, avoid);
    if (path) return path;
  }
  return null;
}

/**
 * Next point after `prev` (index `i`), seeded. Gaps a typical swing can't make are pulled in; a
 * bramble, if any, is placed in the gap only where a proven flight still gets past it; berries
 * sit on that proven line; bounce pads float on the water.
 */
export function nextAnchor(prev: Anchor, i: number, rng: () => number): Anchor {
  const s = stageAt(i);
  let gap = s.gap[0] + rng() * (s.gap[1] - s.gap[0]);
  const y0 = Math.max(9, Math.min(13, prev.y0 + (rng() - 0.5) * 2 * s.dy));
  const bob = s.bob > 0 && rng() < 0.4 + 0.5 * (s.bob / 1.5) ? s.bob * (0.5 + rng() * 0.5) : 0;
  const bobSpeed = 1.1 + rng() * 0.9 + (s.name === 'CRAZY' ? 0.5 : 0);
  const phase = rng() * Math.PI * 2;
  const wantBramble = i > 20 && rng() < s.bramble;
  const brU = 0.35 + rng() * 0.3;
  const brY = (rng() - 0.5) * 3;
  const brR = 0.45 + rng() * 0.3;
  const wantPad = rng() < s.pad;
  const berryCount = rng() < 0.6 ? 1 + Math.floor(rng() * 3) : 0;
  for (let tries = 0; tries < 18; tries++) {
    const cand: Anchor = { f: prev.f + gap, y0, bob, bobSpeed, phase };
    // reachable from either end of this point's bob to either end of the next one's, from a swing
    // still building up AND from the full steady swing (a bobbing pivot can lock to the swing's rhythm)
    const ends = (a: Anchor) => (a.bob > 0 ? [-a.bob, a.bob] : [0]).map((d) => ({ ...a, bob: 0, y0: a.y0 + d }));
    const froms = ends(prev);
    const tos = ends(cand);
    let br: Bramble | null = wantBramble ? { f: prev.f + gap * brU, y: (prev.y0 + y0) / 2 - 2.2 + brY, r: brR } : null;
    if (br) {
      // never inside any rope arc: below the longest rope (its reach) on both points, so a bramble
      // only threatens you when you sag low; too low over the river → no bramble
      const below = (f: number, yLow: number, D: number) => {
        const df = Math.abs(br!.f - f);
        return df >= D ? Infinity : yLow - Math.sqrt(D * D - df * df);
      };
      br.y = Math.min(br.y, below(prev.f, prev.y0 - prev.bob, Math.max(ROPE, stageAt(i - 1).reach) + br.r + 0.5), below(cand.f, y0 - bob, Math.max(ROPE, s.reach) + br.r + 0.5));
      if (br.y < WATER_Y + 2.4) br = null;
    }
    const ok = (avoid: Bramble | null) => {
      let first: { f: number; y: number }[] | null = null;
      for (const fa of froms)
        for (const to of tos) {
          const p = reachable(fa, to, s, avoid);
          if (!p || !reachable(fa, to, s, avoid, PUMP_MAX_AMP - 0.02)) return null;
          first = first ?? p;
        }
      return first;
    };
    let path = ok(br);
    let bramble = br;
    if (!path && br) {
      bramble = null; // can't fit the bramble here: drop it rather than shrink the gap
      path = ok(null);
    }
    if (path) {
      prev.bramble = bramble;
      prev.pad = wantPad ? { f: prev.f + gap * (0.45 + rng() * 0.2), w: 0.9 } : null;
      prev.berries = path.length > 5 ? Array.from({ length: berryCount }, (_, k) => path[Math.min(path.length - 1, Math.floor(path.length * (0.35 + k * 0.2)))]) : [];
      return cand;
    }
    gap -= 0.3;
  }
  prev.bramble = null;
  prev.pad = null;
  prev.berries = [];
  return { f: prev.f + 3, y0: prev.y0, bob: 0, bobSpeed: 1, phase: 0 };
}

export const FIRST_ANCHOR: Anchor = { f: 0, y0: 10.5, bob: 0, bobSpeed: 1, phase: 0 };
