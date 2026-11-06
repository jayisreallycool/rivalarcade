'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
import { CameraFeel, ParticleBursts, createFirstPersonRig, useGameEngine, useLatest, useStructuralMemo, useThrottledHud } from '@/lib/engine';
import { GameProps } from '@/lib/game-types';
import { mulberry32, randomSeed } from '@/lib/rng';
import { award, popStyle, ScoreBook } from '@/lib/scoring';
import GameShell, { PopupApi, useSwipe } from './GameShell';
import { Hand, Shield, Zap } from 'lucide-react';

/**
 * FIGHTNIGHT — a first-person boxing match. You and your opponent both start at 100% health.
 *
 *  TAP the left / right of the screen  → JAB with that hand (fast, light)
 *  SWIPE UP (on a side)                → HAYMAKER with that hand (slow, heavy, costs stamina)
 *  SWIPE DOWN                          → BLOCK (guard up)
 *  SWIPE LEFT / RIGHT                  → SLIP (dodge) that way
 *
 * Read the fight: punch the side he isn't guarding; slip or block when his glove pulls back and
 * glows (the telegraph); land a HAYMAKER while he winds up for a COUNTER (it stops his punch), or
 * hit him right after he swings and misses for a PUNISH. Stamina drains fast if you spam, he covers
 * up when you flurry, and from round 2 he can slip your haymakers — so pick your shots.
 * Three rounds of 45 s; a knockout ends it, otherwise the judges score it on health left.
 * Score (small numbers): jab 1 · haymaker 3 · counter +2 · punish +1 · slip +1 · KO win +20 ·
 * decision win +10 · +1 per 10% health left. Same seeded opponent for every player, so the best
 * fighter scores highest.
 */

const TITLE = 'FIGHTNIGHT';
const ROUNDS = 3;
const ROUND_S = 45;
const BREAK_S = 2.6;
const FOES = ['IRON VEGA', 'KID THUNDER', 'THE HAMMER', 'BIG RUIZ', 'NIGHT TRAIN', 'SLICK MALONE', 'DOC STEEL', 'BLAZE KANE'];
const DMG = { jab: 4, hay: 10 } as const;
const FOE_DMG = { jab: 7, hay: 17 } as const;
const COST = { jab: 13, hay: 32 } as const;

type Side = 'L' | 'R';
type Kind = 'jab' | 'hay';
type Phase = 'ready' | 'playing' | 'over';
type FoeState = 'guard' | 'windup' | 'punch' | 'recover' | 'stunned' | 'down';

