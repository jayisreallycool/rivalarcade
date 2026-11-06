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
import { Anchor, Body, FIRST_ANCHOR, ROPE, Rope, SPIN_OUT_TURNS, STAGES, WATER_Y, anchorPos, grab, grabbable, nextAnchor, releaseWorks, ropeAngle, stageAt, step } from '@/lib/grapple-physics';
import GameShell, { PopupApi, useSwipe } from './GameShell';
import { Pointer, Hand, RotateCw } from 'lucide-react';

/**
 * CANOPY SWING — tap-tap vine swinging through a jungle canopy above a river, left to right.
 * TAP to let go, TAP in the air to grab the nearest vine in reach (no aiming, no holding).
 * The longer you stay on a vine the harder it swings — then it loops over the top — so a patient
 * swing launches you past 2, 3, 4+ vines. Stay too long and it spins out and throws you off.
 * Thorny vines can't be held: fly over them. Score = vines passed, counted as you fly past them.
 * Four stages — SLOW → MIDDLE → FINAL → CRAZY — so every run ends; one splash and you're out.
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
  const [hud, pushHud] = useThrottledHud({ score: 0, stage: 0, danger: 0, power: 0, loops: 0 });
  const api = useRef({ tap: () => {}, start: () => {} });

  const startGame = useCallback(() => {
    api.current.start();
    setPhase('playing');
  }, []);

  // Tap-tap: every tap either lets go or grabs.
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
      const knotMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x7a5a2e, roughness: 0.85 }));
      const thornMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x7a1d1d, roughness: 0.7, emissive: 0x5a0000, emissiveIntensity: 0.6 }));
      const thornGeo = engine.own(new THREE.ConeGeometry(0.05, 0.2, 5));
      const reachMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xd9fbe9, roughness: 0.4, emissive: 0x4ade80, emissiveIntensity: 1.3 }));
      const trunkGeo = engine.own(new THREE.CylinderGeometry(0.32, 0.48, 26, 12, 1));
      const branchGeo = engine.own(new THREE.CylinderGeometry(0.12, 0.2, 1, 8));
      const canopyGeo = engine.own(new THREE.IcosahedronGeometry(1.6, 1));
      const knotGeo = engine.own(new THREE.SphereGeometry(0.16, 12, 10));
      const hangVineGeo = engine.own(new THREE.CylinderGeometry(0.03, 0.035, 1, 5));
      hangVineGeo.translate(0, -0.5, 0);
      const leafGeo = engine.own(new THREE.PlaneGeometry(0.24, 0.13));
      const leafMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.7, side: THREE.DoubleSide }));
      const unitCyl = engine.own(new THREE.CylinderGeometry(1, 1, 1, 7, 1));

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

      // The vine you're holding: a thick rope with a few leaves, stretched from hand to branch.
      const ropeMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x6b8f2e, roughness: 0.85, emissive: 0x000000 }));
      const rope = new THREE.Mesh(unitCyl, ropeMat);
      rope.visible = false;
      rope.castShadow = quality.shadows;
      scene.add(rope);
      const ropeLeaves: THREE.Mesh[] = [];
      for (let k = 0; k < 4; k++) {
        const lf = new THREE.Mesh(leafGeo, leafMat);
        lf.visible = false;
        scene.add(lf);
        ropeLeaves.push(lf);
      }

      // ---------------- course
      let rng = mulberry32(1);
      let anchors: Anchor[] = [];
      const objs: { tree: THREE.Group; holder: THREE.Group; knot: THREE.Mesh; hang: THREE.Mesh }[] = [];
      const rings: THREE.Mesh[] = [];
      // pods, threads and catch rings
      const threadGeo = engine.own(new THREE.CylinderGeometry(0.012, 0.012, 1, 4));
      threadGeo.translate(0, -0.5, 0);
      const threadMat = engine.own(new THREE.MeshBasicMaterial({ color: 0xe9f5df, transparent: true, opacity: 0.55 }));
      const podGeo = engine.own(new THREE.SphereGeometry(0.22, 16, 12));
      const podMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xfff0b8, roughness: 0.35, emissive: 0xffb43a, emissiveIntensity: 2.6 }));
      const perchGeo = engine.own(new THREE.BoxGeometry(0.08, 0.06, 0.7));
      const perchMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }));
      const ringGeo = engine.own(new THREE.TorusGeometry(1, 0.03, 8, 64));
      const ringDimMat = engine.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc85a).multiplyScalar(1.2), transparent: true, opacity: 0.25, toneMapped: false, depthWrite: false }));
      const ringHotMat = engine.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd36b).multiplyScalar(2.2), transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false }));
      const thornRingMat = engine.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4d4d).multiplyScalar(1.6), transparent: true, opacity: 0.5, toneMapped: false, depthWrite: false }));
      let t = 0;

      const buildAnchor = (a: Anchor, i: number) => {
        const tree = new THREE.Group();
        const tx = -(3.4 + (i % 3) * 0.8);
        const trunk = new THREE.Mesh(trunkGeo, barkMat);
        trunk.position.set(tx, 9, -a.f - 0.4);
        trunk.castShadow = quality.shadows;
        const crown = new THREE.Group();
        for (let k = 0; k < 4; k++) {
          const leaf = new THREE.Mesh(canopyGeo, leafMats[(i + k) % leafMats.length]);
          leaf.position.set(tx * (0.4 + k * 0.2) + (k - 1.5) * 0.6, a.y0 + 1.6 + (k % 2) * 0.8, -a.f + (k - 1.5) * 0.9);
          leaf.scale.setScalar(0.7 + ((i * 7 + k * 3) % 5) * 0.12);
          leaf.rotation.set(k, i, 0);
          leaf.castShadow = quality.shadows;
          crown.add(leaf);
        }
        // (no trunk in front of the pods: they hang from the canopy, so the swing path stays clear)
        void trunk;
        crown.position.y += 4.5;
        tree.add(crown);
        const holder = new THREE.Group(); // bobs with the pod
        holder.position.set(0, a.y0, -a.f);
        // a silk thread down from the canopy, a glowing seed-pod to swing from, and its catch ring
        const hang = new THREE.Mesh(threadGeo, threadMat);
        hang.scale.y = 12;
        hang.position.y = 12;
        const knot = new THREE.Mesh(podGeo, a.thorn ? thornMat : podMat);
        const perch = new THREE.Mesh(perchGeo, perchMat);
        perch.position.y = -0.24;
        holder.add(hang, knot, perch);
        if (a.thorn) {
          for (let k = 0; k < 8; k++) {
            const th = new THREE.Mesh(thornGeo, thornMat);
            const ang = (k / 8) * Math.PI * 2;
            th.position.set(0, Math.cos(ang) * 0.24, Math.sin(ang) * 0.24);
            th.rotation.x = -ang;
            holder.add(th);
          }
        }
        const ring = new THREE.Mesh(ringGeo, a.thorn ? thornRingMat : ringDimMat);
        ring.rotation.y = Math.PI / 2;
        ring.scale.setScalar(stageAt(i).reach);
        holder.add(ring);
        rings[i] = ring;
        world.add(tree, holder);
        objs[i] = { tree, holder, knot, hang };
      };

      const ensureAhead = (cur: number) => {
        while (anchors.length < cur + AHEAD) {
          const i = anchors.length;
          const a = nextAnchor(anchors[i - 1], i, rng, anchors[i - 2]);
          anchors.push(a);
          buildAnchor(a, i);
        }
        for (let i = 0; i < cur - BEHIND; i++) {
          const o = objs[i];
          if (o) {
            world.remove(o.tree, o.holder);
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
      let cooldown = 0;
      let lastGrab = 0;
      let target = 1;
      let playing = false;
      let over = false;
      let passed = 0;
      let stageIdx = 0;
      let whip = 1; // 0 → 1: the vine whipping out to the branch on a grab
      let book = new ScoreBook();
      const camFocus = new THREE.Vector3(0, 7, -3);
      const tmpV = new THREE.Vector3();
      const tmpA = new THREE.Vector3();
      const tmpB = new THREE.Vector3();

      const clearWorld = () => {
        objs.forEach((o) => o && world.remove(o.tree, o.holder));
        objs.length = 0;
      };

      const reset = () => {
        clearWorld();
        rng = mulberry32(seedRef.current ?? randomSeed());
        t = 0;
        anchors = [FIRST_ANCHOR];
        buildAnchor(anchors[0], 0);
        ensureAhead(0);
        const A = anchorPos(anchors[0], 0);
        b.f = A.f + ROPE * Math.sin(-0.8);
        b.y = A.y - ROPE * Math.cos(-0.8);
        b.vf = b.vy = 0;
        line = grab(b, 0, A, stageAt(0));
        cooldown = 0;
        lastGrab = 0;
        target = 1;
        passed = 0;
        stageIdx = 0;
        whip = 1;
        book = new ScoreBook();
        over = false;
        particles.clear();
      };
      reset();

      const pushScore = () => pushHud({ score: book.score, stage: stageIdx }, true);
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
        if (!playing || cooldown > 0) return;
        if (line) {
          line = null; // let go — fly with all the swing you've built
          cooldown = 0.12;
          sound.playSwish();
          haptic('light');
          return;
        }
        // (in the air a tap does nothing: you catch the next pod by flying through its ring)
      };

      const finish = (why: string) => {
        playing = false;
        over = true;
        line = null;
        sound.stopMusic(0.4);
        sound.playLose();
        haptic('fail');
        engine.flash(0.4);
        popups.current?.banner(`${why} · ${passed} VINES`, '#5eead4');
        pushScore();
        setPhase('over');
        setTimeout(() => onFinishRef.current(book.score, { vines: passed, distance: Math.round(b.f), breakdown: book.breakdown() }), 1200);
      };

      /** Score = vines passed, counted the moment you fly past each one. */
      const countPassed = () => {
        while (passed + 1 < anchors.length && b.f > anchors[passed + 1].f) {
          passed += 1;
          const A = anchorPos(anchors[passed], t);
          const a = award(1, {});
          book.record(a, { Vines: 1 });
          popAtWorld(A.f, A.y + 0.6, '+1', popStyle(1));
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

      /** Tap in the air: grab branch `i` (thorny vines throw you off). */
      const onGrab = (i: number) => {
        const an = anchors[i];
        const A = anchorPos(an, t);
        if (an.thorn) {
          // thorns: they knock you away — you drop and tumble
          popAtWorld(A.f, A.y + 0.6, 'THORNS!', { color: '#f87171', size: 'md' });
          sound.playLose();
          haptic('fail');
          b.vf *= -0.25;
          b.vy = Math.min(b.vy, -2);
          cooldown = 0.6;
          target = i + 1;
          return;
        }
        line = grab(b, i, A, stageAt(i));
        whip = 0;
        cooldown = 0.12;
        const jump = i - lastGrab;
        lastGrab = i;
        if (jump >= 2) {
          popups.current?.banner(jump >= 4 ? `MEGA JUMP ×${jump}` : `JUMP ×${jump}`, jump >= 4 ? '#f472b6' : '#38bdf8');
          feel.kick(0.25 + jump * 0.05);
          engine.flash(0.2);
        }
        sound.playScore(1 + Math.min(0.8, (jump - 1) * 0.2));
        haptic('score');
        particles.emit(tmpV.set(0, A.y, -A.f), 0x9be15d, { count: 10 + jump * 4, speed: 3, life: 0.6, gravity: 5 });
        target = i + 1;
        ensureAhead(i);
      };

      // ---------------- frame
      engine.addUpdate((rawDt, time) => {
        const st = stageAt(target);
        const dt = Math.min(rawDt, 1 / 20) * (playing ? st.speed : 1);
        cooldown = Math.max(0, cooldown - rawDt);
        t += dt;
        const sub = 4;
        const h = dt / sub;
        for (let k = 0; k < sub && !over; k++) {
          const A = line ? anchorPos(anchors[line.anchor], t) : null;
          if (!playing && line) line.t = Math.min(line.t, 0.5); // menu: gentle swing, never spins out
          const spun = step(b, line, A, h);
          if (!playing) continue;
          if (spun && line) {
            // stayed on too long: the swing goes out of control and throws you off
            line = null;
            b.vf *= 1.1;
            b.vy = Math.abs(b.vy) * 0.6 + 2;
            popAtWorld(b.f, b.y + 1, 'SPUN OUT!', { color: '#f87171', size: 'md' });
            sound.playSwish();
            haptic('fail');
            feel.kick(0.6);
          }
          // fly through a ring and you catch that pod — no tap needed
          if (!line && cooldown <= 0) {
            const g = grabbable(b, anchors, target, t, stageAt(target).reach);
            if (g >= 0) onGrab(g);
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

        // power = how fast you're swinging (→ how far you'll fly); danger = how close to spinning out
        const speed = Math.hypot(b.vf, b.vy);
        const turns = line ? Math.abs(line.turned) / (Math.PI * 2) : 0;
        const danger = line && playing ? THREE.MathUtils.clamp((turns - (SPIN_OUT_TURNS - 0.9)) / 0.9, 0, 1) : 0;
        pushHud({ danger: Math.round(danger * 10) / 10, power: line && playing ? Math.min(5, Math.round((speed / 19) * 5)) : 0, loops: line ? Math.floor(Math.max(0, turns - 0.5)) : 0 });

        // branches bob; the one in reach glows; the idle vine hides on the branch you hold
        const inReach = -1; // (catching is automatic now)
        for (let i = Math.max(0, target - BEHIND); i < anchors.length; i++) {
          const o = objs[i];
          if (!o) continue;
          const A = anchorPos(anchors[i], t);
          o.holder.position.y = A.y;
          const r = rings[i];
          const isNext = i === target && playing;
          if (r) {
            const held = !!line && line.anchor === i;
            r.visible = !held && i >= target && i < target + 4;
            if (!anchors[i].thorn) r.material = isNext ? ringHotMat : ringDimMat;
            r.scale.setScalar(stageAt(i).reach * (isNext ? 1 + Math.sin(time * 5) * 0.03 : 1));
          }
          o.knot.scale.setScalar(isNext ? 1.15 + Math.sin(time * 6) * 0.08 : 1);
        }

        // ---- you
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
          // flying: lean into the jump, one hand reaching ahead for the next vine
          body.rotation.x += (THREE.MathUtils.clamp(-b.vy * 0.035, -0.45, 0.45) - body.rotation.x) * Math.min(1, dt * 8);
          me.leftArm.rotation.x = -2.4;
          me.rightArm.rotation.x = inReach >= 0 ? -2.9 : -2.3;
          me.leftLeg.rotation.x = -0.9;
          me.rightLeg.rotation.x = -0.5;
        }

        // ---- the vine in your hands (whips out to the branch on a grab)
        if (line) {
          const A = anchorPos(anchors[line.anchor], t);
          whip = Math.min(1, whip + rawDt * 14);
          const hand = tmpA.set(0, b.y + 0.15, -b.f);
          const end = tmpB.set(0, A.y, -A.f);
          end.lerpVectors(hand, end, whip);
          rope.visible = true;
          span(rope, hand, end);
          rope.scale.x = rope.scale.z = 0.045;
          ropeLeaves.forEach((lf, k) => {
            lf.visible = true;
            lf.position.lerpVectors(hand, end, 0.2 + k * 0.2);
            lf.position.x += 0.05;
            lf.rotation.set(0.4, Math.PI / 2 + k, 0.6 * (k % 2 ? 1 : -1));
          });
          // the vine heats up red as the swing gets out of hand
          ropeMat.color.setRGB(0.42 + danger * 0.5, 0.56 - danger * 0.35, 0.18 - danger * 0.1);
          ropeMat.emissive.setRGB(danger * 0.6, 0, 0);
        } else {
          rope.visible = false;
          ropeLeaves.forEach((lf) => (lf.visible = false));
        }
        if (danger > 0.6 && playing) feel.kick(0.04 * danger);

        // first vines: show when to let go
        const goalI = anchors[target]?.thorn ? target + 1 : target; // fly over thorny vines
        const canRelease = playing && !!line && !!anchors[goalI] && releaseWorks(b, anchors[goalI], st.reach, t);
        if (passed < 2 && canRelease && Math.floor(time * 4) % 4 === 0) {
          const p = engine.toScreen(tmpV.set(0, b.y + 1, -b.f));
          popups.current?.pop('LET GO!', p.x, p.y, { color: '#fde047', size: 'sm' });
        }
        // (read by automated play-tests)
        engine.renderer.domElement.dataset.shot = !playing ? 'none' : line ? (canRelease ? 'release' : 'hang') : inReach >= 0 ? (anchors[inReach].thorn ? 'thorn' : 'reach') : 'fly';

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
        api.current = { tap: () => {}, start: () => {} };
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
      {hud.power > 0 && (
        <span className="flex items-center gap-0.5 px-2 py-1 rounded-full bg-black/50" data-testid="swing-power" aria-label={`Swing power ${hud.power} of 5`}>
          {[1, 2, 3, 4, 5].map((k) => (
            <i key={k} className={`block w-1.5 h-2.5 rounded-sm ${k <= hud.power ? (hud.power >= 4 ? 'bg-pink-400' : 'bg-cyan-300') : 'bg-white/15'}`} />
          ))}
        </span>
      )}
      {hud.loops > 0 && hud.danger < 0.5 && <span className="px-2 py-0.5 rounded-full bg-cyan-400 text-black text-[11px] font-black">LOOP {hud.loops}</span>}
      {hud.danger >= 0.5 && <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[11px] font-black animate-pulse" data-testid="swing-danger">LET GO!</span>}
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
      hint="Tap to let go · fly through a ring to catch it · more swing = farther"
      guide={{
        goal: 'Swing pod to pod across the river, left to right. Don’t fall in.',
        controls: [
          { gesture: 'tap', label: 'Tap to let go' },
          { gesture: 'auto', label: 'Fly through a ring to catch the next pod' },
          { gesture: 'timing', label: 'Wait for more swing to fly over rings · don’t wait too long' },
        ],
        points: [{ label: 'Every vine you pass', value: '1' }],
        ends: 'Slow → Middle → Final → Crazy · one splash ends the run',
      }}
      tutorial={[
        { icon: <Pointer className="w-6 h-6" />, label: 'Tap to let go' },
        { icon: <Hand className="w-6 h-6" />, label: 'More swing = farther' },
        { icon: <RotateCw className="w-6 h-6" />, label: 'Too long = spin out' },
      ]}
      scoring="One tap: let go. You catch the next pod by yourself when you fly through its ring — no aiming, no holding. The longer you stay on a pod the harder it swings (then it loops over the top): let go with more swing and you fly over 2, 3, 4 or more rings. Stay too long and it spins out and throws you off. Red thorny pods knock you down — fly over or under their ring. 1 point for every pod you pass, counted as you go, so your score is how far you got. One splash ends the run. Stages: Slow, Middle, Final, Crazy. Same jungle for every player."
    />
  );
}
