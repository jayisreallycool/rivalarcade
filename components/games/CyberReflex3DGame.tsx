'use client';

import React, { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { create3DAvatar } from '@/lib/avatar-3d-model';
import { sound, useMuted } from '@/lib/sound';
import {
  Pool,
  ParticleBursts,
  addArenaLights,
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
import { Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';

type CyberReflex3DProps = GameProps;

type NodeType = 'target' | 'hazard' | 'bonus';
const NODE_COLORS: Record<NodeType, number> = { target: 0x00f0ff, hazard: 0xff0055, bonus: 0xffb800 };
const ROUND_SECONDS = 40;
const RING_START = 2.4;

interface NodeObj {
  group: THREE.Group;
  orb: THREE.Mesh;
  ring: THREE.Mesh;
  type: NodeType;
  ringScale: number;
}

type Phase = 'ready' | 'playing' | 'over';

export default function CyberReflex3DGame({ avatar, onFinish, modeName = 'Match', seed, rival }: CyberReflex3DProps) {
  const seedRef = useLatest(seed);
  const rngRef = useRef(mulberry32(seed ?? randomSeed()));
  const stableAvatar = useStructuralMemo(avatar);
  const onFinishRef = useLatest(onFinish);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, combo: 0, bestCombo: 0, timeLeft: ROUND_SECONDS });
  const isMuted = useMuted();
  const hitRef = useRef<(x: number, y: number) => void>(() => {});
  const resetWorldRef = useRef<() => void>(() => {});

  const sim = useRef({ playing: false, score: 0, combo: 0, bestCombo: 0, timeLeft: ROUND_SECONDS, spawnTimer: 0 });

  const startGame = useCallback(() => {
    Object.assign(sim.current, { playing: true, score: 0, combo: 0, bestCombo: 0, timeLeft: ROUND_SECONDS, spawnTimer: 0 });
    rngRef.current = mulberry32(seedRef.current ?? randomSeed());
    resetWorldRef.current();
    pushHud({ score: 0, combo: 0, bestCombo: 0, timeLeft: ROUND_SECONDS }, true);
    setPhase('playing');
  }, [pushHud, seedRef]);

  const { hostRef } = useGameEngine(
    {
      background: 0x080911,
      fog: { density: 0.03 },
      camera: { fov: 50, far: 90, position: [0, 3.8, 8.2], lookAt: [0, 1.2, 0] },
      exposure: 1.25,
      bloom: { strength: 0.75, radius: 0.3, threshold: 0.82 },
    },
    (engine) => {
      const { scene, camera } = engine;

      addArenaLights(engine, { sky: 0x00f0ff, ground: 0x1a1233, hemi: 1.2, key: 1.8, keyPos: [6, 12, 8], rim: 0x8b5cf6, shadowFrustum: 6 });

      const floor = createNeonGridFloor(engine, { width: 60, length: 60, cells: [30, 30], color: '#8b5cf6', lineWidth: 2, glow: 0.45 });
      scene.add(floor.mesh);
      scene.add(createStarfield(engine, { count: 600, radius: 50, yMin: 3 }));

      // Command platform
      const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.4, 48), new THREE.MeshStandardMaterial({ color: 0x121424, roughness: 0.3, metalness: 0.7 }));
      platform.position.y = 0.2;
      platform.receiveShadow = engine.quality.shadows;
      const pRing = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.04, 8, 96), neonMaterial(0x00f0ff, 1.6));
      pRing.rotation.x = -Math.PI / 2;
      pRing.position.y = 0.42;
      scene.add(platform, pRing);

      // Orbiting halo rings for depth
      const halo = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(4.2 + i * 0.9, 0.015, 6, 128), neonMaterial(i === 1 ? 0x8b5cf6 : 0x00f0ff, 1.2));
        r.rotation.x = Math.PI / 2 + (i - 1) * 0.25;
        halo.add(r);
      }
      halo.position.y = 2;
      scene.add(halo);

      const avatar3D = create3DAvatar(stableAvatar);
      engine.own(avatar3D);
      avatar3D.group.position.set(0, 0.4, 0);
      scene.add(avatar3D.group);

      const shieldMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: true, transparent: true, opacity: 0.22, toneMapped: false });
      const shield = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 2), shieldMat);
      shield.position.set(0, 1.4, 0);
      scene.add(shield);

      // Laser beam (one reusable mesh, stretched between avatar and target)
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
      const beamGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6, 1, true);
      beamGeo.rotateX(Math.PI / 2); // align with +Z for lookAt
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.visible = false;
      scene.add(beam);
      let beamLife = 0;

      const particles = new ParticleBursts(engine);

      // Shared node resources: 1 orb geo + 1 ring geo + 3 orb mats + 3 ring mats, regardless of spawns
      const orbGeo = engine.own(new THREE.DodecahedronGeometry(0.42));
      const ringGeo = engine.own(new THREE.TorusGeometry(0.55, 0.035, 8, 32));
      const orbMats = {} as Record<NodeType, THREE.Material>;
      const ringMats = {} as Record<NodeType, THREE.Material>;
      (Object.keys(NODE_COLORS) as NodeType[]).forEach((t) => {
        orbMats[t] = engine.own(new THREE.MeshStandardMaterial({ color: NODE_COLORS[t], emissive: NODE_COLORS[t], emissiveIntensity: 0.8, roughness: 0.2, metalness: 0.3 }));
        ringMats[t] = engine.own(neonMaterial(NODE_COLORS[t], 1.4));
      });

      const pool = new Pool<NodeObj>(
        () => {
          const orb = new THREE.Mesh(orbGeo);
          const ring = new THREE.Mesh(ringGeo);
          const group = new THREE.Group();
          group.add(orb, ring);
          return { group, orb, ring, type: 'target', ringScale: RING_START };
        },
        (n) => scene.add(n.group),
        (n) => scene.remove(n.group),
      );
      pool.warm(6);
      const nodes: NodeObj[] = [];
      const hitTargets: THREE.Object3D[] = [];
      const tmp = new THREE.Vector3();
      const avatarChest = new THREE.Vector3(0, 1.6, 0);
      let shake = 0;
      let faceAngle = 0;

      const removeNode = (i: number) => {
        pool.release(nodes[i]);
        nodes.splice(i, 1);
      };

      resetWorldRef.current = () => {
        while (nodes.length) removeNode(nodes.length - 1);
        particles.clear();
      };

      hitRef.current = (clientX, clientY) => {
        const s = sim.current;
        if (!s.playing) return;
        hitTargets.length = 0;
        nodes.forEach((n) => hitTargets.push(n.group));
        const hits = engine.raycast(clientX, clientY, hitTargets, true);
        if (!hits.length) {
          if (s.combo !== 0) {
            s.combo = 0;
            pushHud({ combo: 0 }, true);
          }
          return;
        }
        const idx = nodes.findIndex((n) => n.orb === hits[0].object || n.ring === hits[0].object);
        if (idx < 0) return;
        const node = nodes[idx];
        node.group.getWorldPosition(tmp);

        if (node.type === 'hazard') {
          s.score = Math.max(0, s.score - 150);
          s.combo = 0;
          sound.playLose();
          shieldMat.color.setHex(0xff0055);
          shield.scale.setScalar(1.4);
          shake = 0.3;
          particles.emit(tmp, 0xff0055, { count: 30, speed: 6 });
        } else {
          const accurate = Math.abs(node.ringScale - 1.0) < 0.25;
          let pts = accurate ? 250 : 160;
          if (node.type === 'bonus') pts *= 2;
          s.combo += 1;
          s.bestCombo = Math.max(s.bestCombo, s.combo);
          s.score += pts * Math.min(5, 1 + Math.floor(s.combo / 5));
          sound.playScore(1 + (s.combo % 8) * 0.1);
          shieldMat.color.setHex(0x00f0ff);
          shield.scale.setScalar(1.25);
          engine.flash(accurate ? 0.55 : 0.25);
          particles.emit(tmp, NODE_COLORS[node.type], { count: accurate ? 28 : 16, speed: accurate ? 6 : 4 });
          avatar3D.trigger('shoot', 0.35);
          // Laser
          beamMat.color.setHex(NODE_COLORS[node.type]).multiplyScalar(2);
          beam.position.copy(avatarChest).lerp(tmp, 0.5);
          beam.scale.set(1, 1, avatarChest.distanceTo(tmp));
          beam.lookAt(tmp);
          beam.visible = true;
          beamLife = 0.18;
          faceAngle = Math.atan2(tmp.x, tmp.z);
        }
        pushHud({ score: s.score, combo: s.combo, bestCombo: s.bestCombo }, true);
        removeNode(idx);
      };

      engine.addUpdate((dt, t) => {
        const s = sim.current;

        halo.rotation.y += dt * 0.25;
        halo.children.forEach((c, i) => (c.rotation.z += dt * (0.2 + i * 0.15)));
        shield.rotation.y += dt * 0.4;
        if (shield.scale.x > 1) shield.scale.setScalar(Math.max(1, shield.scale.x - dt * 2.4));
        shieldMat.opacity = 0.18 + (shield.scale.x - 1) * 0.9;

        if (beamLife > 0) {
          beamLife -= dt;
          beamMat.opacity = Math.max(0, beamLife / 0.18);
          if (beamLife <= 0) beam.visible = false;
        }

        if (s.playing) {
          s.timeLeft -= dt;
          if (s.timeLeft <= 0) {
            s.playing = false;
            sound.playWin();
            pushHud({ timeLeft: 0, score: s.score }, true);
            setPhase('over');
            onFinishRef.current(s.score, { maxCombo: s.bestCombo });
          } else {
            pushHud({ timeLeft: Math.ceil(s.timeLeft) });
          }

          s.spawnTimer += dt;
          if (s.spawnTimer > 0.65 && nodes.length < 5) {
            s.spawnTimer = 0;
            const rng = rngRef.current;
            const isHazard = rng() < 0.22;
            const isBonus = !isHazard && rng() < 0.25;
            const type: NodeType = isHazard ? 'hazard' : isBonus ? 'bonus' : 'target';
            const n = pool.acquire();
            n.type = type;
            n.ringScale = RING_START;
            n.orb.material = orbMats[type];
            n.ring.material = ringMats[type];
            const angle = rng() * Math.PI * 2;
            const radius = rng() * 2.2 + 3.2;
            n.group.position.set(Math.cos(angle) * radius, rng() * 2.2 + 0.8, Math.min(Math.sin(angle) * radius, 3.6));
            n.group.scale.setScalar(0.01);
            nodes.push(n);
          }
        }

        for (let i = nodes.length - 1; i >= 0; i--) {
          const n = nodes[i];
          if (n.group.scale.x < 1) n.group.scale.setScalar(Math.min(1, n.group.scale.x + dt * 6)); // pop-in
          if (s.playing) n.ringScale -= 1.1 * dt;
          n.ring.scale.setScalar(n.ringScale);
          n.orb.rotation.y += 2 * dt;
          n.orb.rotation.x += 1.3 * dt;
          n.ring.lookAt(camera.position);
          if (n.ringScale <= 0.6 || !s.playing) {
            if (s.playing && n.type !== 'hazard' && s.combo !== 0) {
              s.combo = 0;
              pushHud({ combo: 0 }, true);
            }
            removeNode(i);
          }
        }

        // Avatar turns toward the last target and settles back
        faceAngle *= 1 - Math.min(1, dt * 0.8);
        avatar3D.group.rotation.y += (faceAngle - avatar3D.group.rotation.y) * (1 - Math.exp(-10 * dt));
        avatar3D.updateAnimation(t, 'idle', dt);

        camera.position.set(0, 3.8, 8.2);
        if (shake > 0) {
          shake = Math.max(0, shake - dt);
          camera.position.x += (Math.random() - 0.5) * shake;
          camera.position.y += (Math.random() - 0.5) * shake;
        }
        camera.lookAt(0, 1.2, 0);
      });

      return () => {
        hitRef.current = () => {};
        resetWorldRef.current = () => {};
      };
    },
    [stableAvatar],
  );

  return (
    <div className="relative flex flex-col items-center w-full max-w-3xl mx-auto select-none">
      <div className="w-full flex items-center justify-between px-4 py-2.5 bg-[#12131d] border-b border-[#242738] rounded-t-xl text-sm gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-extrabold tracking-wider text-cyan-400 text-xs sm:text-sm whitespace-nowrap">CYBER REFLEX 3D</span>
          <span className="text-xs text-slate-400 hidden sm:inline">· {modeName}</span>
        </div>
        <div className="flex items-center gap-2.5 sm:gap-5 font-mono text-xs sm:text-sm">
          <div className="text-slate-300">
            <span className="hidden sm:inline">SCORE: </span><span className="text-white font-bold text-sm sm:text-base tabular-nums">{hud.score}</span>
          </div>
          <div className="text-cyan-400 font-bold">
            {hud.combo}x <span className="text-xs font-normal">STREAK</span>
          </div>
          <div className="text-amber-400 font-bold tabular-nums">{hud.timeLeft}s</div>
          <button onClick={() => sound.toggleMute()} className="p-1 hover:text-cyan-400 text-slate-400 transition-colors">
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
          </button>
        </div>
      </div>

      {rival && <RivalBar rival={rival} score={hud.score} progress={phase === 'ready' ? 0 : 1 - hud.timeLeft / ROUND_SECONDS} />}

      <div
        onPointerDown={(e) => hitRef.current(e.clientX, e.clientY)}
        onPointerMove={(e) => {
          if (e.buttons === 1) hitRef.current(e.clientX, e.clientY);
        }}
        className="relative w-full aspect-[16/9] bg-[#080911] overflow-hidden border-x border-[#242738] touch-none cursor-crosshair"
      >
        <div ref={hostRef} className="absolute inset-0" />

        {phase === 'ready' && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center p-6 text-center z-10">
            <h2 className="text-3xl font-black italic tracking-wide text-cyan-400 mb-2">CYBER REFLEX 3D</h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-md mb-6">
              3D Orbital Target Matrix! Tap or slide across orbiting 3D nodes when the shrinking timing ring aligns with the core. Avoid red hazard nodes!
            </p>
            <button
              onClick={startGame}
              className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-extrabold text-sm rounded-xl shadow-lg shadow-cyan-500/30 transition-transform active:scale-95"
            >
              <Play className="w-4 h-4 fill-black" /> START 3D DEFENSE
            </button>
          </div>
        )}

        {phase === 'over' && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-10">
            <span className="text-xs font-semibold uppercase tracking-widest text-cyan-400 mb-1">SEQUENCE FINISHED</span>
            <div className="text-4xl font-black text-white mb-2">{hud.score}</div>
            <div className="text-xs text-slate-400 mb-6">Max Reflex Streak: {hud.bestCombo}</div>
            <button
              onClick={startGame}
              className="flex items-center gap-2 px-6 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-sm rounded-lg shadow-md transition-transform active:scale-95"
            >
              <RotateCcw className="w-4 h-4" /> PLAY AGAIN
            </button>
          </div>
        )}
      </div>

      <div className="w-full p-3 bg-[#12131d] border-t border-[#242738] rounded-b-xl text-center text-xs text-slate-400">
        Tap or slide your finger across nodes in 3D space to trigger shield deflections!
      </div>
    </div>
  );
}