export default function FightNight3DGame({ avatar, onFinish, seed, rival, match, onExit }: GameProps) {
  const stableAvatar = useStructuralMemo(avatar);
  const onFinishRef = useLatest(onFinish);
  const seedRef = useLatest(seed);
  const popups = useRef<PopupApi | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, you: 100, foe: 100, stamina: 100, round: 1, timeLeft: ROUND_S, foeName: FOES[0], combo: 0 });
  const api = useRef({ start: () => {}, jab: (_s: Side) => {}, hay: (_s: Side) => {}, block: () => {}, slip: (_s: Side) => {} });
  const surfaceW = useRef(390);

  const hurtFlash = useCallback(() => {
    const el = flashRef.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.opacity = '1';
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 500ms ease-out';
      el.style.opacity = '0';
    });
  }, []);

  const startGame = useCallback(() => {
    api.current.start();
    setPhase('playing');
  }, []);

  // Input: tap a side = jab, swipe up = haymaker (from the side you started on), swipe down = block,
  // swipe sideways = slip.
  const sideOf = (x: number): Side => (x < surfaceW.current / 2 ? 'L' : 'R');
  const surface = useSwipe({
    earlyThreshold: 26,
    onTap: (x) => api.current.jab(sideOf(x)),
    onSwipe: (s) => {
      if (Math.abs(s.dy) > Math.abs(s.dx)) {
        if (s.dy < 0) api.current.hay(sideOf(s.startX));
        else api.current.block();
      } else api.current.slip(s.dx < 0 ? 'L' : 'R');
    },
  });

  // Keyboard: A / D jab · W + A/D side → haymaker (Q / E) · S block · ← → slip.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.code;
      if (k === 'KeyA') api.current.jab('L');
      else if (k === 'KeyD') api.current.jab('R');
      else if (k === 'KeyQ') api.current.hay('L');
      else if (k === 'KeyE') api.current.hay('R');
      else if (k === 'KeyS' || k === 'ArrowDown') api.current.block();
      else if (k === 'ArrowLeft') api.current.slip('L');
      else if (k === 'ArrowRight') api.current.slip('R');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { hostRef } = useGameEngine(
    {
      background: 0x050508,
      fog: { color: 0x050508, density: 0.06 },
      camera: { fov: 62, near: 0.03, far: 80, position: [0, 1.62, 1.55], lookAt: [0, 1.45, -1] },
      exposure: 1.15,
      bloom: { strength: 0.55, radius: 0.35, threshold: 0.85 },
      environment: 0.4,
      studio: { top: 0x332244, left: 0xff3b3b, right: 0x3b82f6 },
      grade: { saturation: 1.1, vignette: 0.5 },
    },
    (engine) => {
      const { scene, camera, quality } = engine;
      const feel = new CameraFeel();
      engine.onResize((w) => {
        surfaceW.current = w;
        camera.fov = camera.aspect < 0.7 ? 72 : 62;
        camera.updateProjectionMatrix();
      });

      // ---------------------------------------------------------------- arena
      const hemi = new THREE.HemisphereLight(0x8090b0, 0x100808, 0.5);
      const spot = new THREE.SpotLight(0xfff1dc, 60, 18, 0.62, 0.45, 1.4);
      spot.position.set(0, 7.5, 0.4);
      spot.target.position.set(0, 0, -0.2);
      if (quality.shadows) {
        spot.castShadow = true;
        spot.shadow.mapSize.set(1024, 1024);
      }
      const rimRed = new THREE.PointLight(0xff3344, 6, 9, 1.5);
      rimRed.position.set(-3, 2.6, -2.5);
      const rimBlue = new THREE.PointLight(0x3b82f6, 6, 9, 1.5);
      rimBlue.position.set(3, 2.6, -2.5);
      scene.add(hemi, spot, spot.target, rimRed, rimBlue);

      // ring canvas: mat with our own centre logo
      const matCanvas = document.createElement('canvas');
      matCanvas.width = matCanvas.height = 1024;
      {
        const g = matCanvas.getContext('2d')!;
        g.fillStyle = '#1d2a4a';
        g.fillRect(0, 0, 1024, 1024);
        const rg = g.createRadialGradient(512, 512, 60, 512, 512, 700);
        rg.addColorStop(0, 'rgba(255,255,255,0.10)');
        rg.addColorStop(1, 'rgba(0,0,0,0.35)');
        g.fillStyle = rg;
        g.fillRect(0, 0, 1024, 1024);
        g.strokeStyle = 'rgba(255,255,255,0.18)';
        g.lineWidth = 10;
        g.strokeRect(40, 40, 944, 944);
        g.save();
        g.translate(512, 512);
        g.fillStyle = 'rgba(255,255,255,0.16)';
        g.font = 'italic 900 132px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(TITLE, 0, 0);
        g.font = '800 40px system-ui, sans-serif';
        g.fillText('RIVAL ARCADE · CHAMPIONSHIP', 0, 96);
        g.restore();
      }
      const matTex = engine.own(new THREE.CanvasTexture(matCanvas));
      matTex.colorSpace = THREE.SRGBColorSpace;
      const ring = new THREE.Mesh(engine.own(new THREE.BoxGeometry(6.2, 0.3, 6.2)), engine.own(new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.85 })));
      ring.position.set(0, -0.15, -0.6);
      ring.receiveShadow = quality.shadows;
      const apron = new THREE.Mesh(engine.own(new THREE.BoxGeometry(6.6, 0.8, 6.6)), engine.own(new THREE.MeshStandardMaterial({ color: 0x0c0d14, roughness: 0.7 })));
      apron.position.set(0, -0.7, -0.6);
      scene.add(ring, apron);
      const postMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xb8bcc8, roughness: 0.3, metalness: 0.9 }));
      const postGeo = engine.own(new THREE.CylinderGeometry(0.07, 0.07, 1.5, 12));
      const corners: [number, number][] = [[-3, -3.6], [3, -3.6], [-3, 2.4], [3, 2.4]];
      for (const [x, z] of corners) {
        const p = new THREE.Mesh(postGeo, postMat);
        p.position.set(x, 0.75, z);
        const pad = new THREE.Mesh(engine.own(new THREE.BoxGeometry(0.2, 1.1, 0.2)), engine.own(new THREE.MeshStandardMaterial({ color: x < 0 ? 0xb91c1c : 0x1d4ed8, roughness: 0.6 })));
        pad.position.set(x, 0.8, z);
        scene.add(p, pad);
      }
      const ropeGeo = engine.own(new THREE.CylinderGeometry(0.028, 0.028, 1, 8));
      ropeGeo.rotateZ(Math.PI / 2);
      const ropeMats = [0xdc2626, 0xf1f5f9, 0x2563eb].map((c) => engine.own(new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, emissive: c, emissiveIntensity: 0.15 })));
      const rope = (a: [number, number], b: [number, number], y: number, m: THREE.Material) => {
        const r = new THREE.Mesh(ropeGeo, m);
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        r.scale.x = Math.hypot(dx, dz);
        r.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
        r.rotation.y = -Math.atan2(dz, dx);
        scene.add(r);
      };
      [0.5, 0.9, 1.3].forEach((y, i) => {
        rope(corners[0], corners[1], y, ropeMats[i]);
        rope(corners[0], corners[2], y, ropeMats[i]);
        rope(corners[1], corners[3], y, ropeMats[i]);
      });

      // crowd: dark silhouettes in the stands, with camera flashes popping
      const crowdN = Math.round(220 * quality.propDensity);
      const crowd = new THREE.InstancedMesh(engine.own(new THREE.CapsuleGeometry(0.22, 0.5, 2, 6)), engine.own(new THREE.MeshStandardMaterial({ color: 0x15151d, roughness: 1 })), crowdN);
      const m4 = new THREE.Matrix4();
      const cr = mulberry32(5);
      const crowdPos: THREE.Vector3[] = [];
      for (let i = 0; i < crowdN; i++) {
        const ang = Math.PI * (0.1 + cr() * 0.8);
        const rad = 5 + cr() * 6;
        const v = new THREE.Vector3(Math.cos(ang) * rad * (cr() < 0.5 ? -1 : 1), 0.2 + (rad - 5) * 0.45 + cr() * 0.2, -Math.sin(ang) * rad - 1.5);
        crowdPos.push(v);
        m4.makeTranslation(v.x, v.y, v.z);
        crowd.setMatrixAt(i, m4);
      }
      scene.add(crowd);
      const particles = new ParticleBursts(engine);
      const flashes = new ParticleBursts(engine, engine.own(new THREE.OctahedronGeometry(0.05, 0)));

      // ---------------------------------------------------------------- the opponent
      const seedRng = () => mulberry32(seedRef.current ?? randomSeed());
      let rng = seedRng();
      const skinTones = [0x8d5524, 0xc68642, 0xe0ac69, 0x5c3a21, 0xf1c27d];
      const skinMat = engine.own(new THREE.MeshStandardMaterial({ color: skinTones[0], roughness: 0.55, emissive: 0x000000 }));
      const trunksMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.45, metalness: 0.1 }));
      const trimMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4 }));
      const foeGloveMat = engine.own(new THREE.MeshPhysicalMaterial({ color: 0x1e40af, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.25, emissive: 0x000000 }));
      const darkMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }));
      const unitCyl = engine.own(new THREE.CylinderGeometry(1, 1, 1, 10));
      const foe = new THREE.Group();
      foe.position.set(0, 0, -0.55);
      scene.add(foe);
      const body = new THREE.Group(); // sways / weaves / takes hits
      foe.add(body);
      const legGeo = engine.own(new THREE.CapsuleGeometry(0.085, 0.62, 4, 10));
      for (const x of [-0.13, 0.13]) {
        const leg = new THREE.Mesh(legGeo, skinMat);
        leg.position.set(x, 0.42, 0);
        const shoe = new THREE.Mesh(engine.own(new THREE.BoxGeometry(0.13, 0.09, 0.26)), darkMat);
        shoe.position.set(x, 0.05, 0.04);
        body.add(leg, shoe);
      }
      const trunks = new THREE.Mesh(engine.own(new THREE.CylinderGeometry(0.21, 0.23, 0.32, 16)), trunksMat);
      trunks.position.y = 0.92;
      const band = new THREE.Mesh(engine.own(new THREE.CylinderGeometry(0.215, 0.215, 0.06, 16)), trimMat);
      band.position.y = 1.07;
      const torso = new THREE.Mesh(engine.own(new THREE.CapsuleGeometry(0.2, 0.32, 6, 14)), skinMat);
      torso.position.y = 1.32;
      torso.scale.set(1.12, 1, 0.78);
      const neck = new THREE.Mesh(engine.own(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 10)), skinMat);
      neck.position.y = 1.58;
      const head = new THREE.Group();
      head.position.y = 1.7;
      const skull = new THREE.Mesh(engine.own(new THREE.SphereGeometry(0.12, 20, 16)), skinMat);
      skull.scale.set(0.92, 1.06, 0.98);
      const hair = new THREE.Mesh(engine.own(new THREE.SphereGeometry(0.123, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.45)), darkMat);
      const eyeGeo = engine.own(new THREE.SphereGeometry(0.014, 8, 6));
      const eyeL = new THREE.Mesh(eyeGeo, darkMat);
      eyeL.position.set(-0.042, 0.02, 0.108);
      const eyeR = new THREE.Mesh(eyeGeo, darkMat);
      eyeR.position.set(0.042, 0.02, 0.108);
      const brow = new THREE.Mesh(engine.own(new THREE.BoxGeometry(0.11, 0.015, 0.02)), darkMat);
      brow.position.set(0, 0.048, 0.11);
      const mouthguard = new THREE.Mesh(engine.own(new THREE.BoxGeometry(0.06, 0.016, 0.02)), trunksMat);
      mouthguard.position.set(0, -0.05, 0.112);
      head.add(skull, hair, eyeL, eyeR, brow, mouthguard);
      body.add(trunks, band, torso, neck, head);
      // arms: shoulder → elbow → glove drawn as two limb segments each frame
      const upper = [new THREE.Mesh(unitCyl, skinMat), new THREE.Mesh(unitCyl, skinMat)];
      const fore = [new THREE.Mesh(unitCyl, skinMat), new THREE.Mesh(unitCyl, skinMat)];
      const gloveGeo = engine.own(new THREE.SphereGeometry(0.1, 18, 14));
      gloveGeo.scale(1, 0.92, 1.18);
      const foeGloves = [new THREE.Mesh(gloveGeo, foeGloveMat), new THREE.Mesh(gloveGeo, foeGloveMat)];
      const gloveGlow = [0, 0];
      const glowMats = [foeGloveMat.clone(), foeGloveMat.clone()].map((m) => engine.own(m));
      foeGloves.forEach((g, i) => (g.material = glowMats[i]));
      scene.add(...upper, ...fore, ...foeGloves);
      [...upper, ...fore, ...foeGloves, torso, skull, trunks].forEach((m) => (m.castShadow = quality.shadows));
      const span = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, r: number) => {
        m.position.copy(a).add(b).multiplyScalar(0.5);
        const len = a.distanceTo(b);
        m.scale.set(r, len, r);
        m.quaternion.setFromUnitVectors(UP, tmpD.copy(b).sub(a).normalize());
      };
      const UP = new THREE.Vector3(0, 1, 0);
      const tmpD = new THREE.Vector3();
      // glove targets (in foe-local space); index 0 = his glove on OUR screen-left
      const guardPos = (i: number, high: boolean) => new THREE.Vector3(i === 0 ? -0.15 : 0.15, high ? 1.68 : 1.5, 0.28);
      const gloveNow = [new THREE.Vector3(-0.15, 1.5, 0.28), new THREE.Vector3(0.15, 1.5, 0.28)];

      // ---------------------------------------------------------------- your gloves
      const arms = createFirstPersonRig(engine, stableAvatar, { spread: 0.24, drop: 0.36, depth: 0.5 });
      const myGloveMat = engine.own(new THREE.MeshPhysicalMaterial({ color: 0xdc2626, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.2, depthTest: false, fog: false }));
      const myCuffMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5, depthTest: false, fog: false }));
      const myGloveGeo = engine.own(new THREE.SphereGeometry(0.085, 20, 16));
      myGloveGeo.scale(1, 0.95, 1.25);
      for (const a of [arms.left, arms.right]) {
        a.hand.children.forEach((c) => (c.visible = false)); // the glove replaces the bare hand
        const g = new THREE.Mesh(myGloveGeo, myGloveMat);
        g.position.set(0, 0.02, -0.01);
        const cuff = new THREE.Mesh(engine.own(new THREE.CylinderGeometry(0.05, 0.055, 0.07, 14)), myCuffMat);
        cuff.rotation.x = Math.PI / 2;
        cuff.position.set(0, 0.0, 0.09);
        for (const m of [g, cuff]) {
          m.renderOrder = 11;
          m.frustumCulled = false;
          a.hand.add(m);
        }
      }

      // ---------------------------------------------------------------- state
      const s = {
        playing: false,
        over: false,
        round: 1,
        clock: ROUND_S,
        breakT: 0,
        you: 100,
        foe: 100,
        stamina: 100,
        staminaWait: 0,
        // your actions
        punch: null as null | { side: Side; kind: Kind; t: number; dur: number; hitAt: number; resolved: boolean; tired: boolean },
        slip: 0,
        slipSide: 'L' as Side,
        block: 0,
        // the foe
        st: 'guard' as FoeState,
        stT: 0,
        stDur: 1.5,
        hand: 0,
        kind: 'jab' as Kind,
        guard: 'open' as 'open' | Side | 'high',
        guardT: 1,
        hitReact: 0,
        hitDir: 0,
        recentHits: 0, // hits he took in the last second (he shells up when you flurry)
        attackIn: 1.6, // his next punch: keeps counting down even while you hit him
        foeName: FOES[0],
        book: new ScoreBook(),
        score: 0,
        combo: 0,
        bestCombo: 0,
        landed: 0,
      };

      const pushAll = (force = false) =>
        pushHud({ score: s.score, you: Math.max(0, Math.round(s.you)), foe: Math.max(0, Math.round(s.foe)), stamina: Math.round(s.stamina), round: s.round, timeLeft: Math.max(0, s.clock), foeName: s.foeName, combo: s.combo }, force);

      const addPoints = (parts: Record<string, number>, at?: THREE.Vector3, tone?: 'bonus' | 'gold' | 'jackpot') => {
        const raw = Object.values(parts).reduce((a, b) => a + b, 0);
        if (raw <= 0) return 0;
        const a = award(raw, {});
        s.book.record(a, parts);
        s.score = s.book.score;
        if (at) {
          const p = engine.toScreen(at);
          popups.current?.pop(`+${a.total}`, p.x, p.y, popStyle(a.total, tone));
        }
        return a.total;
      };

      /** How aggressive / quick the foe is this round (and as he gets desperate). */
      const tempo = () => {
        const r = s.round - 1;
        const desperate = s.foe < 35 ? 0.15 : 0;
        return { wait: [0.95 - r * 0.18 - desperate, 1.8 - r * 0.32 - desperate], windJab: 0.46 - r * 0.06, windHay: 0.72 - r * 0.09, high: 0.18 + r * 0.12, combo: 0.1 + r * 0.15 };
      };

      const setGuard = () => {
        const tp = tempo();
        const r = rng();
        s.guard = r < tp.high ? 'high' : r < tp.high + 0.3 ? 'L' : r < tp.high + 0.6 ? 'R' : 'open';
        s.guardT = 0.7 + rng() * 0.9;
      };

      const foeTo = (st: FoeState, dur: number) => {
        s.st = st;
        s.stT = 0;
        s.stDur = dur;
      };

      const resetFight = () => {
        rng = seedRng();
        s.foeName = FOES[Math.floor(rng() * FOES.length)];
        skinMat.color.setHex(skinTones[Math.floor(rng() * skinTones.length)]);
        const kit = [0x1d4ed8, 0x15803d, 0x7c3aed, 0x111827, 0xb45309][Math.floor(rng() * 5)];
        trunksMat.color.setHex(kit);
        Object.assign(s, { playing: false, over: false, round: 1, clock: ROUND_S, breakT: 0, you: 100, foe: 100, stamina: 100, staminaWait: 0, punch: null, slip: 0, block: 0, hitReact: 0, book: new ScoreBook(), score: 0, combo: 0, bestCombo: 0, landed: 0 });
        foeTo('guard', 99);
        s.attackIn = 1.6;
        setGuard();
        particles.clear();
      };
      resetFight();

      const head3 = new THREE.Vector3();
      const headWorld = () => head.getWorldPosition(head3);

      const finish = (how: 'ko-win' | 'ko-loss' | 'decision') => {
        if (s.over) return;
        s.over = true;
        s.playing = false;
        let banner: string;
        let color = '#fde047';
        if (how === 'ko-win') {
          banner = 'K.O.! VICTORY';
          addPoints({ 'Knockout win': 20 });
        } else if (how === 'ko-loss') {
          banner = 'KNOCKED OUT';
          color = '#f87171';
        } else if (s.you > s.foe) {
          banner = 'VICTORY · DECISION';
          addPoints({ 'Decision win': 10 });
        } else if (s.you < s.foe) {
          banner = 'DEFEAT · DECISION';
          color = '#f87171';
        } else banner = 'DRAW';
        const hp = Math.floor(Math.max(0, s.you) / 10);
        if (hp > 0 && how !== 'ko-loss') addPoints({ 'Health left': hp });
        popups.current?.banner(banner, color);
        sound.playBell(3);
        if (how === 'ko-loss' || (how === 'decision' && s.you < s.foe)) sound.playLose();
        else sound.playWin();
        haptic('big');
        sound.stopMusic(0.5);
        pushAll(true);
        setPhase('over');
        const breakdown = s.book.breakdown();
        setTimeout(() => onFinishRef.current(s.score, { maxCombo: s.bestCombo, breakdown }), 1600);
      };

      // ---- your punches land (or don't)
      const resolvePunch = (side: Side, kind: Kind, tired: boolean) => {
        if (s.st === 'down') return;
        const at = headWorld().clone();
        at.x += side === 'L' ? -0.05 : 0.05;
        let dmg: number = DMG[kind] * (tired ? 0.5 : 1);
        // a haymaker while he winds up is a COUNTER (stops his punch); a jab just lands
        const counter = s.st === 'windup' && kind === 'hay';
        const punish = s.st === 'recover' || s.st === 'stunned';
        // from round 2 he can slip a haymaker he sees coming (not while he's busy punching or hurt)
        if (kind === 'hay' && s.st === 'guard' && rng() < (s.round - 1) * 0.18) {
          sound.playWhiff();
          popups.current?.pop('HE SLIPPED IT', engine.toScreen(at).x, engine.toScreen(at).y, { color: '#fca5a5', size: 'sm' });
          s.combo = 0;
          s.hand = side === 'L' ? 1 : 0;
          s.kind = 'jab';
          foeTo('windup', tempo().windJab * 0.8); // …and fires straight back
          return;
        }
        const windupOpen = s.st === 'windup' && kind === 'jab'; // his guard is down while he loads up
        const guarded = !counter && !punish && !windupOpen && (s.guard === 'high' || s.guard === side);
        if (guarded && kind === 'jab') {
          dmg *= 0.2;
          sound.playPunch(false, true);
          popups.current?.pop('BLOCKED', engine.toScreen(at).x, engine.toScreen(at).y, { color: '#94a3b8', size: 'sm' });
          s.combo = 0;
        } else {
          if (guarded) {
            dmg *= 0.5; // a haymaker smashes through the guard…
            s.guard = 'open'; // …and knocks it open
            s.guardT = 0.6;
          }
          if (counter) {
            dmg *= 1.5;
            foeTo('stunned', 0.7);
            s.attackIn = Math.max(s.attackIn, 1.0);
            gloveGlow[0] = gloveGlow[1] = 0;
          }
          s.combo += 1;
          s.bestCombo = Math.max(s.bestCombo, s.combo);
          s.landed += 1;
          const parts: Record<string, number> = {};
          if (!guarded) parts[kind === 'jab' ? 'Jabs landed' : 'Haymakers landed'] = kind === 'jab' ? 1 : 3;
          if (counter) parts['Counters'] = 2;
          else if (punish) parts['Punishes'] = 1;
          addPoints(parts, at, counter ? 'gold' : kind === 'hay' ? 'bonus' : undefined);
          if (counter) popups.current?.pop('COUNTER!', engine.toScreen(at).x, engine.toScreen(at).y + 30, { color: '#fbbf24', size: 'md' });
          else if (punish) popups.current?.pop('PUNISH', engine.toScreen(at).x, engine.toScreen(at).y + 30, { color: '#fda4af', size: 'sm' });
          sound.playPunch(kind === 'hay');
          haptic(kind === 'hay' ? 'big' : 'score');
          feel.kick(kind === 'hay' ? 0.35 : 0.12);
          engine.flash(kind === 'hay' || counter ? 0.35 : 0.12);
          particles.emit(at, 0xe0f2fe, { count: kind === 'hay' ? 22 : 10, speed: kind === 'hay' ? 4 : 2.5, life: 0.5, gravity: 4 });
          s.hitReact = kind === 'hay' ? 1 : 0.55;
          s.recentHits += 1;
          if (s.recentHits >= 3 && s.st === 'guard') {
            s.guard = 'high'; // a flurry makes him cover up
            s.guardT = 1.1;
            s.recentHits = 0;
            s.attackIn = Math.min(s.attackIn, 0.5); // …and fire back sooner
          }
          s.hitDir = side === 'L' ? 1 : -1;
          skinMat.emissive.setHex(0x441111);
        }
        s.foe -= dmg;
        if (s.foe <= 0) {
          s.foe = 0;
          foeTo('down', 99);
          popups.current?.banner('DOWN!', '#fde047');
          for (const p of crowdPos.slice(0, 40)) flashes.emit(p, 0xffffff, { count: 1, speed: 0.2, life: 0.15, gravity: 0, size: 2 });
          setTimeout(() => finish('ko-win'), 900);
        }
        pushAll(true);
      };

      // ---- his punch arrives
      const foeLands = () => {
        const kind = s.kind;
        const dodged = s.slip > 0;
        if (dodged) {
          sound.playWhiff();
          addPoints({ Slips: 1 });
          popups.current?.pop('SLIP! +1', surfaceW.current / 2, 260, { color: '#86efac', size: 'md' });
          haptic('light');
          foeTo('recover', kind === 'hay' ? 0.75 : 0.5); // he over-reached: open for a punish
          return;
        }
        let dmg: number = FOE_DMG[kind];
        if (s.block > 0) {
          dmg *= kind === 'hay' ? 0.4 : 0.2;
          sound.playPunch(false, true);
          popups.current?.pop('BLOCK', surfaceW.current / 2, 280, { color: '#93c5fd', size: 'sm' });
          feel.kick(0.15);
          haptic('light');
        } else {
          sound.playPunch(kind === 'hay');
          hurtFlash();
          feel.kick(kind === 'hay' ? 0.9 : 0.45);
          engine.flash(0.2);
          haptic('fail');
          s.combo = 0;
          s.stamina = Math.max(0, s.stamina - (kind === 'hay' ? 12 : 5));
        }
        s.you -= dmg;
        foeTo('recover', 0.3);
        if (s.you <= 0) {
          s.you = 0;
          popups.current?.banner('YOU’RE DOWN', '#f87171');
          setTimeout(() => finish('ko-loss'), 900);
          s.playing = false;
        }
        pushAll(true);
      };

      // ---------------------------------------------------------------- controls
      api.current.start = () => {
        resetFight();
        s.playing = true;
        popups.current?.banner(`ROUND 1 · vs ${s.foeName}`, '#fde047');
        sound.playBell(1);
        sound.startMusic(0.15);
        pushAll(true);
      };
      const canAct = () => s.playing && s.breakT <= 0 && s.st !== 'down';
      const throwPunch = (side: Side, kind: Kind) => {
        if (!canAct() || s.punch || s.block > 0) return;
        // gassed: no punch at all when the tank is empty, a weak one when it's low
        if (s.stamina < 5) {
          popups.current?.pop('NO GAS', surfaceW.current / 2, 320, { color: '#fca5a5', size: 'sm' });
          return;
        }
        const tired = s.stamina < COST[kind];
        if (tired) popups.current?.pop('TIRED', surfaceW.current / 2, 320, { color: '#fca5a5', size: 'sm' });
        s.stamina = Math.max(0, s.stamina - COST[kind]);
        s.staminaWait = 0.45;
        const dur = kind === 'jab' ? 0.26 : 0.5;
        s.punch = { side, kind, t: 0, dur, hitAt: kind === 'jab' ? 0.11 : 0.32, resolved: false, tired };
        if (kind === 'hay') sound.playWhiff();
        haptic('tap');
      };
      api.current.jab = (side) => throwPunch(side, 'jab');
      api.current.hay = (side) => throwPunch(side, 'hay');
      api.current.block = () => {
        if (!canAct() || s.punch) return;
        s.block = 0.6;
        haptic('tap');
      };
      api.current.slip = (side) => {
        if (!canAct() || s.slip > -0.25) return; // short cooldown between slips
        s.slip = 0.36;
        s.slipSide = side;
        haptic('tap');
      };

      // ---------------------------------------------------------------- frame
      const BLACK = new THREE.Color(0x000000);
      const tmpA = new THREE.Vector3();
      const tmpB = new THREE.Vector3();
      const elbow = new THREE.Vector3();
      const shoulder = new THREE.Vector3();
      engine.addUpdate((dt, t) => {
        // ---- round clock + breaks
        if (s.playing) {
          if (s.breakT > 0) {
            s.breakT -= dt;
            if (s.breakT <= 0) {
              popups.current?.banner(s.round === ROUNDS ? 'FINAL ROUND' : `ROUND ${s.round}`, '#fde047');
              sound.playBell(1);
            }
          } else {
            s.clock -= dt;
            if (s.clock <= 0) {
              if (s.round >= ROUNDS) finish('decision');
              else {
                s.round += 1;
                s.clock = ROUND_S;
                s.breakT = BREAK_S;
                s.you = Math.min(100, s.you + 8);
                s.foe = Math.min(100, s.foe + 8);
                s.stamina = 100;
                s.punch = null;
                foeTo('guard', 99);
                s.attackIn = 1.4;
                sound.playBell(2);
                popups.current?.banner(`END OF ROUND ${s.round - 1}`, '#e2e8f0');
              }
            }
          }
        }

        // ---- you
        s.slip -= dt;
        s.block = Math.max(0, s.block - dt);
        s.staminaWait -= dt;
        if (s.staminaWait <= 0) s.stamina = Math.min(100, s.stamina + 20 * dt);
        s.recentHits = Math.max(0, s.recentHits - dt * 1.2);
        if (s.punch) {
          const p = s.punch;
          p.t += dt;
          if (!p.resolved && p.t >= p.hitAt) {
            p.resolved = true;
            if (s.playing || s.st === 'down') resolvePunch(p.side, p.kind, p.tired);
          }
          if (p.t >= p.dur) s.punch = null;
        }

        // ---- him
        const tp = tempo();
        if (s.playing && s.breakT <= 0) {
          s.stT += dt;
          s.guardT -= dt;
          if (s.st === 'guard' || s.st === 'stunned') s.attackIn -= dt * (s.st === 'stunned' ? 0.3 : 1);
          if (s.st === 'guard') {
            if (s.guardT <= 0) setGuard();
            if (s.attackIn <= 0) {
              // wind up a punch: the glove pulls back and glows — your cue
              s.hand = rng() < 0.5 ? 0 : 1;
              s.kind = rng() < 0.62 ? 'jab' : 'hay';
              foeTo('windup', s.kind === 'jab' ? tp.windJab : tp.windHay);
              s.guard = 'open';
            }
          } else if (s.st === 'windup') {
            gloveGlow[s.hand] = Math.min(1, s.stT / s.stDur);
            if (s.stT >= s.stDur) foeTo('punch', 0.12);
          } else if (s.st === 'punch') {
            if (s.stT >= s.stDur) {
              gloveGlow[s.hand] = 0;
              foeLands();
            }
          } else if (s.st === 'recover' || s.st === 'stunned') {
            if (s.stT >= s.stDur) {
              // sometimes he chains straight into another punch
              if (s.st === 'recover' && rng() < tp.combo) {
                s.hand = 1 - s.hand;
                s.kind = 'jab';
                foeTo('windup', tp.windJab * 0.85);
              } else {
                // after his own punch the clock starts over; after a stun he keeps what was left
                const afterPunch = s.st === 'recover';
                foeTo('guard', 99);
                if (afterPunch || s.attackIn <= 0) s.attackIn = tp.wait[0] + rng() * (tp.wait[1] - tp.wait[0]);
                setGuard();
              }
            }
          }
        }
        gloveGlow.forEach((g, i) => {
          const m = glowMats[i];
          m.emissive.setRGB(g * 1.6, g * 0.15, 0);
          if (s.st !== 'windup' || i !== s.hand) gloveGlow[i] = Math.max(0, g - dt * 4);
        });
        skinMat.emissive.lerp(BLACK, Math.min(1, dt * 6));

        // ---- his body: bob & weave, hit reactions, knockdown
        s.hitReact = Math.max(0, s.hitReact - dt * 3.2);
        if (s.st === 'down') {
          body.rotation.x = Math.max(-1.45, body.rotation.x - dt * 3);
          body.position.y = Math.max(-0.1, body.position.y - dt * 0.6);
        } else {
          const weave = Math.sin(t * 2.2) * 0.05;
          body.position.set(weave, Math.sin(t * 4.4) * 0.012, 0);
          body.rotation.set(-s.hitReact * 0.22, s.hitDir * s.hitReact * 0.3, weave * 0.6 + (s.st === 'stunned' ? Math.sin(t * 18) * 0.04 : 0));
          head.rotation.set(-s.hitReact * 0.35, s.hitDir * s.hitReact * 0.5, 0);
        }
        // his gloves: guard (side / high / open), wind back on a telegraph, snap out on the punch
        for (let i = 0; i < 2; i++) {
          const high = s.guard === 'high' || (s.guard === 'L' && i === 0) || (s.guard === 'R' && i === 1);
          let want = guardPos(i, high);
          if (s.guard === 'open' && s.st === 'guard') want.y -= 0.12;
          if (s.st === 'stunned') want = tmpB.set(i === 0 ? -0.26 : 0.26, 1.2, 0.18).clone();
          if (s.st === 'down') want = tmpB.set(i === 0 ? -0.34 : 0.34, 0.9, -0.1).clone();
          if (i === s.hand && (s.st === 'windup' || s.st === 'punch')) {
            const k = s.st === 'windup' ? Math.min(1, s.stT / s.stDur) : 1;
            if (s.st === 'windup') want = new THREE.Vector3(i === 0 ? -0.32 : 0.32, s.kind === 'hay' ? 1.62 : 1.55, -0.02 - k * 0.1);
            else {
              // straight at your face (a haymaker hooks in from the side)
              const sx = s.kind === 'hay' ? (i === 0 ? -0.12 : 0.12) : i === 0 ? -0.05 : 0.05;
              want = new THREE.Vector3(sx, 1.62, 1.6);
            }
          }
          const speed = s.st === 'punch' ? 40 : s.st === 'windup' ? 9 : 12;
          gloveNow[i].lerp(want, Math.min(1, dt * speed));
          // world positions: shoulder → elbow → glove
          shoulder.set(i === 0 ? -0.26 : 0.26, 1.5, 0);
          body.localToWorld(shoulder);
          tmpA.copy(gloveNow[i]);
          body.localToWorld(tmpA);
          elbow.copy(shoulder).lerp(tmpA, 0.5);
          elbow.y -= 0.12;
          elbow.x += i === 0 ? -0.08 : 0.08;
          span(upper[i], shoulder, elbow, 0.06);
          span(fore[i], elbow, tmpA, 0.052);
          foeGloves[i].position.copy(tmpA);
          foeGloves[i].lookAt(camera.position);
        }

        // ---- your gloves: guard up, jab / haymaker, block, slip
        arms.ready(t);
        const guardY = s.block > 0 ? 0.1 : 0.04;
        for (const [arm, side] of [[arms.left, 'L'], [arms.right, 'R']] as const) {
          const rest = side === 'L' ? arms.rest.left : arms.rest.right;
          arm.pivot.position.set(rest.x * (s.block > 0 ? 0.55 : 1), rest.y + guardY, rest.z);
          arm.pivot.rotation.set(s.block > 0 ? 0.5 : 0.15, 0, 0);
          const p = s.punch;
          if (p && p.side === side) {
            const k = Math.sin(Math.min(1, p.t / p.dur) * Math.PI);
            if (p.kind === 'jab') {
              arm.pivot.position.z -= k * 0.42;
              arm.pivot.position.y += k * 0.08;
              arm.pivot.position.x -= (side === 'L' ? -1 : 1) * k * 0.08;
            } else {
              // haymaker: wind back, then a big hooking arc across
              const wind = p.t < 0.18 ? p.t / 0.18 : 0;
              arm.pivot.position.z += wind * 0.08 - (p.t >= 0.18 ? k * 0.38 : 0);
              arm.pivot.position.y += (p.t >= 0.18 ? k * 0.14 : -wind * 0.04);
              arm.pivot.position.x += (side === 'L' ? -1 : 1) * (wind * 0.1 - (p.t >= 0.18 ? k * 0.22 : 0));
              arm.pivot.rotation.z = (side === 'L' ? -1 : 1) * (p.t >= 0.18 ? k * 0.7 : 0);
            }
          }
        }
        arms.setGlow(Math.min(1.4, s.combo * 0.25));

        // ---- camera: slip leans you out of the way; hits shake you
        const lean = s.slip > 0 ? Math.sin((s.slip / 0.36) * Math.PI) * (s.slipSide === 'L' ? -0.32 : 0.32) : 0;
        const off = feel.update(dt, t, 0.01);
        camera.position.set(lean + off.x, 1.62 + Math.sin(t * 3.1) * 0.012 - Math.abs(lean) * 0.25 + off.y, 1.55);
        camera.lookAt(lean * 0.3, 1.45, -1);
        camera.rotation.z += -lean * 0.25;

        // camera flashes in the crowd
        if (Math.random() < dt * (s.playing ? 5 : 2)) flashes.emit(crowdPos[Math.floor(Math.random() * crowdPos.length)], 0xffffff, { count: 1, speed: 0, life: 0.12, gravity: 0, size: 1.8 });

        if (s.playing) pushAll();
      });

      return () => {
        arms.reset();
        api.current = { start: () => {}, jab: () => {}, hay: () => {}, block: () => {}, slip: () => {} };
      };
    },
    [stableAvatar],
  );

  const bar = (v: number, colorA: string, colorB: string, align: 'left' | 'right') => (
    <div className="h-3.5 flex-1 rounded-full bg-black/60 border border-white/20 overflow-hidden" style={{ direction: align === 'right' ? 'rtl' : 'ltr' }}>
      <div className="h-full transition-[width] duration-200" style={{ width: `${v}%`, background: `linear-gradient(90deg, ${colorA}, ${colorB})` }} />
    </div>
  );

  return (
    <GameShell
      title={TITLE}
      accent="#ef4444"
      hostRef={hostRef}
      popupsRef={popups}
      phase={phase}
      onStart={startGame}
      score={hud.score}
      timeLeft={phase === 'ready' ? ROUND_S : hud.timeLeft}
      roundSeconds={ROUND_S}
      chips={
        <span className="px-2 py-0.5 rounded-full bg-black/55 text-amber-200 text-[11px] font-black whitespace-nowrap" data-testid="fight-round">
          ROUND {hud.round}/{ROUNDS}
        </span>
      }
      rival={rival}
      match={match}
      onExit={onExit}
      surface={surface}
      hint="Tap = jab · swipe ↑ = haymaker · ↓ block · ← → slip"
      directions={<FightDirections />}
      guide={{
        goal: 'Knock him out — or win on health after 3 rounds.',
        controls: [
          { gesture: 'tap', label: 'Jab' },
          { gesture: 'swipe-up', label: 'Haymaker' },
          { gesture: 'swipe-down', label: 'Block' },
        ],
        points: [
          { label: 'Jab', value: '1' },
          { label: 'Haymaker', value: '3', tone: 'bonus' },
          { label: 'Counter', value: '+2', tone: 'gold' },
          { label: 'Slip', value: '+1', tone: 'bonus' },
          { label: 'KO win', value: '+20', tone: 'jackpot' },
        ],
        ends: '3 rounds × 45s · KO ends it early',
      }}
      tutorial={[
        { icon: <Hand className="w-6 h-6" />, label: 'Tap = jab' },
        { icon: <Zap className="w-6 h-6" />, label: 'Swipe ↑ = haymaker' },
        { icon: <Shield className="w-6 h-6" />, label: 'Read his glove' },
      ]}
      scoring="Both fighters start at 100% health. Tap the left or right of the screen to jab with that hand; swipe up to throw a haymaker (heavy, costs stamina); swipe down to block; swipe left or right to slip. Punch the side he isn't guarding — a jab into his guard is blocked, a haymaker smashes through it. When his glove pulls back and glows he's winding up: slip or block it, or land a haymaker first for a COUNTER that stops his punch. Punch right after he misses for a PUNISH. Spamming drains your stamina, he covers up against flurries, and from round 2 he slips haymakers he sees coming. Jab 1 · haymaker 3 · counter +2 · punish +1 · slip +1 · KO win +20 · decision win +10 · +1 per 10% health left. Three rounds of 45 seconds; a knockout ends it early. Same opponent for every player."
    >
      <div ref={flashRef} className="absolute inset-0 z-10 pointer-events-none opacity-0" style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(220,20,20,0.6) 100%)' }} />
      {phase !== 'ready' && (
        <div className="absolute inset-x-0 top-[calc(env(safe-area-inset-top)+92px)] z-20 px-3 pointer-events-none" data-testid="fight-hud">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-black text-white w-12">YOU</span>
            {bar(hud.you, '#16a34a', '#86efac', 'left')}
            <span className="text-[11px] font-black text-white tabular-nums w-9 text-right" data-testid="fight-you">
              {hud.you}%
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[9px] font-black text-rose-300 w-12 truncate">{hud.foeName.split(' ').pop()}</span>
            {bar(hud.foe, '#dc2626', '#fca5a5', 'left')}
            <span className="text-[11px] font-black text-white tabular-nums w-9 text-right" data-testid="fight-foe">
              {hud.foe}%
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[9px] font-black text-sky-200 w-12">STAMINA</span>
            <div className="h-1.5 flex-1 rounded-full bg-black/60 overflow-hidden">
              <div className="h-full bg-sky-400 transition-[width] duration-150" style={{ width: `${Math.max(0, hud.stamina)}%` }} />
            </div>
            <span className="w-9" />
          </div>
        </div>
      )}
    </GameShell>
  );
}

