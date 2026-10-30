'use client';

import React, { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { create3DAvatar } from '@/lib/avatar-3d-model';
import { sound, useMuted } from '@/lib/sound';
import {
  ParticleBursts,
  addArenaLights,
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

type GemSurge3DProps = GameProps;

const ROWS = 6;
const COLS = 6;
const GEM_COLORS = [0x00f0ff, 0xff0055, 0xffb800, 0x10b981, 0xa855f7];
const ROUND_SECONDS = 60;
const SPACING = 0.95;
const ORIGIN = new THREE.Vector3(0.2, 4.4, 0);

interface Gem {
  r: number;
  c: number;
  colorIdx: number;
  mesh: THREE.Mesh;
  target: THREE.Vector3;
}

type Phase = 'ready' | 'playing' | 'over';

const cellPos = (r: number, c: number, out = new THREE.Vector3()) => out.set(ORIGIN.x + c * SPACING, ORIGIN.y - r * SPACING, 0);

export default function GemSurge3DGame({ avatar, onFinish, modeName = 'Match', seed, rival }: GemSurge3DProps) {
  const seedRef = useLatest(seed);
  // Starting board and refills come from the match seed: same board for every player.
  const rngRef = useRef(mulberry32(seed ?? randomSeed()));
  const stableAvatar = useStructuralMemo(avatar);
  const onFinishRef = useLatest(onFinish);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, combo: 0, bestCombo: 0, timeLeft: ROUND_SECONDS });
  const isMuted = useMuted();
  const inputRef = useRef<{ down: (e: React.PointerEvent) => void; up: (e: React.PointerEvent) => void }>({ down: () => {}, up: () => {} });
  const resetWorldRef = useRef<() => void>(() => {});
  const sim = useRef({ playing: false, score: 0, combo: 0, bestCombo: 0, timeLeft: ROUND_SECONDS });

  const startGame = useCallback(() => {
    Object.assign(sim.current, { playing: true, score: 0, combo: 0, bestCombo: 0, timeLeft: ROUND_SECONDS });
    rngRef.current = mulberry32(seedRef.current ?? randomSeed());
    resetWorldRef.current();
    pushHud({ score: 0, combo: 0, bestCombo: 0, timeLeft: ROUND_SECONDS }, true);
    setPhase('playing');
  }, [pushHud, seedRef]);

  const { hostRef } = useGameEngine(
    {
      background: 0x0a0b14,
      fog: { density: 0.02 },
      camera: { fov: 48, far: 90, position: [1.5, 2.5, 9.2], lookAt: [1.5, 2.2, 0] },
      exposure: 1.2,
      bloom: { strength: 0.65, radius: 0.3, threshold: 0.85 },
    },
    (engine) => {
      const { scene } = engine;
      addArenaLights(engine, { sky: 0x9fdcff, ground: 0x1b1328, hemi: 1.1, key: 2.2, keyPos: [6, 12, 10], rim: 0xa855f7, shadowFrustum: 8 });
      scene.add(createStarfield(engine, { count: 500, radius: 40, color: '#d6b8ff', yMin: -10 }));

      // Board frame with neon edge
      const frameGeo = new THREE.BoxGeometry(6.4, 6.4, 0.2);
      const frame = new THREE.Mesh(frameGeo, new THREE.MeshStandardMaterial({ color: 0x121422, roughness: 0.5, metalness: 0.5 }));
      frame.position.set(2.55, 2.0, -0.25);
      frame.receiveShadow = engine.quality.shadows;
      const frameEdge = new THREE.LineSegments(new THREE.EdgesGeometry(frameGeo), new THREE.LineBasicMaterial({ color: new THREE.Color(0xa855f7).multiplyScalar(2.2), toneMapped: false }));
      frameEdge.position.copy(frame.position);
      scene.add(frame, frameEdge);

      // Selection cursor
      const cursor = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.03, 6, 40), neonMaterial(0xffffff, 1.6));
      cursor.visible = false;
      scene.add(cursor);

      // Podium + avatar
      const stage = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.4, 32), new THREE.MeshStandardMaterial({ color: 0x181a28, roughness: 0.4, metalness: 0.5 }));
      stage.position.set(-2.4, 0.2, 0);
      const stageRing = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.03, 6, 64), neonMaterial(0xa855f7, 1.6));
      stageRing.rotation.x = Math.PI / 2;
      stageRing.position.set(-2.4, 0.41, 0);
      scene.add(stage, stageRing);

      const avatar3D = create3DAvatar(stableAvatar);
      engine.own(avatar3D);
      avatar3D.group.position.set(-2.4, 0.4, 0);
      avatar3D.group.rotation.y = 0.4;
      scene.add(avatar3D.group);

      const particles = new ParticleBursts(engine);

      // One geometry + five materials for every gem that will ever exist
      const gemGeo = engine.own(new THREE.OctahedronGeometry(0.38, 0));
      const gemMats = GEM_COLORS.map((c) =>
        engine.own(new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.6, flatShading: true })),
      );
      const spareMeshes: THREE.Mesh[] = [];
      const takeMesh = (colorIdx: number) => {
        const m = spareMeshes.pop() ?? new THREE.Mesh(gemGeo);
        m.material = gemMats[colorIdx];
        m.scale.setScalar(1);
        m.castShadow = engine.quality.shadows;
        scene.add(m);
        return m;
      };
      const dropMesh = (m: THREE.Mesh) => {
        scene.remove(m);
        spareMeshes.push(m);
      };

      const board: (Gem | null)[][] = Array.from({ length: ROWS }, () => Array<Gem | null>(COLS).fill(null));
      let busy = false; // input locked while swaps/cascades resolve
      let selected: Gem | null = null;
      const tasks: { at: number; fn: () => void }[] = [];
      const later = (delay: number, fn: () => void) => tasks.push({ at: engine.elapsed + delay, fn });

      const pickColor = (r: number, c: number) => {
        // Avoid creating ready-made matches on a fresh board
        for (let tries = 0; tries < 10; tries++) {
          const k = Math.floor(rngRef.current() * GEM_COLORS.length);
          const left = c >= 2 && board[r][c - 1]?.colorIdx === k && board[r][c - 2]?.colorIdx === k;
          const up = r >= 2 && board[r - 1][c]?.colorIdx === k && board[r - 2][c]?.colorIdx === k;
          if (!left && !up) return k;
        }
        return Math.floor(rngRef.current() * GEM_COLORS.length);
      };

      const buildBoard = () => {
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++) {
            const old = board[r][c];
            if (old) dropMesh(old.mesh);
            const colorIdx = pickColor(r, c);
            const mesh = takeMesh(colorIdx);
            const target = cellPos(r, c);
            mesh.position.copy(target).add(new THREE.Vector3(0, 3 + r * 0.4, 0));
            board[r][c] = { r, c, colorIdx, mesh, target };
          }
      };
      buildBoard();

      const findMatches = () => {
        const hit = new Set<Gem>();
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS - 2; c++) {
            const a = board[r][c], b = board[r][c + 1], d = board[r][c + 2];
            if (a && b && d && a.colorIdx === b.colorIdx && b.colorIdx === d.colorIdx) [a, b, d].forEach((g) => hit.add(g));
          }
        for (let c = 0; c < COLS; c++)
          for (let r = 0; r < ROWS - 2; r++) {
            const a = board[r][c], b = board[r + 1][c], d = board[r + 2][c];
            if (a && b && d && a.colorIdx === b.colorIdx && b.colorIdx === d.colorIdx) [a, b, d].forEach((g) => hit.add(g));
          }
        return hit;
      };

      const collapse = () => {
        for (let c = 0; c < COLS; c++) {
          let empty = ROWS - 1;
          for (let r = ROWS - 1; r >= 0; r--) {
            const g = board[r][c];
            if (!g) continue;
            if (empty !== r) {
              board[empty][c] = g;
              board[r][c] = null;
              g.r = empty;
              cellPos(empty, c, g.target);
            }
            empty--;
          }
          for (let r = empty; r >= 0; r--) {
            const colorIdx = Math.floor(rngRef.current() * GEM_COLORS.length);
            const mesh = takeMesh(colorIdx);
            const target = cellPos(r, c);
            mesh.position.copy(target);
            mesh.position.y += 2.5 + (empty - r) * 0.5;
            board[r][c] = { r, c, colorIdx, mesh, target };
          }
        }
      };

      /** Clear matches, drop, refill — and keep chaining until the board is stable. */
      const resolve = () => {
        const s = sim.current;
        const matched = findMatches();
        if (!matched.size || !s.playing) {
          busy = false;
          return;
        }
        matched.forEach((g) => {
          particles.emit(g.mesh.position, GEM_COLORS[g.colorIdx], { count: 8, speed: 3.5, life: 0.55, gravity: 4 });
          board[g.r][g.c] = null;
          dropMesh(g.mesh);
        });
        // Combo = cascade step within this move: 1st clear ×1, 2nd ×2, …
        s.combo += 1;
        s.score += matched.size * 60 * s.combo;
        s.bestCombo = Math.max(s.bestCombo, s.combo);
        sound.playScore(1 + Math.min(s.combo * 0.1, 1.5));
        engine.flash(Math.min(1, 0.25 + matched.size * 0.04));
        avatar3D.trigger('celebrate', 0.9);
        pushHud({ score: s.score, combo: s.combo, bestCombo: s.bestCombo }, true);
        collapse();
        later(0.32, resolve);
      };

      const swap = (a: Gem, b: Gem) => {
        busy = true;
        sim.current.combo = 0; // each move starts a fresh cascade chain
        const place = (g: Gem, r: number, c: number) => {
          board[r][c] = g;
          g.r = r;
          g.c = c;
          cellPos(r, c, g.target);
        };
        const ar = a.r, ac = a.c, br = b.r, bc = b.c;
        place(a, br, bc);
        place(b, ar, ac);
        later(0.18, () => {
          if (findMatches().size) {
            resolve();
          } else {
            place(a, ar, ac);
            place(b, br, bc);
            sim.current.combo = 0;
            pushHud({ combo: 0 }, true);
            later(0.18, () => (busy = false));
          }
        });
      };

      const gemAt = (clientX: number, clientY: number) => {
        const meshes: THREE.Object3D[] = [];
        for (const row of board) for (const g of row) if (g) meshes.push(g.mesh);
        const hit = engine.raycast(clientX, clientY, meshes, false)[0];
        if (!hit) return null;
        for (const row of board) for (const g of row) if (g && g.mesh === hit.object) return g;
        return null;
      };

      let dragStart: { gem: Gem; x: number; y: number } | null = null;
      inputRef.current = {
        down: (e) => {
          if (!sim.current.playing || busy) return;
          const g = gemAt(e.clientX, e.clientY);
          if (g) dragStart = { gem: g, x: e.clientX, y: e.clientY };
        },
        up: (e) => {
          const start = dragStart;
          dragStart = null;
          if (!start || !sim.current.playing || busy) return;
          const { gem } = start;
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;

          if (Math.hypot(dx, dy) < 20) {
            // Tap-to-select, tap an adjacent gem to swap
            if (selected && selected !== gem && Math.abs(selected.r - gem.r) + Math.abs(selected.c - gem.c) === 1) {
              const a = selected;
              selected = null;
              swap(a, gem);
            } else {
              selected = selected === gem ? null : gem;
            }
            return;
          }
          selected = null;
          let r2 = gem.r, c2 = gem.c;
          if (Math.abs(dx) > Math.abs(dy)) c2 += dx > 0 ? 1 : -1;
          else r2 += dy > 0 ? 1 : -1;
          const other = board[r2]?.[c2];
          if (other) swap(gem, other);
        },
      };

      resetWorldRef.current = () => {
        tasks.length = 0;
        busy = false;
        selected = null;
        particles.clear();
        buildBoard();
      };

      engine.addUpdate((dt, t) => {
        const s = sim.current;

        for (let i = tasks.length - 1; i >= 0; i--) {
          if (tasks[i].at <= t) {
            const task = tasks[i];
            tasks.splice(i, 1);
            task.fn();
          }
        }

        if (s.playing) {
          s.timeLeft -= dt;
          if (s.timeLeft <= 0) {
            s.playing = false;
            selected = null;
            sound.playWin();
            pushHud({ timeLeft: 0, score: s.score }, true);
            setPhase('over');
            onFinishRef.current(s.score, { maxCombo: s.bestCombo });
          } else {
            pushHud({ timeLeft: Math.ceil(s.timeLeft) });
          }
        }

        const follow = 1 - Math.exp(-14 * dt);
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++) {
            const g = board[r][c];
            if (!g) continue;
            g.mesh.position.lerp(g.target, follow);
            g.mesh.rotation.y += 1.2 * dt;
            g.mesh.rotation.x = Math.sin(t * 2 + r + c) * 0.15;
            const sel = g === selected;
            const sc = sel ? 1.2 + Math.sin(t * 10) * 0.06 : 1;
            g.mesh.scale.setScalar(g.mesh.scale.x + (sc - g.mesh.scale.x) * follow);
          }

        cursor.visible = !!selected;
        if (selected) {
          cursor.position.copy(selected.target).setZ(0.05);
          cursor.rotation.z += dt * 2;
        }

        avatar3D.updateAnimation(t, 'idle', dt);
      });

      return () => {
        inputRef.current = { down: () => {}, up: () => {} };
        resetWorldRef.current = () => {};
        spareMeshes.length = 0;
      };
    },
    [stableAvatar],
  );

  return (
    <div className="relative flex flex-col items-center w-full max-w-3xl mx-auto select-none">
      <div className="w-full flex items-center justify-between px-4 py-2.5 bg-[#12131d] border-b border-[#242738] rounded-t-xl text-sm gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-extrabold tracking-wider text-purple-400 text-xs sm:text-sm whitespace-nowrap">GEM SURGE 3D</span>
          <span className="text-xs text-slate-400 hidden sm:inline">· {modeName}</span>
        </div>
        <div className="flex items-center gap-2.5 sm:gap-5 font-mono text-xs sm:text-sm">
          <div className="text-slate-300">
            <span className="hidden sm:inline">SCORE: </span><span className="text-white font-bold text-sm sm:text-base tabular-nums">{hud.score}</span>
          </div>
          <div className="text-purple-400 font-bold">{hud.combo > 1 ? `${hud.combo}x CASCADE` : ''}</div>
          <div className="text-cyan-400 font-bold tabular-nums">{hud.timeLeft}s</div>
          <button onClick={() => sound.toggleMute()} className="p-1 hover:text-cyan-400 text-slate-400 transition-colors">
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
          </button>
        </div>
      </div>

      {rival && <RivalBar rival={rival} score={hud.score} progress={phase === 'ready' ? 0 : 1 - hud.timeLeft / ROUND_SECONDS} />}

      <div
        onPointerDown={(e) => inputRef.current.down(e)}
        onPointerUp={(e) => inputRef.current.up(e)}
        className="relative w-full aspect-[16/9] bg-[#0a0b14] overflow-hidden border-x border-[#242738] touch-none cursor-pointer"
      >
        <div ref={hostRef} className="absolute inset-0" />

        {phase === 'ready' && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center p-6 text-center z-10">
            <h2 className="text-3xl font-black italic tracking-wide text-purple-400 mb-2">GEM SURGE 3D</h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-md mb-6">
              Full 3D Cascading Polyhedron Puzzle! Slide and drag any 3D crystal onto an adjacent gem to match 3-in-a-row and trigger chain reactions!
            </p>
            <button
              onClick={startGame}
              className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-extrabold text-sm rounded-xl shadow-lg shadow-purple-500/30 transition-transform active:scale-95"
            >
              <Play className="w-4 h-4 fill-white" /> START 3D PUZZLE
            </button>
          </div>
        )}

        {phase === 'over' && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-10">
            <span className="text-xs font-semibold uppercase tracking-widest text-purple-400 mb-1">TIME EXPIRED</span>
            <div className="text-4xl font-black text-white mb-2">{hud.score}</div>
            <div className="text-xs text-slate-400 mb-6">Max Cascade Combo: {Math.max(1, hud.bestCombo)}x</div>
            <button
              onClick={startGame}
              className="flex items-center gap-2 px-6 py-2.5 bg-purple-500 hover:bg-purple-400 text-white font-bold text-sm rounded-lg shadow-md transition-transform active:scale-95"
            >
              <RotateCcw className="w-4 h-4" /> PLAY AGAIN
            </button>
          </div>
        )}
      </div>

      <div className="w-full p-3 bg-[#12131d] border-t border-[#242738] rounded-b-xl text-center text-xs text-slate-400">
        Drag a crystal toward a neighbour to swap — or tap one, then tap the gem next to it.
      </div>
    </div>
  );
}
