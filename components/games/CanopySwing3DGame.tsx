'use client';

import React, { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
import { CameraFeel, ParticleBursts, useGameEngine, useLatest, useStructuralMemo, useThrottledHud } from '@/lib/engine';
import { create3DAvatar } from '@/lib/avatar-3d-model';
import { GameProps } from '@/lib/game-types';
import { mulberry32, randomSeed } from '@/lib/rng';
import { award, popStyle, ScoreBook } from '@/lib/scoring';
import { Anchor, Body, Bramble, FIRST_ANCHOR, PACE, ROPE, Rope, STAGES, WATER_Y, anchorPos, fireEscape, fireStep, grab, grabbable, hitsBramble, newFire, nextAnchor, padBounce, releaseWorks, ropeAngle, stageAt, step } from '@/lib/grapple-physics';
import GameShell, { PopupApi, useSwipe } from './GameShell';
import { Crosshair, Hand, Flame } from 'lucide-react';

/**
 * CANOPY SWING — a fast physics swinging game through a jungle canopy above a river, left to right.
 * You carry a HOOK GUN: hold anywhere and it fires a hook on a rope at the tip of the nearest vine
 * in reach (its target lights up); keep holding to swing on it, LET GO to fly off with exactly the
 * speed you had. Real pendulum physics, so a well-timed release on the upswing can carry you over
 * two, three or more vines. Dawdle and a FIRE WALL sweeps in from the left — catch a new vine
 * before it reaches you and it dies back; let it touch you and the run is over.
 * Brambles block the hook and knock you down; lily pads bounce you back up; berries are +1.
 * Score (small numbers): 1 per vine passed, +1 per berry, +1 per vine skipped in one flight,
 * +1 every 5 catches in a row. Four stages — SLOW → MIDDLE → FINAL → CRAZY.
 */

const HAND_UP = 1.87;
const VIEW_W = 12.5;
const VIEW_H = 11;
const FOV = 42;
const AHEAD = 6;
const BEHIND = 3;

type Phase = 'ready' | 'playing' | 'over';

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

/** The fire wall: opaque embers on the left fading to licking flames at the leading (right) edge. */
function fireTexture() {
  const W = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = 512;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, 'rgba(60,3,0,0.95)');
  grd.addColorStop(0.7, 'rgba(150,18,0,0.95)');
  grd.addColorStop(0.86, 'rgba(225,45,0,0.97)');
  grd.addColorStop(0.94, 'rgba(255,105,10,0.97)');
  grd.addColorStop(0.975, 'rgba(255,175,60,0.9)');
  grd.addColorStop(1, 'rgba(255,220,140,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, 512);
  // flame tongues licking forward at the front
  for (let k = 0; k < 30; k++) {
    const y = (k / 30) * 512 + Math.random() * 8;
    const len = 18 + Math.random() * 30;
    const x0 = W * 0.93;
    const fl = g.createLinearGradient(x0, 0, x0 + len, 0);
    fl.addColorStop(0, 'rgba(255,150,40,0.95)');
    fl.addColorStop(1, 'rgba(255,200,90,0)');
    g.fillStyle = fl;
    g.beginPath();
    g.moveTo(x0, y - 9);
    g.quadraticCurveTo(x0 + len * 0.6, y - 7, x0 + len, y + 1);
    g.quadraticCurveTo(x0 + len * 0.5, y + 8, x0, y + 10);
    g.fill();
  }
  // darker smoke swirls in the body
  for (let k = 0; k < 40; k++) {
    g.fillStyle = `rgba(40,0,0,${0.15 + Math.random() * 0.2})`;
    g.beginPath();
    g.ellipse(Math.random() * W * 0.7, Math.random() * 512, 20 + Math.random() * 40, 8 + Math.random() * 20, Math.random(), 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 2);
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



const BEST_KEY = 'ra_best_canopy';
const readBest = () => {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
};
const saveBest = (v: number) => {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* private mode: best just isn't kept */
  }
};

export default function CanopySwing3DGame({ avatar, onFinish, seed, rival, match, onExit }: GameProps) {
  const stableAvatar = useStructuralMemo(avatar);
  const onFinishRef = useLatest(onFinish);
  const seedRef = useLatest(seed);
  const popups = useRef<PopupApi | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, stage: 0, streak: 0, best: 0, fire: 0 });
  const api = useRef({ press: () => {}, lift: () => {}, start: () => {} });

  const startGame = useCallback(() => {
    api.current.start();
    setPhase('playing');
  }, []);

  // Touch and hold anywhere = hold on; let go = let go.
  const surface = useSwipe({
    onDrag: (_s, ph) => {
      if (ph === 'start') api.current.press();
      else if (ph === 'end') api.current.lift();
    },
    onCancel: () => api.current.lift(),
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
      const trunkGeo = engine.own(new THREE.CylinderGeometry(0.32, 0.48, 26, 12, 1));
      const canopyGeo = engine.own(new THREE.IcosahedronGeometry(1.6, 1));
      const leafGeo = engine.own(new THREE.PlaneGeometry(0.24, 0.13));
      const leafMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.7, side: THREE.DoubleSide }));
      const unitCyl = engine.own(new THREE.CylinderGeometry(1, 1, 1, 7, 1));
      // obstacles, safe landings and collectibles
      const brambleMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x5a2a1c, roughness: 0.75, emissive: 0x3a0505, emissiveIntensity: 0.5, flatShading: true }));
      const spikeMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xc23a3a, roughness: 0.5, emissive: 0x5a0000, emissiveIntensity: 0.7 }));
      const brambleGeo = engine.own(new THREE.IcosahedronGeometry(0.8, 0));
      const spikeGeo = engine.own(new THREE.ConeGeometry(0.09, 0.42, 5));
      spikeGeo.translate(0, 0.9, 0);
      const padGeo = engine.own(new THREE.CylinderGeometry(1, 1, 0.08, 28, 1, false, 0.35, Math.PI * 2 - 0.35));
      const padMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x3fa34d, roughness: 0.55, emissive: 0x0f3d12, emissiveIntensity: 0.6 }));
      const bloomGeo = engine.own(new THREE.IcosahedronGeometry(0.22, 0));
      const bloomMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xffa6d2, roughness: 0.4, emissive: 0xff5fa8, emissiveIntensity: 1.4, flatShading: true }));
      const berryGeo = engine.own(new THREE.SphereGeometry(0.17, 14, 10));
      const berryMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xff3d8b, roughness: 0.25, emissive: 0xff2a7a, emissiveIntensity: 2.2 }));
      const berryLeafGeo = engine.own(new THREE.PlaneGeometry(0.16, 0.08));

      // River
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
      const glowMat = (c: number, k: number, o: number) => engine.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), transparent: true, opacity: o, toneMapped: false, depthWrite: false }));

      // The hook gun in your hand, its hook and the cable it trails.
      const metalMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x2b313a, roughness: 0.35, metalness: 0.8 }));
      const trimMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xffb02e, roughness: 0.4, metalness: 0.3, emissive: 0xff8a00, emissiveIntensity: 0.9 }));
      const gun = new THREE.Group();
      const gunBody = new THREE.Mesh(engine.own(new THREE.BoxGeometry(0.11, 0.12, 0.34)), metalMat);
      const barrel = new THREE.Mesh(engine.own(new THREE.CylinderGeometry(0.035, 0.04, 0.26, 10)), metalMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = -0.27;
      const muzzle = new THREE.Mesh(engine.own(new THREE.TorusGeometry(0.045, 0.014, 6, 14)), trimMat);
      muzzle.position.z = -0.4;
      const grip = new THREE.Mesh(engine.own(new THREE.BoxGeometry(0.07, 0.16, 0.08)), metalMat);
      grip.position.set(0, -0.11, 0.06);
      grip.rotation.x = 0.35;
      const spool = new THREE.Mesh(engine.own(new THREE.CylinderGeometry(0.07, 0.07, 0.07, 14)), trimMat);
      spool.rotation.z = Math.PI / 2;
      spool.position.set(0, 0.04, 0.08);
      gun.add(gunBody, barrel, muzzle, grip, spool);
      gun.traverse((o) => ((o as THREE.Mesh).castShadow = quality.shadows));
      scene.add(gun);
      const hook = new THREE.Group();
      const shank = new THREE.Mesh(engine.own(new THREE.CylinderGeometry(0.025, 0.025, 0.24, 8)), metalMat);
      const clawGeo = engine.own(new THREE.ConeGeometry(0.03, 0.2, 6));
      clawGeo.translate(0, 0.1, 0);
      hook.add(shank);
      for (let k = 0; k < 3; k++) {
        const claw = new THREE.Mesh(clawGeo, trimMat);
        const ang = (k / 3) * Math.PI * 2;
        claw.position.y = 0.1;
        claw.rotation.set(Math.cos(ang) * 2.3, 0, Math.sin(ang) * 2.3);
        hook.add(claw);
      }
      hook.visible = false;
      scene.add(hook);
      const ropeMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.7, emissive: 0x332a14 }));
      const rope = new THREE.Mesh(unitCyl, ropeMat);
      rope.visible = false;
      rope.castShadow = quality.shadows;
      scene.add(rope);
      // laser sight: from the muzzle to the vine tip you'd hit right now
      const laser = new THREE.Mesh(unitCyl, glowMat(0x6dff9c, 2, 0.55));
      laser.visible = false;
      scene.add(laser);

      // The fire wall sweeping in from the left (a glowing sheet between you and the camera).
      const fireTex = engine.own(fireTexture());
      const FIRE_W = 22;
      const fireMat = engine.own(new THREE.MeshBasicMaterial({ map: fireTex, transparent: true, opacity: 0, blending: THREE.NormalBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false }));
      fireMat.color.setRGB(1.15, 1, 1);
      const fireMat2 = fireMat.clone();
      fireMat2.map = fireTex.clone();
      fireMat2.map.repeat.set(1, 1.3);
      engine.own(fireMat2);
      engine.own(fireMat2.map);
      const fireGeo = engine.own(new THREE.PlaneGeometry(FIRE_W, 30));
      const fireSheet = new THREE.Mesh(fireGeo, fireMat);
      const fireSheet2 = new THREE.Mesh(fireGeo, fireMat2);
      for (const sh of [fireSheet, fireSheet2]) {
        sh.rotation.y = Math.PI / 2; // its right edge leads, toward +f
        sh.visible = false;
        scene.add(sh);
      }
      fireSheet.position.x = 2.2;
      fireSheet2.position.x = -1.2;
      const fireLight = new THREE.PointLight(0xff6a1a, 0, 14, 1.6);
      scene.add(fireLight);
      const fire = newFire();
      let fireVis = 0; // 0 → 1 fade
      let fireFront = -1e9; // drawn front (keeps retreating after you escape)

      // ---------------- course
      let rng = mulberry32(1);
      let anchors: Anchor[] = [];
      type Berry = { mesh: THREE.Group; f: number; y: number; taken: boolean };
      const objs: { tree: THREE.Group; holder: THREE.Group; knot: THREE.Mesh; gap: THREE.Group; berries: Berry[]; bramble: THREE.Group | null }[] = [];
      const rings: THREE.Mesh[] = [];
      // hanging vines: the hook catches the TIP at the bottom of each vine — that's where the target sits
      const vineGeo = engine.own(new THREE.CylinderGeometry(0.05, 0.07, 1, 6));
      vineGeo.translate(0, 0.5, 0); // spans 0 → 1 upward from the tip
      const vineMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x5c7a2e, roughness: 0.9, metalness: 0 }));
      const tipGeo = engine.own(new THREE.TorusGeometry(0.16, 0.055, 8, 18));
      const podGeo = engine.own(new THREE.SphereGeometry(0.11, 12, 10));
      const podMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xfff0b8, roughness: 0.35, emissive: 0xffb43a, emissiveIntensity: 2.2 }));
      const reticleRingGeo = engine.own(new THREE.TorusGeometry(0.5, 0.025, 6, 40));
      const reticleTickGeo = engine.own(new THREE.BoxGeometry(0.03, 0.22, 0.04));
      const glow = glowMat;
      const tgtDimMat = glow(0xffc85a, 1.1, 0.22);
      const tgtNextMat = glow(0xffd36b, 1.6, 0.65);
      const tgtLockMat = glow(0x6dff9c, 2.4, 1);
      const reticles: THREE.Group[] = [];
      const buildReticle = () => {
        const r = new THREE.Group();
        const ring = new THREE.Mesh(reticleRingGeo, tgtDimMat);
        ring.rotation.y = Math.PI / 2;
        r.add(ring);
        for (let k = 0; k < 4; k++) {
          const tk = new THREE.Mesh(reticleTickGeo, tgtDimMat);
          const ang = (k / 4) * Math.PI * 2;
          tk.position.set(0, Math.cos(ang) * 0.68, Math.sin(ang) * 0.68);
          tk.rotation.x = -ang;
          r.add(tk);
        }
        return r;
      };
      const setReticle = (r: THREE.Group, m: THREE.Material) => r.children.forEach((c) => ((c as THREE.Mesh).material = m));
      let t = 0;

      /** Bramble, lily pad and berries in the gap after anchor `a` (known once the next one exists). */
      const buildGap = (a: Anchor, gap: THREE.Group, berries: Berry[]) => {
        let brambleObj: THREE.Group | null = null;
        if (a.bramble) {
          const br = new THREE.Group();
          const core = new THREE.Mesh(brambleGeo, brambleMat);
          core.castShadow = quality.shadows;
          br.add(core);
          for (let k = 0; k < 14; k++) {
            const sp = new THREE.Mesh(spikeGeo, spikeMat);
            const u = (k + 0.5) / 14;
            sp.quaternion.setFromUnitVectors(UP, new THREE.Vector3(Math.sin(k * 2.4) * Math.sqrt(1 - (1 - 2 * u) ** 2), 1 - 2 * u, Math.cos(k * 2.4) * Math.sqrt(1 - (1 - 2 * u) ** 2)));
            br.add(sp);
          }
          br.scale.setScalar(a.bramble.r / 0.8);
          br.position.set(0, a.bramble.y, -a.bramble.f);
          gap.add(br);
          brambleObj = br;
        }
        if (a.pad) {
          const pad = new THREE.Group();
          const leaf = new THREE.Mesh(padGeo, padMat);
          leaf.scale.set(a.pad.w * 0.75, 1, a.pad.w);
          leaf.receiveShadow = quality.shadows;
          const flower = new THREE.Mesh(bloomGeo, bloomMat);
          flower.position.set(0.2, 0.15, 0.25);
          pad.add(leaf, flower);
          pad.position.set(0, WATER_Y + 0.05, -a.pad.f);
          gap.add(pad);
        }
        for (const p of a.berries ?? []) {
          const g = new THREE.Group();
          const berry = new THREE.Mesh(berryGeo, berryMat);
          const lf = new THREE.Mesh(berryLeafGeo, leafMat);
          lf.position.set(0.04, 0.17, 0.05);
          lf.rotation.set(0.5, Math.PI / 2, 0.4);
          g.add(berry, lf);
          g.position.set(0, p.y, -p.f);
          gap.add(g);
          berries.push({ mesh: g, f: p.f, y: p.y, taken: false });
        }
        return brambleObj;
      };

      const buildAnchor = (a: Anchor, i: number) => {
        const tree = new THREE.Group();
        const tx = -(3.4 + (i % 3) * 0.8);
        const crown = new THREE.Group();
        for (let k = 0; k < 4; k++) {
          const leaf = new THREE.Mesh(canopyGeo, leafMats[(i + k) % leafMats.length]);
          leaf.position.set(tx * (0.4 + k * 0.2) + (k - 1.5) * 0.6, a.y0 + 1.6 + (k % 2) * 0.8, -a.f + (k - 1.5) * 0.9);
          leaf.scale.setScalar(0.7 + ((i * 7 + k * 3) % 5) * 0.12);
          leaf.rotation.set(k, i, 0);
          leaf.castShadow = quality.shadows;
          crown.add(leaf);
        }
        // (no trunks in front of the pods: they hang from the canopy, so the swing path stays clear)
        crown.position.y += 4.5;
        tree.add(crown);
        const holder = new THREE.Group(); // bobs with the pod
        holder.position.set(0, a.y0, -a.f);
        // a vine hanging from the canopy, a loop at its tip (the hook point) and the target on it
        const vine = new THREE.Mesh(vineGeo, vineMat);
        vine.scale.y = 12;
        vine.castShadow = quality.shadows;
        const tip = new THREE.Mesh(tipGeo, vineMat);
        tip.rotation.y = Math.PI / 2;
        const knot = new THREE.Mesh(podGeo, podMat); // a little glowing bud marks the tip
        knot.position.y = -0.18;
        holder.add(vine, tip, knot);
        for (let k = 0; k < 5; k++) {
          const lf = new THREE.Mesh(leafGeo, leafMat);
          lf.position.set(0.06, 0.9 + k * 1.5 + ((i + k) % 3) * 0.3, 0.06 * (k % 2 ? 1 : -1));
          lf.rotation.set(0.4, Math.PI / 2 + k, 0.7 * (k % 2 ? 1 : -1));
          lf.scale.setScalar(1.6);
          holder.add(lf);
        }
        const ret = buildReticle();
        holder.add(ret);
        reticles[i] = ret;
        const gap = new THREE.Group();
        world.add(tree, holder, gap);
        objs[i] = { tree, holder, knot, gap, berries: [], bramble: null };
        // the previous gap's obstacles are known now that this point exists
        const prev = objs[i - 1];
        if (i > 0 && prev) prev.bramble = buildGap(anchors[i - 1], prev.gap, prev.berries);
      };

      const ensureAhead = (cur: number) => {
        while (anchors.length < cur + AHEAD) {
          const i = anchors.length;
          const a = nextAnchor(anchors[i - 1], i, rng);
          anchors.push(a);
          buildAnchor(a, i);
        }
        for (let i = 0; i < cur - BEHIND; i++) {
          const o = objs[i];
          if (o) {
            world.remove(o.tree, o.holder, o.gap);
            delete objs[i];
          }
        }
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
      let holding = false; // finger is down
      let firstHang = true; // you start on the first rope and stay on it until your first touch
      let stun = 0; // after a bramble hit you can't grab for a moment
      let lastGrab = 0;
      let target = 1; // next point ahead of you
      let streak = 0;
      let best = readBest();
      let playing = false;
      let over = false;
      let passed = 0;
      let stageIdx = 0;
      let whip = 1; // 0 → 1: the hook flying out to the vine tip on a shot
      let reel = 0; // 1 → 0: the hook reeling back into the gun after you let go
      let podF = 0; // the vine you last caught (where the fire wall measures from)
      const lastTip = new THREE.Vector3();
      let book = new ScoreBook();
      const knocked = new Set<Bramble>(); // brambles that already hit you
      const camFocus = new THREE.Vector3(0, 7, -3);
      const tmpV = new THREE.Vector3();
      const tmpA = new THREE.Vector3();
      const tmpB = new THREE.Vector3();

      const clearWorld = () => {
        objs.forEach((o) => o && world.remove(o.tree, o.holder, o.gap));
        objs.length = 0;
        reticles.length = 0;
      };

      const reset = () => {
        clearWorld();
        rng = mulberry32(seedRef.current ?? randomSeed());
        t = 0;
        anchors = [{ ...FIRST_ANCHOR }];
        buildAnchor(anchors[0], 0);
        ensureAhead(0);
        const A = anchorPos(anchors[0], 0);
        b.f = A.f + ROPE * Math.sin(-0.8);
        b.y = A.y - ROPE * Math.cos(-0.8);
        b.vf = b.vy = 0;
        line = grab(b, 0, A);
        holding = false;
        firstHang = true;
        stun = 0;
        lastGrab = 0;
        target = 1;
        streak = 0;
        best = readBest();
        passed = 0;
        stageIdx = 0;
        whip = 1;
        reel = 0;
        podF = A.f;
        fireEscape(fire);
        fireVis = 0;
        fireFront = -1e9;
        book = new ScoreBook();
        over = false;
        particles.clear();
        knocked.clear();
      };
      reset();

      const pushScore = () => pushHud({ score: book.score, stage: stageIdx, streak, best, fire: fire.front !== null ? 1 : 0 }, true);
      const popAtWorld = (f: number, y: number, text: string, style: { color: string; size: 'sm' | 'md' | 'lg' }) => {
        const p = engine.toScreen(tmpV.set(0, y, -f));
        if (p.visible) popups.current?.pop(text, p.x, p.y, style);
      };
      const addPoints = (n: number, label: string, f: number, y: number, text?: string) => {
        if (n <= 0) return;
        book.record(award(n, {}), { [label]: n });
        popAtWorld(f, y, text ?? `+${n}`, popStyle(n));
      };

      api.current.start = () => {
        reset();
        playing = true;
        pushScore();
        sound.startMusic(0.25);
      };
      api.current.press = () => {
        holding = true;
        firstHang = false;
      };
      api.current.lift = () => {
        holding = false;
        firstHang = false;
      };

      const finish = (why: string) => {
        playing = false;
        over = true;
        line = null;
        holding = false;
        sound.stopMusic(0.4);
        sound.playLose();
        haptic('fail');
        engine.flash(0.4);
        const isBest = book.score > best;
        if (isBest) {
          best = book.score;
          saveBest(best);
        }
        popups.current?.banner(isBest ? `NEW BEST · ${book.score}` : `${why} · ${passed} VINES`, isBest ? '#fde047' : '#5eead4');
        pushScore();
        setPhase('over');
        setTimeout(() => onFinishRef.current(book.score, { vines: passed, distance: Math.round(b.f), breakdown: book.breakdown() }), 1200);
      };

      /** Distance: 1 point for each vine you get past, counted the moment you pass it. */
      const countPassed = () => {
        while (passed + 1 < anchors.length && b.f > anchors[passed + 1].f) {
          passed += 1;
          const A = anchorPos(anchors[passed], t);
          addPoints(1, 'Distance', A.f, A.y + 0.6);
          const ns = STAGES.findIndex((x) => x.name === stageAt(passed + 1).name);
          if (ns > stageIdx) {
            stageIdx = ns;
            const x = STAGES[ns];
            popups.current?.banner(x.name === 'CRAZY' ? '🔥 CRAZY MODE' : `${x.name} STAGE`, x.color);
          }
          ensureAhead(passed);
          pushScore();
        }
      };

      /** Holding and a vine tip is in reach: the hook gun fires and the hook bites into the tip. */
      const onGrab = (i: number) => {
        const A = anchorPos(anchors[i], t);
        // your weight steadies a bobbing pod where you caught it (a moving pivot would fight the swing)
        anchors[i].y0 = A.y;
        anchors[i].bob = 0;
        line = grab(b, i, A);
        whip = 0;
        reel = 0;
        podF = A.f;
        sound.playLaser();
        if (fireEscape(fire)) {
          popAtWorld(b.f, b.y + 1.8, 'ESCAPED!', { color: '#fdba74', size: 'md' });
          haptic('big');
        }
        const jump = i - lastGrab;
        lastGrab = i;
        streak += 1;
        sound.playScore(1 + Math.min(0.8, (jump - 1) * 0.2));
        haptic('score');
        feel.kick(0.12);
        particles.emit(tmpV.set(0, A.y, -A.f), 0x9be15d, { count: 10 + jump * 4, speed: 3, life: 0.6, gravity: 5 });
        if (jump >= 2) {
          // long jump: +1 for every pod you flew past without touching
          popups.current?.banner(jump >= 4 ? `MEGA AIR ×${jump}` : `BIG AIR ×${jump}`, jump >= 4 ? '#f472b6' : '#38bdf8');
          addPoints(jump - 1, 'Big air', A.f, A.y + 1.2);
          feel.kick(0.25 + jump * 0.05);
          engine.flash(0.2);
        }
        if (streak > 0 && streak % 5 === 0) {
          addPoints(1, 'Streak', b.f, b.y + 1.4, `STREAK ×${streak} +1`);
          sound.playCombo(streak / 5);
        }
        target = Math.max(target, i + 1);
        ensureAhead(i);
        pushScore();
      };

      const bramblesNear = (): (Bramble | null | undefined)[] => [anchors[target - 2]?.bramble, anchors[target - 1]?.bramble, anchors[target]?.bramble];

      // ---------------- frame
      engine.addUpdate((rawDt, time) => {
        const st = stageAt(target);
        const realDt = Math.min(rawDt, 1 / 20);
        const dt = realDt * (playing ? st.speed * PACE : 1);
        stun = Math.max(0, stun - rawDt);
        t += dt;
        const sub = 4;
        const h = dt / sub;
        for (let k = 0; k < sub && !over; k++) {
          // let go = detach, keeping every bit of velocity
          if (playing && line && !holding && !firstHang) {
            const T0 = anchorPos(anchors[line.anchor], t);
            lastTip.set(0, T0.y, -T0.f);
            reel = 1;
            line = null;
            sound.playSwish();
            haptic('light');
          }
          const A = line ? anchorPos(anchors[line.anchor], t) : null;
          step(b, line, A, h);
          if (!playing) continue;
          // holding in the air: catch the nearest pod in reach (never through a bramble)
          if (!line && holding && stun <= 0) {
            const g = grabbable(b, anchors, target + 1, t, stageAt(target).reach);
            if (g >= target) onGrab(g);
          }
          // brambles: they knock you off and down
          const hit = bramblesNear().find((br) => br && !knocked.has(br) && hitsBramble(b, br));
          if (hit) {
            line = null;
            const away = Math.sign(b.f - hit.f) || -1;
            b.vf = away * 2.5;
            b.vy = Math.min(b.vy, -2) - 2;
            stun = 0.6;
            streak = 0;
            if (hit) knocked.add(hit); // (it can't hit you twice)
            particles.emit(tmpV.set(0, b.y, -b.f), 0xc23a3a, { count: 24, speed: 4, life: 0.6, gravity: 6 });
            popAtWorld(b.f, b.y + 1, 'OUCH!', { color: '#f87171', size: 'md' });
            sound.playLose();
            haptic('fail');
            feel.kick(0.6);
            pushScore();
          }
          // lily pads: a safe landing that bounces you back up
          if (!line && padBounce(b, anchors, target)) {
            particles.emit(tmpV.set(0, WATER_Y + 0.3, -b.f), 0xbff7ee, { count: 22, speed: 4, life: 0.6, gravity: 8 });
            popAtWorld(b.f, b.y + 1.2, 'BOUNCE!', { color: '#86efac', size: 'sm' });
            sound.playJump();
            haptic('big');
            feel.kick(0.3);
          }
          // berries
          for (let i = Math.max(0, target - 2); i <= target && i < anchors.length; i++) {
            for (const bb of objs[i]?.berries ?? []) {
              if (bb.taken || Math.min(Math.hypot(b.f - bb.f, b.y - bb.y), Math.hypot(b.f - bb.f, b.y - HAND_UP * 0.5 - bb.y)) > 0.7) continue;
              bb.taken = true;
              bb.mesh.visible = false;
              addPoints(1, 'Berries', bb.f, bb.y + 0.5);
              particles.emit(tmpV.set(0, bb.y, -bb.f), 0xff3d8b, { count: 16, speed: 3, life: 0.5, gravity: 3 });
              sound.playPowerup();
              haptic('light');
              pushScore();
            }
          }
          // the fire wall: too slow and it reaches you
          if (fireStep(fire, realDt / sub, st, podF, b.f)) {
            particles.emit(tmpV.set(0, b.y - 1, -b.f), 0xff7a1a, { count: 60, speed: 6, life: 1, gravity: -2 });
            finish('BURNED!');
            break;
          }
          countPassed();
          if (!line && b.f > anchors[target].f + 0.6) {
            target += 1;
            ensureAhead(target);
          }
          if (b.y < WATER_Y + 0.35) {
            particles.emit(tmpV.set(0, WATER_Y + 0.1, -b.f), 0xbff7ee, { count: 50, speed: 6, life: 1, gravity: 9 });
            finish('SPLASH!');
            break;
          }
        }

        // which vine tip would the hook hit right now? its target locks on
        const inReach = playing && !line && stun <= 0 ? grabbable(b, anchors, target + 1, t, stageAt(target).reach) : -1;
        for (let i = Math.max(0, target - BEHIND); i < anchors.length; i++) {
          const o = objs[i];
          if (!o) continue;
          const A = anchorPos(anchors[i], t);
          o.holder.position.y = A.y;
          const r = reticles[i];
          const isNext = i === target && playing;
          if (r) {
            const held = !!line && line.anchor === i;
            r.visible = !held && i >= target && i < target + 4;
            setReticle(r, i === inReach ? tgtLockMat : isNext ? tgtNextMat : tgtDimMat);
            // a locked target snaps tight and spins; the next one breathes
            r.scale.setScalar(i === inReach ? 0.8 + Math.sin(time * 14) * 0.05 : isNext ? 1.1 + Math.sin(time * 5) * 0.08 : 1);
            r.rotation.x = i === inReach ? time * 3 : 0;
          }
          o.knot.scale.setScalar(i === inReach ? 1.5 : isNext ? 1.2 + Math.sin(time * 6) * 0.1 : 1);
          if (o.bramble) o.bramble.rotation.x += rawDt * 0.6;
          for (const bb of o.berries) if (!bb.taken) bb.mesh.position.y = bb.y + Math.sin(time * 3 + bb.f) * 0.06;
        }

        // ---- you: the body leans with the rope, or with your flight
        body.position.set(0, b.y, -b.f);
        me.updateAnimation(time, 'idle', dt);
        if (line) {
          const A = anchorPos(anchors[line.anchor], t);
          const ang = ropeAngle(b, A);
          body.rotation.x = ang;
          me.leftArm.rotation.x = me.rightArm.rotation.x = -Math.PI;
          me.leftArm.rotation.z = -0.1;
          me.rightArm.rotation.z = 0.1;
          const kick = -b.vf * 0.05;
          me.leftLeg.rotation.x = kick + 0.12;
          me.rightLeg.rotation.x = kick - 0.08;
        } else {
          const tilt = stun > 0 ? body.rotation.x + rawDt * 8 : THREE.MathUtils.clamp(-b.vy * 0.035, -0.45, 0.45);
          body.rotation.x += (tilt - body.rotation.x) * Math.min(1, dt * 8);
          me.leftArm.rotation.x = -2.4;
          me.rightArm.rotation.x = inReach >= 0 ? -2.9 : -2.5;
          me.leftLeg.rotation.x = -0.9;
          me.rightLeg.rotation.x = -0.5;
        }

        // ---- the hook gun: aim at the rope (or the target), fire the hook, reel it back on release
        const hand = tmpA.set(0.12, b.y + 0.05, -b.f);
        let aimF = b.vf >= 0 ? 1 : -1;
        let aimY = 0.6;
        const aimAt = line ? anchorPos(anchors[line.anchor], t) : inReach >= 0 ? anchorPos(anchors[inReach], t) : null;
        if (aimAt) {
          aimF = aimAt.f - b.f;
          aimY = aimAt.y - b.y;
        }
        gun.position.copy(hand);
        gun.lookAt(tmpB.set(hand.x, hand.y + aimY, hand.z - aimF));
        gun.rotateY(Math.PI); // the barrel points down local -z
        gun.updateMatrixWorld();
        const muzzleAt = tmpV.set(0, 0, -0.42).applyMatrix4(gun.matrixWorld);
        if (line) {
          const A = anchorPos(anchors[line.anchor], t);
          whip = Math.min(1, whip + rawDt * 12);
          const tipAt = tmpB.set(0, A.y, -A.f);
          const hookAt = new THREE.Vector3().lerpVectors(muzzleAt, tipAt, whip);
          rope.visible = hook.visible = true;
          span(rope, muzzleAt, hookAt);
          rope.scale.x = rope.scale.z = 0.022;
          hook.position.copy(hookAt);
          hook.quaternion.setFromUnitVectors(UP, hookAt.clone().sub(muzzleAt).normalize());
          spool.rotation.x += rawDt * (whip < 1 ? 60 : 0);
        } else if (reel > 0) {
          reel = Math.max(0, reel - rawDt * 7);
          const hookAt = new THREE.Vector3().lerpVectors(muzzleAt, lastTip, reel);
          rope.visible = hook.visible = reel > 0.02;
          span(rope, muzzleAt, hookAt);
          rope.scale.x = rope.scale.z = 0.018;
          hook.position.copy(hookAt);
          spool.rotation.x -= rawDt * 60;
        } else {
          rope.visible = hook.visible = false;
        }
        // laser sight on the tip you'd hit
        if (!line && inReach >= 0) {
          const A = anchorPos(anchors[inReach], t);
          laser.visible = true;
          span(laser, muzzleAt, tmpB.set(0, A.y, -A.f));
          laser.scale.x = laser.scale.z = 0.008;
        } else laser.visible = false;

        // ---- the fire wall
        pushHud({ fire: !playing ? 0 : fire.front !== null ? 2 : fire.heat > st.fire - 1 ? 1 : 0 });
        // (the edge is always drawn at least just inside the left of the screen, so you see it coming)
        const camLeft = -camFocus.z - (2 * camDist * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * camera.aspect) / 2;
        if (fire.front !== null) {
          fireFront = Math.max(fire.front, camLeft + 2.6);
          fireVis = Math.min(1, fireVis + rawDt * 4);
          const gapToYou = b.f - fireFront;
          if (playing && gapToYou < 3) {
            feel.kick(0.05 * (3 - gapToYou));
            if (Math.floor(time * 6) !== Math.floor((time - rawDt) * 6)) haptic('tap');
          }
          if (Math.random() < rawDt * 30) particles.emit(tmpV.set(1.5, 2 + Math.random() * 14, -fireFront), 0xffa040, { count: 3, speed: 2.5, life: 0.7, gravity: -3 });
        } else if (fireVis > 0) {
          fireFront -= rawDt * 16; // dies back to the left
          fireVis = Math.max(0, fireVis - rawDt * 2.5);
        }
        for (const [sh, mat, sp] of [[fireSheet, fireMat, 0.6], [fireSheet2, fireMat2, -0.45]] as const) {
          sh.visible = fireVis > 0.01;
          mat.opacity = fireVis * (sh === fireSheet ? 0.95 : 0.7) * (0.92 + Math.sin(time * 17 + sp) * 0.08);
          sh.position.set(sh.position.x, 10, -fireFront + FIRE_W / 2 + (sh === fireSheet2 ? 0.8 : 0));
          mat.map!.offset.y -= rawDt * sp;
        }
        fireLight.intensity = fireVis * (40 + Math.sin(time * 23) * 8);
        fireLight.position.set(3, 7, -fireFront + 0.5);

        // first pods: show when to let go, and when to hold
        const canRelease = playing && !!line && !!anchors[target] && !!releaseWorks(b, anchors[target], st.reach, t, anchors[target - 1]?.bramble);
        if (passed < 2 && Math.floor(time * 4) % 4 === 0) {
          const p = engine.toScreen(tmpV.set(0, b.y + 1, -b.f));
          if (canRelease && holding) popups.current?.pop('LET GO!', p.x, p.y, { color: '#fde047', size: 'sm' });
          else if (inReach >= 0 && !holding) popups.current?.pop('HOLD — FIRE!', p.x, p.y, { color: '#86efac', size: 'sm' });
        }
        // (read by automated play-tests)
        engine.renderer.domElement.dataset.shot = !playing ? 'none' : line ? (canRelease ? 'release' : 'hang') : inReach >= 0 ? 'reach' : 'fly';

        // ---- camera: glide left → right with the swing, keeping you ~30% from the left
        const T = anchorPos(anchors[Math.min(target, anchors.length - 1)], t);
        const aspect = camera.aspect;
        const viewW = 2 * camDist * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * aspect;
        const lead = THREE.MathUtils.clamp(T.f - b.f, 0, viewW * 0.6) * 0.5 + viewW * 0.06;
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
        api.current = { press: () => {}, lift: () => {}, start: () => {} };
      };
    },
    [stableAvatar],
  );

  const stage = STAGES[hud.stage] ?? STAGES[0];
  const chips = (
    <>
      <span className="px-2 py-0.5 rounded-full bg-black/50 text-[11px] font-black" style={{ color: stage.color }} data-testid="swing-stage">
        {stage.name}
      </span>
      {hud.streak >= 2 && (
        <span className="px-2 py-0.5 rounded-full bg-cyan-400 text-black text-[11px] font-black" data-testid="swing-streak">
          ×{hud.streak}
        </span>
      )}
      {hud.fire > 0 && (
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-black animate-pulse ${hud.fire === 2 ? 'bg-orange-500 text-black' : 'bg-black/60 text-orange-300'}`} data-testid="swing-fire">
          {hud.fire === 2 ? '🔥 FIRE — JUMP!' : 'MOVE!'}
        </span>
      )}
      {hud.best > 0 && (
        <span className="px-2 py-0.5 rounded-full bg-black/50 text-amber-200 text-[11px] font-black" data-testid="swing-best">
          BEST {hud.best}
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
      hint="Hold to fire the hook · let go to fly · keep moving — fire is coming"
      guide={{
        goal: 'Hook vine to vine across the river, left to right. Outrun the fire. Don’t fall in.',
        controls: [
          { gesture: 'drag', label: 'Hold anywhere: the hook gun fires at the vine tip in reach (green target)' },
          { gesture: 'release', label: 'Let go to fly — you keep all your speed' },
          { gesture: 'timing', label: 'Let go on the upswing to fly over 2, 3 or more vines' },
          { gesture: 'avoid', label: 'Hang around and a fire wall comes from the left — hook a new vine to escape it' },
        ],
        points: [
          { label: 'Every vine you pass', value: '1' },
          { label: 'Berry', value: '+1', tone: 'bonus' },
          { label: 'Each vine skipped in one jump', value: '+1', tone: 'gold' },
          { label: 'Every 5 catches in a row', value: '+1', tone: 'fire' },
        ],
        ends: 'Slow → Middle → Final → Crazy · the fire or one splash ends the run',
      }}
      tutorial={[
        { icon: <Hand className="w-6 h-6" />, label: 'Hold = fire hook' },
        { icon: <Crosshair className="w-6 h-6" />, label: 'Let go = fly far' },
        { icon: <Flame className="w-6 h-6" />, label: 'Outrun the fire' },
      ]}
      scoring="You carry a hook gun. Hold anywhere on the screen and it fires a hook on a rope at the tip of the nearest vine in reach — the target at the bottom of that vine turns green — and you swing on it for as long as you hold. Let go to fly off with all the speed you had: gravity speeds you up on the way down, and letting go on the upswing carries you over two, three or more vines. Don’t hang around: after a few seconds without a new catch a wall of fire sweeps in from the left. Hook a new vine before it reaches you and it dies back; if it touches you, the run is over. The hook can’t pass through brambles, and touching one knocks you down; lily pads on the water bounce you back up. 1 point for every vine you pass, +1 per berry, +1 for every vine you skip in one flight, +1 for every 5 catches in a row. One splash ends the run too. Stages: Slow, Middle, Final, Crazy. Same jungle for every player; your best is saved on this device."
    />
  );
}
