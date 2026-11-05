/**
 * One scoring language for every game, so players always know what a point is worth.
 *
 *  - Every normal action is worth 1 point (a basket, a node, a gem, a brick, a vine, a crystal).
 *  - Special moments are worth more, and say so on screen:
 *      bonus   +1 extra  (swish, perfect timing, perfect catch, bank shot)
 *      gold    3 points  (gold ball / node / crystal / banana)
 *      jackpot 5 points  (rare jackpot pickups, board clears)
 *  - ON FIRE: 5 in a row doubles points until the streak breaks.
 *  - CLUTCH: the last 10 seconds of a timed round double points.
 *  Both can stack (×4) — that's where big comebacks come from.
 */

export const ROUND_SECONDS = 60;
export const CLUTCH_SECONDS = 10;
export const FIRE_STREAK = 5;

export const PTS = { base: 1, bonus: 1, gold: 3, jackpot: 5 } as const;

export interface AwardContext {
  /** Current streak *including* this action. */
  streak?: number;
  /** Seconds left in a timed round (omit for endless games). */
  timeLeft?: number;
}

export const onFire = (streak = 0) => streak >= FIRE_STREAK;
export const isClutch = (timeLeft?: number) => timeLeft !== undefined && timeLeft <= CLUTCH_SECONDS && timeLeft > 0;

/** Multiplier for this moment (1, 2 or 4). */
export function multiplier(ctx: AwardContext = {}) {
  return (onFire(ctx.streak) ? 2 : 1) * (isClutch(ctx.timeLeft) ? 2 : 1);
}

/**
 * Score one action. Returns the total and the parts (for the results breakdown):
 * base + extra (special value above 1) + the multiplier's share.
 */
export function award(value: number, ctx: AwardContext = {}) {
  const m = multiplier(ctx);
  const fire = onFire(ctx.streak) ? value : 0;
  const clutch = isClutch(ctx.timeLeft) ? value * (onFire(ctx.streak) ? 2 : 1) : 0;
  return { total: value * m, base: Math.min(1, value), extra: Math.max(0, value - 1), fire, clutch, mult: m };
}

/** Popup styling by value, shared across games. */
export function popStyle(total: number, special?: 'gold' | 'jackpot' | 'bonus') {
  if (special === 'jackpot' || total >= 8) return { color: '#f472b6', size: 'lg' as const };
  if (special === 'gold' || total >= 4) return { color: '#fbbf24', size: 'lg' as const };
  if (special === 'bonus' || total >= 2) return { color: '#fde047', size: 'md' as const };
  return { color: '#ffffff', size: 'md' as const };
}

/** Running breakdown tracker for the results screen. */
export class ScoreBook {
  score = 0;
  private parts = new Map<string, number>();
  add(label: string, points: number) {
    if (!points) return;
    this.parts.set(label, (this.parts.get(label) ?? 0) + points);
  }
  /**
   * Record an award. `parts` names where the pre-multiplier value came from and must sum to
   * the value passed to award(), e.g. { Baskets: 1, 'Gold ball': 2 }. Multipliers are added on top.
   */
  record(a: ReturnType<typeof award>, parts: Record<string, number>) {
    this.score += a.total;
    for (const [label, pts] of Object.entries(parts)) this.add(label, pts);
    this.add('On fire ×2', a.fire);
    this.add('Clutch ×2', a.clutch);
  }
  penalty(label: string, points: number) {
    const p = Math.min(this.score, points);
    this.score -= p;
    this.add(label, -p);
    return p;
  }
  breakdown() {
    return [...this.parts.entries()].map(([label, points]) => ({ label, points })).filter((b) => b.points !== 0);
  }
}
