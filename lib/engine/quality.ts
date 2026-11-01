/**
 * Device quality tiers.
 *
 * Detection runs ONCE per page load (cached), using a throwaway WebGL context that is
 * released immediately. Games never probe the GPU themselves.
 *
 * Override from the console for testing:  localStorage.setItem('ra.quality', 'high')
 */

export type QualityTier = 'low' | 'medium' | 'high';

export interface QualityProfile {
  tier: QualityTier;
  /** Upper bound for renderer pixel ratio (adaptive resolution never exceeds this). */
  maxPixelRatio: number;
  /** Lower bound adaptive resolution may drop to under load. */
  minPixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** Neon bloom post-processing. */
  bloom: boolean;
  /** Bloom render target is rendered at this fraction of the canvas size. */
  bloomResolutionScale: number;
  /** Max particles a burst system may keep alive. */
  maxParticles: number;
  /** Instanced background props (buildings, stars…) density multiplier. */
  propDensity: number;
}

const PROFILES: Record<QualityTier, Omit<QualityProfile, 'tier'>> = {
  low: {
    maxPixelRatio: 1,
    minPixelRatio: 0.6,
    antialias: false,
    shadows: false,
    shadowMapSize: 512,
    bloom: false,
    bloomResolutionScale: 0.5,
    maxParticles: 120,
    propDensity: 0.5,
  },
  medium: {
    maxPixelRatio: 1.5,
    minPixelRatio: 0.75,
    antialias: false, // bloom composer path does not use MSAA; FXAA-free keeps mid GPUs fast
    shadows: true,
    shadowMapSize: 1024,
    bloom: true,
    bloomResolutionScale: 0.5,
    maxParticles: 300,
    propDensity: 0.8,
  },
  high: {
    maxPixelRatio: 2,
    minPixelRatio: 1,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    bloom: true,
    bloomResolutionScale: 0.75,
    maxParticles: 600,
    propDensity: 1,
  },
};

let cached: QualityProfile | null = null;
let safeMode = false;

/**
 * Safe mode: after a GPU failure (shader compile error, lost context, missing float render
 * targets…) the next attempt runs with the most compatible settings — low tier, no post
 * chain, no image-based lighting, standard materials. Kept for the rest of the session.
 */
export function enableSafeMode() {
  safeMode = true;
  cached = null;
  try {
    sessionStorage.setItem('ra.safe3d', '1');
  } catch {
    /* ignore */
  }
}

export function isSafeMode() {
  if (safeMode) return true;
  try {
    safeMode = typeof window !== 'undefined' && sessionStorage.getItem('ra.safe3d') === '1';
  } catch {
    /* ignore */
  }
  return safeMode;
}
let webgl2Cache: boolean | null = null;

/** True when the browser can create a WebGL2 context (checked once). */
export function supportsWebGL2(): boolean {
  if (webgl2Cache !== null) return webgl2Cache;
  if (typeof window === 'undefined') return true;
  detectDeviceTier();
  if (webgl2Cache === null) webgl2Cache = probeGpu().webgl2;
  return webgl2Cache;
}

function readOverride(): QualityTier | null {
  try {
    const v = window.localStorage.getItem('ra.quality');
    return v === 'low' || v === 'medium' || v === 'high' ? v : null;
  } catch {
    return null;
  }
}

function probeGpu(): { renderer: string; webgl2: boolean } {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return { renderer: 'none', webgl2: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { renderer, webgl2: true };
  } catch {
    return { renderer: 'none', webgl2: false };
  }
}

let deviceTier: QualityTier | null = null;

/** What this device would get on "auto" (ignores any manual override). Probes the GPU once. */
export function detectDeviceTier(): QualityTier {
  if (deviceTier) return deviceTier;
  if (typeof window === 'undefined') return 'medium';
  const { renderer, webgl2 } = probeGpu();
  webgl2Cache = webgl2;
  const software = /SwiftShader|llvmpipe|softpipe|Software|Basic Render|none/i.test(renderer);
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 4;
  const memory = nav.deviceMemory ?? 4;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const weakGpu = /Mali-4|Mali-T|Adreno \(TM\) [345]\d\d|PowerVR|Intel\(R\) HD Graphics [2-5]/i.test(renderer);
  if (software || !webgl2 || weakGpu || memory <= 2 || cores <= 2) deviceTier = 'low';
  else if (mobile || memory <= 4 || cores <= 4) deviceTier = 'medium';
  else deviceTier = 'high';
  return deviceTier;
}

/** The saved manual choice, or null for automatic. */
export function getQualityOverride(): QualityTier | null {
  if (typeof window === 'undefined') return null;
  return readOverride();
}

export function detectQuality(): QualityProfile {
  if (cached) return cached;
  if (typeof window === 'undefined') return { tier: 'medium', ...PROFILES.medium };
  const tier = isSafeMode() ? 'low' : readOverride() ?? detectDeviceTier();
  cached = { tier, ...PROFILES[tier] };
  return cached;
}

/** Lets a settings screen switch tiers at runtime. Games pick it up on next mount. */
export function setQualityOverride(tier: QualityTier | null) {
  try {
    if (tier) window.localStorage.setItem('ra.quality', tier);
    else window.localStorage.removeItem('ra.quality');
  } catch {
    /* storage unavailable — ignore */
  }
  cached = null;
}
