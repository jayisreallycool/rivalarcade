import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AvatarConfig } from '../avatar-types';
import { COSMETICS_CATALOG, SKIN_TONES } from '../cosmetics-catalog';
import type { GameEngine } from './GameEngine';

/**
 * First-person view model: the player's own arms, dressed in their avatar's skin tone, shirt and
 * accent colour, attached to the camera so they stay in the bottom of the screen like a console FPS.
 *
 * Arms are parented to the camera (the camera is added to the scene for that), use cheap standard
 * materials, never cast shadows and are drawn last so world geometry never pokes through them.
 */
export interface FirstPersonArm {
  /** Shoulder pivot (rotate this to swing the arm). */
  pivot: THREE.Group;
  hand: THREE.Group;
}

export interface FirstPersonRig {
  root: THREE.Group;
  left: FirstPersonArm;
  right: FirstPersonArm;
  /** Rest pose of each shoulder (camera space) — animations offset from these. */
  rest: { left: THREE.Vector3; right: THREE.Vector3 };
  /** Running arm pump. `k` 0…1 blends it in. */
  run: (t: number, cadence: number, k?: number) => void;
  /** Hands raised in front, slight breathing sway (holding / aiming pose). */
  ready: (t: number) => void;
  /** Reset every arm transform to rest. */
  reset: () => void;
  /** Accent glow on the sleeve cuffs (combos, streaks). */
  setGlow: (v: number) => void;
}

