export { GameEngine, disposeObjectTree } from './GameEngine';
export type { EngineOptions, EngineStats, Updater } from './GameEngine';
export { detectQuality, setQualityOverride, supportsWebGL2 } from './quality';
export type { QualityProfile, QualityTier } from './quality';
export { Pool } from './pool';
export { ParticleBursts } from './effects';
export type { BurstOptions } from './effects';
export { createNeonGridFloor, createCityscape, createStarfield, createBlobShadow, neonMaterial, addArenaLights } from './environment';
export { useGameEngine, useLatest, useStructuralMemo, useThrottledHud } from './react';
