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
import { Anchor, Body, FIRST_ANCHOR, HOOK_SPEED, MIN_ROPE, RELOAD_S, Rope, STAGES, WATER_Y, anchorPos, nextAnchor, stageAt, step } from '@/lib/grapple-physics';
import GameShell, { PopupApi, useSwipe } from './GameShell';
import { Pointer, Crosshair, Timer } from 'lucide-react';

/**
 * CANOPY SWING — side-on hook-gun swinging through a jungle canopy above a river.
 * Tap to let go and fire your hook gun at the next branch. If it's in rope range the hook bites
 * and you swing on; if not, it misses and reloads while you fall. Ropes fray, so keep moving.
 * Four stages — SLOW → MIDDLE → FINAL → CRAZY — so every run ends; one splash and you're out.
 *
 * Scoring (shared rules): 1 per branch · perfect shot (from the gold band) +1 · gold branch 3 ·
 * banana 1 · golden idol 3 · sunstone 5 · 5 perfect shots in a row = ON FIRE ×2.
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
      // range ring + PERFECT band around the target, and the fray timer round the current anchor
      const rangeMat = engine.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
      const bandMat = engine.own(new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
      const frayMat = engine.own(new THREE.MeshBasicMaterial({ color: 0x86efac, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
      let rangeRing = new THREE.Mesh(new THREE.RingGeometry(1, 1.05, 96), rangeMat);
      let band = new THREE.Mesh(new THREE.RingGeometry(1, 2, 96), bandMat);
      const frayGeo = new THREE.RingGeometry(0.42, 0.56, 48, 1, Math.PI / 2, Math.PI * 2);
      const fray = new THREE.Mesh(frayGeo, frayMat);
      for (const m of [rangeRing, band, fray]) {
        m.rotation.y = Math.PI / 2;
        scene.add(m);
      }
      let ringFor = { range: 0, s0: 0, s1: 0 };
      const rebuildRings = (range: number, s0: number, s1: number) => {
        if (Math.abs(range - ringFor.range) < 0.04 && s0 === ringFor.s0) return;
        ringFor = { range, s0, s1 };
        rangeRing.geometry.dispose();
        band.geometry.dispose();
        rangeRing.geometry = new THREE.RingGeometry(range - 0.06, range, 128);
        band.geometry = new THREE.RingGeometry(s0, s1, 96);
      };

      // ---------------- course
      let rng = mulberry32(1);
      let anchors: Anchor[] = [];
      const objs: { tree: THREE.Group; ring: THREE.Mesh; ringHolder: THREE.Group }[] = [];
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
        // bobbing anchors hang from a little branch stub that moves with them
        if (a.bob > 0) {
          const stub = new THREE.Mesh(hangVineGeo, vineMat);
          stub.scale.y = 3;
          stub.position.y = 3;
          ringHolder.add(stub);
        } else tree.add(branch);
        tree.add(trunk, crown);
        world.add(tree, ringHolder);
        objs[i] = { tree, ring, ringHolder };
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
          placeFruit(anchors[i - 1], a, i);
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
        line = { anchor: i, L, t: 0 };
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

      api.current.tap = () => {
        if (!playing || flying || reload > 0) return;
        if (line) {
          line = null; // let go…
          feel.kick(0.12);
        }
        // …and fire at the next branch
        flying = { f: b.f, y: b.y, state: 'out', t: 0 };
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

      const onHook = (i: number, dist: number) => {
        const st = stageAt(i);
        caught += 1;
        const perfect = shots === 0 && dist >= st.sweet[0] && dist <= st.sweet[1];
        streak = perfect ? streak + 1 : 0;
        bestStreak = Math.max(bestStreak, streak);
        const a0 = anchors[i];
        const base = a0.gold ? PTS.gold : PTS.base;
        const parts: Record<string, number> = { [a0.gold ? 'Gold branches' : 'Branches']: base };
        if (perfect) parts['Perfect shots'] = PTS.bonus;
        const a = award(base + (perfect ? PTS.bonus : 0), { streak });
        book.record(a, parts);
        const A = anchorPos(a0, t);
        popAtWorld(A.f, A.y + 0.7, `+${a.total}`, popStyle(a.total, a0.gold ? 'gold' : perfect ? 'bonus' : undefined));
        if (perfect) popAtWorld(A.f, A.y + 1.2, 'PERFECT', { color: '#fde047', size: 'sm' });
        if (streak === FIRE_STREAK) popups.current?.banner('ON FIRE ×2', '#f43f5e');
        // stage change
        const ns = STAGES.findIndex((s) => s.name === stageAt(i + 1).name);
        if (ns > stageIdx) {
          stageIdx = ns;
          const s = STAGES[ns];
          popups.current?.banner(s.name === 'CRAZY' ? '🔥 CRAZY MODE' : `${s.name} STAGE`, s.color);
          engine.flash(0.35);
        }
        sound.playScore(1 + Math.min(1, streak * 0.08));
        haptic(perfect ? 'score' : 'light');
        feel.kick(perfect ? 0.35 : 0.22);
        particles.emit(tmpV.set(0, A.y, -A.f), a0.gold ? 0xffc83a : 0x9be15d, { count: perfect ? 22 : 12, speed: 3, life: 0.6, gravity: 5 });
        line = { anchor: i, L: Math.max(MIN_ROPE, dist), t: 0 };
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
          const A = line ? anchorPos(anchors[line.anchor], t) : null;
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
                const df = T.f - flying.f;
                const dy = T.y - flying.y;
                const d = Math.hypot(df, dy);
                const stepLen = HOOK_SPEED * h;
                const dist = Math.hypot(T.f - b.f, T.y - b.y);
                const travelled = Math.hypot(flying.f - b.f, flying.y - b.y);
                if (travelled > st.range + 0.3) {
                  // ran out of rope: miss
                  flying.state = 'back';
                  shots += 1;
                  streak = 0;
                  popAtWorld(flying.f, flying.y + 0.4, 'MISS', { color: '#fca5a5', size: 'sm' });
                } else if (d <= stepLen) {
                  if (dist <= st.range) {
                    flying = null;
                    onHook(target, dist);
                  } else {
                    flying.state = 'back';
                    shots += 1;
                  }
                } else {
                  flying.f += (df / d) * stepLen;
                  flying.y += (dy / d) * stepLen;
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
            if (!line && !flying && b.f > anchors[target].f + 2.5) {
              target += 1;
              shots = 1;
              ensureAhead(target);
            }
            collectFruit();
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
        }
        fruit.forEach((fr, k) => {
          fr.mesh.rotation.y += dt * 2.2;
          fr.mesh.position.y = fr.y + Math.sin(time * 2.5 + k) * 0.06;
        });

        // ---- you
        body.position.set(0, b.y, -b.f);
        me.updateAnimation(time, 'idle', dt);
        const T = anchorPos(anchors[Math.min(target, anchors.length - 1)], t);
        const aimF = (line ? anchorPos(anchors[line.anchor], t).f : T.f) - b.f;
        const aimY = (line ? anchorPos(anchors[line.anchor], t).y : T.y) - b.y;
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
          const A = anchorPos(anchors[line.anchor], t);
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
          hook.quaternion.setFromUnitVectors(UP, tmpV.set(0, T.y - flying.y, -(T.f - flying.f)).normalize());
        } else {
          rope.visible = false;
          hook.visible = false;
        }

        // sights: range ring + perfect band round the target, laser to it, fray timer
        const range = st.range;
        rebuildRings(range, st.sweet[0], st.sweet[1]);
        const dist = Math.hypot(T.f - b.f, T.y - b.y);
        const inRange = dist <= range;
        const inSweet = dist >= st.sweet[0] && dist <= st.sweet[1];
        const show = playing && !flying;
        rangeRing.position.set(0, T.y, -T.f);
        band.position.set(0, T.y, -T.f);
        rangeMat.color.setHex(inRange ? 0x86efac : 0xffffff);
        rangeMat.opacity += ((show ? (inRange ? 0.4 : 0.16) : 0) - rangeMat.opacity) * Math.min(1, dt * 10);
        bandMat.opacity += ((show ? (inSweet ? 0.32 : 0.1) : 0) - bandMat.opacity) * Math.min(1, dt * 10);
        sight.visible = show && reload <= 0;
        if (sight.visible) {
          const from = tmpA.set(0.2, b.y + 0.3, -b.f);
          const dir = tmpB.set(0, T.y - b.y, -(T.f - b.f)).normalize().multiplyScalar(Math.min(dist, range));
          span(sight, from, dir.add(from));
          sight.scale.x = sight.scale.z = 0.012;
          sightMat.color.setHex(inSweet && inRange ? 0xfde047 : inRange ? 0x4ade80 : 0xff5a5a).multiplyScalar(1.6);
        }
        if (line && playing) {
          const A = anchorPos(anchors[line.anchor], t);
          const left = 1 - line.t / stageAt(line.anchor).hold;
          fray.visible = true;
          fray.position.set(0.05, A.y, -A.f);
          frayGeo.setDrawRange(0, Math.max(0, Math.floor(48 * left)) * 6);
          frayMat.color.setHex(left < 0.3 ? 0xf87171 : left < 0.6 ? 0xfacc15 : 0x86efac);
        } else fray.visible = false;
        // (read by automated play-tests)
        engine.renderer.domElement.dataset.shot = !playing ? 'none' : flying ? 'flying' : inSweet && inRange ? 'perfect' : inRange ? 'range' : 'out';

        // first branches: a TAP cue when the shot is perfect
        if (playing && caught < 2 && line && inSweet && inRange && Math.floor(time * 4) % 4 === 0) {
          const p = engine.toScreen(tmpV.set(0, b.y + 1, -b.f));
          popups.current?.pop('TAP!', p.x, p.y, { color: '#fde047', size: 'sm' });
        }

        // ---- camera: travel runs left → right; keep you ~30% from the left
        const aspect = camera.aspect;
        const viewW = 2 * camDist * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * aspect;
        const lead = THREE.MathUtils.clamp(T.f - b.f, 0, viewW * 0.6) * 0.5 + viewW * 0.06;
        camFocus.lerp(tmpV.set(0, THREE.MathUtils.lerp(6.5, b.y - 0.5, 0.4), -(b.f + lead)), 1 - Math.exp(-rawDt * 4));
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
        rangeRing.geometry.dispose();
        band.geometry.dispose();
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
        {hud.vines} branches
      </span>
      {hud.streak > 0 && (
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${fire ? 'bg-orange-500 text-black' : 'bg-black/50 text-amber-300'}`}>
          {fire ? 'ON FIRE ×2 · ' : ''}
          {hud.streak} perfect
        </span>
      )}
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
      hint="Tap to let go and fire your hook at the next branch"
      guide={{
        goal: 'Hook-swing branch to branch across the river. Don’t fall in.',
        controls: [
          { gesture: 'tap', label: 'Tap: let go + fire the hook gun' },
          { gesture: 'timing', label: 'Fire when the laser is green — gold = PERFECT' },
          { gesture: 'avoid', label: 'Ropes fray — don’t hang around' },
        ],
        points: [
          { label: 'Branch', value: '1' },
          { label: 'Perfect shot', value: '+1', tone: 'bonus' },
          { label: 'Gold branch', value: '3', tone: 'gold' },
          { label: 'Banana', value: '1' },
          { label: 'Idol / Sunstone', value: '3 / 5', tone: 'jackpot' },
          { label: '5 perfect', value: '×2', tone: 'fire' },
        ],
        ends: 'Slow → Middle → Final → Crazy · one splash ends the run',
      }}
      tutorial={[
        { icon: <Pointer className="w-6 h-6" />, label: 'Tap to fire the hook' },
        { icon: <Crosshair className="w-6 h-6" />, label: 'Green laser = in range' },
        { icon: <Timer className="w-6 h-6" />, label: 'Ropes fray — keep moving' },
      ]}
      scoring="One splash ends the run. 1 point per branch hooked · perfect shot from the gold band +1 · gold branch 3 · banana 1 · golden idol 3 · sunstone 5 · 5 perfect shots in a row = ON FIRE ×2. Four stages — Slow, Middle, Final, Crazy: gaps widen, ropes get shorter, branches start to bob and ropes fray faster. Same jungle for every player."
    />
  );
}
