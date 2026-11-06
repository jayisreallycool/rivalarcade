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
import { CLUTCH_SECONDS, PTS, award, popStyle, ScoreBook } from '@/lib/scoring';
import GameShell, { PopupApi, useSwipe, Swipe } from './GameShell';
import { Move, Sparkles, Shuffle } from 'lucide-react';

type GemSurge3DProps = GameProps;

/**
 * GEM SURGE — match-3 on a 7×7 board, built for head-to-head skill:
 *  · 2-minute clock, extended by TIME gems — and the run also ends the moment no move is left,
 *    so planning your board (and saving your shuffles) matters as much as speed.
 *  · Power gems from big matches: 4 in a row → LINE (clears its row or column), an L or T shape →
 *    BOMB (clears 3×3), 5 in a row → PRISM (swap it with any gem to clear every gem of that colour).
 *    Power gems set each other off in chains.
 *  · Power objects drop in now and then: ⏱ +5 seconds, ×2 points for 6 seconds.
 *  · One SHUFFLE to start (+1 for every PRISM you make): used automatically when you're stuck.
 * Score (small numbers): 1 a gem · each cascade step +1 a gem · LINE +1 · BOMB +2 · PRISM +3 ·
 * ×2 power · last 10 s CLUTCH ×2. Same seeded board for every player.
 */
const ROWS = 7;
const COLS = 7;
const GEM_COLORS = [0x00f0ff, 0xff0055, 0xffb800, 0x10b981, 0xa855f7];
const SPACING = 0.84;
const ORIGIN = new THREE.Vector3(2.575 - 3 * SPACING, 2.025 + 3 * SPACING, 0);
const GEM_SCALE = 0.88;
/** Round length (seconds) before TIME gems. */
const GEM_SECONDS = 120;
const START_SHUFFLES = 1;
const X2_SECONDS = 6;
type Special = 'line-h' | 'line-v' | 'bomb' | 'prism' | 'clock' | 'x2';
const PRISM = 99; // a prism's colour matches nothing: you swap it to set it off
const BOARD_CENTER = new THREE.Vector3(ORIGIN.x + ((COLS - 1) * SPACING) / 2, ORIGIN.y - ((ROWS - 1) * SPACING) / 2, 0);
const TOUCH_SLOP = 34;

interface Gem {
  r: number;
  c: number;
  colorIdx: number;
  mesh: THREE.Mesh;
  target: THREE.Vector3;
  special?: Special;
  deco?: THREE.Object3D;
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
  const [hud, pushHud] = useThrottledHud({ score: 0, combo: 0, bestCombo: 0, timeLeft: GEM_SECONDS, clutch: false, shuffles: START_SHUFFLES, x2: 0 });
  const popups = useRef<PopupApi | null>(null);
  const inputRef = useRef<{ down: (x: number, y: number) => void; swipe: (s: Swipe) => void; tap: () => void }>({ down: () => {}, swipe: () => {}, tap: () => {} });
  const resetWorldRef = useRef<() => void>(() => {});
  const fresh = () => ({ playing: true, score: 0, combo: 0, bestCombo: 0, timeLeft: GEM_SECONDS, clutchAnnounced: false, moves: 0, cleared: 0, book: new ScoreBook(), shuffles: START_SHUFFLES, x2: 0 });
  const sim = useRef({ ...fresh(), playing: false });

