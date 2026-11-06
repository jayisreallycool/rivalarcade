'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
import {
  Pool,
  ParticleBursts,
  CameraFeel,
  addArenaLights,
  createCityscape,
  createFirstPersonRig,
  createNeonGridFloor,
  createStarfield,
  neonMaterial,
  useGameEngine,
  useLatest,
  useStructuralMemo,
  useThrottledHud,
} from '@/lib/engine';
import { GameProps } from '@/lib/game-types';
import { mulberry32, randomSeed } from '@/lib/rng';
import { ROUND_SECONDS, CLUTCH_SECONDS, FIRE_STREAK, PTS, award as scoreAward, popStyle, ScoreBook, onFire } from '@/lib/scoring';
import GameShell, { PopupApi, useSwipe } from './GameShell';
import { ArrowLeftRight, ArrowUp, ArrowDown } from 'lucide-react';

type NeonDash3DProps = GameProps;

type ObstacleType = 'spike' | 'laser_arch' | 'crystal';

interface Obstacle {
  obj: THREE.Object3D;
  lane: number;
  type: ObstacleType;
  collected: boolean;
  gold?: boolean;
  /** You dodged it at the last moment (jump / slide / lane change while it was right on you). */
  close?: boolean;
}

const LANES = [-2.5, 0, 2.5];
/**
 * Difficulty curve (by time into the run, identical for every player on a seed):
 *   0–8s   quick road, wide gaps, only spikes + crystals  → learn lane swipes and jumping
 *   8–25s  speed builds hard, laser arches (slide) join the mix
 *   25s+   top speed, tight gaps, double-lane walls
 * Three shields: a hit costs one (and your combo) instead of ending the run.
 * Skill: dodge at the last moment (jump, slide or change lane with the hazard right on you) for a
 * CLOSE CALL bonus — the best players cut it fine on purpose.
 */
const BASE_SPEED = 17;
const MAX_SPEED = 38;
const RAMP_SECONDS = 40;
const GAP_EASY = 36;
const GAP_HARD = 19;
/** A dodge counts as a CLOSE CALL if you reacted with the hazard less than this many seconds away. */
const CLOSE_S = 0.32;
const SHIELDS = 3;
const INVULN = 1.4;
const ramp = (elapsed: number) => {
  const x = Math.min(1, Math.max(0, elapsed / RAMP_SECONDS));
  return x * x * (3 - 2 * x); // smoothstep: gentle start, gentle top-out
};
const CITY_SEGMENT = 180;
const CELL_LENGTH = 4;

type Phase = 'ready' | 'playing' | 'over';

