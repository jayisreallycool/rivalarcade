'use client';

import React, { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
import { CameraFeel, ParticleBursts, useGameEngine, useLatest, useStructuralMemo, useThrottledHud } from '@/lib/engine';
import { create3DAvatar } from '@/lib/avatar-3d-model';
import { GameProps } from '@/lib/game-types';
import { mulberry32, randomSeed } from '@/lib/rng';
import { FIRE_STREAK, PTS, award, popStyle, ScoreBook, onFire } from '@/lib/scoring';
import { AIM_DIR, Anchor, Body, FIRST_ANCHOR, HOOK_SPEED, MIN_ROPE, RELOAD_S, Rope, STAGES, WATER_Y, anchorPos, hookHit, isPerfect, nextAnchor, releaseWorks, stageAt, step } from '@/lib/grapple-physics';
import GameShell, { PopupApi, useSwipe } from './GameShell';
import { Pointer, Crosshair, Timer } from 'lucide-react';

/**
 * CANOPY SWING — side-on hook-gun swinging through a jungle canopy above a river.
 * Tap to let go and fire your hook gun. It always fires at the same angle (up and forward) — no
 * auto-aim — so you have to time the shot for when that line crosses the next hanging vine. Hit
 * the vine and you swing from where the hook bit; miss and it reloads while you fall. Ropes fray,
 * so keep moving. The aim laser fades stage by stage; in CRAZY you aim by feel.
 * Four stages — SLOW → MIDDLE → FINAL → CRAZY — so every run ends; one splash and you're out.
 *
 * Scoring: 1 point for every vine you get past — that's the whole score. Skip a vine by flying past
 * it and it still counts, so the score is simply how far you swing.
 */

const HAND_UP = 1.87;
const VIEW_W = 12.5;
const VIEW_H = 11;
const FOV = 42;
const AHEAD = 6;
const BEHIND = 3;

type Phase = 'ready' | 'playing' | 'over';
type FruitKind = 'banana' | 'idol' | 'sunstone';
interface Fruit {
  kind: FruitKind;
  f: number;
  y: number;
  taken: boolean;
  mesh: THREE.Object3D;
}
interface Hook {
  f: number;
  y: number;
  state: 'out' | 'back';
  t: number;
  /** Next vine the line hasn't passed yet. */
  next: number;
}

function barkTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a3222';
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = i % 3 ? 'rgba(25,14,8,0.55)' : 'rgba(120,90,60,0.35)';
    g.lineWidth = 1 + Math.random() * 3;
    const x = Math.random() * 128;
    g.beginPath();
    g.moveTo(x, 0);
    for (let y = 0; y <= 256; y += 32) g.lineTo(x + Math.sin(y * 0.05 + i) * 6, y);
    g.stroke();
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${60 + Math.random() * 40},${110 + Math.random() * 50},40,0.35)`;
    g.beginPath();
    g.ellipse(Math.random() * 128, Math.random() * 256, 4 + Math.random() * 10, 2 + Math.random() * 6, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function waterTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#0e5a5a');
  grd.addColorStop(1, '#0b4a4f');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 160; i++) {
    g.strokeStyle = `rgba(190,255,240,${0.05 + Math.random() * 0.18})`;
    g.lineWidth = 1 + Math.random() * 2;
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + 10, y - 3, x + 24 + Math.random() * 30, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 30);
  return t;
}

const UP = new THREE.Vector3(0, 1, 0);
/** Stretch a unit-height, centred cylinder between two world points. */
function span(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const d = b.clone().sub(a);
  const len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.scale.set(1, Math.max(0.001, len), 1);
  if (len > 1e-4) mesh.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
}

export default function CanopySwing3DGame({ avatar, onFinish, seed, rival, match, onExit }: GameProps) {
  const stableAvatar = useStructuralMemo(avatar);
  const onFinishRef = useLatest(onFinish);
  const seedRef = useLatest(seed);
  const popups = useRef<PopupApi | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, vines: 0, streak: 0, stage: 0 });
  const api = useRef({ tap: () => {}, start: () => {} });

  const startGame = useCallback(() => {
    api.current.start();
    setPhase('playing');
  }, []);

  const surface = useSwipe({
    onTap: () => api.current.tap(),
    onSwipe: () => api.current.tap(),
  });

  const { hostRef } = useGameEngine(
    {
      background: 0x5f9a7c,
      fog: { color: 0x5f9a7c, density: 0.014 },
      camera: { fov: FOV, near: 0.5, far: 240, position: [30, 8, 0], lookAt: [0, 7, 0] },
      exposure: 1.2,
      bloom: { strength: 0.45, radius: 0.4, threshold: 0.9 },
      environment: 0.45,
      studio: { top: 0x3b6b4a, left: 0xffd27a, right: 0x46b38a },
      grade: { saturation: 1.12, vignette: 0.35 },
    },
    (engine) => {
      const { scene, camera, quality } = engine;
      const feel = new CameraFeel();
      let camDist = 30;
      engine.onResize((_w, _h, aspect) => {
        camera.fov = FOV;
        camera.updateProjectionMatrix();
        const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
        camDist = Math.max(VIEW_H / (2 * tan), VIEW_W / (2 * tan * aspect));
      });

      // ---------------- lights
      const hemi = new THREE.HemisphereLight(0xe6f5d8, 0x1d5a4a, 1.6);
      const sun = new THREE.DirectionalLight(0xffe2a8, 2.6);
      sun.position.set(6, 24, 6);
      engine.configureShadows(sun, 14);
      scene.add(hemi, sun, sun.target);

      // ---------------- shared assets
      const bark = engine.own(barkTexture());
      bark.repeat.set(1, 4);
      const barkMat = engine.own(new THREE.MeshStandardMaterial({ map: bark, roughness: 0.95, metalness: 0 }));
      const leafMats = [0x2f7d3a, 0x3f9a45, 0x25663a, 0x4fae52].map((c) => engine.own(new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0, flatShading: true })));
      const vineMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x5c7a2e, roughness: 0.9, metalness: 0 }));
      const ringMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.3, metalness: 0.9 }));
      const goldRingMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xffc83a, roughness: 0.25, metalness: 1, emissive: 0xffa600, emissiveIntensity: 0.5 }));
      const targetRingMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xd9fbe9, roughness: 0.3, metalness: 0.6, emissive: 0x4ade80, emissiveIntensity: 1.2 }));
      const trunkGeo = engine.own(new THREE.CylinderGeometry(0.32, 0.48, 26, 12, 1));
      const branchGeo = engine.own(new THREE.CylinderGeometry(0.12, 0.2, 1, 8));
      const canopyGeo = engine.own(new THREE.IcosahedronGeometry(1.6, 1));
      const anchorRingGeo = engine.own(new THREE.TorusGeometry(0.2, 0.05, 8, 20));
      const hangVineGeo = engine.own(new THREE.CylinderGeometry(0.025, 0.03, 1, 5));
      hangVineGeo.translate(0, -0.5, 0);
      const unitCyl = engine.own(new THREE.CylinderGeometry(1, 1, 1, 6, 1));

      // River + bank
      const water = engine.own(waterTexture());
      const river = new THREE.Mesh(new THREE.PlaneGeometry(50, 420), new THREE.MeshStandardMaterial({ map: water, roughness: 0.15, metalness: 0.35, color: 0xbfffee }));
      engine.own(river.geometry);
      engine.own(river.material as THREE.Material);
      river.rotation.x = -Math.PI / 2;
      river.position.set(0, WATER_Y, -180);
      river.receiveShadow = quality.shadows;
      scene.add(river);

      // Far jungle wall
      const farCount = Math.round(110 * quality.propDensity);
      const farTrunks = new THREE.InstancedMesh(trunkGeo, barkMat, farCount);
      const farLeaves = new THREE.InstancedMesh(canopyGeo, leafMats[2], farCount);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      const pv = new THREE.Vector3();
      const farRng = mulberry32(7);
      for (let i = 0; i < farCount; i++) {
        const x = -(8 + farRng() * 26);
        const z = -farRng() * 200;
        sc.set(0.8 + farRng() * 0.8, 1, 0.8 + farRng() * 0.8);
        m4.compose(pv.set(x, 11, z), q.identity(), sc);
        farTrunks.setMatrixAt(i, m4);
        sc.setScalar(2.2 + farRng() * 2);
        m4.compose(pv.set(x, 21 + farRng() * 4, z), q.setFromEuler(new THREE.Euler(farRng(), farRng(), 0)), sc);
        farLeaves.setMatrixAt(i, m4);
      }
      const world = new THREE.Group();
      world.add(farTrunks, farLeaves);
      scene.add(world);

      // Sun shafts + fireflies
      const shaftMat = engine.own(new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      const shaftGeo = engine.own(new THREE.PlaneGeometry(2.4, 32));
      const shafts: THREE.Mesh[] = [];
      for (let i = 0; i < 8; i++) {
        const sh = new THREE.Mesh(shaftGeo, shaftMat);
        sh.rotation.set(0, Math.random() * Math.PI, 0.35);
        sh.position.set((Math.random() - 0.5) * 10, 10, -i * 9);
        shafts.push(sh);
        scene.add(sh);
      }
      const flyN = Math.round(140 * quality.propDensity);
      const flyGeo = engine.own(new THREE.BufferGeometry());
      const flyPos = new Float32Array(flyN * 3);
      const flySeed = Array.from({ length: flyN }, () => [Math.random() * 16 - 8, 2 + Math.random() * 15, -Math.random() * 70, Math.random() * 6]);
      flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
      const flies = new THREE.Points(flyGeo, engine.own(new THREE.PointsMaterial({ color: 0xfff2a8, size: 0.08, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })));
      flies.frustumCulled = false;
      scene.add(flies);

      const particles = new ParticleBursts(engine);

      // Fruit
      const bananaGeo = engine.own(new THREE.TorusGeometry(0.18, 0.06, 8, 16, Math.PI * 0.9));
      const bananaMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xffd93b, roughness: 0.45, emissive: 0x8a6a00, emissiveIntensity: 0.35 }));
      const idolGeo = engine.own(new THREE.OctahedronGeometry(0.26, 0));
      const idolMat = engine.own(new THREE.MeshPhysicalMaterial({ color: 0xffc83a, metalness: 1, roughness: 0.18, emissive: 0xffa600, emissiveIntensity: 0.6, clearcoat: 1 }));
      const sunGeo = engine.own(new THREE.IcosahedronGeometry(0.3, 1));
      const sunMat = engine.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a2a).multiplyScalar(2.2), toneMapped: false }));

      // ---------------- hook gun, hook, rope, sights
      const metal = engine.own(new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.35, metalness: 0.85 }));
      const neon = engine.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5eead4).multiplyScalar(2), toneMapped: false }));
      const gun = new THREE.Group();
      {
        const bodyG = new THREE.Mesh(engine.own(new THREE.BoxGeometry(0.14, 0.42, 0.16)), metal);
        bodyG.position.y = 0.12;
        const barrel = new THREE.Mesh(engine.own(new THREE.CylinderGeometry(0.045, 0.055, 0.34, 10)), metal);
        barrel.position.y = 0.45;
        const tip = new THREE.Mesh(engine.own(new THREE.TorusGeometry(0.055, 0.018, 6, 14)), neon);
        tip.rotation.x = Math.PI / 2;
        tip.position.y = 0.62;
        const strip = new THREE.Mesh(engine.own(new THREE.BoxGeometry(0.02, 0.3, 0.17)), neon);
        strip.position.set(0.075, 0.12, 0);
        gun.add(bodyG, barrel, tip, strip);
      }
      scene.add(gun);
      const hook = new THREE.Group();
      {
        const shaft = new THREE.Mesh(engine.own(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8)), metal);
        const point = new THREE.Mesh(engine.own(new THREE.ConeGeometry(0.07, 0.16, 10)), metal);
        point.position.y = 0.22;
        hook.add(shaft, point);
        const prongGeo = engine.own(new THREE.TorusGeometry(0.11, 0.022, 6, 12, Math.PI * 0.8));
        for (let k = 0; k < 3; k++) {
          const p = new THREE.Mesh(prongGeo, metal);
          p.rotation.set(0, (k * Math.PI * 2) / 3, Math.PI * 0.6);
          p.position.y = 0.05;
          hook.add(p);
        }
        const glow = new THREE.Mesh(engine.own(new THREE.SphereGeometry(0.05, 8, 6)), neon);
        glow.position.y = -0.15;
        hook.add(glow);
      }
      hook.visible = false;
      scene.add(hook);
      const ropeMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.8 }));
      const rope = new THREE.Mesh(unitCyl, ropeMat);
      rope.scale.set(0.028, 1, 0.028);
      const ropeInner = rope; // (kept for clarity)
      ropeInner.visible = false;
      scene.add(rope);
      // laser sight: green in range, gold in the PERFECT band, red out of range
      const sightMat = engine.own(new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false }));
      const sight = new THREE.Mesh(unitCyl, sightMat);
      scene.add(sight);
      // fray timer round the branch you hang from
      const frayMat = engine.own(new THREE.MeshBasicMaterial({ color: 0x86efac, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
      const frayGeo = new THREE.RingGeometry(0.42, 0.56, 48, 1, Math.PI / 2, Math.PI * 2);
      const fray = new THREE.Mesh(frayGeo, frayMat);
      fray.rotation.y = Math.PI / 2;
      scene.add(fray);
      // vines: the targets. The middle third glows on the vine you're aiming for (PERFECT zone).
      const bandMat = engine.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfde047).multiplyScalar(1.6), transparent: true, opacity: 0.85, toneMapped: false }));
      const bandGeo = engine.own(new THREE.CylinderGeometry(0.075, 0.075, 1, 8));
      const targetVineMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x9be15d, roughness: 0.7, emissive: 0x4ade80, emissiveIntensity: 0.55 }));
      const goldVineMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xffc83a, roughness: 0.4, metalness: 0.6, emissive: 0xffa600, emissiveIntensity: 0.5 }));
      const vineLeafMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.7, side: THREE.DoubleSide }));
      const vineLeafGeo = engine.own(new THREE.PlaneGeometry(0.26, 0.14));
      const targetVineGeo = engine.own(new THREE.CylinderGeometry(0.05, 0.06, 1, 6));
      targetVineGeo.translate(0, -0.5, 0);

      // ---------------- course
      let rng = mulberry32(1);
      let anchors: Anchor[] = [];
      const objs: { tree: THREE.Group; ring: THREE.Mesh; ringHolder: THREE.Group; vine: THREE.Mesh; band: THREE.Mesh; len: number }[] = [];
      let fruit: Fruit[] = [];
      let t = 0;

      const buildAnchor = (a: Anchor, i: number) => {
        const tree = new THREE.Group();
        const tx = -(3.4 + (i % 3) * 0.8);
        const trunk = new THREE.Mesh(trunkGeo, barkMat);
        trunk.position.set(tx, 9, -a.f - 0.4);
        trunk.castShadow = quality.shadows;
        const ringHolder = new THREE.Group(); // bobs with the anchor
        const branch = new THREE.Mesh(branchGeo, barkMat);
        span(branch, new THREE.Vector3(tx, a.y0 + 0.9, -a.f - 0.3), new THREE.Vector3(0, a.y0 + 0.18, -a.f));
        branch.scale.x = branch.scale.z = 1;
        branch.castShadow = quality.shadows;
        const crown = new THREE.Group();
        for (let k = 0; k < 4; k++) {
          const leaf = new THREE.Mesh(canopyGeo, leafMats[(i + k) % leafMats.length]);
          leaf.position.set(tx * (0.4 + k * 0.2) + (k - 1.5) * 0.6, a.y0 + 1.6 + (k % 2) * 0.8, -a.f + (k - 1.5) * 0.9);
          leaf.scale.setScalar(0.7 + ((i * 7 + k * 3) % 5) * 0.12);
          leaf.rotation.set(k, i, 0);
          leaf.castShadow = quality.shadows;
          crown.add(leaf);
        }
        // a couple of short decorative vines hanging off the branch
        for (let k = 0; k < 2; k++) {
          const hv = new THREE.Mesh(hangVineGeo, vineMat);
          hv.position.set(tx * (0.3 + k * 0.3), a.y0 + 0.4 + k * 0.2, -a.f - 0.2);
          hv.scale.y = 1.2 + ((i + k) % 3) * 0.6;
          tree.add(hv);
        }
        const ring = new THREE.Mesh(anchorRingGeo, a.gold ? goldRingMat : ringMat);
        ring.rotation.y = Math.PI / 2;
        ringHolder.add(ring);
        ringHolder.position.set(0, a.y0, -a.f);
        // the vine you hook: hangs from the ring, shorter every stage
        const len = stageAt(i).vine;
        const vine = new THREE.Mesh(targetVineGeo, a.gold ? goldVineMat : vineMat);
        vine.scale.y = len;
        vine.castShadow = quality.shadows;
        ringHolder.add(vine);
        for (let k = 0; k < 4; k++) {
          const lf = new THREE.Mesh(vineLeafGeo, vineLeafMat);
          lf.position.set(0.06 * (k % 2 ? 1 : -1), -len * (0.12 + k * 0.24), 0);
          lf.rotation.set(0.4, k * 1.3 + Math.PI / 2, 0.6 * (k % 2 ? 1 : -1));
          ringHolder.add(lf);
        }
        const band = new THREE.Mesh(bandGeo, bandMat);
        band.scale.y = len * 0.34;
        band.position.y = -len * 0.5;
        band.visible = false;
        ringHolder.add(band);
        // bobbing anchors hang from a little branch stub that moves with them
        if (a.bob > 0) {
          const stub = new THREE.Mesh(hangVineGeo, vineMat);
          stub.scale.y = 3;
          stub.position.y = 3;
          ringHolder.add(stub);
        } else tree.add(branch);
        tree.add(trunk, crown);
        world.add(tree, ringHolder);
        objs[i] = { tree, ring, ringHolder, vine, band, len };
      };

      const placeFruit = (from: Anchor, to: Anchor, i: number) => {
        const midF = (from.f + to.f) / 2;
        const midY = Math.min(from.y0, to.y0) - 2.6;
        const kinds: FruitKind[] = [];
        if (i > 0 && i % 25 === 0) kinds.push('sunstone');
        else if (i > 6 && rng() < 0.12) kinds.push('idol');
        else if (rng() < 0.5) kinds.push('banana');
        kinds.forEach((kind) => {
          const mesh = kind === 'banana' ? new THREE.Mesh(bananaGeo, bananaMat) : kind === 'idol' ? new THREE.Mesh(idolGeo, idolMat) : new THREE.Mesh(sunGeo, sunMat);
          const y = midY + (rng() - 0.5) * 1.2;
          mesh.position.set(0, y, -midF);
          world.add(mesh);
          fruit.push({ kind, f: midF, y, taken: false, mesh });
        });
      };

      const ensureAhead = (cur: number) => {
        while (anchors.length < cur + AHEAD) {
          const i = anchors.length;
          const a = nextAnchor(anchors[i - 1], i, rng);
          anchors.push(a);
          a.gold = false; // no special vines: every vine is worth the same
          buildAnchor(a, i);
        }
        for (let i = 0; i < cur - BEHIND; i++) {
          const o = objs[i];
          if (o) {
            world.remove(o.tree, o.ringHolder);
            delete objs[i];
          }
        }
        fruit = fruit.filter((fr) => {
          if (fr.f < (anchors[cur]?.f ?? 0) - 10) {
            world.remove(fr.mesh);
            return false;
          }
          return true;
        });
      };

      // ---------------- player
      const me = create3DAvatar(stableAvatar);
      const body = new THREE.Group();
      me.group.position.y = -HAND_UP;
      me.group.rotation.y = Math.PI - 0.75;
      me.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = quality.shadows;
      });
      body.add(me.group);
      scene.add(body);

      const b: Body = { f: 0, y: 0, vf: 0, vy: 0 };
      let line: Rope | null = null;
      let target = 1;
      let shots = 0;
      let reload = 0;
      let flying: Hook | null = null;
      let playing = false;
      let over = false;
      let streak = 0;
      let bestStreak = 0;
      let caught = 0;
      let stageIdx = 0;
      let frameN = 0;
      let lastHooked = 0;
      let lastCanRelease = false;
      let book = new ScoreBook();
      const camFocus = new THREE.Vector3(0, 7, -3);
      const tmpV = new THREE.Vector3();
      const tmpA = new THREE.Vector3();
      const tmpB = new THREE.Vector3();

      const hangOn = (i: number, angle: number, L: number) => {
        const A = anchorPos(anchors[i], t);
        b.f = A.f + L * Math.sin(angle);
        b.y = A.y - L * Math.cos(angle);
        b.vf = b.vy = 0;
        line = { anchor: i, drop: 0, L, t: 0 };
      };
      /** The point you swing from: where your hook bit the vine (it bobs with the branch). */
      const pivotOf = (r: Rope) => {
        const A = anchorPos(anchors[r.anchor], t);
        return { f: A.f, y: A.y - r.drop };
      };

      const clearWorld = () => {
        objs.forEach((o) => o && world.remove(o.tree, o.ringHolder));
        objs.length = 0;
        fruit.forEach((fr) => world.remove(fr.mesh));
        fruit = [];
      };

      const reset = () => {
        clearWorld();
        rng = mulberry32(seedRef.current ?? randomSeed());
        t = 0;
        anchors = [FIRST_ANCHOR];
        buildAnchor(anchors[0], 0);
        ensureAhead(0);
        hangOn(0, -0.75, 3.6);
        target = 1;
        lastHooked = 0;
        shots = 0;
        reload = 0;
        flying = null;
        streak = bestStreak = caught = 0;
        stageIdx = 0;
        book = new ScoreBook();
        over = false;
        particles.clear();
      };
      reset();

      const pushScore = () => pushHud({ score: book.score, vines: caught, streak, stage: stageIdx }, true);
      const popAtWorld = (f: number, y: number, text: string, style: { color: string; size: 'sm' | 'md' | 'lg' }) => {
        const p = engine.toScreen(tmpV.set(0, y, -f));
        if (p.visible) popups.current?.pop(text, p.x, p.y, style);
      };

      api.current.start = () => {
        reset();
        playing = true;
        pushScore();
        sound.startMusic(0.25);
      };

      // Two-beat control: tap to LET GO (keep your momentum), tap again in the air to FIRE.
      api.current.tap = () => {
        if (!playing) return;
        if (line) {
          line = null;
          sound.playSwish();
          haptic('light');
          return;
        }
        if (flying || reload > 0) return;
        flying = { f: b.f, y: b.y, state: 'out', t: 0, next: target };
        sound.playLaser();
        haptic('light');
        particles.emit(tmpV.set(0.2, b.y + 0.5, -b.f), 0x5eead4, { count: 6, speed: 2, life: 0.25, gravity: 0 });
      };

      const finish = (why: string) => {
        playing = false;
        over = true;
        line = null;
        flying = null;
        sound.stopMusic(0.4);
        sound.playLose();
        haptic('fail');
        engine.flash(0.4);
        popups.current?.banner(`${why} · ${caught} BRANCHES`, '#5eead4');
        pushScore();
        setPhase('over');
        setTimeout(() => onFinishRef.current(book.score, { vines: caught, maxCombo: bestStreak, distance: Math.round(b.f), breakdown: book.breakdown() }), 1200);
      };

      const onHook = (i: number, dist: number, drop: number) => {
        const st = stageAt(i);
        const skipped = Math.max(0, i - lastHooked - 1);
        lastHooked = i;
        caught += 1 + skipped;
        const perfect = shots === 0 && isPerfect(drop, st.vine);
        // 1 point per vine you got past (a skipped vine counts too) — nothing else scores
        const gained = 1 + skipped;
        const a = award(gained, {});
        book.record(a, { Vines: gained });
        const A0 = anchorPos(anchors[i], t);
        const A = { f: A0.f, y: A0.y - drop };
        popAtWorld(A.f, A.y + 0.7, `+${a.total}`, popStyle(a.total));
        if (skipped) popups.current?.banner(skipped > 1 ? `SKIP ×${skipped}` : 'SKIP', '#38bdf8');
        else if (perfect) popAtWorld(A.f, A.y + 1.2, 'NICE', { color: '#fde047', size: 'sm' });
        void st;
        // stage change
        const ns = STAGES.findIndex((s) => s.name === stageAt(i + 1).name);
        if (ns > stageIdx) {
          stageIdx = ns;
          const s = STAGES[ns];
          popups.current?.banner(s.name === 'CRAZY' ? '🔥 CRAZY MODE' : `${s.name} STAGE`, s.color);
          engine.flash(0.35);
        }
        sound.playScore(1 + Math.min(0.6, skipped * 0.2));
        haptic(perfect ? 'score' : 'light');
        feel.kick(perfect ? 0.35 : 0.22);
        particles.emit(tmpV.set(0, A.y, -A.f), 0x9be15d, { count: perfect || skipped ? 20 : 12, speed: 3, life: 0.6, gravity: 5 });
        line = { anchor: i, drop, L: Math.max(MIN_ROPE, dist), t: 0 };
        target = i + 1;
        shots = 0;
        ensureAhead(i);
        pushScore();
      };

      const collectFruit = () => {
        for (const fr of fruit) {
          if (fr.taken || Math.hypot(fr.f - b.f, fr.y - (b.y - 0.8)) > 0.95) continue;
          fr.taken = true;
          fr.mesh.visible = false;
          const value = fr.kind === 'banana' ? PTS.base : fr.kind === 'idol' ? PTS.gold : PTS.jackpot;
          const label = fr.kind === 'banana' ? 'Bananas' : fr.kind === 'idol' ? 'Golden idols' : 'Sunstones';
          const a = award(value, { streak });
          book.record(a, { [label]: value });
          popAtWorld(fr.f, fr.y + 0.4, `+${a.total}`, popStyle(a.total, fr.kind === 'idol' ? 'gold' : fr.kind === 'sunstone' ? 'jackpot' : undefined));
          if (fr.kind !== 'banana') popups.current?.banner(fr.kind === 'idol' ? 'GOLDEN IDOL +3' : 'SUNSTONE +5', fr.kind === 'idol' ? '#fbbf24' : '#fb923c');
          particles.emit(tmpV.set(0, fr.y, -fr.f), fr.kind === 'banana' ? 0xffe14d : fr.kind === 'idol' ? 0xffc83a : 0xff7a2a, { count: fr.kind === 'banana' ? 10 : 26, speed: 3.5, life: 0.6 });
          sound.playPowerup();
          haptic('score');
          pushScore();
        }
      };

      // ---------------- frame
      engine.addUpdate((rawDt, time) => {
        const st = stageAt(target);
        const dt = Math.min(rawDt, 1 / 20) * (playing ? st.speed : 1);
        t += dt;
        const sub = 4;
        const h = dt / sub;
        for (let k = 0; k < sub && !over; k++) {
          const A = line ? pivotOf(line) : null;
          step(b, line, A, h);
          if (!playing && line) line.t = 0; // menu: never frays
          if (playing) {
            if (line && line.t > stageAt(line.anchor).hold) {
              line = null;
              popAtWorld(b.f, b.y + 1, 'SNAP!', { color: '#f87171', size: 'md' });
              sound.playSwish();
              haptic('fail');
            }
            // hook flight
            if (flying) {
              flying.t += h;
              const T = anchorPos(anchors[target], t);
              if (flying.state === 'out') {
                // Straight out along the gun's fixed angle. It bites the FIRST vine its line really
                // crosses — that can be one further on: fly past vines to skip them (bonus).
                const stepLen = HOOK_SPEED * h;
                const nf = flying.f + AIM_DIR.f * stepLen;
                const ny = flying.y + AIM_DIR.y * stepLen;
                let done = false;
                while (!done && flying && nf >= anchorPos(anchors[flying.next], t).f) {
                  const V = anchorPos(anchors[flying.next], t);
                  const len = objs[flying.next]?.len ?? stageAt(flying.next).vine;
                  const yAt = flying.y + ((V.f - flying.f) / AIM_DIR.f) * AIM_DIR.y;
                  const drop = V.y - yAt;
                  if (drop >= 0.15 && drop <= len) {
                    const i = flying.next;
                    flying = null;
                    onHook(i, Math.hypot(V.f - b.f, yAt - b.y), drop);
                    done = true;
                  } else {
                    flying.next += 1; // the line passes this vine — keep flying
                    ensureAhead(flying.next);
                  }
                }
                if (!done && flying) {
                  if (Math.hypot(nf - b.f, ny - b.y) > st.range) {
                    flying.state = 'back';
                    shots += 1;
                    streak = 0;
                    popAtWorld(nf, ny + 0.3, 'MISS', { color: '#fca5a5', size: 'sm' });
                  } else {
                    flying.f = nf;
                    flying.y = ny;
                  }
                }
              } else {
                const df = b.f - flying.f;
                const dy = b.y - flying.y;
                const d = Math.hypot(df, dy);
                const stepLen = HOOK_SPEED * 1.4 * h;
                if (d <= stepLen) {
                  flying = null;
                  reload = RELOAD_S;
                } else {
                  flying.f += (df / d) * stepLen;
                  flying.y += (dy / d) * stepLen;
                }
              }
            }
            if (reload > 0) reload = Math.max(0, reload - h);
            // flew past the next branch without hooking: aim at the one after
            // flew past the next vine: aim at the one after (skips score a bonus when you hook)
            if (!line && !flying && b.f > anchors[target].f + 0.6) {
              target += 1;
              ensureAhead(target);
            }
            if (b.y < WATER_Y + 0.35) {
              particles.emit(tmpV.set(0, WATER_Y + 0.1, -b.f), 0xbff7ee, { count: 50, speed: 6, life: 1, gravity: 9 });
              finish('SPLASH!');
              break;
            }
          }
        }
        if (!playing && !over && line) {
          // menu: keep a gentle swing going
          if (Math.hypot(b.vf, b.vy) < 0.3 && b.f - anchors[0].f < 0.1) b.vf = 3;
        }

        // anchors bob; the target glows
        for (let i = Math.max(0, target - BEHIND); i < anchors.length; i++) {
          const o = objs[i];
          if (!o) continue;
          const A = anchorPos(anchors[i], t);
          o.ringHolder.position.y = A.y;
          const isT = i === target && playing;
          o.ring.material = isT ? targetRingMat : anchors[i].gold ? goldRingMat : ringMat;
          o.ring.scale.setScalar(isT ? 1.3 + Math.sin(time * 6) * 0.12 : 1);
          o.vine.material = anchors[i].gold ? goldVineMat : isT ? targetVineMat : vineMat;
          o.band.visible = isT;
          o.vine.rotation.z = 0;
        }
        fruit.forEach((fr, k) => {
          fr.mesh.rotation.y += dt * 2.2;
          fr.mesh.position.y = fr.y + Math.sin(time * 2.5 + k) * 0.06;
        });

        // ---- you
        body.position.set(0, b.y, -b.f);
        me.updateAnimation(time, 'idle', dt);
        const T = anchorPos(anchors[Math.min(target, anchors.length - 1)], t);
        const PV = line ? pivotOf(line) : null;
        const aimF = PV ? PV.f - b.f : AIM_DIR.f;
        const aimY = PV ? PV.y - b.y : AIM_DIR.y;
        const aim = Math.atan2(aimF, aimY); // 0 = straight up, + = forward
        if (line) {
          body.rotation.x += (aim - body.rotation.x) * Math.min(1, dt * 18);
          me.leftArm.rotation.x = me.rightArm.rotation.x = -Math.PI;
          me.leftArm.rotation.z = -0.12;
          me.rightArm.rotation.z = 0.12;
          const kick = -b.vf * 0.05;
          me.leftLeg.rotation.x = kick + 0.12;
          me.rightLeg.rotation.x = kick - 0.08;
        } else {
          body.rotation.x += (THREE.MathUtils.clamp(-b.vy * 0.035, -0.45, 0.45) - body.rotation.x) * Math.min(1, dt * 8);
          me.leftArm.rotation.x = -2.4;
          me.rightArm.rotation.x = -Math.PI + (aim - body.rotation.x) * -0.6;
          me.leftLeg.rotation.x = -0.9;
          me.rightLeg.rotation.x = -0.5;
        }
        // gun in hand, pointed at the rope / the target
        const gunAt = tmpA.set(0.18, b.y + 0.05, -b.f);
        gun.position.copy(gunAt);
        const toT = tmpB.set(0, aimY, -aimF).normalize();
        gun.quaternion.setFromUnitVectors(UP, toT);

        // rope + hook
        const hand = tmpA.set(0.18, b.y + 0.3, -b.f);
        if (line) {
          const A = pivotOf(line);
          rope.visible = true;
          span(rope, hand, tmpB.set(0, A.y, -A.f));
          rope.scale.x = rope.scale.z = 0.028;
          hook.visible = true;
          hook.position.set(0, A.y + 0.05, -A.f);
          hook.quaternion.setFromUnitVectors(UP, tmpV.set(0, A.y - b.y, -(A.f - b.f)).normalize());
          ropeMat.color.setHex(line.t > stageAt(line.anchor).hold * 0.7 ? 0xf2a29a : 0xe8dcc0);
        } else if (flying) {
          rope.visible = true;
          span(rope, hand, tmpB.set(0, flying.y, -flying.f));
          rope.scale.x = rope.scale.z = 0.022;
          hook.visible = true;
          hook.position.set(0, flying.y, -flying.f);
          hook.quaternion.setFromUnitVectors(UP, tmpV.set(0, AIM_DIR.y, -AIM_DIR.f));
        } else {
          rope.visible = false;
          hook.visible = false;
        }

        // aim laser along the gun's fixed angle: green when firing now would hit the vine, gold in
        // the PERFECT zone, red otherwise. It shortens every stage (none in CRAZY).
        const range = st.range;
        let vineLen = objs[target]?.len ?? st.vine;
        let hit = hookHit(b, T, vineLen, range);
        for (let k = 1; !hit && k <= 3 && target + k < anchors.length; k++) {
          const Vk = anchorPos(anchors[target + k], t);
          const lk = objs[target + k]?.len ?? stageAt(target + k).vine;
          const hk = hookHit(b, Vk, lk, range);
          if (hk) {
            hit = hk;
            vineLen = lk;
          }
        }
        const inRange = !!hit;
        const inSweet = !!hit && isPerfect(hit.drop, vineLen);
        const show = playing && !flying && !line;
        sight.visible = show && reload <= 0 && st.sight > 0;
        if (sight.visible) {
          const from = tmpA.set(0.2, b.y + 0.3, -b.f);
          const L = range * st.sight;
          span(sight, from, tmpB.set(0.2, b.y + 0.3 + AIM_DIR.y * L, -(b.f + AIM_DIR.f * L)));
          sight.scale.x = sight.scale.z = 0.014;
          sightMat.color.setHex(inSweet ? 0xfde047 : inRange ? 0x4ade80 : 0xff5a5a).multiplyScalar(1.6);
        }
        if (line && playing) {
          const A = pivotOf(line);
          const left = 1 - line.t / stageAt(line.anchor).hold;
          fray.visible = true;
          fray.position.set(0.05, A.y, -A.f);
          frayGeo.setDrawRange(0, Math.max(0, Math.floor(48 * left)) * 6);
          frayMat.color.setHex(left < 0.3 ? 0xf87171 : left < 0.6 ? 0xfacc15 : 0x86efac);
        } else fray.visible = false;
        // (read by automated play-tests)
        // Would letting go right now work? (drives the early LET GO cue and automated play-tests)
        const canRelease = playing && !!line && (caught < 2 || frameN++ % 2 === 0 ? (lastCanRelease = releaseWorks(b, anchors[target], vineLen, range, t)) : lastCanRelease);
        engine.renderer.domElement.dataset.shot = !playing ? 'none' : line ? (canRelease ? 'release' : 'hang') : flying ? 'flying' : inSweet && inRange ? 'perfect' : inRange ? 'range' : 'out';

        // first branches: a TAP cue when the shot is perfect
        if (playing && caught < 2 && Math.floor(time * 4) % 4 === 0 && ((line && canRelease) || (!line && !flying && inSweet))) {
          const p = engine.toScreen(tmpV.set(0, b.y + 1, -b.f));
          popups.current?.pop(line ? 'LET GO!' : 'FIRE!', p.x, p.y, { color: '#fde047', size: 'sm' });
        }

        // ---- camera: travel runs left → right; keep you ~30% from the left
        const aspect = camera.aspect;
        const viewW = 2 * camDist * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * aspect;
        const lead = THREE.MathUtils.clamp(T.f - b.f, 0, viewW * 0.6) * 0.5 + viewW * 0.06;
        // smooth, fluid follow: glide with the swing instead of snapping to it
        camFocus.lerp(tmpV.set(0, THREE.MathUtils.lerp(6.8, b.y - 0.5, 0.3), -(b.f + lead)), 1 - Math.exp(-rawDt * 2.6));
        const off = feel.update(rawDt, time, 0);
        camera.position.set(camDist, camFocus.y + 1 + off.y, camFocus.z + off.x);
        camera.lookAt(camFocus);

        sun.position.set(10, 24, camFocus.z + 6);
        sun.target.position.set(0, 8, camFocus.z);
        river.position.z = camFocus.z - 150;
        (river.material as THREE.MeshStandardMaterial).map!.offset.y += rawDt * 0.05;
        const zNow = camFocus.z + 12;
        if (Math.abs(zNow - farTrunks.position.z) > 100) farTrunks.position.z = farLeaves.position.z = Math.round(zNow / 100) * 100;
        shafts.forEach((sh, i) => {
          if (sh.position.z > zNow + 6) sh.position.z -= 72;
          sh.rotation.y += rawDt * 0.02 * (i % 2 ? 1 : -1);
        });
        for (let i = 0; i < flyN; i++) {
          const sd = flySeed[i];
          let z = sd[2] + zNow;
          z = zNow - ((((zNow - z) % 70) + 70) % 70);
          flyPos[i * 3] = sd[0] - 4 + Math.sin(time * 0.7 + sd[3]) * 0.5;
          flyPos[i * 3 + 1] = sd[1] + Math.sin(time * 1.1 + sd[3] * 2) * 0.3;
          flyPos[i * 3 + 2] = z;
        }
        flyGeo.attributes.position.needsUpdate = true;
      });

      return () => {
        me.dispose();
        frayGeo.dispose();
        api.current = { tap: () => {}, start: () => {} };
      };
    },
    [stableAvatar],
  );

  const fire = onFire(hud.streak);
  const stage = STAGES[hud.stage] ?? STAGES[0];
  const chips = (
    <>
      <span className="px-2 py-0.5 rounded-full bg-black/50 text-[11px] font-black" style={{ color: stage.color }} data-testid="swing-stage">
        {stage.name}
      </span>
      <span className="px-2 py-0.5 rounded-full bg-black/50 text-emerald-300 text-[11px] font-black tabular-nums" data-testid="swing-vines">
        {hud.vines} vines
      </span>

    </>
  );

  return (
    <GameShell
      title="CANOPY SWING"
      accent="#4ade80"
      hostRef={hostRef}
      popupsRef={popups}
      phase={phase}
      onStart={startGame}
      score={hud.score}
      chips={chips}
      rival={rival}
      match={match}
      onExit={onExit}
      surface={surface}
      hint="Tap to let go · tap again to fire when the line crosses the vine"
      guide={{
        goal: 'Swing, fly and hook vine to vine across the river. Don’t fall in.',
        controls: [
          { gesture: 'release', label: 'Tap to let go on the up-swing' },
          { gesture: 'tap', label: 'Tap again in the air to fire the hook' },
          { gesture: 'timing', label: 'The gun fires at a fixed angle — time it to cross the vine' },
        ],
        points: [
          { label: 'Every vine you pass', value: '1' },
        ],
        ends: 'Slow → Middle → Final → Crazy · vines shorten, the aim laser fades · one splash ends it',
      }}
      tutorial={[
        { icon: <Pointer className="w-6 h-6" />, label: 'Tap: let go · tap: fire' },
        { icon: <Crosshair className="w-6 h-6" />, label: 'Fire when the line meets the vine' },
        { icon: <Timer className="w-6 h-6" />, label: 'Ropes fray — keep moving' },
      ]}
      scoring="Swing left to right — 1 point for every vine you get past, that's the whole score (fly past a vine and it still counts). One splash ends the run. Tap to let go, tap again to fire the hook at a fixed angle — no auto-aim. Four stages — Slow, Middle, Final, Crazy: gaps widen, vines get shorter, the aim laser fades, branches bob and ropes fray faster. Same jungle for every player."
    />
  );
}
