/**
 * Deterministic random numbers.
 *
 * Duels and tournaments hand every player the same seed, so obstacle patterns, gem boards
 * and target spawns are identical for everyone — the "certified fair seed" the UI promises.
 * Visual-only randomness (particles, skyline) may keep using Math.random.
 */

export type Rng = () => number;

/** mulberry32: tiny, fast, good-enough 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash → 32-bit seed. */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}

export const pick = <T,>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];
export const range = (rng: Rng, min: number, max: number) => min + rng() * (max - min);

/** Short human-readable seed code shown in match UI, e.g. "7F3A-91C2". */
export function seedCode(seed: number): string {
  const hex = (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}