  const startGame = useCallback(() => {
    Object.assign(sim.current, fresh());
    rngRef.current = mulberry32(seedRef.current ?? randomSeed());
    resetWorldRef.current();
    pushHud({ score: 0, combo: 0, bestCombo: 0, timeLeft: GEM_SECONDS, clutch: false, shuffles: START_SHUFFLES, x2: 0 }, true);
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
      const frameGeo = new THREE.BoxGeometry(6.3, 6.3, 0.2);
      const frame = new THREE.Mesh(frameGeo, new THREE.MeshPhysicalMaterial({ color: 0x0e1020, roughness: 0.35, metalness: 0.6, clearcoat: 0.8, clearcoatRoughness: 0.1 }));
      frame.position.set(2.55, 2.0, -0.25);
      frame.receiveShadow = engine.quality.shadows;
      const frameEdge = new THREE.LineSegments(new THREE.EdgesGeometry(frameGeo), new THREE.LineBasicMaterial({ color: new THREE.Color(0xa855f7).multiplyScalar(2.2), toneMapped: false }));
      frameEdge.position.copy(frame.position);
      scene.add(frame, frameEdge);

      // Selection cursor
      const cursor = new THREE.Mesh(new THREE.TorusGeometry(0.41, 0.03, 6, 40), neonMaterial(0xffffff, 1.6));
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
        m.scale.setScalar(GEM_SCALE);
        m.castShadow = engine.quality.shadows;
        scene.add(m);
        return m;
      };
      const dropMesh = (m: THREE.Mesh) => {
        scene.remove(m);
        spareMeshes.push(m);
      };

      // ---- power gem looks: a glowing band (line), a pulsing ring (bomb), a rainbow star (prism),
      // and badges for the power objects (⏱ +5s, ×2)
      const prismGeo = engine.own(new THREE.IcosahedronGeometry(0.34, 0));
      const prismMat = engine.own(new THREE.MeshPhysicalMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.05, metalness: 0.1, iridescence: 1, iridescenceIOR: 2, clearcoat: 1, flatShading: true }));
      const bandGeo = engine.own(new THREE.BoxGeometry(0.86, 0.09, 0.42));
      const bandMat = engine.own(neonMaterial(0xffffff, 2.2));
      const ringGeo = engine.own(new THREE.TorusGeometry(0.36, 0.045, 8, 32));
      const ringMat = engine.own(neonMaterial(0xff7a1a, 2.4));
      const badge = (text: string, bg: string) => {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g = c.getContext('2d')!;
        g.fillStyle = bg;
        g.beginPath();
        g.arc(64, 64, 58, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = 8;
        g.strokeStyle = '#ffffff';
        g.stroke();
        g.fillStyle = '#ffffff';
        g.font = '900 52px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, 64, 68);
        return engine.own(new THREE.SpriteMaterial({ map: engine.own(new THREE.CanvasTexture(c)), depthTest: false, toneMapped: false }));
      };
      const clockBadge = badge('+5', '#0ea5e9');
      const x2Badge = badge('×2', '#e11d48');
      const decorate = (g: Gem) => {
        if (g.deco) scene.remove(g.deco);
        g.deco = undefined;
        if (!g.special) return;
        let d: THREE.Object3D;
        if (g.special === 'line-h' || g.special === 'line-v') {
          d = new THREE.Mesh(bandGeo, bandMat);
          if (g.special === 'line-v') d.rotation.z = Math.PI / 2;
        } else if (g.special === 'bomb') d = new THREE.Mesh(ringGeo, ringMat);
        else if (g.special === 'prism') {
          g.mesh.geometry = prismGeo;
          g.mesh.material = prismMat;
          d = new THREE.Object3D();
        } else {
          d = new THREE.Sprite(g.special === 'clock' ? clockBadge : x2Badge);
          d.scale.setScalar(0.42);
        }
        d.position.copy(g.mesh.position);
        scene.add(d);
        g.deco = d;
      };
      const removeGem = (g: Gem) => {
        dropMesh(g.mesh);
        if (g.deco) scene.remove(g.deco);
        g.deco = undefined;
      };

      const board: (Gem | null)[][] = Array.from({ length: ROWS }, () => Array<Gem | null>(COLS).fill(null));
      let busy = false; // input locked while swaps/cascades resolve
      let selected: Gem | null = null;
      let lastMoved: Gem[] = []; // the two gems of the last swap (power gems form where you moved)
      const tasks: { at: number; fn: () => void }[] = [];
      const later = (delay: number, fn: () => void) => tasks.push({ at: engine.elapsed + delay, fn });

      // Difficulty: four gem types for the first 25 s (lots of easy matches), then all five.
      const colorCount = () => (GEM_SECONDS - sim.current.timeLeft < 25 || !sim.current.playing ? 4 : GEM_COLORS.length);

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

      const newGem = (r: number, c: number, colorIdx: number, special?: Special) => {
        const mesh = takeMesh(colorIdx === PRISM ? 0 : colorIdx);
        const g: Gem = { r, c, colorIdx, mesh, target: cellPos(r, c), special };
        decorate(g);
        return g;
      };

      const buildBoard = (keepSpecials = false) => {
        const keep: Gem[] = [];
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++) {
            const old = board[r][c];
            if (old && keepSpecials && old.special) keep.push(old);
            else if (old) removeGem(old);
            board[r][c] = null;
          }
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++) {
            const g = newGem(r, c, pickColor(r, c));
            g.mesh.position.copy(g.target).add(new THREE.Vector3(0, 3 + r * 0.4, 0));
            board[r][c] = g;
          }
        // a shuffle keeps your power gems, dropped back in at random spots
        for (const k of keep) {
          const r = Math.floor(rngRef.current() * ROWS);
          const c = Math.floor(rngRef.current() * COLS);
          removeGem(board[r][c]!);
          k.r = r;
          k.c = c;
          cellPos(r, c, k.target);
          board[r][c] = k;
        }
      };
      buildBoard();

      type Run = { gems: Gem[]; horiz: boolean };
      /** Every straight run of 3+ same-colour gems (prisms never match). */
      const findRuns = () => {
        const runs: Run[] = [];
        for (let r = 0; r < ROWS; r++) {
          let c = 0;
          while (c < COLS) {
            const g = board[r][c];
            let e = c + 1;
            while (g && g.colorIdx !== PRISM && e < COLS && board[r][e]?.colorIdx === g.colorIdx) e++;
            if (g && e - c >= 3) runs.push({ gems: board[r].slice(c, e) as Gem[], horiz: true });
            c = e;
          }
        }
        for (let c = 0; c < COLS; c++) {
          let r = 0;
          while (r < ROWS) {
            const g = board[r][c];
            let e = r + 1;
            while (g && g.colorIdx !== PRISM && e < ROWS && board[e][c]?.colorIdx === g.colorIdx) e++;
            if (g && e - r >= 3) runs.push({ gems: Array.from({ length: e - r }, (_, k) => board[r + k][c]!), horiz: false });
            r = e;
          }
        }
        return runs;
      };
      const findMatches = () => {
        const hit = new Set<Gem>();
        for (const run of findRuns()) run.gems.forEach((g) => hit.add(g));
        return hit;
      };

      /** First swap that makes a match (or any prism with a neighbour), or null. */
      const findMove = (): [Gem, Gem] | null => {
        const trySwap = (a: Gem, b: Gem) => {
          if (a.colorIdx === PRISM || b.colorIdx === PRISM) return true;
          const ar = a.r, ac = a.c, br = b.r, bc = b.c;
          board[ar][ac] = b;
          board[br][bc] = a;
          [a.r, a.c, b.r, b.c] = [br, bc, ar, ac];
          const ok = findRuns().length > 0;
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
        const s = sim.current;
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
            // power objects drop in now and then once the round is going
            const roll = rngRef.current();
            const special: Special | undefined = s.playing && GEM_SECONDS - s.timeLeft > 8 ? (roll < 0.018 ? 'clock' : roll < 0.032 ? 'x2' : undefined) : undefined;
            const g = newGem(r, c, colorIdx, special);
            g.mesh.position.copy(g.target);
            g.mesh.position.y += 2.5 + (empty - r) * 0.5;
            board[r][c] = g;
          }
        }
      };

      const addPoints = (parts: Record<string, number>, at: THREE.Vector3, tone?: 'gold' | 'bonus' | 'jackpot') => {
        const s = sim.current;
        const raw = Object.values(parts).reduce((x, y) => x + y, 0);
        if (raw <= 0) return 0;
        const boost = s.x2 > 0 ? 2 : 1;
        if (boost > 1) parts['×2 power'] = raw;
        const a = award(raw * boost, { timeLeft: s.timeLeft });
        s.book.record(a, parts);
        s.score = s.book.score;
        const sp = engine.toScreen(at);
        popups.current?.pop(`+${a.total}`, sp.x, sp.y, popStyle(a.total, tone));
        return a.total;
      };

      /** Gems a power gem takes with it when it goes off (set off chains included). */
      const blast = (start: Set<Gem>, colourHit?: number) => {
        const s = sim.current;
        const out = new Set(start);
        const queue = [...start];
        const fx = (g: Gem, color: number) => particles.emit(g.mesh.position, color, { count: 14, speed: 5, life: 0.6, gravity: 3 });
        while (queue.length) {
          const g = queue.pop()!;
          const add = (x: Gem | null | undefined) => {
            if (x && !out.has(x)) {
              out.add(x);
              queue.push(x);
            }
          };
          switch (g.special) {
            case 'line-h':
              board[g.r].forEach(add);
              fx(g, 0xffffff);
              sound.playLaser();
              break;
            case 'line-v':
              for (let r = 0; r < ROWS; r++) add(board[r][g.c]);
              fx(g, 0xffffff);
              sound.playLaser();
              break;
            case 'bomb':
              for (let r = g.r - 1; r <= g.r + 1; r++) for (let c = g.c - 1; c <= g.c + 1; c++) add(board[r]?.[c]);
              fx(g, 0xff7a1a);
              feel.kick(0.4);
              sound.playPowerup();
              break;
            case 'prism': {
              const k = colourHit ?? Math.floor(rngRef.current() * colorCount());
              for (const row of board) for (const x of row) if (x && x.colorIdx === k) add(x);
              fx(g, 0xffffff);
              engine.flash(0.6);
              sound.playCombo(3);
              break;
            }
            case 'clock':
              s.timeLeft += 5;
              popups.current?.banner('+5 SECONDS', '#38bdf8');
              sound.playPowerup();
              break;
            case 'x2':
              s.x2 = X2_SECONDS;
              popups.current?.banner(`×2 POINTS · ${X2_SECONDS}s`, '#fb7185');
              sound.playPowerup();
              break;
          }
          if (g.special) g.special = undefined; // each goes off once
        }
        return out;
      };

      /** Clear matches (forming power gems), drop, refill — and keep chaining until stable. */
      const resolve = (prismPair?: [Gem, Gem]) => {
        const s = sim.current;
        let matched = new Set<Gem>();
        const make: { g: Gem; special: Special }[] = [];
        let colourHit: number | undefined;
        if (prismPair) {
          const [p, other] = prismPair;
          matched.add(p);
          colourHit = other.colorIdx === PRISM ? Math.floor(rngRef.current() * colorCount()) : other.colorIdx;
          if (other.special && other.colorIdx !== PRISM) matched.add(other);
        } else {
          const runs = findRuns();
          for (const run of runs) run.gems.forEach((g) => matched.add(g));
          // L / T shapes: a gem in both a row run and a column run → BOMB there
          const inH = new Set<Gem>();
          runs.filter((r) => r.horiz).forEach((r) => r.gems.forEach((g) => inH.add(g)));
          const used = new Set<Gem>();
          for (const run of runs.filter((r) => !r.horiz))
            for (const g of run.gems)
              if (inH.has(g) && !used.has(g) && !g.special) {
                make.push({ g, special: 'bomb' });
                used.add(g);
              }
          for (const run of runs) {
            if (run.gems.some((g) => used.has(g))) continue;
            if (run.gems.length < 4) continue;
            const at = run.gems.find((g) => lastMoved.includes(g) && !g.special) ?? run.gems[Math.floor(run.gems.length / 2)];
            if (at.special) continue;
            make.push({ g: at, special: run.gems.length >= 5 ? 'prism' : run.horiz ? 'line-h' : 'line-v' });
            used.add(at);
          }
        }
        lastMoved = [];
        if (!matched.size || !s.playing) {
          busy = false;
          idle = 0;
          hint = null;
          if (s.playing && !findMove()) {
            if (s.shuffles > 0) {
              s.shuffles -= 1;
              popups.current?.banner(`NO MOVES · SHUFFLE (${s.shuffles} left)`, '#c4b5fd');
              buildBoard(true);
              busy = true;
              pushHud({ shuffles: s.shuffles }, true);
              later(0.5, () => resolve());
            } else endGame('OUT OF MOVES');
          }
          return;
        }
        // power gems in the clear go off (and set each other off)
        const formed = new Set(make.map((m) => m.g));
        matched = blast(new Set([...matched].filter((g) => !formed.has(g))), colourHit);
        make.forEach((m) => matched.add(m.g));
        const centre = new THREE.Vector3();
        let cleared = 0;
        matched.forEach((g) => {
          centre.add(g.mesh.position);
          if (formed.has(g)) return;
          particles.emit(g.mesh.position, g.colorIdx === PRISM ? 0xffffff : GEM_COLORS[g.colorIdx], { count: 8, speed: 3.5, life: 0.55, gravity: 4 });
          board[g.r][g.c] = null;
          removeGem(g);
          cleared++;
        });
        centre.divideScalar(Math.max(1, matched.size));
        // the new power gems stay on the board where they formed
        for (const m of make) {
          m.g.special = m.special;
          if (m.special === 'prism') {
            m.g.colorIdx = PRISM;
            s.shuffles += 1;
            pushHud({ shuffles: s.shuffles }, true);
          }
          decorate(m.g);
          particles.emit(m.g.mesh.position, 0xffffff, { count: 20, speed: 3, life: 0.6, gravity: 1 });
        }
        s.combo += 1;
        // 1 a gem · each cascade step +1 a gem · LINE +1 · BOMB +2 · PRISM +3
        const parts: Record<string, number> = { 'Gems cleared': cleared * PTS.base };
        if (s.combo > 1) parts['Cascades'] = cleared * (s.combo - 1);
        const nLine = make.filter((m) => m.special === 'line-h' || m.special === 'line-v').length;
        const nBomb = make.filter((m) => m.special === 'bomb').length;
        const nPrism = make.filter((m) => m.special === 'prism').length;
        if (nLine) parts['Line gems'] = nLine;
        if (nBomb) parts['Bomb gems'] = nBomb * 2;
        if (nPrism) parts['Prism gems'] = nPrism * 3;
        const pts = addPoints(parts, centre, nPrism ? 'gold' : s.combo >= 2 || nLine || nBomb ? 'bonus' : undefined);
        s.cleared += cleared;
        s.bestCombo = Math.max(s.bestCombo, s.combo);
        const sp = engine.toScreen(centre);
        if (s.combo >= 2) popups.current?.banner(`CASCADE ×${s.combo}`, s.combo >= 3 ? '#f0abfc' : '#c4b5fd');
        if (nPrism) popups.current?.pop('PRISM! +1 SHUFFLE', sp.x, sp.y + 26, { color: '#f0abfc', size: 'sm' });
        else if (nBomb) popups.current?.pop('BOMB GEM', sp.x, sp.y + 26, { color: '#fdba74', size: 'sm' });
        else if (nLine) popups.current?.pop('LINE GEM', sp.x, sp.y + 26, { color: '#e0f2fe', size: 'sm' });
        void pts;
        haptic(s.combo >= 2 || cleared >= 6 ? 'big' : 'score');
        sound.playScore(1 + Math.min(s.combo * 0.1, 1.5));
        engine.flash(Math.min(1, 0.25 + cleared * 0.04));
        if (s.combo >= 2 || cleared >= 7) feel.kick(0.25);
        pushHud({ score: s.score, combo: s.combo, bestCombo: s.bestCombo }, true);
        collapse();
        later(0.24, () => resolve());
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
        lastMoved = [a, b];
        later(0.13, () => {
          if (a.colorIdx === PRISM || b.colorIdx === PRISM) {
            resolve(a.colorIdx === PRISM ? [a, b] : [b, a]);
          } else if (findRuns().length) {
            resolve();
          } else {
            place(a, ar, ac);
            place(b, br, bc);
            lastMoved = [];
            sound.playTap();
            haptic('light');
            sim.current.combo = 0;
            pushHud({ combo: 0 }, true);
            later(0.13, () => (busy = false));
          }
        });
      };

      const endGame = (why: string) => {
        const s = sim.current;
        if (!s.playing) return;
        s.playing = false;
        selected = null;
        popups.current?.banner(why === 'TIME' ? `TIME! · ${s.score}` : `${why} · ${s.score}`, why === 'TIME' ? '#c084fc' : '#fb7185');
        if (why === 'TIME') sound.playWin();
        else sound.playLose();
        haptic('big');
        const breakdown = s.book.breakdown();
        pushHud({ timeLeft: Math.max(0, s.timeLeft), score: s.score, clutch: false }, true);
        setPhase('over');
        setTimeout(() => onFinishRef.current(s.score, { maxCombo: s.bestCombo, breakdown }), why === 'TIME' ? 0 : 900);
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
          s.x2 = Math.max(0, s.x2 - dt);
          if (s.timeLeft <= 0) {
            s.timeLeft = 0;
            endGame('TIME');
          } else {
            pushHud({ timeLeft: s.timeLeft, clutch: s.timeLeft <= CLUTCH_SECONDS, x2: Math.ceil(s.x2) });
          }
        }

        const follow = 1 - Math.exp(-18 * dt);
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++) {
            const g = board[r][c];
            if (!g) continue;
            g.mesh.position.lerp(g.target, follow);
            g.mesh.rotation.y += 1.2 * dt;
            g.mesh.rotation.x = Math.sin(t * 2 + r + c) * 0.15;
            const sel = g === selected;
            const hinted = !!hint && (g === hint[0] || g === hint[1]);
            const sc = GEM_SCALE * (sel ? 1.2 + Math.sin(t * 10) * 0.06 : hinted ? 1.08 + Math.sin(t * 8) * 0.1 : 1);
            g.mesh.scale.setScalar(g.mesh.scale.x + (sc - g.mesh.scale.x) * follow);
            if (g.deco) {
              g.deco.position.copy(g.mesh.position).setZ(g.mesh.position.z + 0.2);
              if (g.special === 'bomb') g.deco.scale.setScalar(1 + Math.sin(t * 9) * 0.12);
              if (g.special === 'line-h' || g.special === 'line-v') (g.deco as THREE.Mesh).scale.set(1 + Math.sin(t * 7) * 0.08, 1, 1);
            }
            if (g.colorIdx === PRISM) prismMat.emissive.setHSL((t * 0.4) % 1, 0.9, 0.6);
          }

        // Hint: after a few idle seconds (longer later in the round), the gems of a valid swap pulse.
        if (sim.current.playing && !busy) {
          idle += dt;
          const wait = GEM_SECONDS - sim.current.timeLeft < 25 ? 3 : 6;
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

  const chips = (
    <>
      <span className="px-2 py-0.5 rounded-full bg-black/50 text-violet-200 text-[11px] font-black whitespace-nowrap" data-testid="gem-shuffles">
        🔀 {hud.shuffles}
      </span>
      {hud.x2 > 0 && <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[11px] font-black whitespace-nowrap animate-pulse">×2 · {hud.x2}s</span>}
      {hud.combo > 1 && <span className="px-2 py-0.5 rounded-full bg-fuchsia-400 text-black text-[11px] font-black whitespace-nowrap">CASCADE ×{hud.combo}</span>}
    </>
  );

  return (
    <GameShell
      title="GEM SURGE"
      accent="#c084fc"
      hostRef={hostRef}
      popupsRef={popups}
      phase={phase}
      onStart={startGame}
      score={hud.score}
      timeLeft={phase === 'ready' ? GEM_SECONDS : hud.timeLeft}
      roundSeconds={GEM_SECONDS}
      clutch={hud.clutch}
      chips={chips}
      rival={rival}
      match={match}
      onExit={onExit}
      surface={surface}
      hint="Swipe a gem to swap · match 4+ for power gems"
      guide={{
        goal: 'Match 3+ gems. Build power gems. Don’t run out of moves.',
        controls: [
          { gesture: 'swap', label: 'Swipe to swap' },
          { gesture: 'tap', label: 'Or tap, tap' },
          { gesture: 'chain', label: 'Chain cascades' },
        ],
        points: [
          { label: 'Gem', value: '1' },
          { label: 'Cascade', value: '+1 a gem', tone: 'bonus' },
          { label: '4 → LINE', value: '+1', tone: 'bonus' },
          { label: 'L/T → BOMB', value: '+2', tone: 'bonus' },
          { label: '5 → PRISM', value: '+3', tone: 'gold' },
          { label: '⏱ / ×2 gems', value: 'power', tone: 'jackpot' },
        ],
        ends: '2 min (+5s per ⏱ gem) · or no moves left · 🔀 shuffle saves you once',
      }}
      tutorial={[
        { icon: <Move className="w-6 h-6" />, label: 'Swipe to swap' },
        { icon: <Sparkles className="w-6 h-6" />, label: 'Match 4+ = power gem' },
        { icon: <Shuffle className="w-6 h-6" />, label: 'No moves = game over' },
      ]}
      scoring="Match 3 or more gems on a 7×7 board. 1 point a gem · each cascade step +1 a gem. Big matches build power gems: 4 in a row → LINE gem (+1; clears its row or column when matched), an L or T shape → BOMB gem (+2; clears 3×3), 5 in a row → PRISM (+3; swap it with any gem to clear every gem of that colour — and it earns a shuffle). Power objects drop in: ⏱ gems add 5 seconds, ×2 gems double your points for 6 seconds. Last 10 s CLUTCH ×2. The run lasts 2 minutes — or ends as soon as no move is left; you start with 1 shuffle that's used automatically when you're stuck. Same board for every player, so the best planner wins."
    />
  );
}
