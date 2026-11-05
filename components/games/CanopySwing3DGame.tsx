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
import {
  WATER_Y,
  Vine,
  SwingState,
  Hang,
  canCatch,
  flightPath,
  grab,
  handPos,
  nextVine,
  release,
  stepFly,
  stepHang,
  swingK,
  vineAngle,
} from '@/lib/swing-physics';
import GameShell, { PopupApi, useSwipe } from './GameShell';
import { Pointer, Timer, Banana } from 'lucide-react';

/**
 * CANOPY SWING — side-on (left → right) vine swinging through a jungle canopy above a river.
 * You see your own 3D avatar hanging from the vine; the camera leads ahead so the next gap is in view.
 * Tap to let go on the forward swing; you catch the next vine automatically if you're close.
 * Endless: one fall into the river ends the run. Every gap is generated with a proven release
 * window (lib/swing-physics), wide at first and tighter the deeper you go; later vines sway.
 *
 * Scoring (shared rules): 1 per vine · perfect release +1 · banana +1 · golden idol 3 ·
 * sunstone 5 · 5 perfect releases in a row = ON FIRE ×2.
 */

/** Your avatar's hands, arms straight up, sit this high above its feet. */
const HAND_UP = 1.87;
/** World metres of the course kept in view across a portrait phone / up a landscape screen. */
const VIEW_W = 7.6;
const VIEW_H = 8.5;
const FOV = 45;
const AHEAD = 7; // vines generated ahead of the current one
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

/** Bark: vertical fissures over warm browns. */
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
  // moss
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

/** River: soft ripples + foam streaks. */
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

