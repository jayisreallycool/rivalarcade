import type { AvatarConfig, CosmeticCategory } from './avatar-types';
import { COSMETICS_CATALOG, HAIR_COLORS, SKIN_TONES } from './cosmetics-catalog';
import type { GameId } from './game-types';
import { SCORE_BASELINE } from './game-types';
import { mulberry32, pick, Rng } from './rng';

const NAMES = [
  'ViperX', 'NeonPulse', 'ChromaKing', 'EchoRunner', 'SkyWalker', 'PrismQueen', 'GhostJumper', 'CyberVolt',
  'ShiftSpeed', 'NovaStreak', 'HoopGod_99', 'RimRocker', 'NetBurner', 'Synapse_X', 'PulseKeeper', 'GemDuchess',
  'CascadePro', 'PhantomZero', 'OrbitSurge', 'SubZero_Kid', 'PulseDrift', 'ByteBlitz', 'LunaLag', 'QuantumQ',
  'RetroRex', 'StaticSam', 'TurboTess', 'VoltVixen', 'ZeroPing', 'GlitchGod', 'ArcLight', 'NitroNia',
  'PixelPaladin', 'HyperHolt', 'FluxFury', 'KiloKai', 'MegaMira', 'DriftDex', 'SonicSol', 'ApexAce',
];

export function botName(rng: Rng, taken?: Set<string>): string {
  for (let i = 0; i < 20; i++) {
    const n = pick(rng, NAMES);
    if (!taken?.has(n)) {
      taken?.add(n);
      return n;
    }
  }
  return `${pick(rng, NAMES)}${Math.floor(rng() * 90 + 10)}`;
}

const byCategory = (cat: CosmeticCategory) => COSMETICS_CATALOG.filter((c) => c.category === cat).map((c) => c.id);

/** A fully dressed, varied avatar derived from a seed (cheap to regenerate; not persisted). */
export function botAvatar(seed: number): AvatarConfig {
  const rng = mulberry32(seed);
  const gender = pick(rng, ['male', 'female', 'neutral'] as const);
  const maybe = (cat: CosmeticCategory, chance: number) => {
    const opts = byCategory(cat).filter((id) => id !== 'none');
    return rng() < chance && opts.length ? pick(rng, opts) : 'none';
  };
  return {
    gender,
    skinToneId: pick(rng, SKIN_TONES).id,
    hairStyleId: pick(rng, byCategory('hair')),
    hairColorId: pick(rng, HAIR_COLORS).id,
    eyeColor: pick(rng, ['#00f0ff', '#ffb800', '#ff0055', '#10b981', '#a855f7', '#ffffff']),
    expression: pick(rng, ['focused', 'fierce', 'confident', 'chill'] as const),
    shirtId: pick(rng, byCategory('shirt')),
    pantsId: pick(rng, byCategory('pants')),
    shoesId: pick(rng, byCategory('shoes')),
    headwearId: maybe('headwear', 0.4),
    eyewearId: maybe('eyewear', 0.3),
    backId: maybe('back', 0.25),
    trailId: maybe('trail', 0.25),
    pose: 'ready',
    bannerId: 'banner_rookie',
  };
}

/**
 * The score a bot "plays" for, scaled to the player's own recent form so matches stay
 * competitive at every skill level. `spread` is the ± fraction around that reference.
 */
export function referenceScore(gameId: GameId, recent: number[] | undefined): number {
  const runs = (recent ?? []).filter((n) => n > 0);
  if (runs.length < 2) return SCORE_BASELINE[gameId];
  const sorted = [...runs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  // Lean slightly toward the baseline for small samples so one fluke run doesn't dominate.
  const w = Math.min(1, runs.length / 5);
  return Math.round(median * w + SCORE_BASELINE[gameId] * (1 - w));
}

export function botScore(rng: Rng, reference: number, min: number, max: number): number {
  // Average of two uniforms → gentle bell curve between min and max multipliers.
  const f = min + ((rng() + rng()) / 2) * (max - min);
  return Math.max(1, Math.round(reference * f));
}
