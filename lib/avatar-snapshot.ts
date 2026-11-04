import * as THREE from 'three';
import type { AvatarConfig } from './avatar-types';
import { buildStage, stageAction, stageAvatar, type AvatarStage } from './avatar-stage';
import { detectQuality, supportsWebGL2 } from './engine/quality';

/**
 * Still 3D renders of avatars for lists (leaderboards, cups, match cards, the header) — many small
 * avatars on screen at once. One shared WebGL context renders them one by one into cached image
 * URLs, then is released after a few idle seconds so it never competes with a running game.
 */

type Job = { key: string; avatar: AvatarConfig; px: number; action?: string; resolve: (url: string | null) => void };

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
const queue: Job[] = [];
const MAX_CACHE = 80;
let renderer: THREE.WebGLRenderer | null = null;
let stage: AvatarStage | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
let broken = false;
let running = false;

export function snapshotsAvailable() {
  return !broken && typeof window !== 'undefined' && supportsWebGL2();
}

function ensureRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  const q = detectQuality();
  stage = buildStage(renderer, { shadows: false, env: q.tier !== 'low' });
  renderer.domElement.addEventListener('webglcontextlost', () => {
    broken = true;
    release();
  });
  return renderer;
}

function release() {
  stage?.dispose();
  stage = null;
  if (renderer) {
    renderer.dispose();
    renderer.forceContextLoss();
  }
  renderer = null;
}

function render(job: Job): string | null {
  const r = ensureRenderer();
  if (!stage) return null;
  r.setSize(job.px, job.px, false);
  const av = stageAvatar(job.avatar, detectQuality().tier === 'low');
  av.updateAnimation(1.1, stageAction(job.avatar, job.action));
  av.group.rotation.y = 0.32;
  stage.scene.add(av.group);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.05, 30);
  // Small chips show head and shoulders; larger cards show the whole avatar.
  const bust = job.px <= 140;
  const [ty, fit] = bust ? [1.5, 1.15] : [1.0, 2.35];
  const dist = fit / 2 / Math.tan(THREE.MathUtils.degToRad(14));
  cam.position.set(0.12 * dist, ty + 0.06 * dist, dist);
  cam.lookAt(0, ty, 0);
  r.render(stage.scene, cam);
  stage.scene.remove(av.group);
  av.dispose();
  return r.domElement.toDataURL('image/webp', 0.9);
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      let url: string | null = null;
      try {
        if (!broken) url = render(job);
      } catch {
        broken = true;
        release();
      }
      if (url) {
        cache.set(job.key, url);
        if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
      }
      pending.delete(job.key);
      job.resolve(url);
      // Yield so long lists never block a frame.
      await new Promise((res) => setTimeout(res, 0));
    }
  } finally {
    running = false;
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(release, 4000);
  }
}

export function snapshotKey(avatar: AvatarConfig, px: number, action?: string) {
  return `${px}|${action ?? 'idle'}|${JSON.stringify(avatar)}`;
}

export function cachedSnapshot(avatar: AvatarConfig, px: number, action?: string) {
  return cache.get(snapshotKey(avatar, px, action)) ?? null;
}

/** A 3D still of `avatar` at `px` square pixels (null if 3D isn't available here). */
export function snapshotAvatar(avatar: AvatarConfig, px: number, action?: string): Promise<string | null> {
  if (!snapshotsAvailable()) return Promise.resolve(null);
  const key = snapshotKey(avatar, px, action);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const p = pending.get(key);
  if (p) return p;
  const prom = new Promise<string | null>((resolve) => queue.push({ key, avatar, px, action, resolve }));
  pending.set(key, prom);
  if (releaseTimer) clearTimeout(releaseTimer);
  void pump();
  return prom;
}