/** Picture directions: four cards (gesture + one word). Shown before GO, then they fade. */
function FightDirections() {
  const card = 'flex flex-col items-center gap-1 rounded-2xl bg-black/55 border border-white/10 px-2 py-2.5';
  const word = 'text-[11px] font-black tracking-widest text-white';
  const glove = (x: number, y: number, c = '#dc2626') => (
    <g>
      <ellipse cx={x} cy={y} rx="11" ry="12" fill={c} />
      <rect x={x - 8} y={y + 9} width="16" height="7" rx="2" fill="#f8fafc" />
    </g>
  );
  return (
    <div className="grid grid-cols-4 gap-1.5" data-testid="fight-directions">
      <div className={card}>
        <svg viewBox="0 0 64 48" className="w-14 h-11" aria-hidden>
          <rect x="2" y="4" width="28" height="40" rx="5" fill="#ffffff14" />
          <rect x="34" y="4" width="28" height="40" rx="5" fill="#ffffff14" />
          <circle cx="16" cy="24" r="6" fill="#fde047" className="ra-dir-x" />
          <circle cx="48" cy="24" r="6" fill="#fde047" className="ra-dir-x" />
        </svg>
        <span className={word}>TAP · JAB</span>
      </div>
      <div className={card}>
        <svg viewBox="0 0 64 48" className="w-14 h-11" aria-hidden>
          {glove(32, 30)}
          <g className="ra-dir-up">
            <path d="M32 16 l0 -12 m0 0 l-6 6 m6 -6 l6 6" stroke="#fb923c" strokeWidth="4" strokeLinecap="round" fill="none" />
          </g>
        </svg>
        <span className={word}>↑ POWER</span>
      </div>
      <div className={card}>
        <svg viewBox="0 0 64 48" className="w-14 h-11" aria-hidden>
          {glove(22, 18)}
          {glove(42, 18)}
          <g className="ra-dir-down">
            <path d="M32 30 l0 12 m0 0 l-6 -6 m6 6 l6 -6" stroke="#60a5fa" strokeWidth="4" strokeLinecap="round" fill="none" />
          </g>
        </svg>
        <span className={word}>↓ BLOCK</span>
      </div>
      <div className={card}>
        <svg viewBox="0 0 64 48" className="w-14 h-11" aria-hidden>
          <circle cx="32" cy="18" r="9" fill="#e5e7eb" />
          <rect x="24" y="27" width="16" height="17" rx="5" fill="#e5e7eb" />
          <g className="ra-dir-x">
            <path d="M14 24 l-9 0 m0 0 l5 -5 m-5 5 l5 5" stroke="#86efac" strokeWidth="4" strokeLinecap="round" fill="none" />
            <path d="M50 24 l9 0 m0 0 l-5 -5 m5 5 l-5 5" stroke="#86efac" strokeWidth="4" strokeLinecap="round" fill="none" />
          </g>
        </svg>
        <span className={word}>← → SLIP</span>
      </div>
    </div>
  );
}