export default function NeonDash3DGame({ avatar, onFinish, seed, rival, match, onExit }: NeonDash3DProps) {
  const seedRef = useLatest(seed);
  // Gameplay randomness (lanes, obstacle types) comes from the match seed → identical runs for every player.
  const rngRef = useRef(mulberry32(seed ?? randomSeed()));
  const stableAvatar = useStructuralMemo(avatar);
  const onFinishRef = useLatest(onFinish);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, combo: 0, distance: 0, timeLeft: ROUND_SECONDS, clutch: false, shields: SHIELDS });
  const popups = useRef<PopupApi | null>(null);
  const resetWorldRef = useRef<() => void>(() => {});
  const flashRef = useRef<HTMLDivElement | null>(null);
  /** Red edge flash when you take a hit (first person has no body to see it on). */
  const hitFlash = useCallback(() => {
    const el = flashRef.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.opacity = '1';
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 600ms ease-out';
      el.style.opacity = '0';
    });
  }, []);

  // Simulation state lives in a ref: the render loop reads it every frame without React re-renders.
  const sim = useRef({
    playing: false,
    currentLane: 1,
    targetX: 0,
    currentX: 0,
    playerY: 0,
    playerVy: 0,
    isJumping: false,
    isSliding: false,
    slideTimer: 0,
    speed: BASE_SPEED,
    score: 0,
    combo: 0,
    distance: 0,
    nextSpawnZ: -30,
    action: 'idle' as 'idle' | 'run' | 'jump' | 'slide',
    shake: 0,
    bestCombo: 0,
    timeLeft: ROUND_SECONDS,
    clutchAnnounced: false,
    book: new ScoreBook(),
    golds: 0,
    crystals: 0,
    dodges: 0,
    shields: SHIELDS,
    invuln: 0,
    hits: 0,
  });

  const totalScore = () => Math.floor(sim.current.score);
  const obstaclesRef = useRef<Obstacle[]>([]);
  /** Mark hazards of these types in this lane that are about to reach you as close calls. */
  const markClose = (lane: number, types: ObstacleType[]) => {
    const s = sim.current;
    const near = -s.speed * CLOSE_S;
    for (const o of obstaclesRef.current) if (o.lane === lane && types.includes(o.type) && !o.collected && o.obj.position.z > near && o.obj.position.z < -0.8) o.close = true;
  };

  const changeLane = useCallback((dir: -1 | 1) => {
    const s = sim.current;
    if (!s.playing) return;
    const next = Math.max(0, Math.min(2, s.currentLane + dir));
    if (next !== s.currentLane) {
      markClose(s.currentLane, ['spike', 'laser_arch']);
      s.currentLane = next;
      s.targetX = LANES[next];
      sound.playLaser();
      haptic('tap');
    }
  }, []);

  const jump = useCallback(() => {
    const s = sim.current;
    if (!s.playing || s.isJumping) return;
    markClose(s.currentLane, ['spike']);
    s.playerVy = 15;
    s.isJumping = true;
    s.isSliding = false;
    s.action = 'jump';
    sound.playJump();
    haptic('tap');
  }, []);

  const slide = useCallback(() => {
    const s = sim.current;
    if (!s.playing || s.isSliding) return;
    markClose(s.currentLane, ['laser_arch']);
    s.isSliding = true;
    s.slideTimer = 0.5;
    s.action = 'slide';
    // Fast-fall out of a jump so slide is responsive mid-air
    if (s.isJumping) s.playerVy = Math.min(s.playerVy, -14);
    sound.playLaser();
  }, []);

  const startGame = useCallback(() => {
    const s = sim.current;
    Object.assign(s, {
      currentLane: 1,
      targetX: 0,
      currentX: 0,
      playerY: 0,
      playerVy: 0,
      isJumping: false,
      isSliding: false,
      slideTimer: 0,
      speed: BASE_SPEED,
      score: 0,
      combo: 0,
      distance: 0,
      nextSpawnZ: -18, // first hazard ~3.5s after GO
      action: 'run',
      shake: 0,
      bestCombo: 0,
      timeLeft: ROUND_SECONDS,
      clutchAnnounced: false,
      book: new ScoreBook(),
      golds: 0,
      crystals: 0,
      dodges: 0,
      shields: SHIELDS,
      invuln: 0,
      hits: 0,
      playing: true,
    });
    rngRef.current = mulberry32(seedRef.current ?? randomSeed());
    resetWorldRef.current();
    pushHud({ score: 0, combo: 0, distance: 0, timeLeft: ROUND_SECONDS, clutch: false, shields: SHIELDS }, true);
    setPhase('playing');
  }, [pushHud, seedRef]);

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        changeLane(-1);
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        changeLane(1);
      } else if (e.code === 'ArrowUp' || e.code === 'Space' || e.code === 'KeyW') {
        e.preventDefault();
        jump();
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        slide();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [changeLane, jump, slide]);

  // Swipes fire the moment the finger has moved ~28px (no need to lift) → instant lane changes.
  const surface = useSwipe({
    earlyThreshold: 28,
    onSwipe: ({ dx, dy }) => {
      if (Math.abs(dx) > Math.abs(dy)) changeLane(dx > 0 ? 1 : -1);
      else if (dy < 0) jump();
      else slide();
    },
    onTap: () => jump(),
  });

  // ---------------------------------------------------------------- 3D world (built once per avatar)
  const { hostRef } = useGameEngine(
    {
      background: 0x070810,
      fog: { density: 0.016 },
      camera: { fov: 74, near: 0.03, far: 220, position: [0, 1.55, 0.4], lookAt: [0, 1.2, -12] },
      exposure: 1.15,
      bloom: { strength: 0.65, radius: 0.22, threshold: 0.85 },
      environment: 0.6,
      studio: { top: 0x2a1640, left: 0x00f0ff, right: 0xff2d7a },
    },
    (engine) => {
      const { scene, camera, quality } = engine;

      // First person: you ARE the runner. Eye height 1.55 m, wider lens on tall phone screens
      // so all three lanes ahead stay in view.
      const EYE = 1.55;
      const SLIDE_EYE = 0.62;
      const view = { fov: 74 };
      engine.onResize((_w, _h, aspect) => {
        view.fov = aspect < 0.6 ? 86 : aspect < 0.8 ? 80 : 72;
        camera.fov = view.fov;
        camera.updateProjectionMatrix();
      });
      const feel = new CameraFeel();
      let eye = EYE;
      let roll = 0;

      addArenaLights(engine, { sky: 0x7fdfff, hemi: 0.9, key: 1.8, keyPos: [8, 16, 10], rim: 0xff0055, shadowFrustum: 10 });

      // Road: scrolling neon grid (lane lines are the grid columns)
      const road = createNeonGridFloor(engine, { width: 7.5, length: 240, cells: [3, 240 / CELL_LENGTH], color: '#00f0ff', lineWidth: 3, gloss: 1 });
      road.mesh.position.z = -100;
      scene.add(road.mesh);

      // Glowing rails
      const railMat = neonMaterial(0x00f0ff, 1.15);
      const railGeo = new THREE.BoxGeometry(0.1, 0.22, 240);
      [-3.95, 3.95].forEach((x) => {
        const rail = new THREE.Mesh(railGeo, railMat);
        rail.position.set(x, 0.15, -100);
        scene.add(rail);
      });

      // Skyline treadmill: two instanced segments leap-frog for an endless city (2 draw calls)
      const cityA = createCityscape(engine, { count: 30, zMin: -CITY_SEGMENT, zMax: 0, xInner: 9, xOuter: 28 });
      const cityB = createCityscape(engine, { count: 30, zMin: -CITY_SEGMENT, zMax: 0, xInner: 9, xOuter: 28 });
      cityB.position.z = -CITY_SEGMENT;
      scene.add(cityA, cityB);

      scene.add(createStarfield(engine, { count: 500, radius: 160, yMin: 18 }));

      // Speed lines: streaks rushing past the edges, stretched by speed (1 draw call)
      const STREAKS = Math.round(70 * quality.propDensity);
      const streakPos = new Float32Array(STREAKS * 6);
      const streakSeed = Array.from({ length: STREAKS }, () => ({ x: (Math.random() < 0.5 ? -1 : 1) * (4.6 + Math.random() * 7), y: 0.4 + Math.random() * 7, z: -90 + Math.random() * 95 }));
      const streakGeo = new THREE.BufferGeometry();
      streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
      const streaks = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(0x9fefff).multiplyScalar(1.4), transparent: true, opacity: 0.55, toneMapped: false }));
      streaks.frustumCulled = false;
      scene.add(streaks);

      // Synthwave horizon sun (unlit, unfogged, bright enough to bloom)
      const sunCanvas = document.createElement('canvas');
      sunCanvas.width = sunCanvas.height = 256;
      const sctx = sunCanvas.getContext('2d')!;
      const grad = sctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#ffb800');
      grad.addColorStop(0.55, '#ff0055');
      grad.addColorStop(1, '#8b5cf6');
      sctx.fillStyle = grad;
      sctx.beginPath();
      sctx.arc(128, 128, 126, 0, Math.PI * 2);
      sctx.fill();
      sctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 7; i++) sctx.fillRect(0, 140 + i * 16, 256, 3 + i * 1.5);
      const sunTex = engine.own(new THREE.CanvasTexture(sunCanvas));
      sunTex.colorSpace = THREE.SRGBColorSpace;
      const sun = new THREE.Mesh(
        new THREE.PlaneGeometry(70, 70),
        new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false, toneMapped: false, depthWrite: false }),
      );
      sun.position.set(0, 16, -190);
      scene.add(sun);

      // Player: your own arms pump at the bottom of the screen.
      const arms = createFirstPersonRig(engine, stableAvatar, { spread: 0.27, drop: 0.42, depth: 0.5 });

      const particles = new ParticleBursts(engine);

      // Shared obstacle resources (owned → disposed even while pooled out of the scene)
      const spikeGeo = engine.own(new THREE.ConeGeometry(0.7, 1.4, 6));
      const spikeMat = engine.own(new THREE.MeshPhysicalMaterial({ color: 0xff0055, emissive: 0xff0055, emissiveIntensity: 0.9, roughness: 0.18, metalness: 0.3, clearcoat: 1 }));
      const beamGeo = engine.own(new THREE.BoxGeometry(2.3, 0.3, 0.3));
      const beamMat = engine.own(neonMaterial(0xffb800, 2.4));
      const postGeo = engine.own(new THREE.CylinderGeometry(0.1, 0.1, 2.0, 8));
      const postMat = engine.own(new THREE.MeshPhysicalMaterial({ color: 0x1a1d2e, metalness: 0.9, roughness: 0.28, clearcoat: 0.6 }));
      const crystalGeo = engine.own(new THREE.OctahedronGeometry(0.5, 0));
      const crystalMat = engine.own(new THREE.MeshPhysicalMaterial({ color: 0x00f0ff, emissive: 0x00f0ff, emissiveIntensity: 1.1, roughness: 0.05, metalness: 0.2, clearcoat: 1, iridescence: 0.8, envMapIntensity: 2, flatShading: true }));
      const goldCrystalMat = engine.own(new THREE.MeshPhysicalMaterial({ color: 0xffd34d, emissive: 0xffaa00, emissiveIntensity: 1.2, roughness: 0.05, metalness: 0.6, clearcoat: 1, envMapIntensity: 2, flatShading: true }));

      const show = (o: THREE.Object3D) => scene.add(o);
      const hide = (o: THREE.Object3D) => scene.remove(o);
      const pools: Record<ObstacleType, Pool<THREE.Object3D>> = {
        spike: new Pool<THREE.Object3D>(() => {
          const m = new THREE.Mesh(spikeGeo, spikeMat);
          m.castShadow = quality.shadows;
          return m;
        }, show, hide),
        laser_arch: new Pool<THREE.Object3D>(() => {
          const g = new THREE.Group();
          const beam = new THREE.Mesh(beamGeo, beamMat);
          beam.position.y = 1.6;
          const p1 = new THREE.Mesh(postGeo, postMat);
          p1.position.set(-1.1, 1.0, 0);
          const p2 = new THREE.Mesh(postGeo, postMat);
          p2.position.set(1.1, 1.0, 0);
          g.add(beam, p1, p2);
          return g;
        }, show, hide),
        crystal: new Pool<THREE.Object3D>(() => new THREE.Mesh(crystalGeo, crystalMat), show, hide),
      };
      Object.values(pools).forEach((p) => p.warm(6));

      const obstacles: Obstacle[] = obstaclesRef.current;
      // Test hook (?debug): lets automated play-tests see the road like a player does.
      if (new URLSearchParams(window.location.search).has('debug')) {
        (window as unknown as { __dash?: unknown }).__dash = { sim: sim.current, obstacles: () => obstacles.map((o) => ({ lane: o.lane, z: o.obj.position.z, type: o.type, collected: o.collected })) };
      }
      const tmp = new THREE.Vector3();
      const drift = new THREE.Vector3();

      resetWorldRef.current = () => {
        obstacles.forEach((o) => pools[o.type].release(o.obj));
        obstacles.length = 0;
        particles.clear();
      };

      /** Score one moment in the shared language (1 a dodge or crystal, gold 3, finish 5). */
      const award = (parts: Record<string, number>, streak = 0) => {
        const s = sim.current;
        const a = scoreAward(Object.values(parts).reduce((x, y) => x + y, 0), { streak, timeLeft: s.playing ? s.timeLeft : undefined });
        s.book.record(a, parts);
        s.score = s.book.score;
        return a.total;
      };

      const endRun = (survived: boolean) => {
        const s = sim.current;
        s.playing = false;
        if (survived) {
          s.action = 'idle';
          award({ 'Finished the run': PTS.jackpot });
          popups.current?.banner(`FINISHED! +${PTS.jackpot}`, '#5fe8ff');
          sound.playWin();
          haptic('big');
          engine.flash(0.6);
        } else {
          s.action = 'idle';
          feel.kick(1);
          hitFlash();
          engine.flash(1.2);
          tmp.set(s.currentX, 1, -1.5);
          particles.emit(tmp, 0xff0055, { count: 40, speed: 7, life: 0.9 });
          popups.current?.banner('CRASHED', '#fb7185');
          sound.playLose();
          haptic('fail');
        }
        const final = totalScore();
        const breakdown = s.book.breakdown();
        pushHud({ score: final, distance: Math.floor(s.distance), timeLeft: Math.max(0, s.timeLeft), clutch: false }, true);
        setPhase('over');
        onFinishRef.current(final, { maxCombo: s.bestCombo, distance: Math.floor(s.distance), breakdown });
      };


      engine.addUpdate((dt, t) => {
        const s = sim.current;
        const scroll = s.playing ? s.speed : 5;

        // Scenery always drifts so the menu screen feels alive
        road.texture.offset.y = (road.texture.offset.y + (scroll * dt) / CELL_LENGTH) % 1;
        const streakLen = 0.6 + scroll * 0.09;
        for (let i = 0; i < STREAKS; i++) {
          const st = streakSeed[i];
          st.z += scroll * 1.6 * dt;
          if (st.z > 8) st.z -= 98;
          streakPos.set([st.x, st.y, st.z, st.x, st.y, st.z - streakLen], i * 6);
        }
        streakGeo.attributes.position.needsUpdate = true;
        for (const city of [cityA, cityB]) {
          city.position.z += scroll * dt;
          if (city.position.z > CITY_SEGMENT) city.position.z -= CITY_SEGMENT * 2;
        }

        if (s.playing) {
          s.timeLeft -= dt;
          if (!s.clutchAnnounced && s.timeLeft <= CLUTCH_SECONDS) {
            s.clutchAnnounced = true;
            popups.current?.banner('CLUTCH TIME ×2', '#fbbf24');
            haptic('big');
          }
          if (s.timeLeft <= 0) {
            s.timeLeft = 0;
            endRun(true);
          }
        }

        if (s.playing) {
          s.distance += s.speed * dt;
          const k = ramp(ROUND_SECONDS - s.timeLeft);
          s.speed = BASE_SPEED + (MAX_SPEED - BASE_SPEED) * k;
          s.invuln = Math.max(0, s.invuln - dt);
          s.currentX += (s.targetX - s.currentX) * (1 - Math.exp(-14 * dt));

          if (s.isJumping) {
            s.playerVy -= 40 * dt;
            s.playerY += s.playerVy * dt;
            if (s.playerY <= 0) {
              s.playerY = 0;
              s.playerVy = 0;
              s.isJumping = false;
              s.action = s.isSliding ? 'slide' : 'run';
            }
          }
          if (s.isSliding) {
            s.slideTimer -= dt;
            if (s.slideTimer <= 0) {
              s.isSliding = false;
              s.action = s.isJumping ? 'jump' : 'run';
            }
          }

          // Spawn ahead
          if (s.nextSpawnZ > -130) {
            const k = ramp(ROUND_SECONDS - s.timeLeft);
            s.nextSpawnZ -= GAP_EASY + (GAP_HARD - GAP_EASY) * k;
            const rng = rngRef.current;
            const lane = Math.floor(rng() * 3);
            const roll = rng();
            const crystalP = 0.45 - 0.25 * k;
            const archP = k < 0.2 ? 0 : 0.4 * k; // slides join once you're warmed up
            const type: ObstacleType = roll < crystalP ? 'crystal' : roll < crystalP + archP ? 'laser_arch' : 'spike';
            const place = (t: ObstacleType, ln: number) => {
              const obj = pools[t].acquire();
              obj.position.set(LANES[ln], t === 'spike' ? 0.7 : t === 'crystal' ? 1.2 : 0, s.nextSpawnZ);
              obj.visible = true;
              // Some crystals are gold (worth 3); more of them as the road speeds up.
              const gold = t === 'crystal' && rng() < 0.12 + 0.12 * k;
              if (t === 'crystal') (obj as THREE.Mesh).material = gold ? goldCrystalMat : crystalMat;
              obstacles.push({ obj, lane: ln, type: t, collected: false, gold, close: false });
            };
            place(type, lane);
            // Late game: a second hazard in another lane, always leaving one lane open.
            const dbl = rng();
            if (type !== 'crystal' && k > 0.45 && dbl < 0.45 * k) place(rng() < 0.5 ? 'spike' : 'laser_arch', (lane + 1 + Math.floor(rng() * 2)) % 3);
            // Crystal trails early on reward lane changes.
            if (type !== 'crystal' && k < 0.5 && dbl > 0.7) place('crystal', (lane + 1) % 3);
          }
          s.nextSpawnZ += s.speed * dt;

          drift.set(0, 0, s.speed * 0.6);
          for (let i = obstacles.length - 1; i >= 0; i--) {
            const o = obstacles[i];
            o.obj.position.z += s.speed * dt;
            const z = o.obj.position.z;
            if (o.type === 'crystal') o.obj.rotation.y += 2.5 * dt;

            if (z > -1.2 && z < 1.2 && o.lane === s.currentLane) {
              const hit = (o.type === 'spike' && s.playerY < 0.9) || (o.type === 'laser_arch' && !s.isSliding);
              if (hit && !o.collected && s.invuln <= 0) {
                o.collected = true; // never hits twice
                s.shields -= 1;
                s.hits += 1;
                if (onFire(s.combo)) popups.current?.banner('FIRE OUT', '#94a3b8');
                s.combo = 0;
                if (s.shields <= 0) {
                  endRun(false);
                  break;
                }
                s.invuln = INVULN;
                feel.kick(0.8);
                hitFlash();
                engine.flash(0.8);
                particles.emit(o.obj.position, 0xff0055, { count: 26, speed: 6, life: 0.7 });
                o.obj.visible = false;
                popups.current?.banner(s.shields === 1 ? 'LAST SHIELD!' : 'SHIELD HIT', '#fb7185');
                sound.playLose();
                haptic('fail');
                pushHud({ shields: s.shields, combo: 0 }, true);
              }
              if (o.type === 'crystal' && !o.collected) {
                o.collected = true;
                o.obj.visible = false;
                s.combo += 1;
                s.bestCombo = Math.max(s.bestCombo, s.combo);
                const got = award(o.gold ? { Crystals: PTS.base, 'Gold crystals': PTS.gold - PTS.base } : { Crystals: PTS.base }, s.combo);
                s.crystals += 1;
                if (o.gold) s.golds += 1;
                const sp = engine.toScreen(o.obj.position);
                popups.current?.pop(`+${got}`, sp.x, sp.y - 20, popStyle(got, o.gold ? 'gold' : undefined));
                haptic('score');
                if (s.combo === FIRE_STREAK) popups.current?.banner('ON FIRE ×2', '#f43f5e');
                sound.playScore(1 + s.combo * 0.1);
                engine.flash(0.35);
                particles.emit(o.obj.position, 0x00f0ff, { count: 18, speed: 4.5, drift });
              }
            }

            if (z > 8) {
              if (o.type !== 'crystal' && s.playing && !o.collected) {
                s.combo += 1;
                s.bestCombo = Math.max(s.bestCombo, s.combo);
                const got = award(o.close ? { Dodges: PTS.base, 'Close calls': 1 } : { Dodges: PTS.base }, s.combo);
                s.dodges += 1;
                const sp = engine.toScreen(tmp.set(LANES[o.lane], 1.2, 2));
                const py = Math.min(sp.y, engine.renderer.domElement.clientHeight * 0.6);
                if (o.close) {
                  popups.current?.pop(`CLOSE CALL +${got}`, sp.x, py, { color: '#f0abfc', size: 'md' });
                  haptic('light');
                  engine.flash(0.15);
                } else popups.current?.pop(`+${got}`, sp.x, py, popStyle(got));
                if (s.combo === FIRE_STREAK) popups.current?.banner('ON FIRE ×2', '#f43f5e');
              }
              pools[o.type].release(o.obj);
              obstacles.splice(i, 1);
            }
          }

          pushHud({ score: totalScore(), combo: s.combo, distance: Math.floor(s.distance), timeLeft: Math.max(0, s.timeLeft), clutch: s.timeLeft <= CLUTCH_SECONDS });
        }

        // First-person camera: eye height follows jump / slide, lane changes lean the view,
        // footsteps bob it, hits shake it, and the lens widens with speed.
        const targetEye = (s.isSliding ? SLIDE_EYE : EYE) + s.playerY;
        eye += (targetEye - eye) * (1 - Math.exp(-(s.isSliding ? 22 : 16) * dt));
        const running = s.playing && !s.isJumping && !s.isSliding;
        const bob = running ? 0.035 + (s.speed - BASE_SPEED) * 0.0012 : 0;
        const off = feel.update(dt, t * (s.speed / BASE_SPEED), bob);
        camera.position.set(s.currentX + off.x, eye + off.y, 0.4);
        camera.lookAt(s.currentX * 0.92, eye - 0.38 - (s.isSliding ? 0.1 : 0), -12);
        roll += ((s.targetX - s.currentX) * -0.05 - roll) * (1 - Math.exp(-10 * dt));
        camera.rotateZ(roll);
        const targetFov = view.fov + (s.playing ? Math.min(9, (s.speed - BASE_SPEED) * 0.5) : 0);
        if (Math.abs(camera.fov - targetFov) > 0.05) {
          camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-4 * dt));
          camera.updateProjectionMatrix();
        }

        // Arms: pump while running, tuck while sliding, fling up on a jump; blink when shielded.
        if (s.isJumping) {
          arms.ready(t);
          arms.left.pivot.position.y += 0.08;
          arms.right.pivot.position.y += 0.08;
          arms.left.pivot.rotation.x = arms.right.pivot.rotation.x = 0.5;
        } else if (s.isSliding) {
          arms.ready(t);
          arms.left.pivot.position.y -= 0.12;
          arms.right.pivot.position.y -= 0.12;
        } else {
          arms.run(t, s.playing ? 7 + s.speed * 0.25 : 2.2, s.playing ? 1 : 0.25);
        }
        arms.root.visible = s.invuln <= 0 || Math.floor(t * 14) % 2 === 0;
        arms.setGlow(onFire(s.combo) ? 1.2 : 0);
      });

      return () => {
        resetWorldRef.current = () => {};
      };
    },
    [stableAvatar],
  );

  const chips = (
    <>
      <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${onFire(hud.combo) ? 'bg-orange-500 text-black' : 'bg-black/50 text-amber-300'}`}>{onFire(hud.combo) ? 'ON FIRE ×2 · ' : ''}{hud.combo} clean</span>
      <span className="px-2 py-0.5 rounded-full bg-black/50 text-[11px] font-black tracking-tight" data-testid="shields" aria-label={`${hud.shields} shields left`}>
        {Array.from({ length: SHIELDS }, (_, i) => (
          <span key={i} className={i < hud.shields ? 'text-cyan-300' : 'text-white/20'}>
            ◆
          </span>
        ))}
      </span>
      <span className="px-2 py-0.5 rounded-full bg-black/50 text-white/80 text-[11px] font-bold tabular-nums">{hud.distance}m</span>
    </>
  );

  return (
    <GameShell
      title="NEON DASH"
      accent="#22d3ee"
      hostRef={hostRef}
      popupsRef={popups}
      phase={phase}
      onStart={startGame}
      score={hud.score}
      timeLeft={phase === 'ready' ? ROUND_SECONDS : hud.timeLeft}
      roundSeconds={ROUND_SECONDS}
      clutch={hud.clutch}
      chips={chips}
      rival={rival}
      match={match}
      onExit={onExit}
      surface={surface}
      hint="← → lane · ↑ jump · ↓ slide"
      directions={<DashDirections />}
      guide={{
        goal: 'Dodge. Grab crystals. Survive 60s.',
        controls: [
          { gesture: 'swipe-x', label: 'Lane' },
          { gesture: 'swipe-up', label: 'Jump' },
          { gesture: 'swipe-down', label: 'Slide' },
        ],
        points: [
          { label: 'Dodge', value: '1' },
          { label: 'Crystal', value: '1' },
          { label: 'Close call', value: '+1', tone: 'bonus' },
          { label: 'Gold', value: '3', tone: 'gold' },
          { label: '5 clean', value: '×2', tone: 'fire' },
        ],
        ends: '60s · 3 shields',
      }}
      tutorial={[
        { icon: <ArrowLeftRight className="w-6 h-6" />, label: 'Lane' },
        { icon: <ArrowUp className="w-6 h-6" />, label: 'Jump' },
        { icon: <ArrowDown className="w-6 h-6" />, label: 'Slide' },
      ]}
      scoring="Swipe ← → to change lane, ↑ (or tap) to jump spikes, ↓ to slide under lasers. Every hazard you dodge and every crystal is 1 point · dodge at the very last moment for a CLOSE CALL +1 · gold crystal 3 · 5 clean in a row = ON FIRE ×2 · finish the run +5 · last 10s CLUTCH ×2. 3 shields; the road gets fast quickly. Same road for every player."
    >
      <div ref={flashRef} className="absolute inset-0 z-10 pointer-events-none opacity-0" style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(255,0,72,0.55) 100%)' }} />
    </GameShell>
  );
}

/**
 * Visual directions: three big picture cards (arrow + the hazard it beats + one word). Shown on the
 * start card and over the 3-2-1, then they fade away at GO.
 */
function DashDirections() {
  const card = 'flex flex-col items-center gap-1 rounded-2xl bg-black/55 border border-white/10 px-2 py-3';
  const word = 'text-xs font-black tracking-widest text-white';
  return (
    <div className="grid grid-cols-3 gap-2" data-testid="dash-directions">
      <div className={card}>
        <svg viewBox="0 0 80 56" className="w-20 h-14" aria-hidden>
          {[14, 40, 66].map((x) => (
            <rect key={x} x={x - 9} y={6} width={18} height={44} rx={3} fill={x === 40 ? '#22d3ee33' : '#ffffff12'} />
          ))}
          <g className="ra-dir-x">
            <path d="M28 28 l-12 0 m0 0 l7 -7 m-7 7 l7 7" stroke="#22d3ee" strokeWidth="5" strokeLinecap="round" fill="none" />
            <path d="M52 28 l12 0 m0 0 l-7 -7 m7 7 l-7 7" stroke="#22d3ee" strokeWidth="5" strokeLinecap="round" fill="none" />
          </g>
        </svg>
        <span className={word}>SWIPE</span>
      </div>
      <div className={card}>
        <svg viewBox="0 0 80 56" className="w-20 h-14" aria-hidden>
          <polygon points="40,52 28,52 34,36" fill="#ff0055" />
          <polygon points="52,52 40,52 46,36" fill="#ff0055" />
          <g className="ra-dir-up">
            <path d="M40 30 l0 -24 m0 0 l-8 8 m8 -8 l8 8" stroke="#a3e635" strokeWidth="5" strokeLinecap="round" fill="none" />
          </g>
        </svg>
        <span className={word}>JUMP</span>
      </div>
      <div className={card}>
        <svg viewBox="0 0 80 56" className="w-20 h-14" aria-hidden>
          <rect x="12" y="8" width="56" height="7" rx="3" fill="#ffb800" />
          <rect x="12" y="8" width="4" height="44" fill="#475569" />
          <rect x="64" y="8" width="4" height="44" fill="#475569" />
          <g className="ra-dir-down">
            <path d="M40 22 l0 24 m0 0 l-8 -8 m8 8 l8 -8" stroke="#f472b6" strokeWidth="5" strokeLinecap="round" fill="none" />
          </g>
        </svg>
        <span className={word}>SLIDE</span>
      </div>
    </div>
  );
}