export default function CanopySwing3DGame({ avatar, onFinish, seed, rival, match, onExit }: GameProps) {
  const stableAvatar = useStructuralMemo(avatar);
  const onFinishRef = useLatest(onFinish);
  const seedRef = useLatest(seed);
  const popups = useRef<PopupApi | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, vines: 0, streak: 0 });
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
      fog: { color: 0x5f9a7c, density: 0.016 },
      camera: { fov: FOV, near: 0.5, far: 220, position: [24, 8, 0], lookAt: [0, 7, 0] },
      exposure: 1.2,
      bloom: { strength: 0.35, radius: 0.4, threshold: 0.92 },
      environment: 0.45,
      studio: { top: 0x3b6b4a, left: 0xffd27a, right: 0x46b38a },
      grade: { saturation: 1.12, vignette: 0.35 },
    },
    (engine) => {
      const { scene, camera, quality } = engine;
      const feel = new CameraFeel();
      // Side camera: back off far enough that VIEW_W metres fit across a portrait phone and
      // VIEW_H metres fit up a landscape screen.
      let camDist = 24;
      engine.onResize((_w, _h, aspect) => {
        camera.fov = FOV;
        camera.updateProjectionMatrix();
        const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
        camDist = Math.max(VIEW_H / (2 * tan), VIEW_W / (2 * tan * aspect));
      });

      // ---------------- lights: warm sun through the canopy, cool fill from the river
      const hemi = new THREE.HemisphereLight(0xe6f5d8, 0x1d5a4a, 1.6);
      const sun = new THREE.DirectionalLight(0xffe2a8, 2.6);
      sun.position.set(6, 24, 6);
      engine.configureShadows(sun, 12);
      scene.add(hemi, sun, sun.target);

      // ---------------- shared assets
      const bark = engine.own(barkTexture());
      bark.repeat.set(1, 4);
      const barkMat = engine.own(new THREE.MeshStandardMaterial({ map: bark, roughness: 0.95, metalness: 0 }));
      const leafMats = [0x2f7d3a, 0x3f9a45, 0x25663a, 0x4fae52].map((c) => engine.own(new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0, flatShading: true })));
      const vineMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x5c7a2e, roughness: 0.9, metalness: 0 }));
      const knotMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x7a5a2e, roughness: 0.85, metalness: 0 }));
      // The next vine's grip knot glows so you always know your target.
      const knotGlowMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xffd27a, roughness: 0.5, metalness: 0, emissive: 0xffc860, emissiveIntensity: 0.8 }));
      const vineLeafMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.7, side: THREE.DoubleSide }));
      const trunkGeo = engine.own(new THREE.CylinderGeometry(0.32, 0.48, 26, 12, 1));
      const branchGeo = engine.own(new THREE.CylinderGeometry(0.12, 0.2, 1, 8));
      const canopyGeo = engine.own(new THREE.IcosahedronGeometry(1.6, 1));
      const ropeGeo = engine.own(new THREE.CylinderGeometry(0.035, 0.04, 1, 6));
      ropeGeo.translate(0, -0.5, 0); // pivot at the top
      const knotGeo = engine.own(new THREE.SphereGeometry(0.09, 10, 8));
      const leafGeo = engine.own(new THREE.PlaneGeometry(0.22, 0.12));

      // River + banks
      const water = engine.own(waterTexture());
      const river = new THREE.Mesh(new THREE.PlaneGeometry(40, 400), new THREE.MeshStandardMaterial({ map: water, roughness: 0.15, metalness: 0.35, color: 0xbfffee }));
      river.rotation.x = -Math.PI / 2;
      river.position.set(0, WATER_Y, -180);
      river.receiveShadow = quality.shadows;
      scene.add(river);
      const bankMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x1f4a2a, roughness: 1, flatShading: true }));
      const bank = new THREE.Mesh(new THREE.BoxGeometry(30, 2.5, 400), bankMat);
      bank.position.set(-22, 0.6, -180);
      scene.add(bank);

      // Distant jungle walls (instanced trunks) + canopy roof, so the world feels enclosed.
      const farCount = Math.round(110 * quality.propDensity);
      const farTrunks = new THREE.InstancedMesh(trunkGeo, barkMat, farCount);
      const farLeaves = new THREE.InstancedMesh(canopyGeo, leafMats[2], farCount);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      const pv = new THREE.Vector3();
      const farRng = mulberry32(7);
      const farZ: number[] = [];
      for (let i = 0; i < farCount; i++) {
        // Background jungle only (the camera looks in from +x).
        const x = -(7 + farRng() * 24);
        const z = -farRng() * 200;
        farZ.push(z);
        sc.set(0.8 + farRng() * 0.8, 1, 0.8 + farRng() * 0.8);
        m4.compose(pv.set(x, 11, z), q.identity(), sc);
        farTrunks.setMatrixAt(i, m4);
        sc.setScalar(2.2 + farRng() * 2);
        m4.compose(pv.set(x, 20 + farRng() * 4, z), q.setFromEuler(new THREE.Euler(farRng(), farRng(), 0)), sc);
        farLeaves.setMatrixAt(i, m4);
      }
      const world = new THREE.Group(); // everything that scrolls with the course
      world.add(farTrunks, farLeaves);
      scene.add(world);

      // Sun shafts through the canopy
      const shaftMat = engine.own(new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      const shaftGeo = engine.own(new THREE.PlaneGeometry(2.2, 30));
      const shafts: THREE.Mesh[] = [];
      for (let i = 0; i < 8; i++) {
        const sh = new THREE.Mesh(shaftGeo, shaftMat);
        sh.rotation.set(0, Math.random() * Math.PI, 0.35);
        sh.position.set((Math.random() - 0.5) * 10, 10, -i * 9);
        shafts.push(sh);
        scene.add(sh);
      }

      // Fireflies / drifting pollen
      const flyN = Math.round(160 * quality.propDensity);
      const flyGeo = new THREE.BufferGeometry();
      const flyPos = new Float32Array(flyN * 3);
      const flySeed = Array.from({ length: flyN }, () => [Math.random() * 16 - 8, 2 + Math.random() * 14, -Math.random() * 60, Math.random() * 6]);
      flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
      const flies = new THREE.Points(flyGeo, new THREE.PointsMaterial({ color: 0xfff2a8, size: 0.07, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      flies.frustumCulled = false;
      engine.own(flyGeo);
      engine.own(flies.material as THREE.Material);
      scene.add(flies);

      const particles = new ParticleBursts(engine);

      // Fruit
      const bananaGeo = engine.own(new THREE.TorusGeometry(0.16, 0.055, 8, 16, Math.PI * 0.9));
      const bananaMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xffd93b, roughness: 0.45, emissive: 0x8a6a00, emissiveIntensity: 0.35 }));
      const idolGeo = engine.own(new THREE.OctahedronGeometry(0.22, 0));
      const idolMat = engine.own(new THREE.MeshPhysicalMaterial({ color: 0xffc83a, metalness: 1, roughness: 0.18, emissive: 0xffa600, emissiveIntensity: 0.6, clearcoat: 1 }));
      const sunGeo = engine.own(new THREE.IcosahedronGeometry(0.26, 1));
      const sunMat = engine.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a2a).multiplyScalar(2.2), toneMapped: false }));

      // ---------------- course
      let rng = mulberry32(1);
      let vines: Vine[] = [];
      const vineObjs: { pivot: THREE.Group; tree: THREE.Group; knot: THREE.Mesh }[] = [];
      let fruit: Fruit[] = [];
      let t = 0;

      const buildVineObj = (v: Vine, i: number) => {
        const tree = new THREE.Group();
        // Trunks stand behind the path so nothing blocks your view of the swing.
        const tx = -(3.6 + (i % 3) * 0.7);
        const trunk = new THREE.Mesh(trunkGeo, barkMat);
        trunk.position.set(tx, 9, -v.f - 0.4);
        trunk.castShadow = quality.shadows;
        // branch reaching over the river to the anchor
        const bLen = Math.hypot(tx, 1.2);
        const branch = new THREE.Mesh(branchGeo, barkMat);
        const from = new THREE.Vector3(tx, v.y + 0.7, -v.f - 0.3);
        const to = new THREE.Vector3(0, v.y + 0.05, -v.f);
        branch.scale.set(1, from.distanceTo(to) + 0.3, 1);
        branch.position.copy(from).lerp(to, 0.5);
        branch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
        branch.castShadow = quality.shadows;
        const crown = new THREE.Group();
        for (let k = 0; k < 4; k++) {
          const leaf = new THREE.Mesh(canopyGeo, leafMats[(i + k) % leafMats.length]);
          leaf.position.set(tx * (0.4 + k * 0.2) + (k - 1.5) * 0.6, v.y + 1.4 + (k % 2) * 0.8, -v.f + (k - 1.5) * 0.9);
          leaf.scale.setScalar(0.7 + ((i * 7 + k * 3) % 5) * 0.12);
          leaf.rotation.set(k, i, 0);
          leaf.castShadow = quality.shadows;
          crown.add(leaf);
        }
        tree.add(trunk, branch, crown);
        world.add(tree);
        // the vine itself: rope pivoting at the anchor, a grip knot and a few leaves
        const pivot = new THREE.Group();
        pivot.position.set(0, v.y, -v.f);
        const rope = new THREE.Mesh(ropeGeo, vineMat);
        rope.scale.y = v.len;
        rope.castShadow = quality.shadows;
        const knot = new THREE.Mesh(knotGeo, knotMat);
        knot.position.y = -v.len;
        pivot.add(rope, knot);
        for (let k = 0; k < 5; k++) {
          const lf = new THREE.Mesh(leafGeo, vineLeafMat);
          lf.position.set(0.05 * (k % 2 ? 1 : -1), -v.len * (0.15 + k * 0.17), 0);
          lf.rotation.set(0.4, k * 1.3, 0.6 * (k % 2 ? 1 : -1));
          pivot.add(lf);
        }
        world.add(pivot);
        vineObjs[i] = { pivot, tree, knot };
      };

      const placeFruit = (from: Vine, i: number) => {
        // Fruit hangs along the ideal line (middle of the release window), so clean swings collect it.
        const mid = (from.window[0] + from.window[1]) / 2;
        if (from.window[1] - from.window[0] < 0.05) return;
        const path = flightPath(from, mid, 40, 1 / 30);
        const kinds: FruitKind[] = [];
        if (i > 0 && i % 25 === 0) kinds.push('sunstone');
        else if (i > 3 && rng() < 0.16) kinds.push('idol');
        else {
          const n = rng() < 0.55 ? 1 + Math.floor(rng() * 3) : 0;
          for (let k = 0; k < n; k++) kinds.push('banana');
        }
        kinds.forEach((kind, k) => {
          const p = path[Math.min(path.length - 1, 6 + k * 4)];
          const mesh = kind === 'banana' ? new THREE.Mesh(bananaGeo, bananaMat) : kind === 'idol' ? new THREE.Mesh(idolGeo, idolMat) : new THREE.Mesh(sunGeo, sunMat);
          mesh.position.set(0, p.y + 0.35, -p.f);
          world.add(mesh);
          fruit.push({ kind, f: p.f, y: p.y + 0.35, taken: false, mesh });
        });
      };

      const ensureAhead = (cur: number) => {
        while (vines.length < cur + AHEAD) {
          const i = vines.length;
          const prev = vines[i - 1];
          const v = nextVine(prev, swingK(i), rng, i);
          vines.push(v);
          placeFruit(prev, i - 1);
          buildVineObj(v, i);
        }
        // drop old scenery
        for (let i = 0; i < cur - BEHIND; i++) {
          const o = vineObjs[i];
          if (o) {
            world.remove(o.pivot, o.tree);
            delete vineObjs[i];
          }
        }
        fruit = fruit.filter((fr) => {
          if (fr.f < (vines[cur]?.f ?? 0) - 8) {
            world.remove(fr.mesh);
            return false;
          }
          return true;
        });
      };

      // ---------------- player
      // You: your own 3D avatar, hanging by both hands from a pivot at the grip.
      const me = create3DAvatar(stableAvatar);
      const body = new THREE.Group();
      me.group.position.y = -HAND_UP;
      me.group.rotation.y = Math.PI - 0.75; // facing the way you travel, turned toward the camera
      me.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = quality.shadows;
      });
      body.add(me.group);
      scene.add(body);
      // Release cue: a ring round your hands — amber in the window, bright gold in the perfect zone.
      const cueMat = new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
      const cue = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 40), cueMat);
      cue.rotation.y = Math.PI / 2;
      engine.own(cue.geometry);
      engine.own(cueMat);
      scene.add(cue);
      let state: SwingState = { kind: 'hang', vine: 0, L: 3.4, theta: -0.6, omega: 0 };
      let playing = false;
      let over = false;
      let streak = 0;
      let bestStreak = 0;
      let caught = 0;
      let book = new ScoreBook();
      let lastRelease = { perfect: false, inWindow: false };
      const camFocus = new THREE.Vector3(0, 6, -2);
      const tmpV = new THREE.Vector3();

      const clearWorld = () => {
        vineObjs.forEach((o) => o && world.remove(o.pivot, o.tree));
        vineObjs.length = 0;
        fruit.forEach((fr) => world.remove(fr.mesh));
        fruit = [];
      };

      const reset = () => {
        clearWorld();
        rng = mulberry32(seedRef.current ?? randomSeed());
        vines = [{ f: 0, y: 10, len: 3.4, sway: 0, speed: 1.6, phase: 0, window: [0, 0] }];
        buildVineObj(vines[0], 0);
        ensureAhead(0);
        state = { kind: 'hang', vine: 0, L: 3.4, theta: -0.4, omega: 0.6 };
        streak = bestStreak = caught = 0;
        book = new ScoreBook();
        over = false;
        particles.clear();
      };
      reset();

      const pushScore = () => pushHud({ score: book.score, vines: caught, streak }, true);

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
        if (!playing || state.kind !== 'hang') return;
        const v = vines[state.vine];
        const s = state;
        // Only a forward swing launches you onward; tapping on the back-swing is ignored.
        if (s.omega <= 0.2) return;
        const [w0, w1] = v.window;
        const span = w1 - w0;
        const inWindow = s.theta >= w0 && s.theta <= w1;
        const perfect = inWindow && Math.abs(s.theta - (w0 + w1) / 2) <= span * 0.2;
        lastRelease = { perfect, inWindow };
        state = release(v, s, s.vine);
        sound.playJump();
        haptic('light');
        feel.kick(0.15);
      };

      const finish = () => {
        playing = false;
        over = true;
        sound.stopMusic(0.4);
        sound.playLose();
        haptic('fail');
        engine.flash(0.4);
        popups.current?.banner(`SPLASH! · ${caught} VINES`, '#5eead4');
        pushScore();
        setPhase('over');
        setTimeout(() => onFinishRef.current(book.score, { vines: caught, maxCombo: bestStreak, distance: Math.round(vines[Math.max(0, caught)]?.f ?? 0), breakdown: book.breakdown() }), 1200);
      };

      const onCatch = (vi: number) => {
        caught += 1;
        const perfect = lastRelease.perfect;
        streak = perfect ? streak + 1 : 0;
        bestStreak = Math.max(bestStreak, streak);
        const parts: Record<string, number> = { 'Vines caught': PTS.base };
        if (perfect) parts['Perfect releases'] = PTS.bonus;
        const a = award(parts['Perfect releases'] ? 2 : 1, { streak });
        book.record(a, parts);
        const v = vines[vi];
        const kp = { f: v.f, y: v.y - v.len };
        popAtWorld(kp.f, kp.y + 0.6, `+${a.total}`, popStyle(a.total, perfect ? 'bonus' : undefined));
        if (perfect) popAtWorld(kp.f, kp.y + 0.15, 'PERFECT', { color: '#fde047', size: 'sm' });
        if (streak === FIRE_STREAK) popups.current?.banner('ON FIRE ×2', '#f43f5e');
        if (caught % 10 === 0) popups.current?.banner(`${caught} VINES!`, '#86efac');
        sound.playScore(1 + Math.min(1, streak * 0.08));
        haptic(perfect ? 'score' : 'light');
        feel.kick(perfect ? 0.35 : 0.2);
        engine.flash(perfect ? 0.3 : 0.15);
        particles.emit(tmpV.set(0, kp.y, -kp.f), 0x9be15d, { count: perfect ? 22 : 12, speed: 3, life: 0.6, gravity: 5 });
        ensureAhead(vi);
        pushScore();
      };

      const collectFruit = (f: number, y: number) => {
        for (const fr of fruit) {
          if (fr.taken || Math.hypot(fr.f - f, fr.y - (y - 0.3)) > 0.75) continue;
          fr.taken = true;
          fr.mesh.visible = false;
          const value = fr.kind === 'banana' ? PTS.base : fr.kind === 'idol' ? PTS.gold : PTS.jackpot;
          const label = fr.kind === 'banana' ? 'Bananas' : fr.kind === 'idol' ? 'Golden idols' : 'Sunstones';
          const a = award(value, { streak });
          book.record(a, { [label]: value });
          popAtWorld(fr.f, fr.y + 0.3, `+${a.total}`, popStyle(a.total, fr.kind === 'idol' ? 'gold' : fr.kind === 'sunstone' ? 'jackpot' : undefined));
          if (fr.kind !== 'banana') popups.current?.banner(fr.kind === 'idol' ? 'GOLDEN IDOL +3' : 'SUNSTONE +5', fr.kind === 'idol' ? '#fbbf24' : '#fb923c');
          particles.emit(tmpV.set(0, fr.y, -fr.f), fr.kind === 'banana' ? 0xffe14d : fr.kind === 'idol' ? 0xffc83a : 0xff7a2a, { count: fr.kind === 'banana' ? 10 : 26, speed: 3.5, life: 0.6 });
          sound.playPowerup();
          haptic('score');
          pushScore();
        }
      };

      // ---------------- frame
      engine.addUpdate((dt, time) => {
        t += dt;
        const sub = 4;
        const h = dt / sub;
        for (let k = 0; k < sub; k++) {
          if (state.kind === 'hang') {
            const v = vines[state.vine];
            stepHang(state, h, v.len);
          } else if (playing) {
            const fl = state;
            stepFly(fl, h);
            collectFruit(fl.f, fl.y);
            for (let vi = fl.from + 1; vi <= Math.min(vines.length - 1, fl.from + 2); vi++) {
              const v = vines[vi];
              if (canCatch(v, t, fl.f, fl.y, swingK(vi))) {
                state = grab(v, vi, fl.f, fl.y, fl.vf, fl.vy);
                onCatch(vi);
                break;
              }
            }
            if (state.kind === 'fly' && state.y < WATER_Y + 0.4) {
              particles.emit(tmpV.set(0, WATER_Y + 0.1, -state.f), 0xbff7ee, { count: 50, speed: 6, life: 1, gravity: 9 });
              finish();
              break;
            }
          }
        }

        // vines sway (late game) and the one you hold follows your swing
        const curI = state.kind === 'hang' ? state.vine : state.from;
        for (let i = Math.max(0, curI - BEHIND); i < vines.length; i++) {
          const o = vineObjs[i];
          if (!o) continue;
          const held = state.kind === 'hang' && state.vine === i;
          o.pivot.rotation.x = held ? (state as Hang).theta : vineAngle(vines[i], t);
          const rope = o.pivot.children[0];
          const len = held ? (state as Hang).L : vines[i].len;
          rope.scale.y = len;
          o.knot.position.y = -len;
          o.knot.material = i === curI + 1 ? knotGlowMat : knotMat;
          o.knot.scale.setScalar(i === curI + 1 ? 1.25 + Math.sin(time * 6) * 0.15 : 1);
        }
        fruit.forEach((fr, k) => {
          fr.mesh.rotation.y += dt * 2.2;
          fr.mesh.position.y = fr.y + Math.sin(time * 2.5 + k) * 0.06;
        });

        // ---- you on the vine
        let hand: { f: number; y: number };
        if (state.kind === 'hang') hand = handPos(vines[state.vine], state);
        else hand = { f: state.f, y: state.y };
        body.position.set(0, hand.y, -hand.f);
        me.updateAnimation(time, 'idle', dt);
        if (state.kind === 'hang') {
          body.rotation.x = state.theta; // hang along the rope
          me.leftArm.rotation.x = me.rightArm.rotation.x = -Math.PI;
          me.leftArm.rotation.z = -0.12;
          me.rightArm.rotation.z = 0.12;
          // legs trail the swing a little
          const kick = -state.omega * 0.18;
          me.leftLeg.rotation.x = kick + 0.12;
          me.rightLeg.rotation.x = kick - 0.08;
        } else {
          // flying: lean into the jump, reach for the next vine, knees tucked
          body.rotation.x += (THREE.MathUtils.clamp(-state.vy * 0.04, -0.4, 0.4) - body.rotation.x) * Math.min(1, dt * 8);
          me.leftArm.rotation.x = -2.6;
          me.rightArm.rotation.x = -2.9;
          me.leftLeg.rotation.x = -0.9;
          me.rightLeg.rotation.x = -0.5;
        }

        // ---- side camera: travel runs left → right; keep you ~30% from the left edge
        const nextI = state.kind === 'hang' ? state.vine + 1 : state.from + 1;
        const nv = vines[Math.min(vines.length - 1, nextI)];
        const aspect = camera.aspect;
        const viewW = 2 * camDist * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * aspect;
        const lead = THREE.MathUtils.clamp(nv.f - hand.f, 0, viewW * 0.55) * 0.5 + viewW * 0.08;
        camFocus.lerp(tmpV.set(0, THREE.MathUtils.lerp(5.4, hand.y - 1.2, 0.45), -(hand.f + lead)), 1 - Math.exp(-dt * 4));
        const off = feel.update(dt, time, 0);
        camera.position.set(camDist, camFocus.y + 1.2 + off.y, camFocus.z + off.x);
        camera.lookAt(camFocus);

        // world details that follow the view
        sun.position.set(10, 24, camFocus.z + 6);
        sun.target.position.set(0, 8, camFocus.z);
        river.position.z = camFocus.z - 150;
        (river.material as THREE.MeshStandardMaterial).map!.offset.y += dt * 0.05;
        const zNow = camFocus.z + 10;
        if (Math.abs(zNow - farTrunks.position.z) > 100) {
          farTrunks.position.z = farLeaves.position.z = Math.round(zNow / 100) * 100;
        }
        shafts.forEach((sh, i) => {
          if (sh.position.z > zNow + 6) sh.position.z -= 72;
          sh.rotation.y += dt * 0.02 * (i % 2 ? 1 : -1);
        });
        for (let i = 0; i < flyN; i++) {
          const sd = flySeed[i];
          let z = sd[2] + zNow;
          z = zNow - (((zNow - z) % 60) + 60) % 60;
          flyPos[i * 3] = sd[0] - 4 + Math.sin(time * 0.7 + sd[3]) * 0.5;
          flyPos[i * 3 + 1] = sd[1] + Math.sin(time * 1.1 + sd[3] * 2) * 0.3;
          flyPos[i * 3 + 2] = z;
        }
        flyGeo.attributes.position.needsUpdate = true;

        // ---- release cue round your hands
        cue.position.set(0.3, hand.y, -hand.f);
        if (state.kind === 'hang') {
          const v = vines[state.vine];
          const [w0, w1] = v.window;
          const forward = state.omega > 0.2;
          const inW = forward && state.theta >= w0 && state.theta <= w1;
          const perf = inW && Math.abs(state.theta - (w0 + w1) / 2) <= (w1 - w0) * 0.2;
          cueMat.color.setHex(perf ? 0xfff1a8 : 0xf59e0b).multiplyScalar(perf ? 2.2 : 1.3);
          cueMat.opacity += ((playing && inW ? (perf ? 1 : 0.55) : 0) - cueMat.opacity) * Math.min(1, dt * 20);
          cue.scale.setScalar(perf ? 1.15 + Math.sin(time * 18) * 0.06 : 1);
          // (read by automated play-tests)
          engine.renderer.domElement.dataset.release = perf ? 'perfect' : inW ? 'window' : 'none';
          // first few vines: a TAP cue in the window
          if (playing && caught < 3 && perf && Math.floor(time * 4) % 4 === 0) {
            const p = engine.toScreen(tmpV.set(0, hand.y + 0.9, -hand.f));
            popups.current?.pop('TAP!', p.x, p.y, { color: '#fde047', size: 'sm' });
          }
        } else {
          cueMat.opacity = Math.max(0, cueMat.opacity - dt * 6);
          engine.renderer.domElement.dataset.release = 'flying';
        }

        if (!playing && !over && state.kind === 'hang') {
          // menu: keep a gentle swing going
          if (Math.abs(state.theta) < 0.05 && Math.abs(state.omega) < 0.2) state.omega = 1.2;
        }
      });

      return () => {
        me.dispose();
        api.current = { tap: () => {}, start: () => {} };
      };
    },
    [stableAvatar],
  );

  const fire = onFire(hud.streak);
  const chips = (
    <>
      <span className="px-2 py-0.5 rounded-full bg-black/50 text-emerald-300 text-[11px] font-black tabular-nums" data-testid="swing-vines">
        {hud.vines} vines
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
      hint="Tap to let go on the forward swing"
      guide={{
        goal: 'Swing from vine to vine — don’t fall in the river.',
        controls: [
          { gesture: 'tap', label: 'Tap to let go' },
          { gesture: 'timing', label: 'Let go when the ring glows gold' },
          { gesture: 'auto', label: 'You grab the next vine yourself' },
        ],
        points: [
          { label: 'Vine', value: '1' },
          { label: 'Perfect release', value: '+1', tone: 'bonus' },
          { label: 'Banana', value: '1' },
          { label: 'Golden idol', value: '3', tone: 'gold' },
          { label: 'Sunstone', value: '5', tone: 'jackpot' },
          { label: '5 perfect', value: '×2', tone: 'fire' },
        ],
        ends: 'Endless · one splash ends the run · gaps widen as you go',
      }}
      tutorial={[
        { icon: <Pointer className="w-6 h-6" />, label: 'Tap to let go' },
        { icon: <Timer className="w-6 h-6" />, label: 'Let go when the ring glows' },
        { icon: <Banana className="w-6 h-6" />, label: 'Grab fruit mid-air' },
      ]}
      scoring="Endless — one fall into the river ends the run. Every vine is 1 point. Perfect release +1 · Banana +1 · Golden idol 3 · Sunstone 5 · 5 perfect releases in a row = ON FIRE ×2. Gaps widen and vines start swaying the deeper you go. Same jungle for every player."
    />
  );
}
