'use client';

import React, { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { create3DAvatar } from '@/lib/avatar-3d-model';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
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
import GameShell, { PopupApi, useSwipe, Swipe } from './GameShell';
import { Move, Pointer, Layers } from 'lucide-react';

type GemSurge3DProps = GameProps;

const ROWS = 6;
const COLS = 6;
const GEM_COLORS = [0x00f0ff, 0xff0055, 0xffb800, 0x10b981, 0xa855f7];
const ROUND_SECONDS = 60;
const SPACING = 0.95;
const ORIGIN = new THREE.Vector3(0.2, 4.4, 0);
const BOARD_CENTER = new THREE.Vector3(ORIGIN.x + ((COLS - 1) * SPACING) / 2, ORIGIN.y - ((ROWS - 1) * SPACING) / 2, 0);
const CLUTCH_SECONDS = 10;
const TOUCH_SLOP = 34;

interface Gem {
  r: number;
  c: number;
  colorIdx: number;
  mesh: THREE.Mesh;
  target: THREE.Vector3;
}

type Phase = 'ready' | 'playing' | 'over';

const cellPos = (r: number, c: number, out = new THREE.Vector3()) => out.set(ORIGIN.x + c * SPACING, ORIGIN.y - r * SPACING, 0);

export default function GemSurge3DGame({ avatar, onFinish, seed, rival, match, onExit }: GemSurge3DProps) {
  const seedRef = useLatest(seed);
  // Starting board and refills come from the match seed: same board for every player.
  const rngRef = useRef(mulberry32(seed ?? randomSeed()));
  const stableAvatar = useStructuralMemo(avatar);
  const onFinishRef = useLatest(onFinish);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, pushHud] = useThrottledHud({ score: 0, combo: 0, bestCombo: 0, timeLeft: ROUND_SECONDS, clutch: false });
  const popups = useRef<PopupApi | null>(null);
  const inputRef = useRef<{ down: (x: number, y: number) => void; swipe: (s: Swipe) => void; tap: () => void }>({ down: () => {}, swipe: () => {}, tap: () => {} });
  const resetWorldRef = useRef<() => void>(() => {});
  const fresh = () => ({ playing: true, score: 0, combo: 0, bestCombo: 0, timeLeft: ROUND_SECONDS, clutchAnnounced: false, moves: 0, cleared: 0, pMatch: 0, pCascade: 0, pClutch: 0 });
  const sim = useRef({ ...fresh(), playing: false });

  const startGame = useCallback(() => {
    Object.assign(sim.current, fresh());
    rngRef.current = mulberry32(seedRef.current ?? randomSeed());
    resetWorldRef.current();
    pushHud({ score: 0, combo: 0, bestCombo: 0, timeLeft: ROUND_SECONDS, clutch: false }, true);
    setPhase('playing');
  }, [pushHud, seedRef]);

  // Touch a gem and swipe toward a neighbour (fires mid-swipe), or tap-select then tap a neighbour.
  const surface = useSwipe({
    earlyThreshold: 22,
    onDrag: (sw, ph) => {
      if (ph === 'start') inputRef.current.down(sw.startX, sw.startY);
    },
    onSwipe: (sw) => inputRef.current.swipe(sw),
    onTap: () => inputRef.current.tap(),
  });

  const { hostRef } = useGameEngine(
    {
      background: 0x0a0b14,
      fog: { density: 0.02 },
      camera: { fov: 48, far: 90, position: [1.5, 2.5, 9.2], lookAt: [1.5, 2.2, 0] },
      exposure: 1.2,
      bloom: { strength: 0.65, radius: 0.3, threshold: 0.85 },
      environment: 0.5,
    },
    (engine) => {
      const { scene, camera } = engine;
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

      // Portrait: board fills the width with the avatar cheering below. Landscape: avatar beside it.
      engine.onResize((_w, _h, aspect) => {
        if (aspect < 0.8) {
          const halfW = 3.7;
          camera.fov = 58;
          const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect;
          const dist = halfW / tanH;
          camera.position.set(BOARD_CENTER.x, BOARD_CENTER.y - 1.2, dist);
          camera.lookAt(BOARD_CENTER.x, BOARD_CENTER.y - 1.2, 0);
          stage.position.set(BOARD_CENTER.x, -2.95, 0.6);
          stageRing.position.set(BOARD_CENTER.x, -2.74, 0.6);
          avatar3D.group.position.set(BOARD_CENTER.x, -2.75, 0.6);
          avatar3D.group.rotation.y = 0;
        } else {
          camera.fov = 48;
          camera.position.set(1.4, 2.0, 10.6);
          camera.lookAt(1.4, 1.9, 0);
          stage.position.set(-2.4, 0.2, 0);
          stageRing.position.set(-2.4, 0.41, 0);
          avatar3D.group.position.set(-2.4, 0.4, 0);
          avatar3D.group.rotation.y = 0.4;
        }
        camera.updateProjectionMatrix();
      });

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
        const centre = new THREE.Vector3();
        matched.forEach((g) => {
          particles.emit(g.mesh.position, GEM_COLORS[g.colorIdx], { count: 8, speed: 3.5, life: 0.55, gravity: 4 });
          centre.add(g.mesh.position);
          board[g.r][g.c] = null;
          dropMesh(g.mesh);
        });
        centre.divideScalar(matched.size);
        // Combo = cascade step within this move: 1st clear ×1, 2nd ×2, …  (4/5-matches score more gems)
        s.combo += 1;
        const clutch = s.timeLeft <= CLUTCH_SECONDS ? 2 : 1;
        const base = matched.size * 60;
        const pts = base * s.combo * clutch;
        s.pMatch += base;
        s.pCascade += base * (s.combo - 1);
        s.pClutch += base * s.combo * (clutch - 1);
        s.score += pts;
        s.cleared += matched.size;
        s.bestCombo = Math.max(s.bestCombo, s.combo);
        const sp = engine.toScreen(centre);
        popups.current?.pop(`+${pts}`, sp.x, sp.y, { color: s.combo >= 2 ? '#fde047' : '#ffffff', size: pts >= 600 ? 'lg' : 'md' });
        if (s.combo >= 2) popups.current?.banner(`CASCADE ×${s.combo}`, s.combo >= 3 ? '#f0abfc' : '#c4b5fd');
        if (matched.size >= 5) popups.current?.pop('MEGA MATCH', sp.x, sp.y + 26, { color: '#f0abfc', size: 'sm' });
        haptic(s.combo >= 2 ? 'big' : 'score');
        sound.playScore(1 + Math.min(s.combo * 0.1, 1.5));
        engine.flash(Math.min(1, 0.25 + matched.size * 0.04));
        avatar3D.trigger('celebrate', 0.9);
        pushHud({ score: s.score, combo: s.combo, bestCombo: s.bestCombo }, true);
        collapse();
        later(0.32, resolve);
      };

      const swap = (a: Gem, b: Gem) => {
        busy = true;
        sim.current.moves += 1;
        haptic('tap');
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
            sound.playTap();
            haptic('light');
            sim.current.combo = 0;
            pushHud({ combo: 0 }, true);
            later(0.18, () => (busy = false));
          }
        });
      };

      const scr = new THREE.Vector3();
      /** Gem under a point in surface px: raycast, then nearest gem centre within the touch slop. */
      const gemAt = (x: number, y: number) => {
        const rect = engine.renderer.domElement.getBoundingClientRect();
        const meshes: THREE.Object3D[] = [];
        for (const row of board) for (const g of row) if (g) meshes.push(g.mesh);
        const hit = engine.raycast(rect.left + x, rect.top + y, meshes, false)[0];
        if (hit) for (const row of board) for (const g of row) if (g && g.mesh === hit.object) return g;
        let best: Gem | null = null;
        let bestD = TOUCH_SLOP;
        for (const row of board)
          for (const g of row) {
            if (!g) continue;
            const p = engine.toScreen(scr.copy(g.target));
            const d = Math.hypot(p.x - x, p.y - y);
            if (d < bestD) {
              bestD = d;
              best = g;
            }
          }
        return best;
      };

      let touched: Gem | null = null;
      inputRef.current = {
        down: (x, y) => {
          touched = sim.current.playing && !busy ? gemAt(x, y) : null;
        },
        swipe: ({ dx, dy }) => {
          const gem = touched;
          touched = null;
          if (!gem || !sim.current.playing || busy) return;
          selected = null;
          let r2 = gem.r;
          let c2 = gem.c;
          if (Math.abs(dx) > Math.abs(dy)) c2 += dx > 0 ? 1 : -1;
          else r2 += dy > 0 ? 1 : -1;
          const other = board[r2]?.[c2];
          if (other) swap(gem, other);
        },
        tap: () => {
          const gem = touched;
          touched = null;
          if (!gem || !sim.current.playing || busy) return;
          if (selected && selected !== gem && Math.abs(selected.r - gem.r) + Math.abs(selected.c - gem.c) === 1) {
            const a = selected;
            selected = null;
            swap(a, gem);
          } else {
            selected = selected === gem ? null : gem;
            if (selected) haptic('tap');
          }
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
          if (!s.clutchAnnounced && s.timeLeft <= CLUTCH_SECONDS) {
            s.clutchAnnounced = true;
            popups.current?.banner('CLUTCH TIME ×2', '#fbbf24');
            haptic('big');
          }
          if (s.timeLeft <= 0) {
            s.playing = false;
            selected = null;
            sound.playWin();
            haptic('big');
            const breakdown = [
              { label: `Gems cleared (${s.cleared})`, points: s.pMatch },
              { label: `Cascade bonus (best ×${Math.max(1, s.bestCombo)})`, points: s.pCascade },
              { label: 'Clutch time ×2', points: s.pClutch },
            ].filter((b) => b.points > 0);
            pushHud({ timeLeft: 0, score: s.score, clutch: false }, true);
            setPhase('over');
            onFinishRef.current(s.score, { maxCombo: s.bestCombo, breakdown });
          } else {
            pushHud({ timeLeft: s.timeLeft, clutch: s.timeLeft <= CLUTCH_SECONDS });
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
        inputRef.current = { down: () => {}, swipe: () => {}, tap: () => {} };
        resetWorldRef.current = () => {};
        spareMeshes.length = 0;
      };
    },
    [stableAvatar],
  );

  const chips = hud.combo > 1 ? <span className="px-2 py-0.5 rounded-full bg-fuchsia-400 text-black text-[11px] font-black">CASCADE ×{hud.combo}</span> : null;

  return (
    <GameShell
      title="GEM SURGE"
      accent="#c084fc"
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
      hint="Swipe a gem toward a neighbour to swap"
      tutorial={[
        { icon: <Move className="w-6 h-6" />, label: 'Swipe gem to swap' },
        { icon: <Pointer className="w-6 h-6" />, label: 'Or tap, then tap neighbour' },
        { icon: <Layers className="w-6 h-6" />, label: 'Chain cascades' },
      ]}
      scoring="60 per gem cleared · Each cascade step in one move multiplies (×2, ×3…) · Last 10s ×2. Same board for every player."
    />
  );
}