export function createFirstPersonRig(engine: GameEngine, avatar: AvatarConfig, opts: { spread?: number; drop?: number; depth?: number } = {}): FirstPersonRig {
  const { scene, camera } = engine;
  if (!camera.parent) scene.add(camera);

  const skin = SKIN_TONES.find((s) => s.id === avatar.skinToneId) ?? SKIN_TONES[0];
  const shirt = COSMETICS_CATALOG.find((c) => c.id === avatar.shirtId);
  const skinMat = engine.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(skin.color).multiplyScalar(0.85), roughness: 0.6, metalness: 0, envMapIntensity: 0.5 }));
  // Slightly darkened: arms sit right in front of the lens and would otherwise bloom out.
  const sleeveMat = engine.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(shirt?.color ?? '#1e293b').multiplyScalar(0.7), roughness: 0.9, metalness: 0, envMapIntensity: 0.4 }));
  const accent = new THREE.Color(shirt?.accentColor ?? '#00f0ff');
  const cuffMat = engine.own(new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.25, roughness: 0.35, metalness: 0.2 }));

  const sleeveGeo = engine.own(new THREE.CapsuleGeometry(0.055, 0.32, 6, 14));
  const cuffGeo = engine.own(new THREE.CylinderGeometry(0.062, 0.062, 0.045, 18));
  // Each hand (palm + four fingers + thumb) is merged into one mesh: one draw call per hand.
  const handGeo = (side: -1 | 1) => {
    const parts: THREE.BufferGeometry[] = [];
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    const palm = new RoundedBoxGeometry(0.1, 0.045, 0.11, 3, 0.02);
    palm.applyMatrix4(m.makeTranslation(0, 0, -0.03));
    parts.push(palm);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.CapsuleGeometry(0.0125, 0.055, 3, 8);
      f.applyMatrix4(m.makeRotationFromEuler(e.set(-Math.PI / 2 + 0.35, 0, 0)));
      f.applyMatrix4(m.makeTranslation((i - 1.5) * 0.024, 0.006, -0.105));
      parts.push(f);
    }
    const thumb = new THREE.CapsuleGeometry(0.014, 0.045, 3, 8);
    thumb.applyMatrix4(m.makeRotationFromEuler(e.set(-Math.PI / 2, 0, side * -0.9)));
    thumb.applyMatrix4(m.makeTranslation(side * -0.055, 0.01, -0.05));
    parts.push(thumb);
    // Strip to shared attributes so the merge never fails on mismatched layouts.
    parts.forEach((g) => {
      Object.keys(g.attributes).forEach((k) => k !== 'position' && k !== 'normal' && k !== 'uv' && g.deleteAttribute(k));
    });
    const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
    parts.forEach((g) => g.dispose());
    return engine.own(merged ?? new THREE.SphereGeometry(0.06));
  };
  const handGeos = { [-1]: handGeo(-1), [1]: handGeo(1) } as Record<number, THREE.BufferGeometry>;

  const root = new THREE.Group();
  root.name = 'fp-arms';
  camera.add(root);

  const spread = opts.spread ?? 0.22;
  const drop = opts.drop ?? 0.24;
  const depth = opts.depth ?? 0.42;
  const rest = { left: new THREE.Vector3(-spread, -drop, -depth + 0.18), right: new THREE.Vector3(spread, -drop, -depth + 0.18) };

  const makeArm = (side: -1 | 1): FirstPersonArm => {
    const pivot = new THREE.Group();
    pivot.position.copy(side < 0 ? rest.left : rest.right);
    // Forearm points forward (-Z) and slightly inward/up.
    const fore = new THREE.Group();
    fore.rotation.set(-Math.PI / 2 + 0.25, 0, side * 0.22);
    pivot.add(fore);
    const sleeve = new THREE.Mesh(sleeveGeo, sleeveMat);
    sleeve.position.y = 0.16;
    const cuff = new THREE.Mesh(cuffGeo, cuffMat);
    cuff.position.y = 0.36;
    fore.add(sleeve, cuff);
    const hand = new THREE.Group();
    hand.position.y = 0.42;
    hand.rotation.x = Math.PI / 2 - 0.2;
    hand.add(new THREE.Mesh(handGeos[side], skinMat));
    fore.add(hand);
    return { pivot, hand };
  };

  const left = makeArm(-1);
  const right = makeArm(1);
  root.add(left.pivot, right.pivot);

  // Always on top of the world: drawn last, never depth-tested against far geometry.
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.renderOrder = 10;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
    }
  });
  [skinMat, sleeveMat, cuffMat].forEach((m) => {
    m.depthTest = false;
    m.fog = false;
  });

  const reset = () => {
    left.pivot.position.copy(rest.left);
    right.pivot.position.copy(rest.right);
    left.pivot.rotation.set(0, 0, 0);
    right.pivot.rotation.set(0, 0, 0);
  };

  return {
    root,
    left,
    right,
    rest,
    reset,
    run(t, cadence, k = 1) {
      const a = Math.sin(t * cadence);
      left.pivot.position.set(rest.left.x, rest.left.y - 0.06 + a * 0.05 * k, rest.left.z + a * 0.07 * k);
      right.pivot.position.set(rest.right.x, rest.right.y - 0.06 - a * 0.05 * k, rest.right.z - a * 0.07 * k);
      left.pivot.rotation.set(a * 0.35 * k, 0, 0.15);
      right.pivot.rotation.set(-a * 0.35 * k, 0, -0.15);
    },
    ready(t) {
      const s = Math.sin(t * 1.6) * 0.006;
      left.pivot.position.set(rest.left.x, rest.left.y + s, rest.left.z);
      right.pivot.position.set(rest.right.x, rest.right.y + s, rest.right.z);
      left.pivot.rotation.set(0, 0, 0);
      right.pivot.rotation.set(0, 0, 0);
    },
    setGlow(v) {
      cuffMat.emissiveIntensity = 0.25 + v;
    },
  };
}

/** Additive camera wobble: head bob while moving, decaying shake on impacts. */
export class CameraFeel {
  shake = 0;
  private readonly offset = new THREE.Vector3();
  kick(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }
  /** Returns a camera-space offset for this frame. */
  update(dt: number, t: number, bob: number) {
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const s = this.shake * this.shake * 0.35;
    this.offset.set(Math.sin(t * 9) * bob * 0.5 + (Math.random() - 0.5) * s, Math.abs(Math.sin(t * 9)) * bob + (Math.random() - 0.5) * s, 0);
    return this.offset;
  }
}
