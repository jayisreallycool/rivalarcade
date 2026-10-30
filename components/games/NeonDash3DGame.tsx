'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { create3DAvatar } from '@/lib/avatar-3d-model';
import { sound, useMuted } from '@/lib/sound';
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
import RivalBar from './RivalBar';
import { Play, RotateCcw, Volume2, VolumeX, ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react';

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

type Phase = 'ready' | 'playing' | 'over';

export default function NeonDash3DGame({ avatar, onFinish, modeName = 'Match', seed, rival }: NeonDash3DProps) {
  const seedRef = useLatest(seed);
  // Gameplay randomness (lanes, obstacle types) comes from the match seed → identical runs for every player.
  const rngRef = useRef(mulberry32(seed ?? randomSeed()));
  const stableAvatar = useStructuralMemo(avatar);
  const onFinishRef = useLatest(onFinish);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, combo: 1, distance: 0 });
  const isMuted = useMuted();
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
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
  });

  const totalScore = () => sim.current.score + Math.floor(sim.current.distance / 4);

  const changeLane = useCallback((dir: -1 | 1) => {
    const s = sim.current;
    if (!s.playing) return;
    const next = Math.max(0, Math.min(2, s.currentLane + dir));
    if (next !== s.currentLane) {
      s.currentLane = next;
      s.targetX = LANES[next];
      sound.playLaser();
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
      playing: true,
    });
    rngRef.current = mulberry32(seedRef.current ?? randomSeed());
    resetWorldRef.current();
    pushHud({ score: 0, combo: 1, distance: 0 }, true);
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
        if (phase === 'ready') startGame();
        else jump();
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        slide();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, changeLane, jump, slide, startGame]);

  // Swipe (pointer events cover mouse + touch + pen, so no double-firing)
  const handlePointerDown = (e: React.PointerEvent) => {
    touchStartRef.current = { x: e.clientX, y: e.clientY };
  };
  const handlePointerUp = (e: React.PointerEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 35) changeLane(1);
      else if (dx < -35) changeLane(-1);
    } else if (dy < -35) jump();
    else if (dy > 35) slide();
  };

  // ---------------------------------------------------------------- 3D world (built once per avatar)
  const { hostRef } = useGameEngine(
    {
      background: 0x070810,
      fog: { density: 0.016 },
      camera: { fov: 58, far: 220, position: [0, 3.8, 6.5], lookAt: [0, 1.2, -8] },
      exposure: 1.15,
      bloom: { strength: 0.65, radius: 0.22, threshold: 0.85 },
    },
    (engine) => {
      const { scene, camera, quality } = engine;

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

      const endRun = () => {
        const s = sim.current;
        s.playing = false;
        s.action = 'idle';
        s.shake = 0.45;
        engine.flash(1.2);
        tmp.set(s.currentX, 1, 0);
        particles.emit(tmp, 0xff0055, { count: 40, speed: 7, life: 0.9 });
        sound.playLose();
        const final = totalScore();
        pushHud({ score: final, distance: Math.floor(s.distance) }, true);
        setPhase('over');
        onFinishRef.current(final, { maxCombo: s.bestCombo, distance: Math.floor(s.distance) });
      };

      const baseFov = camera.fov;

      engine.addUpdate((dt, t) => {
        const s = sim.current;
        const scroll = s.playing ? s.speed : 5;

        // Scenery always drifts so the menu screen feels alive
        road.texture.offset.y = (road.texture.offset.y + (scroll * dt) / CELL_LENGTH) % 1;
        for (const city of [cityA, cityB]) {
          city.position.z += scroll * dt;
          if (city.position.z > CITY_SEGMENT) city.position.z -= CITY_SEGMENT * 2;
        }

        if (s.playing) {
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
                endRun();
                break;
              }
              if (o.type === 'laser_arch' && !s.isSliding) {
                endRun();
                break;
              }
              if (o.type === 'crystal' && !o.collected) {
                o.collected = true;
                o.obj.visible = false;
                s.score += 150 * s.combo;
                s.combo = Math.min(10, s.combo + 1);
                s.bestCombo = Math.max(s.bestCombo, s.combo);
                sound.playScore(1 + s.combo * 0.1);
                engine.flash(0.35);
                particles.emit(o.obj.position, 0x00f0ff, { count: 18, speed: 4.5, drift });
              }
            }

            if (z > 8) {
              if (o.type !== 'crystal') s.score += 50 * s.combo;
              pools[o.type].release(o.obj);
              obstacles.splice(i, 1);
            }
          }

          pushHud({ score: totalScore(), combo: s.combo, distance: Math.floor(s.distance) });
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
        camera.position.y += (3.8 + s.playerY * 0.25 - camera.position.y) * follow;
        if (s.shake > 0) {
          s.shake = Math.max(0, s.shake - dt);
          const a = s.shake * 0.5;
          camera.position.x += (Math.random() - 0.5) * a;
          camera.position.y += (Math.random() - 0.5) * a;
        }
        const targetFov = baseFov + (s.playing ? (s.speed - BASE_SPEED) * 0.55 : 0);
        if (Math.abs(camera.fov - targetFov) > 0.05) {
          camera.fov += (targetFov - camera.fov) * follow;
          camera.updateProjectionMatrix();
        }
        camera.lookAt(camera.position.x * 0.5, 1.2, -8);
      });

      return () => {
        resetWorldRef.current = () => {};
      };
    },
    [stableAvatar],
  );

  const playing = phase === 'playing';

  return (
    <div className="relative flex flex-col items-center w-full max-w-3xl mx-auto select-none">
      {/* Top HUD */}
      <div className="w-full flex items-center justify-between px-4 py-2.5 bg-[#12131d] border-b border-[#242738] rounded-t-xl text-sm gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-extrabold tracking-wider text-cyan-400 text-xs sm:text-sm whitespace-nowrap">NEON DASH 3D</span>
          <span className="text-xs text-slate-400 hidden sm:inline">· {modeName}</span>
        </div>
        <div className="flex items-center gap-2.5 sm:gap-5 font-mono text-xs sm:text-sm">
          <div className="text-slate-300">
            <span className="hidden sm:inline">SCORE: </span><span className="text-white font-bold text-sm sm:text-base tabular-nums">{hud.score}</span>
          </div>
          <div className="text-amber-400 font-bold">
            {hud.combo}x <span className="text-xs text-amber-500 font-normal">COMBO</span>
          </div>
          <div className="text-xs text-slate-400 tabular-nums">{hud.distance}m</div>
          <button onClick={() => sound.toggleMute()} className="p-1 hover:text-cyan-400 text-slate-400 transition-colors">
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
          </button>
        </div>
      </div>

      {rival && <RivalBar rival={rival} score={hud.score} />}

      {/* 3D viewport */}
      <div
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => (touchStartRef.current = null)}
        className="relative w-full aspect-[16/9] bg-[#070810] overflow-hidden border-x border-[#242738] touch-none cursor-grab active:cursor-grabbing"
      >
        <div ref={hostRef} className="absolute inset-0" />

        {phase === 'ready' && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center p-6 text-center z-10">
            <h2 className="text-3xl font-black italic tracking-wide text-cyan-400 mb-2">NEON DASH 3D</h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-md mb-6">
              Full 3D Cyberpunk Highway! Swipe or drag Left/Right to change lanes, Swipe Up to jump red spikes, and Swipe Down to slide under yellow laser arches.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-400 mb-6">
              <span className="flex items-center gap-1.5"><kbd className="bg-slate-800 px-2 py-1 rounded text-cyan-300">Swipe ← / →</kbd> Switch Lane</span>
              <span className="flex items-center gap-1.5"><kbd className="bg-slate-800 px-2 py-1 rounded text-cyan-300">Swipe ↑</kbd> Jump</span>
              <span className="flex items-center gap-1.5"><kbd className="bg-slate-800 px-2 py-1 rounded text-cyan-300">Swipe ↓</kbd> Slide</span>
            </div>
            <button
              onClick={startGame}
              className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-extrabold text-sm rounded-xl shadow-lg shadow-cyan-500/30 transition-transform active:scale-95"
            >
              <Play className="w-4 h-4 fill-black" /> START 3D RUN
            </button>
          </div>
        )}

        {phase === 'over' && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-10">
            <span className="text-xs font-semibold uppercase tracking-widest text-red-500 mb-1">RUN FINISHED</span>
            <div className="text-4xl font-black text-white mb-2">{hud.score}</div>
            <div className="text-xs text-slate-400 mb-6">
              Distance: {hud.distance}m · Max Combo: {hud.combo}x
            </div>
            <button
              onClick={startGame}
              className="flex items-center gap-2 px-6 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-sm rounded-lg shadow-md transition-transform active:scale-95"
            >
              <RotateCcw className="w-4 h-4" /> PLAY AGAIN
            </button>
          </div>
        )}
      </div>

      {/* Touch controls */}
      <div className="w-full flex items-center justify-between p-3 bg-[#12131d] border-t border-[#242738] rounded-b-xl gap-2">
        <button
          onClick={() => changeLane(-1)}
          disabled={!playing}
          className="flex-1 flex items-center justify-center gap-1 py-3 bg-[#181a27] hover:bg-[#202334] active:bg-cyan-500 active:text-black text-cyan-400 font-bold rounded-xl border border-[#2f334a] transition-all disabled:opacity-50"
        >
          <ArrowLeft className="w-5 h-5" /> LEFT
        </button>
        <button
          onClick={slide}
          disabled={!playing}
          className="flex-1 flex items-center justify-center gap-1 py-3 bg-[#181a27] hover:bg-[#202334] active:bg-amber-400 active:text-black text-amber-400 font-bold rounded-xl border border-[#2f334a] transition-all disabled:opacity-50"
        >
          <ArrowDown className="w-5 h-5" /> SLIDE
        </button>
        <button
          onClick={jump}
          disabled={!playing}
          className="flex-1 flex items-center justify-center gap-1 py-3 bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-300 text-black font-extrabold rounded-xl shadow-md shadow-cyan-500/20 transition-transform active:scale-95 disabled:opacity-50"
        >
          <ArrowUp className="w-5 h-5" /> JUMP
        </button>
        <button
          onClick={() => changeLane(1)}
          disabled={!playing}
          className="flex-1 flex items-center justify-center gap-1 py-3 bg-[#181a27] hover:bg-[#202334] active:bg-cyan-500 active:text-black text-cyan-400 font-bold rounded-xl border border-[#2f334a] transition-all disabled:opacity-50"
        >
          RIGHT <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
