'use client';

import React, { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
import {
  CameraFeel,
  ParticleBursts,
  createFirstPersonRig,
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
      camera: { fov: 60, near: 0.03, far: 90, position: [BOARD_CENTER.x, BOARD_CENTER.y - 1.6, 12], lookAt: [BOARD_CENTER.x, BOARD_CENTER.y - 0.3, 0] },
      exposure: 1.2,
      bloom: { strength: 0.65, radius: 0.3, threshold: 0.85 },
      environment: 0.75,
      ao: true,
      studio: { top: 0x261a3c, left: 0x7dd3fc, right: 0xf472b6, key: 1.3 },
    },
    (engine) => {
      const { scene, camera } = engine;
      addArenaLights(engine, { sky: 0x9fdcff, ground: 0x1b1328, hemi: 1.1, key: 2.2, keyPos: [6, 12, 10], rim: 0xa855f7, shadowFrustum: 8 });
      scene.add(createStarfield(engine, { count: 500, radius: 40, color: '#d6b8ff', yMin: -10 }));

      // Board frame with neon edge
      const frameGeo = new THREE.BoxGeometry(6.4, 6.4, 0.2);
      const frame = new THREE.Mesh(frameGeo, new THREE.MeshPhysicalMaterial({ color: 0x0e1020, roughness: 0.35, metalness: 0.6, clearcoat: 0.8, clearcoatRoughness: 0.1 }));
      frame.position.set(2.55, 2.0, -0.25);
      frame.receiveShadow = engine.quality.shadows;
      const frameEdge = new THREE.LineSegments(new THREE.EdgesGeometry(frameGeo), new THREE.LineBasicMaterial({ color: new THREE.Color(0xa855f7).multiplyScalar(2.2), toneMapped: false }));
      frameEdge.position.copy(frame.position);
      scene.add(frame, frameEdge);

      // Selection cursor
      const cursor = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.03, 6, 40), neonMaterial(0xffffff, 1.6));
      cursor.visible = false;
      scene.add(cursor);

      // Arcade cabinet around the board: marquee, side panels and a control deck you stand at.
      const cabMat = new THREE.MeshPhysicalMaterial({ color: 0x141626, roughness: 0.4, metalness: 0.5, clearcoat: 0.7, clearcoatRoughness: 0.15 });
      const cab = new THREE.Group();
      scene.add(cab);
      const marqueeCanvas = document.createElement('canvas');
      marqueeCanvas.width = 1024;
      marqueeCanvas.height = 192;
      {
        const g = marqueeCanvas.getContext('2d')!;
        const bg = g.createLinearGradient(0, 0, 1024, 0);
        bg.addColorStop(0, '#3b0764');
        bg.addColorStop(0.5, '#7e22ce');
        bg.addColorStop(1, '#3b0764');
        g.fillStyle = bg;
        g.fillRect(0, 0, 1024, 192);
        g.font = '900 118px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = 14;
        g.strokeStyle = '#1e0536';
        g.strokeText('GEM SURGE', 512, 100);
        const tg = g.createLinearGradient(0, 40, 0, 160);
        tg.addColorStop(0, '#fdf4ff');
        tg.addColorStop(1, '#f0abfc');
        g.fillStyle = tg;
        g.fillText('GEM SURGE', 512, 100);
      }
      const marqueeTex = engine.own(new THREE.CanvasTexture(marqueeCanvas));
      marqueeTex.colorSpace = THREE.SRGBColorSpace;
      const marquee = new THREE.Mesh(new THREE.BoxGeometry(6.8, 1.3, 0.5), [cabMat, cabMat, cabMat, cabMat, new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: marqueeTex, emissiveIntensity: 1.1 }), cabMat]);
      marquee.position.set(2.55, 5.95, 0.1);
      marquee.rotation.x = 0.12;
      cab.add(marquee);
      [-1, 1].forEach((side) => {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.35, 9.2, 3.4), cabMat);
        panel.position.set(2.55 + side * 3.6, 1.6, 1.3);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 9.2, 0.06), neonMaterial(side < 0 ? 0x22d3ee : 0xf472b6, 1.6));
        strip.position.set(2.55 + side * 3.42, 1.6, 2.95);
        cab.add(panel, strip);
      });
      const deck = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.4, 3.0), cabMat);
      deck.position.set(2.55, -1.85, 1.5);
      deck.rotation.x = 0.28;
      deck.receiveShadow = engine.quality.shadows;
      cab.add(deck);
      const deckEdge = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.05, 0.05), neonMaterial(0xa855f7, 1.8));
      deckEdge.position.set(2.55, -1.62, 2.95);
      cab.add(deckEdge);
      // Joystick + three buttons on the deck.
      const controls = new THREE.Group();
      controls.position.copy(deck.position);
      controls.rotation.x = deck.rotation.x;
      cab.add(controls);
      const stickBase = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.08, 32), new THREE.MeshPhysicalMaterial({ color: 0x0b0b10, roughness: 0.3, metalness: 0.6 }));
      stickBase.position.set(-1.9, 0.24, 0.2);
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 12), new THREE.MeshPhysicalMaterial({ color: 0xd4d4d8, metalness: 1, roughness: 0.2 }));
      stick.position.set(-1.9, 0.5, 0.2);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.19, 28, 18), new THREE.MeshPhysicalMaterial({ color: 0xff2d55, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }));
      knob.position.set(-1.9, 0.8, 0.2);
      controls.add(stickBase, stick, knob);
      const buttons: THREE.Mesh[] = [];
      [0x22d3ee, 0xfacc15, 0xf472b6].forEach((c, i) => {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 28), new THREE.MeshPhysicalMaterial({ color: c, emissive: c, emissiveIntensity: 0.5, roughness: 0.2, clearcoat: 1 }));
        b.position.set(0.4 + i * 0.75, 0.25, 0.25 - i * 0.12);
        controls.add(b);
        buttons.push(b);
      });

      // First person: you stand at the cabinet; your hands rest in front of you.
      const arms = createFirstPersonRig(engine, stableAvatar, { spread: 0.26, drop: 0.46, depth: 0.5 });
      const feel = new CameraFeel();
      let poke = 0;
      let pressed = -1;
      const view = { x: BOARD_CENTER.x, y: BOARD_CENTER.y - 1.6, z: 12, lookY: BOARD_CENTER.y - 0.3 };

      const particles = new ParticleBursts(engine);

      // Portrait: the board fills the width with the marquee above and the control deck below.
      engine.onResize((_w, _h, aspect) => {
        if (aspect < 0.8) {
          camera.fov = 62;
          const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect;
          Object.assign(view, { x: BOARD_CENTER.x, y: BOARD_CENTER.y - 1.7, z: 3.45 / tanH, lookY: BOARD_CENTER.y - 0.25 });
        } else {
          camera.fov = 50;
          Object.assign(view, { x: BOARD_CENTER.x, y: BOARD_CENTER.y - 1.2, z: 10.5, lookY: BOARD_CENTER.y });
        }
        camera.updateProjectionMatrix();
      });

      // Every colour has its own cut (brilliant, emerald, trillion…) so gems read at a glance —
      // and stay distinguishable for colour-blind players. Faceted physical material: crisp
      // specular, clear coat and a thin-film shimmer that reflects the studio lights.
      const lathe = (pts: [number, number][], seg: number) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
      const gemGeos = [
        engine.own(lathe([[0, -0.36], [0.36, 0.04], [0.27, 0.17], [0, 0.19]], 8)), // brilliant
        engine.own(new RoundedBoxGeometry(0.5, 0.5, 0.3, 1, 0.08)), // emerald cut
        engine.own(new THREE.OctahedronGeometry(0.38, 0)), // diamond
        engine.own(new THREE.CylinderGeometry(0.33, 0.33, 0.3, 6, 1)), // hex
        engine.own(new THREE.DodecahedronGeometry(0.33, 0)), // round
      ];
      gemGeos[3].rotateX(Math.PI / 2);
      const gemMats = GEM_COLORS.map((c) =>
        engine.own(
          new THREE.MeshPhysicalMaterial({
            color: c,
            emissive: c,
            emissiveIntensity: 0.28,
            roughness: 0.08,
            metalness: 0.15,
            clearcoat: 1,
            clearcoatRoughness: 0.04,
            iridescence: 0.6,
            iridescenceIOR: 1.6,
            specularIntensity: 1,
            envMapIntensity: 1.8,
            flatShading: true,
          }),
        ),
      );
      const spareMeshes: THREE.Mesh[] = [];
      const takeMesh = (colorIdx: number) => {
        const m = spareMeshes.pop() ?? new THREE.Mesh(gemGeos[0]);
        m.geometry = gemGeos[colorIdx];
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

      // Difficulty: four gem types for the first 20s (lots of easy matches), then all five.
      const colorCount = () => (ROUND_SECONDS - sim.current.timeLeft < 20 || !sim.current.playing ? 4 : GEM_COLORS.length);

      const pickColor = (r: number, c: number) => {
        // Avoid creating ready-made matches on a fresh board
        for (let tries = 0; tries < 10; tries++) {
          const k = Math.floor(rngRef.current() * colorCount());
          const left = c >= 2 && board[r][c - 1]?.colorIdx === k && board[r][c - 2]?.colorIdx === k;
          const up = r >= 2 && board[r - 1][c]?.colorIdx === k && board[r - 2][c]?.colorIdx === k;
          if (!left && !up) return k;
        }
        return Math.floor(rngRef.current() * colorCount());
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

      /** First swap that makes a match, or null. Used for hints and dead-board reshuffles. */
      const findMove = (): [Gem, Gem] | null => {
        const trySwap = (a: Gem, b: Gem) => {
          const ar = a.r, ac = a.c, br = b.r, bc = b.c;
          board[ar][ac] = b;
          board[br][bc] = a;
          [a.r, a.c, b.r, b.c] = [br, bc, ar, ac];
          const ok = findMatches().size > 0;
          board[ar][ac] = a;
          board[br][bc] = b;
          [a.r, a.c, b.r, b.c] = [ar, ac, br, bc];
          return ok;
        };
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++) {
            const g = board[r][c];
            if (!g) continue;
            const right = c + 1 < COLS ? board[r][c + 1] : null;
            const down = r + 1 < ROWS ? board[r + 1][c] : null;
            if (right && trySwap(g, right)) return [g, right];
            if (down && trySwap(g, down)) return [g, down];
          }
        return null;
      };
      let idle = 0;
      let hint: [Gem, Gem] | null = null;

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
            const colorIdx = Math.floor(rngRef.current() * colorCount());
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
          idle = 0;
          hint = null;
          if (s.playing && !findMove()) {
            popups.current?.banner('NO MOVES · SHUFFLE', '#c4b5fd');
            buildBoard();
            busy = true;
            later(0.5, resolve);
          }
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
        if (s.combo >= 2) feel.kick(0.25);
        pushHud({ score: s.score, combo: s.combo, bestCombo: s.bestCombo }, true);
        collapse();
        later(0.32, resolve);
      };

      const swap = (a: Gem, b: Gem) => {
        busy = true;
        idle = 0;
        hint = null;
        poke = 1;
        pressed = sim.current.moves % 3;
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
            const hinted = !!hint && (g === hint[0] || g === hint[1]);
            const sc = sel ? 1.2 + Math.sin(t * 10) * 0.06 : hinted ? 1.08 + Math.sin(t * 8) * 0.1 : 1;
            g.mesh.scale.setScalar(g.mesh.scale.x + (sc - g.mesh.scale.x) * follow);
          }

        // Hint: after a few idle seconds (longer later in the round), the gems of a valid swap pulse.
        if (sim.current.playing && !busy) {
          idle += dt;
          const wait = ROUND_SECONDS - sim.current.timeLeft < 25 ? 3 : 6;
          if (!hint && idle > wait) hint = findMove();
        }

        cursor.visible = !!selected;
        if (selected) {
          cursor.position.copy(selected.target).setZ(0.05);
          cursor.rotation.z += dt * 2;
        }

        // First-person camera with a slow breathing sway; cascades shake it a little.
        const off = feel.update(dt, t, 0);
        camera.position.set(view.x + Math.sin(t * 0.6) * 0.04 + off.x, view.y + Math.sin(t * 1.1) * 0.03 + off.y, view.z);
        camera.lookAt(view.x, view.lookY, 0);

        // Hands: right hand taps a deck button on each swap.
        arms.ready(t);
        if (poke > 0) {
          poke = Math.max(0, poke - dt * 5);
          const k = Math.sin(poke * Math.PI);
          arms.right.pivot.position.z -= k * 0.08;
          arms.right.pivot.position.y -= k * 0.04;
          arms.right.pivot.rotation.x = -k * 0.3;
        }
        buttons.forEach((b, i) => (b.position.y = 0.25 - (i === pressed ? Math.sin(poke * Math.PI) * 0.06 : 0)));
        knob.position.x = -1.9 + Math.sin(t * 0.9) * 0.03;
        arms.setGlow(Math.min(1.5, s.combo * 0.4));
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
      scoring="First-person arcade cabinet. Four gem types for the first 20s, then five. Stuck? A valid swap starts to pulse. 60 per gem cleared · Each cascade step in one move multiplies (×2, ×3…) · Last 10s ×2. Same board for every player."
    />
  );
}
