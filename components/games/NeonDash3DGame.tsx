'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { create3DAvatar } from '@/lib/avatar-3d-model';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
import {
  Pool,
  ParticleBursts,
  addArenaLights,
  createBlobShadow,
  createCityscape,
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
import GameShell, { PopupApi, useSwipe } from './GameShell';
import { ArrowLeftRight, ArrowUp, ArrowDown } from 'lucide-react';

type NeonDash3DProps = GameProps;

type ObstacleType = 'spike' | 'laser_arch' | 'crystal';

interface Obstacle {
  obj: THREE.Object3D;
  lane: number;
  type: ObstacleType;
  collected: boolean;
}

const LANES = [-2.5, 0, 2.5];
const BASE_SPEED = 22;
const MAX_SPEED = 36;
const CITY_SEGMENT = 180;
const CELL_LENGTH = 4;
const ROUND_SECONDS = 60;
const CLUTCH_SECONDS = 10;
const SURVIVAL_BONUS = 500;

type Phase = 'ready' | 'playing' | 'over';

export default function NeonDash3DGame({ avatar, onFinish, seed, rival, match, onExit }: NeonDash3DProps) {
  const seedRef = useLatest(seed);
  // Gameplay randomness (lanes, obstacle types) comes from the match seed → identical runs for every player.
  const rngRef = useRef(mulberry32(seed ?? randomSeed()));
  const stableAvatar = useStructuralMemo(avatar);
  const onFinishRef = useLatest(onFinish);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, combo: 1, distance: 0, timeLeft: ROUND_SECONDS, clutch: false });
  const popups = useRef<PopupApi | null>(null);
  const resetWorldRef = useRef<() => void>(() => {});

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
    combo: 1,
    distance: 0,
    nextSpawnZ: -30,
    action: 'idle' as 'idle' | 'run' | 'jump' | 'slide',
    shake: 0,
    bestCombo: 1,
    timeLeft: ROUND_SECONDS,
    clutchAnnounced: false,
    // score breakdown (base points; clutch extra tracked separately)
    pDistance: 0,
    pCrystals: 0,
    pDodges: 0,
    pSurvival: 0,
    pClutch: 0,
    crystals: 0,
    dodges: 0,
  });

  const totalScore = () => Math.floor(sim.current.score);

  const changeLane = useCallback((dir: -1 | 1) => {
    const s = sim.current;
    if (!s.playing) return;
    const next = Math.max(0, Math.min(2, s.currentLane + dir));
    if (next !== s.currentLane) {
      s.currentLane = next;
      s.targetX = LANES[next];
      sound.playLaser();
      haptic('tap');
    }
  }, []);

  const jump = useCallback(() => {
    const s = sim.current;
    if (!s.playing || s.isJumping) return;
    s.playerVy = 13.5;
    s.isJumping = true;
    s.isSliding = false;
    s.action = 'jump';
    sound.playJump();
    haptic('tap');
  }, []);

  const slide = useCallback(() => {
    const s = sim.current;
    if (!s.playing || s.isSliding) return;
    s.isSliding = true;
    s.slideTimer = 0.55;
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
      combo: 1,
      distance: 0,
      nextSpawnZ: -30,
      action: 'run',
      shake: 0,
      bestCombo: 1,
      timeLeft: ROUND_SECONDS,
      clutchAnnounced: false,
      pDistance: 0,
      pCrystals: 0,
      pDodges: 0,
      pSurvival: 0,
      pClutch: 0,
      crystals: 0,
      dodges: 0,
      playing: true,
    });
    rngRef.current = mulberry32(seedRef.current ?? randomSeed());
    resetWorldRef.current();
    pushHud({ score: 0, combo: 1, distance: 0, timeLeft: ROUND_SECONDS, clutch: false }, true);
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
      camera: { fov: 58, far: 220, position: [0, 3.8, 6.5], lookAt: [0, 1.2, -8] },
      exposure: 1.15,
      bloom: { strength: 0.65, radius: 0.22, threshold: 0.85 },
      environment: 0.3,
    },
    (engine) => {
      const { scene, camera, quality } = engine;

      // Portrait phones: higher, wider camera so all three lanes and upcoming hazards fit.
      const view = { fov: 58, y: 3.8, z: 6.5, lookY: 1.2 };
      engine.onResize((_w, _h, aspect) => {
        if (aspect < 0.8) Object.assign(view, { fov: 74, y: 5.0, z: 7.6, lookY: 0.6 });
        else Object.assign(view, { fov: 58, y: 3.8, z: 6.5, lookY: 1.2 });
        camera.fov = view.fov;
        camera.position.set(camera.position.x, view.y, view.z);
        camera.updateProjectionMatrix();
      });

      addArenaLights(engine, { sky: 0x7fdfff, hemi: 0.9, key: 1.8, keyPos: [8, 16, 10], rim: 0xff0055, shadowFrustum: 10 });

      // Road: scrolling neon grid (lane lines are the grid columns)
      const road = createNeonGridFloor(engine, { width: 7.5, length: 240, cells: [3, 240 / CELL_LENGTH], color: '#00f0ff', lineWidth: 3 });
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

      // Player
      const avatar3D = create3DAvatar(stableAvatar);
      engine.own(avatar3D);
      scene.add(avatar3D.group);
      const blob = createBlobShadow(engine, 0.55);
      blob.position.y = 0.03;
      scene.add(blob);

      const particles = new ParticleBursts(engine);

      // Shared obstacle resources (owned → disposed even while pooled out of the scene)
      const spikeGeo = engine.own(new THREE.ConeGeometry(0.7, 1.4, 6));
      const spikeMat = engine.own(new THREE.MeshStandardMaterial({ color: 0xff0055, emissive: 0xff0055, emissiveIntensity: 1.2, roughness: 0.3 }));
      const beamGeo = engine.own(new THREE.BoxGeometry(2.3, 0.3, 0.3));
      const beamMat = engine.own(neonMaterial(0xffb800, 2.4));
      const postGeo = engine.own(new THREE.CylinderGeometry(0.1, 0.1, 2.0, 8));
      const postMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x1a1d2e, metalness: 0.6, roughness: 0.4 }));
      const crystalGeo = engine.own(new THREE.OctahedronGeometry(0.5, 0));
      const crystalMat = engine.own(new THREE.MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x00f0ff, emissiveIntensity: 1.6, roughness: 0.1, metalness: 0.8 }));

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

      const obstacles: Obstacle[] = [];
      const tmp = new THREE.Vector3();
      const drift = new THREE.Vector3();

      resetWorldRef.current = () => {
        obstacles.forEach((o) => pools[o.type].release(o.obj));
        obstacles.length = 0;
        particles.clear();
      };

      /** Award points with the clutch multiplier and track the breakdown. */
      const award = (base: number, cat: 'pDistance' | 'pCrystals' | 'pDodges' | 'pSurvival') => {
        const s = sim.current;
        const mult = s.timeLeft <= CLUTCH_SECONDS ? 2 : 1;
        s[cat] += base;
        s.pClutch += base * (mult - 1);
        s.score += base * mult;
        return base * mult;
      };

      const endRun = (survived: boolean) => {
        const s = sim.current;
        s.playing = false;
        if (survived) {
          s.action = 'idle';
          award(SURVIVAL_BONUS, 'pSurvival');
          popups.current?.banner(`FINISHED! +${SURVIVAL_BONUS}`, '#5fe8ff');
          sound.playWin();
          haptic('big');
          engine.flash(0.6);
        } else {
          s.action = 'idle';
          s.shake = 0.45;
          engine.flash(1.2);
          tmp.set(s.currentX, 1, 0);
          particles.emit(tmp, 0xff0055, { count: 40, speed: 7, life: 0.9 });
          popups.current?.banner('CRASHED', '#fb7185');
          sound.playLose();
          haptic('fail');
        }
        const final = totalScore();
        const breakdown = [
          { label: `Distance (${Math.floor(s.distance)}m)`, points: Math.floor(s.pDistance) },
          { label: `Crystals (${s.crystals})`, points: s.pCrystals },
          { label: `Dodges (${s.dodges})`, points: s.pDodges },
          { label: 'Full-run bonus', points: s.pSurvival },
          { label: 'Clutch time ×2', points: Math.floor(s.pClutch) },
        ].filter((b) => b.points > 0);
        // Rounding: make the rows add up exactly to the score.
        const diff = final - breakdown.reduce((a, b) => a + b.points, 0);
        if (breakdown.length && diff) breakdown[0].points += diff;
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
          award((s.speed * dt) / 4, 'pDistance');
          s.distance += s.speed * dt;
          s.speed = Math.min(MAX_SPEED, BASE_SPEED + s.distance / 150);
          s.currentX += (s.targetX - s.currentX) * (1 - Math.exp(-14 * dt));

          if (s.isJumping) {
            s.playerVy -= 32 * dt;
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
            s.nextSpawnZ -= 20;
            const lane = Math.floor(rngRef.current() * 3);
            const roll = rngRef.current();
            const type: ObstacleType = roll < 0.45 ? 'spike' : roll < 0.8 ? 'laser_arch' : 'crystal';
            const obj = pools[type].acquire();
            obj.position.set(LANES[lane], type === 'spike' ? 0.7 : type === 'crystal' ? 1.2 : 0, s.nextSpawnZ);
            obj.visible = true;
            obstacles.push({ obj, lane, type, collected: false });
          }
          s.nextSpawnZ += s.speed * dt;

          drift.set(0, 0, s.speed * 0.6);
          for (let i = obstacles.length - 1; i >= 0; i--) {
            const o = obstacles[i];
            o.obj.position.z += s.speed * dt;
            const z = o.obj.position.z;
            if (o.type === 'crystal') o.obj.rotation.y += 2.5 * dt;

            if (z > -1.2 && z < 1.2 && o.lane === s.currentLane) {
              if (o.type === 'spike' && s.playerY < 0.9) {
                endRun(false);
                break;
              }
              if (o.type === 'laser_arch' && !s.isSliding) {
                endRun(false);
                break;
              }
              if (o.type === 'crystal' && !o.collected) {
                o.collected = true;
                o.obj.visible = false;
                const got = award(150 * s.combo, 'pCrystals');
                s.crystals += 1;
                const sp = engine.toScreen(o.obj.position);
                popups.current?.pop(`+${got}`, sp.x, sp.y - 20, { color: got >= 600 ? '#fde047' : '#7df9ff', size: got >= 600 ? 'lg' : 'md' });
                haptic('score');
                s.combo = Math.min(10, s.combo + 1);
                if (s.combo === 5) popups.current?.banner('COMBO ×5', '#7df9ff');
                if (s.combo === 10) popups.current?.banner('MAX COMBO ×10', '#fde047');
                s.bestCombo = Math.max(s.bestCombo, s.combo);
                sound.playScore(1 + s.combo * 0.1);
                engine.flash(0.35);
                particles.emit(o.obj.position, 0x00f0ff, { count: 18, speed: 4.5, drift });
              }
            }

            if (z > 8) {
              if (o.type !== 'crystal' && s.playing) {
                award(50 * s.combo, 'pDodges');
                s.dodges += 1;
              }
              pools[o.type].release(o.obj);
              obstacles.splice(i, 1);
            }
          }

          pushHud({ score: totalScore(), combo: s.combo, distance: Math.floor(s.distance), timeLeft: Math.max(0, s.timeLeft), clutch: s.timeLeft <= CLUTCH_SECONDS });
        }

        // Player transform + animation
        avatar3D.group.position.set(s.currentX, s.playerY, 0);
        avatar3D.updateAnimation(t, s.playing ? s.action : 'idle', dt);
        blob.position.x = s.currentX;
        const lift = Math.min(1, s.playerY / 3);
        blob.scale.setScalar(1 - lift * 0.5);
        (blob.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - lift * 0.7);

        // Camera: soft follow, speed FOV kick, impact shake
        const follow = 1 - Math.exp(-5 * dt);
        camera.position.x += (s.currentX * 0.4 - camera.position.x) * follow;
        camera.position.y += (view.y + s.playerY * 0.25 - camera.position.y) * follow;
        if (s.shake > 0) {
          s.shake = Math.max(0, s.shake - dt);
          const a = s.shake * 0.5;
          camera.position.x += (Math.random() - 0.5) * a;
          camera.position.y += (Math.random() - 0.5) * a;
        }
        const targetFov = view.fov + (s.playing ? (s.speed - BASE_SPEED) * 0.55 : 0);
        if (Math.abs(camera.fov - targetFov) > 0.05) {
          camera.fov += (targetFov - camera.fov) * follow;
          camera.updateProjectionMatrix();
        }
        camera.lookAt(camera.position.x * 0.5, view.lookY, -8);
      });

      return () => {
        resetWorldRef.current = () => {};
      };
    },
    [stableAvatar],
  );

  const chips = (
    <>
      <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${hud.combo >= 5 ? 'bg-amber-400 text-black' : 'bg-black/50 text-amber-300'}`}>×{hud.combo} COMBO</span>
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
      hint="Swipe ← → to switch lanes · ↑ jump · ↓ slide"
      tutorial={[
        { icon: <ArrowLeftRight className="w-6 h-6" />, label: 'Swipe to change lane' },
        { icon: <ArrowUp className="w-6 h-6" />, label: 'Swipe up / tap: jump spikes' },
        { icon: <ArrowDown className="w-6 h-6" />, label: 'Swipe down: slide lasers' },
      ]}
      scoring="60-second run on the shared seed. Crystals 150 × combo · Dodges 50 × combo · Finish without crashing +500 · Last 10s ×2."
    />
  );
}
